/* Equation = { left: Side, right: Side } + application d'opérations symétriques. */
(function (App) {
  'use strict';
  var Expr = App.Expr;

  function cloneEquation(eq) {
    return { left: Expr.cloneSide(eq.left), right: Expr.cloneSide(eq.right) };
  }

  // Applique une suite libre d'opérations +/-/×/÷ aux deux membres en une seule étape
  // (ex. +5-2x×3÷4) : le bouton "Opération" unique, sans les restrictions des anciens
  // boutons séparés qui ne prenaient qu'un seul terme/facteur à la fois.
  // ops: [{ symbol:'+'|'-', term:Term } | { symbol:'×'|'÷', factor:number, rawValue:number }]
  function applyOpSequence(eq, ops) {
    var left = eq.left, right = eq.right;
    ops.forEach(function (op) {
      if (op.symbol === '×') {
        if (op.terms) {
          // Multiplication par une expression (ex. "×(x+5)") : toujours un ProductGroup
          // "(membre)(x+5)", à développer ensuite via "Développer" — voir wrapSideInProduct.
          left = Expr.wrapSideInProduct(left, op.terms);
          right = Expr.wrapSideInProduct(right, op.terms);
        } else {
          // Affiché sous forme de parenthèse (ex. "2(-9x+3(-2))") plutôt que distribué
          // terme à terme, sauf si le membre n'a déjà qu'un seul terme.
          left = Expr.wrapSideInFactor(left, op.factor);
          right = Expr.wrapSideInFactor(right, op.factor);
        }
      } else if (op.symbol === '÷') {
        if (op.terms) {
          // Division par une expression (ex. "÷(x+5)") : voir wrapSideInQuotient, qui
          // tente d'abord d'annuler (facteur déjà présent, ou fraction déjà par CE
          // dénominateur) avant d'envelopper en une nouvelle fraction.
          left = Expr.wrapSideInQuotient(left, op.terms);
          right = Expr.wrapSideInQuotient(right, op.terms);
        } else {
          // Affiché sous forme de fraction (ex. "\frac{9x-6}{2}") plutôt que distribué
          // terme à terme, symétrique au traitement de "×" ci-dessus.
          left = Expr.wrapSideInFraction(left, op.rawValue);
          right = Expr.wrapSideInFraction(right, op.rawValue);
        }
      } else {
        left = Expr.addTermToSide(left, op.term);
        right = Expr.addTermToSide(right, op.term);
      }
    });
    return { left: left, right: right };
  }

  function applySimplify(eq, side, indices) {
    var out = cloneEquation(eq);
    out[side] = Expr.simplifyNodes(eq[side], indices);
    return out;
  }

  // Simplifie indépendamment le membre gauche et/ou le membre droit en une seule étape.
  // leftIndices/rightIndices : tableaux d'indices (peuvent être vides ou avoir <2 éléments
  // pour ne pas toucher au membre correspondant).
  function applySimplifyBoth(eq, leftIndices, rightIndices) {
    var out = cloneEquation(eq);
    var opLeft = null, opRight = null;
    if (leftIndices && leftIndices.length >= 2) {
      var leftSorted = leftIndices.slice().sort(function (a, b) { return a - b; });
      var leftTerms = leftSorted.map(function (i) { return eq.left[i]; });
      out.left = Expr.simplifyNodes(eq.left, leftIndices);
      opLeft = { type: 'simplify', terms: leftTerms };
    }
    if (rightIndices && rightIndices.length >= 2) {
      var rightSorted = rightIndices.slice().sort(function (a, b) { return a - b; });
      var rightTerms = rightSorted.map(function (i) { return eq.right[i]; });
      out.right = Expr.simplifyNodes(eq.right, rightIndices);
      opRight = { type: 'simplify', terms: rightTerms };
    }
    return { equation: out, opLeft: opLeft, opRight: opRight };
  }

  function applyExpand(eq, side, groupIndex, innerIndices) {
    var out = cloneEquation(eq);
    out[side] = Expr.expandFactorGroup(eq[side], groupIndex, innerIndices);
    return out;
  }

  // Développe un ProductGroup "(a+b)(c+d)" entier (double distributivité) : toujours
  // complet, pas de développement partiel terme à terme comme pour un FactorGroup.
  function applyExpandProduct(eq, side, groupIndex) {
    var out = cloneEquation(eq);
    var node = eq[side][groupIndex];
    var terms = Expr.expandProductGroup(node);
    var newSide = [];
    eq[side].forEach(function (n, i) {
      if (i === groupIndex) terms.forEach(function (t) { newSide.push(t); });
      else newSide.push(Expr.cloneNode(n));
    });
    out[side] = newSide;
    return out;
  }

  // Développe seulement un SOUS-ENSEMBLE des facteurs d'un ProductGroup entre eux (au moins
  // 2, ou un seul si celui-ci a lui-même un exposant>1), les autres restant intacts (voir
  // Expr.expandProductFactorSubset et toggleFactorSelection dans history.js pour la
  // sélection UI correspondante) : remplace le noeud par le nouveau ProductGroup résultant,
  // ou par des Term bruts si le sous-ensemble couvrait TOUS les facteurs (équivalent à un
  // développement complet).
  function applyExpandProductFactorSubset(eq, side, groupIndex, branchIndices) {
    var out = cloneEquation(eq);
    var node = eq[side][groupIndex];
    var result = Expr.expandProductFactorSubset(node, branchIndices);
    var newSide = [];
    eq[side].forEach(function (n, i) {
      if (i === groupIndex) {
        if (result.full) result.terms.forEach(function (t) { newSide.push(t); });
        else newSide.push(result.node);
      } else {
        newSide.push(Expr.cloneNode(n));
      }
    });
    out[side] = newSide;
    return out;
  }

  // Résolu si un membre est exactement "x" (coeff 1) et l'autre une constante.
  function isPureX(side) {
    return Expr.sideIsSingleTerm(side) && side[0].pow === 1 && Expr.roundClean(side[0].coeff) === 1;
  }
  function isConstantSide(side) {
    return Expr.sideIsSingleTerm(side) && side[0].pow === 0;
  }
  function isSolved(eq) {
    return (isPureX(eq.left) && isConstantSide(eq.right)) || (isPureX(eq.right) && isConstantSide(eq.left));
  }

  // La constante de l'autre côté d'une équation `isSolved` (ex. "x=-3" ou "-3=x" -> -3) —
  // utilisé pour la combinaison "Df=..." d'une colonne "Condition d'existence" (voir
  // renderDomainSplit dans render.js, App.Equation restant lui-même opérateur-agnostique).
  // null si `eq` n'est pas (encore) sous cette forme.
  function solvedValue(eq) {
    if (isPureX(eq.left) && isConstantSide(eq.right)) return Expr.roundClean(eq.right[0].coeff);
    if (isPureX(eq.right) && isConstantSide(eq.left)) return Expr.roundClean(eq.left[0].coeff);
    return null;
  }

  App.Equation = {
    cloneEquation: cloneEquation,
    applyOpSequence: applyOpSequence,
    applySimplify: applySimplify,
    applySimplifyBoth: applySimplifyBoth,
    applyExpand: applyExpand,
    applyExpandProduct: applyExpandProduct,
    applyExpandProductFactorSubset: applyExpandProductFactorSubset,
    isSolved: isSolved,
    isConstantSide: isConstantSide,
    solvedValue: solvedValue
  };
})(window.App = window.App || {});
