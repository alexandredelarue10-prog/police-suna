const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/rangs — public (organigramme, formulaires)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM rangs_ninja ORDER BY niveau DESC');
    res.json({ rangs: rows });
  } catch (err) {
    console.error('[rangs/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/rangs — créer un rang (même permission que la gestion des grades : structure hiérarchique)
router.post('/', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { nom, niveau, couleur } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du rang est requis.' });
    const { rows } = await pool.query(
      'INSERT INTO rangs_ninja (nom, niveau, couleur) VALUES ($1,$2,$3) RETURNING *',
      [nom, niveau ?? 0, couleur || '#3E5C6B']
    );
    res.status(201).json({ rang: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rang avec ce nom existe déjà.' });
    console.error('[rangs/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/rangs/:id — modifier (le nom se répercute automatiquement partout où le rang est affiché)
router.put('/:id', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { nom, niveau, couleur } = req.body;
    const { rows } = await pool.query(
      'UPDATE rangs_ninja SET nom=$1, niveau=$2, couleur=$3 WHERE id=$4 RETURNING *',
      [nom, niveau ?? 0, couleur || '#3E5C6B', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rang introuvable.' });
    res.json({ rang: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rang avec ce nom existe déjà.' });
    console.error('[rangs/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/rangs/:id — les membres qui l'avaient repassent "sans rang"
router.delete('/:id', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM rangs_ninja WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Rang introuvable.' });
    res.json({ message: `Rang "${rows[0].nom}" supprimé.` });
  } catch (err) {
    console.error('[rangs/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
