const pool = require('../config/db');

// Notifications Discord : envoi d'un DM privé au joueur concerné par un événement du site
// (validation de compte, changement de grade/rang, message interne, planning, blâme...).
// Nécessite un bot Discord invité sur un serveur partagé avec les joueurs (un DM ne peut
// être ouvert par un bot que s'il partage un serveur avec le destinataire).
//
// Ne doit jamais faire planter le flux applicatif qui déclenche la notification : toute
// erreur (bot non configuré, ID absent, DM refusés côté utilisateur...) est avalée et loggée.

let client = null;
let pret = false;

function initDiscordClient() {
  if (client) return client;

  if (!process.env.DISCORD_BOT_TOKEN) {
    console.warn('[discord] DISCORD_BOT_TOKEN absent — notifications Discord désactivées.');
    return null;
  }

  // Chargement paresseux : évite de casser le démarrage du serveur si le paquet
  // discord.js n'est pas encore installé (`npm install discord.js`).
  let Client, GatewayIntentBits;
  try {
    ({ Client, GatewayIntentBits } = require('discord.js'));
  } catch (err) {
    console.warn('[discord] Paquet "discord.js" introuvable — exécuter `npm install discord.js`. Notifications désactivées.');
    return null;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages] });

  client.once('ready', () => {
    pret = true;
    console.log(`[discord] Bot connecté en tant que ${client.user.tag}`);
  });
  client.on('error', (err) => console.error('[discord] Erreur du client :', err.message));

  client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
    console.error('[discord] Échec de connexion du bot :', err.message);
  });

  return client;
}

/**
 * Envoie un DM à un utilisateur Discord donné par son ID (Snowflake).
 * @returns {Promise<{success: boolean, reason?: string}>}
 */
async function envoyerDM(discordId, message) {
  if (!discordId) return { success: false, reason: 'id_discord_absent' };

  const c = initDiscordClient();
  if (!c) return { success: false, reason: 'bot_non_configure' };
  if (!pret) return { success: false, reason: 'bot_non_connecte' };

  try {
    const user = await c.users.fetch(discordId);
    await user.send(message);
    return { success: true };
  } catch (err) {
    console.error(`[discord] Échec envoi DM à ${discordId} :`, err.message);
    return { success: false, reason: err.message };
  }
}

/**
 * Notifie un compte du site (table users) par son ID interne — lookup du discord_id en base.
 * Best-effort : ne lève jamais d'exception vers l'appelant.
 */
async function notifierUser(userId, message) {
  try {
    if (!userId) return { success: false, reason: 'user_id_absent' };
    const { rows } = await pool.query('SELECT discord_id FROM users WHERE id = $1', [userId]);
    const discordId = rows[0]?.discord_id;
    if (!discordId) return { success: false, reason: 'pas_d_id_discord_configure' };
    return await envoyerDM(discordId, message);
  } catch (err) {
    console.error('[discord] Erreur notifierUser :', err.message);
    return { success: false, reason: err.message };
  }
}

// Initialise le bot dès le chargement du module (au démarrage du serveur), sans attendre
// le premier événement à notifier — évite un délai de connexion sur la toute première notif.
initDiscordClient();

module.exports = { envoyerDM, notifierUser };
