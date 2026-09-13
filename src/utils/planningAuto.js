const pool = require('../config/db');
const { notifierUser } = require('./discordNotifier');
const { broadcast } = require('./liveSync');

// Génère automatiquement des patrouilles pour les prochains jours, selon la configuration
// active (nombre d'agents par patrouille, patrouilles par jour, jours à l'avance).
// Idempotent : ne recrée pas de patrouilles automatiques pour un jour déjà complété.
async function genererPlanningAutomatique() {
  const { rows: configRows } = await pool.query('SELECT * FROM planning_config ORDER BY id LIMIT 1');
  const config = configRows[0];
  if (!config || !config.actif) return { genere: 0 };

  const { rows: agents } = await pool.query("SELECT id FROM users WHERE statut = 'approuve'");
  if (agents.length === 0) return { genere: 0 };

  let totalGenere = 0;

  for (let dayOffset = 0; dayOffset < config.jours_a_l_avance; dayOffset++) {
    const date = new Date();
    date.setDate(date.getDate() + dayOffset);
    const dateStr = date.toISOString().slice(0, 10);

    const { rows: existing } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM patrouilles WHERE date_service = $1 AND auto_genere = TRUE",
      [dateStr]
    );
    const manquantes = config.patrouilles_par_jour - existing[0].n;
    if (manquantes <= 0) continue;

    for (let i = 0; i < manquantes; i++) {
      const shuffled = [...agents].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.min(config.nombre_agents, agents.length));

      const numero = existing[0].n + i + 1;
      const { rows: patRows } = await pool.query(
        `INSERT INTO patrouilles (titre, date_service, heure_debut, statut, notes, auto_genere)
         VALUES ($1,$2,$3,'planifiee','Générée automatiquement',TRUE) RETURNING id`,
        [`Patrouille automatique ${numero}`, dateStr, config.heure_debut_defaut || '']
      );

      for (const agent of selected) {
        await pool.query(
          'INSERT INTO patrouille_agents (patrouille_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
          [patRows[0].id, agent.id]
        );
        notifierUser(agent.id, `🚨 Tu as été assigné à la patrouille automatique "Patrouille automatique ${numero}" (${dateStr}).`)
          .catch((err) => console.error('[discord] notif planning_assigne (auto)', err.message));
      }
      totalGenere++;
    }
  }

  if (totalGenere > 0) {
    broadcast('patrouilles', { action: 'planning_genere_auto', details: `${totalGenere} patrouille(s) générée(s) automatiquement` });
  }
  return { genere: totalGenere };
}

module.exports = { genererPlanningAutomatique };
