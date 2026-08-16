const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/recidives — public (référence légale)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM recidives ORDER BY ordre');
    res.json({ recidives: rows });
  } catch (err) {
    console.error('[recidives/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

function toNumOrNull(v) {
  if (v === '' || v === undefined || v === null) return null;
  return v;
}

// POST /api/recidives
router.post('/', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { occurrence, ordre, amende_multiplicateur, cellule_multiplicateur, blame_niveau, description_speciale } = req.body;
    if (!occurrence) return res.status(400).json({ error: "L'occurrence est requise (ex : \"1ère\")." });
    const { rows } = await pool.query(
      `INSERT INTO recidives (occurrence, ordre, amende_multiplicateur, cellule_multiplicateur, blame_niveau, description_speciale)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [occurrence, ordre || 0, toNumOrNull(amende_multiplicateur), toNumOrNull(cellule_multiplicateur), toNumOrNull(blame_niveau), description_speciale || '']
    );
    res.status(201).json({ recidive: rows[0] });
  } catch (err) {
    console.error('[recidives/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/recidives/:id
router.put('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { occurrence, ordre, amende_multiplicateur, cellule_multiplicateur, blame_niveau, description_speciale } = req.body;
    const { rows } = await pool.query(
      `UPDATE recidives SET occurrence=$1, ordre=$2, amende_multiplicateur=$3, cellule_multiplicateur=$4, blame_niveau=$5, description_speciale=$6
       WHERE id=$7 RETURNING *`,
      [occurrence, ordre || 0, toNumOrNull(amende_multiplicateur), toNumOrNull(cellule_multiplicateur), toNumOrNull(blame_niveau), description_speciale || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Palier de récidive introuvable.' });
    res.json({ recidive: rows[0] });
  } catch (err) {
    console.error('[recidives/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/recidives/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM recidives WHERE id = $1 RETURNING occurrence', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Palier de récidive introuvable.' });
    res.json({ message: `Palier "${rows[0].occurrence}" supprimé.` });
  } catch (err) {
    console.error('[recidives/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
