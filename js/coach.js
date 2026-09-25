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
      { text: 'Les deux côtés ont changé de la même façon. Sélectionne 3 et −3, puis clique sur « Simplifier ».', target: sideEl('left'), done: countTerms('left') },
      { text: 'Fais de même à droite avec 7 et −3.', target: sideEl('right'), done: function (s) { return s.solved; } }
    ],
    t2: [
      { text: 'Même geste : clique sur −5, puis « Opération », et tape +5.', target: term('left', 1), done: stepsAtLeast(2) },
      { text: 'La flèche entre les deux lignes rappelle l\'opération faite. Simplifie maintenant chaque côté.', target: sideEl('left'), done: function (s) { return s.solved; } }
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

  function position() {
    var cur = currentStep();
    var visible = !!cur && !document.body.classList.contains('map-open') && !(App.Campaign.current() || {}).won;
    bubble.hidden = !visible;
    ring.hidden = true;
    if (!visible) return;
    bubble.querySelector('[data-coach-step]').textContent = 'Coach · ' + (cur.index + 1) + ' / ' + script.length;
    bubble.querySelector('[data-coach-text]').textContent = cur.step.text;
    var btn = bubble.querySelector('[data-coach-ok]');
    btn.hidden = !cur.step.manual;
    btn.onclick = function () { manualDone[cur.index] = true; refresh(); };
    var target = resolveTarget(cur.step.target);
    var r = target && target.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) {
      bubble.style.left = '50%';
      bubble.style.top = '';
      bubble.style.bottom = '32px';
      bubble.style.transform = 'translateX(-50%)';
      bubble.className = 'coach-bubble';
      return;
    }
    ring.hidden = false;
    ring.style.left = (r.left - 6) + 'px';
    ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px';
    ring.style.height = (r.height + 12) + 'px';
    var bw = bubble.offsetWidth || 280, bh = bubble.offsetHeight || 80;
    var below = r.bottom + 14 + bh < window.innerHeight - 10;
    var left = Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2));
    bubble.style.transform = '';
    bubble.style.bottom = '';
    bubble.style.left = left + 'px';
    bubble.style.top = (below ? r.bottom + 14 : r.top - 14 - bh) + 'px';
    bubble.className = 'coach-bubble ' + (below ? 'below' : 'above');
    bubble.style.setProperty('--coach-arrow-x', Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - left)) + 'px');
  }

  // Après chaque rendu, renderAll recentre le canevas avec une transition CSS : la cible
  // bouge encore quelques centaines de millisecondes, on se recale donc plusieurs fois.
  var timers = [];
  function refresh() {
    if (!bubble) return;
    if (raf) cancelAnimationFrame(raf);
    timers.forEach(clearTimeout);
    raf = requestAnimationFrame(function () {
      timers = [60, 250, 500, 900].map(function (ms) { return setTimeout(position, ms); });
    });
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
    if (bubble) { bubble.hidden = true; ring.hidden = true; }
  }

  function init() {
    bubble = document.getElementById('coachBubble');
    ring = document.getElementById('coachRing');
    App.History.subscribe(function () { if (script) refresh(); });
    window.addEventListener('resize', function () { if (script) refresh(); });
    document.addEventListener('mouseup', function () { if (script) refresh(); });
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
