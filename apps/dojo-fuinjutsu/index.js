const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const pool = require('../police-suna/src/config/db');

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));

const GRADES = { adepte: 1, professeur: 2, comaitre: 3, maitre: 4 };
const DANGERS = ['faible', 'modere', 'eleve', 'interdit'];
const SECRET = process.env.DOJO_SESSION_SECRET || process.env.SESSION_SECRET || 'dev-secret-a-changer';
const DUREE = 7 * 24 * 3600 * 1000;
const sig = (v) => crypto.createHmac('sha256', SECRET).update('dojo.' + v).digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/dojo-fuinjutsu' };
const h = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const niv = (m) => GRADES[m.grade] || 0;
const bad = (res, code, error) => res.status(code).json({ error });
const log = (req, action) => pool.query('INSERT INTO dojo_activite (membre_id, nom, action) VALUES ($1,$2,$3)', [req.membre.id, req.membre.nom_rp, action]).catch(() => {});

// ---- Authentification (cookie signé ; le compte admin du hub agit comme Maître) ----
app.use(h(async (req, res, next) => {
  req.membre = null;
  const m = /(?:^|;\s*)dojo\.sid=([^;]+)/.exec(req.headers.cookie || '');
  if (m) {
    const [id, exp, s] = decodeURIComponent(m[1]).split('.');
    if (id && exp && s && Number(exp) > Date.now() && safeEq(s, sig(id + '.' + exp))) {
      const r = await pool.query('SELECT id, username, nom_rp, grade, barriere, statut, bio FROM dojo_membres WHERE id=$1', [Number(id)]);
      if (r.rows[0] && r.rows[0].statut === 'actif') req.membre = r.rows[0];
    }
  }
  if (!req.membre && req.hubAdmin) req.membre = { id: 0, username: 'admin', nom_rp: 'Administrateur', grade: 'maitre', barriere: 4, statut: 'actif', admin: true };
  next();
}));
const need = (n) => (req, res, next) => (!req.membre ? bad(res, 401, 'Connexion requise.') : niv(req.membre) < n ? bad(res, 403, 'Grade insuffisant.') : next());
const membreReel = (req, res, next) => (req.membre.admin ? bad(res, 403, 'Réservé aux membres du dojo.') : next());

const essais = new Map();
const bloque = (ip) => { const e = essais.get(ip); return !!e && e.fin > Date.now() && e.n >= 8; };
const echec = (ip) => { const e = essais.get(ip); if (!e || e.fin < Date.now()) essais.set(ip, { n: 1, fin: Date.now() + 15 * 60 * 1000 }); else e.n++; };

app.post('/api/inscription', h(async (req, res) => {
  const b = req.body || {};
  const username = txt(b.username, 24), nom = txt(b.nom_rp, 40), mdp = String(b.mot_de_passe || '');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return bad(res, 400, "Identifiant : 3 à 24 caractères (lettres, chiffres, _ . -).");
  if (nom.length < 2) return bad(res, 400, 'Nom RP trop court.');
  if (mdp.length < 8 || mdp.length > 100) return bad(res, 400, 'Mot de passe : 8 caractères minimum.');
  try {
    await pool.query('INSERT INTO dojo_membres (username, nom_rp, mdp_hash) VALUES ($1,$2,$3)', [username.toLowerCase(), nom, await bcrypt.hash(mdp, 10)]);
  } catch (e) { return e.code === '23505' ? bad(res, 409, 'Identifiant déjà pris.') : Promise.reject(e); }
  res.json({ ok: true });
}));

