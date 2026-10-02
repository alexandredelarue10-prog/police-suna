require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pool = require('./apps/police-suna/src/config/db');
const police = require('./apps/police-suna');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Santé + cible du ping keep-alive (GitHub Actions) — avant tout le reste, sans session
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ---------- Réglages admin (en mémoire, persistés en base) ----------
const reglages = { maintenance: { actif: false, message: '' }, annonce: { actif: false, texte: '' } };
async function chargerReglages() {
  await pool.query('CREATE TABLE IF NOT EXISTS hub_settings (cle TEXT PRIMARY KEY, valeur JSONB NOT NULL)');
  const { rows } = await pool.query('SELECT cle, valeur FROM hub_settings');
  for (const r of rows) if (reglages[r.cle]) reglages[r.cle] = { ...reglages[r.cle], ...r.valeur };
}
async function sauver(cle, valeur) {
  await pool.query(
    'INSERT INTO hub_settings (cle, valeur) VALUES ($1,$2) ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur',
    [cle, JSON.stringify(valeur)]
  );
  reglages[cle] = valeur;
}

// ---------- Session admin : cookie signé (HMAC), sans base ----------
// Changer HUB_SESSION_SECRET déconnecte immédiatement l'admin de tous les appareils.
const SECRET = process.env.HUB_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret-a-changer';
const DUREE = 7 * 24 * 60 * 60 * 1000;
const sign = (exp) => crypto.createHmac('sha256', SECRET).update('hub.' + exp).digest('hex');
function isHub(req) {
  const m = /(?:^|;\s*)hub\.sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
const requireHub = (req, res, next) => (isHub(req) ? next() : res.status(401).json({ error: 'Non connecté.' }));

// ---------- Maintenance : bloque police-suna pour tous, sauf l'admin connecté ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MSG_DEFAUT = 'Le site est temporairement fermé. Revenez plus tard.';
function pageMaintenance(msg) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Maintenance</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 50% 0,#3a2f1f,#17150F 70%);color:#F6EFDC;font-family:system-ui,sans-serif;text-align:center;padding:20px}
h1{font-family:Oswald,'Arial Narrow',sans-serif;color:#CBA84C;letter-spacing:.05em}p{max-width:480px;line-height:1.6;white-space:pre-wrap}</style></head>
<body><div><h1>Accès fermé</h1><p>${esc(msg || MSG_DEFAUT)}</p></div></body></html>`;
}
app.use('/police-suna', (req, res, next) => {
  if (!reglages.maintenance.actif || isHub(req)) return next();
  const msg = reglages.maintenance.message || MSG_DEFAUT;
  if (req.path.startsWith('/api/')) return res.status(503).json({ error: msg, maintenance: true });
  res.status(503).set('Retry-After', '300').type('html').send(pageMaintenance(msg));
});

// police-suna complet, avec ses propres comptes (inchangés)
app.get(/^\/police-suna$/, (req, res) => res.redirect('/police-suna/')); // le slash final garde les liens relatifs valides
app.use('/police-suna', police.app);

// ---------- Hub ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '16kb' }));

// Mot de passe admin : hash bcrypt (jamais en clair dans le code).
// HUB_PASSWORD_HASH (variable d'environnement) prend le dessus si définie : à utiliser pour changer le mot de passe.
const DEFAULT_HUB_HASH = '$2a$12$MBOSPUcfRXxwGx5L3ZiacOg9FJkiiKAh0UDPafHiJYRA2WULDzhkq';
const checkPassword = (pwd) => bcrypt.compare(pwd, process.env.HUB_PASSWORD_HASH || DEFAULT_HUB_HASH);

// Anti force brute : 5 échecs / 15 min par IP
const essais = new Map();
const limite = (ip) => { const e = essais.get(ip); return !!e && e.fin > Date.now() && e.n >= 5; };
function echec(ip) {
  const e = essais.get(ip);
  if (!e || e.fin < Date.now()) essais.set(ip, { n: 1, fin: Date.now() + 15 * 60 * 1000 });
  else e.n += 1;
}

app.post('/hub/login', async (req, res) => {
  if (limite(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const ok = await checkPassword(String((req.body && req.body.password) || ''));
  if (!ok) { echec(req.ip); return res.status(401).json({ error: 'Mot de passe incorrect.' }); }
  const exp = Date.now() + DUREE;
  res.cookie('hub.sid', `${exp}.${sign(exp)}`, { ...cookieOpts, maxAge: DUREE });
  res.json({ ok: true });
});
app.post('/hub/logout', (req, res) => { res.clearCookie('hub.sid', cookieOpts); res.json({ ok: true }); });

// Public : projets visibles (public !== false) et bandeau d'annonce
const lireProjets = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'hub', 'projets.json'), 'utf8'));
app.get('/hub/projets', (req, res) => res.json(lireProjets().filter((p) => p.public !== false)));
app.get('/hub/annonce', (req, res) => {
  const a = reglages.annonce;
  res.json(a.actif && a.texte ? { texte: a.texte } : {});
});

// Admin
app.get('/hub/admin/projets', requireHub, (req, res) => res.json(lireProjets()));
app.get('/hub/admin/etat', requireHub, async (req, res) => {
  const stats = { comptes: {}, sessions: [] };
  try {
    const c = await pool.query('SELECT statut, COUNT(*)::int AS n FROM users GROUP BY statut');
    for (const r of c.rows) stats.comptes[r.statut] = r.n;
    // Dernière activité = fin de validité de la session - 7 jours (durée de session de police-suna)
    const s = await pool.query(`SELECT sess->'user'->>'username' AS username, MAX(expire) - interval '7 days' AS derniere_activite
      FROM session WHERE expire > now() AND sess->'user' IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
    stats.sessions = s.rows;
  } catch (err) { stats.erreur = 'Stats indisponibles.'; }
  res.json({ maintenance: reglages.maintenance, annonce: reglages.annonce, stats });
});
const texte = (v, max) => String(v ?? '').trim().slice(0, max);
app.post('/hub/admin/maintenance', requireHub, async (req, res) => {
  await sauver('maintenance', { actif: !!req.body.actif, message: texte(req.body.message, 500) });
  res.json(reglages.maintenance);
});
app.post('/hub/admin/annonce', requireHub, async (req, res) => {
  await sauver('annonce', { actif: !!req.body.actif, texte: texte(req.body.texte, 300) });
  res.json(reglages.annonce);
});
app.post('/hub/admin/deconnecter-tous', requireHub, async (req, res) => {
  const r = await pool.query('DELETE FROM session');
  res.json({ deconnectes: r.rowCount });
});

// Pages
app.use('/assets', express.static(path.join(__dirname, 'hub', 'public', 'assets')));
const page = (f) => path.join(__dirname, 'hub', 'public', f);
app.get('/', (req, res) => res.sendFile(page('index.html')));
app.get('/admin', (req, res) => res.sendFile(page(isHub(req) ? 'admin.html' : 'login.html')));
app.use((req, res) => res.redirect('/'));

police.init()
  .then(chargerReglages)
  .then(() => app.listen(PORT, () => console.log(`[server] Hub + police-suna en ligne sur le port ${PORT}`)))
  .catch((err) => { console.error('[server] Échec du démarrage :', err); process.exit(1); });
