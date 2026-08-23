const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/administratif/rapport-amendes?date_debut=YYYY-MM-DD&date_fin=YYYY-MM-DD
// Qui a amendé combien, entre deux dates. Réservé au pôle Administratif.
router.get('/rapport-amendes', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const dateDebut = req.query.date_debut || '1970-01-01';
    const dateFin = req.query.date_fin || '2999-12-31';

    const { rows } = await pool.query(
      `SELECT u.id AS agent_id, COALESCE(u.nom_complet, u.username) AS agent_nom,
              COUNT(ci.id)::int AS nb_amendes,
              COALESCE(SUM(ci.amende_appliquee), 0)::int AS total_amendes
       FROM casier_infractions ci
       JOIN users u ON u.id = ci.agent_id
       WHERE ci.date_infraction BETWEEN $1 AND $2 AND ci.amende_appliquee IS NOT NULL
       GROUP BY u.id, agent_nom
       ORDER BY total_amendes DESC`,
      [dateDebut, dateFin]
    );

    const totalGeneral = rows.reduce((sum, r) => sum + r.total_amendes, 0);

    res.json({ rapport: rows, total_general: totalGeneral, date_debut: dateDebut, date_fin: dateFin });
  } catch (err) {
    console.error('[administratif/rapport-amendes]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/administratif/formations — liste (visible à tout membre du pôle)
router.get('/formations', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.username AS formateur_username,
              COALESCE(
                (SELECT json_agg(json_build_object('id', p.id, 'nom', COALESCE(p.nom_complet, p.username)))
                 FROM formation_participants fp JOIN users p ON p.id = fp.user_id WHERE fp.formation_id = f.id),
                '[]'
              ) AS participants
       FROM formations f
       LEFT JOIN users u ON u.id = f.formateur_id
       ORDER BY f.date_formation DESC NULLS LAST, f.created_at DESC`
    );
    res.json({ formations: rows });
  } catch (err) {
    console.error('[administratif/formations/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/administratif/formations — créer une formation
router.post('/formations', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { titre, description, date_formation, formateur_id, statut, participant_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO formations (titre, description, date_formation, formateur_id, statut, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titre, description || '', date_formation || null, formateur_id || null, statut || 'planifiee', req.session.user.id]
    );

    if (Array.isArray(participant_ids)) {
      for (const uid of participant_ids) {
        await pool.query('INSERT INTO formation_participants (formation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
      }
    }

    await logActivity(req.session.user.id, req.session.user.username, 'formation_creee', titre);

    res.status(201).json({ formation: rows[0] });
  } catch (err) {
    console.error('[administratif/formations/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/administratif/formations/:id — modifiable à tout moment
router.put('/formations/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { titre, description, date_formation, formateur_id, statut, participant_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `UPDATE formations SET titre=$1, description=$2, date_formation=$3, formateur_id=$4, statut=$5
       WHERE id=$6 RETURNING *`,
      [titre, description || '', date_formation || null, formateur_id || null, statut || 'planifiee', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Formation introuvable.' });

    if (Array.isArray(participant_ids)) {
      await pool.query('DELETE FROM formation_participants WHERE formation_id = $1', [req.params.id]);
      for (const uid of participant_ids) {
        await pool.query('INSERT INTO formation_participants (formation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
      }
    }

    res.json({ formation: rows[0] });
  } catch (err) {
    console.error('[administratif/formations/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/administratif/formations/:id
router.delete('/formations/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM formations WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Formation introuvable.' });
    res.json({ message: `Formation "${rows[0].titre}" supprimée.` });
  } catch (err) {
    console.error('[administratif/formations/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
