const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/administratif/rapport-amendes?date_debut=YYYY-MM-DD&date_fin=YYYY-MM-DD
// Qui a amendé combien, entre deux dates. Réservé au pôle Administratif.
router.get('/rapport-amendes', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const dateDebut = req.query.date_debut || '1970-01-01';
    const dateFin = req.query.date_fin || '2999-12-31';

    const { rows } = await pool.query(
      `SELECT u.id AS agent_id, COALESCE(u.nom_complet, u.username) AS agent_nom,
              COUNT(ci.id)::int AS nb_amendes,
              COALESCE(SUM(ci.amende_appliquee), 0)::int AS total_amendes
       FROM casier_infractions ci
       JOIN users u ON u.id = ci.agent_id
       WHERE ci.date_infraction BETWEEN $1 AND $2 AND ci.amende_appliquee IS NOT NULL
       GROUP BY u.id, agent_nom
       ORDER BY total_amendes DESC`,
      [dateDebut, dateFin]
    );

    const totalGeneral = rows.reduce((sum, r) => sum + r.total_amendes, 0);

    res.json({ rapport: rows, total_general: totalGeneral, date_debut: dateDebut, date_fin: dateFin });
  } catch (err) {
    console.error('[administratif/rapport-amendes]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/administratif/formations — liste (visible à tout membre du pôle)
router.get('/formations', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT f.*, u.username AS formateur_username,
              COALESCE(
                (SELECT json_agg(json_build_object('id', p.id, 'nom', COALESCE(p.nom_complet, p.username)))
                 FROM formation_participants fp JOIN users p ON p.id = fp.user_id WHERE fp.formation_id = f.id),
                '[]'
              ) AS participants
       FROM formations f
       LEFT JOIN users u ON u.id = f.formateur_id
       ORDER BY f.date_formation DESC NULLS LAST, f.created_at DESC`
    );
    res.json({ formations: rows });
  } catch (err) {
    console.error('[administratif/formations/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/administratif/formations — créer une formation
router.post('/formations', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { titre, description, date_formation, formateur_id, statut, participant_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO formations (titre, description, date_formation, formateur_id, statut, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [titre, description || '', date_formation || null, formateur_id || null, statut || 'planifiee', req.session.user.id]
    );

    if (Array.isArray(participant_ids)) {
      for (const uid of participant_ids) {
        await pool.query('INSERT INTO formation_participants (formation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, uid]);
      }
    }

    await logActivity(req.session.user.id, req.session.user.username, 'formation_creee', titre);

    res.status(201).json({ formation: rows[0] });
  } catch (err) {
    console.error('[administratif/formations/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/administratif/formations/:id — modifiable à tout moment
router.put('/formations/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { titre, description, date_formation, formateur_id, statut, participant_ids } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `UPDATE formations SET titre=$1, description=$2, date_formation=$3, formateur_id=$4, statut=$5
       WHERE id=$6 RETURNING *`,
      [titre, description || '', date_formation || null, formateur_id || null, statut || 'planifiee', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Formation introuvable.' });

    if (Array.isArray(participant_ids)) {
      await pool.query('DELETE FROM formation_participants WHERE formation_id = $1', [req.params.id]);
      for (const uid of participant_ids) {
        await pool.query('INSERT INTO formation_participants (formation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, uid]);
      }
    }

    res.json({ formation: rows[0] });
  } catch (err) {
    console.error('[administratif/formations/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/administratif/formations/:id
router.delete('/formations/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM formations WHERE id = $1 RETURNING titre', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Formation introuvable.' });
    res.json({ message: `Formation "${rows[0].titre}" supprimée.` });
  } catch (err) {
    console.error('[administratif/formations/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Demandes de congé ---
// Tout membre approuvé peut faire une demande ; seul le pôle Administratif peut la traiter.
router.get('/conges', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, u.username AS demandeur_username, u.nom_complet AS demandeur_nom, v.username AS valide_par_username
       FROM conges c
       JOIN users u ON u.id = c.user_id
       LEFT JOIN users v ON v.id = c.valide_par
       ORDER BY (c.statut = 'en_attente') DESC, c.date_debut DESC`
    );
    res.json({ conges: rows });
  } catch (err) {
    console.error('[administratif/conges/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST — ouvert à tout membre connecté (demande sa propre absence)
router.post('/conges', requireAuth, async (req, res) => {
  try {
    const { date_debut, date_fin, motif } = req.body;
    if (!date_debut || !date_fin) return res.status(400).json({ error: 'Les dates sont requises.' });
    const { rows } = await pool.query(
      `INSERT INTO conges (user_id, date_debut, date_fin, motif) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.session.user.id, date_debut, date_fin, motif || '']
    );
    res.status(201).json({ conge: rows[0] });
  } catch (err) {
    console.error('[administratif/conges/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET — un membre voit ses propres demandes
router.get('/conges/moi', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM conges WHERE user_id = $1 ORDER BY created_at DESC', [req.session.user.id]);
    res.json({ conges: rows });
  } catch (err) {
    console.error('[administratif/conges/moi]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.patch('/conges/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { statut } = req.body;
    if (!['approuve', 'refuse', 'en_attente'].includes(statut)) return res.status(400).json({ error: 'Statut invalide.' });
    const { rows } = await pool.query(
      'UPDATE conges SET statut=$1, valide_par=$2 WHERE id=$3 RETURNING *',
      [statut, req.session.user.id, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Demande introuvable.' });
    res.json({ conge: rows[0] });
  } catch (err) {
    console.error('[administratif/conges/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/conges/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM conges WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Demande introuvable.' });
    res.json({ message: 'Demande supprimée.' });
  } catch (err) {
    console.error('[administratif/conges/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Évaluations périodiques ---
router.get('/evaluations/:userId', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ev.*, u.username AS evaluateur_username FROM evaluations ev
       LEFT JOIN users u ON u.id = ev.evaluateur_id WHERE ev.user_id = $1 ORDER BY ev.date_evaluation DESC`,
      [req.params.userId]
    );
    res.json({ evaluations: rows });
  } catch (err) {
    console.error('[administratif/evaluations/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/evaluations', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { user_id, note, commentaire, date_evaluation } = req.body;
    if (!user_id || !note) return res.status(400).json({ error: 'Agent et note sont requis.' });
    const { rows } = await pool.query(
      `INSERT INTO evaluations (user_id, evaluateur_id, note, commentaire, date_evaluation)
       VALUES ($1,$2,$3,$4,COALESCE($5, CURRENT_DATE)) RETURNING *`,
      [user_id, req.session.user.id, note, commentaire || '', date_evaluation || null]
    );
    res.status(201).json({ evaluation: rows[0] });
  } catch (err) {
    console.error('[administratif/evaluations/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/evaluations/:id', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM evaluations WHERE id = $1 RETURNING id', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Évaluation introuvable.' });
    res.json({ message: 'Évaluation supprimée.' });
  } catch (err) {
    console.error('[administratif/evaluations/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Statistiques des comptes (lecture seule, sans droits de validation/suppression) ---
router.get('/stats-comptes', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { rows: totaux } = await pool.query('SELECT statut, COUNT(*)::int AS n FROM users GROUP BY statut');
    const { rows: parGrade } = await pool.query(`
      SELECT COALESCE(g.nom, 'Sans grade') AS grade, COUNT(*)::int AS n
      FROM users u LEFT JOIN grades g ON g.id = u.grade_id
      WHERE u.statut = 'approuve' GROUP BY grade ORDER BY n DESC
    `);
    const { rows: parPole } = await pool.query(`
      SELECT p.nom AS pole, COUNT(*)::int AS n FROM user_poles up JOIN poles p ON p.id = up.pole_id
      GROUP BY p.nom ORDER BY n DESC
    `);
    const { rows: liste } = await pool.query(`
      SELECT u.id, u.username, u.nom_complet, u.matricule, u.statut, u.created_at, u.last_login,
             g.nom AS grade_nom, r.nom AS rang_nom,
             COALESCE((SELECT json_agg(p.nom) FROM user_poles up JOIN poles p ON p.id=up.pole_id WHERE up.user_id=u.id), '[]') AS poles
      FROM users u
      LEFT JOIN grades g ON g.id = u.grade_id
      LEFT JOIN rangs_ninja r ON r.id = u.rang_id
      ORDER BY u.created_at DESC
    `);
    res.json({ totaux, parGrade, parPole, liste });
  } catch (err) {
    console.error('[administratif/stats-comptes]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Pointage / présence des agents (une entrée par agent et par jour) ---
router.get('/presences', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows: users } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet FROM users u WHERE u.statut = 'approuve' ORDER BY u.username`
    );
    const { rows: presences } = await pool.query('SELECT * FROM presences WHERE date_presence = $1', [date]);
    const parUser = {};
    presences.forEach((p) => { parUser[p.user_id] = p; });

    const liste = users.map((u) => ({
      user_id: u.id,
      nom: u.nom_complet || u.username,
      present: parUser[u.id] ? parUser[u.id].present : null, // null = pas encore pointé
      notes: parUser[u.id] ? parUser[u.id].notes : '',
    }));

    res.json({ date, presences: liste });
  } catch (err) {
    console.error('[administratif/presences/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/presences', requireAuth, requirePole('Administratif'), async (req, res) => {
  try {
    const { user_id, date_presence, present, notes } = req.body;
    if (!user_id || !date_presence) return res.status(400).json({ error: 'Agent et date sont requis.' });
    const { rows } = await pool.query(
      `INSERT INTO presences (user_id, date_presence, present, notes, enregistre_par)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, date_presence) DO UPDATE SET present = EXCLUDED.present, notes = EXCLUDED.notes, enregistre_par = EXCLUDED.enregistre_par
       RETURNING *`,
      [user_id, date_presence, !!present, notes || '', req.session.user.id]
    );
    res.status(201).json({ presence: rows[0] });
  } catch (err) {
    console.error('[administratif/presences/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
