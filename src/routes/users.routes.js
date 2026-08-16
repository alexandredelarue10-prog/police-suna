const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/users — liste de tous les comptes (hauts gradés uniquement)
router.get('/', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet, u.statut, u.matricule, u.created_at, u.rang_ninja, u.brigade,
              g.id AS grade_id, g.nom AS grade_nom, g.couleur AS grade_couleur, g.niveau AS grade_niveau
       FROM users u
       LEFT JOIN grades g ON g.id = u.grade_id
       ORDER BY (u.statut = 'en_attente') DESC, u.created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error('[users/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/users/:id/approve — valide un compte, lui attribue un grade et (optionnel) un rang ninja / brigade
router.post('/:id/approve', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { grade_id, rang_ninja, brigade } = req.body;
    if (!grade_id) return res.status(400).json({ error: 'Un grade doit être choisi pour valider le compte.' });

    const { rows: gradeRows } = await pool.query('SELECT id FROM grades WHERE id = $1', [grade_id]);
    if (gradeRows.length === 0) return res.status(400).json({ error: 'Grade introuvable.' });

    // Génère un matricule simple si absent
    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    const matricule = `SUNA-${String(countRows[0].n + 1).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `UPDATE users SET statut = 'approuve', grade_id = $1, rang_ninja = COALESCE($2, rang_ninja), brigade = COALESCE($3, brigade),
              valide_par = $4, valide_le = now(), matricule = COALESCE(matricule, $5)
       WHERE id = $6 RETURNING id, username`,
      [grade_id, rang_ninja || null, brigade || null, req.session.user.id, matricule, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });

    res.json({ message: `Compte ${rows[0].username} validé.` });
  } catch (err) {
    console.error('[users/approve]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/users/:id/reject — refuse une demande de compte
router.post('/:id/reject', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE users SET statut = 'refuse', valide_par = $1, valide_le = now() WHERE id = $2 RETURNING id, username`,
      [req.session.user.id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({ message: `Demande de ${rows[0].username} refusée.` });
  } catch (err) {
    console.error('[users/reject]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/grade — change le grade (poste) d'un membre déjà approuvé
router.patch('/:id/grade', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { grade_id } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET grade_id = $1 WHERE id = $2 RETURNING id, username`,
      [grade_id || null, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({ message: `Grade de ${rows[0].username} mis à jour.` });
  } catch (err) {
    console.error('[users/grade]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/rang — change le rang ninja et/ou la brigade d'un membre (informatif)
router.patch('/:id/rang', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rang_ninja, brigade } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET rang_ninja = $1, brigade = $2 WHERE id = $3 RETURNING id, username`,
      [rang_ninja || '', brigade || '', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({ message: `Rang de ${rows[0].username} mis à jour.` });
  } catch (err) {
    console.error('[users/rang]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/users/:id — supprime un compte
router.delete('/:id', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    if (Number(req.params.id) === req.session.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    res.json({ message: `Compte ${rows[0].username} supprimé.` });
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/me/password — un utilisateur change son propre mot de passe
router.patch('/me/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!current_password || !new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Mot de passe invalide (min. 6 caractères).' });
    }
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.session.user.id]);
    const match = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!match) return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.session.user.id]);
    res.json({ message: 'Mot de passe mis à jour.' });
  } catch (err) {
    console.error('[users/password]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
