const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/roles-judiciaires — public aux comptes connectés (formulaires, annuaire, admin-comptes)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM roles_judiciaires ORDER BY niveau DESC');
    res.json({ roles: rows });
  } catch (err) {
    console.error('[roles-judiciaires/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/roles-judiciaires — créer un rôle judiciaire (Avocat, Procureur, Juge, Greffier...)
router.post('/', requireAuth, requirePermission('peut_gerer_judiciaire'), async (req, res) => {
  try {
    const { nom, niveau, couleur } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du rôle est requis.' });
    const { rows } = await pool.query(
      'INSERT INTO roles_judiciaires (nom, niveau, couleur) VALUES ($1,$2,$3) RETURNING *',
      [nom, niveau ?? 0, couleur || '#3E5C6B']
    );
    res.status(201).json({ role: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rôle judiciaire avec ce nom existe déjà.' });
    console.error('[roles-judiciaires/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/roles-judiciaires/:id — modifier (le nom se répercute automatiquement partout où il est affiché)
router.put('/:id', requireAuth, requirePermission('peut_gerer_judiciaire'), async (req, res) => {
  try {
    const { nom, niveau, couleur } = req.body;
    const { rows } = await pool.query(
      'UPDATE roles_judiciaires SET nom=$1, niveau=$2, couleur=$3 WHERE id=$4 RETURNING *',
      [nom, niveau ?? 0, couleur || '#3E5C6B', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Rôle judiciaire introuvable.' });
    res.json({ role: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un rôle judiciaire avec ce nom existe déjà.' });
    console.error('[roles-judiciaires/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/roles-judiciaires/:id — les membres qui l'avaient repassent "sans rôle"
router.delete('/:id', requireAuth, requirePermission('peut_gerer_judiciaire'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM roles_judiciaires WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Rôle judiciaire introuvable.' });
    res.json({ message: `Rôle judiciaire "${rows[0].nom}" supprimé.` });
  } catch (err) {
    console.error('[roles-judiciaires/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
