const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// GET /api/casiers — liste avec recherche + filtres (statut, niveau de danger, village)
router.get('/', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const statut = (req.query.statut || '').trim();
    const village = (req.query.village || '').trim();
    const dangerMin = parseInt(req.query.danger_min) || 0;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);

    const conditions = [];
    const params = [];
    let i = 1;

    if (q) { conditions.push(`(nom ILIKE $${i} OR prenom ILIKE $${i} OR surnom ILIKE $${i})`); params.push(`%${q}%`); i++; }
    if (statut) { conditions.push(`statut = $${i}`); params.push(statut); i++; }
    if (village) { conditions.push(`village ILIKE $${i}`); params.push(`%${village}%`); i++; }
    if (dangerMin > 0) { conditions.push(`niveau_danger >= $${i}`); params.push(dangerMin); i++; }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT * FROM casiers ${where} ORDER BY updated_at DESC LIMIT $${i}`,
      params
    );
    res.json({ casiers: rows });
  } catch (err) {
    console.error('[casiers/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// GET /api/casiers/recherches — liste PUBLIQUE des individus activement recherchés (affiche de "mandats")
router.get('/recherches', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, prenom, surnom, village, niveau_danger, photo_url FROM casiers
       WHERE statut = 'recherche' ORDER BY niveau_danger DESC, updated_at DESC LIMIT 12`
    );
    res.json({ recherches: rows });
  } catch (err) {
    console.error('[casiers/recherches]', err);
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

// GET /api/casiers/:id/pdf — export du dossier au format PDF
router.get('/:id/pdf', requireAuth, async (req, res) => {
  try {
    const PDFDocument = require('pdfkit');
    const { rows: casierRows } = await pool.query('SELECT * FROM casiers WHERE id = $1', [req.params.id]);
    if (casierRows.length === 0) return res.status(404).json({ error: 'Casier introuvable.' });
    const casier = casierRows[0];

    const { rows: infractions } = await pool.query(
      `SELECT ci.*, u.username AS agent_username FROM casier_infractions ci
       LEFT JOIN users u ON u.id = ci.agent_id WHERE ci.casier_id = $1 ORDER BY ci.date_infraction DESC`,
      [req.params.id]
    );

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="dossier-${casier.id}.pdf"`);
    doc.pipe(res);

    doc.fontSize(18).text('POLICE DE SUNAGAKURE — DOSSIER OFFICIEL', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`${casier.nom} ${casier.prenom || ''}`.trim());
    if (casier.surnom) doc.fontSize(11).fillColor('gray').text(`dit "${casier.surnom}"`);
    doc.fillColor('black');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Dossier n° ${casier.id}`);
    doc.text(`Statut : ${casier.statut}`);
    doc.text(`Niveau de danger : ${casier.niveau_danger}/5`);
    if (casier.village) doc.text(`Village : ${casier.village}`);
    if (casier.age) doc.text(`Âge : ${casier.age}`);
    if (casier.description) { doc.moveDown(0.5); doc.text(casier.description); }

    doc.moveDown();
    doc.fontSize(13).text(`Infractions (${infractions.length})`, { underline: true });
    doc.moveDown(0.3);
    if (infractions.length === 0) {
      doc.fontSize(10).text('Aucune infraction enregistrée.');
    } else {
      infractions.forEach((inf) => {
        doc.fontSize(11).text(`${new Date(inf.date_infraction).toLocaleDateString('fr-FR')} — ${inf.titre}`);
        if (inf.description) doc.fontSize(9).fillColor('gray').text(inf.description);
        const details = [];
        if (inf.amende_appliquee) details.push(`Amende : ${inf.amende_appliquee.toLocaleString('fr-FR')} ryō`);
        if (inf.cellule_appliquee) details.push(`Cellule/T.I.G : ${inf.cellule_appliquee}`);
        if (details.length) doc.fontSize(9).fillColor('gray').text(details.join(' · '));
        doc.fillColor('black').moveDown(0.5);
      });
    }

    doc.moveDown();
    doc.fontSize(8).fillColor('gray').text(`Document généré le ${new Date().toLocaleDateString('fr-FR')} — Registre officiel de la Force de Police de Sunagakure`, { align: 'center' });

    doc.end();
  } catch (err) {
    console.error('[casiers/pdf]', err);
    res.status(500).json({ error: 'Erreur lors de la génération du PDF.' });
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

    await logActivity(req.session.user.id, req.session.user.username, 'casier_cree', `Casier de ${nom} créé`);

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

    await logActivity(req.session.user.id, req.session.user.username, 'casier_supprime', `Casier de ${rows[0].nom} supprimé`);

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

    await logActivity(req.session.user.id, req.session.user.username, 'infraction_ajoutee', `${titre} (casier #${req.params.id})`);

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
