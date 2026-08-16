const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/alertes — public
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM codes_alerte ORDER BY ordre');
    res.json({ alertes: rows });
  } catch (err) {
    console.error('[alertes/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

const fields = [
  'nom', 'couleur', 'ordre', 'description_courte',
  'declenchement_situation', 'declenchement_infos', 'declenchement_autorisation',
  'mobilisation_alerte', 'mobilisation_effectif', 'mobilisation_zones', 'actions',
];

// POST /api/alertes
router.post('/', requireAuth, requirePermission('peut_gerer_protocoles'), async (req, res) => {
  try {
    const { nom } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du code (ex : Bleu) est requis.' });
    const values = fields.map((f) => (req.body[f] !== undefined ? req.body[f] : (f === 'ordre' ? 0 : '')));
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `INSERT INTO codes_alerte (${fields.join(',')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    res.status(201).json({ alerte: rows[0] });
  } catch (err) {
    console.error('[alertes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/alertes/:id
router.put('/:id', requireAuth, requirePermission('peut_gerer_protocoles'), async (req, res) => {
  try {
    const values = fields.map((f) => (req.body[f] !== undefined ? req.body[f] : (f === 'ordre' ? 0 : '')));
    const setClause = fields.map((f, i) => `${f}=$${i + 1}`).join(',');
    const { rows } = await pool.query(
      `UPDATE codes_alerte SET ${setClause} WHERE id=$${fields.length + 1} RETURNING *`,
      [...values, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Code d\'alerte introuvable.' });
    res.json({ alerte: rows[0] });
  } catch (err) {
    console.error('[alertes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/alertes/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_protocoles'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM codes_alerte WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Code d\'alerte introuvable.' });
    res.json({ message: `Code "${rows[0].nom}" supprimé.` });
  } catch (err) {
    console.error('[alertes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
