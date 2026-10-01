require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const police = require('./apps/police-suna');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// Santé + cible du ping keep-alive (GitHub Actions) — avant tout le reste, sans session
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// police-suna complet, accessible à ses membres avec ses propres comptes (inchangés)
app.get(/^\/police-suna$/, (req, res) => res.redirect('/police-suna/')); // le slash final garde les liens relatifs valides
app.use('/police-suna', police.app);

// ---------------- HUB PRIVÉ ----------------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '8kb' }));
// Session du hub : cookie signé (HMAC) à expiration, sans base de données (un seul utilisateur).
// Changer HUB_SESSION_SECRET déconnecte immédiatement tous les appareils.
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

// Mot de passe du hub : hash bcrypt (jamais le mot de passe en clair dans le code).
// HUB_PASSWORD_HASH (variable d'environnement) prend le dessus si définie : à utiliser pour changer le mot de passe.
const DEFAULT_HUB_HASH = '$2a$12$MBOSPUcfRXxwGx5L3ZiacOg9FJkiiKAh0UDPafHiJYRA2WULDzhkq';
async function checkPassword(pwd) {
  const hash = process.env.HUB_PASSWORD_HASH || DEFAULT_HUB_HASH;
  const plain = process.env.HUB_PASSWORD;
  if (hash) return bcrypt.compare(pwd, hash);
  if (plain) {
    const a = crypto.createHash('sha256').update(pwd).digest();
    const b = crypto.createHash('sha256').update(plain).digest();
    return crypto.timingSafeEqual(a, b);
  }
  return false;
}

// Limite anti force brute : 5 échecs / 15 min par IP
const essais = new Map();
function limite(ip) {
  const e = essais.get(ip);
  if (!e || e.fin < Date.now()) return false;
  return e.n >= 5;
}
function echec(ip) {
  const e = essais.get(ip);
  if (!e || e.fin < Date.now()) essais.set(ip, { n: 1, fin: Date.now() + 15 * 60 * 1000 });
  else e.n += 1;
}

const requireHub = (req, res, next) => (isHub(req) ? next() : res.status(401).json({ error: 'Non connecté.' }));

app.post('/hub/login', async (req, res) => {
  if (limite(req.ip)) return res.status(429).json({ error: 'Trop de tentatives. Réessaie dans 15 minutes.' });
  const ok = await checkPassword(String((req.body && req.body.password) || ''));
  if (!ok) { echec(req.ip); return res.status(401).json({ error: 'Mot de passe incorrect.' }); }
  const exp = Date.now() + DUREE;
  res.cookie('hub.sid', `${exp}.${sign(exp)}`, { ...cookieOpts, maxAge: DUREE });
  res.json({ ok: true });
});

app.post('/hub/logout', (req, res) => { res.clearCookie('hub.sid', cookieOpts); res.json({ ok: true }); });

// La liste des projets n'est servie qu'après connexion
app.get('/hub/projets', requireHub, (req, res) => {
  res.sendFile(path.join(__dirname, 'hub', 'projets.json'));
});

app.use('/assets', express.static(path.join(__dirname, 'hub', 'public', 'assets')));
app.get('/', (req, res) => {
  const page = isHub(req) ? 'dashboard.html' : 'login.html';
  res.sendFile(path.join(__dirname, 'hub', 'public', page));
});
app.use((req, res) => res.redirect('/'));

police.init()
  .then(() => app.listen(PORT, () => console.log(`[server] Hub privé + police-suna en ligne sur le port ${PORT}`)))
  .catch((err) => { console.error('[server] Échec du démarrage :', err); process.exit(1); });
