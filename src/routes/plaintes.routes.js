const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

// Un utilisateur peut VOIR une plainte si : elle n'est pas privée, ou s'il en est le créateur,
// ou s'il a la permission "peut_valider_comptes" (Gérant et plus).
function canView(plainte, user) {
  return !plainte.prive || plainte.agent_id === user.id || user.permissions.peut_valider_comptes;
}
// Un utilisateur peut GÉRER (modifier/supprimer/ajouter témoignages ou infractions) une plainte
// si et seulement s'il en est le créateur, ou s'il a la permission "peut_valider_comptes".
function canManage(plainte, user) {
  return plainte.agent_id === user.id || user.permissions.peut_valider_comptes;
}

// GET /api/plaintes — liste avec recherche + filtre statut ; les plaintes privées des autres sont masquées
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

    // Un Gérant+ voit tout ; les autres ne voient que le public + leurs propres plaintes privées.
    if (!req.session.user.permissions.peut_valider_comptes) {
      conditions.push(`(prive = FALSE OR agent_id = $${i})`);
      params.push(req.session.user.id);
      i++;
    }

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
    const plainte = plainteRows[0];

    if (!canView(plainte, req.session.user)) {
      return res.status(403).json({ error: 'Cette plainte est privée.' });
    }

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

    res.json({
      plainte,
      temoignages,
      infractions,
      peut_gerer: canManage(plainte, req.session.user),
    });
  } catch (err) {
    console.error('[plaintes/detail]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/plaintes — déposer une nouvelle plainte : ouvert à tout membre approuvé
router.post('/', requireAuth, async (req, res) => {
  try {
    const { plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut, prive } = req.body;
    if (!plaignant_nom) return res.status(400).json({ error: 'Le nom du plaignant est requis.' });

    const { rows: seqRows } = await pool.query("SELECT nextval('plainte_numero_seq') AS n");
    const numero = `PL-${String(seqRows[0].n).padStart(4, '0')}`;

    const { rows } = await pool.query(
      `INSERT INTO plaintes (numero, plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut, agent_id, prive)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
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
        !!prive,
      ]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_deposee', `${numero}${prive ? ' (privée)' : ''} — plaignant ${plaignant_nom}`);

    res.status(201).json({ plainte: rows[0] });
  } catch (err) {
    console.error('[plaintes/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/plaintes/:id — réservé au créateur ou à un Gérant+, modifiable à tout moment
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT agent_id, prive FROM plaintes WHERE id = $1', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Plainte introuvable.' });
    if (!canManage(existingRows[0], req.session.user)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas modifier cette plainte.' });
    }

    const { plaignant_nom, plaignant_contact, mis_en_cause_nom, casier_id, date_faits, lieu_faits, description, statut, prive } = req.body;
    if (!plaignant_nom) return res.status(400).json({ error: 'Le nom du plaignant est requis.' });

    const { rows } = await pool.query(
      `UPDATE plaintes SET plaignant_nom=$1, plaignant_contact=$2, mis_en_cause_nom=$3, casier_id=$4,
              date_faits=$5, lieu_faits=$6, description=$7, statut=$8, prive=$9, updated_at=now()
       WHERE id=$10 RETURNING *`,
      [
        plaignant_nom,
        plaignant_contact || '',
        mis_en_cause_nom || '',
        casier_id || null,
        date_faits || null,
        lieu_faits || '',
        description || '',
        statut || 'en_cours',
        !!prive,
        req.params.id,
      ]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_modifiee', `${rows[0].numero} modifiée`);

    res.json({ plainte: rows[0] });
  } catch (err) {
    console.error('[plaintes/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/plaintes/:id — réservé au créateur ou à un Gérant+
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: existingRows } = await pool.query('SELECT agent_id, prive, numero FROM plaintes WHERE id = $1', [req.params.id]);
    if (existingRows.length === 0) return res.status(404).json({ error: 'Plainte introuvable.' });
    if (!canManage(existingRows[0], req.session.user)) {
      return res.status(403).json({ error: 'Vous ne pouvez pas supprimer cette plainte.' });
    }

    await pool.query('DELETE FROM plaintes WHERE id = $1', [req.params.id]);

    await logActivity(req.session.user.id, req.session.user.username, 'plainte_supprimee', `${existingRows[0].numero} supprimée`);

    res.json({ message: `Plainte ${existingRows[0].numero} supprimée.` });
  } catch (err) {
    console.error('[plaintes/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Témoignages (réservé au créateur de la plainte ou à un Gérant+) ---

async function loadPlainteForCheck(plainteId) {
  const { rows } = await pool.query('SELECT id, agent_id, prive FROM plaintes WHERE id = $1', [plainteId]);
  return rows[0] || null;
}

router.post('/:id/temoignages', requireAuth, async (req, res) => {
  try {
    const plainte = await loadPlainteForCheck(req.params.id);
    if (!plainte) return res.status(404).json({ error: 'Plainte introuvable.' });
    if (!canManage(plainte, req.session.user)) return res.status(403).json({ error: 'Accès refusé à cette plainte.' });

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

router.put('/temoignages/:temoignageId', requireAuth, async (req, res) => {
  try {
    const { rows: tRows } = await pool.query('SELECT plainte_id FROM plainte_temoignages WHERE id = $1', [req.params.temoignageId]);
    if (tRows.length === 0) return res.status(404).json({ error: 'Témoignage introuvable.' });
    const plainte = await loadPlainteForCheck(tRows[0].plainte_id);
    if (!plainte || !canManage(plainte, req.session.user)) return res.status(403).json({ error: 'Accès refusé à cette plainte.' });

    const { nom_temoin, temoignage } = req.body;
    if (!nom_temoin) return res.status(400).json({ error: 'Le nom du témoin est requis.' });

    const { rows } = await pool.query(
      `UPDATE plainte_temoignages SET nom_temoin=$1, temoignage=$2 WHERE id=$3 RETURNING *`,
      [nom_temoin, temoignage || '', req.params.temoignageId]
    );
    res.json({ temoignage: rows[0] });
  } catch (err) {
    console.error('[plaintes/temoignages/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

router.delete('/temoignages/:temoignageId', requireAuth, async (req, res) => {
  try {
    const { rows: tRows } = await pool.query('SELECT plainte_id FROM plainte_temoignages WHERE id = $1', [req.params.temoignageId]);
    if (tRows.length === 0) return res.status(404).json({ error: 'Témoignage introuvable.' });
    const plainte = await loadPlainteForCheck(tRows[0].plainte_id);
    if (!plainte || !canManage(plainte, req.session.user)) return res.status(403).json({ error: 'Accès refusé à cette plainte.' });

    await pool.query('DELETE FROM plainte_temoignages WHERE id = $1', [req.params.temoignageId]);
    res.json({ message: 'Témoignage supprimé.' });
  } catch (err) {
    console.error('[plaintes/temoignages/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// --- Infractions visées par la plainte (mêmes règles d'accès) ---

router.post('/:id/infractions', requireAuth, async (req, res) => {
  try {
    const plainte = await loadPlainteForCheck(req.params.id);
    if (!plainte) return res.status(404).json({ error: 'Plainte introuvable.' });
    if (!canManage(plainte, req.session.user)) return res.status(403).json({ error: 'Accès refusé à cette plainte.' });

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

router.delete('/infractions/:infractionId', requireAuth, async (req, res) => {
  try {
    const { rows: iRows } = await pool.query('SELECT plainte_id FROM plainte_infractions WHERE id = $1', [req.params.infractionId]);
    if (iRows.length === 0) return res.status(404).json({ error: 'Infraction introuvable.' });
    const plainte = await loadPlainteForCheck(iRows[0].plainte_id);
    if (!plainte || !canManage(plainte, req.session.user)) return res.status(403).json({ error: 'Accès refusé à cette plainte.' });

    await pool.query('DELETE FROM plainte_infractions WHERE id = $1', [req.params.infractionId]);
    res.json({ message: 'Infraction retirée.' });
  } catch (err) {
    console.error('[plaintes/infractions/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
