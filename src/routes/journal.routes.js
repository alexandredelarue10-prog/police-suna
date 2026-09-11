const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

const ACTION_LABELS = {
  compte_valide: 'Compte validé',
  compte_refuse: 'Compte refusé',
  compte_supprime: 'Compte supprimé',
  grade_modifie: 'Grade modifié',
  rang_modifie: 'Rang modifié',
  poles_modifies: 'Pôles modifiés',
  formation_creee: 'Formation créée',
  enquete_ouverte: 'Dossier d\'enquête ouvert',
  incident_signale: 'Incident de sécurité signalé',
  escorte_creee: 'Escorte diplomatique créée',
  planning_config_modifiee: 'Configuration du planning automatique modifiée',
  planning_genere: 'Planning automatique généré',
  casier_cree: 'Casier créé',
  casier_supprime: 'Casier supprimé',
  infraction_ajoutee: 'Infraction ajoutée',
  grade_cree: 'Grade créé',
  grade_edite: 'Grade édité',
  grade_supprime: 'Grade supprimé',
  article_penal_edite: 'Article du code pénal modifié',
  alerte_activee: "Code d'alerte activé",
  blame_applique: 'Blâme disciplinaire appliqué',
  patrouille_creee: 'Patrouille planifiée',
  plainte_deposee: 'Plainte déposée',
  plainte_modifiee: 'Plainte modifiée',
  plainte_supprimee: 'Plainte supprimée',
  credits_modifies: 'Crédits du site modifiés',
};

// GET /api/journal — réservé aux hauts gradés habilités à valider les comptes
router.get('/', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 300);
    const { rows } = await pool.query(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    const entries = rows.map((r) => ({ ...r, action_label: ACTION_LABELS[r.action] || r.action }));
    res.json({ entries });
  } catch (err) {
    console.error('[journal/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
