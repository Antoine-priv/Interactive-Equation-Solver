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
     sur la branche correspondante ;
   - "(ax+b)/d = ..." : une fraction (numérique) à un membre, l'autre membre restant une
     expression normale — se résout en multipliant les deux membres par "d" (le membre
     fraction s'annule proprement, voir le cas d'annulation ajouté à
     Expr.wrapSideInFactor ; l'autre membre, s'il a plusieurs termes, se retrouve
     "d(...)"  à Développer) ;
   - "identités de identités" : deux formes combinant DEUX identités remarquables en une
     seule équation, dont ni l'une ni l'autre n'est directement l'équation finale :
     - "a²x²-c² + (px+q)(rx+s) = 0" : une différence de carrés NON factorisée additionnée
       à un produit de deux sommes NON développé — Développer le produit, Simplifier avec
       la partie identité, PUIS Factoriser (identité 1, 2 ou 3 selon le tirage) révèle la
       vraie identité cachée, enfin Produit nul (voir generateIdentityPlusProduct pour la
       construction à l'envers qui garantit que la recombinaison retombe pile sur une
       identité valide) ;
     - "x²±2bx+b² - (mx+n)² = 0" : un trinôme identité NON factorisé duquel on retranche un
       carré d'expression déjà factorisé — Factoriser le trinôme (identité 1 ou 2) donne
       deux carrés de signes opposés, exactement l'entrée attendue par
       Expr.factorDifferenceOfTwoSquareGroups (3e identité, voir generateDiffOfTwoSquaredExpr
       pour la variante où les deux carrés sont déjà groupés dès le départ). */
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

  // "(ax+b)/d = cx+e" (ou "= k", un simple nombre) : une fraction numérique à un membre.
  // Se résout en tapant "×d" (l'Opération unique) : le membre fraction s'annule proprement
  // (voir le cas ajouté à Expr.wrapSideInFactor, symétrique à l'annulation déjà en place
  // pour "÷(expression)" dans wrapSideInQuotient) ; l'autre membre, s'il a plusieurs
  // termes, devient "d(cx+e)" à Développer avant de continuer comme une équation linéaire
  // normale.
  function generateFractionEquation() {
    var d = nonZeroInt(2, 6);
    var a = nonZeroInt(-9, 9);
    var b = randInt(-20, 20);
    var innerTerms = [{ coeff: a, pow: 1 }];
    if (b !== 0) innerTerms.push({ coeff: b, pow: 0 });
    var left = [{ sign: 1, factor: { coeff: d, pow: 0 }, innerTerms: innerTerms, isDivision: true }];

    var right;
    if (Math.random() < 0.4) {
      right = [{ coeff: nonZeroInt(-20, 20), pow: 0 }];
    } else {
      var c = nonZeroInt(-9, 9);
      var e = randInt(-20, 20);
      right = [{ coeff: c, pow: 1 }];
      if (e !== 0) right.push({ coeff: e, pow: 0 });
    }
    return { left: left, right: right };
  }

  // "a²x²-c² + (px+q)(rx+s) = 0" : une différence de carrés NON factorisée (ex. "9x²-4")
  // additionnée à un produit de deux sommes NON développé (ex. "(3-2x)(3x-2)") — ni l'une
  // ni l'autre n'est l'équation finale : Développer le produit puis Simplifier avec la
  // partie identité fait réapparaître une identité DIFFÉRENTE (cachée), que Factoriser
  // (identité 1, 2 ou 3) puis Produit nul terminent normalement.
  //
  // Construction à l'envers depuis l'identité cible (k, b, type) plutôt que tirée au
  // hasard puis vérifiée : "p" et "r" (coefficients en x du produit) valent (k-a) et
  // (k+a), ce qui garantit — quels que soient "q"/"s" — que le terme en x² retombe
  // exactement sur k² une fois recombiné avec a² (car a²+(k-a)(k+a) = k² toujours). Il
  // reste alors à tirer "q"/"s" au hasard et ne garder que les tirages dont le terme en x
  // et la constante retombent EXACTEMENT sur l'identité choisie (sinon nouvel essai) ; un
  // secours déterministe (toujours valide, dérivé du même principe avec a=1) sert de filet
  // si aucun tirage ne convient après 500 essais (n'arrive jamais en pratique).
  function generateIdentityPlusProduct() {
    for (var attempt = 0; attempt < 500; attempt++) {
      var a = nonZeroInt(1, 5);
      var k = nonZeroInt(2, 6);
      if (k === a) continue;
      var p = k - a, r = k + a;
      var q = nonZeroInt(-9, 9);
      var s = nonZeroInt(-9, 9);
      var bx1 = p * s + q * r;
      var bx0 = q * s;
      var sol = null;

      if (bx1 !== 0 && bx1 % (2 * k) === 0) {
        var b1 = bx1 / (2 * k);
        var c2a = bx0 - b1 * b1;
        var c1 = Math.round(Math.sqrt(c2a));
        if (b1 !== 0 && c2a > 0 && c1 * c1 === c2a) sol = { c: c1 };
      }
      if (!sol && bx1 !== 0 && bx1 % (2 * k) === 0) {
        var b2 = -bx1 / (2 * k);
        var c2b = bx0 - b2 * b2;
        var c2v = Math.round(Math.sqrt(c2b));
        if (b2 !== 0 && c2b > 0 && c2v * c2v === c2b) sol = { c: c2v };
      }
      if (!sol && bx1 === 0) {
        for (var bTry = 1; bTry <= 9 && !sol; bTry++) {
          var c2c = bx0 + bTry * bTry;
          var c3v = Math.round(Math.sqrt(c2c));
          if (c2c > 0 && c3v * c3v === c2c) sol = { c: c3v };
        }
      }

      if (sol) {
        return {
          left: [
            { coeff: a * a, pow: 2 }, { coeff: -(sol.c * sol.c), pow: 0 },
            {
              sign: 1, factors: [
                { terms: [{ coeff: p, pow: 1 }, { coeff: q, pow: 0 }], exponent: 1 },
                { terms: [{ coeff: r, pow: 1 }, { coeff: s, pow: 0 }], exponent: 1 }
              ]
            }
          ],
          right: [{ coeff: 0, pow: 0 }]
        };
      }
    }

    // Secours déterministe (a=1, p=k-1, r=k+1, q=p, s=-r) : le produit est lui-même une
    // différence de carrés qui, combinée à "x²-1", retombe toujours exactement sur
    // "k²x²-k²" (identité 3, b=k) — voir le commentaire ci-dessus.
    var kFallback = nonZeroInt(2, 6);
    var pFallback = kFallback - 1, rFallback = kFallback + 1;
    return {
      left: [
        { coeff: 1, pow: 2 }, { coeff: -1, pow: 0 },
        {
          sign: 1, factors: [
            { terms: [{ coeff: pFallback, pow: 1 }, { coeff: pFallback, pow: 0 }], exponent: 1 },
            { terms: [{ coeff: rFallback, pow: 1 }, { coeff: -rFallback, pow: 0 }], exponent: 1 }
          ]
        }
      ],
      right: [{ coeff: 0, pow: 0 }]
    };
  }

  // "x²±2bx+b² - (mx+n)² = 0" : un trinôme identité NON factorisé (même construction que
  // generateFactorableQuadratic, patterns 1/2 uniquement) duquel on retranche un carré
  // d'expression déjà factorisé (parfois non monic, ex. "(2x-3)²"). Se résout en
  // Factoriser le trinôme (identité 1 ou 2) d'abord — il devient un carré de signe +,
  // exactement l'entrée attendue par Expr.factorDifferenceOfTwoSquareGroups aux côtés du
  // carré de signe - déjà présent (3e identité, comme generateDiffOfTwoSquaredExpr).
  function generateTrinomialMinusSquareGroup() {
    var b = nonZeroInt(1, 9);
    var trinomial = Math.random() < 0.5
      ? [{ coeff: 1, pow: 2 }, { coeff: 2 * b, pow: 1 }, { coeff: b * b, pow: 0 }]
      : [{ coeff: 1, pow: 2 }, { coeff: -2 * b, pow: 1 }, { coeff: b * b, pow: 0 }];
    var m = nonZeroInt(1, 4);
    var n = nonZeroInt(-9, 9);
    var squareTerm = { sign: -1, factors: [{ terms: [{ coeff: m, pow: 1 }, { coeff: n, pow: 0 }], exponent: 2 }] };
    return { left: trinomial.concat([squareTerm]), right: [{ coeff: 0, pow: 0 }] };
  }

  function generateEquation() {
    var roll = Math.random();
    if (roll < 0.15) return generateLinearEquation();
    if (roll < 0.26) return generateSimplifyFirstLinear();
    if (roll < 0.37) return generateFactorableQuadratic();
    if (roll < 0.48) return generateSquareRootEquation();
    if (roll < 0.56) return generateProductEquation();
    if (roll < 0.62) return generateGroupedCommonFactor();
    if (roll < 0.66) return generateSquareMinusConstant();
    if (roll < 0.70) return generateDiffOfTwoSquaredExpr();
    if (roll < 0.74) return generateTripleProductEquation();
    if (roll < 0.80) return generateUnfactoredQuadraticProduct();
    if (roll < 0.84) return generateSquaredLinearTimesLinear();
    if (roll < 0.90) return generateFractionEquation();
    if (roll < 0.95) return generateIdentityPlusProduct();
    return generateTrinomialMinusSquareGroup();
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
    generateDiffOfTwoSquaredExpr: generateDiffOfTwoSquaredExpr,
    generateFractionEquation: generateFractionEquation,
    generateIdentityPlusProduct: generateIdentityPlusProduct,
    generateTrinomialMinusSquareGroup: generateTrinomialMinusSquareGroup
  };
})(window.App = window.App || {});
