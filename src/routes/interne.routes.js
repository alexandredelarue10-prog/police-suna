const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// --- Annonces internes (distinctes des communiqués publics de l'accueil) ---
router.get('/annonces', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, u.username AS auteur_username FROM annonces_internes a
       LEFT JOIN users u ON u.id = a.auteur_id ORDER BY a.created_at DESC LIMIT 30`
    );
    res.json({ annonces: rows });
  } catch (err) {
    console.error('[interne/annonces/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/annonces', requireAuth, requirePermission('peut_gerer_actus'), async (req, res) => {
  try {
    const { titre, contenu } = req.body;
    if (!titre || !contenu) return res.status(400).json({ error: 'Titre et contenu requis.' });
    const { rows } = await pool.query(
      'INSERT INTO annonces_internes (titre, contenu, auteur_id) VALUES ($1,$2,$3) RETURNING *',
      [titre, contenu, req.session.user.id]
    );
    res.status(201).json({ annonce: rows[0] });
  } catch (err) {
    console.error('[interne/annonces/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/annonces/:id', requireAuth, requirePermission('peut_gerer_actus'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM annonces_internes WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Annonce introuvable.' });
    res.json({ message: 'Annonce supprimée.' });
  } catch (err) {
    console.error('[interne/annonces/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Annuaire des habitants ---
router.get('/habitants', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const { rows } = await pool.query(
      q
        ? 'SELECT * FROM habitants WHERE nom ILIKE $1 OR prenom ILIKE $1 ORDER BY nom LIMIT 100'
        : 'SELECT * FROM habitants ORDER BY nom LIMIT 100',
      q ? [`%${q}%`] : []
    );
    res.json({ habitants: rows });
  } catch (err) {
    console.error('[interne/habitants/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/habitants', requireAuth, async (req, res) => {
  try {
    const { nom, prenom, village, profession, description } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });
    const { rows } = await pool.query(
      `INSERT INTO habitants (nom, prenom, village, profession, description, cree_par) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [nom, prenom || '', village || '', profession || '', description || '', req.session.user.id]
    );
    res.status(201).json({ habitant: rows[0] });
  } catch (err) {
    console.error('[interne/habitants/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/habitants/:id', requireAuth, async (req, res) => {
  try {
    const { nom, prenom, village, profession, description } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });
    const { rows } = await pool.query(
      `UPDATE habitants SET nom=$1, prenom=$2, village=$3, profession=$4, description=$5 WHERE id=$6 RETURNING *`,
      [nom, prenom || '', village || '', profession || '', description || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Habitant introuvable.' });
    res.json({ habitant: rows[0] });
  } catch (err) {
    console.error('[interne/habitants/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/habitants/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM habitants WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Habitant introuvable.' });
    res.json({ message: 'Habitant supprimé.' });
  } catch (err) {
    console.error('[interne/habitants/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
