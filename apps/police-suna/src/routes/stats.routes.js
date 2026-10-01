const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/stats — vue d'ensemble pour tout utilisateur connecté
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows: parCategorie } = await pool.query(
      `SELECT COALESCE(st.categorie, 'Sanction libre') AS categorie, COUNT(*)::int AS total
       FROM casier_infractions ci LEFT JOIN sanctions_types st ON st.id = ci.sanction_id
       GROUP BY categorie ORDER BY total DESC`
    );
    const { rows: parMois } = await pool.query(
      `SELECT to_char(date_trunc('month', date_infraction), 'YYYY-MM') AS mois, COUNT(*)::int AS total
       FROM casier_infractions
       WHERE date_infraction >= CURRENT_DATE - INTERVAL '6 months'
       GROUP BY mois ORDER BY mois`
    );
    const { rows: totaux } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM casiers) AS total_casiers,
        (SELECT COUNT(*)::int FROM casiers WHERE statut = 'recherche') AS total_recherches,
        (SELECT COUNT(*)::int FROM casier_infractions) AS total_infractions,
        (SELECT COUNT(*)::int FROM users WHERE statut = 'approuve') AS total_agents
    `);

    res.json({ parCategorie, parMois, totaux: totaux[0] });
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
