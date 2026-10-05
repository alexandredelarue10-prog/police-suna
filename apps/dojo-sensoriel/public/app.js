const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GR = { adepte: 'Adepte', professeur: 'Professeur', comaitre: 'Co-Maître', maitre: 'Maître' };
const NIV = { adepte: 1, professeur: 2, comaitre: 3, maitre: 4 };
const BN = ['Aucune sphère maîtrisée', 'Éveil', 'Portée', 'Signature', 'Totale'];
const BC = ['#7d8a90', '#5bc0be', '#3a9bd9', '#6c7ae0', '#c76bdc'];
const DG = { faible: 'Faible', modere: 'Modéré', eleve: 'Élevé', interdit: 'Extrême' };
const pill = (n) => `<span class="pill" style="--c:${BC[n]}">${n ? 'Sphère ' + BN[n] : BN[0]}</span>`;
const NIVT = ['', 'Débutant', 'Intermédiaire', 'Avancé', 'Expert'];
const NC = ['', '#7fb069', '#e0b84c', '#e08a3c', '#d4503c'];
const npill = (n) => `<span class="pill" style="--c:${NC[n]}">${NIVT[n]}</span>`;
const nivOpts = (sel) => opts([1, 2, 3, 4].map((i) => [i, NIVT[i]]), sel);
const fmt = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const opts = (list, sel) => list.map(([v, l]) => `<option value="${v}" ${String(v) === String(sel) ? 'selected' : ''}>${esc(l)}</option>`).join('');
const barOpts = (sel, from = 0) => opts(BN.map((n, i) => [i, i ? 'Sphère ' + n : n]).slice(from), sel);
let moi = null;

async function api(url, method, body) {
  const r = await fetch('api/' + url, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && moi) { moi = null; boot(); } throw new Error(d.error || 'Erreur'); }
  return d;
}
const run = async (fn) => { try { await fn(); } catch (e) { alert(e.message); } };
const staff = () => moi && NIV[moi.grade] >= 2, co = () => moi && NIV[moi.grade] >= 3, maitre = () => moi && NIV[moi.grade] >= 4;

