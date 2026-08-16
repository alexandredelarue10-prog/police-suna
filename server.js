require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const pool = require('./src/config/db');
const runSeed = require('./src/db/seed');

const { router: authRoutes } = require('./src/routes/auth.routes');
const usersRoutes = require('./src/routes/users.routes');
const gradesRoutes = require('./src/routes/grades.routes');
const sanctionsRoutes = require('./src/routes/sanctions.routes');
const casiersRoutes = require('./src/routes/casiers.routes');
const newsRoutes = require('./src/routes/news.routes');
const blamesRoutes = require('./src/routes/blames.routes');
const recidivesRoutes = require('./src/routes/recidives.routes');
const alertesRoutes = require('./src/routes/alertes.routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1); // nécessaire derrière le proxy de Railway pour les cookies "secure"

app.use(express.json({ limit: '512kb' })); // limite légère : évite les payloads abusifs, garde le serveur léger

// Sessions stockées en base (persistant, léger, évite de perdre les connexions au redéploiement)
app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-a-changer',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 jours
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}));

// Fichiers statiques (HTML/CSS/JS) — pas de moteur de template = zéro rendu serveur = très léger
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// API
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/grades', gradesRoutes);
app.use('/api/sanctions', sanctionsRoutes);
app.use('/api/casiers', casiersRoutes);
app.use('/api/actus', newsRoutes);
app.use('/api/blames', blamesRoutes);
app.use('/api/recidives', recidivesRoutes);
app.use('/api/alertes', alertesRoutes);

// Vérification de santé pour Railway
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Toute autre route -> page 404 statique (le front est en pages HTML distinctes, pas de SPA routing complexe)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route API introuvable.' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

async function start() {
  try {
    await runSeed(); // crée les tables + données par défaut si nécessaire (idempotent)
    app.listen(PORT, () => {
      console.log(`[server] Police de Sunagakure en ligne sur le port ${PORT}`);
    });
  } catch (err) {
    console.error('[server] Échec du démarrage :', err);
    process.exit(1);
  }
}

start();
