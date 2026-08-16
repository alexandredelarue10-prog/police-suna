# Police de Sunagakure — Site officiel

Site de gestion pour la police de Suna (RP Naruto) : vitrine publique, organigramme, code pénal
complet, casiers judiciaires, et système de comptes avec validation par les hauts gradés.

Construit en **Node.js + Express + PostgreSQL**, front-end en HTML/CSS/JS pur (aucun framework
lourd) pour rester très léger en consommation de données et en ressources serveur.

## Fonctionnalités

- **Comptes & grades** : inscription publique → statut "en attente" → validation par un haut
  gradé qui choisit le grade (poste) et le rang ninja. Grades entièrement modifiables (nom,
  niveau hiérarchique, couleur, permissions) depuis l'interface, sans toucher au code.
- **Code pénal modulable** : tous les articles (village + Pays du Vent), le système de blâmes et
  le système de récidive sont éditables depuis le site par les gradés habilités.
- **Codes d'alerte / protocoles** : les 5 niveaux (Bleu à Noir) avec déclenchement, mobilisation
  et actions, éditables.
- **Casiers judiciaires** : fiche par individu, historique d'infractions rattachées au code
  pénal (amende, cellule/T.I.G, récidive).
- **Organigramme public** et **communiqués officiels** sur la page d'accueil.
- **Compte principal** créé automatiquement au premier démarrage :
  - Identifiant : `lexioui`
  - Mot de passe : `roidudev`
  - Grade : Dirigeant (tous les droits)
  - **Change ce mot de passe dès le premier déploiement** (page "Mon profil" une fois connecté).

## Structure du projet

```
suna-police/
├── server.js                 # point d'entrée
├── src/
│   ├── config/db.js          # connexion PostgreSQL
│   ├── db/schema.sql         # schéma complet
│   ├── db/seed.js            # données de départ (idempotent, sans danger à relancer)
│   ├── middleware/auth.js    # auth + permissions
│   └── routes/               # API (auth, users, grades, sanctions, blames, recidives, alertes, casiers, actus)
└── public/                   # front-end statique (HTML/CSS/JS, aucun build nécessaire)
```

---

## 1. Déploiement sur GitHub

```bash
cd suna-police
git init
git add .
git commit -m "Site police de Sunagakure"
git branch -M main
git remote add origin https://github.com/<ton-compte>/<ton-repo>.git
git push -u origin main
```

Le fichier `.gitignore` exclut déjà `node_modules/` et `.env` — ne les commite jamais
(le `.env` contient des secrets une fois rempli).

## 2. Déploiement sur Railway

1. Va sur [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** →
   sélectionne ton dépôt.
2. **Ajoute une base de données** : dans le projet Railway, clique **+ New** → **Database** →
   **Add PostgreSQL**. Railway crée automatiquement la variable `DATABASE_URL` et la partage
   avec ton service si les deux sont dans le même projet (sinon, copie la valeur manuellement).
3. **Variables d'environnement** du service web (onglet *Variables*) :
   - `DATABASE_URL` → normalement injectée automatiquement par le plugin PostgreSQL (référence
     `${{Postgres.DATABASE_URL}}` si Railway te le propose).
   - `SESSION_SECRET` → génère une chaîne aléatoire longue (ex : `openssl rand -hex 32`).
   - `NODE_ENV` → `production`.
   - `PORT` → laissé vide, Railway le fournit automatiquement.
4. Railway détecte `package.json` et lance `npm install` puis `npm start` automatiquement.
5. Au premier démarrage, le serveur crée les tables et les données de départ tout seul
   (`src/db/seed.js` est appelé automatiquement par `server.js`, et il est **idempotent** : le
   relancer à chaque redéploiement ne duplique rien et ne casse rien).
6. Une fois déployé, Railway te donne une URL publique (`*.up.railway.app`). Tu peux ensuite
   brancher un nom de domaine personnalisé dans l'onglet *Settings → Domains*.

### Vérifier que tout s'est bien passé

- `https://ton-site.up.railway.app/api/health` doit renvoyer `{"status":"ok"}`.
- Connecte-toi avec `lexioui` / `roidudev`, va sur **Mon profil** et change le mot de passe
  immédiatement.

---

## 3. Reconstituer l'effectif actuel

Le site part avec une base vide (à part le compte `lexioui`). Pour retrouver l'organigramme
réel (Ryu, Kentaro Ayatsuri, etc.) :

1. Chaque membre va sur **Demander un accès** et crée son propre compte.
2. Un haut gradé (Dirigeant ou Gérant) va sur **Gestion des comptes**, valide chaque demande,
   choisit le **grade (poste)** correspondant (Dirigeant / Gérant / Inspecteur confirmé /
   Inspecteur en test) et le **rang ninja** (Genin, Chûnin, Kakunin, TKJ, Jônin).
3. Le champ "brigade" (ex : *Brigade de déminage*) peut être ajouté/modifié directement en base
   ou via une prochaine évolution de l'interface si besoin.

## 4. Modifier le code pénal, les grades, les protocoles

Tout est pensé pour ne jamais toucher au code :

- **Grades** (`/admin-grades.html`) : créer/modifier/supprimer un grade, définir son niveau
  hiérarchique, sa couleur, et cocher les permissions qu'il donne (valider les comptes, gérer
  les grades, gérer le code pénal, gérer les casiers, publier des communiqués, gérer les
  protocoles).
- **Code pénal** (`/code-penal.html`) : ajouter/modifier/supprimer un article (numéro, catégorie,
  amende en ryō, cellule/T.I.G), le système de blâmes et les paliers de récidive.
- **Protocoles** (`/protocoles.html`) : éditer chaque code d'alerte (Bleu à Noir) — situation de
  déclenchement, mobilisation, actions à mener. Seul "Bleu" est pré-rempli avec le contenu
  fourni ; les 4 autres sont à compléter via l'interface.
- **Casiers** (`/casiers.html`) : gestion complète des dossiers et de leurs infractions.
- **Communiqués** (`/admin-actus.html`) : publications visibles sur la page d'accueil.

## 5. Développement local

```bash
npm install
cp .env.example .env   # puis renseigne DATABASE_URL vers une base PostgreSQL locale ou distante
npm start
```

Le serveur tourne par défaut sur `http://localhost:3000`.

## 6. Notes sur la faible consommation

- Aucun framework front-end (pas de React/Vue/bundler) : pages HTML statiques + JS vanilla.
- Aucune image raster : le sceau du village et tous les visuels sont en CSS pur.
- Deux familles de police seulement, chargées une fois et mises en cache par le navigateur.
- Sessions stockées en base (pas de dépendance à un service externe type Redis).
- Pool de connexions PostgreSQL limité à 5 connexions simultanées.
- Fichiers statiques servis avec cache navigateur (1h).
