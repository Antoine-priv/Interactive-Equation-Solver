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

  // Déplacement animé seulement quand l'étape change : on interpole depuis l'ancienne
  // position vers la position *actuelle* de la cible (relue à chaque image, elle peut encore
  // bouger avec le recentrage du canevas), si bien que le contour arrive exactement dessus.
  // Le reste du temps il colle à sa cible, sans transition qui le ferait traîner.
  var GLIDE_MS = 250;
  var lastIndex = -1, glide = null, drawn = null;
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function position() {
    var cur = currentStep();
    var visible = !!cur && !document.body.classList.contains('map-open') && !(App.Campaign.current() || {}).won;
    bubble.hidden = !visible;
    if (!visible) { ring.hidden = true; lastIndex = -1; drawn = null; return; }
    if (cur.index !== lastIndex) {
      glide = lastIndex !== -1 && drawn ? { from: drawn, t0: performance.now() } : null;
      lastIndex = cur.index;
      bubble.querySelector('[data-coach-step]').textContent = 'Coach · ' + (cur.index + 1) + ' / ' + script.length;
      bubble.querySelector('[data-coach-text]').textContent = cur.step.text;
      var btn = bubble.querySelector('[data-coach-ok]');
      btn.hidden = !cur.step.manual;
      btn.onclick = function () { manualDone[cur.index] = true; refresh(); };
    }
    var target = resolveTarget(cur.step.target);
    var r = target && target.getBoundingClientRect();
    if (!r || (!r.width && !r.height)) {
      ring.hidden = true;
      drawn = null;
      bubble.style.left = '50%';
      bubble.style.top = '';
      bubble.style.bottom = '32px';
      bubble.style.transform = 'translateX(-50%)';
      bubble.className = 'coach-bubble';
      return;
    }
    // Ne rebasculer `hidden` que s'il change : le repasser à true puis false relancerait
    // l'animation de pulsation à chaque recalage.
    if (ring.hidden) ring.hidden = false;
    var bw = bubble.offsetWidth || 280, bh = bubble.offsetHeight || 80;
    var below = r.bottom + 14 + bh < window.innerHeight - 10;
    var to = {
      x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12,
      bx: Math.max(12, Math.min(window.innerWidth - bw - 12, r.left + r.width / 2 - bw / 2)),
      by: below ? r.bottom + 14 : r.top - 14 - bh
    };
    var d = to;
    if (glide) {
      var t = Math.min(1, (performance.now() - glide.t0) / GLIDE_MS);
      if (t >= 1) glide = null;
      else {
        var k = ease(t), f = glide.from;
        d = { x: lerp(f.x, to.x, k), y: lerp(f.y, to.y, k), w: lerp(f.w, to.w, k), h: lerp(f.h, to.h, k),
          bx: lerp(f.bx, to.bx, k), by: lerp(f.by, to.by, k) };
        trackUntil = Math.max(trackUntil, performance.now() + 50);
      }
    }
    drawn = d;
    ring.style.transform = 'translate(' + d.x + 'px, ' + d.y + 'px)';
    ring.style.width = d.w + 'px';
    ring.style.height = d.h + 'px';
    // Le halo s'étend de 14 px de chaque côté : échelle propre à chaque axe.
    ring.style.setProperty('--coach-sx', ((d.w + 28) / d.w).toFixed(4));
    ring.style.setProperty('--coach-sy', ((d.h + 28) / d.h).toFixed(4));
    bubble.style.transform = '';
    bubble.style.bottom = '';
    bubble.style.left = d.bx + 'px';
    bubble.style.top = d.by + 'px';
    var cls = 'coach-bubble ' + (below ? 'below' : 'above');
    if (bubble.className !== cls) bubble.className = cls;
    bubble.style.setProperty('--coach-arrow-x', Math.max(16, Math.min(bw - 16, r.left + r.width / 2 - d.bx)) + 'px');
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
    lastIndex = -1;
    glide = drawn = null;
    if (bubble) { bubble.hidden = true; ring.hidden = true; }
  }

  function init() {
    bubble = document.getElementById('coachBubble');
    ring = document.getElementById('coachRing');
    App.History.subscribe(function () { if (script) refresh(); });
    window.addEventListener('resize', function () { if (script) refresh(); });
    document.addEventListener('mouseup', function () { if (script) refresh(); });
    document.addEventListener('wheel', function () { if (script) refresh(); }, { passive: true });
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
