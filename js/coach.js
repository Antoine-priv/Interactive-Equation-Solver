/* Coach : bulles du tutoriel (le Port, niveaux t1 à t7, voir docs/gamification/plan.md).
   Chaque niveau a une liste d'étapes { text, target, done } : l'étape affichée est la
   première dont `done(state)` est faux ; `target` désigne l'élément à entourer (sélecteur
   ou fonction). Une étape `manual` attend un clic sur « Compris ». Le coach suit l'action
   réelle de l'élève (App.History.subscribe) et ne bloque jamais rien. */
(function (App) {
  'use strict';

  var bubble, ring;
  var script = null, levelId = null, manualDone = {}, raf = null;

  function S() {
    var H = App.History;
    var eq = H.lastEquation();
    return { H: H, eq: eq, pending: H.getPending(), steps: H.getSteps().length, solved: App.Equation.isSolved(eq) };
  }
  function term(side, i) {
    return function () { return document.querySelector('.eq-row.current .side[data-side="' + side + '"] [data-index="' + i + '"]'); };
  }
  function sideEl(side) {
    return function () { return document.querySelector('.eq-row.current .side[data-side="' + side + '"]'); };
  }
  function op(name) { return '#opButtons:not([hidden]) button[data-op="' + name + '"]'; }
  var KEYPAD = '#mathKeypadPanel';
  function countTerms(side) { return function (s) { return s.eq[side].length <= 1; }; }
  function sel(side, i) { return function (s) { return (side === 'left' ? s.pending.selectedLeft : s.pending.selectedRight).indexOf(i) !== -1; }; }
  function opened(s) { return s.pending.opType === 'expr'; }
  function or() {
    var fns = Array.prototype.slice.call(arguments);
    return function (s) { return fns.some(function (f) { return f(s); }); };
  }
  function stepsAtLeast(n) { return function (s) { return s.steps >= n; }; }

  var SCRIPTS = {
    t1: [
      { text: 'Clique sur le 3 pour le sélectionner.', target: term('left', 1), done: or(sel('left', 1), opened, stepsAtLeast(2)) },
      { text: 'Clique sur « Opération » : ce que tu tapes s\'applique aux deux côtés.', target: op('expr'), done: or(opened, stepsAtLeast(2)) },
      { text: 'Tape −3 avec le pavé, puis valide avec la touche ⏎.', target: KEYPAD, done: stepsAtLeast(2) },
      { text: 'Les deux côtés ont changé de la même façon (la flèche rappelle l\'opération faite). Sélectionne 3 et −3, puis clique sur « Simplifier ».', target: sideEl('left'), done: countTerms('left') },
      { text: 'Fais de même à droite avec 7 et −3.', target: sideEl('right'), done: function (s) { return s.solved; } }
    ],
    t3: [
      { text: '3x veut dire « 3 fois x ». Ouvre « Opération » et tape ÷3.', target: term('left', 0), done: stepsAtLeast(2) },
      { text: 'Simplifie chaque côté.', target: sideEl('left'), done: function (s) { return s.solved; } }
    ],
    t4: [
      { text: 'Nouveau geste : attrape le 8 et lâche-le de l\'autre côté du « = ».', target: term('left', 1), done: stepsAtLeast(2) },
      { text: 'L\'application a écrit −8 des deux côtés pour toi. Simplifie.', target: sideEl('left'), done: function (s) { return s.solved; } }
    ],
    t5: [
      { text: 'Commence par faire passer le 5 de l\'autre côté.', target: term('left', 1),
        done: function (s) { return !s.eq.left.some(function (t) { return t.pow === 0; }) || s.solved; } },
      { text: 'Simplifie, puis glisse le 2 de 2x de l\'autre côté : c\'est une division.',
        target: function () { return document.querySelector('.eq-row.current .coeff-slot') || document.querySelector('.eq-row.current .side[data-side="left"]'); },
        done: function (s) { return s.solved; } }
    ],
    t6: [
      { text: '3x et 2x peuvent se réunir : sélectionne-les tous les deux.', target: term('left', 0),
        done: function (s) { return (sel('left', 0)(s) && sel('left', 1)(s)) || s.eq.left.filter(function (t) { return t.pow === 1; }).length < 2; } },
      { text: 'Clique sur « Simplifier » : ils deviennent 5x.', target: op('simplify'),
        done: function (s) { return s.eq.left.filter(function (t) { return t.pow === 1; }).length < 2; } },
      { text: 'Termine seul : isole x.', target: sideEl('left'), done: function (s) { return s.solved; } }
    ],
    t7: [
      { text: 'Cette résolution va s\'allonger. Fais glisser le fond pour te déplacer, et utilise les loupes pour zoomer.', target: '#zoomOutBtn', manual: true },
      { text: 'Rassemble les x d\'un côté, puis isole x.', target: sideEl('left'), done: function (s) { return s.solved; } }
    ]
  };

  function currentStep() {
    if (!script) return null;
    var s = S();
    for (var i = 0; i < script.length; i++) {
      var st = script[i];
      var isDone = st.manual ? !!manualDone[i] : st.done(s);
      if (!isDone) return { step: st, index: i };
    }
    return null;
  }

  function resolveTarget(t) {
    if (!t) return null;
    return typeof t === 'function' ? t() : document.querySelector(t);
  }

  // Changement d'étape : la bulle disparaît en rétrécissant (avec l'ancien texte), puis
  // réapparaît en grandissant avec le nouveau, à sa nouvelle place. Le contour, lui, saute
  // directement sur la nouvelle cible (pas de glissement) sans disparaître, pour ne pas
  // relancer sa pulsation.
  var OUT_MS = 140;
  var shownIndex = -1, popping = false, outTimer = null;
  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function popOut() {
    popping = true;
    bubble.classList.remove('coach-in');
    bubble.classList.add('coach-out');
    clearTimeout(outTimer);
    outTimer = setTimeout(function () {
      popping = false;
      bubble.classList.remove('coach-out');
      bubble.hidden = true;
      shownIndex = -1;
      refresh();
    }, reducedMotion() ? 0 : OUT_MS);
  }
  function popIn() {
    bubble.classList.remove('coach-in');
    void bubble.offsetWidth;
    bubble.classList.add('coach-in');
  }

  function placeRing(r) {
    if (!r) { ring.hidden = true; return; }
    // Ne rebasculer `hidden` que s'il change : le repasser à true puis false relancerait
    // l'animation de pulsation à chaque recalage.
    if (ring.hidden) ring.hidden = false;
    var w = r.width + 12, h = r.height + 12;
    ring.style.transform = 'translate(' + (r.left - 6) + 'px, ' + (r.top - 6) + 'px)';
    ring.style.width = w + 'px';
    ring.style.height = h + 'px';
    // Le halo s'étend de 14 px de chaque côté : échelle propre à chaque axe.
    ring.style.setProperty('--coach-sx', ((w + 28) / w).toFixed(4));
    ring.style.setProperty('--coach-sy', ((h + 28) / h).toFixed(4));
  }

  function placeBubble(r) {
    if (!r) {
      bubble.style.left = '50%';
      bubble.style.top = '';
      bubble.style.bottom = '32px';
      bubble.style.transform = 'translateX(-50%)';
      bubble.classList.remove('below', 'above');
      return;
    }
    var bw = bubble.offsetWidth || 280, bh = bubble.offsetHeight || 80;
    // Contour à 6 px de la cible, flèche de 8 px, puis 6 px d'air entre sa pointe et le contour.
    var GAP = 20;
    var below = r.bottom + GAP + bh < window.innerHeight - 10;
    var left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
    bubble.style.transform = '';
    bubble.style.bottom = '';
    bubble.style.left = left + 'px';
    bubble.style.top = (below ? r.bottom + GAP : r.top - GAP - bh) + 'px';
    bubble.classList.toggle('below', below);
    bubble.classList.toggle('above', !below);
    bubble.style.setProperty('--coach-arrow-x', Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - left)) + 'px');
  }

  function position() {
    var cur = currentStep();
    var visible = !!cur && !document.body.classList.contains('map-open') && !(App.Campaign.current() || {}).won;
    if (!visible) {
      ring.hidden = true;
      if (!bubble.hidden && !popping) popOut();
      return;
    }
    var target = resolveTarget(cur.step.target);
    var r = target && target.getBoundingClientRect();
    if (r && !r.width && !r.height) r = null;
    placeRing(r);
    if (popping) return;
    if (cur.index !== shownIndex) {
      if (!bubble.hidden) { popOut(); return; }
      shownIndex = cur.index;
      bubble.querySelector('[data-coach-step]').textContent = 'Coach · ' + (cur.index + 1) + ' / ' + script.length;
      bubble.querySelector('[data-coach-text]').textContent = cur.step.text;
      var btn = bubble.querySelector('[data-coach-ok]');
      btn.hidden = !cur.step.manual;
      btn.onclick = function () { manualDone[cur.index] = true; refresh(); };
      bubble.hidden = false;
      placeBubble(r);
      popIn();
      return;
    }
    placeBubble(r);
  }

  // Après chaque rendu, renderAll recentre le canevas avec une transition CSS (et les lignes
  // sont reconstruites) : la cible bouge encore un moment, on la suit donc à chaque image
  // pendant une seconde plutôt qu'à quelques instants fixes, qui la saisissaient en plein
  // mouvement et plaçaient le contour à une position intermédiaire.
  var trackUntil = 0;
  function track() {
    raf = null;
    if (!script) return;
    position();
    if (performance.now() < trackUntil) raf = requestAnimationFrame(track);
  }
  function refresh() {
    if (!bubble) return;
    trackUntil = performance.now() + 1000;
    if (!raf) raf = requestAnimationFrame(track);
  }

  function start(id) {
    levelId = id;
    script = SCRIPTS[id] || null;
    manualDone = {};
    refresh();
  }

  function stop() {
    script = null;
    levelId = null;
    shownIndex = -1;
    popping = false;
    clearTimeout(outTimer);
    if (bubble) {
      bubble.hidden = true;
      ring.hidden = true;
      bubble.classList.remove('coach-in', 'coach-out');
    }
  }

  function init() {
    bubble = document.getElementById('coachBubble');
    ring = document.getElementById('coachRing');
    App.History.subscribe(function () { if (script) refresh(); });
    window.addEventListener('resize', function () { if (script) refresh(); });
    document.addEventListener('mouseup', function () { if (script) refresh(); });
    document.addEventListener('wheel', function () { if (script) refresh(); }, { passive: true });
    // Pendant un glisser (canevas ou terme), le contenu bouge sans autre événement : chaque
    // mouvement bouton enfoncé prolonge le suivi, même après une pause.
    document.addEventListener('mousemove', function (e) { if (script && e.buttons) refresh(); }, { passive: true, capture: true });
  }

  App.Coach = {
    init: init,
    start: start,
    stop: stop,
    refresh: refresh,
    has: function (id) { return !!SCRIPTS[id]; },
    currentIndex: function () { var c = currentStep(); return c ? c.index : -1; }
  };
})(window.App = window.App || {});