app.post('/api/connexion', h(async (req, res) => {
  if (bloque(req.ip)) return bad(res, 429, 'Trop de tentatives. Réessaie dans 15 minutes.');
  const b = req.body || {};
  const r = await pool.query('SELECT * FROM dojo_membres WHERE username=$1', [txt(b.username, 24).toLowerCase()]);
  const m = r.rows[0];
  if (!m || !(await bcrypt.compare(String(b.mot_de_passe || ''), m.mdp_hash))) { echec(req.ip); return bad(res, 401, 'Identifiant ou mot de passe incorrect.'); }
  if (m.statut === 'en_attente') return bad(res, 403, "Ton inscription n'a pas encore été validée par un Co-Maître ou le Maître.");
  if (m.statut === 'refuse') return bad(res, 403, 'Ton inscription a été refusée.');
  await pool.query('UPDATE dojo_membres SET derniere_connexion=now() WHERE id=$1', [m.id]);
  const exp = Date.now() + DUREE;
  res.cookie('dojo.sid', `${m.id}.${exp}.${sig(m.id + '.' + exp)}`, { ...cookieOpts, maxAge: DUREE });
  res.json({ ok: true });
}));
app.post('/api/deconnexion', (req, res) => { res.clearCookie('dojo.sid', cookieOpts); res.json({ ok: true }); });
app.get('/api/moi', h(async (req, res) => {
  let en_attente = 0;
  if (req.membre && niv(req.membre) >= 3) en_attente = (await pool.query("SELECT COUNT(*)::int AS n FROM dojo_membres WHERE statut='en_attente'")).rows[0].n;
  res.json({ membre: req.membre, en_attente });
}));
app.get('/api/reglement', h(async (req, res) => res.json((await pool.query('SELECT contenu FROM dojo_reglement WHERE id=1')).rows[0] || { contenu: '' })));
app.get('/api/barrieres', h(async (req, res) => {
  res.json((await pool.query(`SELECT b.*, (SELECT COUNT(*)::int FROM dojo_membres m WHERE m.statut='actif' AND m.barriere=b.id) AS membres FROM dojo_barrieres b ORDER BY id`)).rows);
}));

// Tout le reste nécessite d'être connecté
app.use('/api', (req, res, next) => (req.membre ? next() : bad(res, 401, 'Connexion requise.')));

app.put('/api/moi', membreReel, h(async (req, res) => {
  const b = req.body || {};
  await pool.query('UPDATE dojo_membres SET bio=$1, nom_rp=COALESCE(NULLIF($2,\'\'),nom_rp) WHERE id=$3', [txt(b.bio, 500), txt(b.nom_rp, 40), req.membre.id]);
  if (b.mot_de_passe) {
    if (String(b.mot_de_passe).length < 8) return bad(res, 400, 'Mot de passe : 8 caractères minimum.');
    await pool.query('UPDATE dojo_membres SET mdp_hash=$1 WHERE id=$2', [await bcrypt.hash(String(b.mot_de_passe), 10), req.membre.id]);
  }
  res.json({ ok: true });
}));

// ---- Barrières ----
app.put('/api/barrieres/:id', need(4), h(async (req, res) => {
  const b = req.body || {};
  await pool.query('UPDATE dojo_barrieres SET nom=$1, description=$2, exigences=$3 WHERE id=$4', [txt(b.nom, 60), txt(b.description, 1500), txt(b.exigences, 1500), Number(req.params.id)]);
  await log(req, 'Modification de la barrière ' + req.params.id); res.json({ ok: true });
}));

