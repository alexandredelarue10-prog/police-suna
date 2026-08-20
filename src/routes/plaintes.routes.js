const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/plaintes — liste avec recherche + filtre statut
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const statut = (req.query.statut || '').trim();
    const conditions = [];
    const params = [];
    let i = 1;

    if (q) {
      conditions.push(`(plaignant_nom ILIKE $${i} OR mis_en_cause_nom ILIKE $${i} OR numero ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }
    if (statut) { conditions.push(`statut = $${i}`); params.push(statut); i++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM plainte_temoignages t WHERE t.plainte_id = p.id) AS nb_temoignages,
              (SELECT COUNT(*)::int FROM plainte_infractions pi WHERE pi.plainte_id = p.id) AS nb_infractions
       FROM plaintes p ${where} ORDER BY p.updated_at DESC LIMIT 100`,
      params
    );
    res.json({ plaintes: rows });
  } catch (err) {
    console.error('[plaintes/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/plaintes/:id — détail complet (témoignages + infractions)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: plainteRows } = await pool.query(
      `SELECT p.*, u.username AS agent_username, c.nom AS casier_nom
       FROM plaintes p
       LEFT JOIN users u ON u.id = p.agent_id
       LEFT JOIN casiers c ON c.id = p.casier_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (plainteRows.length === 0) return res.status(404).json({ error: 'Plainte introuvable.' });

    const { rows: temoignages } = await pool.query(
      `SELECT t.*, u.username AS enregistre_par_username FROM plainte_temoignages t
       LEFT JOIN users u ON u.id = t.enregistre_par
       WHERE t.plainte_id = $1 ORDER BY t.created_at`,
      [req.params.id]
    );
    const { rows: infractions } = await pool.query(
      `SELECT pi.*, st.article, st.amende, st.cellule_tig FROM plainte_infractions pi
       LEFT JOIN sanctions_types st ON st.id = pi.sanction_id
       WHERE pi.plainte_id = $1 ORDER BY pi.created_at`,
      [req.params.id]
    );

    res.json({ plainte: plainteRows[0], temoignages, infractions });
  } catch (err) {
    console.error('[plaintes/detail]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/plaintes — déposer une nouvelle plainte
router.post('/', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut } = req.body;
    if (!plaignant_nom) return res.status(400).json({ error: 'Le nom du plaignant est requis.' });

    const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS n FROM plaintes');
    const numero = `PL-${String(countRows[0].n + 1).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `INSERT INTO plaintes (numero, plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut, agent_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        numero,
        plaignant_nom,
        plaignant_contact || '',
        mis_en_cause_nom || '',
        casier_id || null,
        date_faits || null,
        lieu_faits || '',
        description || '',
        statut || 'en_cours',
        req.session.user.id,
      ]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_deposee', `${numero} — plaignant ${plaignant_nom}`);

    res.status(201).json({ plainte: rows[0] });
  } catch (err) {
    console.error('[plaintes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/plaintes/:id — modifiable à tout moment, sans restriction de statut
router.put('/:id', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut } = req.body;
    if (!plaignant_nom) return res.status(400).json({ error: 'Le nom du plaignant est requis.' });

    const { rows } = await pool.query(
      `UPDATE plaintes SET plaignant_nom=$1, plaignant_contact=$2, mis_en_cause_nom=$3, casier_id=$4,
              date_faits=$5, lieu_faits=$6, description=$7, statut=$8, updated_at=now()
       WHERE id=$9 RETURNING *`,
      [
        plaignant_nom,
        plaignant_contact || '',
        mis_en_cause_nom || '',
        casier_id || null,
        date_faits || null,
        lieu_faits || '',
        description || '',
        statut || 'en_cours',
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Plainte introuvable.' });

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_modifiee', `${rows[0].numero} modifiée`);

    res.json({ plainte: rows[0] });
  } catch (err) {
    console.error('[plaintes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/plaintes/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM plaintes WHERE id = $1 RETURNING numero', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Plainte introuvable.' });

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_supprimee', `${rows[0].numero} supprimée`);

    res.json({ message: `Plainte ${rows[0].numero} supprimée.` });
  } catch (err) {
    console.error('[plaintes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Témoignages ---

router.post('/:id/temoignages', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { nom_temoin, temoignage } = req.body;
    if (!nom_temoin) return res.status(400).json({ error: 'Le nom du témoin est requis.' });

    const { rows } = await pool.query(
      `INSERT INTO plainte_temoignages (plainte_id, nom_temoin, temoignage, enregistre_par)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, nom_temoin, temoignage || '', req.session.user.id]
    );
    await pool.query('UPDATE plaintes SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ temoignage: rows[0] });
  } catch (err) {
    console.error('[plaintes/temoignages/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/temoignages/:temoignageId', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { nom_temoin, temoignage } = req.body;
    if (!nom_temoin) return res.status(400).json({ error: 'Le nom du témoin est requis.' });

    const { rows } = await pool.query(
      `UPDATE plainte_temoignages SET nom_temoin=$1, temoignage=$2 WHERE id=$3 RETURNING *`,
      [nom_temoin, temoignage || '', req.params.temoignageId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Témoignage introuvable.' });
    res.json({ temoignage: rows[0] });
  } catch (err) {
    console.error('[plaintes/temoignages/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/temoignages/:temoignageId', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM plainte_temoignages WHERE id = $1 RETURNING id', [req.params.temoignageId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Témoignage introuvable.' });
    res.json({ message: 'Témoignage supprimé.' });
  } catch (err) {
    console.error('[plaintes/temoignages/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Infractions visées par la plainte ---

router.post('/:id/infractions', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { sanction_id, titre, description } = req.body;
    if (!titre) return res.status(400).json({ error: "Le titre de l'infraction est requis." });

    const { rows } = await pool.query(
      `INSERT INTO plainte_infractions (plainte_id, sanction_id, titre, description) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, sanction_id || null, titre, description || '']
    );
    await pool.query('UPDATE plaintes SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ infraction: rows[0] });
  } catch (err) {
    console.error('[plaintes/infractions/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/infractions/:infractionId', requireAuth, requirePermission('peut_gerer_casiers'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM plainte_infractions WHERE id = $1 RETURNING id', [req.params.infractionId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Infraction introuvable.' });
    res.json({ message: 'Infraction retirée.' });
  } catch (err) {
    console.error('[plaintes/infractions/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
