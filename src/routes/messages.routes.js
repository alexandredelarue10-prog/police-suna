const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { notifierUser } = require('../utils/discordNotifier');

const router = express.Router();

router.get('/recus', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.username AS expediteur_username, u.nom_complet AS expediteur_nom FROM messages m
       LEFT JOIN users u ON u.id = m.expediteur_id
       WHERE m.destinataire_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
      [req.session.user.id]
    );
    res.json({ messages: rows });
  } catch (err) {
    console.error('[messages/recus]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/envoyes', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.*, u.username AS destinataire_username, u.nom_complet AS destinataire_nom FROM messages m
       LEFT JOIN users u ON u.id = m.destinataire_id
       WHERE m.expediteur_id = $1 ORDER BY m.created_at DESC LIMIT 100`,
      [req.session.user.id]
    );
    res.json({ messages: rows });
  } catch (err) {
    console.error('[messages/envoyes]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM messages WHERE destinataire_id = $1 AND lu = FALSE',
      [req.session.user.id]
    );
    res.json({ count: rows[0].n });
  } catch (err) {
    console.error('[messages/unread-count]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { destinataire_id, contenu } = req.body;
    if (!destinataire_id || !contenu || !contenu.trim()) {
      return res.status(400).json({ error: 'Destinataire et contenu sont requis.' });
    }
    if (Number(destinataire_id) === req.session.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer un message à vous-même.' });
    }
    const { rows } = await pool.query(
      'INSERT INTO messages (expediteur_id, destinataire_id, contenu) VALUES ($1,$2,$3) RETURNING *',
      [req.session.user.id, destinataire_id, contenu.trim()]
    );

    const apercu = contenu.trim().slice(0, 200);
    notifierUser(
      destinataire_id,
      `📨 Nouveau message interne de ${req.session.user.nom_complet || req.session.user.username} : "${apercu}${contenu.trim().length > 200 ? '…' : ''}"`
    ).catch((err) => console.error('[discord] notif message_interne', err.message));

    res.status(201).json({ message: rows[0] });
  } catch (err) {
    console.error('[messages/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/:id/lu', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE messages SET lu = TRUE WHERE id = $1 AND destinataire_id = $2 RETURNING *',
      [req.params.id, req.session.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Message introuvable.' });
    res.json({ message: rows[0] });
  } catch (err) {
    console.error('[messages/lu]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM messages WHERE id = $1 AND (destinataire_id = $2 OR expediteur_id = $2) RETURNING id',
      [req.params.id, req.session.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Message introuvable.' });
    res.json({ message: 'Message supprimé.' });
  } catch (err) {
    console.error('[messages/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
