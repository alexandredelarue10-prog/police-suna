-- ============================================================
-- Schéma de la base de données — Police de Sunagakure
-- ============================================================

-- GRADES (postes hiérarchiques de la police) : entièrement modifiables via l'interface admin
CREATE TABLE IF NOT EXISTS grades (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(60) NOT NULL UNIQUE,
  niveau INTEGER NOT NULL DEFAULT 0,       -- plus haut = plus gradé
  couleur VARCHAR(7) NOT NULL DEFAULT '#C9A227', -- couleur badge (hex)
  peut_valider_comptes BOOLEAN NOT NULL DEFAULT FALSE,
  peut_gerer_grades BOOLEAN NOT NULL DEFAULT FALSE,
  peut_gerer_sanctions BOOLEAN NOT NULL DEFAULT FALSE,
  peut_gerer_casiers BOOLEAN NOT NULL DEFAULT FALSE,
  peut_gerer_actus BOOLEAN NOT NULL DEFAULT FALSE,
  peut_gerer_protocoles BOOLEAN NOT NULL DEFAULT FALSE, -- codes d'alerte
  reserve BOOLEAN NOT NULL DEFAULT FALSE, -- grade exclusif : ne peut être attribué à personne via l'interface
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS reserve BOOLEAN NOT NULL DEFAULT FALSE;

-- RANGS NINJA (Genin, Chûnin, Kakunin, TKJ, Jônin...) : entièrement modifiables via l'interface admin
-- Distinct du "grade" (poste au sein de la police) : c'est une étiquette purement informative.
CREATE TABLE IF NOT EXISTS rangs_ninja (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(60) NOT NULL UNIQUE,
  niveau INTEGER NOT NULL DEFAULT 0,
  couleur VARCHAR(7) NOT NULL DEFAULT '#3E5C6B',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- UTILISATEURS
-- Deux hiérarchies distinctes chez la police de Suna : le "poste" (grade_id -> permissions du site)
-- et le "rang ninja" (rang_id -> étiquette informative, entièrement gérable via /admin-rangs.html).
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nom_complet VARCHAR(100),
  grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
  rang_ninja VARCHAR(40) DEFAULT '', -- ancien champ texte, conservé pour migration douce
  rang_id INTEGER REFERENCES rangs_ninja(id) ON DELETE SET NULL,
  brigade VARCHAR(80) DEFAULT '', -- ex: "Brigade de déminage"
  statut VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | approuve | refuse
  matricule VARCHAR(20) UNIQUE,
  protege BOOLEAN NOT NULL DEFAULT FALSE, -- compte protégé (ex: DEV) : grade/rang/suppression verrouillés
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  valide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  valide_le TIMESTAMPTZ
);
-- Migrations idempotentes : ajoutent les colonnes si la table existait déjà sans elles
ALTER TABLE users ADD COLUMN IF NOT EXISTS protege BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rang_id INTEGER REFERENCES rangs_ninja(id) ON DELETE SET NULL;

-- TYPES DE SANCTIONS (code pénal) : entièrement modifiables (article, amende, cellule/TIG, gravité...)
CREATE TABLE IF NOT EXISTS sanctions_types (
  id SERIAL PRIMARY KEY,
  code_juridique VARCHAR(60) NOT NULL DEFAULT 'Village', -- 'Village' | 'Pays du Vent'
  categorie VARCHAR(60) NOT NULL DEFAULT 'Délits mineurs', -- Délits mineurs | Délits majeurs | Crimes
  article VARCHAR(20) DEFAULT '',
  nom VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  amende INTEGER, -- en ryō, NULL si pas d'amende fixe (-> jugement)
  cellule_tig VARCHAR(100) DEFAULT '', -- ex : "10 min", "Jugement", "T.I.G"
  gravite INTEGER NOT NULL DEFAULT 1, -- 1 (mineur) à 5 (critique)
  ordre INTEGER NOT NULL DEFAULT 0,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SYSTÈME DE BLÂMES : entièrement modifiable
CREATE TABLE IF NOT EXISTS blames (
  id SERIAL PRIMARY KEY,
  niveau INTEGER NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SYSTÈME DE RÉCIDIVE GLOBALE : entièrement modifiable
CREATE TABLE IF NOT EXISTS recidives (
  id SERIAL PRIMARY KEY,
  occurrence VARCHAR(20) NOT NULL, -- "1ère", "2ème", ...
  ordre INTEGER NOT NULL DEFAULT 0,
  amende_multiplicateur NUMERIC(4,2), -- ex 1.5 (NULL = sans objet)
  cellule_multiplicateur NUMERIC(4,2),
  blame_niveau INTEGER, -- niveau de blâme appliqué (NULL si aucun)
  description_speciale VARCHAR(200) DEFAULT '', -- ex : "Emprisonnement à vie (RPK)"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CODES D'ALERTE (protocole officiel) : entièrement modifiables
CREATE TABLE IF NOT EXISTS codes_alerte (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(40) NOT NULL, -- Bleu, Jaune, Orange, Rouge, Noir
  couleur VARCHAR(7) NOT NULL DEFAULT '#3E5C6B',
  ordre INTEGER NOT NULL DEFAULT 0,
  description_courte VARCHAR(200) DEFAULT '',
  declenchement_situation TEXT DEFAULT '',
  declenchement_infos TEXT DEFAULT '',
  declenchement_autorisation TEXT DEFAULT '',
  mobilisation_alerte TEXT DEFAULT '',
  mobilisation_effectif TEXT DEFAULT '',
  mobilisation_zones TEXT DEFAULT '',
  actions TEXT DEFAULT '', -- une action par ligne
  actif BOOLEAN NOT NULL DEFAULT FALSE, -- niveau actuellement en vigueur (un seul à la fois)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE codes_alerte ADD COLUMN IF NOT EXISTS actif BOOLEAN NOT NULL DEFAULT FALSE;

-- CASIERS JUDICIAIRES
CREATE TABLE IF NOT EXISTS casiers (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(80) NOT NULL,
  prenom VARCHAR(80) DEFAULT '',
  surnom VARCHAR(80) DEFAULT '',
  village VARCHAR(80) DEFAULT '',
  age INTEGER,
  statut VARCHAR(30) NOT NULL DEFAULT 'libre', -- libre | recherche | detention | liberation_conditionnelle
  photo_url TEXT DEFAULT '',
  description TEXT DEFAULT '',
  niveau_danger INTEGER NOT NULL DEFAULT 1, -- 1 à 5
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- INFRACTIONS liées à un casier (une ligne = une sanction appliquée)
CREATE TABLE IF NOT EXISTS casier_infractions (
  id SERIAL PRIMARY KEY,
  casier_id INTEGER NOT NULL REFERENCES casiers(id) ON DELETE CASCADE,
  sanction_id INTEGER REFERENCES sanctions_types(id) ON DELETE SET NULL,
  titre VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  amende_appliquee INTEGER,
  cellule_appliquee VARCHAR(100) DEFAULT '',
  occurrence_recidive VARCHAR(20) DEFAULT '',
  date_infraction DATE NOT NULL DEFAULT CURRENT_DATE,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ACTUALITÉS / COMMUNIQUÉS (vitrine publique)
CREATE TABLE IF NOT EXISTS actus (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  contenu TEXT NOT NULL,
  auteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  epingle BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- JOURNAL D'ACTIVITÉ : trace les actions administratives (audit)
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username_snapshot VARCHAR(40) DEFAULT '', -- conserve le nom même si le compte est supprimé plus tard
  action VARCHAR(60) NOT NULL, -- ex: 'compte_valide', 'grade_modifie', 'casier_cree'...
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);

-- DOSSIER DISCIPLINAIRE : blâmes appliqués à un agent (distinct du système de blâmes générique)
CREATE TABLE IF NOT EXISTS user_blames (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blame_niveau INTEGER NOT NULL,
  motif TEXT DEFAULT '',
  applique_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_blames_user ON user_blames(user_id);

-- PLANNING DE SERVICE / PATROUILLES
CREATE TABLE IF NOT EXISTS patrouilles (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  date_service DATE NOT NULL,
  heure_debut VARCHAR(10) DEFAULT '',
  heure_fin VARCHAR(10) DEFAULT '',
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT DEFAULT '',
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_patrouilles_date ON patrouilles(date_service);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_users_statut ON users(statut);
CREATE INDEX IF NOT EXISTS idx_casiers_nom ON casiers(nom);
CREATE INDEX IF NOT EXISTS idx_casier_infractions_casier ON casier_infractions(casier_id);
CREATE INDEX IF NOT EXISTS idx_actus_created ON actus(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_code_cat ON sanctions_types(code_juridique, categorie);
