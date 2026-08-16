const express = require('express');
const pool = require('../config/db');
const { requireAuth, requirePermission } = require('../middleware/auth');

const router = express.Router();

// GET /api/sanctions — public (le code pénal est un texte officiel consultable par tous)
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM sanctions_types ORDER BY code_juridique, categorie, ordre, article');
    res.json({ sanctions: rows });
  } catch (err) {
    console.error('[sanctions/list]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// POST /api/sanctions — créer un article du code pénal
router.post('/', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { code_juridique, categorie, article, nom, description, amende, cellule_tig, gravite, ordre } = req.body;
    if (!nom) return res.status(400).json({ error: "Le nom de l'infraction est requis." });
    const { rows } = await pool.query(
      `INSERT INTO sanctions_types (code_juridique, categorie, article, nom, description, amende, cellule_tig, gravite, ordre)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        code_juridique || 'Village',
        categorie || 'Délits mineurs',
        article || '',
        nom,
        description || '',
        amende === '' || amende === undefined ? null : amende,
        cellule_tig || '',
        gravite || 1,
        ordre || 0,
      ]
    );
    res.status(201).json({ sanction: rows[0] });
  } catch (err) {
    console.error('[sanctions/create]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/sanctions/:id — modifier
router.put('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { code_juridique, categorie, article, nom, description, amende, cellule_tig, gravite, ordre, actif } = req.body;
    const { rows } = await pool.query(
      `UPDATE sanctions_types SET code_juridique=$1, categorie=$2, article=$3, nom=$4, description=$5,
              amende=$6, cellule_tig=$7, gravite=$8, ordre=$9, actif=$10
       WHERE id=$11 RETURNING *`,
      [
        code_juridique || 'Village',
        categorie || 'Délits mineurs',
        article || '',
        nom,
        description || '',
        amende === '' || amende === undefined ? null : amende,
        cellule_tig || '',
        gravite || 1,
        ordre || 0,
        actif !== false,
        req.params.id,
      ]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Article introuvable.' });
    res.json({ sanction: rows[0] });
  } catch (err) {
    console.error('[sanctions/update]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// DELETE /api/sanctions/:id
router.delete('/:id', requireAuth, requirePermission('peut_gerer_sanctions'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM sanctions_types WHERE id = $1 RETURNING nom', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Article introuvable.' });
    res.json({ message: `Article "${rows[0].nom}" supprimé.` });
  } catch (err) {
    console.error('[sanctions/delete]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
