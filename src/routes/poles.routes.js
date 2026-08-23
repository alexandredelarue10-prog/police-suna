const express = require('express');
const pool = require('../config/db');

const router = express.Router();

// GET /api/poles — public (liste pour affichage/formulaires)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM poles ORDER BY nom');
    res.json({ poles: rows });
  } catch (err) {
    console.error('[poles/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
