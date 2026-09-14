// Synchronisation en direct entre utilisateurs connectés, via Server-Sent Events (SSE).
// Choix volontaire face à WebSocket : SSE tient en quelques lignes côté client (EventSource
// natif, aucune librairie), se reconnecte tout seul, et suffit largement au besoin ici
// (pousser "telle ressource a changé" pour déclencher un rafraîchissement) — cohérent avec
// la philosophie "frontend vanilla, faible consommation" du projet.
//
// Fonctionnement : chaque onglet ouvert d'un utilisateur connecté garde une connexion HTTP
// ouverte sur GET /api/events. Quand une action modifie une ressource, le serveur appelle
// broadcast(domain, ...) qui pousse un petit message à tous les onglets ouverts. Le
// JavaScript commun (public/js/common.js) écoute ces messages et déclenche un rafraîchissement
// des données de la page si elle est concernée par le domaine reçu.

const clients = new Set();

function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // évite qu'un proxy ne mette la réponse en tampon
  });
  res.write('retry: 3000\n\n');
  clients.add(res);

  // Garde la connexion ouverte à travers les proxys (Railway coupe les connexions HTTP inactives)
  const keepAlive = setInterval(() => {
    try { res.write(':keep-alive\n\n'); } catch (_) { /* le client a déjà été retiré */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepAlive);
    clients.delete(res);
  });
}

// Associe chaque action du journal d'activité à un domaine de synchronisation. Toute action
// non listée ici tombe dans 'general' (le journal d'activité, lui, écoute tout via '*').
const ACTION_DOMAINS = {
  compte_valide: 'users', compte_refuse: 'users', compte_supprime: 'users',
  grade_modifie: 'users', rang_modifie: 'users', discord_id_modifie: 'users',
  poles_modifies: 'users', blame_applique: 'users', role_judiciaire_modifie: 'users', chakra_coupe_modifie: 'users',
  grade_cree: 'grades', grade_edite: 'grades', grade_supprime: 'grades',
  casier_cree: 'casiers', casier_supprime: 'casiers', infraction_ajoutee: 'casiers',
  plainte_deposee: 'plaintes', plainte_modifiee: 'plaintes', plainte_supprimee: 'plaintes',
  alerte_activee: 'alertes',
  article_penal_edite: 'code-penal',
  patrouille_creee: 'patrouilles', planning_config_modifiee: 'patrouilles', planning_genere: 'patrouilles',
  formation_creee: 'administratif',
  enquete_ouverte: 'enquetes',
  escorte_creee: 'securite', incident_signale: 'securite',
  credits_modifies: 'settings',
  affaire_ouverte: 'judiciaire', role_judiciaire_cree: 'judiciaire', role_judiciaire_edite: 'judiciaire', role_judiciaire_supprime: 'judiciaire',
};

// Diffuse un événement à tous les onglets connectés. `domain` sert de filtre côté client
// (les pages n'écoutent que ce qui les concerne) ; `payload` peut porter des infos utiles
// (action, details...) mais reste volontairement léger — les clients rechargent leurs
// données via l'API plutôt que de recevoir l'objet complet en push.
function broadcast(domain, payload = {}) {
  const message = JSON.stringify({ domain, ...payload, ts: Date.now() });
  for (const res of clients) {
    try {
      res.write(`data: ${message}\n\n`);
    } catch (_) {
      clients.delete(res);
    }
  }
}

// Diffuse automatiquement à partir d'une action du journal d'activité (voir activityLog.js).
function broadcastFromActivity(action, details) {
  const domain = ACTION_DOMAINS[action] || 'general';
  broadcast(domain, { action, details });
}

module.exports = { sseHandler, broadcast, broadcastFromActivity };
