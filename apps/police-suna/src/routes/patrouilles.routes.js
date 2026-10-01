const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { genererPlanningAutomatique } = require('../utils/planningAuto');
const { notifierUser } = require('../utils/discordNotifier');
const { broadcast } = require('../utils/liveSync');

const router = express.Router();

// Notifie chaque agent d'une liste qu'il est assigné à une patrouille (best-effort, non-bloquant)
function notifierAgentsPatrouille(agentIds, titre, dateService) {
  if (!Array.isArray(agentIds)) return;
  for (const uid of agentIds) {
    notifierUser(uid, `🚨 Tu as été assigné à la patrouille "${titre}" (${dateService}).`)
      .catch((err) => console.error('[discord] notif planning_assigne', err.message));
  }
}

// GET /api/patrouilles — liste (tout utilisateur connecté peut consulter le planning)
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              COALESCE(
                (SELECT json_agg(json_build_object('id', u.id, 'nom', COALESCE(u.nom_complet, u.username)))
                 FROM patrouille_agents pa JOIN users u ON u.id = pa.user_id WHERE pa.patrouille_id = p.id),
                '[]'
              ) AS agents
       FROM patrouilles p
       WHERE p.date_service >= CURRENT_DATE - INTERVAL '1 day'
       ORDER BY p.date_service, p.heure_debut`
    );
    res.json({ patrouilles: rows });
  } catch (err) {
    console.error('[patrouilles/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Configuration du planning automatique (réservée à la permission dédiée) ---
// IMPORTANT : ces routes doivent être déclarées AVANT les routes /:id, sinon Express
// interprète "config" ou "generer" comme une valeur de :id (bug de routage classique).

router.get('/config', requireAuth, requirePermission('peut_configurer_planning'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM planning_config ORDER BY id LIMIT 1');
    res.json({ config: rows[0] || null });
  } catch (err) {
    console.error('[patrouilles/config/get]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/config', requireAuth, requirePermission('peut_configurer_planning'), async (req, res) => {
  try {
    const { actif, nombre_agents, patrouilles_par_jour, jours_a_l_avance, heure_debut_defaut, duree_heures } = req.body;
    const { rows: existing } = await pool.query('SELECT id FROM planning_config ORDER BY id LIMIT 1');
    if (existing.length === 0) return res.status(404).json({ error: 'Configuration introuvable.' });

    const { rows } = await pool.query(
      `UPDATE planning_config SET actif=$1, nombre_agents=$2, patrouilles_par_jour=$3, jours_a_l_avance=$4,
              heure_debut_defaut=$5, duree_heures=$6, updated_at=now()
       WHERE id=$7 RETURNING *`,
      [
        !!actif,
        Math.max(1, parseInt(nombre_agents) || 2),
        Math.max(1, parseInt(patrouilles_par_jour) || 2),
        Math.max(1, Math.min(14, parseInt(jours_a_l_avance) || 3)),
        heure_debut_defaut || '08h00',
        Math.max(1, parseInt(duree_heures) || 4),
        existing[0].id,
      ]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'planning_config_modifiee', `Auto: ${actif ? 'activé' : 'désactivé'}, ${nombre_agents} agent(s)/patrouille, ${patrouilles_par_jour}/jour`);

    res.json({ config: rows[0] });
  } catch (err) {
    console.error('[patrouilles/config/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/generer', requireAuth, requirePermission('peut_configurer_planning'), async (req, res) => {
  try {
    const result = await genererPlanningAutomatique();
    await logActivity(req.session.user.id, req.session.user.username, 'planning_genere', `${result.genere} patrouille(s) générée(s)`);
    res.json(result);
  } catch (err) {
    console.error('[patrouilles/generer]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/patrouilles — planifier un service, avec un ou plusieurs agents assignés
router.post('/', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { titre, date_service, heure_debut, heure_fin, agent_ids, statut, notes } = req.body;
    if (!titre || !date_service) return res.status(400).json({ error: 'Titre et date sont requis.' });

    const { rows } = await pool.query(
      `INSERT INTO patrouilles (titre, date_service, heure_debut, heure_fin, statut, notes, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [titre, date_service, heure_debut || '', heure_fin || '', statut || 'planifiee', notes || '', req.session.user.id]
    );

    if (Array.isArray(agent_ids)) {
      for (const uid of agent_ids) {
        await pool.query('INSERT INTO patrouille_agents (patrouille_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
      }
      notifierAgentsPatrouille(agent_ids, rows[0].titre, rows[0].date_service);
    }

    await logActivity(req.session.user.id, req.session.user.username, 'patrouille_creee', `${titre} — ${date_service}`);

    res.status(201).json({ patrouille: rows[0] });
  } catch (err) {
    console.error('[patrouilles/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/patrouilles/:id — modifier un service (horaires, statut, agents assignés)
router.put('/:id', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { titre, date_service, heure_debut, heure_fin, agent_ids, statut, notes } = req.body;
    if (!titre || !date_service) return res.status(400).json({ error: 'Titre et date sont requis.' });

    const { rows } = await pool.query(
      `UPDATE patrouilles SET titre=$1, date_service=$2, heure_debut=$3, heure_fin=$4, statut=$5, notes=$6
       WHERE id=$7 RETURNING *`,
      [titre, date_service, heure_debut || '', heure_fin || '', statut || 'planifiee', notes || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Patrouille introuvable.' });

    if (Array.isArray(agent_ids)) {
      await pool.query('DELETE FROM patrouille_agents WHERE patrouille_id = $1', [req.params.id]);
      for (const uid of agent_ids) {
        await pool.query('INSERT INTO patrouille_agents (patrouille_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
      }
      notifierAgentsPatrouille(agent_ids, rows[0].titre, rows[0].date_service);
    }

    broadcast('patrouilles', { action: 'patrouille_modifiee', details: `${rows[0].titre} — ${rows[0].date_service}` });
    res.json({ patrouille: rows[0] });
  } catch (err) {
    console.error('[patrouilles/update]', err);
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
