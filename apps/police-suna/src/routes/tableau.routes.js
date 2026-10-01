const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireDev } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes de ce fichier sont réservées au compte DEV.
router.use(requireAuth, requireDev);

// GET /api/tableau — notes + connexions
router.get('/', async (req, res) => {
  try {
    const { rows: notes } = await pool.query('SELECT * FROM tableau_notes ORDER BY id');
    const { rows: connexions } = await pool.query('SELECT * FROM tableau_connexions ORDER BY id');
    res.json({ notes, connexions });
  } catch (err) {
    console.error('[tableau/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/tableau/notes — créer une note
router.post('/notes', async (req, res) => {
  try {
    const { titre, contenu, pos_x, pos_y, couleur } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO tableau_notes (titre, contenu, pos_x, pos_y, couleur) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [titre || '', contenu || '', pos_x ?? 100, pos_y ?? 100, couleur || '#EFE3C6']
    );
    res.status(201).json({ note: rows[0] });
  } catch (err) {
    console.error('[tableau/notes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/tableau/notes/:id — modifier (contenu, position, couleur...)
router.put('/notes/:id', async (req, res) => {
  try {
    const { titre, contenu, pos_x, pos_y, couleur } = req.body;
    const { rows } = await pool.query(
      `UPDATE tableau_notes SET titre=$1, contenu=$2, pos_x=$3, pos_y=$4, couleur=$5, updated_at=now()
       WHERE id=$6 RETURNING *`,
      [titre || '', contenu || '', pos_x ?? 100, pos_y ?? 100, couleur || '#EFE3C6', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Note introuvable.' });
    res.json({ note: rows[0] });
  } catch (err) {
    console.error('[tableau/notes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/tableau/notes/:id — les connexions liées partent avec (ON DELETE CASCADE)
router.delete('/notes/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM tableau_notes WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Note introuvable.' });
    res.json({ message: 'Note supprimée.' });
  } catch (err) {
    console.error('[tableau/notes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/tableau/connexions — relier deux notes
router.post('/connexions', async (req, res) => {
  try {
    const { note_a_id, note_b_id, label } = req.body;
    if (!note_a_id || !note_b_id || note_a_id === note_b_id) {
      return res.status(400).json({ error: 'Deux notes différentes sont requises.' });
    }
    const { rows } = await pool.query(
      `INSERT INTO tableau_connexions (note_a_id, note_b_id, label) VALUES ($1,$2,$3) RETURNING *`,
      [note_a_id, note_b_id, label || '']
    );
    res.status(201).json({ connexion: rows[0] });
  } catch (err) {
    console.error('[tableau/connexions/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/tableau/connexions/:id
router.delete('/connexions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM tableau_connexions WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Connexion introuvable.' });
    res.json({ message: 'Connexion supprimée.' });
  } catch (err) {
    console.error('[tableau/connexions/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
