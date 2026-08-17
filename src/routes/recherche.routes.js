const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/recherche?q=... — recherche transversale (réservée aux connectés, données sensibles)
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ casiers: [], sanctions: [], membres: [] });
    const like = `%${q}%`;

    const [{ rows: casiers }, { rows: sanctions }, { rows: membres }] = await Promise.all([
      pool.query(
        `SELECT id, nom, prenom, surnom, statut FROM casiers
         WHERE nom ILIKE $1 OR prenom ILIKE $1 OR surnom ILIKE $1 LIMIT 8`,
        [like]
      ),
      pool.query(
        `SELECT id, article, nom, code_juridique FROM sanctions_types
         WHERE nom ILIKE $1 OR article ILIKE $1 LIMIT 8`,
        [like]
      ),
      pool.query(
        `SELECT u.id, u.username, u.nom_complet, g.nom AS grade_nom FROM users u
         LEFT JOIN grades g ON g.id = u.grade_id
         WHERE u.statut = 'approuve' AND (u.username ILIKE $1 OR u.nom_complet ILIKE $1) LIMIT 8`,
        [like]
      ),
    ]);

    res.json({ casiers, sanctions, membres });
  } catch (err) {
    console.error('[recherche]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
