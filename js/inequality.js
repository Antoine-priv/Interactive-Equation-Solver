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

  // "Étude de signe" (voir history.js: detectSignStudyProduct/chooseSignStudySign/
  // chooseSignStudyInterval, Phase 3 du plan) : une fois l'équation en forme
  // "(facteur1)(facteur2) <op> 0" avec deux racines distinctes (root1<root2) et le signe
  // du coefficient dominant du produit connu, ces deux fonctions PURES (aucun état —
  // testables/réutilisables indépendamment de l'engagement du mode) déterminent quel des
  // deux ensembles ("between" = entre les racines, "outside" = hors des racines) résout
  // réellement `operator`, et sa notation en intervalle. Un produit de deux binômes
  // linéaires est positif HORS des racines si son coefficient dominant est positif
  // (parabole vers le haut), négatif ENTRE elles — et l'inverse si le coefficient
  // dominant est négatif : d'où la double négation ci-dessous (`wantsPositive` XOR
  // `opensUp`).
  function signStudyChoice(info, operator) {
    var wantsPositive = operator === '\\geq' || operator === '>';
    var opensUp = info.leadingSign === '+';
    if (wantsPositive) return opensUp ? 'outside' : 'between';
    return opensUp ? 'between' : 'outside';
  }

  // Notation française standard : crochets tournés vers l'extérieur pour une borne
  // EXCLUE (ex. "]2;5[" = ouvert), vers l'intérieur pour une borne INCLUSE (ex. "[2;5]" =
  // fermé) — `operator` strict ('<'/'>') exclut les deux racines elles-mêmes, large
  // ('\geq'/'\leq') les inclut.
  function intervalLatex(info, operator, choice) {
    var strict = operator === '<' || operator === '>';
    var r1 = info.root1, r2 = info.root2;
    if (choice === 'between') {
      return strict ? ('\\left]' + r1 + ';' + r2 + '\\right[') : ('\\left[' + r1 + ';' + r2 + '\\right]');
    }
    var closeAtRoot = strict ? '\\right[' : '\\right]';
    var openAtRoot = strict ? '\\left]' : '\\left[';
    return '\\left]-\\infty;' + r1 + closeAtRoot + '\\cup' + openAtRoot + r2 + ';+\\infty\\right[';
  }

  // Notation en intervalle d'une inégalité linéaire déjà résolue ("x <op> r", voir
  // App.Equation.solvedValue) — demi-droite plutôt qu'un intervalle à 2 bornes (jamais
  // besoin de signStudyChoice/intervalLatex ci-dessus ici, qui visent le cas degré 2 à
  // 2 racines) : utilisé par la combinaison "Df=..." dans renderDomainSplit (render.js).
  function halfLineLatex(root, operator) {
    if (operator === '\\geq') return '\\left[' + root + ';+\\infty\\right[';
    if (operator === '\\leq') return '\\left]-\\infty;' + root + '\\right]';
    if (operator === '>') return '\\left]' + root + ';+\\infty\\right[';
    if (operator === '<') return '\\left]-\\infty;' + root + '\\right[';
    return null;
  }

  App.Ineq = {
    flipOperator: flipOperator,
    signStudyChoice: signStudyChoice,
    intervalLatex: intervalLatex,
    halfLineLatex: halfLineLatex
  };
})(window.App = window.App || {});
