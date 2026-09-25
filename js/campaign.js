/* Campaign : déroulé d'un niveau de "La Carte des équations" (voir
   docs/gamification/plan.md). Lance l'équation du niveau sur le canevas habituel, affiche
   la barre de niveau (#levelBar), compte les étapes (hors "Simplifier"), les retours en
   arrière et les indices, reconnaît la réussite en comparant la ligne "S=..." affichée
   (App.Render.finalSolutionRanges) à la solution attendue, puis enregistre le score
   (App.Progress) et affiche la carte de réussite (#levelWin). Masque aussi, pendant un
   niveau, les actions pas encore présentées (voir isOpLocked, lu par toolbar.js). */
(function (App) {
  'use strict';

  var MAP_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linejoin="round"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/></svg>';

  var run = null;       // niveau en cours : { level, part, undos, hints, hintIdx, won, lastVerdict }
  var starting = false; // startNewEquation déclenché par la campagne elle-même
  var usedFeatures = {}; // actions présentées ET déjà utilisées (plus de halo)
  var bar, hintEl, winEl, toastEl;

  // ---- Comparaison d'ensembles-solution ----
  function near(a, b) {
    if (a === b) return true;
    if (!isFinite(a) || !isFinite(b)) return false;
    return Math.abs(a - b) < 1e-6;
  }

  function rangesEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    return a.every(function (r, i) {
      var s = b[i];
      return near(r.from, s.from) && near(r.to, s.to) &&
        (!isFinite(r.from) || !!r.fromIncluded === !!s.fromIncluded) &&
        (!isFinite(r.to) || !!r.toIncluded === !!s.toIncluded);
    });
  }

  // ---- Comptage des étapes (hors "Simplifier") ----
  // Chaque étape confirmée compte pour 1, sauf une étape "Simplifier". Chaque scission
  // compte aussi pour 1 ("Produit nul", une colonne "Condition d'existence", le tableau de
  // signes), sauf celle de l'étape 2 de "Racine carrée", déclenchée par "Simplifier".
  function isSimplifyStep(step) {
    var l = step.opLeft, r = step.opRight;
    var lt = l && l.type, rt = r && r.type;
    return (!lt || lt === 'simplify') && (!rt || rt === 'simplify') && (lt || rt);
  }

  function countEngine(eng) {
    var n = 0;
    var own = eng.getLeaf ? eng.getLeaf() : eng;
    own.getSteps().forEach(function (step, i) { if (i > 0 && !isSimplifyStep(step)) n += 1; });
    var br = eng.getBranches ? eng.getBranches() : null;
    if (br) {
      var label = eng.getBranchSplitLabel ? eng.getBranchSplitLabel() : '';
      if (label.indexOf('simplifier') === -1) n += 1;
      br.forEach(function (b) { n += countEngine(b); });
    }
    var dc = eng.getDomainConditions ? eng.getDomainConditions() : null;
    (dc || []).forEach(function (c) { n += 1 + countEngine(c.engine); });
    var sc = eng.getSignChart ? eng.getSignChart() : null;
    if (sc) {
      n += 1;
      sc.factors.forEach(function (f) { n += countEngine(f.engine); });
    }
    return n;
  }

  function stepCount() {
    return (run ? run.priorSteps : 0) + countEngine(App.History);
  }

  // ---- Actions masquées ----
  function lockedFeatures() {
    if (!run) return {};
    var known = App.Progress.knownFeatures();
    (run.level.feat || []).forEach(function (f) { known[f] = true; });
    var locked = {};
    Object.keys(App.Levels.FEATURES).forEach(function (f) { if (!known[f]) locked[f] = true; });
    return locked;
  }

  function isOpLocked(op) {
    if (!run) return false;
    var locked = lockedFeatures();
    return Object.keys(locked).some(function (f) { return App.Levels.FEATURES[f].op === op; });
  }

  function applyKeyLocks() {
    var locked = lockedFeatures();
    Object.keys(App.Levels.FEATURES).forEach(function (f) {
      var key = App.Levels.FEATURES[f].key;
      if (key) document.body.classList.toggle('campaign-lock-key-' + key, !!locked[f]);
    });
    // Halo sur l'action présentée par ce niveau, jusqu'à sa première utilisation.
    document.querySelectorAll('.campaign-new').forEach(function (e) { e.classList.remove('campaign-new'); });
    if (!run || run.won) return;
    var known = App.Progress.knownFeatures();
    (run.level.feat || []).forEach(function (f) {
      if (known[f] || usedFeatures[f]) return;
      var def = App.Levels.FEATURES[f];
      var sel = def.op ? '#opButtons button[data-op="' + def.op + '"]' : '[data-key="' + def.key + '"]';
      document.querySelectorAll(sel).forEach(function (e) { e.classList.add('campaign-new'); });
    });
  }

  // ---- Barre de niveau ----
  function renderBar() {
    if (!run) { bar.hidden = true; hintEl.hidden = true; return; }
    var l = run.level, z = App.Levels.zone(l.zone);
    var parts = App.Levels.partsOf(l);
    bar.hidden = false;
    bar.querySelector('[data-level-title]').textContent = (l.daily ? 'Défi du jour' : l.id.toUpperCase() + ' · ' + l.title);
    bar.querySelector('[data-level-zone]').textContent = z.name + (parts.length > 1 ? ' · partie ' + (run.part + 1) + ' / ' + parts.length : '');
    var steps = stepCount();
    var par = l.par;
    var stepsEl = bar.querySelector('[data-level-steps]');
    stepsEl.textContent = par ? steps + ' / ' + par + ' étape' + (par > 1 ? 's' : '') + ' pour ★★★' : steps + ' étape' + (steps > 1 ? 's' : '');
    stepsEl.classList.toggle('over', !!par && steps > par);
    var st = bar.querySelector('[data-level-statement]');
    st.textContent = l.statement || '';
    st.hidden = !l.statement;
    var msg = bar.querySelector('[data-level-msg]');
    msg.textContent = run.message || '';
    msg.hidden = !run.message;
    bar.querySelector('[data-level-hint]').hidden = !(l.hints && l.hints.length);
  }

  function showHint() {
    if (!run || !run.level.hints) return;
    var hints = run.level.hints;
    run.hints += 1;
    var i = Math.min(run.hintIdx, hints.length - 1);
    run.hintIdx += 1;
    hintEl.querySelector('[data-hint-text]').textContent = hints[i];
    hintEl.querySelector('[data-hint-note]').textContent = 'Indice ' + (i + 1) + ' / ' + hints.length + ' · limite ce niveau à ★';
    hintEl.hidden = false;
  }

  // ---- Démarrage / sortie ----
  function startPart() {
    var part = App.Levels.partsOf(run.level)[run.part];
    var eq = run.level.daily ? run.dailyEq : App.Parser.parseLatexEquation(part.latex);
    starting = true;
    try {
      App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
    } finally {
      starting = false;
    }
  }

  function startLevel(id) {
    var level = App.Levels.get(id);
    if (!level || !App.Progress.isAvailable(level)) return false;
    run = { level: level, part: 0, undos: 0, hints: 0, hintIdx: 0, won: false, message: null, priorSteps: 0, verdictKey: null };
    if (level.daily) run.dailyEq = App.Campaign.dailyEquation();
    hideWin();
    hintEl.hidden = true;
    document.body.classList.add('in-level');
    App.Map.close();
    App.Progress.setLastScreen('map');
    startPart();
    renderBar();
    applyKeyLocks();
    App.Toolbar.render();
    return true;
  }

  function exitLevel() {
    if (!run) return;
    run = null;
    hideWin();
    document.body.classList.remove('in-level');
    renderBar();
    applyKeyLocks();
    App.Toolbar.render();
  }

  // ---- Réussite ----
  function currentVerdict() {
    var part = run.level.daily ? { sol: run.dailySol } : App.Levels.partsOf(run.level)[run.part];
    var Hist = App.History;
    var conds = Hist.getDomainConditions();
    var domain = App.Render.domainRanges(conds);
    if (run.level.kind === 'domain') {
      if (!conds || !conds.length || !domain) return null;
      return rangesEqual(domain, part.domain) ? 'win' : 'wrong';
    }
    var ranges = App.Render.finalSolutionRanges();
    if (!ranges) return null;
    if (part.sol === undefined) return 'win'; // défi du jour : toute solution affichée
    if (!rangesEqual(ranges, part.sol)) return (part.requireDomain && (!conds || !conds.length)) ? 'domain' : 'wrong';
    if (part.requireDomain && (!conds || !conds.length)) return 'domain';
    return 'win';
  }

  function check() {
    if (!run || run.won) return;
    var verdict = currentVerdict();
    var key = verdict + ':' + stepCount();
    if (verdict === 'wrong' || verdict === 'domain') {
      if (run.verdictKey !== key) {
        run.message = verdict === 'domain'
          ? 'Presque ! Pense à la condition d\'existence avant de conclure.'
          : 'Presque ! Ce n\'est pas la bonne solution. Reviens en arrière avec « Annuler ».';
      }
    } else {
      run.message = null;
    }
    run.verdictKey = key;
    if (verdict !== 'win') { renderBar(); return; }
    var parts = run.level.daily ? [1] : App.Levels.partsOf(run.level);
    if (run.part + 1 < parts.length) {
      run.priorSteps = stepCount();
      run.part += 1;
      toast('Partie ' + run.part + ' réussie', 'Passons à la suivante.', '✓');
      setTimeout(function () { if (run) { startPart(); renderBar(); } }, 900);
      return;
    }
    win();
  }

  function win() {
    run.won = true;
    run.message = null;
    var steps = stepCount();
    var clean = run.hints === 0 && run.undos === 0;
    var efficient = !run.level.par || steps <= run.level.par;
    var stars = 1 + (clean ? 1 : 0) + (efficient ? 1 : 0);
    if (run.hints > 0) stars = 1;
    var result = null;
    if (run.level.daily) {
      App.Progress.recordDaily();
    } else {
      result = App.Progress.recordWin(run.level.id, { stars: stars, steps: steps });
    }
    run.result = result;
    renderBar();
    applyKeyLocks();
    App.Toolbar.render();
    showWin(stars, steps, clean, efficient);
    if (result) {
      result.earnedBadges.forEach(function (b, i) {
        var badge = App.Levels.badge(b);
        setTimeout(function () { toast('Badge « ' + badge.name + ' »', badge.desc, badge.mark); }, 1400 + i * 2600);
      });
    }
  }

  function nextLevel() {
    var P = App.Progress;
    var list = App.Levels.LEVELS;
    var idx = list.indexOf(run.level);
    var after = list.slice(idx + 1).concat(list.slice(0, idx));
    return after.filter(function (l) { return P.isAvailable(l) && !P.isSolved(l.id) && !l.daily; })[0] || null;
  }

  function showWin(stars, steps, clean, efficient) {
    var l = run.level;
    winEl.querySelector('[data-win-title]').textContent = l.daily ? 'Défi du jour réussi' : l.title;
    var starEls = winEl.querySelectorAll('[data-win-star]');
    starEls.forEach(function (s, i) { s.classList.toggle('on', i < stars); });
    var crit = winEl.querySelector('[data-win-criteria]');
    crit.innerHTML = '';
    function row(okFlag, text) {
      var d = document.createElement('div');
      d.className = okFlag ? 'ok' : 'ko';
      d.textContent = (okFlag ? '✓ ' : '○ ') + text;
      crit.appendChild(d);
    }
    row(true, 'Équation résolue');
    row(clean, run.hints ? 'Indice utilisé : le niveau est limité à ★' : (clean ? 'Sans indice ni « Annuler »' : '« Annuler » utilisé'));
    if (l.par) row(efficient, steps + ' étape' + (steps > 1 ? 's' : '') + (efficient ? ', dans la limite de ' : ', il en faut ') + l.par + (efficient ? '' : ' au plus pour ★★★'));
    if (l.daily) {
      var n = App.Progress.dailyStreak();
      row(true, 'Série : ' + n + ' jour' + (n > 1 ? 's' : '') + ' d\'affilée');
    }
    var next = l.daily ? null : nextLevel();
    var nextBtn = winEl.querySelector('[data-win-next]');
    nextBtn.hidden = !next;
    nextBtn.onclick = function () { if (next) startLevel(next.id); };
    winEl.hidden = false;
    var starsBox = winEl.querySelector('.win-stars');
    starsBox.classList.remove('play');
    void starsBox.offsetWidth;
    starsBox.classList.add('play');
  }

  function hideWin() { if (winEl) winEl.hidden = true; }

  function toast(title, text, mark) {
    toastEl.querySelector('[data-toast-ico]').textContent = mark || '★';
    toastEl.querySelector('[data-toast-title]').textContent = title;
    toastEl.querySelector('[data-toast-text]').textContent = text;
    toastEl.classList.remove('show');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 2400);
  }

  function openMap(extra) {
    var opts = extra || {};
    if (!opts.focus && run) opts.focus = run.level.id;
    App.Map.open(opts);
  }

  // ---- Initialisation ----
  function init() {
    bar = document.getElementById('levelBar');
    hintEl = document.getElementById('levelHint');
    winEl = document.getElementById('levelWin');
    toastEl = document.getElementById('campaignToast');

    initProgressIO();
    var mapBtn = document.getElementById('mapBtn');
    mapBtn.innerHTML = MAP_SVG;
    mapBtn.addEventListener('click', function () { openMap(); });

    App.Map.init({
      onPlay: function (id) { startLevel(id); },
      onFree: function () { exitLevel(); }
    });

    bar.querySelector('[data-level-hint]').addEventListener('click', showHint);
    bar.querySelector('[data-level-restart]').addEventListener('click', function () { if (run) startLevel(run.level.id); });
    hintEl.querySelector('[data-hint-close]').addEventListener('click', function () { hintEl.hidden = true; });
    winEl.querySelector('[data-win-replay]').addEventListener('click', function () { if (run) startLevel(run.level.id); });
    winEl.querySelector('[data-win-map]').addEventListener('click', function () {
      var res = run && run.result;
      var from = run && run.level.id;
      hideWin();
      App.Map.open({ from: from, focus: res && res.unlocked.length ? res.unlocked[0] : from, unlocked: res ? res.unlocked : [] });
    });

    // Toute autre nouvelle équation ("+", générateur…) quitte le niveau.
    var rawStart = App.History.startNewEquation;
    App.History.startNewEquation = function () {
      if (!starting) exitLevel();
      return rawStart.apply(App.History, arguments);
    };
    var rawUndo = App.History.undo;
    App.History.undo = function () {
      if (run && !run.won && App.History.canUndo()) run.undos += 1;
      return rawUndo.apply(App.History, arguments);
    };
    // Une action présentée par le niveau perd son halo à sa première utilisation.
    document.addEventListener('click', function (e) {
      if (!run) return;
      var t = e.target.closest && e.target.closest('.campaign-new');
      if (!t) return;
      Object.keys(App.Levels.FEATURES).forEach(function (f) {
        var def = App.Levels.FEATURES[f];
        if ((def.op && t.getAttribute('data-op') === def.op) || (def.key && t.getAttribute('data-key') === def.key)) usedFeatures[f] = true;
      });
      t.classList.remove('campaign-new');
    }, true);

    App.History.subscribe(function () {
      if (!run) return;
      check();
      renderBar();
      applyKeyLocks();
    });
  }

  // Réglages : exporter la progression dans un fichier .json, ou la réimporter.
  function initProgressIO() {
    var note = document.getElementById('progressNote');
    var fileInput = document.getElementById('progressImportFile');
    function say(text, cls) { note.textContent = text; note.className = 'progress-note' + (cls ? ' ' + cls : ''); }
    document.getElementById('progressExport').addEventListener('click', function () {
      var blob = new Blob([App.Progress.exportJSON()], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'progression-equations-' + App.Progress.today() + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      say('Fichier enregistré dans tes téléchargements.', 'ok');
    });
    document.getElementById('progressImport').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (App.Progress.importJSON(String(reader.result))) {
          say('Progression importée : ' + App.Progress.totalStars() + ' ★.', 'ok');
        } else {
          say('Ce fichier n\'est pas une progression de l\'application.', 'err');
        }
        fileInput.value = '';
      };
      reader.readAsText(f);
    });
  }

  // Premier écran : la carte au tout premier lancement, puis le dernier écran utilisé.
  // Pas sous un navigateur piloté (tests Playwright, qui partent tous d'un profil vierge
  // et attendent le canevas) sauf demande explicite (opts.force).
  function boot(opts) {
    if (navigator.webdriver && !(opts && opts.force)) return;
    var last = App.Progress.lastScreen();
    if (!App.Progress.hasProgress() || last === 'map' || last === null) openMap();
  }

  App.Campaign = {
    init: init,
    boot: boot,
    startLevel: startLevel,
    exitLevel: exitLevel,
    isOpLocked: isOpLocked,
    stepCount: stepCount,
    rangesEqual: rangesEqual,
    current: function () { return run ? { id: run.level.id, part: run.part, undos: run.undos, hints: run.hints, won: run.won, message: run.message } : null; },
    showHint: showHint,
    // Remplacé par le défi du jour (voir plus bas, étape 4) ; par défaut une équation générée.
    dailyEquation: function () { return App.Generator.generateEquation(); }
  };
})(window.App = window.App || {});
