/* Réglages (bouton engrenage en haut à droite) : fenêtre de paramètres à activer/
   désactiver, mémorisés en local. Lus à la volée par le reste de l'appli via
   App.Settings.get(clé) — ex. 'autoSimplify', voir commitExprOps dans history.js.
   Héberge aussi la fenêtre "Options de génération" (engrenage au survol du bouton
   "Générer aléatoirement", voir newEquationModal.js) : mêmes interrupteurs, stockés dans
   le même magasin sous les clés gen_<tag> (voir TAGS dans generator.js), plus un double
   curseur min/max pour le degré (genMinDegree/genMaxDegree), le tout relu par
   generatorOptions() à chaque tirage. */
(function (App) {
  'use strict';

  var STORAGE_KEY = 'equations-settings';

  // Valeurs par défaut de chaque réglage : toute clé absente du stockage local (première
  // visite, ou réglage ajouté depuis) retombe ici.
  var DEFAULTS = {
    autoSimplify: false,
    gen_inequality: true,
    gen_fraction: true,
    gen_sqrt: true,
    gen_factoring: true,
    gen_identities: true,
    gen_produitNul: true,
    gen_domain: true,
    gen_signChart: true,
    genMinDegree: 1,
    genMaxDegree: 3
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

  // Options de génération au format attendu par App.Generator.generateEquation.
  function generatorOptions() {
    var allow = {};
    App.Generator.TAGS.forEach(function (tag) { allow[tag] = !!get('gen_' + tag); });
    return { allow: allow, minDegree: get('genMinDegree'), maxDegree: get('genMaxDegree') };
  }

  var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Ouverture/fermeture animées d'une fenêtre .modal-overlay (même animation que la modale
  // "Nouvelle équation", voir open()/close() dans newEquationModal.js pour le détail des
  // reflows forcés), Échap et clic sur le fond compris. `onOpen` rafraîchit son contenu.
  function bindModal(overlay, closeBtn, onOpen) {
    var box = overlay.querySelector('.modal-box');
    var closeTimer = null;

    function open() {
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      overlay.classList.remove('modal-overlay-hiding');
      box.classList.remove('modal-vanish');
      if (onOpen) onOpen();
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

    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !overlay.hidden) { close(); e.preventDefault(); }
    });
    return { open: open, close: close };
  }

  // Interrupteurs input[data-setting] d'une fenêtre : `data-requires` (clés séparées par
  // des espaces) désactive l'interrupteur tant qu'AUCUNE de ces clés n'est activée (ex.
  // "Tableau de signes" n'a de sens qu'avec les inéquations) — sa valeur mémorisée est
  // conservée, simplement grisée.
  function bindToggles(overlay, onChange) {
    var toggles = overlay.querySelectorAll('input[data-setting]');
    function refresh() {
      Array.prototype.forEach.call(toggles, function (input) {
        input.checked = !!get(input.getAttribute('data-setting'));
        var requires = input.getAttribute('data-requires');
        var enabled = !requires || requires.split(' ').some(function (k) { return !!get(k); });
        input.disabled = !enabled;
        input.closest('.settings-row').classList.toggle('settings-row-disabled', !enabled);
      });
    }
    Array.prototype.forEach.call(toggles, function (input) {
      input.addEventListener('change', function () {
        set(input.getAttribute('data-setting'), input.checked);
        refresh();
        if (onChange) onChange();
      });
    });
    return refresh;
  }

  // Double curseur min/max du degré : deux <input type=range> superposés (voir
  // .degree-range dans style.css), jamais croisés — le curseur déplacé bute sur l'autre.
  function bindDegreeRange(overlay, onChange) {
    var minInput = overlay.querySelector('input[data-degree="min"]');
    var maxInput = overlay.querySelector('input[data-degree="max"]');
    var fill = overlay.querySelector('.degree-range-fill');
    var label = overlay.querySelector('.degree-range-value');
    var lo = App.Generator.MIN_DEGREE, hi = App.Generator.MAX_DEGREE;
    [minInput, maxInput].forEach(function (input) {
      input.min = lo; input.max = hi; input.step = 1;
    });

    function paint() {
      var a = +minInput.value, b = +maxInput.value;
      fill.style.left = ((a - lo) / (hi - lo) * 100) + '%';
      fill.style.right = ((hi - b) / (hi - lo) * 100) + '%';
      label.textContent = a === b ? 'Degré ' + a : 'Degré ' + a + ' à ' + b;
      // Deux curseurs sur la même valeur : celui du haut doit rester attrapable dans le
      // sens où il peut encore bouger (tout à droite, seul "min" peut encore reculer).
      minInput.classList.toggle('degree-thumb-top', a === b && a === hi);
    }
    function refresh() {
      minInput.value = get('genMinDegree');
      maxInput.value = get('genMaxDegree');
      paint();
    }
    minInput.addEventListener('input', function () {
      if (+minInput.value > +maxInput.value) minInput.value = maxInput.value;
      set('genMinDegree', +minInput.value);
      paint();
      if (onChange) onChange();
    });
    maxInput.addEventListener('input', function () {
      if (+maxInput.value < +minInput.value) maxInput.value = minInput.value;
      set('genMaxDegree', +maxInput.value);
      paint();
      if (onChange) onChange();
    });
    return refresh;
  }

  var generatorModal = null;

  function initGeneratorOptions() {
    var overlay = document.getElementById('generatorOverlay');
    if (!overlay) return;
    var emptyHint = document.getElementById('generatorEmpty');
    function refreshHint() {
      emptyHint.textContent = App.Generator.hasEligibleForms(generatorOptions())
        ? '' : 'Aucune équation ne correspond à ces options.';
    }
    var refreshToggles = bindToggles(overlay, refreshHint);
    var refreshDegrees = bindDegreeRange(overlay, refreshHint);
    generatorModal = bindModal(overlay, document.getElementById('generatorClose'), function () {
      refreshToggles();
      refreshDegrees();
      refreshHint();
    });
  }

  function openGeneratorOptions() {
    if (generatorModal) generatorModal.open();
  }

  function init() {
    var btn = document.getElementById('settingsBtn');
    var overlay = document.getElementById('settingsOverlay');
    initGeneratorOptions();
    if (!btn || !overlay) return;
    btn.innerHTML = GEAR_SVG;
    var refreshToggles = bindToggles(overlay);
    var modal = bindModal(overlay, document.getElementById('settingsClose'), refreshToggles);
    btn.addEventListener('click', modal.open);
  }

  App.Settings = {
    init: init,
    get: get,
    set: set,
    generatorOptions: generatorOptions,
    openGeneratorOptions: openGeneratorOptions,
    GEAR_SVG: GEAR_SVG
  };
})(window.App = window.App || {});
