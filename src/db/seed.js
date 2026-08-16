// Script d'initialisation de la base de données.
// Exécuté automatiquement au démarrage du serveur (idempotent : peut être relancé sans casser les données).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

async function run() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[seed] Schéma appliqué.');

  // --- Grades par défaut : hiérarchie réelle de la police de Suna ---
  const { rows: gradeCount } = await pool.query('SELECT COUNT(*)::int AS n FROM grades');
  if (gradeCount[0].n === 0) {
    const grades = [
      // nom, niveau, couleur, valider_comptes, gerer_grades, gerer_sanctions, gerer_casiers, gerer_actus, gerer_protocoles
      ['Dirigeant',             100, '#7A2E2E', true,  true,  true,  true,  true,  true],
      ['Gérant',                 80, '#A0521F', true,  false, true,  true,  true,  true],
      ['Inspecteur confirmé',    50, '#B8922F', false, false, false, true,  false, false],
      ['Inspecteur en test',     20, '#3E5C6B', false, false, false, false, false, false],
    ];
    for (const g of grades) {
      await pool.query(
        `INSERT INTO grades (nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        g
      );
    }
    console.log('[seed] Grades par défaut créés.');
  }

  // --- Code pénal par défaut (uniquement si la table est vide) ---
  const { rows: sanctionCount } = await pool.query('SELECT COUNT(*)::int AS n FROM sanctions_types');
  if (sanctionCount[0].n === 0) {
    // code_juridique, categorie, article, nom, amende, cellule_tig, gravite, ordre
    const sanctions = [
      // ◈ DROIT INTERNE DU VILLAGE — Délits mineurs
      ['Village', 'Délits mineurs', '1.1', "Utilisation de jutsu / taijutsu en dehors des zones d'entraînement", 150000, '10 min', 1, 1],
      ['Village', 'Délits mineurs', '1.2', 'Saut de chakra et utilisation du grapin dans le village / Jutsu de déplacement (ex : Éventail, Nuage de Sable, Verrou Psychique, Oiseau Bakuton)', 30000, '10 min', 1, 2],
      ['Village', 'Délits mineurs', '1.3', 'Port du masque / mi-masque interdit dans le village (autorisation / TKJ)', 100000, '10 min', 1, 3],
      ['Village', 'Délits mineurs', '1.4', 'Circuler sur les toits ou les murs du village (y compris pour les domaines)', 80000, '10 min', 1, 4],
      ['Village', 'Délits mineurs', '1.5', "Entrée dans un établissement interdit / refus de rassemblement", 100000, '10 min', 1, 5],
      ['Village', 'Délits mineurs', '1.6', 'Rentrer au Palais du Kazekage sans y être convié', 150000, '10 min', 2, 6],
      ['Village', 'Délits mineurs', '1.7', "Ne pas s'agenouiller face à un membre du haut commandement (Commandant jônin et +)", 50000, '5 min', 1, 7],
      ['Village', 'Délits mineurs', '1.8', 'Mettre en danger la vie d\'autrui en le portant sur sa tête et non sur le dos', 50000, '5 min', 1, 8],
      ['Village', 'Délits mineurs', '1.9', "Perturber l'ordre public", 100000, '15 min', 1, 9],
      ['Village', 'Délits mineurs', '1.10', 'Escalader toute sorte de murets, mur ou infrastructure appartenant au village de Sunagakure sera considéré comme de la dégradation', 100000, '5 min', 1, 10],

      // Délits majeurs — Village
      ['Village', 'Délits majeurs', '2.1', "Manque de respect envers un supérieur hiérarchique — Manque de respect envers un membre de la police", 300000, '30 min', 2, 11],
      ['Village', 'Délits majeurs', '2.2', 'Menaces ou insultes envers autrui', 100000, '10 min', 2, 12],
      ['Village', 'Délits majeurs', '2.3', 'Coups / blessures volontaires sur autrui', 200000, 'Jugement', 3, 13],
      ['Village', 'Délits majeurs', '2.4', 'Dégradation de biens publics', 100000, '10 min / T.I.G', 2, 14],
      ['Village', 'Délits majeurs', '2.5', "Usurpation d'identité", 100000, '10 min', 2, 15],
      ['Village', 'Délits majeurs', '2.6', 'Manque de respect envers un Haut Commandant de Suna (Jônin+)', 300000, 'Jugement', 3, 16],

      // Crimes — Village
      ['Village', 'Crimes', '3.1', 'Acte de rébellion', null, 'Jugement', 5, 17],
      ['Village', 'Crimes', '3.2', 'Assassinat / homicide volontaire / tentative de meurtre', null, 'Jugement', 5, 18],
      ['Village', 'Crimes', '3.3', 'Trahison envers le village', null, 'Jugement', 5, 19],
      ['Village', 'Crimes', '3.4', 'Détournement de fonds publics destinés au village', null, 'Jugement', 4, 20],
      ['Village', 'Crimes', '3.5', "Prise d'otage / kidnapping", null, 'Jugement', 5, 21],
      ['Village', 'Crimes', '3.6', "Divulgation d'informations confidentielles", 300000, 'Jugement', 4, 22],

      // ◈ CODE PÉNAL DU PAYS DU VENT — Délits majeurs
      ['Pays du Vent', 'Délits majeurs', '4.1', 'Incompétence ou négligence lors des missions / diplomatie', 250000, '20 min', 2, 23],
      ['Pays du Vent', 'Délits majeurs', '4.2', "Perturber l'ordre public", 80000, '15 min', 2, 24],
      ['Pays du Vent', 'Délits majeurs', '4.3', 'Manipulation ou extorsion de ressources appartenant au village', 300000, '20 min', 3, 25],

      // Crimes — Pays du Vent
      ['Pays du Vent', 'Crimes', '5.1', 'Non-respect de la diplomatie du village', null, 'Jugement', 5, 26],
      ['Pays du Vent', 'Crimes', '5.2', "Attaque d'une délégation étrangère invitée par le village", null, 'Jugement', 5, 27],
    ];
    for (const s of sanctions) {
      await pool.query(
        `INSERT INTO sanctions_types (code_juridique, categorie, article, nom, amende, cellule_tig, gravite, ordre)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        s
      );
    }
    console.log('[seed] Code pénal par défaut créé.');
  }

  // --- Système de blâmes (uniquement si la table est vide) ---
  const { rows: blameCount } = await pool.query('SELECT COUNT(*)::int AS n FROM blames');
  if (blameCount[0].n === 0) {
    const blames = [
      [1, 'Interdiction de participer au prochain examen.'],
      [2, 'Rétrogradation de 1 rang + interdiction aux examens pendant 1 semaine.'],
      [3, 'Rétrogradation de 2 rangs + interdiction aux examens pendant 1 semaine.'],
      [4, 'Passage devant le Conseil Judiciaire, sanction établie en aval (risque de RPK suivant circonstances).'],
    ];
    for (const b of blames) {
      await pool.query('INSERT INTO blames (niveau, description) VALUES ($1,$2)', b);
    }
    console.log('[seed] Système de blâmes créé.');
  }

  // --- Système de récidive globale (uniquement si la table est vide) ---
  const { rows: recidiveCount } = await pool.query('SELECT COUNT(*)::int AS n FROM recidives');
  if (recidiveCount[0].n === 0) {
    // occurrence, ordre, amende_mult, cellule_mult, blame_niveau, description_speciale
    const recidives = [
      ['1ère', 1, 1.5, null, null, "Aucun blâme — système de dernière chance et bonne foi."],
      ['2ème', 2, 1.5, 2, 1, ''],
      ['3ème', 3, 2, 2, 2, ''],
      ['4ème', 4, 2.5, 2.5, 3, ''],
      ['5ème', 5, 3, 3, 4, ''],
      ['6ème', 6, null, null, null, 'Emprisonnement à vie (RPK).'],
    ];
    for (const r of recidives) {
      await pool.query(
        `INSERT INTO recidives (occurrence, ordre, amende_multiplicateur, cellule_multiplicateur, blame_niveau, description_speciale)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        r
      );
    }
    console.log('[seed] Système de récidive créé.');
  }

  // --- Codes d'alerte (uniquement si la table est vide) ---
  const { rows: alerteCount } = await pool.query('SELECT COUNT(*)::int AS n FROM codes_alerte');
  if (alerteCount[0].n === 0) {
    const alertes = [
      {
        nom: 'Bleu', couleur: '#3E5C6B', ordre: 1,
        description_courte: 'Vigilance renforcée — menace faible, précautionnaire',
        declenchement_situation: 'Individu suspect repéré, tension inhabituelle.',
        declenchement_infos: 'Signalement par missive — localisation.',
        declenchement_autorisation: '—',
        mobilisation_alerte: 'Police de Suna et haut-gradés.',
        mobilisation_effectif: 'Police de Suna.',
        mobilisation_zones: 'Village et abords du village.',
        actions: [
          'Mise en alerte des effectifs de police.',
          'Intervention des effectifs de police sur place pour la dissuasion.',
          'Contrôle des individus ou de la situation.',
          'Écart des bas-gradés de la localisation par prévention.',
          'Communication : rapport de situation toutes les 5 minutes.',
        ].join('\n'),
      },
      {
        nom: 'Jaune', couleur: '#B8922F', ordre: 2,
        description_courte: 'Alerte modérée — menace possible',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '',
      },
      {
        nom: 'Orange', couleur: '#B8642E', ordre: 3,
        description_courte: 'Alerte élevée — menace confirmée',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '',
      },
      {
        nom: 'Rouge', couleur: '#7A2E2E', ordre: 4,
        description_courte: 'Alerte maximale — danger imminent',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '',
      },
      {
        nom: 'Noir', couleur: '#17150F', ordre: 5,
        description_courte: 'Urgence absolue — survie du village en jeu',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '',
      },
    ];
    for (const a of alertes) {
      await pool.query(
        `INSERT INTO codes_alerte (nom, couleur, ordre, description_courte, declenchement_situation, declenchement_infos, declenchement_autorisation, mobilisation_alerte, mobilisation_effectif, mobilisation_zones, actions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [a.nom, a.couleur, a.ordre, a.description_courte, a.declenchement_situation, a.declenchement_infos, a.declenchement_autorisation, a.mobilisation_alerte, a.mobilisation_effectif, a.mobilisation_zones, a.actions]
      );
    }
    console.log('[seed] Codes d\'alerte créés (Bleu détaillé, les autres sont à compléter dans "Protocoles").');
  }

  // --- Compte principal (créé uniquement s'il n'existe pas déjà) ---
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', ['lexioui']);
  if (existing.length === 0) {
    const { rows: dirigeant } = await pool.query("SELECT id FROM grades WHERE nom = 'Dirigeant' LIMIT 1");
    const gradeId = dirigeant[0] ? dirigeant[0].id : null;
    const hash = await bcrypt.hash('roidudev', 12);
    await pool.query(
      `INSERT INTO users (username, password_hash, nom_complet, grade_id, rang_ninja, statut, matricule, valide_le)
       VALUES ($1,$2,$3,$4,$5,'approuve',$6, now())`,
      ['lexioui', hash, 'Administrateur Principal', gradeId, 'Jônin', 'SUNA-0001']
    );
    console.log('[seed] Compte principal "lexioui" créé.');
  }

  console.log('[seed] Terminé.');
}

module.exports = run;

// Permet aussi de lancer ce fichier directement via `npm run seed`
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] Erreur :', err);
      process.exit(1);
    });
}
