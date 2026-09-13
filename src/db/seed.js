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

  // --- Grades par défaut : hiérarchie réelle de la police de Suna + un grade réservé pour DEV ---
  const { rows: gradeCount } = await pool.query('SELECT COUNT(*)::int AS n FROM grades');
  if (gradeCount[0].n === 0) {
    const grades = [
      // nom, niveau, couleur, valider_comptes, gerer_grades, gerer_sanctions, gerer_casiers, gerer_actus, gerer_protocoles, configurer_planning, gerer_id_discord, reserve
      ['Fondateur',              999, '#17150F', true,  true,  true,  true,  true,  true,  true,  true,  true],
      ['Dirigeant',              100, '#7A2E2E', true,  true,  true,  true,  true,  true,  true,  true,  false],
      ['Gérant',                  80, '#A0521F', true,  false, true,  true,  true,  true,  false, false, false],
      ['Inspecteur confirmé',     50, '#B8922F', false, false, false, true,  false, false, false, false, false],
      ['Inspecteur en test',      20, '#3E5C6B', false, false, false, false, false, false, false, false, false],
    ];
    for (const g of grades) {
      await pool.query(
        `INSERT INTO grades (nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles, peut_configurer_planning, peut_gerer_id_discord, reserve)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        g
      );
    }
    console.log('[seed] Grades par défaut créés (dont "Fondateur", réservé).');
  } else {
    // Migration douce : si une base existante n'a pas encore le grade réservé "Fondateur", on le crée.
    const { rows: fondateurRows } = await pool.query("SELECT id FROM grades WHERE nom = 'Fondateur'");
    if (fondateurRows.length === 0) {
      await pool.query(
        `INSERT INTO grades (nom, niveau, couleur, peut_valider_comptes, peut_gerer_grades, peut_gerer_sanctions, peut_gerer_casiers, peut_gerer_actus, peut_gerer_protocoles, peut_configurer_planning, peut_gerer_id_discord, reserve)
         VALUES ('Fondateur', 999, '#17150F', true, true, true, true, true, true, true, true, true)`
      );
      console.log('[seed] Grade réservé "Fondateur" ajouté (migration).');
    } else {
      // S'assure que le grade reste bien marqué comme réservé et détient toutes les permissions,
      // même après une modification manuelle ou une migration depuis un ancien schéma.
      await pool.query(
        "UPDATE grades SET reserve = TRUE, peut_configurer_planning = TRUE, peut_gerer_id_discord = TRUE WHERE nom = 'Fondateur' AND (reserve = FALSE OR peut_configurer_planning = FALSE OR peut_gerer_id_discord = FALSE)"
      );
    }
  }

  // --- Rangs ninja par défaut (uniquement si la table est vide) ---
  const { rows: rangCount } = await pool.query('SELECT COUNT(*)::int AS n FROM rangs_ninja');
  if (rangCount[0].n === 0) {
    const rangs = [
      ['Genin', 10, '#8C8272'],
      ['Chûnin', 20, '#4A6670'],
      ['Kakunin', 30, '#6B7A3F'],
      ['TKJ', 40, '#B8922F'],
      ['Jônin', 50, '#A0521F'],
    ];
    for (const r of rangs) {
      await pool.query('INSERT INTO rangs_ninja (nom, niveau, couleur) VALUES ($1,$2,$3)', r);
    }
    console.log('[seed] Rangs ninja par défaut créés.');
  }

  // --- Migration douce : anciens users avec rang_ninja en texte libre -> rang_id ---
  const { rows: legacyRangUsers } = await pool.query(
    "SELECT id, rang_ninja FROM users WHERE rang_id IS NULL AND rang_ninja IS NOT NULL AND rang_ninja <> ''"
  );
  for (const u of legacyRangUsers) {
    const { rows: existingRang } = await pool.query('SELECT id FROM rangs_ninja WHERE nom = $1', [u.rang_ninja]);
    let rangId;
    if (existingRang.length > 0) {
      rangId = existingRang[0].id;
    } else {
      const { rows: created } = await pool.query(
        'INSERT INTO rangs_ninja (nom) VALUES ($1) RETURNING id',
        [u.rang_ninja]
      );
      rangId = created[0].id;
    }
    await pool.query('UPDATE users SET rang_id = $1 WHERE id = $2', [rangId, u.id]);
  }
  if (legacyRangUsers.length > 0) {
    console.log(`[seed] ${legacyRangUsers.length} rang(s) ninja migré(s) vers la table rangs_ninja.`);
  }

  // --- Code pénal par défaut (uniquement si la table est vide) ---
  const { rows: sanctionCount } = await pool.query('SELECT COUNT(*)::int AS n FROM sanctions_types');
  if (sanctionCount[0].n === 0) {
    const sanctions = [
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
      ['Village', 'Délits majeurs', '2.1', "Manque de respect envers un supérieur hiérarchique — Manque de respect envers un membre de la police", 300000, '30 min', 2, 11],
      ['Village', 'Délits majeurs', '2.2', 'Menaces ou insultes envers autrui', 100000, '10 min', 2, 12],
      ['Village', 'Délits majeurs', '2.3', 'Coups / blessures volontaires sur autrui', 200000, 'Jugement', 3, 13],
      ['Village', 'Délits majeurs', '2.4', 'Dégradation de biens publics', 100000, '10 min / T.I.G', 2, 14],
      ['Village', 'Délits majeurs', '2.5', "Usurpation d'identité", 100000, '10 min', 2, 15],
      ['Village', 'Délits majeurs', '2.6', 'Manque de respect envers un Haut Commandant de Suna (Jônin+)', 300000, 'Jugement', 3, 16],
      ['Village', 'Crimes', '3.1', 'Acte de rébellion', null, 'Jugement', 5, 17],
      ['Village', 'Crimes', '3.2', 'Assassinat / homicide volontaire / tentative de meurtre', null, 'Jugement', 5, 18],
      ['Village', 'Crimes', '3.3', 'Trahison envers le village', null, 'Jugement', 5, 19],
      ['Village', 'Crimes', '3.4', 'Détournement de fonds publics destinés au village', null, 'Jugement', 4, 20],
      ['Village', 'Crimes', '3.5', "Prise d'otage / kidnapping", null, 'Jugement', 5, 21],
      ['Village', 'Crimes', '3.6', "Divulgation d'informations confidentielles", 300000, 'Jugement', 4, 22],
      ['Pays du Vent', 'Délits majeurs', '4.1', 'Incompétence ou négligence lors des missions / diplomatie', 250000, '20 min', 2, 23],
      ['Pays du Vent', 'Délits majeurs', '4.2', "Perturber l'ordre public", 80000, '15 min', 2, 24],
      ['Pays du Vent', 'Délits majeurs', '4.3', 'Manipulation ou extorsion de ressources appartenant au village', 300000, '20 min', 3, 25],
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
      { nom: 'Jaune', couleur: '#B8922F', ordre: 2, description_courte: 'Alerte modérée — menace possible',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '' },
      { nom: 'Orange', couleur: '#B8642E', ordre: 3, description_courte: 'Alerte élevée — menace confirmée',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '' },
      { nom: 'Rouge', couleur: '#7A2E2E', ordre: 4, description_courte: 'Alerte maximale — danger imminent',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '' },
      { nom: 'Noir', couleur: '#17150F', ordre: 5, description_courte: 'Urgence absolue — survie du village en jeu',
        declenchement_situation: '', declenchement_infos: '', declenchement_autorisation: '',
        mobilisation_alerte: '', mobilisation_effectif: '', mobilisation_zones: '', actions: '' },
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

  // --- Compte principal protégé (créé uniquement s'il n'existe pas déjà) ---
  const { rows: legacyLexioui } = await pool.query("SELECT id FROM users WHERE username = 'lexioui'");
  if (legacyLexioui.length > 0) {
    await pool.query("UPDATE users SET username = 'DEV', protege = TRUE WHERE username = 'lexioui'");
    console.log('[seed] Compte "lexioui" migré vers "DEV" (protégé).');
  }

  const { rows: fondateurGrade } = await pool.query("SELECT id FROM grades WHERE nom = 'Fondateur' LIMIT 1");
  const fondateurId = fondateurGrade[0] ? fondateurGrade[0].id : null;

  // Resynchronise la séquence des matricules AVANT toute nouvelle attribution (y compris pour DEV),
  // pour ne jamais entrer en collision avec un matricule déjà existant sur une base migrée.
  // Ne touche la séquence QUE s'il existe déjà des matricules : sur une base neuve, setval()
  // marquerait la séquence comme "déjà utilisée" et ferait sauter le tout premier numéro
  // (ex : DEV recevrait SUNA-0002 au lieu de SUNA-0001).
  await pool.query(`
    DO $$
    DECLARE max_matricule INTEGER;
    BEGIN
      SELECT COALESCE(MAX(CAST(substring(matricule FROM 6) AS INTEGER)), 0) INTO max_matricule
      FROM users WHERE matricule ~ '^SUNA-[0-9]+$';
      IF max_matricule > 0 THEN
        PERFORM setval('matricule_seq', max_matricule, true);
      END IF;
    END $$;
  `);

  const { rows: existing } = await pool.query('SELECT id, grade_id FROM users WHERE username = $1', ['DEV']);
  if (existing.length === 0) {
    const hash = await bcrypt.hash('roidudev', 12);
    const { rows: seqRows } = await pool.query("SELECT nextval('matricule_seq') AS n");
    const matricule = `SUNA-${String(seqRows[0].n).padStart(4, '0')}`;
    await pool.query(
      `INSERT INTO users (username, password_hash, nom_complet, grade_id, statut, matricule, valide_le, protege)
       VALUES ($1,$2,$3,$4,'approuve',$5, now(), TRUE)`,
      ['DEV', hash, 'Administrateur Principal', fondateurId, matricule]
    );
    console.log(`[seed] Compte principal "DEV" créé avec le grade réservé "Fondateur" (matricule ${matricule}).`);
  } else {
    // S'assure que DEV reste protégé et détient bien le grade réservé, même après une migration manuelle
    await pool.query(
      'UPDATE users SET protege = TRUE, grade_id = $1 WHERE username = $2 AND (protege = FALSE OR grade_id IS DISTINCT FROM $1)',
      [fondateurId, 'DEV']
    );
  }

  // --- Resynchronisation de la séquence des numéros de plainte (même logique, même prudence) ---
  await pool.query(`
    DO $$
    DECLARE max_numero INTEGER;
    BEGIN
      SELECT COALESCE(MAX(CAST(substring(numero FROM 4) AS INTEGER)), 0) INTO max_numero
      FROM plaintes WHERE numero ~ '^PL-[0-9]+$';
      IF max_numero > 0 THEN
        PERFORM setval('plainte_numero_seq', max_numero, true);
      END IF;
    END $$;
  `);

  // --- Pôles : textes officiels toujours resynchronisés (comme le grade Fondateur) ---
  const poles = [
    {
      nom: 'Enquête',
      resume: 'Investigations, filatures et collecte de renseignements',
      description: "Le pôle enquête est en charge de mener à bien toutes les enquêtes, s'assurent de leur suivis jusqu'à conclusion. Ils sont également chargés de la collecte de renseignements, des filatures nécessaires aux enquêtes.",
      couleur: '#3E5C6B',
    },
    {
      nom: 'Administratif',
      resume: 'Gestion administrative et logistique du village',
      description: "Le pôle administratif est en charge des formations des jeunes inspecteurs, le suivi des rapports des inspecteurs. Ils sont également chargés d'assurer la communication entre la Police et le reste du village mais ils sont aussi affectés à la comptabilité de notre section (récolte des amendes).",
      couleur: '#B8922F',
    },
    {
      nom: 'Sécurité',
      resume: 'Protection du village et maintien de l\'ordre',
      description: "Le pôle sécurité est en charge d'organiser les patrouilles, la surveillance des entrées et sorties du village, l'escorte lors de déplacements diplomatiques ou l'escorte de délégations étrangères.",
      couleur: '#7A2E2E',
    },
  ];
  for (const p of poles) {
    await pool.query(
      `INSERT INTO poles (nom, resume, description, couleur) VALUES ($1,$2,$3,$4)
       ON CONFLICT (nom) DO UPDATE SET resume = EXCLUDED.resume, description = EXCLUDED.description, couleur = EXCLUDED.couleur`,
      [p.nom, p.resume, p.description, p.couleur]
    );
  }

  // --- Migration douce : anciennes patrouilles avec agent_id unique -> table multi-agents ---
  await pool.query(`
    INSERT INTO patrouille_agents (patrouille_id, user_id)
    SELECT id, agent_id FROM patrouilles WHERE agent_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);

  // --- DEV doit appartenir à tous les pôles, à chaque démarrage ---
  const { rows: devRow } = await pool.query("SELECT id FROM users WHERE username = 'DEV'");
  if (devRow.length > 0) {
    await pool.query(
      `INSERT INTO user_poles (user_id, pole_id)
       SELECT $1, id FROM poles
       ON CONFLICT (user_id, pole_id) DO NOTHING`,
      [devRow[0].id]
    );
  }

  // --- Configuration du planning automatique (ligne unique, créée si absente) ---
  const { rows: configCount } = await pool.query('SELECT COUNT(*)::int AS n FROM planning_config');
  if (configCount[0].n === 0) {
    await pool.query(
      `INSERT INTO planning_config (actif, nombre_agents, patrouilles_par_jour, jours_a_l_avance, heure_debut_defaut, duree_heures)
       VALUES (FALSE, 2, 2, 3, '08h00', 4)`
    );
    console.log('[seed] Configuration du planning automatique créée (désactivée par défaut).');
  }

  console.log('[seed] Terminé.');
}

module.exports = run;

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[seed] Erreur :', err);
      process.exit(1);
    });
}
