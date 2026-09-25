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
  function bindModal(overlay, closeBtn, onOpen, onShown) {
    var box = overlay.querySelector('.modal-box');
    var closeTimer = null;

    function open() {
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      overlay.classList.remove('modal-overlay-hiding');
      box.classList.remove('modal-vanish');
      if (onOpen) onOpen();
      overlay.hidden = false;
      if (onShown) onShown(box);
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
  // des espaces) REPLIE la ligne entière (voir .settings-row-collapsed dans style.css)
  // tant qu'AUCUNE de ces clés n'est activée (ex. "Tableau de signes" n'a de sens qu'avec
  // les inéquations) — sa valeur mémorisée est conservée, juste hors d'atteinte.
  // Hauteur naturelle (dépliée) d'une ligne, mesurée transitions coupées : lue en plein
  // repli/dépli, le padding (lui aussi animé) fausserait la cible et ferait "sauter" la
  // ligne au relâchement final du max-height.
  function naturalRowHeight(row) {
    var wasCollapsed = row.classList.contains('settings-row-collapsed');
    var prevMax = row.style.maxHeight;
    row.classList.add('settings-no-anim');
    row.classList.remove('settings-row-collapsed');
    row.style.maxHeight = '';
    var h = row.offsetHeight;
    if (wasCollapsed) row.classList.add('settings-row-collapsed');
    row.style.maxHeight = prevMax;
    void row.offsetHeight;
    row.classList.remove('settings-no-anim');
    return h;
  }

  // max-height animé depuis/vers la hauteur RÉELLE de la ligne (pas une borne fixe
  // arbitraire, qui laisserait un temps mort au début du repli), puis relâché une fois
  // déplié pour ne pas brider un libellé qui passerait sur deux lignes.
  function setRowCollapsed(row, collapsed) {
    if (row.classList.contains('settings-row-collapsed') === collapsed) {
      if (collapsed) row.style.maxHeight = '0px';
      return;
    }
    row.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
    if (row.offsetParent === null) {
      // Fenêtre fermée (rafraîchie avant l'ouverture) : pas d'animation.
      row.classList.toggle('settings-row-collapsed', collapsed);
      row.style.maxHeight = collapsed ? '0px' : '';
      return;
    }
    if (collapsed) {
      row.style.maxHeight = row.offsetHeight + 'px';
      void row.offsetHeight;
      row.classList.add('settings-row-collapsed');
      row.style.maxHeight = '0px';
    } else {
      var target = naturalRowHeight(row);
      row.classList.remove('settings-row-collapsed');
      row.style.maxHeight = target + 'px';
      row.addEventListener('transitionend', function done(e) {
        if (e.propertyName !== 'max-height') return;
        row.removeEventListener('transitionend', done);
        if (!row.classList.contains('settings-row-collapsed')) row.style.maxHeight = '';
      });
    }
  }

  // Hauteur de la fenêtre figée sur celle qu'elle aurait TOUTES lignes dépliées : replier/
  // déplier une ligne (ou afficher le message "aucune équation") ne la redimensionne
  // jamais — l'espace libéré reste en bas. Toujours plafonnée par max-height (défilement).
  function lockBoxHeight(box) {
    var rows = box.querySelectorAll('.settings-row-collapsed');
    box.style.height = '';
    box.classList.add('settings-no-anim');
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.remove('settings-row-collapsed');
      row.dataset.prevMax = row.style.maxHeight;
      row.style.maxHeight = '';
    });
    var h = box.offsetHeight;
    Array.prototype.forEach.call(rows, function (row) {
      row.classList.add('settings-row-collapsed');
      row.style.maxHeight = row.dataset.prevMax;
    });
    void box.offsetHeight;
    box.classList.remove('settings-no-anim');
    box.style.height = h + 'px';
  }

  function bindToggles(overlay, onChange) {
    var toggles = overlay.querySelectorAll('input[data-setting]');
    function refresh() {
      Array.prototype.forEach.call(toggles, function (input) {
        input.checked = !!get(input.getAttribute('data-setting'));
        var requires = input.getAttribute('data-requires');
        var enabled = !requires || requires.split(' ').some(function (k) { return !!get(k); });
        input.disabled = !enabled;
        setRowCollapsed(input.closest('.settings-row'), !enabled);
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

  // Double curseur min/max du degré (voir .degree-range dans style.css) : poignées
  // maison plutôt que deux <input type=range> natifs, qui sautent d'un entier à l'autre —
  // ici la poignée suit la souris en continu, puis glisse (transition CSS) jusqu'à
  // l'entier le plus proche au relâchement. Les poignées ne se croisent jamais.
  function bindDegreeRange(overlay, onChange) {
    var range = overlay.querySelector('.degree-range');
    var track = range.querySelector('.degree-range-track');
    var fill = range.querySelector('.degree-range-fill');
    var thumbs = {
      min: range.querySelector('[data-degree="min"]'),
      max: range.querySelector('[data-degree="max"]')
    };
    var KEYS = { min: 'genMinDegree', max: 'genMaxDegree' };
    var lo = App.Generator.MIN_DEGREE, hi = App.Generator.MAX_DEGREE;
    var pos = { min: lo, max: hi };
    var active = null;       // poignée en cours de glisser ('min'/'max'), ou null
    var undecided = false;   // poignées superposées : sens choisi au premier mouvement
    var startX = 0;

    function frac(v) { return (v - lo) / (hi - lo); }
    function paint() {
      ['min', 'max'].forEach(function (k) {
        thumbs[k].style.left = 'calc(11px + (100% - 22px) * ' + frac(pos[k]) + ')';
        thumbs[k].setAttribute('aria-valuenow', Math.round(pos[k]));
        thumbs[k].setAttribute('aria-valuemin', lo);
        thumbs[k].setAttribute('aria-valuemax', hi);
      });
      fill.style.left = (frac(pos.min) * 100) + '%';
      fill.style.right = ((1 - frac(pos.max)) * 100) + '%';
      // Superposées tout à droite, seule "min" peut encore bouger : elle passe dessus.
      thumbs.min.style.zIndex = pos.min >= hi ? 2 : 1;
    }
    function commit(k) {
      pos[k] = Math.round(pos[k]);
      paint();
      if (get(KEYS[k]) !== pos[k]) {
        set(KEYS[k], pos[k]);
        if (onChange) onChange();
      }
    }
    function valueAt(clientX) {
      var r = track.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      return lo + f * (hi - lo);
    }
    function moveTo(k, v) {
      pos[k] = k === 'min' ? Math.min(v, pos.max) : Math.max(v, pos.min);
      paint();
    }
    function refresh() {
      pos.min = get('genMinDegree');
      pos.max = get('genMaxDegree');
      paint();
    }

    range.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var v = valueAt(e.clientX);
      var dMin = Math.abs(v - pos.min), dMax = Math.abs(v - pos.max);
      var onThumb = e.target.closest('.degree-thumb');
      undecided = false;
      if (pos.min === pos.max && (onThumb || dMin === dMax)) {
        // Poignées superposées : impossible de savoir laquelle est visée avant de bouger.
        if (v > pos.max + 0.05) active = 'max';
        else if (v < pos.min - 0.05) active = 'min';
        else { active = 'max'; undecided = true; }
      } else if (onThumb) {
        active = onThumb.getAttribute('data-degree');
      } else {
        active = dMin < dMax ? 'min' : 'max';
      }
      startX = e.clientX;
      range.setPointerCapture(e.pointerId);
      thumbs[active].focus();
      range.classList.add('degree-range-dragging');
      if (!undecided && !onThumb) moveTo(active, v);
      e.preventDefault();
    });
    range.addEventListener('pointermove', function (e) {
      if (!active) return;
      if (undecided) {
        if (Math.abs(e.clientX - startX) < 2) return;
        active = e.clientX < startX ? 'min' : 'max';
        thumbs[active].focus();
        undecided = false;
      }
      moveTo(active, valueAt(e.clientX));
    });
    function release() {
      if (!active) return;
      range.classList.remove('degree-range-dragging');
      commit(active);
      active = null;
      undecided = false;
    }
    range.addEventListener('pointerup', release);
    range.addEventListener('pointercancel', release);

    ['min', 'max'].forEach(function (k) {
      thumbs[k].addEventListener('keydown', function (e) {
        var step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
        var v = step ? pos[k] + step : e.key === 'Home' ? lo : e.key === 'End' ? hi : null;
        if (v === null) return;
        e.preventDefault();
        moveTo(k, Math.min(hi, Math.max(lo, v)));
        commit(k);
      });
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
    }, lockBoxHeight);
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
