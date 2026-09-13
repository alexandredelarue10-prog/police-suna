const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { notifierUser } = require('../utils/discordNotifier');

const router = express.Router();

// Vérifie qu'un grade existe et n'est pas réservé (empêche son attribution via l'interface)
async function assertGradeAssignable(gradeId) {
  const { rows } = await pool.query('SELECT id, reserve FROM grades WHERE id = $1', [gradeId]);
  if (rows.length === 0) return { ok: false, error: 'Grade introuvable.' };
  if (rows[0].reserve) return { ok: false, error: 'Ce grade est réservé et ne peut être attribué à personne.' };
  return { ok: true };
}

// GET /api/users/pending-count — compteur léger pour la pastille de notification dans la nav
router.get('/pending-count', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE statut = 'en_attente'");
    res.json({ count: rows[0].n });
  } catch (err) {
    console.error('[users/pending-count]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/users — liste de tous les comptes (hauts gradés uniquement)
router.get('/', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet, u.statut, u.matricule, u.created_at, u.brigade, u.protege, u.last_login, u.discord_id,
              g.id AS grade_id, g.nom AS grade_nom, g.couleur AS grade_couleur, g.niveau AS grade_niveau, g.reserve AS grade_reserve,
              r.id AS rang_id, r.nom AS rang_nom, r.couleur AS rang_couleur,
              COALESCE(
                (SELECT json_agg(json_build_object('id', p.id, 'nom', p.nom, 'couleur', p.couleur))
                 FROM user_poles up JOIN poles p ON p.id = up.pole_id WHERE up.user_id = u.id),
                '[]'
              ) AS poles
       FROM users u
       LEFT JOIN grades g ON g.id = u.grade_id
       LEFT JOIN rangs_ninja r ON r.id = u.rang_id
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
    const { grade_id, rang_id, brigade } = req.body;
    if (!grade_id) return res.status(400).json({ error: 'Un grade doit être choisi pour valider le compte.' });

    const check = await assertGradeAssignable(grade_id);
    if (!check.ok) return res.status(403).json({ error: check.error });

    // Génère un matricule via la séquence dédiée (jamais de collision, même après suppression de comptes)
    const { rows: seqRows } = await pool.query("SELECT nextval('matricule_seq') AS n");
    const matricule = `SUNA-${String(seqRows[0].n).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `UPDATE users SET statut = 'approuve', grade_id = $1, rang_id = $2, brigade = COALESCE($3, brigade),
              valide_par = $4, valide_le = now(), matricule = COALESCE(matricule, $5)
       WHERE id = $6 RETURNING id, username`,
      [grade_id, rang_id || null, brigade || null, req.session.user.id, matricule, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });

    await logActivity(req.session.user.id, req.session.user.username, 'compte_valide', `${rows[0].username} validé`);
    notifierUser(rows[0].id, `✅ Ton compte "${rows[0].username}" a été validé sur le site de la Police de Sunagakure.`)
      .catch((err) => console.error('[discord] notif compte_valide', err.message));

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
    await logActivity(req.session.user.id, req.session.user.username, 'compte_refuse', `${rows[0].username} refusé`);
    res.json({ message: `Demande de ${rows[0].username} refusée.` });
  } catch (err) {
    console.error('[users/reject]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/grade — change le grade (poste) d'un membre déjà approuvé
router.patch('/:id/grade', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    // Personne ne peut modifier son propre grade — empêche toute auto-promotion, même pour un Dirigeant/Gérant.
    if (targetId === req.session.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier votre propre grade.' });
    }

    const { rows: targetRows } = await pool.query('SELECT protege FROM users WHERE id = $1', [targetId]);
    if (targetRows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    if (targetRows[0].protege) {
      return res.status(403).json({ error: 'Ce compte est protégé et ne peut pas être modifié.' });
    }

    const { grade_id } = req.body;
    if (grade_id) {
      const check = await assertGradeAssignable(grade_id);
      if (!check.ok) return res.status(403).json({ error: check.error });
    }

    const { rows } = await pool.query(
      `UPDATE users SET grade_id = $1 WHERE id = $2 RETURNING id, username`,
      [grade_id || null, targetId]
    );
    await logActivity(req.session.user.id, req.session.user.username, 'grade_modifie', `Grade de ${rows[0].username} modifié`);
    notifierUser(rows[0].id, `🎖️ Ton grade a été modifié sur le site de la Police de Sunagakure.`)
      .catch((err) => console.error('[discord] notif grade_modifie', err.message));
    res.json({ message: `Grade de ${rows[0].username} mis à jour.` });
  } catch (err) {
    console.error('[users/grade]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/rang — change le rang ninja et/ou la brigade d'un membre (informatif)
router.patch('/:id/rang', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    if (targetId === req.session.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier votre propre rang.' });
    }

    const { rows: targetRows } = await pool.query('SELECT protege FROM users WHERE id = $1', [targetId]);
    if (targetRows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    if (targetRows[0].protege) {
      return res.status(403).json({ error: 'Ce compte est protégé et ne peut pas être modifié.' });
    }

    const { rang_id, brigade } = req.body;
    const { rows } = await pool.query(
      `UPDATE users SET rang_id = $1, brigade = $2 WHERE id = $3 RETURNING id, username`,
      [rang_id || null, brigade !== undefined ? brigade : '', targetId]
    );
    await logActivity(req.session.user.id, req.session.user.username, 'rang_modifie', `Rang de ${rows[0].username} modifié`);
    notifierUser(rows[0].id, `🥷 Ton rang ninja a été modifié sur le site de la Police de Sunagakure.`)
      .catch((err) => console.error('[discord] notif rang_modifie', err.message));
    res.json({ message: `Rang de ${rows[0].username} mis à jour.` });
  } catch (err) {
    console.error('[users/rang]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/poles — remplace la liste des pôles d'un membre (Administratif, Enquête, Sécurité...)
router.patch('/:id/poles', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    if (targetId === req.session.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier vos propres pôles.' });
    }

    const { rows: targetRows } = await pool.query('SELECT protege, username FROM users WHERE id = $1', [targetId]);
    if (targetRows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    if (targetRows[0].protege) {
      return res.status(403).json({ error: 'Ce compte est protégé et ne peut pas être modifié (il appartient déjà à tous les pôles).' });
    }

    const { pole_ids } = req.body;
    if (!Array.isArray(pole_ids)) return res.status(400).json({ error: 'pole_ids doit être un tableau.' });

    await pool.query('DELETE FROM user_poles WHERE user_id = $1', [targetId]);
    for (const poleId of pole_ids) {
      await pool.query('INSERT INTO user_poles (user_id, pole_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [targetId, poleId]);
    }

    await logActivity(req.session.user.id, req.session.user.username, 'poles_modifies', `Pôles de ${targetRows[0].username} mis à jour`);
    res.json({ message: `Pôles de ${targetRows[0].username} mis à jour.` });
  } catch (err) {
    console.error('[users/poles]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/:id/discord — renseigne l'ID Discord d'un compte (réservé à la permission dédiée)
router.patch('/:id/discord', requireAuth, requirePermission('peut_gerer_id_discord'), async (req, res) => {
  try {
    const { discord_id } = req.body;
    const value = discord_id ? String(discord_id).trim() : null;

    // Un ID Discord (Snowflake) est purement numérique, 17 à 20 chiffres
    if (value && !/^\d{17,20}$/.test(value)) {
      return res.status(400).json({ error: "ID Discord invalide (doit être un identifiant numérique Discord, 17 à 20 chiffres)." });
    }

    const { rows } = await pool.query(
      'UPDATE users SET discord_id = $1 WHERE id = $2 RETURNING id, username, discord_id',
      [value, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });

    await logActivity(req.session.user.id, req.session.user.username, 'discord_id_modifie', `ID Discord de ${rows[0].username} mis à jour`);
    res.json({ message: `ID Discord de ${rows[0].username} mis à jour.`, discord_id: rows[0].discord_id });
  } catch (err) {
    console.error('[users/discord]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/users/:id — supprime un compte
router.delete('/:id', requireAuth, requirePermission('peut_valider_comptes'), async (req, res) => {
  try {
    const targetId = Number(req.params.id);

    if (targetId === req.session.user.id) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }

    const { rows: targetRows } = await pool.query('SELECT protege FROM users WHERE id = $1', [targetId]);
    if (targetRows.length === 0) return res.status(404).json({ error: 'Compte introuvable.' });
    if (targetRows[0].protege) {
      return res.status(403).json({ error: 'Ce compte est protégé et ne peut pas être supprimé.' });
    }

    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING username', [targetId]);
    await logActivity(req.session.user.id, req.session.user.username, 'compte_supprime', `${rows[0].username} supprimé`);
    res.json({ message: `Compte ${rows[0].username} supprimé.` });
  } catch (err) {
    console.error('[users/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PATCH /api/users/me/password — un utilisateur change son propre mot de passe (autorisé même pour un compte protégé)
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
