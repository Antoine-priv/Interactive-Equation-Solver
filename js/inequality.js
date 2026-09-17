/* Ineq : petites conventions partagées par les colonnes "Condition d'existence" en mode
   inégalité (radicand>=0 d'une racine carrée, voir existenceConditionAction dans
   history.js) — Equation (equation.js) reste volontairement opérateur-agnostique
   (toujours "=" implicite), ces conventions vivent donc à part plutôt que de la polluer.
   isSolved n'a PAS besoin d'un équivalent ici : "x seul d'un côté, une constante de
   l'autre" (App.Equation.isSolved) est déjà vrai quel que soit l'opérateur réellement en
   jeu. */
(function (App) {
  'use strict';

  // Sens inversé par une multiplication/division par un nombre NÉGATIF (voir confirm()
  // en mode 'expr' dans history.js, pour un moteur dont `currentOperator` est non nul) :
  // une inégalité stricte/large change juste de sens, jamais de nature.
  var FLIP = { '\\geq': '\\leq', '\\leq': '\\geq', '<': '>', '>': '<' };

  function flipOperator(op) {
    return FLIP[op] || op;
  }

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

  App.Ineq = {
    flipOperator: flipOperator,
    halfLineLatex: halfLineLatex
  };
})(window.App = window.App || {});
