const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/blames — public (référence légale)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM blames ORDER BY niveau');
    res.json({ blames: rows });
  } catch (err) {
    console.error('[blames/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/blames
router.post('/', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { niveau, description } = req.body;
    if (!niveau) return res.status(400).json({ error: 'Le niveau est requis.' });
    const { rows } = await pool.query(
      'INSERT INTO blames (niveau, description) VALUES ($1,$2) RETURNING *',
      [niveau, description || '']
    );
    res.status(201).json({ blame: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ce niveau de blâme existe déjà.' });
    console.error('[blames/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/blames/:id
router.put('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { niveau, description } = req.body;
    const { rows } = await pool.query(
      'UPDATE blames SET niveau=$1, description=$2 WHERE id=$3 RETURNING *',
      [niveau, description || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Blâme introuvable.' });
    res.json({ blame: rows[0] });
  } catch (err) {
    console.error('[blames/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/blames/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM blames WHERE id = $1 RETURNING niveau', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Blâme introuvable.' });
    res.json({ message: `Blâme niveau ${rows[0].niveau} supprimé.` });
  } catch (err) {
    console.error('[blames/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
