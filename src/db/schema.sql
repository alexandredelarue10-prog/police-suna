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
  peut_configurer_planning BOOLEAN NOT NULL DEFAULT FALSE, -- automatisation du planning
  reserve BOOLEAN NOT NULL DEFAULT FALSE, -- grade exclusif : ne peut être attribué à personne via l'interface
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE grades ADD COLUMN IF NOT EXISTS reserve BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE grades ADD COLUMN IF NOT EXISTS peut_configurer_planning BOOLEAN NOT NULL DEFAULT FALSE;

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
-- groupe_id : quand plusieurs infractions sont ajoutées en une fois (sélection multiple),
-- elles partagent le même groupe_id afin d'être affichées regroupées dans un seul bandeau
-- avec le total des amendes additionné, plutôt que de multiplier les entrées séparées.
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
  groupe_id VARCHAR(40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE casier_infractions ADD COLUMN IF NOT EXISTS groupe_id VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_casier_infractions_groupe ON casier_infractions(groupe_id);

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
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- ancien champ (agent unique), conservé pour migration douce
  statut VARCHAR(20) NOT NULL DEFAULT 'planifiee', -- planifiee | en_cours | terminee | annulee
  notes TEXT DEFAULT '',
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE patrouilles ADD COLUMN IF NOT EXISTS statut VARCHAR(20) NOT NULL DEFAULT 'planifiee';
ALTER TABLE patrouilles ADD COLUMN IF NOT EXISTS auto_genere BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_patrouilles_date ON patrouilles(date_service);

-- Configuration de la génération automatique du planning (ligne unique)
CREATE TABLE IF NOT EXISTS planning_config (
  id SERIAL PRIMARY KEY,
  actif BOOLEAN NOT NULL DEFAULT FALSE,
  nombre_agents INTEGER NOT NULL DEFAULT 2, -- agents par patrouille générée
  patrouilles_par_jour INTEGER NOT NULL DEFAULT 2,
  jours_a_l_avance INTEGER NOT NULL DEFAULT 3, -- combien de jours à l'avance générer
  heure_debut_defaut VARCHAR(10) DEFAULT '08h00',
  duree_heures INTEGER NOT NULL DEFAULT 4,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Agents assignés à une patrouille : plusieurs personnes possibles par service
CREATE TABLE IF NOT EXISTS patrouille_agents (
  patrouille_id INTEGER NOT NULL REFERENCES patrouilles(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (patrouille_id, user_id)
);

-- PARAMÈTRES DU SITE (clé/valeur) : ex. crédits en pied de page, modifiables uniquement par DEV
CREATE TABLE IF NOT EXISTS site_settings (
  id SERIAL PRIMARY KEY,
  cle VARCHAR(60) NOT NULL UNIQUE,
  valeur TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DÉPÔTS DE PLAINTE : dossier détaillé, entièrement modifiable à tout moment (aucun verrouillage après création)
CREATE TABLE IF NOT EXISTS plaintes (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20) UNIQUE,
  plaignant_nom VARCHAR(120) NOT NULL,
  plaignant_contact VARCHAR(150) DEFAULT '', -- village, adresse, moyen de contact...
  mis_en_cause_nom VARCHAR(120) DEFAULT '',
  casier_id INTEGER REFERENCES casiers(id) ON DELETE SET NULL, -- lien optionnel vers un casier existant
  date_faits DATE,
  lieu_faits VARCHAR(150) DEFAULT '',
  description TEXT DEFAULT '', -- récit détaillé des faits
  statut VARCHAR(30) NOT NULL DEFAULT 'en_cours', -- en_cours | classee_sans_suite | transmise_tribunal | resolue
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- créateur de la plainte
  prive BOOLEAN NOT NULL DEFAULT FALSE, -- si vrai : visible uniquement par le créateur et les Gérant+ (peut_valider_comptes)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE plaintes ADD COLUMN IF NOT EXISTS prive BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_plaintes_statut ON plaintes(statut);
CREATE INDEX IF NOT EXISTS idx_plaintes_updated ON plaintes(updated_at DESC);

-- TÉMOIGNAGES liés à une plainte (plusieurs par plainte)
CREATE TABLE IF NOT EXISTS plainte_temoignages (
  id SERIAL PRIMARY KEY,
  plainte_id INTEGER NOT NULL REFERENCES plaintes(id) ON DELETE CASCADE,
  nom_temoin VARCHAR(120) NOT NULL,
  temoignage TEXT DEFAULT '',
  enregistre_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plainte_temoignages_plainte ON plainte_temoignages(plainte_id);

-- INFRACTIONS visées par une plainte (référence au code pénal, plusieurs possibles, modifiables à tout moment)
CREATE TABLE IF NOT EXISTS plainte_infractions (
  id SERIAL PRIMARY KEY,
  plainte_id INTEGER NOT NULL REFERENCES plaintes(id) ON DELETE CASCADE,
  sanction_id INTEGER REFERENCES sanctions_types(id) ON DELETE SET NULL,
  titre VARCHAR(200) NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plainte_infractions_plainte ON plainte_infractions(plainte_id);

-- NOTES INTERNES sur un casier (commentaires libres entre agents, distincts des infractions officielles)
CREATE TABLE IF NOT EXISTS casier_notes (
  id SERIAL PRIMARY KEY,
  casier_id INTEGER NOT NULL REFERENCES casiers(id) ON DELETE CASCADE,
  auteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contenu TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_casier_notes_casier ON casier_notes(casier_id);

-- PÔLES (Administratif, Enquête, Sécurité...) : un compte peut appartenir à plusieurs pôles.
-- Distinct du grade (poste hiérarchique) : c'est une spécialisation transversale.
CREATE TABLE IF NOT EXISTS poles (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(60) NOT NULL UNIQUE,
  resume VARCHAR(200) DEFAULT '', -- courte accroche
  description TEXT DEFAULT '', -- texte complet du rôle du pôle
  couleur VARCHAR(7) NOT NULL DEFAULT '#3E5C6B',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE poles ADD COLUMN IF NOT EXISTS resume VARCHAR(200) DEFAULT '';
CREATE TABLE IF NOT EXISTS user_poles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pole_id INTEGER NOT NULL REFERENCES poles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, pole_id)
);

-- PÔLE ADMINISTRATIF : formations
CREATE TABLE IF NOT EXISTS formations (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  description TEXT DEFAULT '',
  date_formation DATE,
  formateur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  statut VARCHAR(30) NOT NULL DEFAULT 'planifiee', -- planifiee | terminee | annulee
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS formation_participants (
  formation_id INTEGER NOT NULL REFERENCES formations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (formation_id, user_id)
);

-- PÔLE ENQUÊTE : dossiers d'enquête reliant plusieurs casiers et plaintes entre eux
CREATE TABLE IF NOT EXISTS enquetes (
  id SERIAL PRIMARY KEY,
  numero VARCHAR(20) UNIQUE,
  titre VARCHAR(150) NOT NULL,
  description TEXT DEFAULT '',
  statut VARCHAR(30) NOT NULL DEFAULT 'ouverte', -- ouverte | en_cours | cloturee
  enqueteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS enquete_numero_seq START 1;
CREATE TABLE IF NOT EXISTS enquete_casiers (
  enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  casier_id INTEGER NOT NULL REFERENCES casiers(id) ON DELETE CASCADE,
  PRIMARY KEY (enquete_id, casier_id)
);
CREATE TABLE IF NOT EXISTS enquete_plaintes (
  enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  plainte_id INTEGER NOT NULL REFERENCES plaintes(id) ON DELETE CASCADE,
  PRIMARY KEY (enquete_id, plainte_id)
);

-- PÔLE SÉCURITÉ : journal des incidents de sécurité
CREATE TABLE IF NOT EXISTS incidents_securite (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  description TEXT DEFAULT '',
  niveau_gravite INTEGER NOT NULL DEFAULT 1,
  lieu VARCHAR(150) DEFAULT '',
  date_incident DATE,
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Séquence dédiée aux matricules : indépendante du COUNT(*) des utilisateurs pour ne jamais
-- entrer en collision, même après suppression de comptes (contrairement à COUNT(*)+1).
CREATE SEQUENCE IF NOT EXISTS matricule_seq START 1;

-- Séquence dédiée aux numéros de plainte, même logique de sécurité.
CREATE SEQUENCE IF NOT EXISTS plainte_numero_seq START 1;

-- ============================================================
-- Compléments : enquête (chronologie, pièces), sécurité (entrées/sorties,
-- escortes, zones), administratif (congés, évaluations), casiers (mandats,
-- photos), annonces internes, annuaire, historique de connexion.
-- ============================================================

-- Historique de connexion
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ;

-- PÔLE ENQUÊTE : chronologie des événements d'un dossier
CREATE TABLE IF NOT EXISTS enquete_evenements (
  id SERIAL PRIMARY KEY,
  enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  date_evenement DATE,
  description TEXT NOT NULL,
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enquete_evenements_enquete ON enquete_evenements(enquete_id);

-- PÔLE ENQUÊTE : pièces à conviction
CREATE TABLE IF NOT EXISTS enquete_pieces (
  id SERIAL PRIMARY KEY,
  enquete_id INTEGER NOT NULL REFERENCES enquetes(id) ON DELETE CASCADE,
  nom VARCHAR(150) NOT NULL,
  description TEXT DEFAULT '',
  localisation VARCHAR(150) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enquete_pieces_enquete ON enquete_pieces(enquete_id);

-- PÔLE SÉCURITÉ : registre des entrées et sorties du village
CREATE TABLE IF NOT EXISTS entrees_sorties (
  id SERIAL PRIMARY KEY,
  nom_personne VARCHAR(150) NOT NULL,
  type VARCHAR(10) NOT NULL DEFAULT 'entree', -- entree | sortie
  motif VARCHAR(200) DEFAULT '',
  date_passage TIMESTAMPTZ NOT NULL DEFAULT now(),
  agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entrees_sorties_date ON entrees_sorties(date_passage DESC);

-- PÔLE SÉCURITÉ : escortes diplomatiques
CREATE TABLE IF NOT EXISTS escortes (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  destination VARCHAR(150) DEFAULT '',
  personnalite VARCHAR(150) DEFAULT '',
  date_debut DATE,
  date_fin DATE,
  statut VARCHAR(20) NOT NULL DEFAULT 'planifiee', -- planifiee | en_cours | terminee | annulee
  notes TEXT DEFAULT '',
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS escorte_agents (
  escorte_id INTEGER NOT NULL REFERENCES escortes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (escorte_id, user_id)
);

-- PÔLE SÉCURITÉ : niveau de sécurité par zone du village
CREATE TABLE IF NOT EXISTS zones_securite (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(100) NOT NULL UNIQUE,
  niveau INTEGER NOT NULL DEFAULT 1, -- 1 (calme) à 5 (critique)
  description TEXT DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PÔLE ADMINISTRATIF : demandes de congé
CREATE TABLE IF NOT EXISTS conges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_debut DATE NOT NULL,
  date_fin DATE NOT NULL,
  motif TEXT DEFAULT '',
  statut VARCHAR(20) NOT NULL DEFAULT 'en_attente', -- en_attente | approuve | refuse
  valide_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conges_user ON conges(user_id);

-- PÔLE ADMINISTRATIF : évaluations périodiques des inspecteurs
CREATE TABLE IF NOT EXISTS evaluations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  evaluateur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  note INTEGER NOT NULL DEFAULT 3, -- 1 à 5
  commentaire TEXT DEFAULT '',
  date_evaluation DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_evaluations_user ON evaluations(user_id);

-- CASIERS : mandats d'arrêt formels
CREATE TABLE IF NOT EXISTS mandats (
  id SERIAL PRIMARY KEY,
  casier_id INTEGER NOT NULL REFERENCES casiers(id) ON DELETE CASCADE,
  type VARCHAR(60) NOT NULL DEFAULT 'arrestation', -- arrestation | perquisition | comparution
  motif TEXT DEFAULT '',
  emis_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  date_emission DATE NOT NULL DEFAULT CURRENT_DATE,
  actif BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mandats_casier ON mandats(casier_id);

-- CASIERS : galerie de photos
CREATE TABLE IF NOT EXISTS casier_photos (
  id SERIAL PRIMARY KEY,
  casier_id INTEGER NOT NULL REFERENCES casiers(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  legende VARCHAR(150) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_casier_photos_casier ON casier_photos(casier_id);

-- ANNONCES INTERNES (distinctes des communiqués publics de l'accueil)
CREATE TABLE IF NOT EXISTS annonces_internes (
  id SERIAL PRIMARY KEY,
  titre VARCHAR(150) NOT NULL,
  contenu TEXT NOT NULL,
  auteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ANNUAIRE DES HABITANTS (contexte RP, pas forcément fichés judiciairement)
CREATE TABLE IF NOT EXISTS habitants (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(80) NOT NULL,
  prenom VARCHAR(80) DEFAULT '',
  village VARCHAR(80) DEFAULT '',
  profession VARCHAR(120) DEFAULT '',
  description TEXT DEFAULT '',
  cree_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_habitants_nom ON habitants(nom);

-- PÔLE ADMINISTRATIF : pointage/présence des agents (une entrée par agent et par jour)
CREATE TABLE IF NOT EXISTS presences (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_presence DATE NOT NULL DEFAULT CURRENT_DATE,
  present BOOLEAN NOT NULL DEFAULT TRUE,
  notes VARCHAR(200) DEFAULT '',
  enregistre_par INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date_presence)
);
CREATE INDEX IF NOT EXISTS idx_presences_date ON presences(date_presence);

-- MESSAGERIE INTERNE simple (boîte de réception / envoi entre membres)
CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  expediteur_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  destinataire_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contenu TEXT NOT NULL,
  lu BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_destinataire ON messages(destinataire_id, lu);

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_users_statut ON users(statut);
CREATE INDEX IF NOT EXISTS idx_casiers_nom ON casiers(nom);
CREATE INDEX IF NOT EXISTS idx_casier_infractions_casier ON casier_infractions(casier_id);
CREATE INDEX IF NOT EXISTS idx_actus_created ON actus(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sanctions_code_cat ON sanctions_types(code_juridique, categorie);
