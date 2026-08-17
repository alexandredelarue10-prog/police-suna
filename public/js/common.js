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

  const publicLinks = [
    ['index.html', 'Accueil', 'accueil'],
    ['organigramme.html', 'Organigramme', 'organigramme'],
    ['code-penal.html', 'Code pénal', 'code-penal'],
    ['protocoles.html', 'Protocoles', 'protocoles'],
  ];

  const authLinks = [
    ['dashboard.html', 'Tableau de bord', 'dashboard'],
    ['casiers.html', 'Casiers judiciaires', 'casiers'],
    ['planning.html', 'Planning', 'planning'],
    ['statistiques.html', 'Statistiques', 'statistiques'],
  ];

  const linkHtml = (href, label, key) =>
    `<a href="${href}" class="${activeKey === key ? 'active' : ''}">${label}</a>`;

  let linksHtml = publicLinks.map(([h, l, k]) => linkHtml(h, l, k)).join('');
  if (CURRENT_USER) {
    linksHtml += authLinks.map(([h, l, k]) => linkHtml(h, l, k)).join('');
    if (CURRENT_USER.permissions.peut_valider_comptes) {
      linksHtml += `<a href="admin-comptes.html" class="${activeKey === 'admin-comptes' ? 'active' : ''}">Comptes<span id="pending-badge" class="badge badge-danger hidden" style="margin-left:5px; padding:1px 6px"></span></a>`;
      linksHtml += linkHtml('journal.html', 'Journal', 'journal');
    }
    if (CURRENT_USER.permissions.peut_gerer_grades) {
      linksHtml += linkHtml('admin-grades.html', 'Grades', 'admin-grades');
      linksHtml += linkHtml('admin-rangs.html', 'Rangs', 'admin-rangs');
    }
    if (CURRENT_USER.permissions.peut_gerer_actus) {
      linksHtml += linkHtml('admin-actus.html', 'Communiqués', 'admin-actus');
    }
  }

  const searchHtml = CURRENT_USER
    ? `<form id="nav-search-form" style="margin:0">
         <input type="search" id="nav-search-input" placeholder="Rechercher…" style="padding:6px 10px; border-radius:4px; border:1px solid rgba(217,192,139,0.3); background:rgba(246,239,220,0.06); color:var(--sable-050); font-size:0.82rem; width:150px" />
       </form>`
    : '';

  const userHtml = CURRENT_USER
    ? `<div class="nav-user">
         ${searchHtml}
         <span class="grade-chip"><span class="grade-dot" style="background:${CURRENT_USER.grade_couleur || '#8C8272'}"></span>${escapeHtml(CURRENT_USER.grade_nom || 'Sans grade')}</span>
         <a href="profil.html" style="color:var(--sable-100)">${escapeHtml(CURRENT_USER.username)}</a>
         <button class="btn btn-secondary btn-sm" id="logout-btn" type="button">Déconnexion</button>
       </div>`
    : `<div class="nav-user">
         <a href="login.html" class="btn btn-secondary btn-sm">Connexion</a>
         <a href="register.html" class="btn btn-primary btn-sm">Demander un accès</a>
       </div>`;

  nav.innerHTML = `
    <div class="wrap">
      <a href="index.html" class="brand"><span class="sceau" style="width:32px;height:32px"></span>Police de Sunagakure</a>
      <div class="nav-links">${linksHtml}</div>
      ${userHtml}
    </div>`;

  document.body.prepend(nav);

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      try {
        await api('/auth/logout', { method: 'POST' });
      } catch (_) { /* ignore */ }
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
  footer.innerHTML = `<div class="wrap">Village Caché du Sable — Registre officiel de la Force de Police · Document interne</div>`;
  document.body.appendChild(footer);
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