function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="card">${html}<div style="margin-top:10px"><button class="btn ghost" data-act="close">Fermer</button></div></div>`; m.hidden = false; }
const closeModal = () => { $('#modal').hidden = true; };

// ---------- Vues ----------
const VUES = {
  async accueil() {
    const [ann, se, bar] = await Promise.all([api('annonces'), api('seances'), api('barrieres')]);
    const next = se.filter((s) => new Date(s.date_heure) > new Date()).reverse().slice(0, 3);
    return `<h1>Bienvenue, ${esc(moi.nom_rp)}</h1>
    <div class="card"><div class="row"><span class="pill" style="--c:#6fc3df">${GR[moi.grade]}</span>${pill(moi.barriere)}</div>
      <div class="bars">${[1, 2, 3, 4].map((i) => `<i style="${i <= moi.barriere ? 'background:' + BC[i] : ''}" title="Sphère ${BN[i]}"></i>`).join('')}</div>
      <div class="mut">${moi.barriere >= 4 ? 'Tu maîtrises la plus étendue des sphères : la Sphère Totale.' : 'Prochaine sphère à maîtriser : Sphère ' + BN[moi.barriere + 1] + (moi.admin ? '' : ' — fais une demande dans « Examens ».')}</div></div>
    <h2>Annonces</h2>${ann.slice(0, 4).map((a) => `<div class="card"><b>${a.epinglee ? '📌 ' : ''}${esc(a.titre)}</b><pre class="mut">${esc(a.contenu)}</pre></div>`).join('') || '<p class="mut">Aucune annonce.</p>'}
    <h2>Prochaines séances</h2>${next.map((s) => `<div class="card"><b>${esc(s.titre)}</b> — ${fmt(s.date_heure)} ${s.barriere_min ? pill(s.barriere_min) : ''}</div>`).join('') || '<p class="mut">Aucune séance prévue.</p>'}`;
  },
  async barrieres() {
    const b = await api('barrieres');
    return `<h1>Les Sphères</h1><p class="mut">La détection de chakra est le cœur du dojo : quatre sphères de perception, de la plus étroite (Éveil) à la plus étendue (Totale).</p><div class="grid">${b.map((x) => `<div class="card" style="border-top:3px solid ${x.couleur}">
      <div class="mut">${['', 'Perception de base', 'Portée étendue', 'Reconnaissance fine', 'Détection totale'][x.id] || ''}</div><h3 style="color:${x.couleur}">${esc(x.nom)}</h3><pre>${esc(x.description)}</pre><p class="mut"><b>Pour la maîtriser :</b> ${esc(x.exigences)}</p>
      <div class="mut">${x.membres} membre(s) la maîtrisent comme plus haute sphère</div>${maitre() ? `<button class="btn sm ghost" data-act="editBarriere" data-id="${x.id}" style="margin-top:8px">Modifier</button>` : ''}</div>`).join('')}</div>`;
  },
  async grimoire(f) {
    const t = await api('techniques'); const fl = Number(f.b || 0);
    return `<h1>Grimoire sensoriel</h1><p class="mut">Les niveaux s'ouvrent au fil de ta progression dans les sphères.</p><div class="row" style="margin-bottom:14px"><select id="fb" data-act="filtreGrimoire"><option value="0">Tous les niveaux</option>${nivOpts(fl)}</select>${staff() ? '<button class="btn" data-act="formTech">+ Nouvelle technique</button>' : ''}</div>
    <div class="grid">${t.filter((x) => !fl || x.barriere_requise === fl).map((x) => x.verrouille
      ? `<div class="card locked"><b>🔒 ${esc(x.nom)}</b><div style="margin-top:6px">${npill(x.barriere_requise)}</div><p class="mut">Niveau ${NIVT[x.barriere_requise].toLowerCase()} : progresse dans les sphères pour y accéder.</p></div>`
      : `<div class="card"><b>${esc(x.nom)}</b><div class="row" style="margin:6px 0">${npill(x.barriere_requise)}<span class="mut">Coût en chakra : ${DG[x.danger]}</span></div><pre>${esc(x.description)}</pre>
        ${x.composantes ? `<p class="mut"><b>Prérequis :</b> ${esc(x.composantes)}</p>` : ''}<div class="mut">Par ${esc(x.auteur)}</div>
        ${staff() ? `<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="formTech" data-id="${x.id}">Modifier</button>${co() ? `<button class="btn sm red" data-act="delTech" data-id="${x.id}">Supprimer</button>` : ''}</div>` : ''}</div>`).join('') || '<p class="mut">Aucune technique.</p>'}</div>`;
  },
  async seances() {
    const s = await api('seances'); const now = new Date();
    const carte = (x) => { const passee = new Date(x.date_heure) < now; return `<div class="card"><div class="row"><b>${esc(x.titre)}</b>${x.barriere_min ? pill(x.barriere_min) : ''}</div>
      <div class="mut">${fmt(x.date_heure)} · ${esc(x.lieu || 'Dojo')} · par ${esc(x.prof_nom)} · ${x.inscrits}${x.capacite ? '/' + x.capacite : ''} inscrit(s)</div><pre>${esc(x.description)}</pre>
      <div class="row" style="margin-top:8px">${moi.admin ? '' : passee ? (x.inscrit ? `<span class="mut">${x.present === true ? '✅ Présent' : x.present === false ? '❌ Absent' : 'Appel non fait'}</span>` : '') : `<button class="btn sm" data-act="inscr" data-id="${x.id}">${x.inscrit ? 'Se désinscrire' : "S'inscrire"}</button>`}
      ${staff() ? `<button class="btn sm ghost" data-act="appel" data-id="${x.id}">Appel</button><button class="btn sm red" data-act="delSeance" data-id="${x.id}">Supprimer</button>` : ''}</div></div>`; };
    return `<h1>Séances d'entraînement</h1>${staff() ? '<button class="btn" data-act="formSeance" style="margin-bottom:14px">+ Nouvelle séance</button>' : ''}
    <h2>À venir</h2>${s.filter((x) => new Date(x.date_heure) >= now).reverse().map(carte).join('') || '<p class="mut">Aucune séance à venir.</p>'}
    <h2>Passées</h2>${s.filter((x) => new Date(x.date_heure) < now).map(carte).join('') || '<p class="mut">Aucune.</p>'}`;
  },
  async examens() {
    const ex = await api('examens'); const next = moi.barriere + 1;
    const st = { en_attente: '⏳ En attente', accepte: '✅ Accepté', refuse: '❌ Refusé' };
    return `<h1>Examens de sphère</h1>${!moi.admin ? (next > 4 ? '<p class="mut">Tu as atteint la Sphère Rouge.</p>' : `<div class="card"><h3>Passer l'épreuve de la Sphère ${BN[next]}</h3>
      <textarea id="exmsg" maxlength="500" placeholder="Explique pourquoi tu es prêt à présenter cette sphère (entraînement, difficultés surmontées…)"></textarea><button class="btn" data-act="demandeExamen">Envoyer la demande</button></div>`) : ''}
    <h2>${staff() ? 'Demandes' : 'Mes demandes'}</h2>${ex.map((e) => `<div class="card"><div class="row"><b>${staff() ? esc(e.nom_rp) + ' → ' : ''}</b>${pill(e.barriere_visee)}<span>${st[e.statut]}</span></div>
      <div class="mut">${fmt(e.cree_le)}${e.juge && e.statut !== 'en_attente' ? ' · jugé par ' + esc(e.juge) : ''}</div><pre>${esc(e.message)}</pre>${e.commentaire ? `<p class="mut"><b>Commentaire :</b> ${esc(e.commentaire)}</p>` : ''}
      ${staff() && e.statut === 'en_attente' && e.membre_id !== moi.id ? `<input id="c${e.id}" maxlength="500" placeholder="Commentaire (facultatif)"><div class="row"><button class="btn sm" data-act="juge" data-id="${e.id}" data-d="accepte">Valider</button><button class="btn sm red" data-act="juge" data-id="${e.id}" data-d="refuse">Refuser</button></div>` : ''}</div>`).join('') || '<p class="mut">Aucune demande.</p>'}`;
  },
  async membres(f) {
    const m = await api('membres'); const g = f.g || '', b = f.b ?? '', q = (f.q || '').toLowerCase();
    const l = m.filter((x) => (!g || x.grade === g) && (b === '' || x.barriere === Number(b)) && (!q || x.nom_rp.toLowerCase().includes(q)));
    return `<h1>Registre du dojo</h1><div class="row" style="margin-bottom:14px"><input id="fq" placeholder="Rechercher un nom…" value="${esc(f.q || '')}">
      <select id="fg"><option value="">Tous les grades</option>${opts(Object.entries(GR), g)}</select><select id="fbm"><option value="">Toutes sphères</option>${barOpts(b)}</select></div>
    <p class="mut">${l.length} membre(s)</p><div class="grid">${l.map((x) => `<div class="card"><b>${esc(x.nom_rp)}</b><div class="row" style="margin:6px 0"><span class="pill" style="--c:#6fc3df">${GR[x.grade]}</span>${pill(x.barriere)}</div>
      <pre class="mut">${esc(x.bio)}</pre><div class="mut" style="margin-top:6px">Assiduité : ${x.appels ? x.presences + '/' + x.appels + ' séances' : '—'}</div><button class="btn sm ghost" data-act="profilMembre" data-id="${x.id}" style="margin-top:8px">Voir le profil</button></div>`).join('')}</div>`;
  },
  async annonces() {
    const a = await api('annonces');
    return `<h1>Annonces</h1>${staff() ? `<div class="card"><input id="at" maxlength="120" placeholder="Titre"><textarea id="ac" maxlength="3000" placeholder="Contenu"></textarea>
      <div class="row">${co() ? '<label><input type="checkbox" id="ae" style="width:auto"> Épingler</label>' : ''}<button class="btn" data-act="postAnnonce">Publier</button></div></div>` : ''}
    ${a.map((x) => `<div class="card"><b>${x.epinglee ? '📌 ' : ''}${esc(x.titre)}</b><div class="mut">${esc(x.auteur)} · ${fmt(x.cree_le)}</div><pre>${esc(x.contenu)}</pre>${staff() ? `<button class="btn sm red" data-act="delAnnonce" data-id="${x.id}" style="margin-top:8px">Supprimer</button>` : ''}</div>`).join('') || '<p class="mut">Aucune annonce.</p>'}`;
  },
  async carnet() {
    if (moi.admin) return '<h1>Carnet</h1><p class="mut">Le carnet est réservé aux membres du dojo.</p>';
    const c = await api('carnet');
    return `<h1>Mon carnet d'entraînement</h1><p class="mut">Privé : seul toi peux le lire.</p><div class="card"><textarea id="ct" maxlength="2000" placeholder="Qu'as-tu travaillé aujourd'hui ? Détections réussies, difficultés, progrès…"></textarea><button class="btn" data-act="postCarnet">Ajouter</button></div>
    ${c.map((x) => `<div class="card"><div class="row">${pill(x.barriere)}<span class="mut">${fmt(x.cree_le)}</span><span class="sp" style="flex:1"></span><button class="btn sm ghost" data-act="delCarnet" data-id="${x.id}">✕</button></div><pre>${esc(x.texte)}</pre></div>`).join('')}`;
  },
  async stats() {
    const s = await api('stats'); const tot = s.grades.reduce((a, x) => a + x.n, 0);
    return `<h1>Statistiques</h1><div class="grid"><div class="card"><div class="stat">${tot}</div>membres actifs</div><div class="card"><div class="stat">${s.seances}</div>séances</div><div class="card"><div class="stat">${s.techniques}</div>techniques au grimoire</div></div>
    <h2 style="margin-top:20px">Par grade</h2><div class="card">${Object.keys(GR).reverse().map((g) => `<div class="row"><span style="min-width:100px">${GR[g]}</span><b>${(s.grades.find((x) => x.grade === g) || { n: 0 }).n}</b></div>`).join('')}</div>
    <h2>Par sphère</h2><div class="card">${[0, 1, 2, 3, 4].map((i) => `<div class="row" style="margin:4px 0">${pill(i)}<b>${(s.barrieres.find((x) => x.barriere === i) || { n: 0 }).n}</b></div>`).join('')}</div>
    <h2>Les plus assidus</h2><div class="card">${s.assidus.map((a, i) => `<div class="row"><span>${i + 1}. ${esc(a.nom_rp)}</span><b>${a.presences}/${a.appels}</b></div>`).join('') || '<span class="mut">Pas encore de données de présence.</span>'}</div>`;
  },
  async reglement() {
    const r = await api('reglement');
    return `<h1>Règlement du dojo</h1><div class="card"><pre>${esc(r.contenu)}</pre></div>${maitre() ? `<div class="card"><textarea id="rg" maxlength="10000" style="min-height:160px">${esc(r.contenu)}</textarea><button class="btn" data-act="saveReglement">Enregistrer</button></div>` : ''}`;
  },
  async admin() {
    const [att, mem, act, sus] = await Promise.all([api('membres/en-attente'), api('membres'), maitre() ? api('activite') : [], api('membres/suspendus')]);
    return `<h1>Administration</h1><h2>Inscriptions en attente (${att.length})</h2>${att.map((x) => `<div class="card row"><b>${esc(x.nom_rp)}</b><span class="mut">@${esc(x.username)} · ${fmt(x.cree_le)}</span><span style="flex:1"></span>
      <select id="pg${x.id}">${opts(Object.entries(GR).filter(([k]) => maitre() || NIV[k] <= 2), 'adepte')}</select><select id="pb${x.id}">${barOpts(0)}</select><button class="btn sm" data-act="decision" data-id="${x.id}" data-d="actif">Accepter</button><button class="btn sm red" data-act="decision" data-id="${x.id}" data-d="refuse">Refuser</button></div>`).join('') || '<p class="mut">Aucune.</p>'}
    <h2>Membres</h2><a class="btn ghost sm" href="api/export/membres.csv" style="margin-bottom:12px">Exporter les membres (CSV)</a>${mem.map((x) => { const lock = !maitre() && NIV[x.grade] >= NIV[moi.grade]; return `<div class="card"><div class="row"><b style="min-width:130px">${esc(x.nom_rp)}</b><span class="mut">${x.derniere_connexion ? 'Vu ' + fmt(x.derniere_connexion) : 'Jamais connecté'}</span>
      <select id="g${x.id}" ${lock ? 'disabled' : ''}>${opts(Object.entries(GR).filter(([k]) => maitre() || NIV[k] <= 2), x.grade)}</select><select id="b${x.id}" ${lock ? 'disabled' : ''}>${barOpts(x.barriere)}</select>
      ${lock ? '' : `<button class="btn sm" data-act="saveMembre" data-id="${x.id}">Enregistrer</button>`}${!lock && x.id !== moi.id ? `<button class="btn sm ghost" data-act="suspendre" data-id="${x.id}" data-s="1">Suspendre</button>` : ''}${maitre() && x.id !== moi.id ? `<button class="btn sm red" data-act="delMembre" data-id="${x.id}">Supprimer</button>` : ''}</div></div>`; }).join('')}
    ${sus.length ? `<h2>Suspendus</h2>${sus.map((x) => `<div class="card row"><b>${esc(x.nom_rp)}</b><span class="mut">${GR[x.grade]}</span><span style="flex:1"></span><button class="btn sm" data-act="suspendre" data-id="${x.id}" data-s="0">Réactiver</button></div>`).join('')}` : ''}
    ${maitre() ? `<h2>Journal d'activité</h2><div class="card"><table>${act.map((a) => `<tr><td class="mut">${fmt(a.cree_le)}</td><td>${esc(a.nom || '')}</td><td>${esc(a.action)}</td></tr>`).join('')}</table></div>` : ''}`;
  },
  async profil() {
    if (moi.admin) return '<h1>Profil</h1><p class="mut">Tu es connecté avec le compte administrateur du site.</p>';
    return `<h1>Mon profil</h1><div class="card"><label>Nom RP</label><input id="pn" maxlength="40" value="${esc(moi.nom_rp)}"><label>Présentation</label><textarea id="pb" maxlength="500">${esc(moi.bio)}</textarea>
      <label>Nouveau mot de passe (laisser vide pour ne pas changer)</label><input id="pp" type="password" autocomplete="new-password"><button class="btn" data-act="saveProfil">Enregistrer</button></div>`;
  },
};
VUES.notifications = async () => {
  if (moi.admin) return '<h1>Notifications</h1><p class="mut">Aucune notification pour le compte administrateur.</p>';
  const n = await api('notifs');
  if (n.some((x) => !x.lue)) { await api('notifs/lues', 'POST', {}); moi.notifs = 0; topbar('notifications'); }
  return `<h1>Notifications</h1>${n.map((x) => `<div class="card" style="${x.lue ? '' : 'border-color:var(--or)'}">${esc(x.texte)}<div class="mut">${fmt(x.cree_le)}</div></div>`).join('') || '<p class="mut">Rien pour le moment.</p>'}`;
};
VUES.recherche = async (f) => {
  const q = (f.q || '').trim();
  if (q.length < 2) return '<h1>Recherche</h1><p class="mut">Tape au moins 2 caractères dans la barre du haut.</p>';
  const r = await api('recherche?q=' + encodeURIComponent(q));
  return `<h1>Résultats pour « ${esc(q)} »</h1><h2>Membres</h2>${r.membres.map((m) => `<div class="card row"><b>${esc(m.nom_rp)}</b><span class="pill" style="--c:#6fc3df">${GR[m.grade]}</span>${pill(m.barriere)}<span style="flex:1"></span><button class="btn sm ghost" data-act="profilMembre" data-id="${m.id}">Profil</button></div>`).join('') || '<p class="mut">Aucun.</p>'}
  <h2>Techniques</h2>${r.techniques.map((t) => `<div class="card ${t.verrouille ? 'locked' : ''}"><b>${t.verrouille ? '🔒 ' : ''}${esc(t.nom)}</b> ${npill(t.barriere_requise)}${t.verrouille ? '' : `<pre class="mut">${esc((t.description || '').slice(0, 200))}</pre>`}</div>`).join('') || '<p class="mut">Aucune.</p>'}
  <h2>Annonces</h2>${r.annonces.map((a) => `<div class="card"><b>${esc(a.titre)}</b><pre class="mut">${esc(a.extrait)}</pre></div>`).join('') || '<p class="mut">Aucune.</p>'}`;
};
let exo = null;
VUES.salle = async () => {
  const c = await api('exercice/classement');
  return `<h1>Salle de détection</h1><p class="mut">Une source de chakra est cachée dans la zone. Sonde une case : l'intensité reçue (0 à 100) indique à quel point tu en es proche. Trouve la source avant d'avoir épuisé tes sondes ; la zone s'agrandit avec ta sphère.</p>
  ${moi.admin ? '' : '<button class="btn" data-act="startExo">Lancer un exercice</button>'}<div id="exo" style="margin:14px 0"></div>
  <h2>Classement</h2><div class="card">${c.map((r, i) => `<div class="row"><span style="min-width:200px">${i + 1}. ${esc(r.nom_rp)}</span><b>${r.meilleur}</b><span class="mut">${r.reussis} réussite(s)</span></div>`).join('') || '<span class="mut">Aucun score pour le moment.</span>'}</div>`;
};
function drawExo() {
  const n = exo.taille; let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const v = exo.cells[x + ',' + y], src = exo.cible && exo.cible.x === x && exo.cible.y === y;
    cells += `<button class="cell ${src ? 'src' : ''}" data-act="sonde" data-x="${x}" data-y="${y}" ${v !== undefined || exo.done ? 'disabled' : ''} style="${v !== undefined ? `background:hsl(195,80%,${14 + v * 0.45}%)` : ''}">${src ? '◎' : v !== undefined ? v : ''}</button>`;
  }
  const fin = exo.done ? `<p>${exo.trouve ? `✅ Source détectée ! Score : <b>${exo.score}</b>` : '❌ Source non détectée (elle est marquée ◎).'}</p><div class="row"><button class="btn sm" data-act="startExo">Rejouer</button><button class="btn sm ghost" data-act="majClassement">Actualiser le classement</button></div>` : '';
  $('#exo').innerHTML = `<div class="mut">Sondes restantes : <b>${exo.restantes}</b></div><div class="exogrid" style="grid-template-columns:repeat(${n},1fr)">${cells}</div>${fin}`;
}
const NAV = [['accueil', 'Accueil'], ['barrieres', 'Sphères'], ['grimoire', 'Grimoire'], ['seances', 'Séances'], ['salle', 'Salle de détection'], ['examens', 'Examens'], ['membres', 'Membres'], ['annonces', 'Annonces'], ['carnet', 'Carnet'], ['stats', 'Stats'], ['reglement', 'Règlement']];

function topbar(cur) {
  const nav = [...NAV, ...(co() ? [['admin', 'Admin' + (moi.en_attente ? ` (${moi.en_attente})` : '')]] : [])];
  $('#top').innerHTML = `<span class="logo">感 Dojo des Sensoriels</span>${nav.map(([k, l]) => `<a href="#/${k}" class="${k === cur ? 'on' : ''}">${l}</a>`).join('')}<span class="sp"></span><input id="gs" placeholder="Rechercher…" style="width:150px;margin:0" maxlength="60"><a href="#/notifications">🔔${moi.notifs ? ' ' + moi.notifs : ''}</a><a href="#/profil">${esc(moi.nom_rp)}</a>${moi.admin ? '' : '<a href="#" data-act="logout">Déconnexion</a>'}`;
}
async function route() {
  if (!moi) return;
  await refreshMoi(); if (!moi) return authScreen();
  const [p, qs] = (location.hash.slice(2) || 'accueil').split('?'); const f = Object.fromEntries(new URLSearchParams(qs || ''));
  const v = VUES[p] ? p : 'accueil'; topbar(v);
  try { $('#app').innerHTML = await VUES[v](f); } catch (e) { $('#app').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  if (window._refocus) { window._refocus = false; const i = $('#fq'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }
}
function authScreen() {
  $('#top').innerHTML = '<span class="logo">感 Dojo des Sensoriels</span>';
  $('#app').innerHTML = `<div class="auth card"><div class="tabs"><button class="btn" data-act="tab" data-t="login">Connexion</button><button class="btn ghost" data-act="tab" data-t="reg">Inscription</button></div>
    <div id="f-login"><label>Identifiant</label><input id="lu" autocomplete="username"><label>Mot de passe</label><input id="lp" type="password" autocomplete="current-password"><div class="err" id="le"></div><button class="btn" data-act="login">Entrer au dojo</button></div>
    <div id="f-reg" hidden><label>Identifiant</label><input id="ru" maxlength="24" autocomplete="username"><label>Nom RP</label><input id="rn" maxlength="40"><label>Mot de passe (8 caractères min.)</label><input id="rp" type="password" autocomplete="new-password">
      <div class="err" id="re"></div><button class="btn" data-act="register">Demander mon admission</button><p class="mut">Ton inscription sera validée par un Co-Maître ou le Maître.</p></div></div>`;
}
async function refreshMoi() { try { const d = await api('moi'); moi = d.membre; if (moi) { moi.en_attente = d.en_attente || 0; moi.notifs = d.notifs || 0; } } catch { moi = null; } }
async function boot() {
  await refreshMoi();
  if (!moi) return authScreen();
  if (!location.hash) location.hash = '#/accueil'; route();
}

// ---------- Actions ----------
const ACTS = {
  close: closeModal,
  tab: (el) => { const l = el.dataset.t === 'login'; $('#f-login').hidden = !l; $('#f-reg').hidden = l; },
  async login() { try { await api('connexion', 'POST', { username: $('#lu').value, mot_de_passe: $('#lp').value }); boot(); } catch (e) { $('#le').textContent = e.message; } },
  async register() { try { await api('inscription', 'POST', { username: $('#ru').value, nom_rp: $('#rn').value, mot_de_passe: $('#rp').value }); $('#re').className = 'ok'; $('#re').textContent = 'Demande envoyée ! Attends la validation.'; } catch (e) { $('#re').className = 'err'; $('#re').textContent = e.message; } },
  async logout() { await api('deconnexion', 'POST', {}); moi = null; location.hash = ''; boot(); },
  filtreGrimoire: (el) => { location.hash = '#/grimoire?b=' + el.value; },
  async editBarriere(el) { const b = (await api('barrieres')).find((x) => x.id == el.dataset.id); modal(`<h3>${esc(b.nom)}</h3><input id="bn" value="${esc(b.nom)}"><textarea id="bd">${esc(b.description)}</textarea><textarea id="be">${esc(b.exigences)}</textarea><button class="btn" data-act="saveBarriere" data-id="${b.id}">Enregistrer</button>`); },
  async saveBarriere(el) { await api('barrieres/' + el.dataset.id, 'PUT', { nom: $('#bn').value, description: $('#bd').value, exigences: $('#be').value }); closeModal(); route(); },
  async formTech(el) {
    const t = el.dataset.id ? (await api('techniques')).find((x) => x.id == el.dataset.id) : { nom: '', barriere_requise: 1, danger: 'faible', description: '', composantes: '' };
    modal(`<h3>${el.dataset.id ? 'Modifier' : 'Nouvelle'} technique</h3><input id="tn" maxlength="80" placeholder="Nom" value="${esc(t.nom)}"><div class="row"><div><label>Niveau</label><select id="tb">${nivOpts(t.barriere_requise)}</select></div><div><label>Coût en chakra</label><select id="td">${opts(Object.entries(DG), t.danger)}</select></div></div>
      <textarea id="tx" placeholder="Description">${esc(t.description)}</textarea><input id="tc" placeholder="Prérequis (concentration, posture…)" value="${esc(t.composantes)}"><button class="btn" data-act="saveTech" data-id="${el.dataset.id || ''}">Enregistrer</button>`);
  },
  async saveTech(el) { const b = { nom: $('#tn').value, barriere_requise: $('#tb').value, danger: $('#td').value, description: $('#tx').value, composantes: $('#tc').value }; el.dataset.id ? await api('techniques/' + el.dataset.id, 'PUT', b) : await api('techniques', 'POST', b); closeModal(); route(); },
  async delTech(el) { if (confirm('Supprimer cette technique ?')) { await api('techniques/' + el.dataset.id, 'DELETE'); route(); } },
  formSeance() { modal(`<h3>Nouvelle séance</h3><input id="st" maxlength="100" placeholder="Titre"><input id="sd" type="datetime-local"><input id="sl" placeholder="Lieu"><textarea id="sx" placeholder="Description"></textarea>
    <div class="row"><div><label>Sphère minimale</label><select id="sb">${barOpts(0)}</select></div><div><label>Places (0 = illimité)</label><input id="sc" type="number" min="0" value="0"></div><div><label>Répéter chaque semaine (1 à 12)</label><input id="sr" type="number" min="1" max="12" value="1"></div></div><button class="btn" data-act="saveSeance">Créer</button>`); },
  async saveSeance() { if (!$('#sd').value) return alert('Date requise.'); await api('seances', 'POST', { titre: $('#st').value, date_heure: new Date($('#sd').value).toISOString(), lieu: $('#sl').value, description: $('#sx').value, barriere_min: $('#sb').value, capacite: $('#sc').value, repetitions: $('#sr').value }); closeModal(); route(); },
  async delSeance(el) { if (confirm('Supprimer cette séance ?')) { await api('seances/' + el.dataset.id, 'DELETE'); route(); } },
  async inscr(el) { await api('seances/' + el.dataset.id + '/inscription', 'POST', {}); route(); },
  async appel(el) { const l = await api('seances/' + el.dataset.id + '/inscrits'); modal(`<h3>Feuille d'appel</h3>${l.map((m) => `<label class="row" style="color:var(--txt)"><input type="checkbox" class="pr" value="${m.id}" ${m.present ? 'checked' : ''} style="width:auto"> ${esc(m.nom_rp)} ${pill(m.barriere)}</label>`).join('') || '<p class="mut">Aucun inscrit.</p>'}<button class="btn" data-act="saveAppel" data-id="${el.dataset.id}">Valider l'appel</button>`); },
  async saveAppel(el) { await api('seances/' + el.dataset.id + '/appel', 'POST', { presents: [...document.querySelectorAll('.pr:checked')].map((c) => c.value) }); closeModal(); route(); },
  async demandeExamen() { await api('examens', 'POST', { message: $('#exmsg').value }); route(); },
  async juge(el) { await api('examens/' + el.dataset.id + '/decision', 'POST', { decision: el.dataset.d, commentaire: ($('#c' + el.dataset.id) || {}).value }); route(); },
  async postAnnonce() { await api('annonces', 'POST', { titre: $('#at').value, contenu: $('#ac').value, epinglee: $('#ae') && $('#ae').checked }); route(); },
  async delAnnonce(el) { await api('annonces/' + el.dataset.id, 'DELETE'); route(); },
  async postCarnet() { await api('carnet', 'POST', { texte: $('#ct').value }); route(); },
  async delCarnet(el) { await api('carnet/' + el.dataset.id, 'DELETE'); route(); },
  async saveReglement() { await api('reglement', 'PUT', { contenu: $('#rg').value }); route(); },
  async decision(el) { const i = el.dataset.id, a = el.dataset.d === 'actif'; await api('membres/' + i + '/decision', 'POST', { decision: el.dataset.d, grade: a ? $('#pg' + i).value : undefined, barriere: a ? $('#pb' + i).value : undefined }); route(); },
  async saveMembre(el) { const i = el.dataset.id; await api('membres/' + i, 'PUT', { grade: $('#g' + i).value, barriere: $('#b' + i).value }); route(); },
  async delMembre(el) { if (confirm('Supprimer définitivement ce membre ?')) { await api('membres/' + el.dataset.id, 'DELETE'); route(); } },
  async profilMembre(el) {
    const d = await api('membres/' + el.dataset.id), m = d.membre;
    modal(`<h3>${esc(m.nom_rp)}</h3><div class="row"><span class="pill" style="--c:#6fc3df">${GR[m.grade]}</span>${pill(m.barriere)}</div><pre class="mut" style="margin:8px 0">${esc(m.bio)}</pre>
      <div class="mut">Membre depuis le ${new Date(m.cree_le).toLocaleDateString('fr-FR')} · Assiduité : ${d.appels ? d.presences + '/' + d.appels : '—'}${m.derniere_connexion ? ' · Vu ' + fmt(m.derniere_connexion) : ''}</div>
      <h3 style="margin-top:12px">Distinctions</h3><div class="row">${d.badges.map((b) => `<span class="pill" style="--c:#6fc3df" title="${esc(b.desc)}">${b.icone} ${esc(b.nom)}</span>`).join('') || '<span class="mut">Aucune pour le moment.</span>'}</div>
      <h3 style="margin-top:12px">Progression</h3>${d.progres.map((p) => `<div class="mut">${new Date(p.date).toLocaleDateString('fr-FR')} — ${pill(p.barriere)}</div>`).join('') || '<span class="mut">Aucune sphère validée.</span>'}
      ${d.evaluations.length || d.peutEvaluer ? `<h3 style="margin-top:12px">Retours des professeurs</h3>${d.evaluations.map((e) => `<div class="card"><div class="mut">${esc(e.auteur_nom)} · ${fmt(e.cree_le)}${e.note ? ' · ' + '★'.repeat(e.note) : ''}</div><pre>${esc(e.texte)}</pre>${staff() && (e.auteur_id === moi.id || co()) ? `<button class="btn sm ghost" data-act="delEval" data-id="${e.id}" data-m="${m.id}">Supprimer</button>` : ''}</div>`).join('')}
        ${d.peutEvaluer ? `<textarea id="ev" maxlength="1000" placeholder="Ajouter un retour pédagogique"></textarea><div class="row"><select id="evn"><option value="">Sans note</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join('')}</select><button class="btn sm" data-act="addEval" data-id="${m.id}">Ajouter</button></div>` : ''}` : ''}`);
  },
  async addEval(el) { await api('membres/' + el.dataset.id + '/evaluations', 'POST', { texte: $('#ev').value, note: $('#evn').value }); ACTS.profilMembre({ dataset: { id: el.dataset.id } }); },
  async delEval(el) { await api('evaluations/' + el.dataset.id, 'DELETE'); ACTS.profilMembre({ dataset: { id: el.dataset.m } }); },
  async suspendre(el) { const s = el.dataset.s === '1'; if (s && !confirm('Suspendre ce membre ? Il sera déconnecté et ne pourra plus se connecter.')) return; await api('membres/' + el.dataset.id + '/suspension', 'PUT', { suspendu: s }); route(); },
  async startExo() { const e = await api('exercice', 'POST', {}); exo = { ...e, restantes: e.max, cells: {}, done: false }; if (!$('#exo')) await route(); drawExo(); },
  async sonde(el) {
    const x = +el.dataset.x, y = +el.dataset.y, r = await api('exercice/' + exo.id + '/sonde', 'POST', { x, y });
    exo.cells[x + ',' + y] = r.intensite; exo.restantes = r.restantes;
    if (r.fini) { exo.done = true; exo.trouve = r.trouve; exo.score = r.score; exo.cible = r.cible; }
    drawExo();
  },
  majClassement() { route(); },
  async saveProfil() { await api('moi', 'PUT', { nom_rp: $('#pn').value, bio: $('#pb').value, mot_de_passe: $('#pp').value }); moi = (await api('moi')).membre; alert('Profil enregistré.'); route(); },
};
document.addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'SELECT') return; e.preventDefault(); const f = ACTS[el.dataset.act]; if (f) run(() => f(el)); });
document.addEventListener('change', (e) => { const el = e.target; if (el.dataset && el.dataset.act === 'filtreGrimoire') ACTS.filtreGrimoire(el); if (['fg', 'fbm'].includes(el.id)) filtreMembres(); });
document.addEventListener('input', (e) => { if (e.target.id === 'fq') { clearTimeout(window._t); window._t = setTimeout(filtreMembres, 250); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ['lu', 'lp'].includes(e.target.id)) ACTS.login(); if (e.key === 'Enter' && e.target.id === 'gs' && e.target.value.trim()) location.hash = '#/recherche?q=' + encodeURIComponent(e.target.value.trim()); });
function filtreMembres() { window._refocus = document.activeElement && document.activeElement.id === 'fq'; const p = new URLSearchParams({ q: $('#fq').value, g: $('#fg').value, b: $('#fbm').value }); location.hash = '#/membres?' + p; }
window.addEventListener('hashchange', route);
boot();
