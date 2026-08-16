const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/casiers — liste avec recherche simple + pagination légère
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    let rows;
    if (q) {
      ({ rows } = await pool.query(
        `SELECT * FROM casiers WHERE nom ILIKE $1 OR prenom ILIKE $1 OR surnom ILIKE $1
         ORDER BY updated_at DESC LIMIT $2`,
        [`%${q}%`, limit]
      ));
    } else {
      ({ rows } = await pool.query('SELECT * FROM casiers ORDER BY updated_at DESC LIMIT $1', [limit]));
    }
    res.json({ casiers: rows });
  } catch (err) {
    console.error('[casiers/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/casiers/:id — détail + infractions liées
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: casierRows } = await pool.query('SELECT * FROM casiers WHERE id = $1', [req.params.id]);
    if (casierRows.length === 0) return res.status(404).json({ error: 'Casier introuvable.' });

    const { rows: infractions } = await pool.query(
      `SELECT ci.*, u.username AS agent_username, st.nom AS sanction_nom
       FROM casier_infractions ci
       LEFT JOIN users u ON u.id = ci.agent_id
       LEFT JOIN sanctions_types st ON st.id = ci.sanction_id
       WHERE ci.casier_id = $1 ORDER BY ci.date_infraction DESC, ci.created_at DESC`,
      [req.params.id]
    );

    res.json({ casier: casierRows[0], infractions });
  } catch (err) {
    console.error('[casiers/detail]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/casiers — créer un casier
router.post('/', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { nom, prenom, surnom, village, age, statut, photo_url, description, niveau_danger } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO casiers (nom, prenom, surnom, village, age, statut, photo_url, description, niveau_danger, cree_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [nom, prenom || '', surnom || '', village || '', age || null, statut || 'libre', photo_url || '', description || '', niveau_danger || 1, req.session.user.id]
    );
    res.status(201).json({ casier: rows[0] });
  } catch (err) {
    console.error('[casiers/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/casiers/:id — modifier
router.put('/:id', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { nom, prenom, surnom, village, age, statut, photo_url, description, niveau_danger } = req.body;
    const { rows } = await pool.query(
      `UPDATE casiers SET nom=$1, prenom=$2, surnom=$3, village=$4, age=$5, statut=$6, photo_url=$7,
              description=$8, niveau_danger=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [nom, prenom || '', surnom || '', village || '', age || null, statut || 'libre', photo_url || '', description || '', niveau_danger || 1, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Casier introuvable.' });
    res.json({ casier: rows[0] });
  } catch (err) {
    console.error('[casiers/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/casiers/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM casiers WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Casier introuvable.' });
    res.json({ message: `Casier de ${rows[0].nom} supprimé.` });
  } catch (err) {
    console.error('[casiers/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/casiers/:id/infractions — ajouter une infraction au casier
router.post('/:id/infractions', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { sanction_id, titre, description, amende_appliquee, cellule_appliquee, occurrence_recidive, date_infraction } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre de l\'infraction est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO casier_infractions (casier_id, sanction_id, titre, description, amende_appliquee, cellule_appliquee, occurrence_recidive, date_infraction, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8, CURRENT_DATE),$9) RETURNING *`,
      [
        req.params.id,
        sanction_id || null,
        titre,
        description || '',
        amende_appliquee === '' || amende_appliquee === undefined ? null : amende_appliquee,
        cellule_appliquee || '',
        occurrence_recidive || '',
        date_infraction || null,
        req.session.user.id,
      ]
    );
    await pool.query('UPDATE casiers SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ infraction: rows[0] });
  } catch (err) {
    console.error('[casiers/infractions/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/casiers/infractions/:infractionId
router.delete('/infractions/:infractionId', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM casier_infractions WHERE id = $1 RETURNING id', [req.params.infractionId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Infraction introuvable.' });
    res.json({ message: 'Infraction supprimée.' });
  } catch (err) {
    console.error('[casiers/infractions/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
