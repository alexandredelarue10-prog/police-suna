const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireFondateur } = require('../middleware/auth');
const { logActivity } = require('../utils/activityLog');

const router = express.Router();

const DEFAULT_CREDITS = 'Site développé pour la Police de Sunagakure.';

// GET /api/settings/credits — public, affiché en pied de page sur tout le site
router.get('/credits', async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT valeur FROM site_settings WHERE cle = 'credits'");
    res.json({ credits: rows[0] ? rows[0].valeur : DEFAULT_CREDITS });
  } catch (err) {
    console.error('[settings/credits/get]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Middleware strict : réservé au compte protégé (DEV), indépendamment de tout système de permissions/grade.
function requireProtectedAccount(req, res, next) {
  if (!req.session.user.protege) {
    return res.status(403).json({ error: 'Seul le compte DEV peut modifier les crédits.' });
  }
  next();
}

// PUT /api/settings/credits — réservé au compte DEV
router.put('/credits', requireAuth, requireProtectedAccount, async (req, res) => {
  try {
    const { valeur } = req.body;
    if (valeur === undefined) return res.status(400).json({ error: 'Le texte des crédits est requis.' });

    await pool.query(
      `INSERT INTO site_settings (cle, valeur, updated_at) VALUES ('credits', $1, now())
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, updated_at = now()`,
      [valeur]
    );

    await logActivity(req.session.user.id, req.session.user.username, 'credits_modifies', 'Crédits du pied de page modifiés');

    res.json({ message: 'Crédits mis à jour.', credits: valeur });
  } catch (err) {
    console.error('[settings/credits/put]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// Fonction RP réservée au Fondateur : coupe le chakra du village entier — plus personne ne peut
// se connecter tant que c'est actif, à l'exception du Fondateur lui-même.
const CHAKRA_KEY = 'chakra_village_coupe';

// GET /api/settings/chakra-village — état du verrou (réservé au Fondateur, sert à afficher le bouton)
router.get('/chakra-village', requireAuth, requireFondateur, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT valeur FROM site_settings WHERE cle = $1`, [CHAKRA_KEY]);
    res.json({ coupe: rows[0] ? rows[0].valeur === 'true' : false });
  } catch (err) {
    console.error('[settings/chakra-village/get]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

// PUT /api/settings/chakra-village — active/désactive le verrou
router.put('/chakra-village', requireAuth, requireFondateur, async (req, res) => {
  try {
    const coupe = !!req.body.coupe;
    await pool.query(
      `INSERT INTO site_settings (cle, valeur, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (cle) DO UPDATE SET valeur = EXCLUDED.valeur, updated_at = now()`,
      [CHAKRA_KEY, coupe ? 'true' : 'false']
    );
    await logActivity(
      req.session.user.id, req.session.user.username, 'chakra_village_modifie',
      coupe ? 'Chakra du village coupé (verrouillage global)' : 'Chakra du village rétabli'
    );
    res.json({ message: coupe ? 'Le chakra du village est coupé.' : 'Le chakra du village est rétabli.', coupe });
  } catch (err) {
    console.error('[settings/chakra-village/put]', err);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

module.exports = router;