// ---- Grimoire des techniques (accès selon la barrière atteinte) ----
app.get('/api/techniques', h(async (req, res) => {
  const rows = (await pool.query('SELECT t.*, COALESCE(m.nom_rp,\'—\') AS auteur FROM dojo_techniques t LEFT JOIN dojo_membres m ON m.id=t.auteur_id ORDER BY t.barriere_requise, t.nom')).rows;
  const staff = niv(req.membre) >= 2;
  res.json(rows.map((t) => (staff || t.barriere_requise <= Math.max(req.membre.barriere, 1) ? t : { id: t.id, nom: t.nom, barriere_requise: t.barriere_requise, danger: t.danger, verrouille: true })));
}));
const techOk = (b) => {
  const t = { nom: txt(b.nom, 80), barriere: Number(b.barriere_requise), danger: b.danger, description: txt(b.description, 3000), composantes: txt(b.composantes, 500) };
  return t.nom && t.barriere >= 1 && t.barriere <= 4 && DANGERS.includes(t.danger) ? t : null;
};
app.post('/api/techniques', need(2), h(async (req, res) => {
  const t = techOk(req.body || {}); if (!t) return bad(res, 400, 'Nom, barrière (1-4) et danger requis.');
  await pool.query('INSERT INTO dojo_techniques (nom, barriere_requise, danger, description, composantes, auteur_id) VALUES ($1,$2,$3,$4,$5,$6)', [t.nom, t.barriere, t.danger, t.description, t.composantes, req.membre.id]);
  await log(req, 'Nouvelle technique : ' + t.nom); res.json({ ok: true });
}));
app.put('/api/techniques/:id', need(2), h(async (req, res) => {
  const t = techOk(req.body || {}); if (!t) return bad(res, 400, 'Nom, barrière (1-4) et danger requis.');
  await pool.query('UPDATE dojo_techniques SET nom=$1, barriere_requise=$2, danger=$3, description=$4, composantes=$5 WHERE id=$6', [t.nom, t.barriere, t.danger, t.description, t.composantes, Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/techniques/:id', need(3), h(async (req, res) => { await pool.query('DELETE FROM dojo_techniques WHERE id=$1', [Number(req.params.id)]); await log(req, 'Technique supprimée #' + req.params.id); res.json({ ok: true }); }));

// ---- Membres ----
app.get('/api/membres', h(async (req, res) => {
  const rows = (await pool.query(`SELECT m.id, m.username, m.nom_rp, m.grade, m.barriere, m.bio, m.cree_le, m.derniere_connexion,
    (SELECT COUNT(*)::int FROM dojo_inscriptions i WHERE i.membre_id=m.id AND i.present IS TRUE) AS presences,
    (SELECT COUNT(*)::int FROM dojo_inscriptions i WHERE i.membre_id=m.id AND i.present IS NOT NULL) AS appels
    FROM dojo_membres m WHERE m.statut='actif'
    ORDER BY CASE m.grade WHEN 'maitre' THEN 4 WHEN 'comaitre' THEN 3 WHEN 'professeur' THEN 2 ELSE 1 END DESC, m.barriere DESC, m.nom_rp`)).rows;
  res.json(niv(req.membre) >= 3 ? rows : rows.map(({ derniere_connexion, ...r }) => r)); // dernière connexion : réservée aux Co-Maîtres et au Maître
}));
app.get('/api/membres/en-attente', need(3), h(async (req, res) => res.json((await pool.query("SELECT id, username, nom_rp, cree_le FROM dojo_membres WHERE statut='en_attente' ORDER BY cree_le")).rows)));
app.post('/api/membres/:id/decision', need(3), h(async (req, res) => {
  const b = req.body || {}, d = b.decision;
  if (!['actif', 'refuse'].includes(d)) return bad(res, 400, 'Décision invalide.');
  let grade = 'adepte', barriere = 0;
  if (d === 'actif') { // comme sur police-suna : le grade et la barrière se choisissent au moment de la validation
    if (b.grade !== undefined) {
      if (!GRADES[b.grade] || (niv(req.membre) < 4 && GRADES[b.grade] > 2)) return bad(res, 403, "Un Co-Maître ne peut accorder que jusqu'au rang de Professeur.");
      grade = b.grade;
    }
    if (b.barriere !== undefined) { const n = Number(b.barriere); if (!(n >= 0 && n <= 4)) return bad(res, 400, 'Barrière invalide.'); barriere = n; }
  }
  const r = await pool.query(`UPDATE dojo_membres SET statut=$1::text, grade=CASE WHEN $1::text='actif' THEN $3::text ELSE grade END,
    barriere=CASE WHEN $1::text='actif' THEN $4::int ELSE barriere END, valide_par=$5, valide_le=now()
    WHERE id=$2 AND statut='en_attente' RETURNING nom_rp`, [d, Number(req.params.id), grade, barriere, req.membre.id]);
  if (!r.rowCount) return bad(res, 404, 'Demande introuvable.');
  await log(req, (d === 'actif' ? `Inscription acceptée : ${r.rows[0].nom_rp} (${grade}, barrière ${barriere})` : 'Inscription refusée : ' + r.rows[0].nom_rp)); res.json({ ok: true });
}));
app.put('/api/membres/:id', need(3), h(async (req, res) => {
  const cible = (await pool.query("SELECT id, grade, nom_rp FROM dojo_membres WHERE id=$1 AND statut='actif'", [Number(req.params.id)])).rows[0];
  if (!cible) return bad(res, 404, 'Membre introuvable.');
  const moi = niv(req.membre), lc = GRADES[cible.grade], b = req.body || {};
  if (moi < 4 && lc >= moi) return bad(res, 403, 'Tu ne peux pas modifier un membre de ton rang ou supérieur.');
  if (b.grade !== undefined) {
    if (!GRADES[b.grade] || (moi < 4 && GRADES[b.grade] > 2)) return bad(res, 403, 'Un Co-Maître ne peut nommer que jusqu\'au rang de Professeur.');
    await pool.query('UPDATE dojo_membres SET grade=$1 WHERE id=$2', [b.grade, cible.id]);
  }
  if (b.barriere !== undefined) {
    const n = Number(b.barriere); if (!(n >= 0 && n <= 4)) return bad(res, 400, 'Barrière invalide.');
    await pool.query('UPDATE dojo_membres SET barriere=$1 WHERE id=$2', [n, cible.id]);
  }
  await log(req, `Modification de ${cible.nom_rp} (grade: ${b.grade ?? '—'}, barrière: ${b.barriere ?? '—'})`); res.json({ ok: true });
}));
app.delete('/api/membres/:id', need(4), h(async (req, res) => {
  if (Number(req.params.id) === req.membre.id) return bad(res, 400, 'Tu ne peux pas te supprimer toi-même.');
  const r = await pool.query('DELETE FROM dojo_membres WHERE id=$1 RETURNING nom_rp', [Number(req.params.id)]);
  if (r.rowCount) { await pool.query('DELETE FROM dojo_inscriptions WHERE membre_id=$1', [Number(req.params.id)]); await log(req, 'Membre supprimé : ' + r.rows[0].nom_rp); }
  res.json({ ok: true });
}));

// ---- Examens de passage de barrière ----
app.get('/api/examens', h(async (req, res) => {
  const staff = niv(req.membre) >= 2;
  const q = `SELECT e.*, m.nom_rp, m.barriere AS actuelle, COALESCE(j.nom_rp,'—') AS juge FROM dojo_examens e JOIN dojo_membres m ON m.id=e.membre_id LEFT JOIN dojo_membres j ON j.id=e.juge_id`;
  res.json(staff ? (await pool.query(q + ' ORDER BY (e.statut=\'en_attente\') DESC, e.cree_le DESC LIMIT 100')).rows
    : (await pool.query(q + ' WHERE e.membre_id=$1 ORDER BY e.cree_le DESC', [req.membre.id])).rows);
}));
app.post('/api/examens', membreReel, h(async (req, res) => {
  const visee = req.membre.barriere + 1;
  if (visee > 4) return bad(res, 400, 'Tu as déjà atteint la Barrière Rouge.');
  if ((await pool.query("SELECT 1 FROM dojo_examens WHERE membre_id=$1 AND statut='en_attente'", [req.membre.id])).rowCount) return bad(res, 409, 'Tu as déjà une demande en attente.');
  await pool.query('INSERT INTO dojo_examens (membre_id, barriere_visee, message) VALUES ($1,$2,$3)', [req.membre.id, visee, txt((req.body || {}).message, 500)]);
  res.json({ ok: true });
}));
app.post('/api/examens/:id/decision', need(2), h(async (req, res) => {
  const b = req.body || {}; if (!['accepte', 'refuse'].includes(b.decision)) return bad(res, 400, 'Décision invalide.');
  const e = (await pool.query("SELECT * FROM dojo_examens WHERE id=$1 AND statut='en_attente'", [Number(req.params.id)])).rows[0];
  if (!e) return bad(res, 404, 'Demande introuvable.');
  if (e.membre_id === req.membre.id) return bad(res, 403, 'Tu ne peux pas juger ta propre demande.');
  if (e.barriere_visee === 4 && niv(req.membre) < 3) return bad(res, 403, 'La Barrière Rouge est validée par un Co-Maître ou le Maître.');
  await pool.query('UPDATE dojo_examens SET statut=$1, commentaire=$2, juge_id=$3, traite_le=now() WHERE id=$4', [b.decision, txt(b.commentaire, 500), req.membre.id, e.id]);
  if (b.decision === 'accepte') await pool.query('UPDATE dojo_membres SET barriere=$1 WHERE id=$2 AND barriere=$3', [e.barriere_visee, e.membre_id, e.barriere_visee - 1]);
  await log(req, `Examen #${e.id} ${b.decision}`); res.json({ ok: true });
}));

// ---- Séances ----
app.get('/api/seances', h(async (req, res) => {
  res.json((await pool.query(`SELECT s.*, COALESCE(p.nom_rp,'—') AS prof_nom,
    (SELECT COUNT(*)::int FROM dojo_inscriptions i WHERE i.seance_id=s.id) AS inscrits,
    EXISTS(SELECT 1 FROM dojo_inscriptions i WHERE i.seance_id=s.id AND i.membre_id=$1) AS inscrit,
    (SELECT present FROM dojo_inscriptions i WHERE i.seance_id=s.id AND i.membre_id=$1) AS present
    FROM dojo_seances s LEFT JOIN dojo_membres p ON p.id=s.prof_id ORDER BY s.date_heure DESC LIMIT 100`, [req.membre.id])).rows);
}));
app.post('/api/seances', need(2), h(async (req, res) => {
  const b = req.body || {}, d = new Date(b.date_heure), t = txt(b.titre, 100);
  if (!t || isNaN(d)) return bad(res, 400, 'Titre et date valides requis.');
  await pool.query('INSERT INTO dojo_seances (titre, description, date_heure, lieu, barriere_min, capacite, prof_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [t, txt(b.description, 1000), d, txt(b.lieu, 100), Math.min(4, Math.max(0, Number(b.barriere_min) || 0)), Math.max(0, Number(b.capacite) || 0), req.membre.id]);
  await log(req, 'Séance créée : ' + t); res.json({ ok: true });
}));
app.delete('/api/seances/:id', need(2), h(async (req, res) => {
  const s = (await pool.query('SELECT prof_id FROM dojo_seances WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (s && s.prof_id !== req.membre.id && niv(req.membre) < 3) return bad(res, 403, 'Seul son organisateur ou un Co-Maître peut la supprimer.');
  await pool.query('DELETE FROM dojo_inscriptions WHERE seance_id=$1', [Number(req.params.id)]);
  await pool.query('DELETE FROM dojo_seances WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true });
}));
app.post('/api/seances/:id/inscription', membreReel, h(async (req, res) => {
  const id = Number(req.params.id);
  const s = (await pool.query('SELECT * FROM dojo_seances WHERE id=$1', [id])).rows[0];
  if (!s) return bad(res, 404, 'Séance introuvable.');
  const deja = (await pool.query('SELECT 1 FROM dojo_inscriptions WHERE seance_id=$1 AND membre_id=$2', [id, req.membre.id])).rowCount;
  if (deja) { await pool.query('DELETE FROM dojo_inscriptions WHERE seance_id=$1 AND membre_id=$2', [id, req.membre.id]); return res.json({ inscrit: false }); }
  if (new Date(s.date_heure) < new Date()) return bad(res, 400, 'Cette séance est passée.');
  if (req.membre.barriere < s.barriere_min) return bad(res, 403, 'Barrière insuffisante pour cette séance.');
  const n = (await pool.query('SELECT COUNT(*)::int AS n FROM dojo_inscriptions WHERE seance_id=$1', [id])).rows[0].n;
  if (s.capacite && n >= s.capacite) return bad(res, 409, 'Séance complète.');
  await pool.query('INSERT INTO dojo_inscriptions (seance_id, membre_id) VALUES ($1,$2)', [id, req.membre.id]); res.json({ inscrit: true });
}));
app.get('/api/seances/:id/inscrits', need(2), h(async (req, res) => {
  res.json((await pool.query('SELECT m.id, m.nom_rp, m.barriere, i.present FROM dojo_inscriptions i JOIN dojo_membres m ON m.id=i.membre_id WHERE i.seance_id=$1 ORDER BY m.nom_rp', [Number(req.params.id)])).rows);
}));
app.post('/api/seances/:id/appel', need(2), h(async (req, res) => {
  const presents = ((req.body || {}).presents || []).map(Number).filter(Number.isInteger);
  await pool.query('UPDATE dojo_inscriptions SET present = (membre_id = ANY($2::int[])) WHERE seance_id=$1', [Number(req.params.id), presents]);
  await log(req, 'Appel effectué pour la séance #' + req.params.id); res.json({ ok: true });
}));

// ---- Annonces ----
app.get('/api/annonces', h(async (req, res) => res.json((await pool.query('SELECT a.*, COALESCE(m.nom_rp,\'Administrateur\') AS auteur FROM dojo_annonces a LEFT JOIN dojo_membres m ON m.id=a.auteur_id ORDER BY a.epinglee DESC, a.cree_le DESC LIMIT 50')).rows)));
app.post('/api/annonces', need(2), h(async (req, res) => {
  const b = req.body || {}, t = txt(b.titre, 120); if (!t) return bad(res, 400, 'Titre requis.');
  await pool.query('INSERT INTO dojo_annonces (titre, contenu, auteur_id, epinglee) VALUES ($1,$2,$3,$4)', [t, txt(b.contenu, 3000), req.membre.id, niv(req.membre) >= 3 && !!b.epinglee]); res.json({ ok: true });
}));
app.delete('/api/annonces/:id', need(2), h(async (req, res) => {
  const a = (await pool.query('SELECT auteur_id FROM dojo_annonces WHERE id=$1', [Number(req.params.id)])).rows[0];
  if (a && a.auteur_id !== req.membre.id && niv(req.membre) < 3) return bad(res, 403, 'Seul l\'auteur ou un Co-Maître peut la supprimer.');
  await pool.query('DELETE FROM dojo_annonces WHERE id=$1', [Number(req.params.id)]); res.json({ ok: true });
}));

// ---- Carnet d'entraînement personnel ----
app.get('/api/carnet', membreReel, h(async (req, res) => res.json((await pool.query('SELECT * FROM dojo_carnet WHERE membre_id=$1 ORDER BY cree_le DESC LIMIT 100', [req.membre.id])).rows)));
app.post('/api/carnet', membreReel, h(async (req, res) => {
  const t = txt((req.body || {}).texte, 2000); if (!t) return bad(res, 400, 'Texte requis.');
  await pool.query('INSERT INTO dojo_carnet (membre_id, texte, barriere) VALUES ($1,$2,$3)', [req.membre.id, t, req.membre.barriere]); res.json({ ok: true });
}));
app.delete('/api/carnet/:id', membreReel, h(async (req, res) => { await pool.query('DELETE FROM dojo_carnet WHERE id=$1 AND membre_id=$2', [Number(req.params.id), req.membre.id]); res.json({ ok: true }); }));

// ---- Règlement, stats, journal ----
app.put('/api/reglement', need(4), h(async (req, res) => { await pool.query('UPDATE dojo_reglement SET contenu=$1 WHERE id=1', [txt((req.body || {}).contenu, 10000)]); await log(req, 'Règlement modifié'); res.json({ ok: true }); }));
app.get('/api/stats', h(async (req, res) => {
  const q = async (s) => (await pool.query(s)).rows;
  res.json({
    grades: await q("SELECT grade, COUNT(*)::int AS n FROM dojo_membres WHERE statut='actif' GROUP BY grade"),
    barrieres: await q("SELECT barriere, COUNT(*)::int AS n FROM dojo_membres WHERE statut='actif' GROUP BY barriere ORDER BY barriere"),
    seances: (await q('SELECT COUNT(*)::int AS n FROM dojo_seances'))[0].n,
    techniques: (await q('SELECT COUNT(*)::int AS n FROM dojo_techniques'))[0].n,
    assidus: await q(`SELECT m.nom_rp, COUNT(*) FILTER (WHERE i.present IS TRUE)::int AS presences, COUNT(*) FILTER (WHERE i.present IS NOT NULL)::int AS appels
      FROM dojo_membres m JOIN dojo_inscriptions i ON i.membre_id=m.id WHERE m.statut='actif' GROUP BY m.id HAVING COUNT(*) FILTER (WHERE i.present IS NOT NULL) > 0
      ORDER BY presences DESC, appels LIMIT 5`),
  });
}));
app.get('/api/activite', need(4), h(async (req, res) => res.json((await pool.query('SELECT * FROM dojo_activite ORDER BY cree_le DESC LIMIT 100')).rows)));

app.use('/api', (req, res) => bad(res, 404, 'Route inconnue.'));
app.use(express.static(path.join(__dirname, 'public')));
app.use((err, req, res, next) => { console.error('[dojo]', err.message); bad(res, 500, 'Erreur serveur.'); });

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS dojo_membres (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, nom_rp TEXT NOT NULL, mdp_hash TEXT NOT NULL,
      grade TEXT NOT NULL DEFAULT 'adepte', barriere INT NOT NULL DEFAULT 0, statut TEXT NOT NULL DEFAULT 'en_attente', bio TEXT DEFAULT '', cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_barrieres (id INT PRIMARY KEY, nom TEXT NOT NULL, couleur TEXT NOT NULL, description TEXT DEFAULT '', exigences TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS dojo_techniques (id SERIAL PRIMARY KEY, nom TEXT NOT NULL, barriere_requise INT NOT NULL, danger TEXT NOT NULL, description TEXT DEFAULT '', composantes TEXT DEFAULT '', auteur_id INT, cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_examens (id SERIAL PRIMARY KEY, membre_id INT NOT NULL, barriere_visee INT NOT NULL, message TEXT DEFAULT '', statut TEXT NOT NULL DEFAULT 'en_attente', commentaire TEXT DEFAULT '', juge_id INT, cree_le TIMESTAMPTZ DEFAULT now(), traite_le TIMESTAMPTZ);
    CREATE TABLE IF NOT EXISTS dojo_seances (id SERIAL PRIMARY KEY, titre TEXT NOT NULL, description TEXT DEFAULT '', date_heure TIMESTAMPTZ NOT NULL, lieu TEXT DEFAULT '', barriere_min INT NOT NULL DEFAULT 0, capacite INT NOT NULL DEFAULT 0, prof_id INT, cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_inscriptions (seance_id INT NOT NULL, membre_id INT NOT NULL, present BOOLEAN, PRIMARY KEY (seance_id, membre_id));
    CREATE TABLE IF NOT EXISTS dojo_annonces (id SERIAL PRIMARY KEY, titre TEXT NOT NULL, contenu TEXT DEFAULT '', auteur_id INT, epinglee BOOLEAN DEFAULT FALSE, cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_carnet (id SERIAL PRIMARY KEY, membre_id INT NOT NULL, texte TEXT NOT NULL, barriere INT DEFAULT 0, cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_activite (id SERIAL PRIMARY KEY, membre_id INT, nom TEXT, action TEXT NOT NULL, cree_le TIMESTAMPTZ DEFAULT now());
    CREATE TABLE IF NOT EXISTS dojo_reglement (id INT PRIMARY KEY, contenu TEXT DEFAULT '');
    ALTER TABLE dojo_membres ADD COLUMN IF NOT EXISTS valide_par INT;
    ALTER TABLE dojo_membres ADD COLUMN IF NOT EXISTS valide_le TIMESTAMPTZ;
    ALTER TABLE dojo_membres ADD COLUMN IF NOT EXISTS derniere_connexion TIMESTAMPTZ;`);
  // Les barrières sont des techniques : la Verte est la plus petite, la Rouge la plus grande.
  // Les textes déjà modifiés par le Maître ne sont jamais écrasés (seuls les anciens textes par défaut sont remplacés).
  await pool.query(`INSERT INTO dojo_barrieres (id, nom, couleur, description, exigences) VALUES
    (1,'Barrière Verte','#4f9d4f','La plus petite des barrières. Une technique de scellement simple qui protège une zone réduite et résiste aux attaques légères. C''est la première technique que tout adepte apprend.','Tracer la barrière sans erreur et la maintenir devant un Professeur.'),
    (2,'Barrière Bleue','#3f7fd0','Une barrière plus étendue et plus résistante que la Verte. Elle demande un contrôle de chakra soutenu pour être maintenue.','Maîtriser la Barrière Verte et soutenir la Bleue durablement.'),
    (3,'Barrière Violette','#8a52c8','Une barrière puissante, capable de repousser ou d''enfermer des techniques de haut niveau. Sa maîtrise exige une précision parfaite.','Maîtriser la Barrière Bleue et démontrer sa précision sous pression.'),
    (4,'Barrière Rouge','#c23b3b','La plus grande des barrières, sommet du fuinjutsu du dojo. Sa puissance et son coût en chakra sont immenses : seuls les plus accomplis y accèdent.','Maîtriser la Barrière Violette et obtenir l''accord d''un Co-Maître ou du Maître.')
    ON CONFLICT (id) DO UPDATE SET description=EXCLUDED.description, exigences=EXCLUDED.exigences
    WHERE dojo_barrieres.description LIKE ANY (ARRAY['Premier cercle%','Deuxième cercle%','Troisième cercle%','Sommet de l%'])`);
  await pool.query("INSERT INTO dojo_reglement (id, contenu) VALUES (1, 'Respect du Maître et de ses élèves.\nAucune technique de scellement ne s''utilise hors du dojo sans autorisation.\nChaque passage de barrière se fait sur examen.') ON CONFLICT (id) DO NOTHING");
}

module.exports = { app, init };
