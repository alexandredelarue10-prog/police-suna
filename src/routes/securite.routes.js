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

// --- Registre des entrées/sorties du village ---
router.get('/entrees-sorties', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT es.*, u.username AS agent_username FROM entrees_sorties es
       LEFT JOIN users u ON u.id = es.agent_id
       ORDER BY es.date_passage DESC LIMIT 200`
    );
    res.json({ mouvements: rows });
  } catch (err) {
    console.error('[securite/entrees-sorties/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/entrees-sorties', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { nom_personne, type, motif, date_passage } = req.body;
    if (!nom_personne) return res.status(400).json({ error: 'Le nom de la personne est requis.' });
    const { rows } = await pool.query(
      `INSERT INTO entrees_sorties (nom_personne, type, motif, date_passage, agent_id)
       VALUES ($1,$2,$3,COALESCE($4, now()),$5) RETURNING *`,
      [nom_personne, type === 'sortie' ? 'sortie' : 'entree', motif || '', date_passage || null, req.session.user.id]
    );
    res.status(201).json({ mouvement: rows[0] });
  } catch (err) {
    console.error('[securite/entrees-sorties/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/entrees-sorties/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM entrees_sorties WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Mouvement introuvable.' });
    res.json({ message: 'Mouvement supprimé.' });
  } catch (err) {
    console.error('[securite/entrees-sorties/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Escortes diplomatiques ---
router.get('/escortes', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*,
              COALESCE(
                (SELECT json_agg(json_build_object('id', u.id, 'nom', COALESCE(u.nom_complet, u.username)))
                 FROM escorte_agents ea JOIN users u ON u.id = ea.user_id WHERE ea.escorte_id = e.id),
                '[]'
              ) AS agents
       FROM escortes e ORDER BY e.date_debut DESC NULLS LAST, e.created_at DESC`
    );
    res.json({ escortes: rows });
  } catch (err) {
    console.error('[securite/escortes/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/escortes', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { titre, destination, personnalite, date_debut, date_fin, statut, notes, agent_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });
    const { rows } = await pool.query(
      `INSERT INTO escortes (titre, destination, personnalite, date_debut, date_fin, statut, notes, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [titre, destination || '', personnalite || '', date_debut || null, date_fin || null, statut || 'planifiee', notes || '', req.session.user.id]
    );
    if (Array.isArray(agent_ids)) {
      for (const uid of agent_ids) {
        await pool.query('INSERT INTO escorte_agents (escorte_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
      }
    }

    await logActivity(req.session.user.id, req.session.user.username, 'escorte_creee', titre);

    res.status(201).json({ escorte: rows[0] });
  } catch (err) {
    console.error('[securite/escortes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/escortes/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { titre, destination, personnalite, date_debut, date_fin, statut, notes, agent_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });
    const { rows } = await pool.query(
      `UPDATE escortes SET titre=$1, destination=$2, personnalite=$3, date_debut=$4, date_fin=$5, statut=$6, notes=$7
       WHERE id=$8 RETURNING *`,
      [titre, destination || '', personnalite || '', date_debut || null, date_fin || null, statut || 'planifiee', notes || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Escorte introuvable.' });

    if (Array.isArray(agent_ids)) {
      await pool.query('DELETE FROM escorte_agents WHERE escorte_id = $1', [req.params.id]);
      for (const uid of agent_ids) {
        await pool.query('INSERT INTO escorte_agents (escorte_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
      }
    }
    res.json({ escorte: rows[0] });
  } catch (err) {
    console.error('[securite/escortes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/escortes/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM escortes WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Escorte introuvable.' });
    res.json({ message: `Escorte "${rows[0].titre}" supprimée.` });
  } catch (err) {
    console.error('[securite/escortes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Niveaux de sécurité par zone ---
router.get('/zones', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM zones_securite ORDER BY nom');
    res.json({ zones: rows });
  } catch (err) {
    console.error('[securite/zones/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/zones', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { nom, niveau, description } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom de la zone est requis.' });
    const { rows } = await pool.query(
      'INSERT INTO zones_securite (nom, niveau, description) VALUES ($1,$2,$3) RETURNING *',
      [nom, niveau || 1, description || '']
    );
    res.status(201).json({ zone: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une zone avec ce nom existe déjà.' });
    console.error('[securite/zones/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/zones/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { nom, niveau, description } = req.body;
    const { rows } = await pool.query(
      'UPDATE zones_securite SET nom=$1, niveau=$2, description=$3, updated_at=now() WHERE id=$4 RETURNING *',
      [nom, niveau || 1, description || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Zone introuvable.' });
    res.json({ zone: rows[0] });
  } catch (err) {
    console.error('[securite/zones/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/zones/:id', requireAuth, requirePole('Sécurité'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM zones_securite WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Zone introuvable.' });
    res.json({ message: `Zone "${rows[0].nom}" supprimée.` });
  } catch (err) {
    console.error('[securite/zones/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
