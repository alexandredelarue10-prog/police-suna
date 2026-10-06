// Bandeau d'annonce commun à tous les sites : texte géré depuis /admin (voir /hub/annonce)
(function () {
  fetch('/hub/annonce', { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (a) {
      if (!a || !a.texte || document.getElementById('bandeau-annonce')) return;
      var b = document.createElement('div');
      b.id = 'bandeau-annonce';
      b.setAttribute('role', 'status');
      b.textContent = a.texte;
      b.style.cssText = 'background:#CBA84C;color:#17150F;text-align:center;padding:10px 16px;font:600 14px/1.4 system-ui,sans-serif;position:relative;z-index:1000;white-space:pre-wrap';
      document.body.insertBefore(b, document.body.firstChild);
    })
    .catch(function () { /* annonce facultative : ne jamais casser la page */ });
})();
