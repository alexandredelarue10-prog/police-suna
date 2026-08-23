// Vérifie que l'utilisateur est connecté (session active + compte approuvé)
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Non authentifié.' });
  }
  next();
}

// Fabrique un middleware qui vérifie qu'une permission précise (colonne booléenne de `grades`) est vraie
function requirePermission(permKey) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Non authentifié.' });
    }
    if (!req.session.user.permissions || !req.session.user.permissions[permKey]) {
      return res.status(403).json({ error: 'Permission insuffisante pour cette action.' });
    }
    next();
  };
}

// Fabrique un middleware qui vérifie que l'utilisateur appartient à un pôle précis
// (Administratif, Enquête, Sécurité...). Indépendant du système de grades/permissions.
function requirePole(poleNom) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ error: 'Non authentifié.' });
    }
    if (!Array.isArray(req.session.user.poles) || !req.session.user.poles.includes(poleNom)) {
      return res.status(403).json({ error: `Réservé aux membres du pôle ${poleNom}.` });
    }
    next();
  };
}

module.exports = { requireAuth, requirePermission, requirePole };
