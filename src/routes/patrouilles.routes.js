const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/patrouilles — liste (tout utilisateur connecté peut consulter le planning)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.username AS agent_username, u.nom_complet AS agent_nom
       FROM patrouilles p LEFT JOIN users u ON u.id = p.agent_id
       WHERE p.date_service >= CURRENT_DATE - INTERVAL '1 day'
       ORDER BY p.date_service, p.heure_debut`
    );
    res.json({ patrouilles: rows });
  } catch (err) {
    console.error('[patrouilles/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/patrouilles — planifier un service
router.post('/', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { titre, date_service, heure_debut, heure_fin, agent_id, notes } = req.body;
    if (!titre || !date_service) return res.status(400).json({ error: 'Titre et date sont requis.' });

    const { rows } = await pool.query(
      `INSERT INTO patrouilles (titre, date_service, heure_debut, heure_fin, agent_id, notes, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [titre, date_service, heure_debut || '', heure_fin || '', agent_id || null, notes || '', req.session.user.id]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'patrouille_creee', `${titre} — ${date_service}`);

    res.status(201).json({ patrouille: rows[0] });
  } catch (err) {
    console.error('[patrouilles/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/patrouilles/:id
router.delete('/:id', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM patrouilles WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Patrouille introuvable.' });
    res.json({ message: `Patrouille "${rows[0].titre}" supprimée.` });
  } catch (err) {
    console.error('[patrouilles/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
