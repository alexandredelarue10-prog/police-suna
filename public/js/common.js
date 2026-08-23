// Construit la barre de navigation et le pied de page en fonction de la session.
// Chaque page appelle `initLayout('cle-page-active')` au chargement.

let CURRENT_USER = null;

async function fetchCurrentUser() {
  try {
    const data = await api('/auth/me');
    CURRENT_USER = data.user;
  } catch (_) {
    CURRENT_USER = null;
  }
  return CURRENT_USER;
}

function buildNavbar(activeKey) {
  const nav = document.createElement('nav');
  nav.className = 'navbar';

  const linkHtml = (href, label, key, badgeId) =>
    `<a href="${href}" class="${activeKey === key ? 'active' : ''}">${label}${badgeId ? `<span id="${badgeId}" class="nav-badge-count hidden">0</span>` : ''}</a>`;

  // --- Groupe 1 : Village (toujours visible, public) ---
  const villageLinks = [
    linkHtml('index.html', 'Accueil', 'accueil'),
    linkHtml('organigramme.html', 'Organigramme', 'organigramme'),
    linkHtml('code-penal.html', 'Code pénal', 'code-penal'),
    linkHtml('protocoles.html', 'Protocoles', 'protocoles'),
  ].join('');

  // --- Groupe 2 : Mon espace (connecté) ---
  let espaceLinks = '';
  if (CURRENT_USER) {
    espaceLinks = [
      linkHtml('dashboard.html', 'Tableau de bord', 'dashboard'),
      linkHtml('casiers.html', 'Casiers judiciaires', 'casiers'),
      linkHtml('plaintes.html', 'Dépôts de plainte', 'plaintes'),
      linkHtml('planning.html', 'Planning', 'planning'),
      linkHtml('statistiques.html', 'Statistiques', 'statistiques'),
      linkHtml('profil.html', 'Mon profil', 'profil'),
    ].join('');
  }

  // --- Groupe 3bis : Mes pôles (selon appartenance) ---
  let poleLinks = '';
  if (CURRENT_USER && Array.isArray(CURRENT_USER.poles)) {
    if (CURRENT_USER.poles.includes('Administratif')) {
      poleLinks += linkHtml('administratif.html', 'Administratif', 'administratif');
    }
    if (CURRENT_USER.poles.includes('Enquête')) {
      poleLinks += linkHtml('enquetes.html', 'Enquête', 'enquetes');
    }
    if (CURRENT_USER.poles.includes('Sécurité')) {
      poleLinks += linkHtml('securite.html', 'Sécurité', 'securite');
    }
  }

  // --- Groupe 3 : Administration (selon permissions) ---
  let adminLinks = '';
  if (CURRENT_USER) {
    if (CURRENT_USER.permissions.peut_valider_comptes) {
      adminLinks += linkHtml('admin-comptes.html', 'Comptes', 'admin-comptes', 'pending-badge');
      adminLinks += linkHtml('journal.html', 'Journal d\'activité', 'journal');
    }
    if (CURRENT_USER.permissions.peut_gerer_grades) {
      adminLinks += linkHtml('admin-grades.html', 'Grades', 'admin-grades');
      adminLinks += linkHtml('admin-rangs.html', 'Rangs ninja', 'admin-rangs');
    }
    if (CURRENT_USER.permissions.peut_gerer_sanctions) {
      adminLinks += linkHtml('code-penal.html', 'Éditer le code pénal', 'code-penal-edit');
    }
    if (CURRENT_USER.permissions.peut_gerer_protocoles) {
      adminLinks += linkHtml('protocoles.html', 'Éditer les protocoles', 'protocoles-edit');
    }
    if (CURRENT_USER.permissions.peut_gerer_actus) {
      adminLinks += linkHtml('admin-actus.html', 'Communiqués', 'admin-actus');
    }
  }

  const groups = [
    ['Le village', villageLinks],
    CURRENT_USER ? ['Mon espace', espaceLinks] : null,
    poleLinks ? ['Mes pôles', poleLinks] : null,
    adminLinks ? ['Administration', adminLinks] : null,
  ].filter(Boolean);

  const dropdownHtml = `
    <div class="nav-dropdown" id="nav-dropdown">
      <div class="nav-dropdown-inner">
        ${groups.map(([title, links]) => `
          <div class="nav-group">
            <div class="nav-group-title">${title}</div>
            <div class="nav-group-links">${links}</div>
          </div>
        `).join('')}
      </div>
    </div>`;

  const searchHtml = CURRENT_USER
    ? `<form id="nav-search-form" class="nav-search-form">
         <span class="nav-search-icon"></span>
         <input type="search" id="nav-search-input" placeholder="Rechercher…" />
       </form>`
    : '';

  const userHtml = CURRENT_USER
    ? `<div class="nav-user">
         ${searchHtml}
         <span class="grade-chip"><span class="grade-dot" style="background:${CURRENT_USER.grade_couleur || '#8C8272'}"></span>${escapeHtml(CURRENT_USER.grade_nom || 'Sans grade')}</span>
         <button class="btn btn-secondary btn-sm" id="logout-btn" type="button">Déconnexion</button>
       </div>`
    : `<div class="nav-user">
         <a href="login.html" class="btn btn-secondary btn-sm">Connexion</a>
         <a href="register.html" class="btn btn-primary btn-sm">Demander un accès</a>
       </div>`;

  nav.innerHTML = `
    <div class="wrap">
      <a href="index.html" class="brand"><span class="sceau" style="width:32px;height:32px"></span>Police de Sunagakure</a>
      <div class="nav-menu-row">
        <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
        ${userHtml}
      </div>
    </div>
    ${dropdownHtml}
    <div class="nav-scrim" id="nav-scrim"></div>`;

  document.body.prepend(nav);

  // --- Interactions ---
  const toggleBtn = document.getElementById('nav-toggle');
  const dropdown = document.getElementById('nav-dropdown');
  const scrim = document.getElementById('nav-scrim');

  function closeMenu() {
    toggleBtn.classList.remove('open');
    toggleBtn.setAttribute('aria-expanded', 'false');
    dropdown.classList.remove('open');
    scrim.classList.remove('open');
  }
  function toggleMenu() {
    const willOpen = !dropdown.classList.contains('open');
    toggleBtn.classList.toggle('open', willOpen);
    toggleBtn.setAttribute('aria-expanded', String(willOpen));
    dropdown.classList.toggle('open', willOpen);
    scrim.classList.toggle('open', willOpen);
  }
  toggleBtn.addEventListener('click', toggleMenu);
  scrim.addEventListener('click', closeMenu);
  dropdown.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch (_) { /* ignore */ }
      window.location.href = 'index.html';
    });
  }

  const searchForm = document.getElementById('nav-search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = document.getElementById('nav-search-input').value.trim();
      if (q) window.location.href = `recherche.html?q=${encodeURIComponent(q)}`;
    });
  }

  if (CURRENT_USER && CURRENT_USER.permissions.peut_valider_comptes) {
    api('/users/pending-count').then(({ count }) => {
      const badge = document.getElementById('pending-badge');
      if (badge && count > 0) {
        badge.textContent = count;
        badge.classList.remove('hidden');
      }
    }).catch(() => {});
  }
}

function buildFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="wrap">
      <div>Village Caché du Sable — Registre officiel de la Force de Police · Document interne</div>
      <div id="footer-credits" class="footer-credits"></div>
    </div>`;
  document.body.appendChild(footer);

  api('/settings/credits').then(({ credits }) => {
    const el = document.getElementById('footer-credits');
    if (el && credits) el.textContent = credits;
  }).catch(() => { /* silencieux : les crédits ne sont pas critiques */ });
}

// key: identifiant de la page active. requireAuth: redirige vers login.html si non connecté.
// requirePerm: nom de permission (colonne grades) requise, sinon redirige vers dashboard.html.
async function initLayout({ activeKey = '', requireAuth = false, requirePerm = null } = {}) {
  await fetchCurrentUser();

  if (requireAuth && !CURRENT_USER) {
    window.location.href = 'login.html';
    return null;
  }
  if (requirePerm && (!CURRENT_USER || !CURRENT_USER.permissions[requirePerm])) {
    window.location.href = 'dashboard.html';
    return null;
  }

  buildNavbar(activeKey);
  buildFooter();
  return CURRENT_USER;
}
