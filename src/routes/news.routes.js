const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/actus — public, pour la page d'accueil
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const { rows } = await pool.query(
      `SELECT a.*, u.username AS auteur_username
       FROM actus a LEFT JOIN users u ON u.id = a.auteur_id
       ORDER BY a.epingle DESC, a.created_at DESC LIMIT $1`,
      [limit]
    );
    res.json({ actus: rows });
  } catch (err) {
    console.error('[actus/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/actus — publier
router.post('/', requireAuth, requirePermission('peut_gerer_actus'), async (req, res) => {
  try {
    const { titre, contenu, epingle } = req.body;
    if (!titre || !contenu) return res.status(400).json({ error: 'Titre et contenu requis.' });
    const { rows } = await pool.query(
      `INSERT INTO actus (titre, contenu, auteur_id, epingle) VALUES ($1,$2,$3,$4) RETURNING *`,
      [titre, contenu, req.session.user.id, !!epingle]
    );
    res.status(201).json({ actu: rows[0] });
  } catch (err) {
    console.error('[actus/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/actus/:id
router.put('/:id', requireAuth, requirePermission('peut_gerer_actus'), async (req, res) => {
  try {
    const { titre, contenu, epingle } = req.body;
    const { rows } = await pool.query(
      `UPDATE actus SET titre=$1, contenu=$2, epingle=$3 WHERE id=$4 RETURNING *`,
      [titre, contenu, !!epingle, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Actualité introuvable.' });
    res.json({ actu: rows[0] });
  } catch (err) {
    console.error('[actus/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/actus/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_actus'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM actus WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Actualité introuvable.' });
    res.json({ message: `Actualité "${rows[0].titre}" supprimée.` });
  } catch (err) {
    console.error('[actus/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
