/* Génère une équation aléatoire, toujours construite à partir de racines/valeurs connues
   pour garantir qu'elle se résout proprement avec les outils de l'appli. Formes possibles :
   - linéaire déjà simplifiée (ax+b=cx+d), ou pas encore (ex. "3x+5-2x=4x-1"), pour
     pratiquer "Simplifier" avant de résoudre comme d'habitude ;
   - un trinôme degré 2 à factoriser (identité remarquable) puis résoudre (produit nul) ;
   - un produit de deux sommes à développer (double distributivité) ;
   - "(x+a)²=k²" ou "x²=k²" à résoudre directement par racine carrée ;
   - "p(mx+n)±q(rx+s)=0" où p et q partagent un facteur commun, à factoriser (voir
     Expr.factorAlreadyGroupedNodes) ;
   - "(x+a)²-k²=0" (un carré moins une simple constante, voir
     Expr.factorDifferenceOfSquaresFromGroup) ou "(x+a)²-(x+b)²=0" (deux carrés
     d'expressions, voir Expr.factorDifferenceOfTwoSquareGroups), tous deux résolus via la
     3e identité remarquable avec un "a" (et, pour le second, un "b") à taper ;
   - un produit de TROIS facteurs linéaires distincts (Produit nul généralisé à N facteurs) ;
   - un trinôme/binôme degré 2 NON factorisé multiplié par un facteur linéaire, ou un
     facteur linéaire déjà au carré multiplié par un second facteur linéaire : le produit
     entier dépasse le degré 2, mais chaque facteur individuel reste de degré <=2 — se
     résout en deux temps via "Produit nul" puis (pour le trinôme) une identité remarquable
     sur la branche correspondante. */
