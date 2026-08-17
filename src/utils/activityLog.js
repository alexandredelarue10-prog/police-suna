const pool = require('../config/db');

// Enregistre une action dans le journal d'activité. Ne doit jamais faire planter la requête
// appelante : les erreurs de log sont avalées silencieusement (best-effort).
async function logActivity(userId, username, action, details = '') {
  try {
    await pool.query(
      'INSERT INTO activity_log (user_id, username_snapshot, action, details) VALUES ($1,$2,$3,$4)',
      [userId || null, username || '', action, details]
    );
  } catch (err) {
    console.error('[activity_log] échec écriture (non bloquant) :', err.message);
  }
}

module.exports = { logActivity };
