const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const router = express.Router();

// Recharge les infos utilisateur + permissions du grade en session
async function buildSessionUser(userRow) {
  let permissions = {
    peut_valider_comptes: false,
    peut_gerer_grades: false,
    peut_gerer_sanctions: false,
    peut_gerer_casiers: false,
    peut_gerer_actus: false,
    peut_gerer_protocoles: false,
  };
  let gradeNom = null;
  let gradeCouleur = null;
  let gradeNiveau = 0;
  let gradeReserve = false;
  let rangNom = null;
  let rangCouleur = null;

  if (userRow.grade_id) {
    const { rows } = await pool.query('SELECT * FROM grades WHERE id = $1', [userRow.grade_id]);
    if (rows[0]) {
      const g = rows[0];
      gradeNom = g.nom;
      gradeCouleur = g.couleur;
      gradeNiveau = g.niveau;
      gradeReserve = g.reserve;
      permissions = {
        peut_valider_comptes: g.peut_valider_comptes,
        peut_gerer_grades: g.peut_gerer_grades,
        peut_gerer_sanctions: g.peut_gerer_sanctions,
        peut_gerer_casiers: g.peut_gerer_casiers,
        peut_gerer_actus: g.peut_gerer_actus,
        peut_gerer_protocoles: g.peut_gerer_protocoles,
      };
    }
  }

  if (userRow.rang_id) {
    const { rows } = await pool.query('SELECT nom, couleur FROM rangs_ninja WHERE id = $1', [userRow.rang_id]);
    if (rows[0]) {
      rangNom = rows[0].nom;
      rangCouleur = rows[0].couleur;
    }
  }

  return {
    id: userRow.id,
    username: userRow.username,
    nom_complet: userRow.nom_complet,
    matricule: userRow.matricule,
    rang_id: userRow.rang_id,
    rang_nom: rangNom,
    rang_couleur: rangCouleur,
    brigade: userRow.brigade,
    protege: userRow.protege,
    grade_id: userRow.grade_id,
    grade_nom: gradeNom,
    grade_couleur: gradeCouleur,
    grade_niveau: gradeNiveau,
    grade_reserve: gradeReserve,
    permissions,
  };
}

// POST /api/auth/register — demande de création de compte (statut "en_attente")
router.post('/register', async (req, res) => {
  try {
    const { username, password, nom_complet } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Nom d\'utilisateur et mot de passe requis.' });
    }
    if (username.length < 3 || username.length > 40) {
      return res.status(400).json({ error: 'Le nom d\'utilisateur doit faire entre 3 et 40 caractères.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Ce nom d\'utilisateur est déjà pris.' });
    }

    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, nom_complet, statut) VALUES ($1,$2,$3,'en_attente')`,
      [username, hash, nom_complet || null]
    );

    res.status(201).json({ message: 'Demande envoyée. Un haut gradé doit valider votre compte avant que vous puissiez vous connecter.' });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Identifiants requis.' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    if (user.statut === 'en_attente') {
      return res.status(403).json({ error: 'Votre compte est en attente de validation par un haut gradé.' });
    }
    if (user.statut === 'refuse') {
      return res.status(403).json({ error: 'Votre demande de compte a été refusée.' });
    }

    const sessionUser = await buildSessionUser(user);
    req.session.user = sessionUser;
    res.json({ user: sessionUser });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'Déconnecté.' });
  });
});

// GET /api/auth/me — session actuelle
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  res.json({ user: req.session.user });
});

module.exports = { router, buildSessionUser };
