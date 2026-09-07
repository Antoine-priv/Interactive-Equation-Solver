/* Modèle des expressions (membres d'équation) : Term, FactorGroup, ProductGroup, Side.
   Term        = { coeff: number, pow: number>=0 }  (pow : 0 = constante, 1 = x, 2 = x²,
                   3 = x³, ... — AUCUN plafond : un terme de degré quelconque est un Term
                   valide, ex. via "+x^5"/"×x^7" ou en développant un produit de plusieurs
                   facteurs de degré 2. Seules les 3 identités remarquables et "Racine
                   carrée" restent volontairement spécifiques au degré 2 (elles cherchent un
                   motif EXACT x²/x/constante et ne "voient" simplement pas une sélection
                   d'un autre degré, voir factorRemarkableIdentityChoice/detectSquareRoot
                   dans history.js) — ce ne sont pas des limites du modèle de données.
   FactorGroup = { sign: 1|-1, factor: { coeff:number, pow:0|1|2 }, innerTerms: Node[],
                   isDivision?: boolean, factorTerms?: Node[] }
   isDivision distingue "k(...)"  (multiplication, défaut) de "(...)/k" (division, affichée
   en fraction) : même structure, juste un mode de rendu et de calcul différent. `factor`
   reste un simple nombre (pow 0) en pratique — c'est le facteur commun/diviseur, jamais un
   terme en x — SAUF quand `isDivision` ET `factorTerms` sont tous deux présents : le
   dénominateur est alors une expression quelconque (ex. "(...)/(x+5)", voir
   wrapSideInQuotient et isExpressionQuotient), `factorTerms` remplaçant entièrement
   `factor` (les deux sont mutuellement exclusifs, jamais renseignés ensemble). Ce cas ne
   peut être produit QUE par l'opération "÷" du pavé "Opération" sur un opérande qui n'est
   pas un simple nombre — jamais par la saisie manuelle d'une équation (voir parser.js, dont
   \frac{a}{b} exige toujours un `b` numérique).
   ProductGroup = { sign: 1|-1, factors: Array<{ terms: Node[], exponent: number }> }
   Représente le produit de N facteurs, ex. "(x+2)(x+3)" = 2 facteurs d'exposant 1 chacun,
   "(x+3)²" = UN SEUL facteur d'exposant 2 (pas deux facteurs identiques dupliqués — un
   facteur répété n'existe jamais qu'en une seule copie, `exponent` porte la répétition),
   "5(8-6x+4)(5x+2)²" = 3 facteurs (un simple nombre, exposant 1 chacun pour les deux
   premiers, 2 pour le dernier). Invariant : factors.length>=2, OU factors.length===1 avec
   exponent>=2 (un carré/cube/... isolé, rien d'autre multiplié). Ni `exponent` ni le degré
   des termes bruts (Term.pow, voir ci-dessus) ne sont plafonnés : "(x+2)(x+3)(x+4)" se
   développe normalement en x³+..., voir expandProductGroup.
   Node = Term | FactorGroup | ProductGroup (un groupe peut contenir un autre groupe
   imbriqué, ex. "2(-9x+3(-2))" produit par une multiplication qui enveloppe tout un membre)
   Side (membre d'une équation) = Array<Node>
*/
(function (App) {
  'use strict';

  function isFactorGroup(node) {
    return node && Object.prototype.hasOwnProperty.call(node, 'innerTerms');
  }

  function isProductGroup(node) {
    return node && Object.prototype.hasOwnProperty.call(node, 'factors');
  }

  // Un ProductGroup "carré isolé" ("(...)²", rien d'autre multiplié) : remplace l'ancien
  // booléen isSquare — voir le commentaire de modèle de données en tête de fichier.
  function isSquareFactorGroup(node) {
    return isProductGroup(node) && node.factors.length === 1 && node.factors[0].exponent === 2;
  }

  // Un noeud "groupe" (par opposition à un Term plat) : ni simplifiable, ni factorisable
  // directement, il faut d'abord le développer.
  function isGroup(node) {
    return isFactorGroup(node) || isProductGroup(node);
  }

  // Une division par une EXPRESSION (ex. "(...)/(x+5)", voir wrapSideInQuotient), pas par
  // un simple nombre : `factor` (un Term) est alors absent, remplacé par `factorTerms` (un
  // Side). Utilisé pour EXCLURE ce cas des chemins qui supposent `factor` numérique
  // (expandFactorGroup/expandOneInner, "Développer" un groupe entier) — la division ne se
  // distribue pas sur ce genre de dénominateur, voir le commentaire de modèle de données en
  // tête de fichier.
  function isExpressionQuotient(node) {
    return isFactorGroup(node) && !!node.isDivision && !!node.factorTerms;
  }

  // Un membre dépend-il de x (au moins un terme de degré >= 1, à n'importe quelle
  // profondeur) ? Utilisé pour savoir si multiplier les deux membres par CE membre-là
  // (ex. "×(x+5)", voir wrapSideInProduct) peut introduire une valeur qui l'annule — un
  // multiplicateur purement numérique n'a pas ce problème.
  function nodeHasVariable(node) {
    if (isFactorGroup(node)) {
      return (node.factor && node.factor.pow !== 0) || sideHasVariable(node.innerTerms);
    }
    if (isProductGroup(node)) {
      return node.factors.some(function (f) { return sideHasVariable(f.terms); });
    }
    return node.pow !== 0;
  }
  function sideHasVariable(side) {
    return side.some(nodeHasVariable);
  }

  function nodeSign(node) {
    if (isGroup(node)) return node.sign;
    return node.coeff < 0 ? -1 : 1;
  }

  function cloneTerm(t) {
    return { coeff: t.coeff, pow: t.pow };
  }

  function cloneFactor(f) {
    return { terms: f.terms.map(cloneNode), exponent: f.exponent };
  }

  function cloneNode(node) {
    if (isProductGroup(node)) {
      return { sign: node.sign, factors: node.factors.map(cloneFactor) };
    }
    if (isFactorGroup(node)) {
      // Ordre des clés préservé (sign, factor[Terms], innerTerms, isDivision) : plusieurs
      // tests comparent des équations via JSON.stringify(...) === JSON.stringify(...),
      // sensible à l'ordre d'insertion des propriétés.
      var cloned = { sign: node.sign };
      if (node.factorTerms) cloned.factorTerms = node.factorTerms.map(cloneNode);
      else cloned.factor = cloneTerm(node.factor);
      cloned.innerTerms = node.innerTerms.map(cloneNode);
      if (node.isDivision) cloned.isDivision = true;
      return cloned;
    }
    return cloneTerm(node);
  }

  function cloneSide(side) {
    return side.map(cloneNode);
  }

  // Arrondit pour éviter les artefacts de flottants (0.1+0.2 etc.)
  function roundClean(n) {
    return Math.round(n * 1e6) / 1e6;
  }

  // Nombre minimal de décimales (0 à 6) nécessaires pour représenter `n` exactement.
  // `n` est déjà arrondi à 6 décimales par roundClean, qui sert de référence "vraie"
  // valeur ; si aucune précision ≤6 ne reproduit `n` avant ce plafond, c'est qu'elle a
  // (en pratique, pour ce plafond) un nombre infini de décimales, ex. 10÷3 = 3,333...
  function decimalsNeeded(n) {
    for (var d = 0; d <= 6; d++) {
      var scale = Math.pow(10, d);
      if (Math.abs(Math.round(n * scale) / scale - n) < 1e-9) return d;
    }
    return 6;
  }

  // Valeur à afficher : les décimales finies (ex. 4,5 ou 0,25) s'affichent exactement ;
  // celles qui nécessitent un nombre infini de décimales (ex. 10÷3) sont arrondies au
  // centième pour rester lisibles. Le calcul interne, lui, garde la précision complète
  // de roundClean (seul l'affichage est simplifié).
  function displayRound(n) {
    var full = roundClean(n);
    if (decimalsNeeded(full) >= 6) return Math.round(full * 100) / 100;
    return full;
  }

  // Formatte un nombre positif en LaTeX avec virgule française.
  function formatNumberLatex(n) {
    var v = displayRound(Math.abs(n));
    var s = v.toString();
    return s.replace('.', '{,}');
  }

  // Formatte un nombre positif en texte brut (pour les étiquettes d'opération, hors LaTeX).
  function formatNumberPlain(n) {
    var v = displayRound(Math.abs(n));
    return v.toString().replace('.', ',');
  }

  // Suffixe de puissance en texte brut (saisie manuelle / génération aléatoire) : "x^N"
  // en notation "chapeau" ASCII, reconnue par le parseur (voir parser.js). `pow` n'est pas
  // plafonné (voir modèle de données en tête de fichier) : dérivé directement plutôt qu'une
  // table figée à 0/1/2.
  function powPlainSuffix(pow) {
    return pow === 1 ? 'x' : 'x^' + pow;
  }
  function powLatexSuffix(pow) {
    // Accolades seulement pour un exposant à plusieurs chiffres (LaTeX n'en a besoin que
    // là) — "x^2" reste "x^2" nu, comme avant, pas "x^{2}" (rendu identique, mais change
    // le texte LaTeX littéral que d'autres endroits comparent, ex. l'étiquette de flèche).
    if (pow === 1) return 'x';
    return pow < 10 ? 'x^' + pow : 'x^{' + pow + '}';
  }

  // Texte brut d'un terme signé, ex {coeff:-6,pow:1} -> "-6x", {coeff:1,pow:1} -> "x",
  // {coeff:1,pow:2} -> "x^2", {coeff:3,pow:2} -> "3x^2".
  function formatOperandPlain(term) {
    var sign = term.coeff < 0 ? '-' : '';
    var abs = Math.abs(term.coeff);
    if (term.pow > 0) {
      return sign + (roundClean(abs) === 1 ? powPlainSuffix(term.pow) : formatNumberPlain(abs) + powPlainSuffix(term.pow));
    }
    return sign + formatNumberPlain(abs);
  }

  function termLatexBody(term) {
    var abs = Math.abs(term.coeff);
    if (term.pow > 0 && roundClean(abs) !== 0) {
      if (roundClean(abs) === 1) return powLatexSuffix(term.pow);
      return formatNumberLatex(abs) + powLatexSuffix(term.pow);
    }
    return formatNumberLatex(abs);
  }

  // Latex des noeuds à l'intérieur d'un groupe (Term ou FactorGroup/ProductGroup imbriqué) :
  // délègue à nodeLatex, qui gère déjà correctement le signe et la récursion sur les groupes.
  function innerTermsLatex(terms) {
    return terms.map(function (n, i) { return nodeLatex(n, i === 0); }).join('');
  }

  // Rend UN facteur (left ou right) d'un ProductGroup. Cas normal : une SOMME de PLUSIEURS
  // termes, enveloppée dans sa propre paire de parenthèses (nécessaire pour lever
  // l'ambiguïté). Cas particulier : ce facteur n'a qu'un seul élément — un terme simple
  // (ex. multiplier un membre par "x", voir wrapSideInProduct) ou un groupe déjà
  // auto-parenthésé (ex. multiplier un membre déjà factorisé "(a+b)(a-b)" par un terme) —
  // un élément seul n'a besoin d'aucune parenthèse supplémentaire pour être compris : on le
  // rend directement, SAUF s'il commence par un "-" (un signe collé juste après une
  // parenthèse fermante serait lu comme une SOUSTRACTION, ex. "(a+b)(a-b)-3" au lieu
  // d'une multiplication par -3 ; dans ce seul cas, on garde l'enveloppe pour la clarté).
  function groupSlotLatex(side) {
    if (side.length === 1) {
      var rendered = nodeLatex(side[0], true);
      if (rendered.charAt(0) !== '-') return rendered;
    }
    return '\\left(' + innerTermsLatex(side) + '\\right)';
  }

  // Latex d'un noeud (Term, FactorGroup ou ProductGroup), en incluant son signe.
  // isFirst = premier noeud du membre (pas d'espace avant, signe seulement si négatif).
  function nodeLatex(node, isFirst) {
    if (isProductGroup(node)) {
      var ALNUM_END_RE = /[0-9A-Za-z]$/;
      var bodyP = node.factors.reduce(function (acc, f) {
        var slot = groupSlotLatex(f.terms);
        var rendered = f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
        // Deux facteurs "nus" adjacents (sans parenthèse ni exposant les délimitant) se
        // liraient comme collés si le suivant commence par un chiffre : soit un seul nombre
        // ("1" puis "5" -> "15" au lieu de "1 fois 5"), soit une variable qui n'existe pas
        // ("x" puis "5" -> "x5"). Un "\cdot" explicite lève l'ambiguïté ; l'ordre inverse
        // (chiffre puis "x", ex. "5x") reste la notation habituelle d'un coefficient, pas
        // touché ici.
        if (acc !== '' && ALNUM_END_RE.test(acc) && /^[0-9]/.test(rendered)) return acc + '\\cdot ' + rendered;
        return acc + rendered;
      }, '');
      var signP = node.sign < 0 ? '-' : '+';
      if (isFirst) return (signP === '-' ? '-' : '') + bodyP;
      return ' ' + signP + ' ' + bodyP;
    }
    if (isFactorGroup(node)) {
      var body;
      if (node.isDivision) {
        // Dénominateur-EXPRESSION (factorTerms, voir isExpressionQuotient) : marqué
        // \htmlData{fracpart=den} pour que le clic qui y atterrit soit distingué de celui
        // dans le numérateur (voir drillIntoQuotientDenominator/onTermClick) — un
        // dénominateur numérique classique (`factor`) n'est, lui, jamais "entrable".
        var denomLatex = node.factorTerms
          ? '\\htmlData{fracpart=den}{' + innerTermsLatex(node.factorTerms) + '}'
          : termLatexBody(node.factor);
        body = '\\frac{' + innerTermsLatex(node.innerTerms) + '}{' + denomLatex + '}';
      } else {
        // factor === null : aperçu "en direct" avant saisie du facteur commun, comme si
        // c'était 1 (donc pas de chiffre affiché du tout devant la parenthèse).
        var factorBody = node.factor ? termLatexBody({ coeff: node.factor.coeff, pow: node.factor.pow }) : '';
        body = factorBody + '\\left(' + innerTermsLatex(node.innerTerms) + '\\right)';
      }
      var sign = node.sign < 0 ? '-' : '+';
      if (isFirst) return (sign === '-' ? '-' : '') + body;
      return ' ' + sign + ' ' + body;
    }
    var sign2 = node.coeff < 0 ? '-' : '+';
    var body2 = termLatexBody(node);
    if (isFirst) return (sign2 === '-' ? '-' : '') + body2;
    return ' ' + sign2 + ' ' + body2;
  }

  // Latex complet d'un membre (fallback, non utilisé pour le rendu term-par-term)
  function sideLatex(side) {
    return side.map(function (n, i) { return nodeLatex(n, i === 0); }).join('');
  }

  function operandLatex(term) {
    return nodeLatex(term, true);
  }

  // ---- Opérations sur un membre ----

  // `term` peut être un simple Term OU un noeud GROUPE (FactorGroup/ProductGroup) — ex.
  // "Opération" ajoutant un terme entre parenthèses tel quel ("+3-5(8x-2)", voir
  // classifyPlusMinusOperand dans history.js) plutôt que de le distribuer/combiner avec le
  // reste du membre. `cloneNode` (générique) gère déjà les deux cas ; `cloneTerm` seul
  // aurait silencieusement perdu un groupe (il n'a ni .coeff ni .pow).
  function addTermToSide(side, term) {
    var out = cloneSide(side);
    out.push(cloneNode(term));
    return out;
  }

  // Multiplie un noeud par `factor`. Un groupe de division combine ce facteur dans son
  // dénominateur (diviser par `factor` revient à multiplier ce dénominateur), pour que
  // le chaînage ×/÷ successif (ex. "÷2÷3" -> dénominateur 6) reste cohérent avec le
  // même mécanisme déjà utilisé pour combiner des "×2×3" successifs.
  function scaleNode(node, factor) {
    if (isProductGroup(node)) {
      // Un facteur numérique se distribue sur UN SEUL des N facteurs (peu importe lequel,
      // le résultat mathématique est identique) pour ne pas dupliquer le multiplicateur —
      // toujours le premier, et toujours en dehors de son exposant (multiplier par 3 puis
      // mettre au carré ne redonnerait pas 3× le carré) : on lui ajoute un facteur scalaire
      // exponent:1 séparé plutôt que de multiplier dans son terme existant, sauf s'il est
      // déjà seul et d'exposant 1 (cas le plus courant, pas de facteur superflu).
      var first = node.factors[0];
      var newFactors;
      if (first.exponent === 1) {
        newFactors = [{ terms: first.terms.map(function (n) { return scaleNode(n, factor); }), exponent: 1 }]
          .concat(node.factors.slice(1).map(cloneFactor));
      } else {
        newFactors = [{ terms: [{ coeff: factor, pow: 0 }], exponent: 1 }].concat(node.factors.map(cloneFactor));
      }
      return { sign: node.sign, factors: newFactors };
    }
    if (isFactorGroup(node)) {
      if (node.isDivision) {
        // Dénominateur-EXPRESSION (factorTerms, voir isExpressionQuotient) : pas de
        // `factor` numérique à diviser ici — un multiplicateur/diviseur numérique scale le
        // NUMÉRATEUR à la place (ex. "(N/(x+5))×3" = "(3N)/(x+5)", "(N/(x+5))÷2" =
        // "(N/2)/(x+5)" — voir wrapSideInFraction/wrapSideInFactor, qui délèguent tous deux
        // ici pour un membre à un seul noeud).
        if (node.factorTerms) {
          return {
            sign: node.sign,
            factorTerms: node.factorTerms.map(cloneNode),
            innerTerms: node.innerTerms.map(function (t) { return scaleNode(t, factor); }),
            isDivision: true
          };
        }
        return {
          sign: node.sign,
          factor: { coeff: roundClean(node.factor.coeff / factor), pow: node.factor.pow },
          innerTerms: node.innerTerms.map(cloneNode),
          isDivision: true
        };
      }
      return {
        sign: node.sign,
        factor: { coeff: node.factor.coeff * factor, pow: node.factor.pow },
        innerTerms: node.innerTerms.map(cloneNode)
      };
    }
    return { coeff: node.coeff * factor, pow: node.pow };
  }

  function multiplySide(side, factor) {
    return side.map(function (n) { return scaleNode(n, factor); });
  }

  // Multiplication "affichée" : si le membre a plusieurs termes, on enveloppe tout le
  // membre dans une parenthèse (ex. "2(-9x+3(-2))") plutôt que de distribuer le facteur
  // terme à terme. S'il n'y a déjà qu'un seul terme, pas d'enveloppe inutile (ex. "2(3)")
  // : on multiplie directement.
  function wrapSideInFactor(side, multiplier) {
    // Membre déjà un seul ProductGroup (ex. "(-4x+2+6x)x") : contrairement à scaleNode
    // (multiplication "silencieuse", déjà distribuée dans le premier facteur — utile
    // ailleurs, ex. simplification interne), une multiplication affichée doit rester une
    // étape visible et développable : le multiplicateur devient un nouveau facteur en
    // tête plutôt que d'être absorbé dans un facteur existant (ex. "5(-4x+2+6x)x", pas
    // directement "(-20x+10+30x)x").
    if (side.length === 1 && isProductGroup(side[0])) {
      var node = side[0];
      return [{
        sign: node.sign,
        factors: [{ terms: [{ coeff: multiplier, pow: 0 }], exponent: 1 }].concat(node.factors.map(cloneFactor))
      }];
    }
    if (side.length === 1) {
      return [scaleNode(side[0], multiplier)];
    }
    return [{
      sign: multiplier < 0 ? -1 : 1,
      factor: { coeff: Math.abs(multiplier), pow: 0 },
      innerTerms: cloneSide(side)
    }];
  }

  // Division "affichée" : même principe que wrapSideInFactor mais sous forme de fraction
  // (ex. "\frac{9x-6}{2}") quand le membre a plusieurs termes, plutôt que de distribuer
  // la division terme à terme. Un seul terme se divise directement (ex. "8x÷2" -> "4x"),
  // sans fraction inutile.
  function wrapSideInFraction(side, divisor) {
    if (side.length === 1) {
      return [scaleNode(side[0], 1 / divisor)];
    }
    return [{
      sign: divisor < 0 ? -1 : 1,
      factor: { coeff: Math.abs(divisor), pow: 0 },
      innerTerms: cloneSide(side),
      isDivision: true
    }];
  }

  // Divise le membre entier par une EXPRESSION (ex. "÷(x+5)", voir classifyMulDivOperand
  // dans history.js). Contrairement à wrapSideInFraction (diviseur numérique, toujours
  // enveloppé si plusieurs termes), on tente d'abord d'ANNULER la division quand ce
  // dénominateur est déjà, structurellement (voir sidesEquivalent), un facteur du membre —
  // exactement ce qu'un élève ferait à la main — plutôt que d'empiler une fraction dessus :
  // 1) le membre est déjà UNE fraction avec CE MÊME dénominateur -> ressort le numérateur ;
  // 2) le membre est un ProductGroup dont un facteur (exposant 1) vaut CE dénominateur ->
  //    retire ce facteur (s'effondre en simple Side si un seul facteur d'exposant 1 reste) ;
  // 3) le membre est "k(...)" (multiplication, pas une division) dont l'intérieur vaut CE
  //    dénominateur -> ne reste que "k". Sinon (cas par défaut), le membre entier devient le
  // numérateur d'une nouvelle fraction, son dénominateur restant une expression à part
  // entière (voir isExpressionQuotient) — ni distribué, ni développable comme un tout (voir
  // computeExpandTargets), mais numérateur ET dénominateur restent chacun librement
  // manipulables via pending.drilled (part 'den' pour le second, voir history.js).
  function wrapSideInQuotient(side, divisorTerms) {
    function foldSign(sign, terms) {
      return sign < 0 ? terms.map(function (t) { return scaleNode(t, -1); }) : cloneSide(terms);
    }
    if (side.length === 1) {
      var node = side[0];
      if (isExpressionQuotient(node) && sidesEquivalent(node.factorTerms, divisorTerms)) {
        return foldSign(node.sign, node.innerTerms);
      }
      if (isProductGroup(node)) {
        // Le diviseur peut annuler une SEULE puissance d'un facteur déjà élevé à un
        // exposant >= 2 (ex. "(x-2)²÷(x-2)" -> "(x-2)"), pas seulement un facteur
        // d'exposant 1 : on compare toujours à la BASE du facteur (factors[i].terms),
        // jamais à la base élevée à sa puissance.
        var matchIdx = -1;
        for (var i = 0; i < node.factors.length; i++) {
          if (sidesEquivalent(node.factors[i].terms, divisorTerms)) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx !== -1) {
          var matched = node.factors[matchIdx];
          var remaining = matched.exponent === 1
            ? node.factors.filter(function (_, fi) { return fi !== matchIdx; }).map(cloneFactor)
            : node.factors.map(function (f, fi) {
              return fi === matchIdx ? { terms: cloneSide(f.terms), exponent: f.exponent - 1 } : cloneFactor(f);
            });
          if (remaining.length === 1 && remaining[0].exponent === 1) {
            return foldSign(node.sign, remaining[0].terms);
          }
          return [{ sign: node.sign, factors: remaining }];
        }
      }
      if (isFactorGroup(node) && !node.isDivision && sidesEquivalent(node.innerTerms, divisorTerms)) {
        return [{ coeff: node.sign * node.factor.coeff, pow: node.factor.pow }];
      }
    }
    return [{ sign: 1, factorTerms: cloneSide(divisorTerms), innerTerms: cloneSide(side), isDivision: true }];
  }

  // Fusionne dans `factors` toute paire de facteurs structurellement équivalents (voir
  // sidesEquivalent, plus bas dans ce fichier — accessible ici grâce au hoisting des
  // déclarations de fonction) en un seul, exposant additionné : "(x+2)(x+2)" doit produire
  // UN facteur d'exposant 2, jamais deux facteurs séparés d'exposant 1 (comportement
  // attendu ailleurs dans l'appli, ex. la détection d'un carré pour "Racine carrée").
  function canonicalizeFactors(factors) {
    var out = [];
    factors.forEach(function (f) {
      for (var i = 0; i < out.length; i++) {
        if (sidesEquivalent(out[i].terms, f.terms)) {
          out[i] = { terms: out[i].terms, exponent: out[i].exponent + f.exponent };
          return;
        }
      }
      out.push({ terms: f.terms, exponent: f.exponent });
    });
    return out;
  }

  // Décompose un opérande de multiplication (le membre actuel, OU le multiplicateur — voir
  // wrapSideInProduct ci-dessous, qui appelle ceci pour les deux) en sa liste de facteurs +
  // son signe global. Un ProductGroup à UN SEUL noeud (ex. via la touche "×(...)²" du pavé)
  // déplie directement ses propres facteurs plutôt que de s'imbriquer tel quel comme facteur
  // UNIQUE d'un autre ProductGroup (que la plupart des fonctions de ce fichier ne savent pas
  // traiter, voir expandProductGroup). Un FactorGroup à coefficient (ex. "5(x+13)", jamais
  // une division — voir isDivision, qui ne se décompose pas de la même façon) se déplie de
  // la même façon en DEUX facteurs distincts (le coefficient, PUIS la parenthèse) : sans
  // ça, le coefficient resterait collé DANS le facteur imbriqué et s'afficherait accolé au
  // facteur précédent sans aucun signe "×" visible (ex. "25" suivi de "5(x+13)" -> "255(x+13)"),
  // et "Développer" ne saurait pas non plus le traiter (expandProductFactorSubset attend des
  // facteurs plats, jamais un FactorGroup imbriqué dans un facteur).
  function operandFactors(terms) {
    if (terms.length === 1 && isProductGroup(terms[0])) {
      return { factors: terms[0].factors.map(cloneFactor), sign: terms[0].sign };
    }
    if (terms.length === 1 && isFactorGroup(terms[0]) && !terms[0].isDivision) {
      var fg = terms[0];
      return {
        factors: [
          { terms: [{ coeff: fg.factor.coeff, pow: fg.factor.pow }], exponent: 1 },
          { terms: cloneSide(fg.innerTerms), exponent: 1 }
        ],
        sign: fg.sign
      };
    }
    return { factors: [{ terms: cloneSide(terms), exponent: 1 }], sign: 1 };
  }

  // Multiplication par une expression à plusieurs termes (ex. "×(x+5)") : le membre est
  // toujours enveloppé dans un ProductGroup, même s'il n'a qu'un seul terme (contrairement
  // à wrapSideInFactor) — l'élève peut ensuite développer ce produit via "Développer".
  // Si le membre est DÉJÀ un ProductGroup (ex. multiplier une seconde fois un membre déjà
  // factorisé), le nouveau facteur s'AJOUTE à ses facteurs existants plutôt que de créer un
  // ProductGroup imbriqué dans un autre — voir operandFactors ci-dessus, appliqué aux DEUX
  // côtés (le membre courant ET le multiplicateur) de façon symétrique.
  function wrapSideInProduct(side, multiplierTerms) {
    // Annule une division PAR CETTE MÊME expression plutôt que de multiplier dessus (ex.
    // "÷(x+5)" puis "×(x+5)" redonne exactement le membre de départ) — voir
    // wrapSideInQuotient, dont ceci est le symétrique. Un ProductGroup/FactorGroup
    // classique, lui, ne s'annule JAMAIS en multipliant (canonicalizeFactors se contente
    // d'augmenter l'exposant du facteur déjà présent, ce qui reste mathématiquement correct
    // pour une multiplication).
    if (side.length === 1 && isExpressionQuotient(side[0]) && sidesEquivalent(side[0].factorTerms, multiplierTerms)) {
      var q = side[0];
      return q.sign < 0 ? q.innerTerms.map(function (t) { return scaleNode(t, -1); }) : cloneSide(q.innerTerms);
    }
    var base = operandFactors(side);
    var add = operandFactors(multiplierTerms);
    return [{ sign: base.sign * add.sign, factors: canonicalizeFactors(base.factors.concat(add.factors)) }];
  }

  // Fusionne (simplifie) les noeuds aux indices `indices`. La sélection peut mélanger des
  // termes de degrés différents (constante / x / x²) : chaque degré se fusionne dans son
  // propre terme (jamais deux degrés ensemble, ce qui resterait mathématiquement invalide),
  // ce qui évite de devoir faire une sélection séparée par degré pour nettoyer une ligne
  // complète d'un coup.
  function simplifyNodes(side, indices) {
    var idxSet = indices.slice().sort(function (a, b) { return a - b; });
    var selectedNodes = idxSet.map(function (i) { return side[i]; });
    if (selectedNodes.some(isGroup)) {
      throw new Error('Impossible de simplifier un groupe factorisé.');
    }

    var remainingCount = side.length - idxSet.length;

    // Seaux par degré, dans l'ordre de première apparition parmi les indices sélectionnés
    // (le degré du tout premier terme sélectionné sort donc en premier, comme avant).
    var powOrder = [];
    var byPow = {};
    idxSet.forEach(function (i) {
      var p = side[i].pow;
      if (!byPow[p]) { byPow[p] = []; powOrder.push(p); }
      byPow[p].push(i);
    });

    var results = powOrder.map(function (p) {
      var sum = roundClean(byPow[p].reduce(function (acc, i) { return acc + side[i].coeff; }, 0));
      return { coeff: sum, pow: sum === 0 ? 0 : p };
    });

    // Si un des termes fusionnés s'annule (0), on ne laisse pas de "+0" parasite tant
    // qu'il reste autre chose (un autre terme fusionné, ou d'autres noeuds sur le
    // membre) ; s'il ne restait vraiment plus rien, on garde un "0" explicite.
    var nonZero = results.filter(function (t) { return t.coeff !== 0; });
    var finalResults;
    if (nonZero.length > 0) {
      finalResults = nonZero;
    } else if (remainingCount > 0) {
      finalResults = [];
    } else {
      finalResults = [results[0]];
    }

    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        finalResults.forEach(function (t) { out.push(t); });
      } else if (idxSet.indexOf(i) !== -1) {
        // skip, fusionné
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Facteur commun quand la sélection est déjà DES FactorGroup numériques (ex.
  // "2(5x-7)-10(9+3x)" factorisé par 2 donne "2[(5x-7)-5(9+3x)]") : chaque terme
  // sélectionné doit être un FactorGroup à facteur numérique simple (factor.pow===0, pas
  // une division) dont le coefficient combiné (sign×factor.coeff) est multiple du facteur
  // choisi. Le coefficient RESTANT de chaque terme après division devient : ses innerTerms
  // rejoignent directement ceux du nouveau groupe englobant s'il vaut exactement 1 (pas de
  // parenthèse "1(...)" redondante), sinon un FactorGroup imbriqué avec ce reste comme
  // facteur (ex. le "-5" ci-dessus).
  function factorAlreadyGroupedNodes(side, indices, factorTerm) {
    var idxSet = indices.slice().sort(function (a, b) { return a - b; });
    var selectedNodes = idxSet.map(function (i) { return side[i]; });
    if (roundClean(factorTerm.coeff) === 0) {
      throw new Error('Le facteur ne peut pas être 0.');
    }
    if (roundClean(factorTerm.pow) !== 0) {
      throw new Error('Le facteur commun d\'expressions déjà factorisées doit être un simple nombre.');
    }
    var innerTerms = [];
    selectedNodes.forEach(function (n) {
      var combined = n.sign * n.factor.coeff;
      var remaining = roundClean(combined / factorTerm.coeff);
      if (roundClean(remaining) === 0) {
        throw new Error('Tous les termes sélectionnés doivent contenir ce facteur pour factoriser par lui.');
      }
      if (remaining === 1) {
        n.innerTerms.forEach(function (t) { innerTerms.push(cloneNode(t)); });
      } else {
        innerTerms.push({
          sign: remaining < 0 ? -1 : 1,
          factor: { coeff: Math.abs(remaining), pow: 0 },
          innerTerms: n.innerTerms.map(cloneNode)
        });
      }
    });
    var group = {
      sign: factorTerm.coeff < 0 ? -1 : 1,
      factor: { coeff: Math.abs(factorTerm.coeff), pow: 0 },
      innerTerms: innerTerms
    };
    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) out.push(group);
      else if (idxSet.indexOf(i) !== -1) { /* skip */ }
      else out.push(cloneNode(n));
    });
    return out;
  }

  // Factorise les noeuds aux indices `indices` par `factorTerm` : soit tous des Term
  // (chaque terme intérieur ressort avec un degré diminué de celui du facteur — ex.
  // factoriser "x²+5x" par "x" donne les termes intérieurs x et 1 ; une sélection
  // contenant un terme de degré inférieur à celui du facteur est invalide, ex. factoriser
  // une constante par "x"), soit tous des FactorGroup numériques déjà factorisés (voir
  // factorAlreadyGroupedNodes ci-dessus) ; un mélange des deux, ou un ProductGroup dans la
  // sélection, reste invalide.
  function factorNodes(side, indices, factorTerm) {
    var idxSet = indices.slice().sort(function (a, b) { return a - b; });
    var selectedNodes = idxSet.map(function (i) { return side[i]; });
    if (selectedNodes.every(function (n) { return isFactorGroup(n) && !n.isDivision; })) {
      return factorAlreadyGroupedNodes(side, indices, factorTerm);
    }
    if (selectedNodes.some(isGroup)) {
      throw new Error('Impossible de factoriser un groupe déjà factorisé.');
    }
    if (roundClean(factorTerm.coeff) === 0) {
      throw new Error('Le facteur ne peut pas être 0.');
    }
    var innerTerms = selectedNodes.map(function (t) {
      var innerPow = t.pow - factorTerm.pow;
      if (innerPow < 0) {
        throw new Error('Tous les termes sélectionnés doivent contenir ce facteur pour factoriser par lui.');
      }
      return { coeff: roundClean(t.coeff / factorTerm.coeff), pow: innerPow };
    });
    var group = {
      sign: 1,
      factor: { coeff: Math.abs(factorTerm.coeff), pow: factorTerm.pow },
      innerTerms: innerTerms
    };
    if (factorTerm.coeff < 0) {
      // facteur négatif : on inverse le signe global du groupe et les signes internes restent cohérents
      group.sign = -1;
    }
    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        out.push(group);
      } else if (idxSet.indexOf(i) !== -1) {
        // skip
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Applique UNE identité remarquable EXPLICITEMENT choisie par l'élève (voir le sélecteur
  // à 2 étapes "Facteur commun / Identité 1/2/3" dans history.js et toolbar.js), plutôt
  // que de la deviner automatiquement à partir d'un nombre tapé : identityType 1 =
  // a²+2ab+b²=(a+b)², 2 = a²-2ab+b²=(a-b)², 3 = a²-b²=(a-b)(a+b). `xCoeff`/`constVal` sont
  // déjà résolus par l'appelant (parseIdentityAB dans history.js) d'après lequel des deux
  // champs porte le x — le signe de chaque identité vient uniquement du type choisi,
  // jamais d'un signe saisi séparément. `aIsX` (vrai si le LaTeX tapé pour "a" a été
  // reconnu comme le terme en x, voir parseIdentityAB) précise en plus quel champ (a ou b)
  // l'élève a rempli EN PREMIER : la forme factorisée
  // reproduit cet ordre plutôt que de toujours écrire le x en premier (ex. a=2,b=x ->
  // "(2+x)²", pas "(x+2)²") — voir aTerm/bTerm ci-dessous. Contrairement à l'ancienne
  // détection automatique, lève une erreur explicite (jamais de repli silencieux) si la
  // sélection ne correspond pas exactement au motif attendu : l'élève a choisi cette
  // identité en connaissance de cause, une explication concrète est plus utile qu'un
  // simple échec muet.
  function factorRemarkableIdentityChoice(side, indices, identityType, xCoeff, constVal, aIsX) {
    var idxSet = indices.slice().sort(function (x, y) { return x - y; });
    var selectedNodes = idxSet.map(function (i) { return side[i]; });
    if (selectedNodes.some(isGroup)) {
      throw new Error('Impossible d\'utiliser une identité remarquable sur un groupe déjà factorisé.');
    }
    xCoeff = roundClean(xCoeff);
    constVal = roundClean(constVal);
    if (xCoeff === 0) throw new Error('"a" ne peut pas être nul.');
    if (!constVal || constVal === 0) throw new Error('Saisissez "b".');

    var x2 = null, x1 = null, x0 = null;
    selectedNodes.forEach(function (t) {
      if (t.pow === 2 && x2 === null) x2 = t;
      else if (t.pow === 1 && x1 === null) x1 = t;
      else if (t.pow === 0 && x0 === null) x0 = t;
    });

    // Termes correspondant à ce que l'élève a tapé dans CHAQUE champ, dans L'ORDRE où il
    // les a tapés (a puis b) — plutôt que toujours "le x d'abord" : reproduit fidèlement
    // "a=2,b=x" -> aTerm=2 (constante), bTerm=x, dans cet ordre.
    var xTerm = { coeff: xCoeff, pow: 1 };
    var constTerm = { coeff: constVal, pow: 0 };
    var aTerm = aIsX ? xTerm : constTerm;
    var bTerm = aIsX ? constTerm : xTerm;
    var negBTerm = { coeff: -bTerm.coeff, pow: bTerm.pow };

    var group;
    if (identityType === 3) {
      if (idxSet.length !== 2 || !x2 || x1 || !x0) {
        throw new Error('a²-b² nécessite exactement un terme en x² et un terme constant (sans terme en x).');
      }
      if (roundClean(x2.coeff) !== roundClean(xCoeff * xCoeff) || roundClean(x0.coeff) !== roundClean(-(constVal * constVal))) {
        throw new Error('La sélection ne correspond pas à a²-b² avec ces valeurs de a et b.');
      }
      // (a-b)(a+b) reproduit tel quel si a porte le x (résultat déjà égal au polynôme
      // d'origine, x²-b² : inchangé) ; si c'est b qui porte le x, "(a-b)(a+b)" devient
      // "(constante-x)(constante+x)" = constante²-x² = -(x²-constante²) — l'OPPOSÉ du
      // polynôme d'origine : un signe global -1 compense pour rester mathématiquement
      // équivalent tout en respectant l'ordre a,b tel que saisi.
      group = {
        sign: aIsX ? 1 : -1,
        factors: [
          { terms: [cloneTerm(aTerm), cloneTerm(negBTerm)], exponent: 1 },
          { terms: [cloneTerm(aTerm), cloneTerm(bTerm)], exponent: 1 }
        ]
      };
    } else {
      if (idxSet.length !== 3 || !x2 || !x1 || !x0) {
        throw new Error('Cette identité nécessite exactement un terme en x², un terme en x et un terme constant.');
      }
      var expectedX1 = identityType === 1 ? 2 * xCoeff * constVal : -2 * xCoeff * constVal;
      if (roundClean(x2.coeff) !== roundClean(xCoeff * xCoeff) || roundClean(x1.coeff) !== roundClean(expectedX1) ||
        roundClean(x0.coeff) !== roundClean(constVal * constVal)) {
        throw new Error('La sélection ne correspond pas à cette identité avec ces valeurs de a et b.');
      }
      // (a+b)² : ordre a,b tel que saisi, jamais de signe à compenser (a+b = b+a).
      // (a-b)² : idem, "b" prend simplement le signe négatif de la formule quel que soit
      // ce qu'il représente (x ou la constante) — (a-b)²=(b-a)² de toute façon.
      var pair = identityType === 1 ? [aTerm, bTerm] : [aTerm, negBTerm];
      group = {
        sign: 1,
        factors: [{ terms: [cloneTerm(pair[0]), cloneTerm(pair[1])], exponent: 2 }]
      };
    }

    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        out.push(group);
      } else if (idxSet.indexOf(i) !== -1) {
        // skip
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Variante de factorRemarkableIdentityChoice pour la 3e identité (a²-b²=(a-b)(a+b))
  // quand "a" n'est PAS un simple coefficient de x mais une EXPRESSION QUELCONQUE déjà
  // elle-même factorisée — ex. "(x+8)²-4" avec b=2 donne "(x+8-2)(x+8+2)" — voir
  // getFactorTargetShape/chooseFactorMode dans history.js pour la détection de cette
  // sélection (exactement un ProductGroup.isSquare de signe positif + une constante
  // valant -b²) et pending.idGroupBase pour son cheminement dans le sélecteur "Factoriser".
  // "b" reste un simple nombre saisi par l'élève ; "a" (l'expression) n'a rien à saisir,
  // il vient directement du ProductGroup sélectionné.
  function factorDifferenceOfSquaresFromGroup(side, indices, b) {
    var idxSet = indices.slice().sort(function (x, y) { return x - y; });
    if (idxSet.length !== 2) {
      throw new Error('Sélectionnez exactement le carré (...)² et la constante.');
    }
    var n0 = side[idxSet[0]], n1 = side[idxSet[1]];
    var sq = (isSquareFactorGroup(n0) && n0.sign === 1) ? n0
      : ((isSquareFactorGroup(n1) && n1.sign === 1) ? n1 : null);
    if (!sq) {
      throw new Error('Sélectionnez un carré (...)² et une constante.');
    }
    var constNode = sq === n0 ? n1 : n0;
    if (isGroup(constNode) || constNode.pow !== 0) {
      throw new Error('L\'autre terme sélectionné doit être une simple constante.');
    }
    b = roundClean(b);
    if (!b || b === 0) throw new Error('Saisissez "b".');
    if (roundClean(constNode.coeff) !== roundClean(-(b * b))) {
      throw new Error('La sélection ne correspond pas à a²-b² avec cette valeur de b.');
    }
    var sqBase = sq.factors[0].terms;
    var group = {
      sign: 1,
      factors: [
        { terms: sqBase.map(cloneNode).concat([{ coeff: -b, pow: 0 }]), exponent: 1 },
        { terms: sqBase.map(cloneNode).concat([{ coeff: b, pow: 0 }]), exponent: 1 }
      ]
    };
    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        out.push(group);
      } else if (idxSet.indexOf(i) !== -1) {
        // skip
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Comme factorDifferenceOfSquaresFromGroup, mais pour a²-b² où "b" est LUI AUSSI une
  // expression déjà factorisée (pas une simple constante) — ex. "(x-2)²-(x+6)²" avec
  // a=x-2, b=x+6 donne "(x-2-(x+6))(x-2+(x+6))". Ni "a" ni "b" n'ont de valeur à saisir :
  // les deux sont entièrement déterminés par la sélection (deux carrés de signes
  // opposés) — voir pending.idGroupBase/idGroupBaseB dans history.js, que l'élève doit
  // néanmoins reconnaître et TAPER lui-même (voir parseIdentityAB) avant de valider.
  function factorDifferenceOfTwoSquareGroups(side, indices) {
    var idxSet = indices.slice().sort(function (x, y) { return x - y; });
    if (idxSet.length !== 2) {
      throw new Error('Sélectionnez exactement les deux carrés.');
    }
    var n0 = side[idxSet[0]], n1 = side[idxSet[1]];
    var pos = (isSquareFactorGroup(n0) && n0.sign === 1) ? n0
      : ((isSquareFactorGroup(n1) && n1.sign === 1) ? n1 : null);
    var neg = (isSquareFactorGroup(n0) && n0.sign === -1) ? n0
      : ((isSquareFactorGroup(n1) && n1.sign === -1) ? n1 : null);
    if (!pos || !neg) {
      throw new Error('Sélectionnez deux carrés de signes opposés (a²-b²).');
    }
    var posBase = pos.factors[0].terms, negBase = neg.factors[0].terms;
    var group = {
      sign: 1,
      factors: [
        { terms: posBase.map(cloneNode).concat(negBase.map(function (t) { return scaleNode(t, -1); })), exponent: 1 },
        { terms: posBase.map(cloneNode).concat(negBase.map(cloneNode)), exponent: 1 }
      ]
    };
    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        out.push(group);
      } else if (idxSet.indexOf(i) !== -1) {
        // skip
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Aperçu "en direct" d'une factorisation avant que le facteur commun ait été saisi :
  // regroupe les termes choisis entre parenthèses sans diviser par rien (comme un
  // facteur de 1), et sans afficher de chiffre devant la parenthèse.
  function factorNodesRaw(side, indices) {
    var idxSet = indices.slice().sort(function (a, b) { return a - b; });
    var selectedNodes = idxSet.map(function (i) { return side[i]; });
    if (selectedNodes.some(isGroup)) {
      throw new Error('Impossible de factoriser un groupe déjà factorisé.');
    }
    var group = { sign: 1, factor: null, innerTerms: selectedNodes.map(cloneTerm) };
    var out = [];
    side.forEach(function (n, i) {
      if (i === idxSet[0]) {
        out.push(group);
      } else if (idxSet.indexOf(i) !== -1) {
        // skip
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Distribue le facteur (sign/factor) d'un groupe sur UN de ses termes intérieurs `t`.
  // Si `t` est lui-même un groupe imbriqué (ex. "3(-2)" dans "2(-9x+3(-2))"), les deux
  // facteurs se combinent en un seul groupe plutôt que de descendre encore d'un niveau.
  // `outerIsDivision` : le groupe distribué est une fraction ("(...)/k") plutôt qu'une
  // multiplication ("k(...)") ; chaque terme intérieur en ressort alors divisé par k.
  function expandOneInner(outerSign, outerFactor, outerIsDivision, t) {
    if (isProductGroup(t)) {
      throw new Error('Développement non pris en charge pour cette combinaison de groupes.');
    }
    if (isFactorGroup(t)) {
      if (outerIsDivision && t.isDivision) {
        // (.../d1) / d2 : les deux dénominateurs se combinent par multiplication.
        return {
          sign: outerSign * t.sign,
          factor: { coeff: roundClean(outerFactor.coeff * t.factor.coeff), pow: 0 },
          innerTerms: t.innerTerms.map(cloneNode),
          isDivision: true
        };
      }
      if (outerIsDivision && !t.isDivision) {
        // (k*...) / d : reste un seul multiplicateur k/d devant la parenthèse.
        return {
          sign: outerSign * t.sign,
          factor: { coeff: roundClean(t.factor.coeff / outerFactor.coeff), pow: t.factor.pow },
          innerTerms: t.innerTerms.map(cloneNode)
        };
      }
      if (!outerIsDivision && t.isDivision) {
        // k * (.../d) : reste une fraction, dénominateur divisé par k.
        return {
          sign: outerSign * t.sign,
          factor: { coeff: roundClean(t.factor.coeff / outerFactor.coeff), pow: 0 },
          innerTerms: t.innerTerms.map(cloneNode),
          isDivision: true
        };
      }
      return {
        sign: outerSign * t.sign,
        factor: {
          coeff: roundClean(outerFactor.coeff * t.factor.coeff),
          pow: outerFactor.pow + t.factor.pow
        },
        innerTerms: t.innerTerms.map(cloneNode)
      };
    }
    if (outerIsDivision) {
      return {
        coeff: roundClean(outerSign * t.coeff / outerFactor.coeff),
        pow: t.pow
      };
    }
    return {
      coeff: roundClean(outerSign * outerFactor.coeff * t.coeff),
      pow: outerFactor.pow + t.pow
    };
  }

  // Développe (distribue) un groupe factorisé : les termes intérieurs aux indices
  // `innerIndices` ressortent multipliés par le facteur ; ceux non choisis restent
  // groupés dans une factorisation plus petite (ou disparaissent si tous sont choisis).
  function expandFactorGroup(side, groupIndex, innerIndices) {
    var node = side[groupIndex];
    if (!isFactorGroup(node)) {
      throw new Error('Ce terme n\'est pas factorisé.');
    }
    var idxSet = innerIndices.slice().sort(function (a, b) { return a - b; });
    var expanded = [];
    var remaining = [];
    node.innerTerms.forEach(function (t, i) {
      if (idxSet.indexOf(i) !== -1) {
        expanded.push(expandOneInner(node.sign, node.factor, !!node.isDivision, t));
      } else {
        remaining.push(cloneNode(t));
      }
    });
    var out = [];
    side.forEach(function (n, i) {
      if (i === groupIndex) {
        expanded.forEach(function (e) { out.push(e); });
        if (remaining.length > 0) {
          var remainingGroup = { sign: node.sign, factor: cloneTerm(node.factor), innerTerms: remaining };
          if (node.isDivision) remainingGroup.isDivision = true;
          out.push(remainingGroup);
        }
      } else {
        out.push(cloneNode(n));
      }
    });
    return out;
  }

  // Combine une liste de termes plats (même degré fusionné ensemble), triés par degré
  // décroissant (x² puis x puis constante — ordre conventionnel d'un polynôme), en
  // retirant les degrés dont la somme s'annule (sauf s'il ne resterait plus rien du
  // tout, auquel cas on garde un "0" explicite).
  function combineTermsByPow(terms) {
    var byPow = {};
    var powOrder = [];
    terms.forEach(function (t) {
      if (!(t.pow in byPow)) { byPow[t.pow] = 0; powOrder.push(t.pow); }
      byPow[t.pow] = roundClean(byPow[t.pow] + t.coeff);
    });
    powOrder.sort(function (a, b) { return b - a; }); // degré décroissant (x^N ... x, constante)
    var out = [];
    powOrder.forEach(function (p) {
      if (byPow[p] !== 0) out.push({ coeff: byPow[p], pow: p });
    });
    if (out.length === 0) return [{ coeff: 0, pow: 0 }];
    return out;
  }

  // Multiplie terme à terme deux listes PLATES de Term (jamais de groupe) — l'opérateur de
  // fold réutilisé par expandProductGroup ci-dessous, aussi bien entre deux facteurs
  // distincts qu'entre un facteur et lui-même (pour un exposant > 1).
  function multiplyFlatTerms(a, b) {
    var out = [];
    a.forEach(function (ta) {
      b.forEach(function (tb) {
        out.push({ coeff: roundClean(ta.coeff * tb.coeff), pow: ta.pow + tb.pow });
      });
    });
    return out;
  }

  // Développe un ProductGroup de N facteurs : chaque facteur est d'abord auto-multiplié
  // `exponent-1` fois (ex. exposant 2 -> une seule auto-multiplication, un FOIL classique),
  // puis les N résultats plats se multiplient deux à deux via un fold (le même
  // multiplyFlatTerms comme opérateur, aucun nouvel algorithme par rapport à l'ancien FOIL
  // strictement pairwise). Le signe du groupe s'applique une seule fois à la fin (une
  // multiplication scalaire se distribue de la même façon peu importe quand on l'applique).
  // Term.pow n'étant plus plafonné (voir modèle de données en tête de fichier), aucune
  // limite de degré à vérifier ici : "(x+2)(x+3)(x+4)" se développe normalement en x³+....
  function expandProductGroup(node) {
    if (!isProductGroup(node)) {
      throw new Error('Ce terme n\'est pas un produit de sommes.');
    }
    if (node.factors.some(function (f) { return f.terms.some(isGroup); })) {
      throw new Error('Développement non pris en charge pour un produit imbriqué.');
    }
    var acc = null;
    node.factors.forEach(function (f) {
      var flat = f.terms.map(cloneTerm);
      for (var k = 1; k < f.exponent; k++) flat = multiplyFlatTerms(flat, f.terms);
      acc = acc === null ? flat : multiplyFlatTerms(acc, flat);
    });
    acc = acc.map(function (t) { return { coeff: roundClean(node.sign * t.coeff), pow: t.pow }; });
    return combineTermsByPow(acc);
  }

  // Développe SEULEMENT un sous-ensemble (au moins 2) des facteurs d'un ProductGroup entre
  // eux, en les remplaçant par UN nouveau facteur (leur produit développé, exposant 1), les
  // AUTRES facteurs restant intacts à leur place — ex. sélectionner "(x-5)" et "(x+2)" dans
  // "(x²-10x+25)(x-5)(x+2)" donne "(x²-10x+25)(x²-3x-10)" (voir toggleFactorSelection dans
  // history.js pour la sélection UI correspondante). Le signe du produit reste sur le
  // ProductGroup résultant (jamais appliqué au sous-produit lui-même) puisque les facteurs
  // non sélectionnés restent en dehors de ce développement partiel.
  // Si le sous-ensemble couvre TOUS les facteurs, ce n'est plus un produit du tout : on
  // retombe alors sur exactement le même résultat qu'un développement complet (voir
  // expandProductGroup ci-dessus, signe inclus cette fois), signalé par `full:true` pour
  // que l'appelant remplace le noeud par des Term bruts plutôt que par un ProductGroup à un
  // seul facteur d'exposant 1 (qui violerait l'invariant : factors.length===1 exige
  // exponent>=2, voir modèle de données en tête de fichier).
  // Un SEUL facteur sélectionné reste accepté quand il a lui-même un exposant>1 (ex. "(x-6)²"
  // dans "(x-1)(x-6)²") : il y a alors quelque chose à développer (l'auto-multiplication de
  // ce facteur par lui-même) sans avoir besoin d'un second facteur à combiner.
  function expandProductFactorSubset(node, branchIndices) {
    if (!isProductGroup(node)) {
      throw new Error('Ce terme n\'est pas un produit de sommes.');
    }
    if (branchIndices.length < 1 ||
        (branchIndices.length === 1 && node.factors[branchIndices[0]].exponent < 2)) {
      throw new Error('Sélectionnez au moins deux parenthèses à développer ensemble, ou une seule affectée d\'une puissance.');
    }
    var sortedIdx = branchIndices.slice().sort(function (a, b) { return a - b; });
    sortedIdx.forEach(function (i) {
      var f = node.factors[i];
      if (!f || f.terms.some(isGroup)) {
        throw new Error('Développement non pris en charge pour un produit imbriqué.');
      }
    });
    var acc = null;
    sortedIdx.forEach(function (i) {
      var f = node.factors[i];
      var flat = f.terms.map(cloneTerm);
      for (var k = 1; k < f.exponent; k++) flat = multiplyFlatTerms(flat, f.terms);
      acc = acc === null ? flat : multiplyFlatTerms(acc, flat);
    });
    var expandedTerms = combineTermsByPow(acc);
    if (sortedIdx.length === node.factors.length) {
      var signed = expandedTerms.map(function (t) { return { coeff: roundClean(node.sign * t.coeff), pow: t.pow }; });
      return { full: true, terms: signed };
    }
    var newFactors = [];
    var inserted = false;
    node.factors.forEach(function (f, i) {
      if (sortedIdx.indexOf(i) !== -1) {
        if (!inserted) {
          newFactors.push({ terms: expandedTerms, exponent: 1 });
          inserted = true;
        }
        return;
      }
      newFactors.push({ terms: f.terms.map(cloneNode), exponent: f.exponent });
    });
    return { full: false, node: { sign: node.sign, factors: canonicalizeFactors(newFactors) } };
  }

  function sideIsSingleTerm(side) {
    return side.length === 1 && !isGroup(side[0]);
  }

  // Liste des facteurs terminaux d'un ProductGroup, pour "Produit nul" (voir detectProduitNul
  // dans history.js) : un facteur répété (exponent>1, ex. "(x+3)²") ne compte qu'UNE fois —
  // "(x+3)²=0" a le même ensemble de solutions que "(x+3)=0", peu importe l'exposant, donc
  // pas besoin de le dupliquer pour ensuite le dédupliquer (contrairement à l'ancienne
  // représentation left/right dupliquée). Le signe est ignoré : un produit nul reste nul
  // quel que soit son signe global, voir l'appelant.
  function flattenProductFactors(node) {
    return node.factors.map(function (f) { return f.terms; });
  }

  // Clé canonique d'un membre pour comparer deux facteurs SANS tenir compte de l'ordre
  // de leurs termes (ex. "a+b" et "b+a" doivent compter comme LE MÊME facteur, un terme
  // ayant pu être glissé — voir render.js) : somme des coefficients par degré. Ne
  // s'applique qu'à une liste de Term simples (pas de groupe imbriqué) ; sinon, on
  // retombe sur une égalité structurelle stricte (ordre inclus) via JSON.stringify —
  // approximation raisonnable pour ce cas plus rare (un facteur lui-même factorisé).
  function sidesEquivalent(a, b) {
    var aFlat = a.every(function (n) { return !isGroup(n); });
    var bFlat = b.every(function (n) { return !isGroup(n); });
    if (aFlat && bFlat) {
      function degreeSums(side) {
        var sums = {};
        side.forEach(function (t) { sums[t.pow] = roundClean((sums[t.pow] || 0) + t.coeff); });
        return sums;
      }
      var sa = degreeSums(a), sb = degreeSums(b);
      var allPows = {};
      Object.keys(sa).concat(Object.keys(sb)).forEach(function (p) { allPows[p] = true; });
      return Object.keys(allPows).every(function (p) { return (sa[p] || 0) === (sb[p] || 0); });
    }
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // Descend `path` (ex. [2] = side[2], [2,1] = side[2].innerTerms[1], [2,1,0] = encore un
  // niveau plus bas...) dans `side`, en exigeant un FactorGroup à chaque étape
  // intermédiaire (seul type de groupe où l'on peut "entrer", voir "drilled" dans
  // history.js). Renvoie le noeud trouvé, ou null si le chemin ne correspond plus à rien
  // (ex. l'équation a changé de forme entre-temps).
  function nodeAtPath(side, path) {
    var node = side[path[0]];
    for (var i = 1; i < path.length; i++) {
      if (!node || !isFactorGroup(node)) return null;
      node = node.innerTerms[path[i]];
    }
    return node || null;
  }

  // Remplace les innerTerms du FactorGroup situé à `path` (voir nodeAtPath) par
  // `newInnerTerms`, à n'importe quelle profondeur d'imbrication — utilisé pour
  // factoriser/simplifier À L'INTÉRIEUR d'un groupe déjà factorisé, lui-même
  // potentiellement à l'intérieur d'un autre (voir "drilled" dans history.js).
  function withGroupInnerTermsAtPath(side, path, newInnerTerms) {
    // Ordre des clés préservé (sign, factor[Terms], innerTerms, isDivision) : plusieurs
    // tests comparent des équations via JSON.stringify(...) === JSON.stringify(...),
    // sensible à l'ordre d'insertion des propriétés.
    function withOuterFields(node, innerTerms) {
      var out = { sign: node.sign };
      if (node.factorTerms) out.factorTerms = node.factorTerms.map(cloneNode);
      else out.factor = cloneTerm(node.factor);
      out.innerTerms = innerTerms;
      if (node.isDivision) out.isDivision = true;
      return out;
    }
    function recur(node, restPath) {
      if (restPath.length === 0) {
        return withOuterFields(node, newInnerTerms);
      }
      var newInner = node.innerTerms.map(function (t, i) {
        return i === restPath[0] ? recur(t, restPath.slice(1)) : cloneNode(t);
      });
      return withOuterFields(node, newInner);
    }
    return side.map(function (n, i) {
      return i === path[0] ? recur(n, path.slice(1)) : cloneNode(n);
    });
  }

  // Remplace le dénominateur-EXPRESSION (factorTerms) du FactorGroup situé à `path` — path
  // toujours de longueur 1 ici (voir pending.drilled.part==='den' dans history.js : une
  // seule profondeur, comme withProductBranchAtPath pour une branche de ProductGroup,
  // jamais imbriqué plus loin qu'un cran).
  function withQuotientDenominatorAtPath(side, path, newDenominatorTerms) {
    return side.map(function (n, i) {
      if (i !== path[0]) return cloneNode(n);
      return { sign: n.sign, factorTerms: newDenominatorTerms.map(cloneNode), innerTerms: n.innerTerms.map(cloneNode), isDivision: true };
    });
  }

  // Résout, pour un `pending.drilled` (history.js) donné, quel tableau de Node[] est
  // actuellement "en cours d'édition" une fois `groupNode` déjà résolu via nodeAtPath :
  // l'intérieur d'un FactorGroup classique (innerTerms, cas normal), les termes d'UNE
  // branche de ProductGroup (d.branch, voir withProductBranchAtPath), ou le dénominateur-
  // expression d'une fraction (d.part==='den', voir withQuotientDenominatorAtPath) — les
  // trois se comportent identiquement pour Simplifier/Factoriser/Développer/le
  // glisser-déposer (voir history.js ET toolbar.js, qui utilisent tous deux ceci), seule
  // la façon de RECONSTITUER le membre ensuite diffère (voir withDrilledArrayAtPath).
  function drilledWorkingArray(groupNode, d) {
    if (d.part === 'den') return groupNode.factorTerms;
    if (typeof d.branch === 'number') return groupNode.factors[d.branch].terms;
    return groupNode.innerTerms;
  }

  // Symétrique de drilledWorkingArray : reconstruit `side` avec `newArray` remis à sa place
  // (path/branch-ou-part de `d`).
  function withDrilledArrayAtPath(side, d, newArray) {
    if (d.part === 'den') return withQuotientDenominatorAtPath(side, d.path, newArray);
    if (typeof d.branch === 'number') return withProductBranchAtPath(side, d.path, d.branch, newArray);
    return withGroupInnerTermsAtPath(side, d.path, newArray);
  }

  // Remplace les termes du facteur d'INDICE `branch` du ProductGroup situé à `path`
  // (toujours un seul niveau, path.length===1 — voir pending.drilled.branch dans
  // history.js : à la différence d'un FactorGroup, on ne descend pas plus profond qu'une
  // parenthèse d'un produit, ses termes y sont supposés plats) par `newBranchTerms`. Une
  // seule copie des termes par facteur (voir modèle de données en tête de fichier) : plus
  // besoin de mirroring particulier pour un facteur répété (ex. "(...)²"), contrairement à
  // l'ancien isSquare qui dupliquait left/right.
  function withProductBranchAtPath(side, path, branch, newBranchTerms) {
    return side.map(function (n, i) {
      if (i !== path[0]) return cloneNode(n);
      var newFactors = n.factors.map(function (f, idx) {
        return idx === branch ? { terms: newBranchTerms.map(cloneNode), exponent: f.exponent } : cloneFactor(f);
      });
      return { sign: n.sign, factors: newFactors };
    });
  }

  App.Expr = {
    isFactorGroup: isFactorGroup,
    isProductGroup: isProductGroup,
    isSquareFactorGroup: isSquareFactorGroup,
    isGroup: isGroup,
    isExpressionQuotient: isExpressionQuotient,
    sideHasVariable: sideHasVariable,
    wrapSideInProduct: wrapSideInProduct,
    canonicalizeFactors: canonicalizeFactors,
    cloneFactor: cloneFactor,
    nodeSign: nodeSign,
    cloneTerm: cloneTerm,
    cloneNode: cloneNode,
    cloneSide: cloneSide,
    roundClean: roundClean,
    formatNumberLatex: formatNumberLatex,
    formatNumberPlain: formatNumberPlain,
    formatOperandPlain: formatOperandPlain,
    nodeLatex: nodeLatex,
    termLatexBody: termLatexBody,
    sideLatex: sideLatex,
    operandLatex: operandLatex,
    addTermToSide: addTermToSide,
    multiplySide: multiplySide,
    wrapSideInFactor: wrapSideInFactor,
    wrapSideInFraction: wrapSideInFraction,
    simplifyNodes: simplifyNodes,
    factorNodes: factorNodes,
    factorRemarkableIdentityChoice: factorRemarkableIdentityChoice,
    factorDifferenceOfSquaresFromGroup: factorDifferenceOfSquaresFromGroup,
    factorDifferenceOfTwoSquareGroups: factorDifferenceOfTwoSquareGroups,
    innerTermsLatex: innerTermsLatex,
    groupSlotLatex: groupSlotLatex,
    withProductBranchAtPath: withProductBranchAtPath,
    factorNodesRaw: factorNodesRaw,
    expandFactorGroup: expandFactorGroup,
    combineTermsByPow: combineTermsByPow,
    expandProductGroup: expandProductGroup,
    expandProductFactorSubset: expandProductFactorSubset,
    sideIsSingleTerm: sideIsSingleTerm,
    flattenProductFactors: flattenProductFactors,
    sidesEquivalent: sidesEquivalent,
    nodeAtPath: nodeAtPath,
    withGroupInnerTermsAtPath: withGroupInnerTermsAtPath,
    withQuotientDenominatorAtPath: withQuotientDenominatorAtPath,
    wrapSideInQuotient: wrapSideInQuotient,
    drilledWorkingArray: drilledWorkingArray,
    withDrilledArrayAtPath: withDrilledArrayAtPath
  };
})(window.App = window.App || {});
