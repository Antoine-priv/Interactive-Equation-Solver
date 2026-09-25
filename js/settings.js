/* Réglages (bouton engrenage en haut à droite) : fenêtre de paramètres à activer/
   désactiver, mémorisés en local. Lus à la volée par le reste de l'appli via
   App.Settings.get(clé) — ex. 'autoSimplify', voir commitExprOps dans history.js. */
(function (App) {
  'use strict';

  var STORAGE_KEY = 'equations-settings';

  // Valeurs par défaut de chaque réglage : toute clé absente du stockage local (première
  // visite, ou réglage ajouté depuis) retombe ici.
  var DEFAULTS = {
    autoSimplify: false
  };

  // Doit rester en phase avec la transition CSS de .modal-overlay/.modal-box (voir
  // style.css), comme VANISH_MS dans newEquationModal.js.
  var VANISH_MS = 180;

  var GEAR_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06' +
    'a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09' +
    'A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83' +
    'l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09' +
    'A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0' +
    'l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09' +
    'a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83' +
    'l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09' +
    'a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  var values = load();

  function load() {
    var out = {};
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) {}
    Object.keys(DEFAULTS).forEach(function (key) {
      out[key] = stored && typeof stored[key] === typeof DEFAULTS[key] ? stored[key] : DEFAULTS[key];
    });
    return out;
  }

  function get(key) {
    return values[key];
  }

  function set(key, value) {
    values[key] = value;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch (e) {}
  }

  function init() {
    var btn = document.getElementById('settingsBtn');
    var overlay = document.getElementById('settingsOverlay');
    if (!btn || !overlay) return;
    var box = overlay.querySelector('.modal-box');
    var closeBtn = document.getElementById('settingsClose');
    var toggles = overlay.querySelectorAll('input[data-setting]');
    var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var closeTimer = null;

    btn.innerHTML = GEAR_SVG;

    // Même animation d'ouverture/fermeture que la modale "Nouvelle équation" (voir
    // open()/close() dans newEquationModal.js pour le détail des reflows forcés).
    function open() {
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      overlay.classList.remove('modal-overlay-hiding');
      box.classList.remove('modal-vanish');
      Array.prototype.forEach.call(toggles, function (input) {
        input.checked = !!get(input.getAttribute('data-setting'));
      });
      overlay.hidden = false;
      if (prefersReducedMotion) return;
      overlay.classList.add('modal-overlay-hiding');
      void overlay.offsetWidth;
      overlay.classList.remove('modal-overlay-hiding');
      box.classList.remove('modal-pop-in');
      void box.offsetWidth;
      box.classList.add('modal-pop-in');
    }

    function close() {
      if (overlay.hidden || closeTimer !== null) return;
      if (prefersReducedMotion) {
        overlay.hidden = true;
        return;
      }
      box.classList.remove('modal-pop-in');
      void box.offsetWidth;
      overlay.classList.add('modal-overlay-hiding');
      box.classList.add('modal-vanish');
      closeTimer = setTimeout(function () {
        overlay.hidden = true;
        overlay.classList.remove('modal-overlay-hiding');
        box.classList.remove('modal-vanish');
        closeTimer = null;
      }, VANISH_MS);
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) { close(); e.preventDefault(); }
    });
    Array.prototype.forEach.call(toggles, function (input) {
      input.addEventListener('change', function () {
        set(input.getAttribute('data-setting'), input.checked);
      });
    });
  }

  App.Settings = { init: init, get: get, set: set };
})(window.App = window.App || {});
