/* Ineq : petites conventions partagées par les colonnes "Condition d'existence" en mode
   inégalité (radicand>=0 d'une racine carrée, voir existenceConditionAction dans
   history.js) — Equation (equation.js) reste volontairement opérateur-agnostique
   (toujours "=" implicite), ces conventions vivent donc à part plutôt que de la polluer.
   isSolved n'a PAS besoin d'un équivalent ici : "x seul d'un côté, une constante de
   l'autre" (App.Equation.isSolved) est déjà vrai quel que soit l'opérateur réellement en
   jeu. Héberge aussi les ensembles de solutions "S=..." (voir plus bas), communs aux
   équations et aux inéquations. */
(function (App) {
  'use strict';

  // Sens inversé par une multiplication/division par un nombre NÉGATIF (voir confirm()
  // en mode 'expr' dans history.js, pour un moteur dont `currentOperator` est non nul) :
  // une inégalité stricte/large change juste de sens, jamais de nature.
  var FLIP = { '\\geq': '\\leq', '\\leq': '\\geq', '<': '>', '>': '<' };

  function flipOperator(op) {
    return FLIP[op] || op;
  }

  // Les 4 opérateurs d'inégalité reconnus par l'app (hors "=", implicite/null partout où
  // un `operator` est optionnel) — source unique partagée par parser.js
  // (splitTopLevelRelation), le sélecteur de relation de la modale "Nouvelle équation"
  // (newEquationModal.js) et le générateur d'inéquations (generator.js).
  var OPERATORS = ['\\geq', '\\leq', '<', '>'];

  // Notation en intervalle d'une inégalité linéaire déjà résolue ("x <op> r", voir
  // App.Equation.solvedValue) — demi-droite : utilisé par la combinaison "Df=..." dans
  // renderDomainSplit (render.js).
  function halfLineLatex(root, operator) {
    if (operator === '\\geq') return '\\left[' + root + ';+\\infty\\right[';
    if (operator === '\\leq') return '\\left]-\\infty;' + root + '\\right]';
    if (operator === '>') return '\\left]' + root + ';+\\infty\\right[';
    if (operator === '<') return '\\left]-\\infty;' + root + '\\right[';
    return null;
  }

  // ---- Ensembles de solutions ("S=...") ----
  // Un ensemble est une liste triée d'intervalles disjoints { from, to, fromIncluded,
  // toIncluded } (même forme que signChartSolutionRanges dans history.js) : [] pour
  // l'ensemble vide, un seul intervalle ]-∞;+∞[ pour R, un point isolé r pour
  // { from:r, to:r, fromIncluded:true, toIncluded:true }.
  var ALL_REALS = [{ from: -Infinity, to: Infinity, fromIncluded: false, toIncluded: false }];

  function point(r) {
    return { from: r, to: r, fromIncluded: true, toIncluded: true };
  }

  // Demi-droite "x <op> r" (x à GAUCHE de l'opérateur).
  function halfLineRange(r, operator) {
    if (operator === '\\geq') return { from: r, to: Infinity, fromIncluded: true, toIncluded: false };
    if (operator === '>') return { from: r, to: Infinity, fromIncluded: false, toIncluded: false };
    if (operator === '\\leq') return { from: -Infinity, to: r, fromIncluded: false, toIncluded: true };
    if (operator === '<') return { from: -Infinity, to: r, fromIncluded: false, toIncluded: false };
    return null;
  }

  function compare(a, b, operator) {
    if (!operator) return a === b;
    if (operator === '\\geq') return a >= b;
    if (operator === '\\leq') return a <= b;
    if (operator === '>') return a > b;
    if (operator === '<') return a < b;
    return false;
  }

  // Ensemble de solutions d'une équation/inéquation ARRIVÉE AU BOUT (`operator` null pour
  // "=") : "x=r"/"r=x" (App.Equation.isSolved), ou deux constantes ("3=5" -> vide, "0=0"
  // -> R, "0<5" -> R...). null tant qu'elle n'est sous aucune de ces formes.
  function solutionRanges(eq, operator) {
    var Eq = App.Equation;
    if (Eq.isSolved(eq)) {
      var r = Eq.solvedValue(eq);
      if (!operator) return [point(r)];
      // "r <op> x" se lit "x <op inversé> r".
      var xOnLeft = App.Expr.sideIsSingleTerm(eq.left) && eq.left[0].pow === 1;
      return [halfLineRange(r, xOnLeft ? operator : flipOperator(operator))];
    }
    if (Eq.isConstantSide(eq.left) && Eq.isConstantSide(eq.right)) {
      var a = App.Expr.roundClean(eq.left[0].coeff), b = App.Expr.roundClean(eq.right[0].coeff);
      return compare(a, b, operator) ? ALL_REALS.slice() : [];
    }
    return null;
  }

  // Réunion (triée, intervalles fusionnés) d'une liste quelconque d'intervalles — à borne
  // gauche égale, l'intervalle qui l'INCLUT passe en premier.
  function unionRanges(ranges) {
    var sorted = ranges.slice().sort(function (p, q) {
      if (p.from !== q.from) return p.from - q.from;
      return (q.fromIncluded ? 1 : 0) - (p.fromIncluded ? 1 : 0);
    });
    var out = [];
    sorted.forEach(function (r) {
      var last = out[out.length - 1];
      // Chevauchement, ou simple contact dont au moins une des deux bornes est incluse.
      if (last && (r.from < last.to || (r.from === last.to && (last.toIncluded || r.fromIncluded)))) {
        if (r.to > last.to || (r.to === last.to && r.toIncluded)) {
          last.to = r.to;
          last.toIncluded = r.toIncluded;
        }
      } else {
        out.push({ from: r.from, to: r.to, fromIncluded: r.fromIncluded, toIncluded: r.toIncluded });
      }
    });
    return out;
  }

  function intersectRanges(A, B) {
    var out = [];
    A.forEach(function (a) {
      B.forEach(function (b) {
        var from, fromIncluded, to, toIncluded;
        if (a.from > b.from) { from = a.from; fromIncluded = a.fromIncluded; }
        else if (b.from > a.from) { from = b.from; fromIncluded = b.fromIncluded; }
        else { from = a.from; fromIncluded = a.fromIncluded && b.fromIncluded; }
        if (a.to < b.to) { to = a.to; toIncluded = a.toIncluded; }
        else if (b.to < a.to) { to = b.to; toIncluded = b.toIncluded; }
        else { to = a.to; toIncluded = a.toIncluded && b.toIncluded; }
        if (from < to || (from === to && fromIncluded && toIncluded)) {
          out.push({ from: from, to: to, fromIncluded: fromIncluded, toIncluded: toIncluded });
        }
      });
    });
    return unionRanges(out);
  }

  // R privé des points `values` (ex. le domaine d'un dénominateur "x≠r").
  function complementOfPoints(values) {
    var sorted = values.slice().sort(function (p, q) { return p - q; });
    var out = [];
    var prev = -Infinity;
    sorted.forEach(function (v) {
      if (v === prev) return;
      out.push({ from: prev, to: v, fromIncluded: false, toIncluded: false });
      prev = v;
    });
    out.push({ from: prev, to: Infinity, fromIncluded: false, toIncluded: false });
    return out;
  }

  // Notation française : "\emptyset", "\mathbb{R}", "\{a;b\}" (uniquement des points),
  // "\mathbb{R}\setminus\{a\}" (R privé de points), sinon réunion d'intervalles
  // "]-∞;a]∪[b;+∞[" — une borne infinie toujours ouverte.
  function rangesLatex(ranges) {
    function num(v) {
      if (v === -Infinity) return '-\\infty';
      if (v === Infinity) return '+\\infty';
      return (v < 0 ? '-' : '') + App.Expr.formatNumberLatex(v);
    }
    if (!ranges.length) return '\\emptyset';
    function isPoint(r) { return r.from === r.to && r.fromIncluded && r.toIncluded; }
    if (ranges.every(isPoint)) {
      return '\\left\\{' + ranges.map(function (r) { return num(r.from); }).join('\\,;\\,') + '\\right\\}';
    }
    var first = ranges[0], last = ranges[ranges.length - 1];
    if (first.from === -Infinity && last.to === Infinity) {
      var holes = [];
      var isPunctured = ranges.every(function (r, i) {
        if (i === 0) return true;
        var prev = ranges[i - 1];
        if (prev.to !== r.from || prev.toIncluded || r.fromIncluded) return false;
        holes.push(r.from);
        return true;
      });
      if (isPunctured) {
        if (!holes.length) return '\\mathbb{R}';
        return '\\mathbb{R}\\setminus\\left\\{' + holes.map(num).join('\\,;\\,') + '\\right\\}';
      }
    }
    return ranges.map(function (r) {
      if (isPoint(r)) return '\\left\\{' + num(r.from) + '\\right\\}';
      var openLeft = r.from === -Infinity || !r.fromIncluded;
      var openRight = r.to === Infinity || !r.toIncluded;
      return (openLeft ? '\\left]' : '\\left[') + num(r.from) + ';' + num(r.to) +
        (openRight ? '\\right[' : '\\right]');
    }).join('\\cup');
  }

  App.Ineq = {
    flipOperator: flipOperator,
    halfLineLatex: halfLineLatex,
    OPERATORS: OPERATORS,
    ALL_REALS: ALL_REALS,
    solutionRanges: solutionRanges,
    unionRanges: unionRanges,
    intersectRanges: intersectRanges,
    complementOfPoints: complementOfPoints,
    rangesLatex: rangesLatex
  };
})(window.App = window.App || {});
