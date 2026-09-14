const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePole } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');
const { notifierUser } = require('../utils/discordNotifier');
const { broadcast } = require('../utils/liveSync');

const router = express.Router();

// GET /api/judiciaire/annuaire — liste des membres du pôle Judiciaire (accessible à tout le pôle,
// contrairement à /api/users qui est réservé aux hauts gradés : on ne renvoie que le nécessaire).
router.get('/annuaire', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.nom_complet, u.matricule,
              g.nom AS grade_nom, g.couleur AS grade_couleur,
              rj.id AS role_judiciaire_id, rj.nom AS role_judiciaire_nom, rj.couleur AS role_judiciaire_couleur
       FROM users u
       JOIN user_poles up ON up.user_id = u.id
       JOIN poles p ON p.id = up.pole_id AND p.nom = 'Judiciaire'
       LEFT JOIN grades g ON g.id = u.grade_id
       LEFT JOIN roles_judiciaires rj ON rj.id = u.role_judiciaire_id
       WHERE u.statut = 'approuve'
       ORDER BY rj.niveau DESC NULLS LAST, u.username`
    );
    res.json({ membres: rows });
  } catch (err) {
    console.error('[judiciaire/annuaire]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, av.username AS avocat_username, pr.username AS procureur_username, ju.username AS juge_username,
              (SELECT COUNT(*)::int FROM affaire_casiers ac WHERE ac.affaire_id = a.id) AS nb_casiers,
              (SELECT COUNT(*)::int FROM affaire_plaintes ap WHERE ap.affaire_id = a.id) AS nb_plaintes
       FROM affaires_judiciaires a
       LEFT JOIN users av ON av.id = a.avocat_id
       LEFT JOIN users pr ON pr.id = a.procureur_id
       LEFT JOIN users ju ON ju.id = a.juge_id
       ORDER BY a.updated_at DESC`
    );
    res.json({ affaires: rows });
  } catch (err) {
    console.error('[judiciaire/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.get('/:id', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { rows: affaireRows } = await pool.query(
      `SELECT a.*, av.username AS avocat_username, pr.username AS procureur_username, ju.username AS juge_username
       FROM affaires_judiciaires a
       LEFT JOIN users av ON av.id = a.avocat_id
       LEFT JOIN users pr ON pr.id = a.procureur_id
       LEFT JOIN users ju ON ju.id = a.juge_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (affaireRows.length === 0) return res.status(404).json({ error: 'Affaire introuvable.' });

    const { rows: casiers } = await pool.query(
      `SELECT c.id, c.nom, c.prenom, c.statut FROM affaire_casiers ac
       JOIN casiers c ON c.id = ac.casier_id WHERE ac.affaire_id = $1`,
      [req.params.id]
    );
    const { rows: plaintes } = await pool.query(
      `SELECT p.id, p.numero, p.plaignant_nom, p.statut FROM affaire_plaintes ap
       JOIN plaintes p ON p.id = ap.plainte_id WHERE ap.affaire_id = $1`,
      [req.params.id]
    );
    const { rows: evenements } = await pool.query(
      `SELECT ev.*, u.username AS cree_par_username FROM affaire_evenements ev
       LEFT JOIN users u ON u.id = ev.cree_par WHERE ev.affaire_id = $1 ORDER BY ev.date_evenement, ev.created_at`,
      [req.params.id]
    );

    res.json({ affaire: affaireRows[0], casiers, plaintes, evenements });
  } catch (err) {
    console.error('[judiciaire/detail]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { titre, description } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows: seqRows } = await pool.query("SELECT nextval('affaire_numero_seq') AS n");
    const numero = `AFF-${String(seqRows[0].n).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `INSERT INTO affaires_judiciaires (numero, titre, description, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [numero, titre, description || '', req.session.user.id]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'affaire_ouverte', `${numero} — ${titre}`);

    res.status(201).json({ affaire: rows[0] });
  } catch (err) {
    console.error('[judiciaire/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.put('/:id', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { titre, description, statut, avocat_id, procureur_id, juge_id, date_audience, verdict, peine } = req.body;
    if (!titre) return res.status(400).json({ error: 'Le titre est requis.' });

    const { rows: beforeRows } = await pool.query('SELECT avocat_id, procureur_id, juge_id FROM affaires_judiciaires WHERE id = $1', [req.params.id]);
    if (beforeRows.length === 0) return res.status(404).json({ error: 'Affaire introuvable.' });

    const { rows } = await pool.query(
      `UPDATE affaires_judiciaires SET titre=$1, description=$2, statut=$3, avocat_id=$4, procureur_id=$5, juge_id=$6,
              date_audience=$7, verdict=$8, peine=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [
        titre, description || '', statut || 'ouverte',
        avocat_id || null, procureur_id || null, juge_id || null,
        date_audience || null, verdict || '', peine || '',
        req.params.id,
      ]
    );

    // Notifie les nouveaux intervenants (évite de renotifier ceux déjà en place avant cette modification)
    const before = beforeRows[0];
    const apercu = `⚖️ Tu as été assigné à l'affaire ${rows[0].numero} — ${rows[0].titre}.`;
    if (avocat_id && String(avocat_id) !== String(before.avocat_id)) {
      notifierUser(avocat_id, apercu).catch((err) => console.error('[discord] notif affaire (avocat)', err.message));
    }
    if (procureur_id && String(procureur_id) !== String(before.procureur_id)) {
      notifierUser(procureur_id, apercu).catch((err) => console.error('[discord] notif affaire (procureur)', err.message));
    }
    if (juge_id && String(juge_id) !== String(before.juge_id)) {
      notifierUser(juge_id, apercu).catch((err) => console.error('[discord] notif affaire (juge)', err.message));
    }

    broadcast('judiciaire', { action: 'affaire_modifiee', details: `${rows[0].numero} — ${rows[0].titre}` });
    res.json({ affaire: rows[0] });
  } catch (err) {
    console.error('[judiciaire/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM affaires_judiciaires WHERE id = $1 RETURNING numero', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Affaire introuvable.' });
    broadcast('judiciaire', { action: 'affaire_supprimee', details: rows[0].numero });
    res.json({ message: `Affaire ${rows[0].numero} supprimée.` });
  } catch (err) {
    console.error('[judiciaire/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/:id/casiers', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { casier_id } = req.body;
    if (!casier_id) return res.status(400).json({ error: 'casier_id est requis.' });
    await pool.query('INSERT INTO affaire_casiers (affaire_id, casier_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, casier_id]);
    await pool.query('UPDATE affaires_judiciaires SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ message: 'Casier lié.' });
  } catch (err) {
    console.error('[judiciaire/casiers/link]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id/casiers/:casierId', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    await pool.query('DELETE FROM affaire_casiers WHERE affaire_id = $1 AND casier_id = $2', [req.params.id, req.params.casierId]);
    res.json({ message: 'Casier délié.' });
  } catch (err) {
    console.error('[judiciaire/casiers/unlink]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.post('/:id/plaintes', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { plainte_id } = req.body;
    if (!plainte_id) return res.status(400).json({ error: 'plainte_id est requis.' });
    await pool.query('INSERT INTO affaire_plaintes (affaire_id, plainte_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, plainte_id]);
    await pool.query('UPDATE affaires_judiciaires SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ message: 'Plainte liée.' });
  } catch (err) {
    console.error('[judiciaire/plaintes/link]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/:id/plaintes/:plainteId', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    await pool.query('DELETE FROM affaire_plaintes WHERE affaire_id = $1 AND plainte_id = $2', [req.params.id, req.params.plainteId]);
    res.json({ message: 'Plainte déliée.' });
  } catch (err) {
    console.error('[judiciaire/plaintes/unlink]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Chronologie de l'affaire (audiences, étapes de la procédure) ---
router.post('/:id/evenements', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { date_evenement, description } = req.body;
    if (!description) return res.status(400).json({ error: 'La description est requise.' });
    const { rows } = await pool.query(
      `INSERT INTO affaire_evenements (affaire_id, date_evenement, description, cree_par) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, date_evenement || null, description, req.session.user.id]
    );
    await pool.query('UPDATE affaires_judiciaires SET updated_at = now() WHERE id = $1', [req.params.id]);
    res.status(201).json({ evenement: rows[0] });
  } catch (err) {
    console.error('[judiciaire/evenements/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/evenements/:evenementId', requireAuth, requirePole('Judiciaire'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM affaire_evenements WHERE id = $1 RETURNING id', [req.params.evenementId]);
    if (rows.length === 0) return res.status(404).json({ error: 'Événement introuvable.' });
    res.json({ message: 'Événement supprimé.' });
  } catch (err) {
    console.error('[judiciaire/evenements/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
