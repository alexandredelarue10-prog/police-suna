const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

router.get('/', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.username AS enqueteur_username,
              (SELECT COUNT(*)::int FROM enquete_casiers ec WHERE ec.enquete_id = e.id) AS nb_casiers,
              (SELECT COUNT(*)::int FROM enquete_plaintes ep WHERE ep.enquete_id = e.id) AS nb_plaintes
       FROM enquetes e LEFT JOIN users u ON u.id = e.enqueteur_id
       ORDER BY e.updated_at DESC`
    );
    res.json({ enquetes: rows });
  } catch (err) {
    console.error('[enquetes/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/:id', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows: enqueteRows } = await pool.query(
      `SELECT e.*, u.username AS enqueteur_username FROM enquetes e
       LEFT JOIN users u ON u.id = e.enqueteur_id WHERE e.id = $1`,
      [req.params.id]
    );
    if (enqueteRows.length === 0) return res.status(404).json({ error: 'Dossier introuvable.' });

    const { rows: casiers } = await pool.query(
      `SELECT c.id, c.nom, c.prenom, c.statut FROM enquete_casiers ec
       JOIN casiers c ON c.id = ec.casier_id WHERE ec.enquete_id = $1`,
      [req.params.id]
    );
    const { rows: plaintes } = await pool.query(
      `SELECT p.id, p.numero, p.plaignant_nom, p.statut FROM enquete_plaintes ep
       JOIN plaintes p ON p.id = ep.plainte_id WHERE ep.enquete_id = $1`,
      [req.params.id]
    );

    res.json({ enquete: enqueteRows[0], casiers, plaintes });
  } catch (err) {
    console.error('[enquetes/detail]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { titre, description, statut } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows: seqRows } = await pool.query("SELECT nextval('enquete_numero_seq') AS n");
    const numero = `ENQ-${String(seqRows[0].n).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `INSERT INTO enquetes (numero, titre, description, statut, enqueteur_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [numero, titre, description || '', statut || 'ouverte', req.session.user.id]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'enquete_ouverte', `${numero} — ${titre}`);

    res.status(201).json({ enquete: rows[0] });
  } catch (err) {
    console.error('[enquetes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/:id', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { titre, description, statut } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows } = await pool.query(
      `UPDATE enquetes SET titre=$1, description=$2, statut=$3, updated_at=now() WHERE id=$4 RETURNING *`,
      [titre, description || '', statut || 'ouverte', req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Dossier introuvable.' });
    res.json({ enquete: rows[0] });
  } catch (err) {
    console.error('[enquetes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM enquetes WHERE id = $1 RETURNING numero', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Dossier introuvable.' });
    res.json({ message: `Dossier ${rows[0].numero} supprimé.` });
  } catch (err) {
    console.error('[enquetes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/:id/casiers', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { casier_id } = req.body;
    if (!casier_id) return res.status(400).json({ error: 'casier_id est requis.' });
    await pool.query('INSERT INTO enquete_casiers (enquete_id, casier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, casier_id]);
    await pool.query('UPDATE enquetes SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ message: 'Casier lié.' });
  } catch (err) {
    console.error('[enquetes/casiers/link]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id/casiers/:casierId', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    await pool.query('DELETE FROM enquete_casiers WHERE enquete_id = $1 AND casier_id = $2', [req.params.id, req.params.casierId]);
    res.json({ message: 'Casier délié.' });
  } catch (err) {
    console.error('[enquetes/casiers/unlink]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/:id/plaintes', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { plainte_id } = req.body;
    if (!plainte_id) return res.status(400).json({ error: 'plainte_id est requis.' });
    await pool.query('INSERT INTO enquete_plaintes (enquete_id, plainte_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, plainte_id]);
    await pool.query('UPDATE enquetes SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ message: 'Plainte liée.' });
  } catch (err) {
    console.error('[enquetes/plaintes/link]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id/plaintes/:plainteId', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    await pool.query('DELETE FROM enquete_plaintes WHERE enquete_id = $1 AND plainte_id = $2', [req.params.id, req.params.plainteId]);
    res.json({ message: 'Plainte déliée.' });
  } catch (err) {
    console.error('[enquetes/plaintes/unlink]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