(function (App) {
  'use strict';

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function nonZeroInt(min, max) {
    var v;
    do { v = randInt(min, max); } while (v === 0);
    return v;
  }

  // Sépare `total` en deux entiers non nuls qui le somment (ex. total=5 -> [3,2]) : sert à
  // "dé-simplifier" un coefficient déjà combiné en deux termes de même degré, pour
  // pratiquer "Simplifier" avant de résoudre.
  function splitInto2(total) {
    var p1;
    do { p1 = nonZeroInt(-9, 9); } while (p1 === total);
    return [p1, total - p1];
  }

  function generateLinearEquation() {
    var a = nonZeroInt(-9, 9);
    var c;
    do { c = nonZeroInt(-9, 9); } while (c === a);
    var b = randInt(-20, 20);
    var d = randInt(-20, 20);

    var left = [{ coeff: a, pow: 1 }];
    if (b !== 0) left.push({ coeff: b, pow: 0 });

    var right = [{ coeff: c, pow: 1 }];
    if (d !== 0) right.push({ coeff: d, pow: 0 });

    return { left: left, right: right };
  }

  // Même équation que generateLinearEquation, mais avec le coefficient de x d'UN membre
  // (et, une fois sur deux, des deux) éclaté en deux termes de même degré séparés par la
  // constante — ex. "3x+5=4x-1" devient "5x+5-2x=4x-1" — pour que la résoudre passe
  // d'abord par "Simplifier".
  function generateSimplifyFirstLinear() {
    var base = generateLinearEquation();

    var leftParts = splitInto2(base.left[0].coeff);
    var left = [{ coeff: leftParts[0], pow: 1 }];
    if (base.left.length > 1) left.push({ coeff: base.left[1].coeff, pow: 0 });
    left.push({ coeff: leftParts[1], pow: 1 });

    var right;
    if (Math.random() < 0.5) {
      var rightParts = splitInto2(base.right[0].coeff);
      right = [{ coeff: rightParts[0], pow: 1 }];
      if (base.right.length > 1) right.push({ coeff: base.right[1].coeff, pow: 0 });
      right.push({ coeff: rightParts[1], pow: 1 });
    } else {
      right = base.right.map(function (t) { return { coeff: t.coeff, pow: t.pow }; });
    }

    return { left: left, right: right };
  }

  // Trinôme degré 2 = 0, construit depuis un "b" connu pour toujours correspondre à
  // l'une des 3 identités remarquables : x²+2bx+b², x²-2bx+b², ou x²-b² (facteur
  // "x²-b²" du modèle Term/ProductGroup, voir expression.js).
  function generateFactorableQuadratic() {
    var b = nonZeroInt(1, 9);
    var pattern = randInt(0, 2);
    var left;
    if (pattern === 0) {
      left = [{ coeff: 1, pow: 2 }, { coeff: 2 * b, pow: 1 }, { coeff: b * b, pow: 0 }];
    } else if (pattern === 1) {
      left = [{ coeff: 1, pow: 2 }, { coeff: -2 * b, pow: 1 }, { coeff: b * b, pow: 0 }];
    } else {
      left = [{ coeff: 1, pow: 2 }, { coeff: -(b * b), pow: 0 }];
    }
    return { left: left, right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x+a)(x+b) = 0" : produit de deux sommes à développer (double distributivité).
  // a===b : un seul facteur d'exposant 2 plutôt que deux facteurs identiques (voir
  // canonicalizeFactors dans expression.js, même règle que la saisie manuelle).
  function generateProductEquation() {
    var a = nonZeroInt(-9, 9);
    var b = nonZeroInt(-9, 9);
    var factors = a === b
      ? [{ terms: [{ coeff: 1, pow: 1 }, { coeff: a, pow: 0 }], exponent: 2 }]
      : [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: a, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: b, pow: 0 }], exponent: 1 }
      ];
    return { left: [{ sign: 1, factors: factors }], right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x+a)(x+b)(x+c) = 0", a/b/c distincts : produit de TROIS facteurs, uniquement
  // résoluble via "Produit nul" (le développer dépasserait le degré maximal x², voir
  // expandProductGroup) — pratique la généralisation à N facteurs de cette fonctionnalité.
  function generateTripleProductEquation() {
    var a = nonZeroInt(-9, 9);
    var b, c;
    do { b = nonZeroInt(-9, 9); } while (b === a);
    do { c = nonZeroInt(-9, 9); } while (c === a || c === b);
    var factors = [a, b, c].map(function (r) {
      return { terms: [{ coeff: 1, pow: 1 }, { coeff: r, pow: 0 }], exponent: 1 };
    });
    return { left: [{ sign: 1, factors: factors }], right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x²±2bx+b²)(x+a)=0" ou "(x²-b²)(x+a)=0" : un trinôme/binôme degré 2 NON factorisé
  // (même construction que generateFactorableQuadratic) multiplié par un facteur linéaire.
  // Le produit entier dépasse le degré 2, mais chaque FACTEUR individuel reste de degré <=2
  // (voir CLAUDE.md — Term.pow n'est plus plafonné, mais ceci n'en a même pas besoin) :
  // se résout en deux temps, "Produit nul" (déjà N-aire) sépare le trinôme — à factoriser
  // ensuite via une identité remarquable, exactement comme un trinôme isolé — du facteur
  // linéaire, trivial.
  function generateUnfactoredQuadraticProduct() {
    var b = nonZeroInt(1, 9);
    var pattern = randInt(0, 2);
    var quadTerms;
    if (pattern === 0) {
      quadTerms = [{ coeff: 1, pow: 2 }, { coeff: 2 * b, pow: 1 }, { coeff: b * b, pow: 0 }];
    } else if (pattern === 1) {
      quadTerms = [{ coeff: 1, pow: 2 }, { coeff: -2 * b, pow: 1 }, { coeff: b * b, pow: 0 }];
    } else {
      quadTerms = [{ coeff: 1, pow: 2 }, { coeff: -(b * b), pow: 0 }];
    }
    var a = nonZeroInt(-9, 9);
    var factors = [
      { terms: quadTerms, exponent: 1 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: a, pow: 0 }], exponent: 1 }
    ];
    return { left: [{ sign: 1, factors: factors }], right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x+a)²(x+b)=0", a≠b : un facteur linéaire déjà au carré multiplié par un second
  // facteur linéaire — degré 3 dans l'ensemble, résolu directement par "Produit nul" (qui
  // ignore l'exposant, voir flattenProductFactors) : chaque facteur restant trivial.
  function generateSquaredLinearTimesLinear() {
    var a = nonZeroInt(-9, 9);
    var b;
    do { b = nonZeroInt(-9, 9); } while (b === a);
    var factors = [
      { terms: [{ coeff: 1, pow: 1 }, { coeff: a, pow: 0 }], exponent: 2 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: b, pow: 0 }], exponent: 1 }
    ];
    return { left: [{ sign: 1, factors: factors }], right: [{ coeff: 0, pow: 0 }] };
  }

  function squareGroup(a, sign) {
    return { sign: sign, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: a, pow: 0 }], exponent: 2 }] };
  }

  // "(x+a)²=k²" (ou, plus rarement, "x²=k²" nu) : se résout directement par "Racine
  // carrée", sans factoriser au préalable. k=0 est volontairement permis (racine
  // double, une seule branche) — voir confirmSquareRoot/pushStep dans history.js.
  function generateSquareRootEquation() {
    var k = randInt(0, 12);
    if (Math.random() < 0.3) {
      return { left: [{ coeff: 1, pow: 2 }], right: [{ coeff: k * k, pow: 0 }] };
    }
    var a = nonZeroInt(-9, 9);
    return { left: [squareGroup(a, 1)], right: [{ coeff: k * k, pow: 0 }] };
  }

  // "p(mx+n)±q(rx+s)=0" où p et q partagent un facteur commun g : se factorise par g,
  // voir Expr.factorAlreadyGroupedNodes (étend "Factoriser" aux termes déjà groupés).
  function generateGroupedCommonFactor() {
    var g = randInt(2, 6);
    var p = g * nonZeroInt(-4, 4);
    var q = g * nonZeroInt(-4, 4);
    var node1 = {
      sign: p < 0 ? -1 : 1,
      factor: { coeff: Math.abs(p), pow: 0 },
      innerTerms: [{ coeff: nonZeroInt(-9, 9), pow: 1 }, { coeff: nonZeroInt(-9, 9), pow: 0 }]
    };
    var node2 = {
      sign: q < 0 ? -1 : 1,
      factor: { coeff: Math.abs(q), pow: 0 },
      innerTerms: [{ coeff: nonZeroInt(-9, 9), pow: 1 }, { coeff: nonZeroInt(-9, 9), pow: 0 }]
    };
    return { left: [node1, node2], right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x+a)²-k²=0" : un carré déjà factorisé moins une simple constante, voir
  // Expr.factorDifferenceOfSquaresFromGroup — l'élève tape "a" (l'expression) et "b"
  // (=k) pour appliquer la 3e identité remarquable a²-b²=(a-b)(a+b).
  function generateSquareMinusConstant() {
    var a = nonZeroInt(-9, 9);
    var k = nonZeroInt(1, 9);
    return { left: [squareGroup(a, 1), { coeff: -(k * k), pow: 0 }], right: [{ coeff: 0, pow: 0 }] };
  }

  // "(x+a)²-(x+b)²=0", a≠b : deux carrés d'expressions déjà factorisées, voir
  // Expr.factorDifferenceOfTwoSquareGroups — "a" ET "b" sont chacun à taper.
  function generateDiffOfTwoSquaredExpr() {
    var a = nonZeroInt(-9, 9);
    var b;
    do { b = nonZeroInt(-9, 9); } while (b === a);
    return { left: [squareGroup(a, 1), squareGroup(b, -1)], right: [{ coeff: 0, pow: 0 }] };
  }

  function generateEquation() {
    var roll = Math.random();
    if (roll < 0.18) return generateLinearEquation();
    if (roll < 0.31) return generateSimplifyFirstLinear();
    if (roll < 0.44) return generateFactorableQuadratic();
    if (roll < 0.57) return generateSquareRootEquation();
    if (roll < 0.66) return generateProductEquation();
    if (roll < 0.73) return generateGroupedCommonFactor();
    if (roll < 0.78) return generateSquareMinusConstant();
    if (roll < 0.83) return generateDiffOfTwoSquaredExpr();
    if (roll < 0.88) return generateTripleProductEquation();
    if (roll < 0.95) return generateUnfactoredQuadraticProduct();
    return generateSquaredLinearTimesLinear();
  }

  App.Generator = {
    generateEquation: generateEquation,
    generateLinearEquation: generateLinearEquation,
    generateSimplifyFirstLinear: generateSimplifyFirstLinear,
    generateFactorableQuadratic: generateFactorableQuadratic,
    generateProductEquation: generateProductEquation,
    generateTripleProductEquation: generateTripleProductEquation,
    generateUnfactoredQuadraticProduct: generateUnfactoredQuadraticProduct,
    generateSquaredLinearTimesLinear: generateSquaredLinearTimesLinear,
    generateSquareRootEquation: generateSquareRootEquation,
    generateGroupedCommonFactor: generateGroupedCommonFactor,
    generateSquareMinusConstant: generateSquareMinusConstant,
    generateDiffOfTwoSquaredExpr: generateDiffOfTwoSquaredExpr
  };
})(window.App = window.App || {});
