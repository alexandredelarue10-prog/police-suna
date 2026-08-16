const { Pool } = require('pg');

// Railway fournit DATABASE_URL automatiquement quand on ajoute le plugin PostgreSQL.
// max: 5 -> suffisant pour un petit site, évite de saturer les connexions sur un plan gratuit.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
});

pool.on('error', (err) => {
  console.error('[db] Erreur inattendue sur le pool PostgreSQL :', err);
});

module.exports = pool;
