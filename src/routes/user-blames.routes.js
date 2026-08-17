const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/users/:id/blames — dossier disciplinaire d'un agent
router.get('/:id/blames', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ub.*, u.username AS applique_par_username
       FROM user_blames ub LEFT JOIN users u ON u.id = ub.applique_par
       WHERE ub.user_id = $1 ORDER BY ub.created_at DESC`,
      [req.params.id]
    );
    res.json({ blames: rows });
  } catch (err) {
    console.error('[user-blames/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/users/:id/blames — appliquer un blâme disciplinaire
router.post('/:id/blames', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    if (targetId === req.session.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez pas vous appliquer un blâme à vous-même.' });
    }
    const { rows: targetRows } = await pool.query('SELECT username, protege FROM users WHERE id = $1', [targetId]);
    if (targetRows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    if (targetRows[0].protege) {
      return res.status(403).json({ error: 'Ce compte est protégé et ne peut pas recevoir de blâme.' });
    }

    const { blame_niveau, motif } = req.body;
    if (!blame_niveau) return res.status(400).json({ error: 'Le niveau de blâme est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO user_blames (user_id, blame_niveau, motif, applique_par) VALUES ($1,$2,$3,$4) RETURNING *`,
      [targetId, blame_niveau, motif || '', req.session.user.id]
    );

    await logActivity(
      req.session.user.id, req.session.user.username, 'blame_applique',
      `Blâme niveau ${blame_niveau} appliqué à ${targetRows[0].username}${motif ? ' — ' + motif : ''}`
    );

    res.status(201).json({ blame: rows[0] });
  } catch (err) {
    console.error('[user-blames/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/users/blames/:blameId — retirer une entrée du dossier disciplinaire
router.delete('/blames/:blameId', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM user_blames WHERE id = $1 RETURNING id', [req.params.blameId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Entrée introuvable.' });
    res.json({ message: 'Entrée disciplinaire supprimée.' });
  } catch (err) {
    console.error('[user-blames/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
