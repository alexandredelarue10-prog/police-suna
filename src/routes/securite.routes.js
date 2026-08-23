const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

router.get('/incidents', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT i.*, u.username AS agent_username FROM incidents_securite i
       LEFT JOIN users u ON u.id = i.agent_id
       ORDER BY i.date_incident DESC NULLS LAST, i.created_at DESC`
    );
    res.json({ incidents: rows });
  } catch (err) {
    console.error('[securite/incidents/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/incidents', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { titre, description, niveau_gravite, lieu, date_incident } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO incidents_securite (titre, description, niveau_gravite, lieu, date_incident, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titre, description || '', niveau_gravite || 1, lieu || '', date_incident || null, req.session.user.id]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'incident_signale', titre);

    res.status(201).json({ incident: rows[0] });
  } catch (err) {
    console.error('[securite/incidents/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/incidents/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { titre, description, niveau_gravite, lieu, date_incident } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `UPDATE incidents_securite SET titre=$1, description=$2, niveau_gravite=$3, lieu=$4, date_incident=$5
       WHERE id=$6 RETURNING *`,
      [titre, description || '', niveau_gravite || 1, lieu || '', date_incident || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Incident introuvable.' });
    res.json({ incident: rows[0] });
  } catch (err) {
    console.error('[securite/incidents/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/incidents/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM incidents_securite WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Incident introuvable.' });
    res.json({ message: `Incident "${rows[0].titre}" supprimé.` });
  } catch (err) {
    console.error('[securite/incidents/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
