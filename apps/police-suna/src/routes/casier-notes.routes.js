const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/casiers/:id/notes
router.get('/:id/notes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.*, u.username AS auteur_username FROM casier_notes n
       LEFT JOIN users u ON u.id = n.auteur_id
       WHERE n.casier_id = $1 ORDER BY n.created_at DESC`,
      [req.params.id]
    );
    res.json({ notes: rows });
  } catch (err) {
    console.error('[casier-notes/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/casiers/:id/notes
router.post('/:id/notes', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { contenu } = req.body;
    if (!contenu || !contenu.trim()) return res.status(400).json({ error: 'Le contenu de la note est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO casier_notes (casier_id, auteur_id, contenu) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.session.user.id, contenu.trim()]
    );
    res.status(201).json({ note: rows[0] });
  } catch (err) {
    console.error('[casier-notes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/casiers/notes/:noteId
router.delete('/notes/:noteId', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM casier_notes WHERE id = $1 RETURNING id', [req.params.noteId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Note introuvable.' });
    res.json({ message: 'Note supprimée.' });
  } catch (err) {
    console.error('[casier-notes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
