const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/grades — public (utilisé pour l'organigramme et le formulaire de validation)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM grades ORDER BY niveau DESC');
    res.json({ grades: rows });
  } catch (err) {
    console.error('[grades/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/grades/organigramme — grades + membres actifs, pour la page publique
// Les grades réservés (ex : Fondateur) sont exclus : ce sont des comptes hors RP, pas des postes du village.
router.get('/organigramme', async (req, res) => {
  try {
    const { rows: grades } = await pool.query('SELECT * FROM grades WHERE reserve = FALSE ORDER BY niveau DESC');
    const { rows: users } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet, u.matricule, u.grade_id, u.brigade, r.nom AS rang_nom
       FROM users u LEFT JOIN rangs_ninja r ON r.id = u.rang_id
       WHERE u.statut = 'approuve'`
    );
    const organigramme = grades.map((g) => ({
      ...g,
      membres: users.filter((u) => u.grade_id === g.id),
    }));
    res.json({ organigramme });
  } catch (err) {
    console.error('[grades/organigramme]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/grades — créer un grade
router.post('/', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles, peut_configurer_planning, peut_gerer_id_discord, reserve } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom du grade est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO grades (nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles, peut_configurer_planning, peut_gerer_id_discord, reserve)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        nom,
        niveau ?? 0,
        couleur || '#C9A227',
        !!peut_valider_comptes,
        !!peut_gerer_grades,
        !!peut_gerer_sanctions,
        !!peut_gerer_casiers,
        !!peut_gerer_actus,
        !!peut_gerer_protocoles,
        !!peut_configurer_planning,
        !!peut_gerer_id_discord,
        !!reserve,
      ]
    );
    await logActivity(req.session.user.id, req.session.user.username, 'grade_cree', `Grade "${rows[0].nom}" créé`);
    res.status(201).json({ grade: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un grade avec ce nom existe déjà.' });
    console.error('[grades/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/grades/:id — modifier un grade (nom, niveau, permissions...)
router.put('/:id', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT reserve FROM grades WHERE id = $1', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Grade introuvable.' });
    if (existingRows[0].reserve) {
      return res.status(403).json({ error: 'Ce grade est réservé et ne peut pas être modifié depuis l\'interface.' });
    }

    const { nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles, peut_configurer_planning, peut_gerer_id_discord, reserve } = req.body;
    const { rows } = await pool.query(
      `UPDATE grades SET nom=$1, niveau=$2, couleur=$3, peut_valider_comptes=$4, peut_gerer_grades=$5,
              peut_gerer_sanctions=$6, peut_gerer_casiers=$7, peut_gerer_actus=$8, peut_gerer_protocoles=$9, peut_configurer_planning=$10, peut_gerer_id_discord=$11, reserve=$12
       WHERE id=$13 RETURNING *`,
      [
        nom,
        niveau ?? 0,
        couleur || '#C9A227',
        !!peut_valider_comptes,
        !!peut_gerer_grades,
        !!peut_gerer_sanctions,
        !!peut_gerer_casiers,
        !!peut_gerer_actus,
        !!peut_gerer_protocoles,
        !!peut_configurer_planning,
        !!peut_gerer_id_discord,
        !!reserve,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Grade introuvable.' });
    await logActivity(req.session.user.id, req.session.user.username, 'grade_edite', `Grade "${rows[0].nom}" édité`);
    res.json({ grade: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un grade avec ce nom existe déjà.' });
    console.error('[grades/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/grades/:id — supprimer un grade (les membres qui l'avaient repassent "sans grade")
router.delete('/:id', requireAuth, requirePermission('peut_gerer_grades'), async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT reserve FROM grades WHERE id = $1', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Grade introuvable.' });
    if (existingRows[0].reserve) {
      return res.status(403).json({ error: 'Ce grade est réservé et ne peut pas être supprimé depuis l\'interface.' });
    }

    const { rows } = await pool.query('DELETE FROM grades WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Grade introuvable.' });
    await logActivity(req.session.user.id, req.session.user.username, 'grade_supprime', `Grade "${rows[0].nom}" supprimé`);
    res.json({ message: `Grade "${rows[0].nom}" supprimé.` });
  } catch (err) {
    console.error('[grades/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
