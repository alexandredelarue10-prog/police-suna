const pool = require('../config/db');
const { broadcast } = require('./liveSync');

// Supprime les patrouilles dont l'heure de fin (ou, à défaut, la fin de journée du
// date_service) remonte à plus de 24h. Ne doit jamais faire planter le cron appelant :
// les erreurs sont loggées, jamais propagées.
async function nettoyerPatrouillesExpirees() {
  try {
    const { rows } = await pool.query(`
      DELETE FROM patrouilles
      WHERE (date_service + (
        CASE WHEN heure_fin ~ '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' THEN heure_fin ELSE '23:59'
        END)::time
      ) < (now() - interval '24 hours')
      RETURNING id
    `);

    if (rows.length > 0) {
      broadcast('patrouilles', { action: 'patrouilles_expirees_supprimees', details: `${rows.length} patrouille(s)` });
    }
    return { supprime: rows.length };
  } catch (err) {
    console.error('[patrouille-cleanup] échec (non bloquant) :', err.message);
    return { supprime: 0 };
  }
}

module.exports = { nettoyerPatrouillesExpirees };
