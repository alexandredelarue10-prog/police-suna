const { Pool } = require('pg');

// L'hébergeur (Render, Neon...) fournit DATABASE_URL via une variable d'environnement.
// max: 5 -> suffisant pour un petit site, évite de saturer les connexions sur un plan gratuit.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  // Neon (et la plupart des Postgres managés) exigent une connexion chiffrée ; rejectUnauthorized:
  // false car ces fournisseurs utilisent des certificats non reconnus par la chaîne de confiance par défaut de Node.
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('[db] Erreur inattendue sur le pool PostgreSQL :', err);
});

module.exports = pool;
