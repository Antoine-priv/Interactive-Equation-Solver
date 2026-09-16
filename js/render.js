/* Rendu DOM de l'historique des équations (lignes + termes cliquables). */
(function (App) {
  'use strict';
  var Expr = App.Expr;
  var rowSeq = 0;
  // Suivi PAR MOTEUR (primary, ou chaque moteur de branche) de l'identité du dernier step
  // centré à l'écran — PAS une simple valeur globale unique : cliquer pour focaliser une
  // AUTRE colonne change `scrollIdentity` (le dernier step de CETTE branche, un objet
  // forcément différent de celui de la branche précédente) sans qu'aucun step n'ait
  // réellement été ajouté nulle part — avec une valeur globale unique, ce simple
  // changement de focus déclenchait donc à tort un recentrage (« saut » de la page à
  // chaque clic sur une colonne). En gardant la dernière valeur vue POUR CHAQUE MOTEUR
  // séparément (clé = référence du moteur, stable tant qu'on ne re-scinde pas), on ne
  // recentre que lorsque CE moteur précis avance vraiment d'une étape — jamais pour un
  // simple changement de focus entre des branches déjà affichées.
  var lastCenteredStepByEngine = new WeakMap();
  // Suivi PAR MOTEUR (même principe que lastCenteredStepByEngine ci-dessus) de la
  // présence, au dernier rendu, d'un aperçu "pending" (voir isNewPendingPreview dans
  // renderChain) : la ligne "pending" est entièrement reconstruite à CHAQUE rendu, donc
  // sans cette mémoire son animation d'apparition (voir .preview-pop-in dans style.css)
  // rejouerait à tort dès qu'un rendu est redéclenché sans que la ligne vienne de RÉELLEMENT
  // apparaître — notamment survoler "Opération" PUIS cliquer dessus (voir selectOp dans
  // history.js), qui affiche exactement la même ligne sous deux valeurs différentes de
  // pending.opType, ou taper un caractère de plus dans la chaîne "Opération"/le facteur
  // commun de "Factoriser" (setExprChainText/setFactorTermLatex), qui reconstruit la ligne
  // avec un CONTENU différent (le résultat prévisualisé change) sans que la ligne, elle,
  // vienne d'apparaître. Seul un vrai passage "pas de ligne pending" -> "ligne pending"
  // (donc `false` -> `true` ci-dessous) rejoue l'animation, jamais un simple changement de
  // contenu pendant qu'elle reste continûment affichée — un mode déjà engagé ('expr'/
  // 'factor') bloque de toute façon tout autre bouton tant qu'il n'est pas annulé/validé
  // (voir initToolbar dans toolbar.js), donc CE passage à `false` (pending redevenu null)
  // est bien systématique avant qu'un nouvel aperçu, réellement distinct, puisse apparaître.
  var lastPendingShownByEngine = new WeakMap();
  // Vrai UNIQUEMENT pendant le TOUT PREMIER appel à renderAll() — le rendu de montage,
  // déclenché par App.History.init() juste après le chargement de la page (voir
  // DOMContentLoaded dans main.js). Capturé une fois dans une variable LOCALE en tête de
  // renderAll (voir wasInitialMount plus bas, jamais relu depuis cette variable-ci une
  // fois capturé) puis retombe à `false` — closures obligent, tout code planifié via
  // requestAnimationFrame DEPUIS ce premier appel (positionPanel, le recentrage "smooth")
  // continue de voir la valeur `true` qu'il a capturée, même une fois ce module-ci déjà
  // retombé à `false` pour de bon. Consulté pour que ce tout premier rendu affiche
  // directement sa mise en page finale (équation déjà centrée, fenêtre d'action déjà en
  // place) sans aucune des animations normalement jouées lors d'un changement d'état réel —
  // rien n'a "changé" aux yeux de l'utilisateur puisqu'il n'a encore rien vu du tout.
  var isInitialMount = true;
  // Largeur du scroller au moment du dernier recentrage horizontal (voir plus bas) : une
  // scission ("Produit nul"/"Racine carrée") utilise un scrollLeft ABSOLU calculé une
  // fois, alors que .produit-nul-split (voir style.css) se repositionne tout seul en
  // pixels à chaque redimensionnement de fenêtre via son padding de 50vw — sans ce
  // suivi, un redimensionnement APRÈS le recentrage initial (fenêtre agrandie/réduite,
  // ouverture des DevTools...) désynchronise silencieusement scrollLeft de "où sont
  // vraiment les colonnes à l'écran", les laissant décalées jusqu'à la prochaine étape.
  var lastCenteredWidth = null;
  // Même principe que lastCenteredWidth ci-dessus, mais pour le zoom (App.Canvas.getScale,
  // voir canvas.js) : columnsNaturalWidth/offsetWidth sont mesurés dans le repère LOCAL de
  // #canvasLayer (jamais affecté par sa propre mise à l'échelle CSS), alors que
  // scroller.clientWidth est un repère ÉCRAN — un zoom seul (sans redimensionnement de
  // fenêtre) peut donc, comme un redimensionnement, faire basculer isWideSplit ou
  // désynchroniser le scrollLeft absolu d'une scission "large" de la position réellement
  // visible des colonnes.
  var lastCenteredScale = null;
  // Vrai si le dernier rendu était en mise en page "large" (voir isWideSplit plus bas) —
  // sert UNIQUEMENT à détecter une VRAIE transition large -> tient (voir splitNoLongerWide
  // plus bas), jamais un simple état courant : depuis le passage à la toile "infinie"
  // (App.Canvas dans canvas.js, dont l'offset horizontal n'est plus jamais borné à 0),
  // "pas large ET un panorama horizontal non nul" est aussi, et même bien plus souvent,
  // le signe d'un panorama VOLONTAIRE de l'utilisateur qu'un résidu de redimensionnement —
  // sans cette distinction, N'IMPORTE QUEL rendu (ex. simplement survoler un bouton
  // "Opération", ou sélectionner un terme) annulait à tort ce panorama.
  var wasWideSplit = false;

  // Liseré de focus des colonnes "Produit nul"/"Racine carrée" (.branch-focused, voir
  // style.css) : purement visuel, INDÉPENDANT de `focusedBranch` dans history.js (qui
  // continue, lui, de router clavier/pavé/sélection exactement comme avant — cliquer en
  // dehors ne change JAMAIS quelle colonne est réellement active, seulement si son liseré
  // est affiché). Cliquer une colonne, à n'importe quelle profondeur d'imbrication
  // (toutes partagent la classe .produit-nul-branch, voir initBranchOutlineDismissal plus
  // bas), le fait aussitôt réapparaître.
  var branchOutlineVisible = true;
  // Vrai si le dernier rendu avait des branches — sert uniquement à détecter une VRAIE
  // nouvelle scission (transition null -> branches) pour réafficher le liseré par défaut
  // (voir renderAll) : sans ça, une scission ultérieure après un premier clic "en dehors"
  // apparaîtrait à tort sans son liseré initial.
  var hadBranches = false;

  // Incrémenté à CHAQUE appel de renderAll (voir son tout début) : les callbacks
  // différés via requestAnimationFrame plus bas capturent la valeur courante et se
  // désactivent d'eux-mêmes (voir isStaleRender) si un rendu PLUS RÉCENT a eu lieu entre
  // leur planification et leur exécution — sinon un rAF "périmé" peut s'exécuter APRÈS
  // celui d'un rendu plus récent (les deux dans la même frame, ordre d'enregistrement)
  // et appliquer un état obsolète par-dessus le résultat correct. Concrètement observé
  // sur #liveOpPill (voir positionLiveField dans arrows.js) : contrairement aux flèches/
  // étiquettes (qui se nettoient elles-mêmes à CHAQUE appel de drawAll, donc résistent
  // déjà à ce genre de course), masquer le pavé live est un appel SYNCHRONE côté
  // renderAll (hideLiveOpPill, si le rendu n'a rien de "live" cette fois-ci) alors que
  // l'afficher/le repositionner est DIFFÉRÉ (dans ce même rAF) — un rAF périmé encore
  // "live" peut donc réafficher le pavé juste après qu'un rendu plus récent (ex. une
  // confirmation) l'ait masqué, avec son ANCIEN contenu. Reproductible via Playwright
  // (survol resté "coincé" sur "Opération" faute de mouvement de souris réel entre deux
  // clics, voir tests/expr_live_pill.js) — improbable en usage réel (un vrai déplacement
  // de souris laisse toujours au moins une frame entre les deux), mais un vrai bug de
  // logique, pas qu'un artefact de test.
  var renderSeq = 0;

  // Même logique que son homonyme dans toolbar.js (chaque fichier lit sa propre valeur,
  // pas de couplage entre les deux) : passe directement au comportement final sans le
  // fondu ci-dessous quand l'utilisateur a demandé de réduire les animations.
  var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Etiquette d'opération en LaTeX (comme les équations) : mêmes x, mêmes signes,
  // même police, plutôt que la police système du texte brut.
  var OP_SYMBOL_LATEX = { '+': '+', '-': '-', '×': '\\times\\,', '÷': '\\div\\,' };

  // Corps LaTeX (sans le préfixe "développer ") d'un desc 'expand' — partagé entre
  // l'étiquette standalone et 'expandMulti' (plusieurs groupes développés en une seule
  // étape, voir confirmExpandFullSelection dans history.js).
  function expandDescBody(desc) {
    if (!desc.factor || !desc.terms || desc.terms.length === 0) return null;
    // Un terme développé peut lui-même être un groupe imbriqué (ex. "3(-2)") : nodeLatex
    // gère déjà correctement les deux cas et leur signe.
    var innerLatex = desc.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('');
    if (desc.isDivision) {
      return '\\frac{' + innerLatex + '}{' + Expr.termLatexBody(desc.factor) + '}';
    }
    var factorBody = Expr.termLatexBody(desc.factor);
    return factorBody + '\\left(' + innerLatex + '\\right)';
  }

  // Même principe qu'expandDescBody, pour un desc 'expandProduct' (développement complet
  // d'un ProductGroup, OU développement PARTIEL d'un sous-ensemble de ses facteurs — voir
  // Expr.expandProductFactorSubset — les deux partagent la même forme de desc).
  function expandProductDescBody(desc) {
    if (!desc.factors) return null;
    return desc.factors.map(function (f) {
      var slot = '\\left(' + f.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('') + '\\right)';
      return f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
    }).join('');
  }

  // Multiplier OU diviser les deux membres par une expression qui dépend de x (op.terms,
  // voir wrapSideInProduct/wrapSideInQuotient) n'est valide/défini que si cette expression
  // est non nulle : voir le rappel ajouté dans formatOpLabel et .arrow-label-warning
  // ci-dessous. Un multiplicateur/diviseur purement numérique (op.rawValue, pas de
  // op.terms) n'a pas ce problème.
  function isZeroRiskOp(op) {
    return (op.symbol === '×' || op.symbol === '÷') && !!op.terms && Expr.sideHasVariable(op.terms);
  }
  function descHasZeroRisk(desc) {
    return !!desc && desc.type === 'expr' && !!desc.ops && desc.ops.some(isZeroRiskOp);
  }

  // Corps LaTeX de la réserve ("valide si (x)≠0", potentiellement plusieurs conditions
  // jointes par "et") pour un desc 'expr' — partagé entre formatOpLabel (qui l'ajoute à la
  // fin de la chaîne complète) et le pavé "live" de la ligne "pending" (voir
  // liveWarnLatex dans renderChain), qui l'affiche séparément SOUS le <math-field>
  // éditable plutôt que dans le même texte (impossible d'ajouter du texte figé à
  // l'intérieur d'un champ éditable). Renvoie null si aucune opération à risque.
  function exprRiskyConditionsLatex(desc) {
    if (!descHasZeroRisk(desc)) return null;
    var riskyOperands = [];
    desc.ops.forEach(function (op) {
      if (!isZeroRiskOp(op)) return;
      var exprOperandLatex = op.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('');
      var isBareMonomial = op.terms.length === 1 && !Expr.isGroup(op.terms[0]);
      riskyOperands.push({ latex: exprOperandLatex, bare: isBareMonomial });
    });
    var conditions = riskyOperands.map(function (r) {
      return (r.bare ? r.latex : '\\left(' + r.latex + '\\right)') + '\\neq0';
    }).join('\\text{ et }');
    return '\\text{valide si }' + conditions;
  }

  function formatOpLabel(desc) {
    if (!desc) return null;
    if (desc.type === 'simplify') {
      if (!desc.terms || desc.terms.length === 0) return '\\text{simplifier}';
      var simplifiedLatex = desc.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('');
      return '\\text{simplifier }' + simplifiedLatex;
    }
    if (desc.type === 'expand') {
      var bodyExp = expandDescBody(desc);
      return bodyExp === null ? '\\text{développer}' : '\\text{développer }' + bodyExp;
    }
    if (desc.type === 'expandProduct') {
      var bodyDev = expandProductDescBody(desc);
      return bodyDev === null ? '\\text{développer}' : '\\text{développer }' + bodyDev;
    }
    // Plusieurs groupes développés en une seule étape sur le même membre (ex. "(x-6)²"
    // développé en entier ET, indépendamment, seul le facteur au carré d'un AUTRE produit
    // du même membre — voir computeExpandTargets/applyExpandTargets dans history.js) :
    // une seule flèche/étiquette combinant chaque partie, plutôt qu'une par groupe.
    if (desc.type === 'expandMulti') {
      if (!desc.parts || desc.parts.length === 0) return '\\text{développer}';
      var bodies = desc.parts.map(function (part) {
        return part.type === 'expand' ? expandDescBody(part) : expandProductDescBody(part);
      }).filter(function (b) { return b !== null; });
      if (bodies.length === 0) return '\\text{développer}';
      return '\\text{développer }' + bodies.join('\\text{ et }');
    }
    if (desc.type === 'produitnul') {
      return '\\text{produit nul}';
    }
    if (desc.type === 'sqrt') {
      // "Racine carrée" quand elle ne scinde pas en plusieurs branches (racine de 0, voir
      // confirmSquareRoot/pushStep dans history.js) : même symbole que l'étiquette de la
      // fourche (splitIntoBranches), mais rendu comme une étape normale à deux flèches.
      return '\\sqrt{\\phantom{x}}';
    }
    if (desc.type === 'factor') {
      if (!desc.factor) return '\\text{factoriser}';
      // Facteur commun d'une somme de ProductGroup (voir Expr.factorCommonProductFactor) :
      // desc.factor est alors une EXPRESSION (Side), pas un simple Term — groupSlotLatex
      // l'entoure de parenthèses si elle compte plusieurs termes, comme un facteur normal
      // de ProductGroup.
      var factorBody = Array.isArray(desc.factor) ? Expr.groupSlotLatex(desc.factor) : Expr.operandLatex(desc.factor);
      return '\\text{factoriser par }' + factorBody;
    }
    if (desc.type === 'factorIdentity') {
      // Identité remarquable choisie explicitement (voir chooseFactorMode dans
      // history.js) : rappelle la forme ET les valeurs a/b saisies, plutôt qu'un simple
      // "factoriser par N" — pédagogiquement plus clair sur CE qui vient d'être reconnu.
      // Seul le champ reconnu comme portant le x (desc.aIsX, voir parseIdentityAB dans
      // history.js) s'affiche comme un coefficient de x (ex. "2x", ou juste "x" si 1) —
      // l'AUTRE reste un simple nombre, quel que soit lequel des deux c'est.
      var idForms = { 1: '(a+b)^2', 2: '(a-b)^2', 3: '(a-b)(a+b)' };
      var idForm = idForms[desc.identityType] || '';
      function idValLatex(val, isX) {
        if (!isX) return Expr.formatNumberLatex(val);
        return Expr.roundClean(val) === 1 ? 'x' : Expr.formatNumberLatex(val) + 'x';
      }
      // Cas "(expr)²-constante" (ex. (x+8)²-4, voir factorDifferenceOfSquaresFromGroup et
      // pending.idGroupBase dans history.js) : "a" est une expression déjà factorisée
      // (desc.aExpr, Node[]), pas un simple nombre — s'affiche via innerTermsLatex.
      // "(x-2)²-(x+6)²" etc. : "a" ET "b" sont chacun une expression (desc.bExpr en plus
      // de desc.aExpr, voir factorDifferenceOfTwoSquareGroups dans expression.js).
      if (desc.aExpr && desc.bExpr) {
        return '\\text{identité remarquable }' + idForm + '\\text{ : }a=' +
          Expr.innerTermsLatex(desc.aExpr) + ',\\ b=' + Expr.innerTermsLatex(desc.bExpr);
      }
      if (desc.aExpr) {
        return '\\text{identité remarquable }' + idForm + '\\text{ : }a=' +
          Expr.innerTermsLatex(desc.aExpr) + ',\\ b=' + idValLatex(desc.b, false);
      }
      return '\\text{identité remarquable }' + idForm + '\\text{ : }a=' +
        idValLatex(desc.a, desc.aIsX) + ',\\ b=' + idValLatex(desc.b, !desc.aIsX);
    }
    if (desc.type === 'expr') {
      if (!desc.ops || desc.ops.length === 0) return null;
      // Chaque opération garde son propre signe explicite, y compris la première (+5-2x×3).
      var chainLatex = desc.ops.map(function (op) {
        if (op.terms) {
          // Multiplication par une expression (ex. "×(x+5)"), voir wrapSideInProduct. Un
          // multiplicateur réduit à un seul terme "plat" (ex. "5x²", pas une somme ni un
          // groupe) n'a besoin d'aucune parenthèse pour rester lisible — comme un
          // multiplicateur numérique pur (ex. "×-5" juste en dessous) : seule une VRAIE
          // somme risquerait de se confondre avec l'opération suivante de la chaîne (ex.
          // "×(x+5)" vs "×x+5").
          var exprOperandLatex = op.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('');
          var isBareMonomial = op.terms.length === 1 && !Expr.isGroup(op.terms[0]);
          return OP_SYMBOL_LATEX[op.symbol] + (isBareMonomial ? exprOperandLatex : '\\left(' + exprOperandLatex + '\\right)');
        }
        if (op.symbol === '×' || op.symbol === '÷') {
          // formatNumberLatex renvoie une valeur absolue : le signe du multiplicateur/
          // diviseur (±) se rajoute ici séparément.
          return OP_SYMBOL_LATEX[op.symbol] + (op.rawValue < 0 ? '-' : '') + Expr.formatNumberLatex(op.rawValue);
        }
        return Expr.nodeLatex(op.term, false);
      }).join('');
      // La réserve ("valide si ...", voir exprRiskyConditionsLatex) est accumulée à part et
      // rajoutée à la fin, APRÈS la chaîne complète (jamais entre deux opérations : sinon un
      // "+2" venant après un "×(x)" à risque se lirait, à tort, comme collé à la réserve
      // elle-même plutôt qu'à la chaîne — ex. "×(x) valide si (x)≠0+2").
      var riskyConditions = exprRiskyConditionsLatex(desc);
      if (riskyConditions) chainLatex += '\\ ' + riskyConditions;
      return chainLatex;
    }
    return null;
  }

  function escId(id) {
    return window.CSS && CSS.escape ? CSS.escape(id) : id;
  }

  // Rendu spécial d'un FactorGroup dans lequel on est "entré" (voir pending.drilled dans
  // history.js), à n'importe quelle profondeur d'imbrication : `remainingPath` restant à
  // parcourir depuis `node` jusqu'au niveau le plus profond (celui réellement
  // sélectionnable en ce moment). Au niveau le plus profond (remainingPath vide), chaque
  // terme intérieur reçoit son PROPRE htmlId (cliquable individuellement) au lieu d'un
  // bloc opaque ; aux niveaux intermédiaires, seul le terme sur le chemin est développé
  // récursivement, ses frères restent des blocs opaques normaux. Le "\left(...\right)"
  // du niveau le plus profond reste un bloc KaTeX unique (obligatoire pour l'appariement
  // des délimiteurs) mais porte lui-même un id "-exit" : cliquer dans la parenthèse sans
  // viser un terme précis en ressort d'UN niveau (voir onExitDrill).
  function drilledGroupLatex(node, idPrefix, topIdx, remainingPath, isFirst, branch) {
    var isLeaf = remainingPath.length === 0;
    var innerLatex;
    if (isLeaf) {
      // Un terme intérieur qui est LUI-MÊME un ProductGroup à >=2 facteurs (ex.
      // "(x+5)²(x-1)" trouvé dans le numérateur d'une fraction) reçoit en plus le
      // marquage par facteur de productGroupBranchesLatex (\htmlId "...-inner-i-factor-j"),
      // câblé plus bas dans renderSide pour permettre de glisser SES facteurs
      // individuellement — jusqu'ici seul le bloc entier était déplaçable/sélectionnable.
      innerLatex = node.innerTerms.map(function (t, i) {
        var body = Expr.isProductGroup(t) && t.factors.length >= 2
          ? productGroupBranchesLatex(t, idPrefix + '-' + topIdx + '-inner-' + i, i === 0)
          : Expr.nodeLatex(t, i === 0);
        return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + i + '}{' + body + '}';
      }).join('');
    } else {
      var childIdx = remainingPath[0];
      innerLatex = node.innerTerms.map(function (t, i) {
        if (i !== childIdx) return Expr.nodeLatex(t, i === 0);
        // Dernier saut du chemin ET la cible est un ProductGroup dont on a précisément
        // "drillé" UN facteur (pending.drilled.branch, voir drillIntoNestedProductBranch
        // dans history.js) : bascule sur le rendu "branche" plutôt que de continuer la
        // récursion FactorGroup (qui suppose toujours un FactorGroup classique). Mêmes
        // idPrefix/topIdx qu'au niveau le plus haut — un seul "feuille" est jamais rendue
        // à la fois, aucun risque de collision d'id.
        if (remainingPath.length === 1 && typeof branch === 'number' && Expr.isProductGroup(t)) {
          return drilledProductBranchLatex(t, idPrefix, topIdx, branch, i === 0);
        }
        return drilledGroupLatex(t, idPrefix, topIdx, remainingPath.slice(1), i === 0, branch);
      }).join('');
    }
    var body;
    if (node.isDivision) {
      // Dénominateur-EXPRESSION (factorTerms, voir isExpressionQuotient) : rendu en
      // lecture seule ici, comme un bloc opaque normal — on est entré dans le NUMÉRATEUR
      // (innerTerms), pas dans le dénominateur (voir drillIntoQuotientDenominator, qui
      // passe par drilledQuotientDenominatorLatex à la place pour CE cas-là).
      var denomLatex = node.factorTerms ? Expr.innerTermsLatex(node.factorTerms) : Expr.termLatexBody(node.factor);
      var frac = '\\frac{' + innerLatex + '}{' + denomLatex + '}';
      body = isLeaf ? '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{' + frac + '}' : frac;
    } else {
      var factorBody = node.factor ? Expr.termLatexBody({ coeff: node.factor.coeff, pow: node.factor.pow }) : '';
      var parens = '\\left(' + innerLatex + '\\right)';
      body = factorBody + (isLeaf ? '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{' + parens + '}' : parens);
    }
    var sign = node.sign < 0 ? '-' : '+';
    if (isFirst) return (sign === '-' ? '-' : '') + body;
    return ' ' + sign + ' ' + body;
  }

  // Variante de drilledGroupLatex utilisée UNIQUEMENT pendant un glisser en cours à
  // l'intérieur d'une parenthèse (voir attachPointerDrag/reflowDragSide plus bas) : au
  // niveau le plus profond, les termes intérieurs sont pris dans `orderedLeaf` (l'ordre en
  // cours de glisser, pas `node.innerTerms`) et tagués avec des ids temporaires "dragpv-i"
  // (au lieu des ids réels "-inner-i"/"-exit", pas utiles ici — ce rendu est jeté au
  // prochain reflow ou remplacé par le rendu normal une fois le glisser terminé). Aucun id
  // aux niveaux intermédiaires/racine : inutile, seuls les "dragpv-i" sont interrogés.
  function drilledGroupLatexForOrder(node, remainingPath, orderedLeaf, isFirst, branch) {
    var isLeaf = remainingPath.length === 0;
    var innerLatex;
    if (isLeaf) {
      innerLatex = orderedLeaf.map(function (t, i) {
        return '\\htmlId{dragpv-' + i + '}{' + Expr.nodeLatex(t, i === 0) + '}';
      }).join('');
    } else {
      var childIdx = remainingPath[0];
      innerLatex = node.innerTerms.map(function (t, i) {
        if (i !== childIdx) return Expr.nodeLatex(t, i === 0);
        if (remainingPath.length === 1 && typeof branch === 'number' && Expr.isProductGroup(t)) {
          return drilledProductBranchLatexForOrder(t, branch, orderedLeaf, i === 0);
        }
        return drilledGroupLatexForOrder(t, remainingPath.slice(1), orderedLeaf, i === 0, branch);
      }).join('');
    }
    var body;
    if (node.isDivision) {
      var denomLatexForOrder = node.factorTerms ? Expr.innerTermsLatex(node.factorTerms) : Expr.termLatexBody(node.factor);
      body = '\\frac{' + innerLatex + '}{' + denomLatexForOrder + '}';
    } else {
      var factorBody = node.factor ? Expr.termLatexBody({ coeff: node.factor.coeff, pow: node.factor.pow }) : '';
      body = factorBody + '\\left(' + innerLatex + '\\right)';
    }
    var sign = node.sign < 0 ? '-' : '+';
    if (isFirst) return (sign === '-' ? '-' : '') + body;
    return ' ' + sign + ' ' + body;
  }

  // Deux facteurs "nus" adjacents d'un produit (sans parenthèse ni exposant les délimitant)
  // se liraient comme collés si le second commence par un chiffre — soit un seul nombre
  // ("25" puis "5" -> "255" au lieu de "25 fois 5", ex. après avoir multiplié un membre par
  // "5(x+13)", voir operandFactors dans expression.js), soit une variable qui n'existe pas
  // ("x" puis "5" -> "x5"). Un "\cdot" explicite lève l'ambiguïté ; l'ordre inverse (chiffre
  // puis "x", ex. "5x") reste la notation habituelle d'un coefficient, pas concerné ici. Un
  // exposant (f.exponent>1) sur le facteur précédent protège déjà visuellement (l'exposant
  // se lit en indice supérieur, jamais confondu avec le facteur suivant) : seul le cas
  // exponent===1 est testé. Même logique que le "ALNUM_END_RE" de nodeLatex (Expr), mais
  // ici sur le rendu déjà wrappé en \htmlId — appliquée AVANT le wrap, sur le texte
  // visuellement rendu de chaque facteur, jamais sur le marquage \htmlId{...} lui-même (qui
  // se termine toujours par "}", jamais par le vrai dernier caractère visible).
  var FACTOR_ALNUM_END_RE = /[0-9A-Za-z]$/;
  function needsCdotBetweenFactors(prevRendered, prevExponent, nextRendered) {
    return prevExponent === 1 && FACTOR_ALNUM_END_RE.test(prevRendered) && /^[0-9]/.test(nextRendered);
  }

  // Rendu (non "drillé") d'un ProductGroup, au premier niveau OU niché dans un membre
  // drillé (voir drilledGroupLatex plus bas, qui lui passe un idBase différent) : comme
  // Expr.nodeLatex, mais chaque facteur porte en plus un attribut data-branch="0"/"1"/...
  // (via \htmlData) ET son propre \htmlId ("idBase-factor-i") — le premier sert à
  // retrouver dans quel facteur précis un clic/double-clic a physiquement atterri (voir
  // attachPointerDrag/selectDragOptions plus bas), pour "driller" dedans
  // (pending.drilled.branch, voir history.js — UNIQUEMENT au premier niveau : un produit
  // niché ne supporte que le glisser, voir plus bas) ; le second permet, APRÈS ce même
  // appel KaTeX, de retrouver CE facteur précis par id pour lui appliquer une classe
  // "sélectionné" — voir toggleFactorSelection/pending.selectedFactors dans history.js et
  // le câblage juste après renderSide plus bas : un produit d'au moins 2 facteurs a chacune
  // de ses parenthèses individuellement sélectionnable pour un développement partiel (ex.
  // sélectionner "(x-5)" et "(x+2)" dans "(x²-10x+25)(x-5)(x+2)" pour les développer entre
  // elles, sans toucher au 1er facteur) — niché, seul le glisser est câblé, data-branch y
  // reste sans effet (rien ne le lit dans ce contexte).
  function productGroupBranchesLatex(node, idBase, isFirst) {
    var innerRendered = node.factors.map(function (f) { return Expr.groupSlotLatex(f.terms); });
    var bodyP = '';
    node.factors.forEach(function (f, i) {
      if (i > 0 && needsCdotBetweenFactors(innerRendered[i - 1], node.factors[i - 1].exponent, innerRendered[i])) {
        bodyP += '\\cdot ';
      }
      var inner = '\\htmlData{branch=' + i + '}{' + innerRendered[i] + '}';
      var slot = '\\htmlId{' + idBase + '-factor-' + i + '}{' + inner + '}';
      bodyP += f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
    });
    var signP = node.sign < 0 ? '-' : '+';
    if (isFirst) return (signP === '-' ? '-' : '') + bodyP;
    return ' ' + signP + ' ' + bodyP;
  }

  // Rendu "drillé" du facteur d'INDICE `branch` d'un ProductGroup (pending.drilled.branch,
  // voir history.js) : pendant qu'on l'étudie, ses termes reçoivent chacun leur propre
  // htmlId ("-inner-i"/"-exit", MÊMES suffixes que drilledGroupLatex — câblés par le même
  // code plus bas dans renderSide, sans distinction FactorGroup/ProductGroup à cet endroit).
  // Contrairement à drilledGroupLatex, une seule profondeur : les termes d'une parenthèse
  // de produit sont supposés plats (voir toggleInnerSelection/drillIntoProductBranch dans
  // history.js, qui n'y autorisent pas de second niveau de "drill"). Les AUTRES facteurs,
  // à leur position d'origine, restent des blocs opaques normaux, non cliquables.
  function drilledProductBranchLatex(node, idPrefix, topIdx, branch, isFirst) {
    var rendered = node.factors.map(function (f, i) {
      if (i !== branch) return Expr.groupSlotLatex(f.terms);
      var activeLatex = f.terms.map(function (t, j) {
        return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
      }).join('');
      return '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{\\left(' + activeLatex + '\\right)}';
    });
    var bodyP = '';
    node.factors.forEach(function (f, i) {
      if (i > 0 && needsCdotBetweenFactors(rendered[i - 1], node.factors[i - 1].exponent, rendered[i])) {
        bodyP += '\\cdot ';
      }
      bodyP += f.exponent === 1 ? rendered[i] : rendered[i] + '^{' + f.exponent + '}';
    });
    var signP = node.sign < 0 ? '-' : '+';
    if (isFirst) return (signP === '-' ? '-' : '') + bodyP;
    return ' ' + signP + ' ' + bodyP;
  }

  // Variante de drilledProductBranchLatex utilisée PENDANT un glisser en cours à
  // l'intérieur du facteur `branch` d'un ProductGroup (voir buildInnerDragLatex plus bas) :
  // les termes du facteur actif viennent de `orderedLeaf` (l'ordre en cours de glisser, pas
  // factors[branch].terms), tagués avec des ids temporaires "dragpv-i" (même principe que
  // drilledGroupLatexForOrder) — les AUTRES facteurs restent des blocs opaques normaux,
  // aucun id dessus (inutile, jamais interrogé ici).
  function drilledProductBranchLatexForOrder(node, branch, orderedLeaf, isFirst) {
    var rendered = node.factors.map(function (f, i) {
      if (i !== branch) return Expr.groupSlotLatex(f.terms);
      var activeLatex = orderedLeaf.map(function (t, j) {
        return '\\htmlId{dragpv-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
      }).join('');
      return '\\left(' + activeLatex + '\\right)';
    });
    var bodyP = '';
    node.factors.forEach(function (f, i) {
      if (i > 0 && needsCdotBetweenFactors(rendered[i - 1], node.factors[i - 1].exponent, rendered[i])) {
        bodyP += '\\cdot ';
      }
      bodyP += f.exponent === 1 ? rendered[i] : rendered[i] + '^{' + f.exponent + '}';
    });
    var signP = node.sign < 0 ? '-' : '+';
    if (isFirst) return (signP === '-' ? '-' : '') + bodyP;
    return ' ' + signP + ' ' + bodyP;
  }

  // Rendu "drillé" du DÉNOMINATEUR-EXPRESSION d'une fraction (pending.drilled.part==='den',
  // voir isExpressionQuotient/drillIntoQuotientDenominator dans history.js) : même principe
  // que drilledProductBranchLatex (une seule profondeur, ses termes reçoivent chacun leur
  // "-inner-j", le tout enveloppé d'un "-exit" pour ressortir) mais sur node.factorTerms. Le
  // NUMÉRATEUR (node.innerTerms), lui, reste un bloc opaque normal — on est "entré" dans le
  // dénominateur, pas dans lui.
  function drilledQuotientDenominatorLatex(node, idPrefix, topIdx, isFirst) {
    var numLatex = Expr.innerTermsLatex(node.innerTerms);
    var activeLatex = node.factorTerms.map(function (t, j) {
      return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
    }).join('');
    var body = '\\frac{' + numLatex + '}{\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{' + activeLatex + '}}';
    var sign = node.sign < 0 ? '-' : '+';
    if (isFirst) return (sign === '-' ? '-' : '') + body;
    return ' ' + sign + ' ' + body;
  }

  // Variante de drilledQuotientDenominatorLatex utilisée PENDANT un glisser en cours dans le
  // dénominateur (voir buildInnerDragLatex plus bas) : même principe que
  // drilledProductBranchLatexForOrder, sur node.factorTerms.
  function drilledQuotientDenominatorLatexForOrder(node, orderedLeaf, isFirst) {
    var numLatex = Expr.innerTermsLatex(node.innerTerms);
    var activeLatex = orderedLeaf.map(function (t, j) {
      return '\\htmlId{dragpv-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
    }).join('');
    var body = '\\frac{' + numLatex + '}{' + activeLatex + '}';
    var sign = node.sign < 0 ? '-' : '+';
    if (isFirst) return (sign === '-' ? '-' : '') + body;
    return ' ' + sign + ' ' + body;
  }

  // Rendu "drillé" du RADICAND d'une racine carrée (SqrtGroup, pending.drilled.part
  // ==='sqrt', voir drillIntoSqrt dans history.js) : même principe que
  // drilledQuotientDenominatorLatex (une seule profondeur, ses termes reçoivent chacun leur
  // "-inner-j", le tout enveloppé d'un "-exit" pour ressortir) mais sur node.radicand — pas
  // de "numérateur" à côté, le "\sqrt{...}" entier EST le contenu drillé. Pas de champ
  // `sign` propre (voir Expr.nodeSign) : toujours rendu sans "-" devant.
  function drilledSqrtLatex(node, idPrefix, topIdx, isFirst) {
    var activeLatex = node.radicand.map(function (t, j) {
      return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
    }).join('');
    var body = '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{\\sqrt{' + activeLatex + '}}';
    return isFirst ? body : ' + ' + body;
  }

  // Variante de drilledSqrtLatex utilisée PENDANT un glisser en cours dans le radicand (voir
  // buildInnerDragLatex plus bas) : même principe que drilledQuotientDenominatorLatexForOrder.
  function drilledSqrtLatexForOrder(node, orderedLeaf, isFirst) {
    var activeLatex = orderedLeaf.map(function (t, j) {
      return '\\htmlId{dragpv-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
    }).join('');
    var body = '\\sqrt{' + activeLatex + '}';
    return isFirst ? body : ' + ' + body;
  }

  // Variante de productGroupBranchesLatex utilisée PENDANT un glisser en cours réordonnant
  // les FACTEURS eux-mêmes d'un ProductGroup de PREMIER NIVEAU, PAS drillé (voir
  // setFactorOrder dans history.js et escalateFactorDragToTopLevel plus bas) : chaque
  // facteur vient de `orderedFactors` (l'ordre en cours de glisser, pas node.factors) et
  // porte un id temporaire "dragpv-i" (même principe que drilledGroupLatexForOrder). Le
  // produit entier, lui, garde son id stable habituel ("idPrefix-topIdx") — pas juste par
  // souci de cohérence avec le rendu normal : updateTermDrag s'en sert pour mesurer les
  // bornes du produit à chaque mousemove et détecter que le curseur en est sorti (voir
  // escalateFactorDragToTopLevel, qui bascule alors le glisser sur le produit ENTIER, comme
  // un terme de premier niveau classique).
  // Corps (sans signe ni id englobant) d'un ProductGroup dont les facteurs viennent de
  // `orderedFactors` (l'ordre en cours de glisser) et portent chacun un id temporaire
  // "dragpv-i" — partagé entre productGroupFactorsLatexForOrder (produit de PREMIER NIVEAU)
  // et le glisser de facteurs d'un produit NICHÉ dans un membre drillé (voir
  // buildNestedFactorDragLatex plus bas dans renderSide).
  function factorsDragBodyLatex(orderedFactors) {
    var innerRendered = orderedFactors.map(function (f) { return Expr.groupSlotLatex(f.terms); });
    var bodyP = '';
    orderedFactors.forEach(function (f, i) {
      if (i > 0 && needsCdotBetweenFactors(innerRendered[i - 1], orderedFactors[i - 1].exponent, innerRendered[i])) {
        bodyP += '\\cdot ';
      }
      var slot = '\\htmlId{dragpv-' + i + '}{' + innerRendered[i] + '}';
      bodyP += f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
    });
    return bodyP;
  }

  function productGroupFactorsLatexForOrder(node, idPrefix, topIdx, orderedFactors, isFirst) {
    var signP = node.sign < 0 ? '-' : '+';
    var body = (isFirst ? (signP === '-' ? '-' : '') : ' ' + signP + ' ') + factorsDragBodyLatex(orderedFactors);
    return '\\htmlId{' + idPrefix + '-' + topIdx + '}{' + body + '}';
  }

  // Reconstruit TOUT le membre (même raison que buildInnerDragLatex plus haut : un seul
  // appel KaTeX, jamais un rendu imbriqué qui ferait grossir toute la ligne) pendant un
  // glisser réordonnant les facteurs du produit de PREMIER NIVEAU à `topIdx` — les AUTRES
  // noeuds de premier niveau restent inchangés (aucun id : inutile pendant ce glisser précis,
  // jeté au prochain reflow ou remplacé par le rendu normal une fois terminé).
  function buildFactorDragLatex(side, idPrefix, topIdx, orderedFactors) {
    return side.map(function (node, idx) {
      if (idx !== topIdx) return Expr.nodeLatex(node, idx === 0);
      return productGroupFactorsLatexForOrder(node, idPrefix, topIdx, orderedFactors, idx === 0);
    }).join('');
  }

  // Rend tout un membre en UN SEUL appel KaTeX (espacement natif LaTeX correct), chaque
  // noeud de premier niveau (Term ou groupe factorisé) tagué et cliquable pour la
  // sélection libre (simplifier/factoriser/développer) et/ou le glisser-déposer.
  // options.drilled : { path, branch, part, selectedInner:Set, onInnerClick, onExitDrill } —
  // le groupe à `path` (path[0] = index de premier niveau, path[1..] = descente dans les
  // innerTerms successifs — jamais utilisé avec `branch`/`part`, une seule profondeur là)
  // est alors rendu via drilledGroupLatex (FactorGroup), drilledProductBranchLatex
  // (ProductGroup + branch) ou drilledQuotientDenominatorLatex (fraction + part==='den'),
  // ses termes intérieurs les plus profonds sélectionnables individuellement, plutôt que
  // comme un bloc opaque.
  function renderSide(container, side, sideName, idPrefix, options) {
    container.innerHTML = '';
    container.setAttribute('data-side', sideName);

    var drilled = options && options.drilled;

    // Un clic visant le dénominateur-expression d'une fraction (\htmlData{fracpart=den},
    // voir Expr.nodeLatex) devrait normalement se détecter via targetEl.closest — SAUF que
    // la mise en page \vlist interne de KaTeX pour \frac place parfois, exactement au
    // centre géométrique du dénominateur, un strut invisible qui n'est PAS un descendant du
    // marqueur (sert uniquement à l'alignement vertical) et intercepte le point cliqué à sa
    // place. Repli géométrique : si l'ancêtre direct ne suffit pas, compare les coordonnées
    // du clic au rectangle réel du marqueur plutôt qu'à la chaîne DOM du point cliqué.
    function resolveIsDenPart(idx, targetEl, coords) {
      if (targetEl && targetEl.closest && targetEl.closest('[data-fracpart]')) return true;
      if (!coords) return false;
      var termEl = container.querySelector('#' + escId(idPrefix + '-' + idx));
      var fracEl = termEl && termEl.querySelector('[data-fracpart="den"]');
      if (!fracEl) return false;
      var r = fracEl.getBoundingClientRect();
      return coords.x >= r.left && coords.x <= r.right && coords.y >= r.top && coords.y <= r.bottom;
    }

    var latex = side.map(function (node, idx) {
      if (drilled && drilled.path[0] === idx) {
        if (drilled.part === 'den') {
          return drilledQuotientDenominatorLatex(node, idPrefix, idx, idx === 0);
        }
        if (drilled.part === 'sqrt') {
          return drilledSqrtLatex(node, idPrefix, idx, idx === 0);
        }
        // `branch` niché à plus d'un cran (ex. "(x+9)²(x-8)" trouvé dans un numérateur déjà
        // drillé, voir drillIntoNestedProductBranch dans history.js) : `node` ici n'est
        // PAS directement le ProductGroup, il faut descendre via drilledGroupLatex jusqu'à
        // lui — seul path.length===1 désigne le cas historique (produit au premier niveau
        // du membre drillé lui-même).
        if (typeof drilled.branch === 'number' && drilled.path.length === 1) {
          return drilledProductBranchLatex(node, idPrefix, idx, drilled.branch, idx === 0);
        }
        return drilledGroupLatex(node, idPrefix, idx, drilled.path.slice(1), idx === 0, drilled.branch);
      }
      var body = Expr.isProductGroup(node) ? productGroupBranchesLatex(node, idPrefix + '-' + idx, idx === 0) : Expr.nodeLatex(node, idx === 0);
      return '\\htmlId{' + idPrefix + '-' + idx + '}{' + body + '}';
    }).join('');
    window.katex.render(latex || '{}', container, { throwOnError: false, trust: true, strict: false });

    if (drilled) {
      var leafNode = Expr.nodeAtPath(side, drilled.path);
      var topIdx = drilled.path[0];
      var innerArr = Expr.drilledWorkingArray(leafNode, drilled);
      // Pendant un glisser à l'intérieur de la parenthèse, on doit reconstruire TOUT le
      // membre (coefficient devant la parenthèse, autres termes de premier niveau...) en
      // UN SEUL appel KaTeX, comme le fait le rendu normal — jamais juste le contenu de la
      // parenthèse dans un appel KaTeX séparé et imbriqué DANS l'arbre déjà rendu : KaTeX
      // recalcule sa propre échelle de police relative à chaque appel ("font-size: 1.21em"
      // sur sa racine ".katex"), donc un rendu imbriqué la cumule avec celle déjà en place
      // et fait grossir tout ce sous-arbre (et donc visuellement toute la ligne, la
      // hauteur du conteneur flex s'ajustant à son contenu le plus grand) — d'où le "toute
      // l'équation grossit" pendant le glisser. `buildInnerDragLatex` réutilise donc
      // drilledGroupLatex EXACTEMENT comme le ferait un rendu normal, seul l'ORDRE des
      // termes les plus profonds change (via `orderedLeaf`, substitué uniquement à la
      // feuille, identifiée par des ids temporaires "dragpv-i" plutôt que "-inner-i").
      function buildInnerDragLatex(orderedLeaf) {
        return side.map(function (node, idx) {
          if (idx !== topIdx) return Expr.nodeLatex(node, idx === 0);
          if (drilled.part === 'den') return drilledQuotientDenominatorLatexForOrder(node, orderedLeaf, idx === 0);
          if (drilled.part === 'sqrt') return drilledSqrtLatexForOrder(node, orderedLeaf, idx === 0);
          if (typeof drilled.branch === 'number' && drilled.path.length === 1) {
            return drilledProductBranchLatexForOrder(node, drilled.branch, orderedLeaf, idx === 0);
          }
          return drilledGroupLatexForOrder(node, drilled.path.slice(1), orderedLeaf, idx === 0, drilled.branch);
        }).join('');
      }
      innerArr.forEach(function (t, i) {
        var innerEl = container.querySelector('#' + escId(idPrefix + '-' + topIdx + '-inner-' + i));
        if (!innerEl) return;
        innerEl.classList.add('term', 'selectable');
        // "data-inner-index" (pas "data-index") : un terme intérieur et un terme de
        // premier niveau peuvent sinon partager la même valeur dans le même membre
        // (ex. "-2" intérieur et "+7" extérieur, tous deux à l'index 1), ambigu pour
        // tout sélecteur `[data-index="N"]` sur le membre entier.
        innerEl.setAttribute('data-inner-index', String(i));
        if (i === 0) innerEl.classList.add('term-first-in-side');
        if (i === innerArr.length - 1) innerEl.classList.add('term-last-in-side');
        if (drilled.selectedInner.has(i)) innerEl.classList.add('selected');
        // Descendre encore d'un niveau (si ce terme est lui-même un groupe factorisé) se
        // décide par mesure de temps entre deux clics, pas par l'évènement DOM natif
        // 'dblclick' — voir consumeDoubleClick dans history.js : la structure imbriquée de
        // ces termes (rendus par KaTeX) fait que 'dblclick' ne se déclenche pas de façon
        // fiable dessus, contrairement à 'click'/attachPointerDrag qui, eux, fonctionnent
        // bien ici.
        if (drilled.draggable) {
          // Glissable ET sélectionnable en même temps, comme les termes de premier niveau
          // (voir plus bas) : réordonne les termes À L'INTÉRIEUR de la parenthèse — que ce
          // soit un FactorGroup classique ou une branche de ProductGroup (voir
          // setInnerOrder dans history.js, qui gère les deux cas).
          innerEl.classList.add('draggable-term');
          innerEl.setAttribute('data-drag-id', String(i));
          // Un clic natif bulle jusqu'à l'élément "-exit" (parenthèse englobante, voir
          // plus bas) : on l'empêche ici pour ne jamais déclencher onExitDrill EN PLUS de
          // la sélection/du glisser, gérés par attachPointerDrag (qui, lui, ne s'appuie
          // pas sur l'évènement 'click' natif pour fonctionner).
          innerEl.addEventListener('click', function (e) { e.stopPropagation(); });
          attachPointerDrag(innerEl, container, innerArr, {
            getSelected: function () { return drilled.selectedInner; },
            commit: drilled.onSetInnerOrder,
            buildLatex: buildInnerDragLatex
          }, i, function () { drilled.onInnerClick(i); });
        } else {
          innerEl.addEventListener('click', function (e) {
            e.stopPropagation();
            drilled.onInnerClick(i);
          });
        }
      });
      // Facteurs d'un ProductGroup NICHÉ dans le numérateur d'une fraction ou l'intérieur
      // d'un FactorGroup classique drillé (ex. "(x+5)²(x-1)" dans "((x+5)²(x-1))/x", voir
      // le marquage ajouté dans drilledGroupLatex ci-dessus) : glissables individuellement
      // pour les réordonner, exactement comme au premier niveau (voir plus bas) — mais SANS
      // la sélection par facteur pour développement partiel (pas de sens ici, pas câblée),
      // et limité à une seule profondeur de "drilled" (path.length===1) sans branche/
      // dénominateur : les combinaisons plus profondes/rares restent un bloc opaque pour
      // l'instant, comme avant ce correctif.
      if (!drilled.part && typeof drilled.branch !== 'number' && drilled.path.length === 1 && drilled.draggable) {
        function buildNestedFactorDragLatex(innerIdx, orderedFactors) {
          return side.map(function (node, idx) {
            if (idx !== topIdx) return Expr.nodeLatex(node, idx === 0);
            var innerLatexP = node.innerTerms.map(function (t, i) {
              var body = i === innerIdx ? factorsDragBodyLatex(orderedFactors) : Expr.nodeLatex(t, i === 0);
              return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + i + '}{' + body + '}';
            }).join('');
            var innerBody;
            if (node.isDivision) {
              var denomLatexP = node.factorTerms ? Expr.innerTermsLatex(node.factorTerms) : Expr.termLatexBody(node.factor);
              innerBody = '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{\\frac{' + innerLatexP + '}{' + denomLatexP + '}}';
            } else {
              var factorBodyP = node.factor ? Expr.termLatexBody({ coeff: node.factor.coeff, pow: node.factor.pow }) : '';
              innerBody = factorBodyP + '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{\\left(' + innerLatexP + '\\right)}';
            }
            var signP = node.sign < 0 ? '-' : '+';
            return (idx === 0 ? (signP === '-' ? '-' : '') : ' ' + signP + ' ') + innerBody;
          }).join('');
        }
        innerArr.forEach(function (t, i) {
          if (!Expr.isProductGroup(t) || t.factors.length < 2) return;
          var nestedIdBase = idPrefix + '-' + topIdx + '-inner-' + i;
          t.factors.forEach(function (f, j) {
            var factorEl = container.querySelector('#' + escId(nestedIdBase + '-factor-' + j));
            if (!factorEl) return;
            factorEl.classList.add('factor-slot', 'draggable-term');
            factorEl.setAttribute('data-drag-id', String(j));
            attachPointerDrag(factorEl, container, t.factors, {
              getSelected: function () { return new Set(); },
              commit: function (order) { App.History.setDrilledFactorOrder(i, order); },
              buildLatex: function (orderedFactors) { return buildNestedFactorDragLatex(i, orderedFactors); },
              tagClass: 'factor-slot'
            }, j, function () {
              // Double-clic (détecté dans clickNestedFactor, history.js) : descend encore
              // d'un cran pour éditer les termes DE CE facteur (ex. "x"/"9" dans "(x+9)"),
              // exactement comme drillIntoProductBranch le fait déjà pour un produit au
              // premier niveau du membre — voir drillIntoNestedProductBranch.
              App.History.clickNestedFactor(i, j);
            });
          });
        });
      }
      var exitEl = container.querySelector('#' + escId(idPrefix + '-' + topIdx + '-exit'));
      if (exitEl) {
        exitEl.classList.add('drilled-exit');
        exitEl.addEventListener('click', function () { drilled.onExitDrill(); });
        // Clic droit : ressort d'un niveau (équivalent au clic sur la parenthèse), sans
        // faire apparaître le menu contextuel du navigateur.
        exitEl.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          drilled.onExitDrill();
        });
      }
    }

    if (!options || (!options.selectable && !options.draggable)) return;

    // Contexte de glisser pour un terme de PREMIER NIVEAU (un membre entier, voir
    // App.History.setSideOrder) : construit UNE SEULE FOIS par rendu de cette side, aussi
    // bien pour le glisser normal d'un terme de premier niveau (second forEach plus bas) que
    // comme cible d'ÉCHAPPEMENT du glisser PAR FACTEUR ci-dessous (voir
    // escalateFactorDragToTopLevel) — les deux partagent exactement le même comportement,
    // peu importe quel geste (un clic sur un terme, ou un facteur qui sort de son produit)
    // l'a déclenché.
    var topLevelDragCtx = options.draggable ? {
      getSelected: function () {
        var p = App.History.getPending();
        return new Set(sideName === 'left' ? p.selectedLeft : p.selectedRight);
      },
      commit: function (order) { App.History.setSideOrder(sideName, order); },
      buildLatex: function (orderedArr) {
        return orderedArr.map(function (node, i) {
          return '\\htmlId{dragpv-' + i + '}{' + Expr.nodeLatex(node, i === 0) + '}';
        }).join('');
      }
    } : null;

    // Sélection PAR FACTEUR (voir productGroupBranchesLatex plus haut et
    // toggleFactorSelection/pending.selectedFactors dans history.js) : chaque facteur d'un
    // produit à ≥2 facteurs de CETTE side reçoit une classe d'affordance de survol/clic
    // individuel ; celui ciblé par options.selectedFactors (au plus un produit à la fois)
    // reçoit en plus "selected". Un produit à un seul facteur (carré, exponent>1) n'a rien
    // à combiner avec lui-même : reste un bloc opaque normal, jamais de "factor-slot" ici.
    // En sélection libre (options.draggable, voir topLevelDragCtx ci-dessus — les deux sont
    // toujours vrais/faux ensemble ici, voir toggleTermSelection dans history.js), chaque
    // facteur devient EN PLUS individuellement glissable pour réordonner les facteurs entre
    // eux (voir Expr.setFactorOrder... en fait App.History.setFactorOrder ci-dessous) — un
    // geste "contextuel" : tant que le curseur reste dans les bornes du produit, seuls SES
    // facteurs se réordonnent ; en sortir bascule sur le produit ENTIER comme un terme de
    // premier niveau classique (voir escalateFactorDragToTopLevel plus bas).
    side.forEach(function (node, idx) {
      if (drilled && drilled.path[0] === idx) return; // rendu/câblé ci-dessus, pas de facteurs ici
      if (!Expr.isProductGroup(node) || node.factors.length < 2) return;
      var selBranches = options.selectedFactors && options.selectedFactors.index === idx
        ? options.selectedFactors.branches : null;
      node.factors.forEach(function (f, i) {
        var factorEl = container.querySelector('#' + escId(idPrefix + '-' + idx + '-factor-' + i));
        if (!factorEl) return;
        factorEl.classList.add('factor-slot');
        if (selBranches && selBranches.has(i)) factorEl.classList.add('selected');
        if (options.draggable) {
          factorEl.classList.add('draggable-term');
          factorEl.setAttribute('data-drag-id', String(i));
          attachPointerDrag(factorEl, container, node.factors, {
            getSelected: function () {
              return options.selectedFactors && options.selectedFactors.index === idx
                ? options.selectedFactors.branches : new Set();
            },
            commit: function (order) { App.History.setFactorOrder(sideName, idx, order); },
            buildLatex: function (orderedFactors) { return buildFactorDragLatex(side, idPrefix, idx, orderedFactors); },
            tagClass: 'factor-slot',
            escalate: { side: side, topIdx: idx, idPrefix: idPrefix, dragCtx: topLevelDragCtx }
          }, i, options.onTermClick ? function (targetEl) { options.onTermClick(sideName, idx, targetEl); } : null);
        }
      });
    });

    side.forEach(function (node, idx) {
      if (drilled && drilled.path[0] === idx) return; // rendu/câblé ci-dessus
      var id = idPrefix + '-' + idx;
      var el = container.querySelector('#' + escId(id));
      if (!el) return;
      el.classList.add('term');
      el.setAttribute('data-index', String(idx));
      // Le premier/dernier terme du membre n'a rien à sa gauche/droite avec qui sa zone
      // de clic pourrait se chevaucher : ils gardent une marge de clic confortable là où
      // les termes du milieu la réduisent des deux côtés (voir le CSS correspondant).
      if (idx === 0) el.classList.add('term-first-in-side');
      if (idx === side.length - 1) el.classList.add('term-last-in-side');
      if (options.selected && options.selected.has(idx)) el.classList.add('selected');
      if (options.draggable) {
        // Glissable ET sélectionnable en même temps (sélection libre, hors mode) : un
        // seul mécanisme (souris) tranche entre clic (sélection) et glisser, pour ne
        // jamais déclencher les deux à la fois sur le même geste (voir attachPointerDrag).
        el.classList.add('draggable-term', 'selectable');
        el.setAttribute('data-drag-id', String(idx));
        attachPointerDrag(el, container, side, topLevelDragCtx, idx,
          options.onTermClick ? function (targetEl, coords) {
            options.onTermClick(sideName, idx, targetEl, resolveIsDenPart(idx, targetEl, coords));
          } : null);
      } else if (options.selectable) {
        el.classList.add('selectable');
        el.addEventListener('click', function (e) {
          options.onTermClick(sideName, idx, e.target, resolveIsDenPart(idx, e.target, { x: e.clientX, y: e.clientY }));
        });
      }
      // Entrer dans le groupe factorisé (s'il en est un) sur un double-clic se décide par
      // mesure de temps entre deux clics, directement dans toggleTermSelection (voir
      // consumeDoubleClick dans history.js) — pas via l'évènement DOM natif 'dblclick',
      // qui ne se déclenche pas de façon fiable sur ces termes (glissables via
      // attachPointerDrag, qui gère lui-même le clic au mousedown/mouseup).
    });
  }

  // ---- Glisser-déposer (réorganisation des termes d'un membre) ----
  // Implémenté à la souris (mousedown/mousemove/mouseup) plutôt qu'avec l'API HTML5
  // Drag&Drop native : on a besoin de ré-afficher le membre en temps réel pendant le
  // glissement (les autres termes qui se décalent, animation FLIP), ce qui recrée le DOM
  // à chaque étape ; faire ça avec un drag natif en cours risquerait de l'interrompre.
  // Aucun effet mathématique (l'addition est commutative) : purement visuel.
  var termDrag = null; // { side, sideName, container, order, draggedOrigIdx, startClientX/Y, ghostEl }

  // `onClick`, si fourni, est appelé quand le geste se termine SANS avoir dépassé le
  // seuil de déplacement (donc un simple clic, pas un glisser) : sert à la sélection
  // libre des termes, qui partage le même geste souris que le glisser-déposer.
  // `arr` : le tableau de noeuds réordonné (un membre entier, ou les innerTerms d'un
  // groupe dans lequel on est "entré" — voir renderSide/drilled). `dragCtx` :
  // { getSelected():Set, commit(order), buildLatex(orderedArr), escalate? } — abstrait la
  // provenance de la surbrillance "sélectionné" et la façon dont le nouvel ordre est
  // appliqué (App.History.setSideOrder pour un membre, engine.setInnerOrder pour l'intérieur
  // d'une parenthèse, App.History.setFactorOrder pour les facteurs d'un ProductGroup de
  // premier niveau). `dragCtx.escalate` (optionnel) : { side, topIdx, idPrefix, dragCtx } —
  // seul le glisser PAR FACTEUR (voir renderSide) le fournit, pour basculer sur le produit
  // ENTIER si le curseur sort de ses bornes (voir updateTermDrag/escalateFactorDragToTopLevel).
  function attachPointerDrag(el, container, arr, dragCtx, idx, onClick) {
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; // clic gauche uniquement
      e.preventDefault();
      // Empêche l'évènement de remonter à un ancêtre lui-même câblé par attachPointerDrag
      // (ex. un facteur DANS le produit entier, tous deux glissables, voir renderSide) :
      // sans ça, saisir un facteur déclencherait à tort DEUX glissers superposés (celui du
      // facteur ET celui, hérité par bouillonnement, du produit entier qui le contient).
      e.stopPropagation();
      var startX = e.clientX, startY = e.clientY;
      // Élément DOM précis sous le curseur AU MOMENT du clic (avant que KaTeX/le DOM ne
      // bouge) — transmis à `onClick` (avec les coordonnées, voir onUp) pour, ex.,
      // distinguer laquelle des deux parenthèses d'un ProductGroup a été visée (voir
      // productGroupBranchesLatex/data-branch et selectDragOptions plus haut) : ce clic
      // n'utilise jamais l'évènement DOM natif 'click' (voir onUp ci-dessous), donc rien
      // d'autre ne donnerait cette info.
      var mousedownTarget = e.target;
      var moved = false;

      function onMove(e2) {
        if (!moved) {
          // Seuil de quelques pixels avant de déclencher visuellement le glisser, pour
          // ne pas faire clignoter un fantôme sur un simple clic sans déplacement.
          if (Math.abs(e2.clientX - startX) < 4 && Math.abs(e2.clientY - startY) < 4) return;
          moved = true;
          beginTermDrag(el, container, arr, dragCtx, idx, startX, startY);
        }
        updateTermDrag(e2.clientX, e2.clientY);
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) endTermDrag();
        else if (onClick) onClick(mousedownTarget, { x: startX, y: startY });
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  function beginTermDrag(el, container, arr, dragCtx, idx, startClientX, startClientY) {
    var rect = el.getBoundingClientRect();
    var ghost = document.createElement('div');
    // Classe "katex" nécessaire : tout l'empilement interne de KaTeX (numérateur/
    // dénominateur d'une fraction notamment) repose sur des règles CSS scopées sous
    // ".katex ..." (katex.min.css) ; sans un ancêtre portant cette classe, ces règles
    // ne s'appliquent plus et la fraction s'affiche à plat, hors de son tableau vlist.
    // La taille de police reste correcte : le style inline ci-dessous prime toujours
    // sur le "font: ... 1.21em ..." relatif que .katex fixe normalement.
    ghost.className = 'drag-ghost katex';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.fontSize = window.getComputedStyle(el).fontSize;
    var inner = el.cloneNode(true);
    inner.removeAttribute('id');
    // Retire les classes interactives (sinon, comme le fantôme suit le curseur, le
    // clone se retrouverait "survolé" en continu et afficherait le fond de :hover).
    inner.classList.remove('draggable-term', 'term', 'factor-slot');
    ghost.appendChild(inner);
    document.body.appendChild(ghost);

    termDrag = {
      side: arr,
      dragCtx: dragCtx,
      container: container,
      order: arr.map(function (_, i) { return i; }),
      draggedOrigIdx: idx,
      startClientX: startClientX,
      startClientY: startClientY,
      ghostEl: ghost,
      // Classe distinguant la portée de "data-drag-id" à interroger (voir
      // computeTargetOrder/reflowDragSide) : 'term' pour un terme de premier niveau (ou un
      // terme intérieur "drillé", même classe partagée sans ambiguïté là), 'factor-slot'
      // pour un glisser PAR FACTEUR (voir renderSide) — les deux portées peuvent coexister
      // dans le MÊME container (un produit ET ses propres facteurs), d'où le besoin d'un
      // filtre explicite plutôt qu'un "[data-drag-id]" global.
      tagClass: dragCtx.tagClass || 'term',
      // Présent UNIQUEMENT pour un glisser par facteur (voir renderSide) : { side, topIdx,
      // idPrefix, dragCtx } décrit vers quoi basculer si le curseur sort des bornes du
      // produit (voir updateTermDrag/escalateFactorDragToTopLevel plus bas). null pour tout
      // autre glisser (déjà au premier niveau, ou intérieur d'un groupe "drillé" — rien
      // "au-dessus" vers quoi remonter dans ce dernier cas).
      escalate: dragCtx.escalate || null
    };
    reflowDragSide(); // tague data-drag-id sur le rendu déjà présent + estompe le terme saisi
  }

  // Détermine, d'après la position horizontale du curseur, où le terme saisi devrait
  // s'insérer parmi les AUTRES termes (dans leur ordre d'affichage courant). Le sélecteur
  // est scopé à `d.tagClass` (voir beginTermDrag/reflowDragSide) : un même `container` peut
  // héberger DEUX portées de "data-drag-id" en même temps (les facteurs d'un produit ET le
  // produit lui-même parmi ses frères de premier niveau, voir renderSide) — sans ce filtre,
  // une valeur numérique partagée par les deux (ex. facteur 0 ET terme de premier niveau 0)
  // résoudrait au hasard le mauvais élément.
  function computeTargetOrder(clientX) {
    var d = termDrag;
    var elsByOrig = {};
    Array.prototype.forEach.call(d.container.querySelectorAll('.' + d.tagClass + '[data-drag-id]'), function (el) {
      elsByOrig[el.getAttribute('data-drag-id')] = el;
    });
    var others = d.order.filter(function (o) { return o !== d.draggedOrigIdx; });
    var insertPos = others.length;
    for (var i = 0; i < others.length; i++) {
      var elOther = elsByOrig[others[i]];
      if (!elOther) continue;
      var rect = elOther.getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) { insertPos = i; break; }
    }
    var newOrder = others.slice();
    newOrder.splice(insertPos, 0, d.draggedOrigIdx);
    return newOrder;
  }

  function updateTermDrag(clientX, clientY) {
    var d = termDrag;
    if (!d) return;
    // Glisser PAR FACTEUR uniquement (voir renderSide/beginTermDrag) : le curseur sort des
    // bornes horizontales du produit ENTIER (mesurées sur son id stable "idPrefix-topIdx",
    // toujours présent pendant CE glisser précis — voir productGroupFactorsLatexForOrder)
    // -> bascule sur un glisser de PREMIER NIVEAU du produit tout entier, comme s'il
    // s'agissait d'un terme classique (voir escalateFactorDragToTopLevel). Un seul sens
    // (jamais de retour à "par facteur" une fois sorti) : une fois le produit lui-même en
    // train de glisser parmi ses frères, il n'y a plus de facteur précis à réintégrer.
    if (d.escalate) {
      var productEl = d.container.querySelector('#' + escId(d.escalate.idPrefix + '-' + d.escalate.topIdx));
      if (productEl) {
        var prect = productEl.getBoundingClientRect();
        var SLACK = 2;
        if (clientX < prect.left - SLACK || clientX > prect.right + SLACK) {
          escalateFactorDragToTopLevel(productEl, clientX, clientY);
          return;
        }
      }
    }
    var dx = clientX - d.startClientX;
    var dy = clientY - d.startClientY;
    d.ghostEl.style.transform = 'translate(' + dx + 'px, ' + dy + 'px) scale(1.06)';

    var newOrder = computeTargetOrder(clientX);
    if (newOrder.join(',') !== d.order.join(',')) {
      d.order = newOrder;
      reflowDragSide();
    }
  }

  // Bascule un glisser PAR FACTEUR en cours (voir renderSide/beginTermDrag/updateTermDrag)
  // sur un glisser de PREMIER NIVEAU du produit tout entier, à sa place courante parmi ses
  // frères — même geste souris, sans relâcher le clic : on remplace juste `termDrag` par
  // l'équivalent de ce qu'aurait construit beginTermDrag si on avait saisi le produit
  // directement (même `dragCtx`/`tagClass` que le glisser de premier niveau normal, voir
  // topLevelDragCtx). Le NOUVEAU fantôme (clone du produit entier tel qu'affiché à cet
  // instant, facteurs dans leur ordre en cours de glisser) remplace l'ancien (clone du seul
  // facteur saisi) ; `startClientX/Y` repart du point exact où le curseur est sorti des
  // bornes du produit, pour que le fantôme continue de suivre le curseur sans "sauter"
  // (son ancrage `left/top` vient du rect du produit À CET INSTANT, pas de son rect
  // d'origine avant tout glisser).
  function escalateFactorDragToTopLevel(productEl, clientX, clientY) {
    var d = termDrag;
    var esc = d.escalate;
    if (d.ghostEl.parentNode) d.ghostEl.parentNode.removeChild(d.ghostEl);
    var rect = productEl.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className = 'drag-ghost katex';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.fontSize = window.getComputedStyle(productEl).fontSize;
    var inner = productEl.cloneNode(true);
    inner.removeAttribute('id');
    inner.classList.remove('draggable-term', 'term', 'factor-slot');
    ghost.appendChild(inner);
    document.body.appendChild(ghost);

    termDrag = {
      side: esc.side,
      dragCtx: esc.dragCtx,
      container: d.container,
      order: esc.side.map(function (_, i) { return i; }),
      draggedOrigIdx: esc.topIdx,
      startClientX: clientX,
      startClientY: clientY,
      ghostEl: ghost,
      tagClass: esc.dragCtx.tagClass || 'term',
      escalate: null // remonté d'un cran : rien "au-dessus" vers quoi remonter encore.
    };
    reflowDragSide();
    updateTermDrag(clientX, clientY); // reflète immédiatement la position du curseur, sans attendre le prochain mousemove.
  }

  // Ré-affiche le membre selon l'ordre courant du glisser (FLIP : les termes qui
  // changent de place s'animent en douceur vers leur nouvelle position, au lieu de
  // "sauter" instantanément).
  function reflowDragSide() {
    var d = termDrag;
    var oldRects = {};
    // Même scope que computeTargetOrder ci-dessus (d.tagClass) — sinon, sur ce tout premier
    // appel (voir beginTermDrag), le DOM porte encore les DEUX portées de "data-drag-id" à la
    // fois (rendu normal non wipé), avec le même risque de résoudre le mauvais élément.
    Array.prototype.forEach.call(d.container.querySelectorAll('.' + d.tagClass + '[data-drag-id]'), function (el) {
      oldRects[el.getAttribute('data-drag-id')] = el.getBoundingClientRect();
    });

    // Le glisser ne se produit qu'en sélection libre (opType null) : la surbrillance
    // jaune des termes déjà sélectionnés doit survivre au ré-affichage en direct,
    // sinon elle disparaîtrait pendant qu'on glisse un AUTRE terme à côté.
    var selectedSet = d.dragCtx.getSelected();

    var displayedSide = d.order.map(function (origIdx) { return d.side[origIdx]; });
    d.container.innerHTML = '';
    var latex = d.dragCtx.buildLatex(displayedSide);
    window.katex.render(latex || '{}', d.container, { throwOnError: false, trust: true, strict: false });

    displayedSide.forEach(function (node, i) {
      var el = d.container.querySelector('#' + escId('dragpv-' + i));
      if (!el) return;
      var origIdx = d.order[i];
      el.classList.add(d.tagClass, 'draggable-term');
      el.setAttribute('data-drag-id', String(origIdx));
      if (origIdx === d.draggedOrigIdx) el.classList.add('drag-source-active');
      if (selectedSet.has(origIdx)) el.classList.add('selected');

      var oldRect = oldRects[origIdx];
      if (!oldRect) return;
      var newRect = el.getBoundingClientRect();
      var deltaX = oldRect.left - newRect.left;
      if (Math.abs(deltaX) < 0.5) return;
      el.style.transition = 'none';
      el.style.transform = 'translateX(' + deltaX + 'px)';
      el.getBoundingClientRect(); // force le reflow avant de relâcher la transition
      requestAnimationFrame(function () {
        el.style.transition = 'transform 0.18s ease';
        el.style.transform = '';
      });
    });
  }

  function endTermDrag() {
    var d = termDrag;
    if (!d) return;
    if (d.ghostEl.parentNode) d.ghostEl.parentNode.removeChild(d.ghostEl);
    var order = d.order;
    var commit = d.dragCtx.commit;
    termDrag = null;
    commit(order);
  }

  // En dessous de cette taille, on arrête de réduire la police et on laisse le
  // défilement horizontal propre à la ligne (.eq-row { overflow-x: auto }) prendre le relais.
  var MIN_EQ_FONT_PX = 18;

  // Réduit la police d'UNE ligne si son contenu naturel dépasse la largeur disponible,
  // jusqu'à MIN_EQ_FONT_PX ; en dessous, on laisse la ligne défiler horizontalement.
  function autoFitRowFont(row) {
    var line = row.querySelector('.eq-line');
    if (!line) return;
    line.style.fontSize = ''; // repart de la taille CSS (clamp) par défaut pour mesurer
    row.style.justifyContent = ''; // idem : repart du centrage par défaut (voir plus bas)
    var available = row.clientWidth;
    var natural = line.scrollWidth;
    if (!available || natural <= available) return;
    var currentPx = parseFloat(window.getComputedStyle(line).fontSize);
    var target = currentPx * (available / natural) * 0.96; // petite marge de sécurité
    line.style.fontSize = Math.max(MIN_EQ_FONT_PX, target) + 'px';
    if (target < MIN_EQ_FONT_PX) {
      // La ligne reste trop large même à la police minimale : le défilement horizontal
      // natif (.eq-row { overflow-x: auto }) prend le relais. Mais avec le
      // justify-content:center par défaut de .eq-row, `.eq-line` centré déborde des DEUX
      // côtés à parts égales — et Chromium ne peut défiler QUE vers la droite (même
      // limitation déjà documentée pour .produit-nul-split dans style.css : un
      // débordement négatif/gauche n'est pas atteignable au défilement). scrollLeft=0
      // correspond alors à cette vue centrée déjà rognée, PAS au début du contenu : le
      // début reste inaccessible, aucun scroll ne le révèle jamais. En repassant en
      // flex-start le temps que ça déborde, le début coïncide avec scrollLeft=0 (défilable
      // à droite jusqu'à la fin) — un simple centrage horizontal perd son sens de toute
      // façon dès qu'il faut défiler pour tout lire.
      row.style.justifyContent = 'flex-start';
      row.scrollLeft = 0;
    }
  }

  function createRow(equation, opts) {
    opts = opts || {};
    rowSeq += 1;
    var row = document.createElement('div');
    row.className = 'eq-row' +
      (opts.pending ? ' pending' : '') +
      (opts.solved ? ' solved' : '') +
      (opts.current ? ' current' : '');

    var line = document.createElement('div');
    line.className = 'eq-line';

    var leftSpan = document.createElement('span');
    leftSpan.className = 'side';
    var eqSign = document.createElement('span');
    eqSign.className = 'eq-sign';
    // `opts.eqGlyph` (voir renderChain, câblé depuis renderDomainSplit) : la ligne
    // FINALE d'une colonne "Condition d'existence" affiche "≠"/"≥" plutôt que "=" une
    // fois résolue — une simple relabellisation d'affichage (App.Equation reste
    // toujours opérateur-agnostique, voir history.js) : "dénominateur=0" se résout par
    // le moteur d'équation normal, seule sa lecture finale change de sens ("x=-3" veut
    // dire ici "x≠-3", la valeur EXCLUE du domaine).
    window.katex.render(opts.eqGlyph || '=', eqSign, { throwOnError: false });
    var rightSpan = document.createElement('span');
    rightSpan.className = 'side';

    line.appendChild(leftSpan);
    line.appendChild(eqSign);
    line.appendChild(rightSpan);
    row.appendChild(line);

    renderSide(leftSpan, equation.left, 'left', 'r' + rowSeq + '-left', opts.leftOptions);
    renderSide(rightSpan, equation.right, 'right', 'r' + rowSeq + '-right', opts.rightOptions);
    return row;
  }

  // Un aperçu en direct (résultat calculé d'une action pas encore confirmée) ne s'affiche
  // que si l'action est vraiment engagée — jamais juste parce que des termes sont
  // sélectionnés ou qu'une colonne "produit nul" existe sans être la colonne active :
  // - "Opération"/"Factoriser" une fois leur mode cliqué (déjà en train de composer) ;
  // - sélection libre (aucun mode engagé) : seulement si la souris survole le bouton
  //   dont l'action s'applique réellement à cette sélection (Simplifier/Développer —
  //   "Factoriser" n'a pas d'aperçu tant que le facteur n'est pas saisi, "Produit nul"
  //   scinde en deux nouvelles lignes, rien à prévisualiser sur une seule ligne).
  // Détermine si/où la ligne "pending" doit héberger le pavé "live" (le <math-field>
  // partagé lui-même, voir bindLiveOpField dans mathKeypad.js) plutôt qu'un pill KaTeX
  // statique — uniquement pendant la composition d'une "Opération" (chaîne +/-/×/÷,
  // toujours symétrique sur les deux membres) ou d'un facteur commun (un seul membre
  // concerné, déterminé par la sélection de départ). L'identité remarquable garde son
  // propre pavé dédié (deux champs "a"/"b" dans #controlPanel, pas réductible à un pill
  // unique) — non concernée ici. Renvoie null si aucun côté n'est "live" cette fois-ci
  // (ex. racine carrée armée, ou étape 1 du choix de méthode de factorisation).
  //
  // `mirror`+`rawLatex` : pour 'expr', l'opération porte TOUJOURS sur les deux membres à
  // la fois — le côté "live" (`side`, voir App.Toolbar.getExprLiveSide/switchExprLiveSide :
  // gauche par défaut, bascule en cliquant le miroir de l'AUTRE membre) tape dans le vrai
  // champ partagé, l'AUTRE affiche un second <math-field> "en lecture seule" (voir
  // drawMirrorField dans arrows.js) qui recopie le même texte tapé, pour que les deux
  // membres restent visuellement de vrais champs mathématiques identiques plutôt qu'un
  // champ d'un côté et un simple pill KaTeX de l'autre. `prefixLatex` : légende figée
  // avant le champ (ex. "factoriser par", voir formatOpLabel) — 'expr' n'en a pas besoin
  // (l'opérateur +/-/×/÷ fait déjà partie du texte tapé lui-même).
  // Vrai en mode 'expr' réellement engagé, OU au survol du bouton "Opération" alors
  // qu'aucun mode n'est engagé (voir l'ajout de 'expr' aux boutons à aperçu dans
  // initToolbar) : sert à décider si la ligne "pending" et ses flèches apparaissent —
  // PAS si le <math-field> partagé (singleton, voir computeLiveOpInfo ci-dessous, qui
  // reste volontairement limité au vrai engagement) doit être montré. Au survol, sans
  // clic, on affiche juste la ligne vide et ses flèches (via drawSide, sans étiquette —
  // voir opLeft/opRight null plus bas), jamais le pavé "live" lui-même : le réutiliser
  // ici afficherait potentiellement un contenu tapé lors d'une session précédente restée
  // dans son conteneur (le champ partagé n'est jamais vidé tant qu'il n'est pas RÉELLEMENT
  // relié, voir bindLiveOpField dans mathKeypad.js).
  function isExprLikeActive(pending) {
    return pending.opType === 'expr' ||
      (pending.opType === null && App.Toolbar.getHoveredOp() === 'expr');
  }

  function computeLiveOpInfo(pending, preview) {
    if (pending.opType === 'expr') {
      return {
        side: App.Toolbar.getExprLiveSide(),
        mirror: true,
        rawLatex: pending.exprLatex || '',
        prefixLatex: null,
        warnLatex: exprRiskyConditionsLatex(preview.opLeft)
      };
    }
    if (pending.opType === 'factor' && pending.factorMode === 'common') {
      // getFactorSelectionIndices (pas selectedLeft/Right seuls) : un produit sélectionné
      // facteur par facteur (voir toggleFactorSelection/selectedFactorGroups dans
      // history.js) n'apparaît jamais dans selectedLeft/Right lui-même — sans cette
      // fusion, le pavé "live" ne trouvait aucun côté avant la première frappe (le champ
      // partagé restait alors invisible/non focalisable, voir factorTarget). pending.drilled
      // (facteur commun choisi À L'INTÉRIEUR d'un groupe déjà factorisé, voir
      // enterFactorWithSelection/pending.selectedInner) : ni selectedLeft/Right ni
      // selectedFactorGroups ne contiennent alors rien, ce membre restant vide tant que
      // rien n'est tapé — pending.drilled.side donne directement le côté concerné.
      var side = (preview.opLeft && preview.opLeft.type === 'factor') ? 'left'
        : (preview.opRight && preview.opRight.type === 'factor') ? 'right'
        : App.History.getFactorSelectionIndices('left').length > 0 ? 'left'
        : App.History.getFactorSelectionIndices('right').length > 0 ? 'right'
        : pending.drilled ? pending.drilled.side
        : null;
      return side
        ? { side: side, mirror: false, rawLatex: null, prefixLatex: '\\text{factoriser par }', warnLatex: null }
        : null;
    }
    return null;
  }

  function shouldShowLivePreview(pending, opts) {
    if (opts.focused === false) return false;
    // "√" armée (voir pending.sqrtArmed dans history.js) : la ligne "pending" générique
    // n'aurait de toute façon rien à montrer (chaîne vide, équation inchangée, voir
    // computePreview) — l'aperçu dédié (colonnes scindées, voir previewSquareRoot et
    // renderAll) la remplace déjà, pas besoin des deux à la fois.
    if (pending.opType === 'expr' && pending.sqrtArmed) return false;
    if (pending.opType === 'expr' || pending.opType === 'factor') return true;
    if (pending.opType !== null) return false;
    var hovered = App.Toolbar.getHoveredOp();
    if (!hovered) return false;
    if (hovered === 'expr') return true;
    // Survol de "Simplifier" alors que la sélection en cours cible l'étape 2 de "Racine
    // carrée" (voir squareRootSimplifyAction dans history.js) : même raison que sqrtArmed
    // ci-dessus, l'aperçu dédié (voir renderAll) la remplace déjà — que ce survol scinde en
    // ± ou non (mode 'calc', un seul membre).
    if (hovered === 'simplify' && App.History.squareRootAction()) return false;
    var info = App.Toolbar.computeSelectionInfo();
    if (hovered === 'expand') return info.canExpand;
    if (hovered === 'simplify') return info.canSimplify;
    return false;
  }

  // Rend la chaîne d'étapes d'UN moteur de résolution (l'orchestrateur App.History pour
  // la ligne principale, ou un moteur de branche isolé une fois un "produit nul"
  // déclenché — les deux exposent la même API) dans `container`. `opts.onBeforeAction`,
  // si fourni, s'exécute avant chaque sélection de terme (sert à focaliser la bonne
  // branche, voir renderAll). Renvoie { rowsData, framedRowEl } pour le tracé des
  // flèches et le recentrage éventuel.
  function renderChain(engine, container, opts) {
    container.innerHTML = '';
    var steps = engine.getSteps();
    var pending = engine.getPending();
    var rowsData = [];

    // Vraie nouvelle étape validée pour CE moteur (même comparaison que `isNewStep` plus
    // bas dans renderAll, juste faite plus tôt : `lastCenteredStepByEngine` n'est mis à
    // jour que dans le bloc de recentrage, bien après le retour de cet appel, donc la lire
    // ici renvoie encore la valeur d'avant ce rendu) : sert à faire glisser l'encadré bleu
    // "current" (voir .eq-row.current .eq-line dans style.css) de l'ancienne ligne vers la
    // nouvelle avec un fondu, plutôt que le saut instantané qu'on aurait sinon (voir plus
    // bas dans cette fonction, après la boucle steps.forEach, pour le mécanisme).
    var fadeNewStep = !prefersReducedMotion && steps.length > 0 &&
      steps[steps.length - 1] !== lastCenteredStepByEngine.get(engine);
    var fadeInEl = null;  // ligne qui doit finir AVEC "current" mais est créée sans
    var fadeOutEl = null; // ligne qui doit finir SANS "current" mais est créée avec

    // Fusionne avec pending.selectedFactorGroups (produits ENTIERS complétés facteur par
    // facteur, voir toggleFactorSelection/updateFactorGroupCompletion dans history.js) pour
    // que ce noeud reste visuellement "selected" même une fois passé à un AUTRE produit
    // (dont la sélection par facteur, elle, ne retient qu'un produit à la fois — voir
    // pending.selectedFactors) — purement visuel, n'affecte jamais selectedLeft/Right
    // lui-même ni topLevelDragCtx.getSelected (qui les relit fraîchement, voir plus bas).
    var leftSelected = new Set(pending.selectedLeft.concat(pending.selectedFactorGroups.left));
    var rightSelected = new Set(pending.selectedRight.concat(pending.selectedFactorGroups.right));
    // Sélection libre (opType null) : les deux membres restent sélectionnables sans
    // restriction — Simplifier peut agir sur les deux à la fois, et c'est l'activation
    // des boutons (voir computeSelectionInfo dans toolbar.js), pas la sélection
    // elle-même, qui filtre ce qui est possible pour Factoriser/Développer. Mode
    // 'factor' engagé : reste limité à une seule cible (un seul facteur commun saisi),
    // que ce soit un membre entier ou l'intérieur d'un groupe "entre" — jamais les deux.
    // "Entré" dans un groupe (pending.drilled) EN SÉLECTION LIBRE (opType null) : le
    // membre où l'on est entré n'est plus sélectionnable à son premier niveau (ambigu :
    // le groupe entier ou son contenu ?), mais l'AUTRE membre reste sélectionnable
    // normalement — permet par ex. de simplifier l'intérieur d'un groupe à gauche ET des
    // termes à droite en une seule étape (voir confirmSimplifySelection).
    var leftSelectable, rightSelectable;
    if (pending.opType === 'factor') {
      if (pending.drilled) {
        leftSelectable = false;
        rightSelectable = false;
      } else {
        leftSelectable = pending.selectedRight.length === 0 && pending.selectedFactorGroups.right.length === 0;
        rightSelectable = pending.selectedLeft.length === 0 && pending.selectedFactorGroups.left.length === 0;
      }
    } else if (pending.drilled) {
      leftSelectable = pending.drilled.side !== 'left';
      rightSelectable = pending.drilled.side !== 'right';
    } else {
      leftSelectable = true;
      rightSelectable = true;
    }

    // En sélection libre, la ligne courante est à la fois sélectionnable ET glissable
    // (un seul geste souris tranche entre les deux, voir attachPointerDrag) ; en mode
    // 'factor', seulement sélectionnable (pas de réorganisation pendant la saisie).
    function selectDragOptions(selected, selectable, draggable, innerDraggable, sideName) {
      var drilledOpt = null;
      if (pending.drilled && pending.drilled.side === sideName) {
        drilledOpt = {
          path: pending.drilled.path,
          branch: pending.drilled.branch,
          part: pending.drilled.part,
          selectedInner: new Set(pending.selectedInner),
          draggable: innerDraggable,
          onInnerClick: function (innerIdx) {
            // Colonne pas encore focalisée à ce rendu (voir le même garde-fou dans
            // onTermClick ci-dessus, notifyFocus compris — ce clic natif s'arrête ici
            // (stopPropagation, voir plus bas dans ce fichier) et ne bulle JAMAIS jusqu'à
            // la colonne, contrairement à onTermClick : sans notifyFocus explicite ici,
            // rien ne (re)focaliserait la colonne) : ce clic la focalise seulement, sans
            // sélectionner le terme intérieur cliqué.
            if (opts.focused === false) {
              if (opts.notifyFocus) opts.notifyFocus();
              return;
            }
            if (opts.onBeforeAction) opts.onBeforeAction();
            // Le double-clic (descendre encore d'un niveau) est détecté par mesure de
            // temps DANS toggleInnerSelection elle-même (voir consumeDoubleClick), pas ici.
            engine.toggleInnerSelection(innerIdx);
          },
          onExitDrill: function () {
            if (opts.focused === false) {
              if (opts.notifyFocus) opts.notifyFocus();
              return;
            }
            if (opts.onBeforeAction) opts.onBeforeAction();
            engine.exitDrill();
          },
          onSetInnerOrder: function (order) {
            if (opts.onBeforeAction) opts.onBeforeAction();
            engine.setInnerOrder(order);
          }
        };
      }
      // Sélection PAR FACTEUR en cours sur CETTE side (voir toggleFactorSelection/
      // pending.selectedFactors dans history.js) : au plus un produit à la fois PAR MEMBRE
      // (le membre opposé a sa propre entrée, indépendante — voir computeExpandTargets),
      // jamais en même temps que `drilled` sur CE membre (mutuellement exclusifs, voir
      // history.js).
      var selectedFactorsOpt = null;
      var sfForSide = pending.selectedFactors && pending.selectedFactors[sideName];
      if (sfForSide) {
        selectedFactorsOpt = { index: sfForSide.index, branches: new Set(sfForSide.branches) };
      }
      return {
        selectable: selectable,
        draggable: draggable,
        selected: selected,
        drilled: drilledOpt,
        selectedFactors: selectedFactorsOpt,
        onTermClick: function (side, idx, targetEl, isDenPart) {
          // Colonne de branche PAS ENCORE focalisée au moment de ce rendu (voir
          // opts.focused/opts.notifyFocus, câblés depuis renderBranchNode — toujours
          // `undefined`, jamais `false`, hors "Produit nul") : ce premier clic ne fait
          // QUE la focaliser (notifyFocus, la variante NON silencieuse — sans action
          // réelle à la suite pour déclencher son propre rendu, contrairement à
          // onBeforeAction plus bas, silencieux car toujours suivi d'un vrai rendu à lui)
          // sans sélectionner le terme cliqué — évite qu'un simple clic pour activer une
          // colonne ne sélectionne accidentellement un de ses termes en même temps. Un
          // second clic, une fois la colonne redessinée focalisée, sélectionne normalement.
          if (opts.focused === false) {
            if (opts.notifyFocus) opts.notifyFocus();
            return;
          }
          if (opts.onBeforeAction) opts.onBeforeAction();
          // Le double-clic (entrer dans le groupe, dans UNE branche précise d'un
          // ProductGroup, ou dans le dénominateur-expression d'une fraction) est détecté
          // par mesure de temps DANS toggleTermSelection elle-même (voir consumeDoubleClick
          // dans history.js), pas ici. `targetEl` : l'élément DOM réellement cliqué (voir
          // attachPointerDrag) — sert à repérer, pour un ProductGroup, dans laquelle des
          // parenthèses (data-branch, voir productGroupBranchesLatex) le clic a atterri.
          // `isDenPart` (déjà résolu par resolveIsDenPart dans renderSide, avec repli
          // géométrique — un strut interne de \frac peut intercepter targetEl) : s'il a
          // atterri dans le dénominateur d'une fraction.
          var branchSpan = targetEl && targetEl.closest && targetEl.closest('[data-branch]');
          engine.toggleTermSelection(side, idx, branchSpan ? parseInt(branchSpan.getAttribute('data-branch'), 10) : null, isDenPart);
        }
      };
    }

    var framedRowEl = null; // la ligne encadrée (dernier résultat obtenu) : celle qu'on centre à l'écran
    var framedSolved = false; // voir positionPanel dans toolbar.js : plus de fenêtre d'action sur "x=..."

    steps.forEach(function (step, i) {
      var isLastConfirmed = (i === steps.length - 1);
      var solved = isLastConfirmed && App.Equation.isSolved(step.equation);
      // L'équation encadrée est celle qui vient d'être obtenue (le dernier résultat),
      // pas la ligne "pending" du dessous qui reste, elle, à construire.
      var current = isLastConfirmed && !solved;
      // Nouvelle étape à animer (voir fadeNewStep plus haut) : crée ces deux lignes-là
      // avec la classe "current" INVERSÉE par rapport à sa valeur réelle — l'ancienne
      // apparence (bleu sur l'avant-dernière étape, pas sur la dernière) — le temps que
      // autoFitRowFont (juste plus bas) force sa mise en page et "committe" ainsi cette
      // apparence auprès du moteur de style ; le vrai basculement vers l'apparence finale
      // n'a lieu qu'après la boucle entière, une fois cette valeur bien commise — c'est CE
      // changement, relatif à un état déjà résolu par le navigateur, que la transition CSS
      // déclarée sur .eq-line (background/box-shadow) détecte et anime. Un simple retrait/
      // ajout synchrone SANS ce commit intermédiaire (ex. juste après container.
      // appendChild) ne suffit pas : un élément flambant neuf n'a alors encore jamais eu de
      // style résolu par le navigateur auquel comparer un changement (vérifié en pratique).
      if (fadeNewStep && isLastConfirmed && current) current = false;
      if (fadeNewStep && i === steps.length - 2) current = true;
      // C'est sur cette équation encadrée (la dernière obtenue) que les termes se
      // sélectionnent pour simplifier/factoriser/développer, pas sur la ligne "pending".
      var rowOpts = { pending: false, solved: solved, current: current };
      // `step.operator` (moteur en mode inégalité, voir createEngine/currentOperator dans
      // history.js) prime sur `opts.eqGlyph` (le "≠" fixe du cas dénominateur, Phase 1,
      // qui lui ne relabellise QUE la ligne finale une fois résolue) : une inégalité
      // affiche son PROPRE opérateur sur CHAQUE ligne confirmée, pas seulement la
      // dernière (son sens peut changer d'une étape à l'autre, voir "sens inversé"
      // ci-dessus).
      if (step.operator) rowOpts.eqGlyph = step.operator;
      else if (isLastConfirmed && solved && opts.eqGlyph) rowOpts.eqGlyph = opts.eqGlyph;
      if (isLastConfirmed && pending.opType !== 'expr') {
        // Pas de glisser-déposer au premier niveau sur le membre où l'on est "entré" (voir
        // pending.drilled) : évite la complexité d'un réordonnancement du membre pendant
        // qu'une sous-sélection intérieure y est en cours. L'AUTRE membre, lui, n'a aucune
        // raison de perdre son glisser-déposer — même logique que leftSelectable/
        // rightSelectable un peu plus haut, qui ne restreignent déjà, elles aussi, QUE le
        // membre "entré". Réordonner les termes À L'INTÉRIEUR du groupe où l'on est entré
        // reste par ailleurs possible (voir innerDraggableHere, câblé dans
        // renderSide/drilled) — mêmes conditions, sans exclure "drilled" lui-même, que ce
        // soit un FactorGroup classique ou une branche de ProductGroup (voir setInnerOrder
        // dans history.js, qui gère les deux cas).
        var innerDraggableHere = !pending.opType && !opts.noDrag;
        var draggableLeft = innerDraggableHere && !(pending.drilled && pending.drilled.side === 'left');
        var draggableRight = innerDraggableHere && !(pending.drilled && pending.drilled.side === 'right');
        rowOpts.leftOptions = selectDragOptions(leftSelected, leftSelectable, draggableLeft, innerDraggableHere, 'left');
        rowOpts.rightOptions = selectDragOptions(rightSelected, rightSelectable, draggableRight, innerDraggableHere, 'right');
      }
      var row = createRow(step.equation, rowOpts);
      container.appendChild(row);
      autoFitRowFont(row);
      if (isLastConfirmed) { framedRowEl = row; framedSolved = solved; }
      // Repère les deux lignes dont la classe "current" vient d'être délibérément inversée
      // ci-dessus (voir fadeNewStep) : `row` porte encore l'apparence "d'avant" à cet
      // instant (autoFitRowFont vient tout juste de la faire résoudre par le moteur de
      // style), le vrai basculement est fait juste après la fin de cette boucle.
      if (fadeNewStep && isLastConfirmed && !solved) fadeInEl = row;
      if (fadeNewStep && i === steps.length - 2) fadeOutEl = row;
      // Moteur en mode inégalité (step.operator, voir createEngine/currentOperator dans
      // history.js) dont CETTE étape a inversé le sens par rapport à la précédente (ex.
      // "÷(-2)") : rend l'inversion visible sur l'étiquette de la flèche elle-même,
      // plutôt qu'un simple changement silencieux de glyphe sur la ligne (voir aussi
      // eqGlyph dans createRow) — auto-appliqué (pas de clic de confirmation dédié, voir
      // le plan), donc d'autant plus important à signaler clairement ici.
      var flipped = step.operator && steps[i - 1] && steps[i - 1].operator &&
        steps[i - 1].operator !== step.operator;
      var opLeftLabel = formatOpLabel(step.opLeft);
      var opRightLabel = formatOpLabel(step.opRight);
      if (flipped) {
        if (opLeftLabel) opLeftLabel += '\\;(\\text{sens inversé})';
        if (opRightLabel) opRightLabel += '\\;(\\text{sens inversé})';
      }
      rowsData.push({
        el: row,
        opLeft: opLeftLabel,
        opRight: opRightLabel,
        opLeftWarn: descHasZeroRisk(step.opLeft),
        opRightWarn: descHasZeroRisk(step.opRight),
        pending: false
      });
    });

    // Bascule vers l'apparence RÉELLE, maintenant que autoFitRowFont a fait résoudre
    // l'apparence inversée ci-dessus par le moteur de style (voir fadeNewStep plus haut) :
    // ce changement de classe déclenche la transition CSS déclarée sur .eq-line.
    if (fadeInEl) fadeInEl.classList.add('current');
    if (fadeOutEl) fadeOutEl.classList.remove('current');

    var lastEq = engine.lastEquation();

    // La ligne "pending" (aperçu de la prochaine étape) n'existe QUE quand il y a
    // vraiment quelque chose à prévisualiser : voir shouldShowLivePreview — pas de
    // ligne fantôme permanente juste parce que l'équation n'est pas encore résolue.
    var showPendingRow = shouldShowLivePreview(pending, opts);
    var liveInfo = null;

    if (showPendingRow) {
      // Survol de "Opération" SANS l'avoir cliqué (voir isExprLikeActive) : ne PAS
      // passer par engine.computePreview() ici — son repli `!p.opType` prévisualise la
      // sélection libre en cours (Simplifier/Développer), une sélection qui peut très
      // bien traîner d'un survol précédent et n'a RIEN à voir avec "Opération". Un clic
      // sur "Opération" repart toujours d'une sélection vidée (voir selectOp dans
      // history.js) — l'aperçu au survol doit fidèlement montrer CE résultat-là (rien de
      // changé, chaîne vide), pas l'aperçu Simplifier/Développer de la sélection en cours.
      var preview = (pending.opType === null && App.Toolbar.getHoveredOp() === 'expr')
        ? { equation: lastEq, opLeft: null, opRight: null }
        : engine.computePreview();
      var pendingRow = createRow(preview.equation, { pending: true, solved: false });
      // "Pop" à l'apparition (voir .preview-pop-in dans style.css) : la ligne "pending"
      // est entièrement reconstruite à chaque rendu (jamais réutilisée, voir plus haut),
      // donc rejouer l'animation à CHAQUE rendu la ferait aussi rejouer alors que la ligne,
      // elle, reste continûment affichée depuis le rendu précédent — notamment le survol de
      // "Opération" suivi d'un clic dessus (voir selectOp dans history.js), ou taper un
      // caractère de plus dans la chaîne "Opération"/le facteur commun de "Factoriser" (voir
      // lastPendingShownByEngine tout en haut pour le détail des deux cas). Seul un vrai
      // passage "pas de ligne" -> "ligne" rejoue l'animation.
      var isNewPendingPreview = !lastPendingShownByEngine.get(engine);
      if (isNewPendingPreview) {
        pendingRow.classList.add('preview-pop-in');
        // Ne verrouille "déjà montré" qu'APRÈS ce tour synchrone (microtâche), pas tout de
        // suite : un même geste utilisateur peut déclencher PLUSIEURS rendus synchrones
        // d'affilée avant qu'aucun ne soit jamais peint — ex. la toute première frappe
        // d'"Opération" au clavier physique (voir keyboard.js) appelle coup sur coup
        // App.History.selectOp('expr') PUIS setExprChainText(key), chacun via notify() son
        // propre rendu complet de #history (voir plus haut : jamais réutilisé). Verrouiller
        // dès CE rendu-ci ferait manquer le "pop" sur le second (le seul réellement peint,
        // le premier étant aussitôt remplacé) puisqu'il verrait alors "déjà montré". Une
        // microtâche s'exécute après la fin de CE tour (donc après tous ses rendus
        // synchrones, mais avant le prochain rendu déclenché par un événement séparé,
        // ex. la frappe suivante, gérée nativement par le <math-field>) : tous les rendus
        // synchrones de CE tour voient donc encore "pas montré" et rejouent tous le "pop"
        // (sans effet visible en trop, seul le dernier de la série étant réellement peint),
        // tandis qu'un rendu d'un tour ULTÉRIEUR verra bien "déjà montré".
        Promise.resolve().then(function () { lastPendingShownByEngine.set(engine, true); });
      }
      container.appendChild(pendingRow);
      autoFitRowFont(pendingRow);
      // Quel(s) côté(s) doi(ven)t recevoir une flèche même sans étiquette (voir
      // isPendingLeftArrow/isPendingRightArrow dans arrows.js) : toujours les deux pour
      // 'expr' (opération TOUJOURS symétrique, y compris chaîne encore vide — voir
      // computeLiveOpInfo) ; pour tout le reste (factoriser, ou aperçu libre au survol de
      // Simplifier/Développer), seulement le(s) côté(s) où l'équation prévisualisée
      // diffère réellement de la dernière équation confirmée — sinon "factoriser"
      // (toujours un seul membre à la fois, voir factorTarget dans history.js) affichait
      // à tort une flèche des deux côtés pendant l'aperçu, corrigée seulement une fois
      // validé.
      var pendingLeftChanged = JSON.stringify(preview.equation.left) !== JSON.stringify(lastEq.left);
      var pendingRightChanged = JSON.stringify(preview.equation.right) !== JSON.stringify(lastEq.right);
      rowsData.push({
        el: pendingRow,
        opLeft: formatOpLabel(preview.opLeft),
        opRight: formatOpLabel(preview.opRight),
        opLeftWarn: descHasZeroRisk(preview.opLeft),
        opRightWarn: descHasZeroRisk(preview.opRight),
        pending: true,
        pendingForceLeft: isExprLikeActive(pending) || pendingLeftChanged,
        pendingForceRight: isExprLikeActive(pending) || pendingRightChanged,
        // Voir isNewPendingPreview ci-dessus : la flèche qui mène à cette ligne ne doit,
        // elle non plus, se "tracer" que quand la ligne est une vraie nouveauté (voir
        // isGrowingArrow dans arrows.js), jamais en continuation d'un aperçu déjà montré.
        pendingIsNew: isNewPendingPreview
      });
      liveInfo = computeLiveOpInfo(pending, preview);
    } else {
      lastPendingShownByEngine.delete(engine);
    }

    return { rowsData: rowsData, framedRowEl: framedRowEl, framedSolved: framedSolved, liveInfo: liveInfo };
  }

  // Ligne juste AU-DESSUS de `framedEl` (la ligne "current") dans `rowsData` — jamais la
  // ligne "pending" elle-même si `renderChain` en a ajouté une en dernière position (voir
  // showPendingRow ci-dessus) : cette dernière n'est pas "au-dessus" de `framedEl`, elle
  // vient APRÈS. Sert de limite haute à App.Toolbar.positionPanel.
  function findPrevRowEl(rowsData, framedEl) {
    for (var i = 0; i < rowsData.length; i++) {
      if (rowsData[i].el === framedEl) return i > 0 ? rowsData[i - 1].el : null;
    }
    return null;
  }

  // Valeur de x une fois une branche résolue (voir Equation.isSolved : un membre "x",
  // l'autre une constante).
  function extractRoot(eq) {
    var leftIsX = Expr.sideIsSingleTerm(eq.left) && eq.left[0].pow === 1;
    return (leftIsX ? eq.right : eq.left)[0].coeff;
  }

  function renderAll() {
    var Hist = App.History;
    var history = document.getElementById('history');
    var scroller = document.getElementById('historyScroll');
    if (!history) return;
    // Capturé AVANT de retomber tout de suite à `false` (voir isInitialMount tout en haut
    // du fichier pour la raison de cette capture immédiate plutôt qu'en toute fin de
    // fonction) : tout code ci-dessous, y compris à l'intérieur d'un requestAnimationFrame
    // planifié plus bas, doit lire CETTE variable locale — jamais isInitialMount
    // directement, qui a déjà basculé par la ligne suivante.
    var wasInitialMount = isInitialMount;
    isInitialMount = false;
    // Voir renderSeq tout en haut du fichier : capturé ici, comparé dans chaque rAF
    // planifié plus bas pour ignorer un callback devenu périmé.
    renderSeq += 1;
    var mySeq = renderSeq;
    function isStaleRender() { return mySeq !== renderSeq; }
    history.innerHTML = '';

    var branches = Hist.getBranches();
    // Nouvelle scission (aucune branche juste avant) : réaffiche le liseré par défaut,
    // voir hadBranches/branchOutlineVisible tout en haut.
    if (branches && !hadBranches) branchOutlineVisible = true;
    hadBranches = !!branches;
    history.classList.toggle('produit-nul-active', !!branches);
    var scrollTarget = null;   // ligne à recentrer à l'écran
    var scrollIdentity = null; // objet comparé à lastCenteredStepByEngine.get(scrollEngine)
    var scrollEngine = Hist;   // moteur possédant scrollIdentity (clé du suivi par moteur)
    // La fenêtre flottante des boutons d'action (voir App.Toolbar.positionPanel) cible
    // toujours la même ligne que `scrollTarget` (la ligne "current") ; `opPrevRowEl`
    // (celle juste au-dessus dans la MÊME chaîne, ou null) lui sert de limite haute dure.
    var opPrevRowEl = null;
    // Une fois l'équation encadrée résolue ("x=...", voir framedSolved dans renderChain),
    // plus aucune opération n'a de sens dessus : la fenêtre d'action disparaît entièrement
    // plutôt que de rester affichée avec ses boutons pour la plupart grisés.
    var scrollTargetSolved = false;

    // Rend un noeud de l'arbre de scission ("Produit nul"/"Racine carrée") dans
    // `container` : soit une feuille (renderChain, comme avant la scission récursive),
    // soit — si `engine` a lui-même été scindé À NOUVEAU (ex. une identité remarquable
    // produisant un carré parfait à l'intérieur d'une colonne "Produit nul", résolu
    // ensuite par "Racine carrée" DANS cette colonne) — ses propres pas gelés suivis
    // d'une scission imbriquée, plus sobre que celle du tout premier niveau (voir
    // .produit-nul-split-nested dans style.css : pas de padding 50vw ni de
    // centrage/défilement dédié, l'espace disponible est déjà celui, réduit, de la
    // colonne parente). Entièrement autonome (dessine ses propres flèches, y compris la
    // fourche vers ses enfants) — le premier niveau (ci-dessous) et les niveaux plus
    // profonds (récursion) l'utilisent de façon identique. `opts` : mêmes clés que pour
    // renderChain (onBeforeAction/focused/noDrag). Renvoie { rowsData, framedRowEl,
    // framedSolved, liveInfo } du noeud FEUILLE réellement focalisé (bulle à travers
    // toute la récursion, quelle que soit la profondeur), PLUS `scrollEngine` (ce même
    // noeud feuille, pour le suivi de recentrage par moteur) et `leafEngines` (TOUTES les
    // feuilles de ce sous-arbre, focalisées ou non — pour le pré-marquage "déjà vu" des
    // branches non actives et pour le résumé final une fois tout résolu, voir plus bas).
    function renderBranchNode(engine, container, opts) {
      opts = opts || {};
      var nodeBranches = engine.getBranches();

      if (!nodeBranches) {
        var leafRes = renderChain(engine, container, opts);
        if (!leafRes.liveInfo) App.MathKeypad.hideLiveOpPill();
        // Neutralise le margin-bottom (46px, voir .eq-row) de la DERNIÈRE ligne : sans
        // ça, il s'ajoute au padding bas de .produit-nul-branch et l'espace en bas de la
        // colonne devient nettement plus grand qu'en haut. Fait en JS (pas en CSS
        // :last-child/:last-of-type) car drawAll (arrows.js) ajoute ensuite le calque SVG
        // ET des .arrow-label (des <div>, comme .eq-row) comme frères APRÈS les lignes
        // dans ce même conteneur — aucun sélecteur structurel ne cible alors plus la
        // bonne ligne une fois les flèches dessinées. Fait ICI (juste après renderChain,
        // avant tout ajout de flèche) pour cibler la dernière ligne de façon fiable. Sans
        // risque de viser la mauvaise ligne malgré `container.querySelectorAll` (pas
        // `:scope >`) : renderChain ne remplit ce conteneur que de vraies `.eq-row`
        // (jamais de sous-arbre imbriqué, réservé au cas `nodeBranches` ci-dessous).
        var leafRows = container.querySelectorAll('.eq-row');
        if (leafRows.length > 0) leafRows[leafRows.length - 1].classList.add('eq-row-flush-bottom');
        requestAnimationFrame(function () {
          if (isStaleRender()) return;
          // constrainLabels : les étiquettes d'opération restent DANS cette colonne,
          // jamais à cheval sur la colonne voisine (juxtaposées, séparées de 56px seulement).
          var leafDrawOpts = { constrainLabels: true };
          if (leafRes.liveInfo) leafDrawOpts.live = leafRes.liveInfo;
          App.Arrows.drawAll(container, leafRes.rowsData, leafDrawOpts);
        });
        return {
          rowsData: leafRes.rowsData,
          framedRowEl: leafRes.framedRowEl,
          framedSolved: leafRes.framedSolved,
          liveInfo: leafRes.liveInfo,
          scrollEngine: engine,
          leafEngines: [engine]
        };
      }

      var ownSteps = engine.getOwnSteps();
      var ownRowsData = [];
      ownSteps.forEach(function (step) {
        // Jamais "current" (encadré bleu) : une fois ce noeud scindé, ce n'est plus la
        // ligne active — ce sont ses enfants ci-dessous, chacun avec son propre cadre.
        var row = createRow(step.equation, { pending: false, solved: false, current: false });
        container.appendChild(row);
        autoFitRowFont(row);
        ownRowsData.push({
          el: row,
          opLeft: formatOpLabel(step.opLeft),
          opRight: formatOpLabel(step.opRight),
          opLeftWarn: descHasZeroRisk(step.opLeft),
          opRightWarn: descHasZeroRisk(step.opRight),
          pending: false
        });
      });

      var nestedWrap = document.createElement('div');
      nestedWrap.className = 'produit-nul-split produit-nul-split-nested';
      container.appendChild(nestedWrap);

      var focusedIdx = engine.getFocusedBranch();
      var leafEngines = [];
      var colEls = [];
      var focusedChildRes = null;
      nodeBranches.forEach(function (child, idx) {
        var col = document.createElement('div');
        // Colonne pas sur le chemin réellement focalisé (soit un autre enfant ICI, soit
        // ce noeud lui-même déjà hors chemin — `opts.focused === false`, ex. un ancêtre
        // qui a lui-même perdu le focus au profit d'une AUTRE colonne de premier niveau) :
        // jamais d'aperçu en direct plus bas (voir shouldShowLivePreview dans renderChain),
        // ET jamais son propre liseré de focus ci-dessous non plus — sans le second membre
        // de cette condition, une sous-colonne gardait à tort son liseré ".branch-focused"
        // (mémoire purement interne à SON PROPRE moteur, voir focusedIdx ci-dessus,
        // totalement indépendante du chemin réellement actif) même après avoir basculé sur
        // une colonne de premier niveau différente — ressemblant à tort à une sélection
        // toujours active.
        var childFocused = opts.focused !== false && focusedIdx === idx;
        // `child.getBranches()` (déjà connu ICI, avant tout DOM) plutôt que le sélecteur
        // CSS ":has(.produit-nul-split-nested)" : `col` est ajouté au DOM AVANT que
        // renderBranchNode(child, ...) n'y insère lui-même ce wrap imbriqué plus bas — une
        // mesure forcant la mise en page (autoFitRowFont notamment) entre les deux
        // surprendrait alors ":has()" en plein "faux" état (colonne focalisée SANS
        // descendant imbriqué), démarrant à tort la transition CSS du liseré (voir
        // .produit-nul-branch.branch-focused ci-dessous) — clignotement au moindre
        // nouveau rendu (ex. survol du bouton "Opération" plus bas dans l'arbre). La classe
        // ci-dessous est connue et posée AVANT la moindre insertion DOM : aucune fenêtre
        // d'état intermédiaire n'est jamais observable.
        // `&& branchOutlineVisible` : voir tout en haut du fichier — un clic en dehors de
        // toute colonne masque le liseré sans toucher `childFocused`/le focus réel.
        col.className = 'produit-nul-branch' + ((childFocused && branchOutlineVisible) ? ' branch-focused' : '') +
          (child.getBranches() ? ' produit-nul-branch-resplit' : '');
        col.addEventListener('click', function () { engine.setFocusedBranch(idx); });
        var chainEl = document.createElement('div');
        chainEl.className = 'produit-nul-chain';
        col.appendChild(chainEl);
        nestedWrap.appendChild(col);
        colEls.push(col);

        var childRes = renderBranchNode(child, chainEl, {
          noDrag: true, // simplifie le focus multi-branches (voir la tâche associée)
          onBeforeAction: function () {
            if (opts.onBeforeAction) opts.onBeforeAction();
            engine.focusBranch(idx);
          },
          // Variante NON silencieuse de onBeforeAction ci-dessus (même chaînage parent
          // d'abord) : déclenche un vrai rendu à chaque niveau, pour le cas où AUCUNE
          // action réelle ne suit (un premier clic dans une colonne pas encore focalisée,
          // voir onTermClick/onInnerClick/onExitDrill plus haut) — sans quoi la focalisation
          // resterait invisible (état interne à jour, DOM jamais redessiné).
          notifyFocus: function () {
            if (opts.notifyFocus) opts.notifyFocus();
            engine.setFocusedBranch(idx);
          },
          focused: childFocused
        });
        if (idx === focusedIdx) {
          focusedChildRes = childRes;
        } else {
          // Pré-marque les feuilles de CET enfant comme "déjà vues" (voir
          // lastCenteredStepByEngine tout en haut) : sans ça, cliquer pour focaliser une
          // colonne DÉJÀ affichée à l'écran (juste pas encore "vue" du point de vue du
          // suivi par moteur) déclencherait à tort un recentrage la première fois — comme
          // si elle venait d'apparaître. Sans danger de masquer une VRAIE nouvelle étape :
          // interagir avec une branche la focalise TOUJOURS d'abord (voir onBeforeAction
          // ci-dessus), donc une branche non focalisée ne peut jamais gagner de nouvelle
          // étape pendant qu'elle ne l'est pas. La branche focalisée, elle, n'est PAS
          // pré-marquée ici : c'est le contrôle dédié en fin de renderAll qui décide pour
          // elle, en comparant à la dernière valeur réellement enregistrée.
          childRes.leafEngines.forEach(function (leafEng) {
            var leafSteps = leafEng.getSteps();
            lastCenteredStepByEngine.set(leafEng, leafSteps[leafSteps.length - 1]);
          });
        }
        leafEngines = leafEngines.concat(childRes.leafEngines);
      });

      requestAnimationFrame(function () {
        if (isStaleRender()) return;
        var lastOwnEqSign = ownRowsData.length
          ? ownRowsData[ownRowsData.length - 1].el.querySelector('.eq-sign') : null;
        App.Arrows.drawAll(container, ownRowsData, {
          constrainLabels: true,
          fork: { from: lastOwnEqSign, to: colEls, label: engine.getBranchSplitLabel() }
        });
      });

      return {
        rowsData: focusedChildRes.rowsData,
        framedRowEl: focusedChildRes.framedRowEl,
        framedSolved: focusedChildRes.framedSolved,
        liveInfo: focusedChildRes.liveInfo,
        scrollEngine: focusedChildRes.scrollEngine,
        leafEngines: leafEngines
      };
    }

    // Ensemble-solution en notation LaTeX d'UNE colonne "Condition d'existence" déjà
    // résolue (voir conditionDfLatex ci-dessous pour son usage dans la combinaison finale
    // "Df=..."), ou null tant qu'elle ne l'est pas encore : "Étude de signe" menée jusqu'au
    // bout (getSignStudyResult, Phase 3) donne directement l'intervalle ; sinon
    // App.Equation.isSolved/solvedValue (opérateur-agnostique, voir equation.js) — un
    // dénominateur (kind==='den', jamais d'opérateur/currentOperator) donne "x=r" à LIRE
    // "x≠r" (voir CLAUDE.md/le plan), soit R\{r} ; un radicand linéaire (kind==='sqrt',
    // toujours un `step.operator`, voir history.js) donne directement "x<op>r", une
    // demi-droite (voir App.Ineq.halfLineLatex).
    function conditionSetLatex(cond) {
      var signStudyResult = cond.engine.getSignStudyResult();
      if (signStudyResult) return signStudyResult;
      var eq = cond.engine.lastEquation();
      if (!App.Equation.isSolved(eq)) return null;
      var r = App.Equation.solvedValue(eq);
      if (cond.kind === 'den') return '\\mathbb{R}\\setminus\\left\\{' + r + '\\right\\}';
      var steps = cond.engine.getSteps();
      var operator = steps[steps.length - 1].operator || '\\geq';
      return App.Ineq.halfLineLatex(r, operator);
    }

    // "Condition d'existence" (domaine de définition) : une colonne indépendante par
    // dénominateur/radicand pour lequel l'élève a cliqué ce bouton (voir
    // existenceConditionAction dans history.js) — COEXISTE avec la chaîne principale
    // (contrairement à "Produit nul"/"Racine carrée", qui la remplacent) : un clic dans
    // une colonne focalise CETTE colonne (Hist.setFocusedDomain) pour le pavé/clavier
    // partagé, un clic dans la chaîne principale y rend la main (Hist.focusMain, câblé
    // juste au-dessus). Chaque colonne est rendue via renderBranchNode, exactement comme
    // une branche "Produit nul" (même récursion, même interactivité) — seule la mise en
    // page du wrapper diffère (voir .domain-split/.domain-group dans style.css : le
    // groupe entier est positionné À CÔTÉ de la chaîne principale par positionDomainGroup,
    // appelé depuis renderAll une fois la mise en page connue). Pas de fourche dessinée
    // depuis le terme drillé d'origine ici (son ancre \htmlId ne survit pas forcément —
    // l'élève peut depuis ressortir du drill ou faire avancer la chaîne principale) :
    // polish déféré, voir le plan. Renvoie le groupe créé (jamais encore positionné : voir
    // positionDomainGroup) pour que l'appelant le positionne après mise en page.
    function renderDomainSplit(engineRoot, historyEl, conditions, focusedDomainIdx) {
      var group = document.createElement('div');
      group.className = 'domain-group';
      historyEl.appendChild(group);

      var header = document.createElement('div');
      header.className = 'domain-split-header';
      header.textContent = 'Domaine de définition';
      group.appendChild(header);

      var wrap = document.createElement('div');
      wrap.className = 'domain-split';
      group.appendChild(wrap);

      conditions.forEach(function (cond, idx) {
        var col = document.createElement('div');
        var isFocused = focusedDomainIdx === idx;
        col.className = 'produit-nul-branch domain-branch' +
          ((isFocused && branchOutlineVisible) ? ' branch-focused' : '');
        col.setAttribute('data-domain-index', String(idx));
        col.addEventListener('click', function () { engineRoot.setFocusedDomain(idx); });
        var chainEl = document.createElement('div');
        chainEl.className = 'produit-nul-chain';
        col.appendChild(chainEl);
        wrap.appendChild(col);

        renderBranchNode(cond.engine, chainEl, {
          noDrag: true,
          onBeforeAction: function () { engineRoot.focusDomain(idx); },
          notifyFocus: function () { engineRoot.setFocusedDomain(idx); },
          focused: isFocused,
          eqGlyph: cond.operator
        });

        // "Étude de signe" menée jusqu'au bout (voir chooseSignStudyInterval/
        // getSignStudyResult dans history.js, Phase 3 du plan) : l'équation elle-même
        // reste affichée sous forme de produit ((x-a)(x+a)≥0, jamais réduite à "x=..."),
        // donc PAS "solved" au sens habituel (Equation.isSolved) — l'ensemble solution
        // final s'affiche ICI, comme un résumé supplémentaire sous la colonne, même
        // habillage visuel que le résumé "S={...}" de Produit nul (.solution-set).
        var signStudyResult = cond.engine.getSignStudyResult();
        if (signStudyResult) {
          var resultEl = document.createElement('div');
          resultEl.className = 'solution-set domain-signstudy-result';
          window.katex.render('x\\in' + signStudyResult, resultEl, { throwOnError: false });
          col.appendChild(resultEl);
        }
      });

      // "Df=cond1∩cond2∩..." (voir le plan) : seulement une fois CHAQUE colonne résolue
      // (conditionSetLatex non nul pour toutes) — recalculé à chaque rendu, jamais mis en
      // cache (comparativement bon marché, même principe que le résumé "S={...}" de
      // Produit nul).
      var allSetLatex = conditions.map(conditionSetLatex);
      if (allSetLatex.length && allSetLatex.every(function (l) { return l !== null; })) {
        var dfEl = document.createElement('div');
        dfEl.className = 'solution-set domain-df-result';
        window.katex.render('D_f=' + allSetLatex.join('\\cap'), dfEl, { throwOnError: false });
        group.appendChild(dfEl);
      }

      return group;
    }

    // Positionne `group` (le résultat de renderDomainSplit) À CÔTÉ de la dernière ligne de
    // la chaîne principale (`refRowEl`, ex. res.framedRowEl) plutôt qu'en-dessous : même
    // conversion écran -> local (diviser par App.Canvas.getScale()) que le recentrage
    // automatique de renderAll/panToDomainColumn — #history (position:relative) sert
    // d'ancre pour ce `position:absolute` (voir .domain-group dans style.css). Appelé
    // depuis un requestAnimationFrame (comme drawAll) : la mise en page (largeur réelle
    // de `group`, notamment) doit déjà être connue.
    function positionDomainGroup(group, historyEl, refRowEl) {
      if (!refRowEl) { group.style.visibility = 'hidden'; return; }
      var scale = App.Canvas.getScale();
      var historyRect = historyEl.getBoundingClientRect();
      var refRect = refRowEl.getBoundingClientRect();
      var GAP = 64;
      group.style.left = ((refRect.right - historyRect.left) / scale + GAP) + 'px';
      group.style.top = (refRect.top - historyRect.top) / scale + 'px';
      group.style.visibility = 'visible';
    }

    if (!branches) {
      // Cas normal (pas de "produit nul" en cours) : une seule chaîne, comme avant — via
      // Hist.getLeaf() (jamais Hist directement) pour ne JAMAIS suivre la délégation
      // "Condition d'existence" (Hist.getFocusedDomain(), voir history.js) ICI : la
      // chaîne principale reste TOUJOURS affichée/interactive pour elle-même, qu'une
      // colonne de domaine soit focalisée ou non (voir renderDomainSplit plus bas, qui
      // s'occupe de CETTE colonne-là séparément). Un premier clic dans la chaîne
      // principale pendant qu'une colonne de domaine est focalisée se contente d'y
      // rendre la main (voir notifyFocus/Hist.focusMain), sans agir — même principe
      // qu'un premier clic dans une colonne "Produit nul" pas encore active.
      var mainEngine = Hist.getLeaf();
      var mainFocused = Hist.getFocusedDomain() === null;
      var res = renderChain(mainEngine, history, {
        notifyFocus: function () { Hist.focusMain(); },
        focused: mainFocused
      });
      scrollTarget = res.framedRowEl;
      scrollTargetSolved = res.framedSolved;
      opPrevRowEl = findPrevRowEl(res.rowsData, res.framedRowEl);
      var steps = mainEngine.getSteps();
      scrollIdentity = steps[steps.length - 1];

      // Décision de visibilité du pavé "live" (voir computeLiveOpInfo) : masquée tout de
      // suite et de façon SYNCHRONE (jamais depuis le rAF différé de drawAll plus bas) si
      // rien n'est "live" cette fois-ci — sinon il resterait visible un instant à sa
      // dernière position connue, potentiellement obsolète, jusqu'au prochain rendu.
      // Positionné/montré, lui, uniquement par drawAll (voir drawOpts.live ci-dessous) :
      // seule cette étape différée connaît les coordonnées réelles après mise en page.
      if (!res.liveInfo) App.MathKeypad.hideLiveOpPill();

      // Aperçu de "Produit nul" (survol de son bouton, voir previewProduitNul dans
      // history.js) ou de "Racine carrée" (une fois la touche √ du pavé "Opération"
      // ARMÉE — voir pending.sqrtArmed, pas dès qu'elle est simplement cliquable : sinon
      // l'aperçu apparaîtrait dès l'ouverture d'"Opération" sans action explicite de
      // l'élève, en plus de la ligne "pending" générique du mode 'expr', donnant
      // l'impression d'un aperçu en double) : montre à quoi ressembleraient les colonnes
      // ET la flèche fourchue AVANT de cliquer "Valider" — purement visuel (aucune
      // branche réelle créée, lignes non interactives, voir .produit-nul-preview).
      // Disparaît tout seul au prochain rendu dès que la condition n'est plus remplie.
      // Tout ce bloc d'aperçu au survol (Produit nul/Racine carrée) ne s'applique QUE
      // quand la chaîne principale est bien la cible active : une colonne de domaine
      // focalisée gère ses propres actions (via renderBranchNode plus bas), sans aperçu
      // de survol dédié — même simplification déjà en place pour toute colonne "Produit
      // nul"/"Racine carrée" imbriquée (voir renderBranchNode, qui n'a jamais eu ce
      // bloc non plus).
      var previewEquations = null;
      var previewLabel = null;
      // "sqrt-family" (envelopper à l'étape 1, simplifier à l'étape 2) : un aperçu à UNE
      // seule équation (constante nulle, voir confirmSquareRoot/pushStep dans history.js)
      // doit s'effondrer en ligne "pending" normale plutôt qu'en "fourche" à une seule
      // branche — contrairement à "Produit nul", qui garde sa mise en page en colonnes
      // même pour un seul facteur distinct (voir plus bas).
      var previewCollapsible = false;
      // Mode 'calc' de squareRootSimplifyAction (un seul membre sélectionné et calculé,
      // voir plus bas) : seul CE côté change, l'étiquette ne doit apparaître QUE dessus —
      // sinon null, comme confirmSquareRoot/pushAsymmetricStep pour l'étape confirmée.
      var previewOnlySide = null;
      var previewCols = null;
      if (mainFocused) {
        if (App.Toolbar.getHoveredOp() === 'produitnul') {
          previewEquations = Hist.previewProduitNul();
          previewLabel = '\\text{produit nul}';
        } else if (Hist.getPending().opType === 'expr' && Hist.getPending().sqrtArmed) {
          previewEquations = Hist.previewSquareRoot();
          previewLabel = '\\sqrt{\\phantom{x}}';
          previewCollapsible = true;
        } else {
          var sqrtAction = App.Toolbar.getHoveredOp() === 'simplify' ? Hist.squareRootAction() : null;
          if (sqrtAction) {
            // Survol de "Simplifier" alors que la sélection en cours cible l'étape 2 de
            // "Racine carrée" (voir squareRootSimplifyAction/computeSelectionInfo) : même
            // aperçu que l'étape 1 ci-dessus (une seule équation en mode 'calc', qui ne
            // scinde jamais ; ± scindé en mode 'split'/'both'), mais étiqueté "simplifier"
            // (voir confirmSquareRoot dans history.js, qui utilise ce même libellé pour
            // l'étape confirmée) plutôt que le symbole "√", puisque c'est désormais ce
            // bouton-ci qui la déclenche.
            previewEquations = Hist.previewSquareRoot();
            previewLabel = '\\text{simplifier}';
            previewCollapsible = true;
            if (sqrtAction.mode === 'calc') previewOnlySide = sqrtAction.side;
          }
        }
        if (previewEquations && previewEquations.length === 1 && previewCollapsible) {
          var soleRowEl = createRow(previewEquations[0], { pending: true, solved: false, current: false });
          soleRowEl.classList.add('preview-pop-in');
          history.appendChild(soleRowEl);
          var soleOpLeft = previewOnlySide === 'right' ? null : previewLabel;
          var soleOpRight = previewOnlySide === 'left' ? null : previewLabel;
          res.rowsData.push({ el: soleRowEl, opLeft: soleOpLeft, opRight: soleOpRight, pending: true });
        } else if (previewEquations) {
          // PAS .produit-nul-split (dont le padding de 50vw sert uniquement à permettre,
          // une fois une VRAIE scission confirmée, de défiler assez loin pour recentrer
          // n'importe quelle colonne — inutile et contre-productif ici, cet aperçu est
          // éphémère et doit juste apparaître centré là où il est, sans logique de
          // défilement dédiée) : mise en page simple et indépendante, voir style.css.
          var previewWrap = document.createElement('div');
          previewWrap.className = 'produit-nul-preview preview-pop-in';
          history.appendChild(previewWrap);
          previewCols = previewEquations.map(function (eqPrev) {
            var col = document.createElement('div');
            col.className = 'produit-nul-branch';
            var chainEl = document.createElement('div');
            chainEl.className = 'produit-nul-chain';
            chainEl.appendChild(createRow(eqPrev, { pending: false, solved: false, current: false }));
            col.appendChild(chainEl);
            previewWrap.appendChild(col);
            return col;
          });
        }
      }

      requestAnimationFrame(function () {
        if (isStaleRender()) return;
        var drawOpts = {};
        if (previewCols) {
          var lastEqSign = res.rowsData.length
            ? res.rowsData[res.rowsData.length - 1].el.querySelector('.eq-sign') : null;
          // preview:true (voir drawFork dans arrows.js) : SEULE cette fourche, purement
          // visuelle et éphémère, doit se tracer progressivement — la vraie scission
          // confirmée (autre appel à drawAll, ailleurs dans ce fichier) reste instantanée.
          drawOpts.fork = { from: lastEqSign, to: previewCols, label: previewLabel, preview: true };
        }
        if (res.liveInfo) drawOpts.live = res.liveInfo;
        App.Arrows.drawAll(history, res.rowsData, drawOpts);
      });

      // "Condition d'existence" (domaine de définition, voir Hist.getDomainConditions
      // dans history.js) : rendue APRÈS la chaîne principale, toujours (indépendamment de
      // mainFocused) — ces colonnes existent quel que soit ce qui est actuellement
      // focalisé. Voir renderDomainSplit plus bas pour la mise en page (volontairement
      // simple en v1, voir style.css).
      var domainConditionsArr = Hist.getDomainConditions();
      if (domainConditionsArr && domainConditionsArr.length) {
        var domainGroupEl = renderDomainSplit(Hist, history, domainConditionsArr, Hist.getFocusedDomain());
        var domainRefRowEl = res.framedRowEl;
        requestAnimationFrame(function () {
          if (isStaleRender()) return;
          positionDomainGroup(domainGroupEl, history, domainRefRowEl);
        });
      }
    } else {
      // Scission en cours ("Produit nul" ou "Racine carrée") : la chaîne principale
      // reste affichée, figée (plus de ligne "pending" dessus — la suite, ce sont les N
      // facteurs/cas ci-dessous), puis les N équations côte à côte, chacune travaillable
      // indépendamment (cliquer dans l'une la rend "active" pour le pavé/clavier, voir
      // focusBranch). N est variable (1 à l'infini en théorie) : voir
      // Expr.flattenProductFactors/sidesEquivalent pour "Produit nul" (facteurs
      // dupliqués fusionnés en une seule colonne, ex. "(a+bx)²=0" -> 1 colonne,
      // "(a+b)(c+d)²=0" -> 2), et confirmSquareRoot dans history.js pour "Racine carrée"
      // (1 colonne si la constante vaut 0, 2 sinon).
      var primarySteps = Hist.getOwnSteps();
      var primaryRowsData = [];
      primarySteps.forEach(function (step) {
        // Jamais "current" (encadré bleu) : une fois scindée, ce n'est plus la ligne
        // active — ce sont les branches ci-dessous, chacune avec son propre cadre.
        var row = createRow(step.equation, { pending: false, solved: false, current: false });
        history.appendChild(row);
        autoFitRowFont(row);
        primaryRowsData.push({
          el: row,
          opLeft: formatOpLabel(step.opLeft),
          opRight: formatOpLabel(step.opRight),
          opLeftWarn: descHasZeroRisk(step.opLeft),
          opRightWarn: descHasZeroRisk(step.opRight),
          pending: false
        });
      });

      var splitWrap = document.createElement('div');
      splitWrap.className = 'produit-nul-split';
      history.appendChild(splitWrap);

      var focused = Hist.getFocusedBranch();
      var branchResults = branches.map(function (engine, idx) {
        var col = document.createElement('div');
        // Voir le commentaire jumeau dans renderBranchNode (nodeBranches.forEach) : même
        // classe posée avant toute insertion DOM, pour la même raison (évite le
        // clignotement du liseré via ":has()" pris en flagrant délit d'état intermédiaire).
        // `&& branchOutlineVisible` : voir tout en haut du fichier.
        col.className = 'produit-nul-branch' + ((focused === idx && branchOutlineVisible) ? ' branch-focused' : '') +
          (engine.getBranches() ? ' produit-nul-branch-resplit' : '');
        col.addEventListener('click', function () { Hist.setFocusedBranch(idx); });
        var chainEl = document.createElement('div');
        chainEl.className = 'produit-nul-chain';
        col.appendChild(chainEl);
        splitWrap.appendChild(col);

        var branchRes = renderBranchNode(engine, chainEl, {
          noDrag: true, // simplifie le focus multi-branches (voir la tâche associée)
          onBeforeAction: function () { Hist.focusBranch(idx); },
          // Variante NON silencieuse de onBeforeAction ci-dessus, pour le cas où AUCUNE
          // action réelle ne suit (voir le même commentaire dans le renderBranchNode
          // imbriqué plus haut, et onTermClick/onInnerClick/onExitDrill dans renderChain).
          notifyFocus: function () { Hist.setFocusedBranch(idx); },
          // Colonne pas active : jamais d'aperçu en direct (voir shouldShowLivePreview),
          // même si une sélection ou un survol y correspondrait par ailleurs.
          focused: focused === idx
        });
        // Pré-marque les feuilles des branches PAS focalisées comme "déjà vues" (voir
        // lastCenteredStepByEngine tout en haut, et le même principe pour les niveaux
        // plus profonds dans renderBranchNode) : sans ça, cliquer pour focaliser une
        // colonne DÉJÀ affichée à l'écran (juste pas encore "vue" du point de vue du
        // suivi par moteur) déclencherait à tort un recentrage la première fois — comme
        // si elle venait d'apparaître. Sans danger de masquer une VRAIE nouvelle étape :
        // interagir avec une branche la focalise TOUJOURS d'abord (voir onBeforeAction
        // ci-dessus), donc une branche non focalisée ne peut jamais gagner de nouvelle
        // étape pendant qu'elle ne l'est pas. La branche focalisée, elle, n'est PAS
        // pré-marquée ici : c'est le contrôle dédié en fin de fonction qui décide pour
        // elle, en comparant à la dernière valeur réellement enregistrée.
        if (idx !== focused) {
          branchRes.leafEngines.forEach(function (leafEng) {
            var leafSteps = leafEng.getSteps();
            lastCenteredStepByEngine.set(leafEng, leafSteps[leafSteps.length - 1]);
          });
        }
        return { container: chainEl, col: col, res: branchRes };
      });

      // .produit-nul-split a TOUJOURS une largeur intrinsèque + un padding de 50vw de
      // chaque côté (voir style.css) pour permettre un défilement ample — mesuré
      // directement sur chaque colonne (offsetWidth), pas via splitWrap.scrollWidth : un
      // débordement symétrique via "justify-content:center" peut être sous-évalué par
      // scrollWidth côté "négatif" (gauche), le rendant peu fiable ici. Comparé à
      // scroller.clientWidth (jamais affecté par un éventuel élargissement de #history
      // posé PAR UN RENDU PRÉCÉDENT, voir plus bas) plutôt qu'à history.clientWidth : ce
      // dernier aurait fallu d'abord réinitialiser (history.style.width='') pour mesurer
      // sa largeur "naturelle" à chaque rendu, ce qui rétrécit #history un instant AVANT
      // de la réélargir — le navigateur "clampe" alors silencieusement scrollLeft à cette
      // largeur transitoire trop étroite, d'où le double-saut visuel observé (la page
      // saute d'abord à l'ancienne position "mal alignée", puis se corrige).
      // scroller.clientWidth évite totalement ce problème : il ne dépend jamais de la
      // largeur de #history, donc jamais besoin de la réinitialiser pour le lire.
      var columnsNaturalWidth = branchResults.reduce(function (sum, b, i) {
        return sum + b.col.offsetWidth + (i > 0 ? 90 : 0); // 90 = gap, voir .produit-nul-split
      }, 0);
      var canvasScale = App.Canvas.getScale();
      // offsetWidth ci-dessus est mesuré dans le repère LOCAL de #canvasLayer (le zoom,
      // une transform CSS, ne change jamais la mise en page ni les offsetWidth de ses
      // descendants — seulement leur taille PEINTE) : on divise donc le seuil de
      // comparaison (scroller.clientWidth, un repère ÉCRAN) par l'échelle courante plutôt
      // que de multiplier columnsNaturalWidth, pour rester dans ce même repère local.
      var isWideSplit = columnsNaturalWidth > (scroller ? scroller.clientWidth / canvasScale : history.clientWidth / canvasScale);
      splitWrap.classList.toggle('produit-nul-split-wide', isWideSplit);
      if (isWideSplit) {
        // Les colonnes ne tiennent pas dans la largeur normale de #history : plutôt que
        // de décaler .produit-nul-split par une marge négative (ce qui la ferait déborder
        // NÉGATIVEMENT par rapport à #history — un débordement qu'aucun défilement ne
        // peut atteindre dans Chromium, même limitation que le padding de
        // .produit-nul-split ci-dessus, un cran plus haut), on élargit #history LUI-MÊME
        // pour qu'il corresponde EXACTEMENT à la largeur intrinsèque (offsetWidth) de
        // .produit-nul-split (laissée "flush", margin-left:0). Chaque .eq-row de la
        // chaîne principale, qui remplit #history et centre son contenu dedans (justify-
        // content:center), se retrouve alors centrée EXACTEMENT sur le même point que le
        // groupe de colonnes — les deux partagent la même boîte de centrage, aucune marge
        // ni calcul de défilement risqué n'est nécessaire pour les aligner.
        splitWrap.style.marginLeft = '0';
        var historyPaddingX = (parseFloat(getComputedStyle(history).paddingLeft) || 0) +
          (parseFloat(getComputedStyle(history).paddingRight) || 0);
        history.style.width = (splitWrap.offsetWidth + historyPaddingX) + 'px';
      } else {
        // Colonnes qui tiennent : #history reprend sa largeur par défaut (annule un
        // éventuel élargissement posé par un rendu PRÉCÉDENT pendant qu'une scission
        // large était affichée) et un margin-left NÉGATIF (sur .produit-nul-split)
        // compense exactement le padding de 50vw à gauche de cet élément ainsi que le
        // padding gauche de #history lui-même, ramenant le centre des colonnes pile sur
        // celui de la chaîne principale au-dessus (elle-même centrée dans le contenu de
        // #history) — sans qu'aucun défilement n'ait besoin d'être imposé. Cette valeur
        // ne dépend QUE de la largeur du contenu (pas de celle de la fenêtre), donc reste
        // valide telle quelle si la fenêtre est ensuite redimensionnée sans faire
        // basculer isWideSplit (voir aussi le bloc de recentrage en fin de fonction, qui
        // gère la transition inverse : ce cas -> isWideSplit, et vice versa).
        history.style.width = '';
        var historyPaddingLeft = parseFloat(getComputedStyle(history).paddingLeft) || 0;
        splitWrap.style.marginLeft = (-(historyPaddingLeft + columnsNaturalWidth / 2)) + 'px';
      }

      // Flèche de scission : part du "=" de la dernière ligne principale, se scinde vers
      // le bord de chaque colonne (pas vers l'équation elle-même, voir drawFork dans
      // arrows.js) — c'est la zone de sélection de la colonne qui est visée. Le texte
      // ("produit nul" ou "racine carrée") suit l'action à l'origine de la scission.
      var lastPrimaryEqSign = primaryRowsData.length
        ? primaryRowsData[primaryRowsData.length - 1].el.querySelector('.eq-sign')
        : null;
      var forkTargets = branchResults.map(function (b) { return b.col; });
      var forkLabel = Hist.getBranchSplitLabel();
      requestAnimationFrame(function () {
        if (isStaleRender()) return;
        App.Arrows.drawAll(history, primaryRowsData, { fork: { from: lastPrimaryEqSign, to: forkTargets, label: forkLabel } });
      });

      scrollTarget = branchResults[focused].res.framedRowEl;
      scrollTargetSolved = branchResults[focused].res.framedSolved;
      scrollEngine = branchResults[focused].res.scrollEngine;
      opPrevRowEl = findPrevRowEl(branchResults[focused].res.rowsData, scrollTarget);
      var focusedSteps = scrollEngine.getSteps();
      scrollIdentity = focusedSteps[focusedSteps.length - 1];

      // Résumé final une fois TOUTES les feuilles (à N'IMPORTE quelle profondeur —
      // voir leafEngines dans renderBranchNode, pas seulement le premier niveau)
      // résolues : "S = {...}", fusionnant les racines identiques (ex. racine double
      // "(x+3)²=0", ou deux facteurs par ailleurs distincts qui finissent par la même
      // solution).
      var allLeafEngines = branchResults.reduce(function (acc, b) { return acc.concat(b.res.leafEngines); }, []);
      if (allLeafEngines.every(function (le) { return App.Equation.isSolved(le.lastEquation()); })) {
        var roots = allLeafEngines.map(function (le) { return extractRoot(le.lastEquation()); })
          .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
          .sort(function (a, b) { return a - b; });
        var rootsLatex = roots.map(function (v) {
          return (v < 0 ? '-' : '') + Expr.formatNumberLatex(v);
        }).join('\\,;\\,');
        var summaryEl = document.createElement('div');
        summaryEl.className = 'solution-set';
        window.katex.render('S=\\left\\{' + rootsLatex + '\\right\\}', summaryEl, { throwOnError: false });
        history.appendChild(summaryEl);
      }
    }

    // Vider #history puis le reconstruire (voir plus haut) rend son contenu
    // momentanément plus court/étroit le temps de tout ré-ajouter ; le navigateur peut
    // alors "clamper" le scrollTop/scrollLeft NATIF de #historyScroll à cette taille
    // réduite — un comportement de bas niveau du modèle de boîte overflow, PAS désactivable
    // via overflow-anchor (déjà à "none", voir style.css) puisqu'il ne s'agit pas
    // d'ancrage de défilement mais d'un simple clampage obligatoire à la plage valide.
    // Ce scrollTop/Left natif n'est plus lu ni écrit nulle part ailleurs dans ce fichier
    // (toute la position de la toile passe par App.Canvas, voir canvas.js) mais reste
    // TOUJOURS soustrait par le navigateur lors du calcul de getBoundingClientRect() des
    // descendants — un clampage laissé en place décale donc silencieusement tout le
    // contenu peint, indépendamment d'App.Canvas (observé en pratique : sélectionner un
    // terme suffit à re-déclencher ce clampage). #historyScroll ne doit JAMAIS avoir de
    // scrollTop/Left natif non nul (App.Canvas est la seule source de vérité) : on les
    // reposent donc explicitement à 0 ici, une fois la reconstruction terminée, AVANT
    // toute mesure de mise en page (positionPanel/drawAll ci-dessous, et le recentrage
    // plus bas).
    if (scroller) {
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
    }

    // Repositionne la fenêtre flottante des boutons d'action à gauche de la ligne
    // "current" (voir positionPanel dans toolbar.js) — dans un rAF comme App.Arrows.drawAll
    // ci-dessus, pour mesurer une mise en page à jour. scrollTarget vaut toujours cette
    // même ligne "current" dans les deux branches ci-dessus (chaîne simple ou branche
    // focalisée), y compris pendant un "produit nul"/une "racine carrée" (la fenêtre peut
    // alors chevaucher les colonnes non focalisées, voir CLAUDE.md).
    // `branches && !branchOutlineVisible` (voir tout en haut du fichier) : mêmes clics "en
    // dehors" de toute colonne qui masquent déjà son liseré de focus masquent aussi cette
    // fenêtre — ses boutons agissent sur LA colonne focalisée, ça n'a pas de sens de les
    // laisser flotter au-dessus d'une équation qui vient de perdre son focus visuel.
    // Comparée à lastCenteredStepByEngine (mise à jour plus bas, dans le bloc de
    // recentrage) : identifie une VRAIE nouvelle étape validée (nouvel objet "step",
    // jamais recréé pour un simple re-rendu — voir #history plus haut) plutôt qu'un rendu
    // dû à une sélection/un survol sur la MÊME étape déjà affichée. Calculée ICI (avant le
    // rAF de positionPanel juste en dessous, qui en a besoin pour choisir entre un saut
    // instantané et l'animation disparition/pop de swapPanelToNewStep, voir toolbar.js)
    // plutôt qu'au moment historique un peu plus bas (voir le bloc de recentrage) : les
    // deux usages partagent maintenant cette même valeur, jamais recalculée deux fois.
    var isNewStep = scrollTarget && scrollIdentity !== lastCenteredStepByEngine.get(scrollEngine);
    var hidePanel = scrollTargetSolved || (!!branches && !branchOutlineVisible);
    requestAnimationFrame(function () {
      if (isStaleRender()) return;
      // `isNewStep && !wasInitialMount` (jamais `isNewStep` seul) : positionPanel doit bien
      // POSITIONNER la fenêtre au montage (une VRAIE cible existe déjà, le tout premier
      // step), seulement sans l'animation "pop" qu'un `isNewStep` à `true` déclencherait
      // sinon (voir wasInitialMount tout en haut du fichier) — applyPanelPosition, la
      // pose effective, tourne de toute façon indépendamment de ce paramètre.
      App.Toolbar.positionPanel(scrollTarget, opPrevRowEl, hidePanel, isNewStep && !wasInitialMount);
    });

    // Recentre (avec animation) lorsque le résultat encadré change réellement (nouvelle
    // étape validée, ou nouvelle équation) — pas à chaque frappe/sélection en cours de
    // construction (taper une opération, cocher des termes à simplifier/factoriser...),
    // sinon chaque interaction relance une animation qui interrompt la précédente et
    // fait "sauter" la page de haut en bas. Recentre aussi (sans animation, cette fois)
    // si la largeur du scroller a changé depuis le dernier recentrage PENDANT qu'une
    // scission "large" est affichée (voir lastCenteredWidth plus haut et isWideSplit
    // ci-dessus) : .produit-nul-split-wide se redimensionne tout seul avec la fenêtre
    // (son padding de 50vw), donc un redimensionnement après coup désynchronise sinon
    // silencieusement le scrollLeft absolu calculé la dernière fois de la position
    // réelle des colonnes à l'écran — non pertinent pour une scission "simple" (pas de
    // scrollLeft explicite à maintenir dans ce cas, voir plus bas).
    var currentScale = App.Canvas.getScale();
    var widthChangedDuringSplit = !!branches && isWideSplit && scroller && lastCenteredWidth !== null &&
      (scroller.clientWidth !== lastCenteredWidth || currentScale !== lastCenteredScale);
    // Redimensionnement (ex. zoom du navigateur) qui fait REPASSER une scission de "large"
    // (offset horizontal explicite posé plus bas pour centrer le groupe de colonnes, voir
    // isWideSplit) à "tient dans la largeur disponible" : le centrage bascule alors sur le
    // margin-left CSS (voir plus haut), qui suppose un offset à 0 — sans repli explicite
    // ici, l'offset non nul laissé par le PRÉCÉDENT affichage "large" persiste et décale
    // alors TOUT le contenu (chaîne principale ET colonnes, ensemble) du même montant —
    // silencieusement, jusqu'à ce que quelque chose d'autre force un nouveau recentrage.
    // C'était précisément le bug "colonnes décalées à droite selon le zoom" (reproductible
    // en rétrécissant puis ré-élargissant la fenêtre pendant qu'une scission large est
    // affichée). `wasWideSplit` (voir sa déclaration tout en haut du fichier) restreint
    // ceci à une VRAIE transition large -> tient : depuis la toile "infinie" (App.Canvas,
    // offset horizontal jamais borné à 0 par défaut), un simple "pas large actuellement ET
    // offset non nul" est bien plus souvent un panorama VOLONTAIRE de l'utilisateur qu'un
    // résidu de redimensionnement — sans cette distinction, N'IMPORTE QUEL rendu (survoler
    // un bouton, sélectionner un terme...) annulait à tort ce panorama.
    var splitNoLongerWide = !!branches && !isWideSplit && wasWideSplit && scroller && App.Canvas.getX() !== 0;
    wasWideSplit = !!branches && isWideSplit;
    if (scroller && (isNewStep || widthChangedDuringSplit || splitNoLongerWide)) {
      lastCenteredStepByEngine.set(scrollEngine, scrollIdentity);
      lastCenteredWidth = scroller.clientWidth;
      lastCenteredScale = currentScale;
      // getBoundingClientRect (position réelle à l'écran), pas offsetTop : offsetTop est
      // relatif au plus proche ancêtre positionné, qui pour une colonne "produit nul"
      // n'est PAS `scroller` mais `.produit-nul-chain` (son propre position:relative,
      // voir style.css) — offsetTop y renvoyait donc une valeur minuscule (juste la
      // hauteur de l'étiquette au-dessus), pas la position réelle dans la page, ce qui
      // empêchait tout recentrage correct en cliquant pour sélectionner une colonne.
      var scrollerRect = scroller.getBoundingClientRect();
      // Sans animation pour un simple ajustement de largeur (widthChangedDuringSplit) :
      // une transition "smooth" n'a rien à apporter à un redimensionnement de fenêtre,
      // et ne fait que retarder l'alignement correct. Même chose (même pour un NOUVEAU
      // "Produit nul" qui vient tout juste de scinder) dès que la mise en page bascule en
      // "large" (isWideSplit) : #history vient d'être élargi dans le MÊME rendu (voir plus
      // haut), donc la position de départ de l'animation ("smooth" part toujours de
      // scrollLeft=0, un instant après le redimensionnement) montre un état transitoire
      // incomplet (chaîne principale coupée, à peine 2 colonnes visibles) avant de glisser
      // vers la vue correcte — perçu comme "un saut vers le mauvais endroit, PUIS vers le
      // bon" plutôt qu'une transition utile. Sauter directement à la position finale évite
      // ce blanc/faux départ ; la scission "simple" (colonnes qui tiennent, pas de
      // changement de largeur de #history) garde, elle, son animation habituelle.
      // `!wasInitialMount` en plus : le tout premier rendu de la page a bien une VRAIE
      // "nouvelle étape" à centrer (le tout premier step), mais doit y sauter directement
      // plutôt que d'y glisser — rien ne "bouge" aux yeux de l'utilisateur qui n'a encore
      // rien vu, voir wasInitialMount tout en haut du fichier.
      var scrollOpts = { behavior: (isNewStep && !isWideSplit && !wasInitialMount) ? 'smooth' : 'auto' };
      if (isNewStep && scrollTarget) {
        var targetRect = scrollTarget.getBoundingClientRect();
        // getBoundingClientRect renvoie une position/taille ÉCRAN (affectée par le zoom
        // CSS, voir currentScale plus haut), alors qu'App.Canvas.getY() et le futur
        // scrollOpts.top attendu par App.Canvas.scrollTo sont dans le repère LOCAL (avant
        // mise à l'échelle) de #canvasLayer — diviser les deux premiers termes par
        // currentScale ramène tout dans ce même repère local avant de les combiner (voir
        // apply()/zoomAt() dans canvas.js pour la relation écran = échelle * local).
        var targetCenter = (targetRect.top - scrollerRect.top) / currentScale + App.Canvas.getY() + targetRect.height / (2 * currentScale);
        scrollOpts.top = targetCenter - scroller.clientHeight / (2 * currentScale);
      }
      // Scission en cours ET en mise en page "large" (voir isWideSplit plus haut) :
      // recentre aussi HORIZONTALEMENT sur le groupe de colonnes entier. Seulement dans
      // ce cas — le cas courant (colonnes qui tiennent, .produit-nul-split SANS la
      // classe "-wide") est déjà parfaitement aligné avec la chaîne principale par la
      // simple centrage CSS (voir style.css), sans qu'aucun calcul de défilement ne soit
      // nécessaire NI possible : le décalage entre le centre naturel de .produit-nul-split
      // et celui de la chaîne principale, quand il existe (mise en page "large"), est une
      // conséquence STRUCTURELLE de la mise en page (largeur intrinsèque + padding
      // asymétriquement consommé, voir .produit-nul-split-wide dans style.css) — AUCUN
      // défilement ne peut le faire disparaître (faire défiler translate les DEUX
      // éléments de la même quantité, ça ne change jamais l'écart relatif entre eux) : on
      // ne cherche donc PAS à les réaligner ici, seulement à amener le groupe de colonnes
      // à un endroit raisonnable de la fenêtre (son propre centre).
      if (branches && splitWrap && isWideSplit) {
        var splitRect = splitWrap.getBoundingClientRect();
        // Même conversion écran -> local que targetCenter ci-dessus.
        var splitCenterX = (splitRect.left - scrollerRect.left) / currentScale + App.Canvas.getX() + splitRect.width / (2 * currentScale);
        scrollOpts.left = splitCenterX - scroller.clientWidth / (2 * currentScale);
      } else if (splitNoLongerWide) {
        scrollOpts.left = 0;
      }
      App.Canvas.scrollTo(scrollOpts);
    }
  }

  // Clic n'importe où EN DEHORS de toute colonne "Produit nul"/"Racine carrée" (à
  // n'importe quelle profondeur d'imbrication, toutes partagent .produit-nul-branch) ET
  // en dehors de tout ce qui sert à AGIR sur la colonne focalisée (fenêtre d'actions,
  // pavé "Opération", boutons de zoom — même exclusion que le gestionnaire "en dehors"
  // jumeau de initToolbar, pour la même raison : ce ne sont pas des clics "en dehors" au
  // sens de l'utilisateur, juste l'UI flottante de la colonne elle-même) : masque le
  // liseré de focus (voir branchOutlineVisible tout en haut) sans jamais toucher
  // `focusedBranch` lui-même (history.js) — cliquer DANS une colonne (ou sur cette UI
  // flottante) le fait aussitôt réapparaître. Capture, comme tous les autres
  // gestionnaires de clic "en dehors" du projet (voir panJustEnded/initDrillDismissal
  // dans main.js, le gestionnaire "en dehors" de initToolbar) — même raison : évaluer la
  // cible AVANT qu'un re-rendu déclenché par CE MÊME clic ne la détache du DOM. Ignore
  // les clics tant qu'aucune colonne n'existe (rien à masquer/révéler) pour ne jamais
  // imposer de re-rendu superflu au fil normal de l'utilisation (avant toute
  // "Produit nul").
  // Recentre la vue sur une colonne "Condition d'existence" déjà créée (voir
  // existenceConditionAction dans history.js : un second clic sur le bouton pour un
  // dénominateur/radicand structurellement identique n'en recrée pas une seconde,
  // il pointe juste ici) — même conversion écran -> local que le recentrage automatique
  // dans renderAll (diviser par App.Canvas.getScale() : voir le commentaire de
  // targetCenter plus haut), mais appelée à la demande plutôt qu'après un nouveau step.
  function panToDomainColumn(index) {
    var col = document.querySelector('.domain-branch[data-domain-index="' + index + '"]');
    var scroller = document.getElementById('historyScroll');
    if (!col || !scroller) return;
    var scale = App.Canvas.getScale();
    var scrollerRect = scroller.getBoundingClientRect();
    var colRect = col.getBoundingClientRect();
    var centerX = (colRect.left - scrollerRect.left) / scale + App.Canvas.getX() + colRect.width / (2 * scale);
    var centerY = (colRect.top - scrollerRect.top) / scale + App.Canvas.getY() + colRect.height / (2 * scale);
    App.Canvas.scrollTo({
      left: centerX - scroller.clientWidth / (2 * scale),
      top: centerY - scroller.clientHeight / (2 * scale),
      behavior: 'smooth'
    });
    // Pulsation brève (voir .domain-branch-flash dans style.css) : confirme visuellement
    // QUELLE colonne un second clic sur "Condition d'existence" vient de retrouver —
    // `.branch-focused` seul (permanent tant que focalisée) ne signale pas cet ARRIVÉE-ci
    // en particulier. Classe jetable, retirée après sa durée (2 x 0.5s, voir le
    // keyframes) plutôt que laissée en place (un futur re-rendu la perdrait de toute
    // façon en reconstruisant la colonne, mais autant nettoyer proprement).
    col.classList.add('domain-branch-flash');
    setTimeout(function () { col.classList.remove('domain-branch-flash'); }, 1000);
  }

  var BRANCH_OUTLINE_KEEP_SELECTOR = '.produit-nul-branch, #controlPanel, #opButtons, ' +
    '#mathKeypadPanel, #mathKeypadPeekTab, #liveOpPill, .arrow-label-mirror, ' +
    '#zoomInBtn, #zoomOutBtn';
  function initBranchOutlineDismissal() {
    document.addEventListener('click', function (e) {
      if (!document.querySelector('.produit-nul-branch')) return;
      var keep = !!(e.target.closest && e.target.closest(BRANCH_OUTLINE_KEEP_SELECTOR));
      if (keep === branchOutlineVisible) return;
      branchOutlineVisible = keep;
      renderAll();
    }, true);
  }

  App.Render = {
    renderAll: renderAll,
    formatOpLabel: formatOpLabel,
    panToDomainColumn: panToDomainColumn,
    init: initBranchOutlineDismissal
  };
})(window.App = window.App || {});
