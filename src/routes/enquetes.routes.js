const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { notifierUser } = require('../utils/discordNotifier');
const { broadcast } = require('../utils/liveSync');

const router = express.Router();

// GET /api/enquetes/membres — membres du pôle Enquête, pour le choix de l'enquêteur assigné
// (accessible à tout le pôle, contrairement à /api/users réservé aux hauts gradés).
router.get('/membres', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet, g.nom AS grade_nom
       FROM users u
       JOIN user_poles up ON up.user_id = u.id
       JOIN poles p ON p.id = up.pole_id AND p.nom = 'Enquête'
       LEFT JOIN grades g ON g.id = u.grade_id
       WHERE u.statut = 'approuve'
       ORDER BY u.username`
    );
    res.json({ membres: rows });
  } catch (err) {
    console.error('[enquetes/membres]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

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
    const { rows: evenements } = await pool.query(
      `SELECT ev.*, u.username AS cree_par_username FROM enquete_evenements ev
       LEFT JOIN users u ON u.id = ev.cree_par WHERE ev.enquete_id = $1 ORDER BY ev.date_evenement, ev.created_at`,
      [req.params.id]
    );
    const { rows: pieces } = await pool.query(
      'SELECT * FROM enquete_pieces WHERE enquete_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({ enquete: enqueteRows[0], casiers, plaintes, evenements, pieces });
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
    const { titre, description, statut, enqueteur_id } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows: beforeRows } = await pool.query('SELECT enqueteur_id FROM enquetes WHERE id = $1', [req.params.id]);
    if (beforeRows.length === 0) return res.status(404).json({ error: 'Dossier introuvable.' });

    const { rows } = await pool.query(
      `UPDATE enquetes SET titre=$1, description=$2, statut=$3, enqueteur_id=$4, updated_at=now() WHERE id=$5 RETURNING *`,
      [titre, description || '', statut || 'ouverte', enqueteur_id || null, req.params.id]
    );

    if (enqueteur_id && String(enqueteur_id) !== String(beforeRows[0].enqueteur_id)) {
      notifierUser(enqueteur_id, `🔍 Tu as été assigné comme enquêteur sur le dossier ${rows[0].numero} — ${rows[0].titre}.`)
        .catch((err) => console.error('[discord] notif enquete (enqueteur)', err.message));
    }

    broadcast('enquetes', { action: 'enquete_modifiee', details: `${rows[0].numero} — ${rows[0].titre}` });
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
    broadcast('enquetes', { action: 'enquete_supprimee', details: rows[0].numero });
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

// --- Chronologie de l'enquête ---
router.post('/:id/evenements', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { date_evenement, description } = req.body;
    if (!description) return res.status(400).json({ error: 'La description est requise.' });
    const { rows } = await pool.query(
      `INSERT INTO enquete_evenements (enquete_id, date_evenement, description, cree_par) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, date_evenement || null, description, req.session.user.id]
    );
    await pool.query('UPDATE enquetes SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ evenement: rows[0] });
  } catch (err) {
    console.error('[enquetes/evenements/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/evenements/:evenementId', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM enquete_evenements WHERE id = $1 RETURNING id', [req.params.evenementId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Événement introuvable.' });
    res.json({ message: 'Événement supprimé.' });
  } catch (err) {
    console.error('[enquetes/evenements/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Pièces à conviction ---
router.post('/:id/pieces', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { nom, description, localisation } = req.body;
    if (!nom) return res.status(400).json({ error: 'Le nom de la pièce est requis.' });
    const { rows } = await pool.query(
      `INSERT INTO enquete_pieces (enquete_id, nom, description, localisation) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, nom, description || '', localisation || '']
    );
    res.status(201).json({ piece: rows[0] });
  } catch (err) {
    console.error('[enquetes/pieces/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/pieces/:pieceId', requireAuth, requirePole('Enquête'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM enquete_pieces WHERE id = $1 RETURNING id', [req.params.pieceId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Pièce introuvable.' });
    res.json({ message: 'Pièce retirée.' });
  } catch (err) {
    console.error('[enquetes/pieces/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
