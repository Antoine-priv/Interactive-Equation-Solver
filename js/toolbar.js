/* Boutons d'opération flottants + pavé numérique / panneau de sélection. */
(function (App) {
  'use strict';

  // Bouton d'action survolé (simplify/factor/expand/produitnul) : voir shouldShowLivePreview
  // dans render.js, qui n'affiche l'aperçu en direct d'une sélection libre que si le
  // survol correspond à une action réellement applicable — jamais juste parce que des
  // termes sont sélectionnés.
  var hoveredOp = null;

  // Le pavé "Opération" utilise désormais le <math-field> partagé (voir mathKeypad.js) :
  // ce drapeau retient si le champ lui est actuellement lié, pour n'appeler
  // setActiveField/clearActiveField que sur une VRAIE transition d'entrée/sortie du mode
  // 'expr' — jamais à chaque rendu, ce qui réinitialiserait le curseur/contenu du champ à
  // chaque frappe (voir renderToolbar).
  var mathKeypadBound = false;
  // Côté (membre) qui héberge actuellement le VRAI champ live en mode 'expr' — l'autre
  // affiche le miroir en lecture seule (voir computeLiveOpInfo dans render.js/
  // drawMirrorField dans arrows.js). Cliquer sur le miroir (voir switchExprLiveSide plus
  // bas) le fait basculer, pour continuer à composer l'opération depuis N'IMPORTE quel
  // membre plutôt que d'être coincé sur celui de départ. Remis à 'left' à chaque VRAIE
  // entrée dans le mode (voir bindMathKeypad), jamais conservé d'une session à l'autre.
  var exprLiveSide = 'left';
  // Côté pour lequel le champ a été réellement re-parenté la dernière fois (voir
  // bindMathKeypad) — permet de détecter, en plus de la simple entrée dans le mode, un
  // changement de exprLiveSide qui doit LUI AUSSI redéclencher un bindLiveOpField (sinon
  // le champ resterait visuellement à son ancienne place malgré le changement d'état).
  var mathKeypadBoundSide = null;

  // Mode 'factor' (facteur commun/identité) : même principe que mathKeypadBound, mais pour
  // le <math-field> partagé lié DANS #controlPanel (voir bindFactorKeypad) — signature de
  // configuration ('choice' | 'common' | 'id:<mode>:<idFocus>' | null), pour ne reconstruire
  // le panneau (et re-parenter le champ) que sur une vraie transition structurelle, jamais
  // à chaque frappe.
  var factorPanelSig = null;
  var factorFieldBound = false;

  // Derniers arguments reçus par positionPanel (voir plus bas) — mémorisés pour pouvoir
  // la rappeler NOUS-MÊMES une fois qu'une rangée .op-row a fini de grandir/rétrécir (voir
  // le `transitionend` posé sur #opButtons dans initToolbar) : positionPanel centre la
  // fenêtre sur `panelEl.offsetHeight`, or renderAll (render.js) ne l'appelle QU'UNE FOIS
  // par rendu, juste après que renderToolbar a lancé l'animation d'une rangée — à ce
  // moment-là, la transition de hauteur vient tout juste de démarrer, donc offsetHeight
  // vaut encore (presque) l'ANCIENNE hauteur. Sans ce rappel après coup, la fenêtre reste
  // figée à la position calculée pour cette ancienne hauteur pendant que son contenu réel
  // continue de rétrécir/grandir sous elle, la faisant dériver loin de l'équation ciblée.
  var lastPositionArgs = null;

  // rAF id de la boucle de "poursuite" démarrée par trackPanelDuringRowAnimation
  // ci-dessous (null si aucune boucle en cours) — un id de garde plutôt qu'un simple
  // booléen : une future évolution qui voudrait pouvoir aussi l'annuler explicitement
  // (ex. sur un changement d'équation) disposerait déjà de l'id à passer à
  // cancelAnimationFrame, ce qu'un booléen ne permettrait pas.
  var repositionRafId = null;

  // Vrai tant qu'au moins une .op-row est en cours de réduction (row-hidden posé mais pas
  // encore le `hidden` final, voir setRowVisibility) ou d'apparition (row-appearing, voir
  // son retrait dans l'écouteur `animationend` d'initToolbar) — c'est-à-dire tant que la
  // hauteur du panneau peut encore changer sous positionPanel.
  function isAnyRowAnimating(opButtonsEl) {
    return !!opButtonsEl.querySelector('.op-row.row-hidden:not([hidden]), .op-row.row-appearing');
  }

  // Repositionne la fenêtre à CHAQUE frame tant qu'une rangée grandit/rétrécit encore
  // (voir isAnyRowAnimating), plutôt qu'une seule fois à la fin de la transition : sans
  // ce suivi continu, la fenêtre resterait figée à la position calculée pour l'ANCIENNE
  // hauteur (voir lastPositionArgs plus haut) pendant toute la durée de l'animation, puis
  // "sauterait" d'un coup à sa position correcte une fois celle-ci terminée — un
  // comportement presque aussi perturbant que l'absence totale de correction. Idempotent
  // (repositionRafId) : renderToolbar peut l'appeler à chaque rendu sans jamais empiler
  // plusieurs boucles.
  function trackPanelDuringRowAnimation(opButtonsEl) {
    if (repositionRafId !== null || !isAnyRowAnimating(opButtonsEl)) return;
    function step() {
      if (lastPositionArgs) {
        positionPanel(lastPositionArgs.anchorRowEl, lastPositionArgs.prevRowEl, lastPositionArgs.hide);
      }
      repositionRafId = isAnyRowAnimating(opButtonsEl) ? requestAnimationFrame(step) : null;
    }
    repositionRafId = requestAnimationFrame(step);
  }

  // Explication de chaque mode : affichée en infobulle au survol du bouton correspondant
  // (voir initToolbar).
  var MESSAGES = {
    simplify: 'Combine les termes sélectionnés.',
    factor: 'Factorise les termes sélectionnés par un facteur commun ou une identité remarquable.',
    expand: 'Développe un groupe factorisé ou une fraction.',
    expr: 'Composez librement une suite d\'opérations.',
    produitnul: 'Sépare l\'équation pour résoudre chaque facteur individuellement.',
    existence: 'Calcule la condition d\'existence (domaine de définition) de ce dénominateur/radicand, dans une nouvelle colonne.',
    signchart: 'Construit un tableau de signes : une inéquation par facteur, puis un tableau à remplir.'
  };

  // Caractère "←" (utilisé pour la flèche retour, voir buildFactorBackRow) : selon la
  // police, son glyphe n'est pas visuellement centré dans sa boîte (trop bas malgré un
  // centrage flex correct sur le bouton) — une icône SVG, elle, n'a pas ce problème
  // (aucune métrique de police/ligne de base à compenser).
  var BACK_ARROW_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>';

  // Formes affichées pour les 3 identités remarquables (voir
  // Expr.factorRemarkableIdentityChoice) — partagées entre l'étape de choix et le titre du
  // pavé une fois l'identité choisie. Pas de libellé "Identité N" : seule la formule
  // compte, l'élève la reconnaît visuellement plutôt que par un numéro arbitraire.
  var IDENTITY_INFO = {
    1: { math: 'a^2+2ab+b^2=(a+b)^2' },
    2: { math: 'a^2-2ab+b^2=(a-b)^2' },
    3: { math: 'a^2-b^2=(a-b)(a+b)' }
  };

  // Petite flèche "retour" en haut à gauche du pavé (étape 2 -> étape 1, voir
  // goBackToFactorChoice) : partagée entre facteur commun et identité remarquable.
  function buildFactorBackRow() {
    var row = document.createElement('div');
    row.className = 'factor-back-row';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'factor-back-btn';
    btn.innerHTML = BACK_ARROW_SVG;
    btn.title = 'Revenir au choix de la méthode';
    btn.addEventListener('click', function () { App.History.goBackToFactorChoice(); });
    row.appendChild(btn);
    return row;
  }

  // Étape 1 du sélecteur "Factoriser" : facteur commun, ou l'une des 3 identités
  // remarquables. TOUS les boutons restent cliquables même si la sélection actuelle ne
  // peut structurellement pas correspondre à l'identité (voir chooseFactorMode dans
  // history.js) : cliquer une identité inapplicable affiche alors une erreur (voir
  // pending.error, rendu par renderToolbar) et grise CE bouton (pending.factorChoiceFailed)
  // sans le désactiver — l'élève peut réessayer une autre valeur/sélection sans être bloqué.
  function buildFactorChoiceStep(pending) {
    var wrap = document.createElement('div');
    wrap.className = 'keypad';

    var intro = document.createElement('div');
    intro.className = 'factor-choice-intro';
    intro.textContent = 'Comment factoriser ?';
    wrap.appendChild(intro);

    var list = document.createElement('div');
    list.className = 'factor-choice-list';

    function addChoice(mode, label, math) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'factor-choice-btn';
      btn.setAttribute('data-factor-choice', String(mode));
      if (label) {
        var labelEl = document.createElement('span');
        labelEl.className = 'factor-choice-label';
        labelEl.textContent = label;
        btn.appendChild(labelEl);
      }
      if (math) {
        var mathEl = document.createElement('span');
        mathEl.className = 'factor-choice-math';
        window.katex.render(math, mathEl, { throwOnError: false });
        btn.appendChild(mathEl);
      }
      // Grisé visuellement après un essai raté (voir plus haut), jamais désactivé.
      if (pending.factorChoiceFailed.indexOf(mode) !== -1) btn.classList.add('factor-choice-failed');
      btn.addEventListener('click', function () { App.History.chooseFactorMode(mode); });
      list.appendChild(btn);
    }

    addChoice('common', 'Facteur commun', null);
    [1, 2, 3].forEach(function (n) { addChoice(n, null, IDENTITY_INFO[n].math); });

    wrap.appendChild(list);
    return wrap;
  }

  // Étape 2 (cas facteur commun, factorMode === 'common') : le <math-field> partagé vit
  // désormais dans le pavé "live" de la ligne "pending" (voir bindLiveOpField dans
  // mathKeypad.js/bindFactorKeypad ci-dessous), pas ici — #controlPanel n'a donc plus
  // qu'un simple bouton "retour" pendant cette saisie. L'élève tape directement la valeur
  // ("6", "-3", "2x", ...) et la voit apparaître, curseur inclus, à même l'étiquette de la
  // flèche (voir positionLiveField dans arrows.js).
  function buildCommonFactorKeypad() {
    var wrap = document.createElement('div');
    wrap.className = 'keypad';
    wrap.appendChild(buildFactorBackRow());
    return wrap;
  }

  // Affiche "a = <latex>" (ou "a = …" si vide) pour le champ NON focalisé — rendu via
  // KaTeX pour rester cohérent visuellement avec le reste de l'appli (best-effort,
  // throwOnError:false : le LaTeX tapé peut être temporairement invalide/incomplet).
  // Rend juste la VALEUR (pas le "a="/"b=", porté séparément par .identity-ab-label,
  // toujours visible que ce champ soit focalisé ou non) — "…" en texte brut si vide
  // (évite un rendu KaTeX bizarre pour une simple ellipse).
  function renderIdentityStaticValue(el, latex) {
    if (!latex) {
      el.textContent = '…';
      return;
    }
    window.katex.render(latex, el, { throwOnError: false });
  }

  // Étape 2 (cas identité remarquable, factorMode 1/2/3) : deux boîtes "a"/"b" — celle qui
  // a le focus (pending.idFocus) accueille le <math-field> partagé (liée par
  // bindFactorKeypad, comme pour le facteur commun), l'AUTRE reste un simple bouton
  // cliquable affichant sa valeur figée (clic -> setIdentityFocus). Chaque boîte garde un
  // label "a ="/"b =" TOUJOURS visible (sinon, une fois le champ live vide dedans, on ne
  // sait plus lequel des deux on est en train de taper) : le <math-field> partagé est
  // ajouté APRÈS ce label par bindFactorKeypad (setActiveField(box, ...) l'appuie en fin
  // de boîte, jamais avant). L'élève tape directement la valeur voulue ("2x", "x", "5", ou
  // une petite expression comme "x+2" pour les cas idGroupBase/idGroupBaseB ci-dessous) —
  // lequel des deux porte le x est déduit du résultat (voir parseIdentityAB dans
  // history.js), pas d'une désignation séparée : plus besoin de clavier spécifique à ce
  // mode, le pavé générique suffit.
  function buildIdentityKeypad(pending) {
    var wrap = document.createElement('div');
    wrap.className = 'keypad';
    wrap.appendChild(buildFactorBackRow());

    var title = document.createElement('div');
    title.className = 'factor-choice-intro';
    window.katex.render(IDENTITY_INFO[pending.factorMode].math, title, { throwOnError: false });
    wrap.appendChild(title);

    var display = document.createElement('div');
    display.className = 'identity-ab-display';
    ['a', 'b'].forEach(function (which) {
      var box = document.createElement('div');
      box.className = 'identity-ab-field' + (pending.idFocus === which ? ' identity-ab-focused identity-ab-live' : '');
      // Rendu KaTeX (comme le "x" des touches du pavé) plutôt qu'un simple texte : sinon
      // "a"/"=" ne sont pas dans la police mathématique italique et jurent visuellement
      // à côté du <math-field> ou de la valeur, eux bien typographiés. Élément à part,
      // JAMAIS dans le <math-field> lui-même : non éditable, jamais effaçable par
      // l'élève (contrairement à ce qu'il tape juste à côté).
      var label = document.createElement('span');
      label.className = 'identity-ab-label';
      window.katex.render(which + '=', label, { throwOnError: false });
      box.appendChild(label);
      if (pending.idFocus !== which) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'identity-ab-static';
        renderIdentityStaticValue(btn, which === 'a' ? pending.idALatex : pending.idBLatex);
        btn.addEventListener('click', function () { App.History.setIdentityFocus(which); });
        box.appendChild(btn);
      }
      display.appendChild(box);
    });
    wrap.appendChild(display);
    return wrap;
  }

  // Détermine, d'après la sélection libre en cours, quels boutons sont utilisables :
  // Simplifier (au moins 2 termes "plats" — pas déjà factorisés — d'un même membre),
  // Factoriser (au moins 1 terme plat, un seul membre à la fois), Développer (exactement
  // un groupe factorisé sélectionné, seul).
  function computeSelectionInfo() {
    var eq = App.History.lastEquation();
    var pending = App.History.getPending();
    var isGroup = App.Expr.isGroup;

    // Vrai si TOUS les noeuds sélectionnés de `arr` (aux indices `indices`) sont déjà des
    // FactorGroup à facteur numérique simple (ex. "2(5x-7)", pas une division) : voir
    // Expr.factorAlreadyGroupedNodes — reste factorisable par un facteur commun
    // supplémentaire (ex. "2(5x-7)-10(9+3x)" par 2) même si "clean" (ci-dessous) est faux.
    function allNumericFactorGroups(arr, indices) {
      return indices.length >= 2 && indices.every(function (i) {
        var n = arr[i];
        return App.Expr.isFactorGroup(n) && !n.isDivision;
      });
    }

    // Vrai si TOUS les noeuds sélectionnés sont des ProductGroup (ex. "(x+1)(x+2)",
    // "(x+1)(x+5)") : reste factorisable par un facteur commun EXPRESSION partagé entre eux
    // (ex. "(x+1)(x+2)+(x+1)(x+5)" par "(x+1)", voir Expr.factorCommonProductFactor) même si
    // "clean" (ci-dessous) est faux, exactement comme allNumericFactorGroups pour le facteur
    // commun numérique d'expressions déjà groupées.
    function allProductGroups(arr, indices) {
      return indices.length >= 2 && indices.every(function (i) { return App.Expr.isProductGroup(arr[i]); });
    }

    // "Entré" dans un groupe factorisé (voir pending.drilled dans history.js) :
    // Simplifier/Factoriser/Développer portent alors sur SES termes intérieurs (jamais
    // Produit nul, qui ne s'applique qu'à l'équation entière) — Développer un terme
    // intérieur qui est lui-même un groupe descend encore, une factorisation dans une
    // factorisation (voir toggleInnerSelection dans history.js pour Factoriser/Simplifier ;
    // Développer, lui, agit directement sans avoir besoin d'entrer plus profond).
    if (pending.drilled) {
      var groupNode = App.Expr.nodeAtPath(eq[pending.drilled.side], pending.drilled.path);
      // Branche d'un ProductGroup (ex. "(x+2-3)" dans "(x+2-3)(x+2+3)", voir
      // drillIntoProductBranch dans history.js) : ses termes sont supposés plats, jamais de
      // Développer dessus (une seule profondeur, voir toggleInnerSelection). Un
      // dénominateur-expression (pending.drilled.part==='den', voir
      // drillIntoQuotientDenominator) et un radicand de racine carrée (part==='sqrt', voir
      // drillIntoSqrt), eux, se comportent exactement comme un FactorGroup classique ici
      // (voir isDen/isSqrt, seul isBranch désactive Développer ci-dessous).
      var isBranch = typeof pending.drilled.branch === 'number' && groupNode && App.Expr.isProductGroup(groupNode);
      var isDen = pending.drilled.part === 'den' && groupNode && App.Expr.isExpressionQuotient(groupNode);
      var isSqrt = pending.drilled.part === 'sqrt' && groupNode && App.Expr.isSqrtGroup(groupNode);
      if (!groupNode || (!isBranch && !isDen && !isSqrt && !App.Expr.isFactorGroup(groupNode))) {
        return { canSimplify: false, canFactor: false, canExpand: false, canProduitNul: false, canExistenceCondition: false, canSignChart: false };
      }
      var inner = App.Expr.drilledWorkingArray(groupNode, pending.drilled);
      var sel = pending.selectedInner;
      var innerClean = sel.every(function (i) { return !isGroup(inner[i]); });
      // Un noeud sélectionné qui serait LUI-MÊME un dénominateur-expression imbriqué (ex.
      // "÷d1" puis "÷d2" sans annulation, voir wrapSideInQuotient) reste exclu, même niché
      // dans un membre drillé — mêmes raisons que groupCount plus bas.
      var innerCanExpand = !isBranch && sel.length === 1 && isGroup(inner[sel[0]]) &&
        !App.Expr.isExpressionQuotient(inner[sel[0]]);
      // L'AUTRE membre (celui où l'on n'est PAS "entré") reste sélectionnable pendant
      // qu'on est dans un groupe (voir render.js) : Simplifier peut alors porter sur les
      // deux à la fois en une seule étape (l'intérieur du groupe ET l'autre membre),
      // comme Simplifier le fait déjà pour une sélection libre gauche+droite classique.
      // Factoriser/Développer, eux, restent une action à cible UNIQUE partout ailleurs
      // dans l'appli : pas de combinaison ici non plus, seule la sélection intérieure compte.
      var otherSide = pending.drilled.side === 'left' ? 'right' : 'left';
      var otherSel = otherSide === 'left' ? pending.selectedLeft : pending.selectedRight;
      var otherClean = otherSel.every(function (i) { return !isGroup(eq[otherSide][i]); });
      // Cas particulier "(expr)²-constante" (ex. (x+8)²-4, voir getFactorTargetShape dans
      // history.js) : la sélection contient un groupe (le carré), donc innerClean est
      // faux, mais reste factorisable via l'identité 3 avec a=l'expression du carré.
      var innerShape = App.History.getFactorTargetShape();
      var innerCanFactorGroup = sel.length === 2 && innerShape &&
        !!(innerShape.groupBase || (innerShape.groupBaseA && innerShape.groupBaseB));
      return {
        canSimplify: (sel.length >= 2 && innerClean) || (otherSel.length >= 2 && otherClean),
        // Factoriser un terme seul n'a rien à "extraire de commun" : exige au moins 2 termes.
        canFactor: (sel.length >= 2 && innerClean) || innerCanFactorGroup ||
          allNumericFactorGroups(inner, sel) || allProductGroups(inner, sel),
        canExpand: innerCanExpand,
        canProduitNul: false,
        canExistenceCondition: App.History.canExistenceCondition(),
        // Jamais disponible "entré" dans un groupe (même exclusion que Produit nul juste
        // au-dessus) : le Tableau de signes porte sur l'équation ENTIÈRE, pas un facteur
        // isolé qu'on est en train d'inspecter.
        canSignChart: false
      };
    }

    var L = pending.selectedLeft, R = pending.selectedRight;

    function sideClean(side, indices) {
      return indices.every(function (i) { return !isGroup(eq[side][i]); });
    }
    var leftClean = sideClean('left', L);
    var rightClean = sideClean('right', R);

    // "Simplifier" porte aussi l'étape 2 de "Racine carrée" (annuler racine+carré et/ou
    // calculer la racine numérique) une fois AU MOINS un membre déjà enveloppé dans
    // "√(...)" (et son radicand reconnaissable) SÉLECTIONNÉ (voir squareRootSimplifyAction/
    // confirmSquareRoot dans history.js — jamais automatique, contrairement à "Produit nul"
    // ci-dessous) : le clic (data-op="simplify" dans toolbar.js) délègue alors à
    // confirmSquareRoot plutôt qu'à confirmSimplifySelection.
    var canSimplify = (L.length >= 2 && leftClean) || (R.length >= 2 && rightClean) ||
      !!App.History.squareRootAction();
    // Cas particulier "(expr)²-constante" (ex. (x+8)²-4, voir getFactorTargetShape dans
    // history.js) : la sélection contient un groupe (le carré), donc leftClean/rightClean
    // est faux, mais reste factorisable via l'identité 3 avec a=l'expression du carré.
    var shape = App.History.getFactorTargetShape();
    var canFactorGroup = ((L.length === 2 && R.length === 0) || (R.length === 2 && L.length === 0)) &&
      shape && !!(shape.groupBase || (shape.groupBaseA && shape.groupBaseB));
    // Facteur commun d'expressions déjà factorisées (ex. "2(5x-7)-10(9+3x)" par 2, voir
    // Expr.factorAlreadyGroupedNodes) OU d'une somme de ProductGroup partageant un facteur
    // (ex. "(x+1)(x+2)+(x+1)(x+5)" par "(x+1)", voir Expr.factorCommonProductFactor) : la
    // sélection contient des groupes, donc leftClean/rightClean est faux, mais reste
    // factorisable. Utilise getFactorSelectionIndices (L/R fusionnés avec
    // pending.selectedFactorGroups, voir history.js) plutôt que L/R seuls : un produit
    // sélectionné facteur par facteur (chaque parenthèse cliquée individuellement) compte
    // ici exactement comme un produit sélectionné en bloc via son bord/signe.
    var L2 = App.History.getFactorSelectionIndices('left'), R2 = App.History.getFactorSelectionIndices('right');
    var canFactorAlreadyGrouped = (L2.length >= 2 && R2.length === 0 &&
        (allNumericFactorGroups(eq.left, L2) || allProductGroups(eq.left, L2))) ||
      (R2.length >= 2 && L2.length === 0 &&
        (allNumericFactorGroups(eq.right, R2) || allProductGroups(eq.right, R2)));
    // Factoriser un terme seul n'a rien à "extraire de commun" : exige au moins 2 termes.
    var canFactor = (L.length >= 2 && R.length === 0 && leftClean) ||
      (R.length >= 2 && L.length === 0 && rightClean) || canFactorGroup || canFactorAlreadyGrouped;
    // Chaque groupe factorisé marqué dans L/R compte comme une cible de développement
    // indépendante (voir computeExpandTargets/applyExpandTargets dans history.js) : PLUS
    // d'une seule à la fois désormais — ex. "(x−6)²−(x+6)(x−9)²=0", sélectionner "(x−6)²"
    // ET (via la sélection par facteur ci-dessous) seulement "(x−9)²" les développe tous
    // les deux en une seule étape. Un noeud non-groupe glissé par erreur dans L/R ne
    // compte simplement pas (ni ne bloque le reste), cohérent avec computeExpandTargets.
    // Une fraction dont le dénominateur est une expression (isExpressionQuotient) ne se
    // développe pas "en entier" au premier niveau (voir computeExpandTargets dans
    // history.js) — son numérateur/dénominateur restent développables séparément en
    // "entrant" dedans (pending.drilled). Une racine carrée (isSqrtGroup) non plus : "√"
    // n'a rien à distribuer, contrairement à "k(...)"/"(...)(...)" — son radicand, lui,
    // reste librement développable en "entrant" dedans (voir drillIntoSqrt).
    function isFullyExpandableGroup(n) {
      return isGroup(n) && !App.Expr.isExpressionQuotient(n) && !App.Expr.isSqrtGroup(n);
    }
    var groupCount = L.filter(function (i) { return isFullyExpandableGroup(eq.left[i]); }).length +
      R.filter(function (i) { return isFullyExpandableGroup(eq.right[i]); }).length;
    var canExpand = groupCount >= 1;
    // Sélection PAR FACTEUR d'un produit à ≥2 parenthèses (voir toggleFactorSelection dans
    // history.js) : au moins 2 facteurs marqués suffit à activer Développer, indépendamment
    // de selectedLeft/Right ci-dessus (les deux sélections peuvent désormais se combiner,
    // voir computeExpandTargets). Un seul facteur marqué suffit aussi s'il a lui-même un
    // exposant>1 (ex. "(x-6)²" dans "(x-1)(x-6)²") : il y a alors quelque chose à
    // développer sans second facteur à combiner.
    ['left', 'right'].forEach(function (side) {
      var sf = pending.selectedFactors[side];
      if (!sf) return;
      var sfNode = eq[side][sf.index];
      if (sf.branches.length >= 2 ||
          (sf.branches.length === 1 && sfNode && sfNode.factors[sf.branches[0]].exponent > 1)) {
        canExpand = true;
      }
    });
    var canProduitNul = App.History.canProduitNul();
    return {
      canSimplify: canSimplify,
      canFactor: canFactor,
      canExpand: canExpand,
      canProduitNul: canProduitNul,
      canExistenceCondition: false,
      canSignChart: App.History.canSignChart()
    };
  }

  // Valide l'étape en cours du pavé "Opération" — sauf "√"/"(⋯)²" armées (voir
  // pending.sqrtArmed/squareArmed dans history.js), qui appliquent leur propre action
  // dédiée (confirmSquareRoot/confirmSquareBothSides) plutôt que d'avancer LE MÊME moteur
  // d'une étape ordinaire. Partagé entre la coche à côté du bouton "Opération" et la
  // touche "↵"/Entrée du clavier mathématique unifié (voir bindMathKeypad).
  function confirmExprOrSqrt() {
    var pending = App.History.getPending();
    if (pending.opType === 'expr' && pending.sqrtArmed) App.History.confirmSquareRoot();
    else if (pending.opType === 'expr' && pending.squareArmed) App.History.confirmSquareBothSides();
    else App.History.confirm();
  }

  // Lie/délie le <math-field> partagé (voir mathKeypad.js) au mode 'expr' : appelé à
  // CHAQUE rendu, mais ne fait quelque chose que sur une vraie transition (voir
  // mathKeypadBound) pour ne jamais réinitialiser le champ en cours de frappe. Contrairement
  // aux anciens pavés (factor/identité), "Opération" n'a plus de panneau à lui — le champ et
  // ses touches vivent entièrement dans le pavé ancré de mathKeypad.js (voir CLAUDE.md).
  function bindMathKeypad(pending) {
    if (pending.opType === 'expr') {
      // Entrée FRAÎCHE dans le mode (jamais un simple changement de côté) : repart
      // toujours de la gauche, sans hériter du côté où une session précédente avait été
      // laissée (voir exprLiveSide plus haut).
      if (!mathKeypadBound) exprLiveSide = 'left';
      // Re-parente le champ dès qu'il vient d'entrer dans le mode OU que exprLiveSide a
      // changé depuis (voir switchExprLiveSide, déclenché en cliquant le miroir) — jamais
      // à chaque rendu pendant une frappe normale, sous peine de réinitialiser le
      // curseur/contenu à chaque caractère tapé.
      if (!mathKeypadBound || mathKeypadBoundSide !== exprLiveSide) {
        // Le champ vit désormais directement dans le pavé "live" de la ligne "pending"
        // (voir bindLiveOpField dans mathKeypad.js), à même la flèche/l'équation, plutôt
        // que dans un emplacement séparé du pavé ancré — plus de contenu affiché deux
        // fois à l'écran (voir positionLiveField dans arrows.js pour son positionnement,
        // recalculé à chaque rendu).
        App.MathKeypad.bindLiveOpField({
          onEnter: confirmExprOrSqrt,
          onEscape: function () { App.History.cancelOp(); },
          onInput: function (latex) { App.History.setExprChainText(latex); },
          onSqrt: function () { App.History.toggleSquareRootArmed(); },
          onSquare: function () { App.History.toggleSquareArmed(); }
        }, pending.exprLatex || '');
        mathKeypadBound = true;
        mathKeypadBoundSide = exprLiveSide;
      }
      App.MathKeypad.setError(pending.error);

      // Touche "√" (voir opts.onSqrt ci-dessus) : UNIQUEMENT l'étape 1 de "Racine carrée"
      // (envelopper les deux membres, voir squareRootStage/detectSquareRootUnwrapped dans
      // history.js) — l'étape 2 (simplifier) se fait désormais via le bouton "Simplifier"
      // habituel (voir computeSelectionInfo/le clic sur data-op="simplify"), jamais en
      // ré-armant cette même touche. Dépend donc de la forme de l'équation ET de l'absence
      // d'une autre composition déjà en cours (une chaîne non vide dans le champ) — sauf si
      // déjà armée, où elle doit rester cliquable pour pouvoir la désarmer. Grisée aussi
      // tant que "(⋯)²" (ci-dessous) est elle-même armée : les deux touches n'ont, comme
      // +/-/×/÷ entre elles, jamais de sens armées ensemble.
      var stage = App.History.squareRootStage();
      var sqrtTitle, sqrtDisabled, sqrtPressed = false;
      if (pending.sqrtArmed) {
        sqrtTitle = 'Racine carrée armée : cliquez "↵" pour appliquer, ou re-cliquez ici pour annuler.';
        sqrtDisabled = false;
        sqrtPressed = true;
      } else {
        sqrtTitle = 'Racine carrée des deux membres';
        sqrtDisabled = pending.squareArmed || stage !== 'wrap' || pending.exprLatex !== '';
      }

      // Touche "(‥)²" (voir opts.onSquare ci-dessus) : élève les deux membres au carré en
      // une seule étape (voir canSquareBothSides/confirmSquareBothSides dans history.js) —
      // disponible dès que les DEUX membres sont prouvablement non négatifs (sinon élever
      // au carré ne serait qu'une implication, pas une équivalence — voir le commentaire de
      // canSquareBothSides), sauf pendant la composition d'une autre chaîne ou tant que "√"
      // est elle-même armée.
      var squareTitle, squareDisabled, squarePressed = false;
      if (pending.squareArmed) {
        squareTitle = 'Carré armé : cliquez "↵" pour appliquer, ou re-cliquez ici pour annuler.';
        squareDisabled = false;
        squarePressed = true;
      } else if (!pending.sqrtArmed && pending.exprLatex === '' && !App.History.canSquareBothSides()) {
        squareTitle = 'Élever au carré ne préserverait pas l\'équivalence : les deux membres doivent être positifs (ou nuls).';
        squareDisabled = true;
      } else {
        squareTitle = 'Élever les deux membres au carré';
        squareDisabled = pending.sqrtArmed || !App.History.canSquareBothSides() || pending.exprLatex !== '';
      }

      // "√"/"(⋯)²" armée : plus rien d'autre à composer avec (voir toggleSquareRootArmed/
      // toggleSquareArmed dans history.js) — seuls un second clic sur la touche armée (pour
      // la désarmer) ou "↵" (pour confirmer) restent possibles.
      App.MathKeypad.setAllKeysDisabled(pending.sqrtArmed || pending.squareArmed,
        pending.squareArmed ? ['square', 'enter'] : ['sqrt', 'enter']);
      App.MathKeypad.setKeyState('sqrt', { disabled: sqrtDisabled, pressed: sqrtPressed, title: sqrtTitle });
      App.MathKeypad.setKeyState('square', { disabled: squareDisabled, pressed: squarePressed, title: squareTitle });
    } else if (mathKeypadBound) {
      App.MathKeypad.clearActiveField();
      mathKeypadBound = false;
      mathKeypadBoundSide = null;
    }
  }

  // Bascule le champ live vers l'AUTRE membre (voir exprLiveSide) — appelé en cliquant
  // sur le miroir en lecture seule (voir drawMirrorField dans arrows.js), pour continuer à
  // composer l'opération depuis ce membre plutôt que de rester coincé sur celui de départ.
  // Même principe que les aperçus au survol (hoveredOp ci-dessus) : un simple changement
  // d'état UI local, pas une action de App.History, donc un re-rendu explicite est
  // nécessaire (rien à "notifier" côté moteur de résolution).
  function switchExprLiveSide(side) {
    if (exprLiveSide === side) return;
    exprLiveSide = side;
    // renderToolbar() D'ABORD, App.Render.renderAll() ENSUITE (voir main.js pour le même
    // ordre et pourquoi il n'est plus strictement nécessaire depuis App.Canvas).
    renderToolbar();
    App.Render.renderAll();
  }

  // Lie/délie le <math-field> partagé au mode 'factor' (facteur commun/identité) — même
  // principe que bindMathKeypad, mais le champ vit ICI dans #controlPanel (setActiveField
  // appelé APRÈS que le pavé construit soit attaché au panneau, sinon focusField()
  // ciblerait un noeud détaché) plutôt que dans le pavé ancré : #controlPanel affiche
  // encore le reste de l'UI de ce mode (retour, boîte a/b figée, erreur). Ne reconstruit le
  // panneau (et ne re-parente le champ) que sur une vraie transition structurelle — jamais
  // à chaque frappe, sinon le champ serait re-parenté en continu et perdrait le focus.
  // Appelée uniquement quand pending.opType === 'factor' (voir renderToolbar).
  function bindFactorKeypad(pending, panel) {
    var sig = pending.factorMode === null ? 'choice'
      : pending.factorMode === 'common' ? 'common'
      : 'id:' + pending.factorMode + ':' + pending.idFocus;

    // Étape 1 (choix de méthode) : aucun champ vivant à préserver ici, donc pas besoin du
    // gating ci-dessous — au contraire, il FAUT reconstruire à chaque rendu, puisque les
    // boutons grisés dépendent de pending.factorChoiceFailed, qui peut changer (un essai
    // raté de plus) SANS transition de signature (on reste à l'étape 1, voir
    // chooseFactorMode dans history.js).
    if (sig === 'choice') {
      if (factorFieldBound) {
        App.MathKeypad.clearActiveField();
        factorFieldBound = false;
      }
      factorPanelSig = sig;
      panel.innerHTML = '';
      panel.appendChild(buildFactorChoiceStep(pending));
      return;
    }

    if (sig === factorPanelSig) return;

    if (factorFieldBound) {
      App.MathKeypad.clearActiveField();
      factorFieldBound = false;
    }
    factorPanelSig = sig;
    panel.innerHTML = '';
    if (sig === 'common') {
      var wrapC = buildCommonFactorKeypad();
      panel.appendChild(wrapC);
      // Comme pour 'expr' (voir bindMathKeypad) : le champ vit désormais dans le pavé
      // "live" de la ligne "pending", pas dans #controlPanel — le facteur tapé apparaît
      // directement, curseur inclus, sur l'étiquette de la flèche (voir
      // positionLiveField dans arrows.js).
      App.MathKeypad.bindLiveOpField({
        onEnter: function () { App.History.confirm(); },
        onEscape: function () { App.History.cancelOp(); },
        onInput: function (latex) { App.History.setFactorTermLatex(latex); }
      }, pending.factorLatex);
      factorFieldBound = true;
      return;
    }
    // Identité remarquable (sig === 'id:<mode>:<idFocus>'). Sur "a", "↵" bascule vers "b"
    // (comme Tab, voir onTab) plutôt que de tenter une validation forcément incomplète —
    // l'élève tape "a", valide, tape "b", valide, exactement comme il taperait Tab entre
    // les deux ; seul "↵" depuis "b" confirme réellement l'identité.
    var wrapI = buildIdentityKeypad(pending);
    panel.appendChild(wrapI);
    App.MathKeypad.setActiveField(wrapI.querySelector('.identity-ab-live'), {
      onEnter: function () {
        if (pending.idFocus === 'a') App.History.setIdentityFocus('b');
        else App.History.confirm();
      },
      onEscape: function () { App.History.cancelOp(); },
      onInput: function (latex) { App.History.setIdentityFieldLatex(latex); },
      onTab: function () { App.History.setIdentityFocus(pending.idFocus === 'a' ? 'b' : 'a'); }
    }, pending.idFocus === 'a' ? pending.idALatex : pending.idBLatex);
    factorFieldBound = true;
  }

  // Met à jour (crée/modifie/retire) le message d'erreur de #controlPanel SANS toucher au
  // reste de son contenu — en particulier sans déplacer le <math-field> live qui peut y
  // vivre (voir bindFactorKeypad) : pending.error peut changer sans transition structurelle
  // (ex. un confirm() qui échoue en restant dans le même factorMode/idFocus).
  function updateFactorErrorLine(panel, pending) {
    var displayError = pending.error;
    // pending.factorChoiceFailed (voir chooseFactorMode dans history.js) grise un bouton
    // d'identité remarquable de façon PERSISTANTE, alors que pending.error, lui, est remis
    // à null par la moindre autre action (sélectionner un terme...) — sans ce repli, le
    // bouton restait grisé mais le message rouge qui l'explique disparaissait dès qu'on
    // cliquait ailleurs, un état incohérent. Le message réapparaît donc tant que ce bouton
    // reste grisé, jusqu'au prochain choix de méthode.
    if (!displayError && pending.factorMode === null && pending.factorChoiceFailed.length > 0) {
      displayError = 'L\'expression n\'est pas factorisable par cette identité remarquable.';
    }
    var err = panel.querySelector('.panel-error');
    if (!displayError) {
      if (err) err.parentNode.removeChild(err);
      return;
    }
    if (!err) {
      err = document.createElement('div');
      err.className = 'panel-error';
      panel.appendChild(err);
    }
    err.textContent = displayError;
  }

  // Respecte prefers-reduced-motion : dans ce cas, setRowVisibility (ci-dessous) repasse
  // en bascule instantanée façon ancien code (juste `hidden`), sans quoi la finalisation
  // de la disparition (voir son écouteur `transitionend` dans initToolbar) ne se
  // déclencherait jamais — aucune transition CSS ne tourne, donc aucun événement
  // `transitionend` à attendre.
  var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Vrai jusqu'à la fin du TOUT PREMIER appel à renderToolbar() — le rendu de montage,
  // déclenché par App.History.init() juste après le chargement de la page (voir
  // DOMContentLoaded dans main.js, seul et unique appelant de renderToolbar, jamais
  // rappelée ailleurs). Pendant qu'il est vrai, setRowVisibility (plus bas) bascule
  // directement `hidden` sans transition, comme prefersReducedMotion ci-dessus : ce tout
  // premier rendu doit afficher directement la disposition FINALE des boutons (les
  // inutilisables déjà masqués), jamais les faire d'abord tous apparaître pour ensuite se
  // réduire un par un sous les yeux de l'utilisateur. Remis à `false` à la toute fin de
  // renderToolbar (pas au début) : la boucle ci-dessous, elle, reste synchrone du début à
  // la fin d'UN appel, donc lire cette même valeur tout du long de CET appel est sûr — rien
  // ici n'est différé (pas de requestAnimationFrame dans cette fonction).
  var isInitialToolbarRender = true;

  // Bascule une rangée .op-row visible/masquée en animant l'apparition ("pop", voir
  // .op-row.row-appearing dans style.css) et la disparition (réduction de hauteur, voir
  // .op-row.row-hidden) plutôt que de poser `hidden` d'un coup. Idempotent (comme l'ancien
  // `row.hidden = unusable`) : appelé à CHAQUE renderToolbar, donc ne doit rien redéclencher
  // si l'état visuel demandé est déjà celui en cours (y compris EN COURS de transition).
  // Référence `pending` du contexte actif au dernier renderToolbar() (voir
  // App.History.getPending(), déléguée à l'enfant focalisé quel que soit son niveau
  // d'imbrication — chaque moteur porte son PROPRE objet `pending`, une référence stable
  // tant que ce moteur reste vivant) : comparée par IDENTITÉ (jamais par contenu) à chaque
  // rendu pour détecter un changement de CONTEXTE (ex. cliquer une équation à l'intérieur
  // du tableau de signes pour y ouvrir sa propre fenêtre d'action) plutôt qu'un simple
  // changement de sélection DANS le même contexte — voir son usage dans renderToolbar.
  var lastToolbarContextPending = null;

  // `skipAnimation` (retour utilisateur : les boutons qui disparaissent en changeant de
  // contexte — ex. ouvrir la fenêtre d'action d'une équation du tableau de signes —
  // n'ont pas à s'animer : cette réduction de hauteur a un sens pour signaler qu'UNE
  // sélection vient de rendre CE bouton indisponible dans la MÊME fenêtre, pas pour une
  // fenêtre qui appartenait de toute façon à une équation différente) : bascule
  // instantanément, comme isInitialToolbarRender.
  function setRowVisibility(row, unusable, skipAnimation) {
    if (prefersReducedMotion || isInitialToolbarRender || skipAnimation) {
      row.hidden = unusable;
      // Nettoie toute classe de transition laissée par un changement d'état précédent
      // (improbable pile au moment d'un changement de contexte, mais un état incohérent
      // resterait sinon bloqué puisqu'aucun `transitionend` ne se déclenchera ici pour le
      // résoudre lui-même, contrairement au chemin animé ci-dessous).
      row.classList.remove('row-hidden', 'row-appearing');
      return;
    }
    // `row.hidden` seul ne suffit pas : une rangée en cours de réduction a `row-hidden`
    // posé mais `hidden` pas encore (voir le `transitionend` dans initToolbar qui ne le
    // pose qu'à la fin) — sans le `||`, un re-render pendant la transition redéclencherait
    // `classList.add('row-hidden')` sur une classe déjà présente (sans effet, mais gaspille
    // le test) ET, pire, un aller-retour rapide unusable=true puis false pendant la même
    // transition ne serait pas détecté comme un changement d'état réel.
    var currentlyHidden = row.hidden || row.classList.contains('row-hidden');
    if (unusable === currentlyHidden) return;
    if (unusable) {
      row.classList.remove('row-appearing');
      row.classList.add('row-hidden');
    } else {
      row.hidden = false;
      // Force un reflow AVANT de retirer row-hidden : sans lui, le navigateur ne voit
      // jamais l'état de départ (max-height:0, posé par row-hidden) peint séparément de
      // l'état d'arrivée, et ne peut donc pas interpoler la transition — surtout critique
      // ici puisque `hidden` (display:none) vient TOUT JUSTE d'être retiré sur la même
      // ligne, un cas où le navigateur ne peut de toute façon jamais transitionner sans
      // ce point de passage intermédiaire.
      void row.offsetWidth;
      row.classList.remove('row-hidden');
      row.classList.add('row-appearing');
    }
  }

  function renderToolbar() {
    var pending = App.History.getPending();
    // Contexte changé depuis le dernier rendu (voir lastToolbarContextPending plus haut,
    // ex. cliquer une équation du tableau de signes pour ouvrir sa propre fenêtre
    // d'action) : les boutons qui deviennent indisponibles CE rendu-ci le sont à cause de
    // ce changement, jamais d'une sélection dans la fenêtre déjà affichée — retour
    // utilisateur : pas d'animation de disparition dans ce cas précis.
    var contextChanged = lastToolbarContextPending !== null && lastToolbarContextPending !== pending;
    lastToolbarContextPending = pending;
    var info = computeSelectionInfo();
    bindMathKeypad(pending);
    var opButtons = document.getElementById('opButtons');
    Array.prototype.forEach.call(opButtons.querySelectorAll('button[data-op]'), function (btn) {
      var op = btn.getAttribute('data-op');
      var isActive = op === pending.opType;
      btn.classList.toggle('active', isActive);

      // Simplifier/Factoriser/Développer ne s'activent que si la sélection libre en
      // cours leur convient ("sélectionner d'abord, cliquer sur le bouton ensuite").
      var unusable;
      if (op === 'simplify') unusable = !info.canSimplify;
      // Reste cliquable une fois engagé (pour pouvoir l'annuler en re-cliquant), sinon
      // indisponible sauf sélection valide — pas seulement à l'état idle : sans le
      // "!== 'factor'" ci-dessous, le bouton restait à tort actif dès qu'un AUTRE mode
      // (ex. "Opération") était engagé, puisque la condition ne testait alors jamais
      // info.canFactor.
      else if (op === 'factor') unusable = pending.opType !== 'factor' && !info.canFactor;
      else if (op === 'expand') unusable = !info.canExpand;
      else if (op === 'produitnul') unusable = !info.canProduitNul;
      else if (op === 'existence') unusable = !info.canExistenceCondition;
      else if (op === 'signchart') unusable = !info.canSignChart;
      else unusable = false;
      // Délibérément PAS de "si un autre mode est engagé, cache/grise ce bouton" ici :
      // unusable ne dépend que de la sélection courante (info.canX), jamais de
      // pending.opType — un clic sur un bouton ('Opération'/'Factoriser') qui engage un
      // mode ne change ni la sélection ni donc unusable pour les 4 AUTRES boutons, qui
      // gardent donc EXACTEMENT la même visibilité qu'avant le clic (fenêtre et rangées
      // totalement statiques, seul le bouton cliqué passe en "active" ci-dessus). La
      // protection contre un clic sur un AUTRE bouton pendant qu'un mode est déjà engagé
      // se fait au niveau du gestionnaire de clic (voir initToolbar plus bas), pas ici.
      setRowVisibility(btn.parentElement, unusable, contextChanged);

      // Coche de validation à côté du bouton actif (mode 'expr'/'factor' seulement,
      // les seuls qui ont encore besoin d'une saisie à confirmer) : une seule et même
      // façon de valider, plutôt que l'ancien bouton "Valider" texte du panneau flottant.
      // La ligne elle-même bascule en scindée (voir .op-row-split dans style.css) : le
      // bouton se réduit à sa portion "étiquette" pendant que la coche apparaît en carré
      // à côté ("pop", voir .op-confirm-btn.confirm-appearing) — jamais de coche qui
      // déborderait de la fenêtre, la largeur totale (150+8+54, voir le commentaire de
      // #opButtons .op-row-split button[data-op] dans style.css) restant TOUJOURS égale
      // aux 212px habituels, à tout instant de la transition. Redevient un bouton pleine
      // largeur dès que le mode n'est plus engagé, la coche se réduisant à rien plutôt que
      // de disparaître d'un coup.
      var row = btn.parentElement;
      var existingConfirm = row.querySelector('.op-confirm-btn');
      if (prefersReducedMotion) {
        // Bascule instantanée façon ancien code : sans transition CSS active, aucun
        // `transitionend` ne se déclencherait jamais pour finaliser une réduction
        // animée (voir setRowVisibility plus haut pour la même logique sur .op-row).
        if (isActive && !existingConfirm) {
          var reducedConfirmBtn = document.createElement('button');
          reducedConfirmBtn.type = 'button';
          reducedConfirmBtn.className = 'op-confirm-btn';
          reducedConfirmBtn.textContent = '✓';
          reducedConfirmBtn.title = 'Valider';
          reducedConfirmBtn.addEventListener('click', confirmExprOrSqrt);
          row.appendChild(reducedConfirmBtn);
          row.classList.add('op-row-split');
        } else if (!isActive && existingConfirm) {
          row.removeChild(existingConfirm);
          row.classList.remove('op-row-split');
        }
        return;
      }
      if (isActive && (op === 'expr' || op === 'factor')) {
        if (!existingConfirm) {
          // Créée déjà dans son état RÉDUIT (confirm-collapsed posé sur la ligne AVANT
          // qu'elle rejoigne le DOM) puis "révélée" après un reflow forcé — même
          // chorégraphie "ajoute, force un reflow, retire" que setRowVisibility, pour que
          // le navigateur voie bien l'état de départ (largeur 0) séparément de l'arrivée
          // avant d'entamer la transition/le rebond vers l'état étendu.
          var confirmBtn = document.createElement('button');
          confirmBtn.type = 'button';
          // "confirm-collapsed" DÈS LA CRÉATION (pas seulement sur la ligne) : c'est cette
          // classe sur la COCHE ELLE-MÊME (voir #opButtons .op-confirm-btn.confirm-collapsed
          // dans style.css) qui la fait naître à largeur 0, jamais celle posée sur la ligne
          // (qui, elle, ne pilote que le gap et la largeur de l'étiquette). Sans elle, la
          // coche apparaissait d'emblée à sa pleine largeur (54px) PENDANT que l'étiquette,
          // elle, rétrécissait encore sur 0.22s — la ligne gonflait alors temporairement
          // bien au-delà de 212px, ce que positionPanel (jamais réinvoqué depuis le suivi
          // en rAF, réservé aux .op-row, voir trackPanelDuringRowAnimation) figeait alors
          // durablement, décalant toute la fenêtre vers la gauche.
          confirmBtn.className = 'op-confirm-btn confirm-collapsed';
          confirmBtn.textContent = '✓';
          confirmBtn.title = 'Valider';
          confirmBtn.addEventListener('click', confirmExprOrSqrt);
          // `transitionend` posé UNE FOIS ICI (pas dans initToolbar) : contrairement aux
          // .op-row, persistantes, cette coche est un élément JETABLE recréé à chaque
          // engagement puis détruit à chaque sortie — l'écouteur part avec elle, aucun
          // risque d'accumulation. Le test `confirm-collapsed` distingue la fin de LA
          // croissance (classe déjà retirée, voir plus bas : on ignore) de la fin d'une
          // VRAIE réduction (classe encore posée : on finalise, voir le "else" plus bas).
          confirmBtn.addEventListener('transitionend', function (e) {
            if (e.propertyName === 'width' && confirmBtn.classList.contains('confirm-collapsed')) {
              if (confirmBtn.parentNode) confirmBtn.parentNode.removeChild(confirmBtn);
              row.classList.remove('op-row-split', 'confirm-collapsed');
            }
          });
          row.classList.add('op-row-split', 'confirm-collapsed');
          row.appendChild(confirmBtn);
          void row.offsetWidth;
          row.classList.remove('confirm-collapsed');
          confirmBtn.classList.remove('confirm-collapsed');
          confirmBtn.classList.add('confirm-appearing');
          confirmBtn.addEventListener('animationend', function () {
            confirmBtn.classList.remove('confirm-appearing');
          }, { once: true });
        } else if (existingConfirm.classList.contains('confirm-collapsed')) {
          // Ré-engagement pendant qu'une coche précédente était encore en train de
          // disparaître (annuler puis re-cliquer très vite) : on la fait regrandir depuis
          // là où elle en est plutôt que d'en recréer une seconde par-dessus — une simple
          // transition CSS ordinaire suffit, pas besoin de rejouer le rebond d'apparition.
          existingConfirm.classList.remove('confirm-collapsed');
          row.classList.remove('confirm-collapsed');
        }
      } else if (existingConfirm && !existingConfirm.classList.contains('confirm-collapsed')) {
        existingConfirm.classList.remove('confirm-appearing');
        existingConfirm.classList.add('confirm-collapsed');
        row.classList.add('confirm-collapsed');
      }
    });
    trackPanelDuringRowAnimation(opButtons);

    var panel = document.getElementById('controlPanel');
    // Seul "Factoriser" a encore besoin d'un pavé de saisie ici ; "Opération" vit
    // entièrement dans le pavé ancré (voir bindMathKeypad/mathKeypad.js), "Simplifier" et
    // "Développer" ne font que sélectionner des termes sur l'équation elle-même — donc pas
    // de panneau tant qu'il n'y a pas d'erreur à signaler.
    var needsPanel = pending.opType === 'factor' ||
      (!!pending.error && pending.opType !== 'expr');
    panel.hidden = !needsPanel;

    if (pending.opType === 'factor') {
      // bindFactorKeypad gère lui-même son propre gating (ne reconstruit/ne re-parente le
      // champ que sur une vraie transition, voir factorPanelSig) ; l'erreur, elle, doit
      // pouvoir se mettre à jour à CHAQUE rendu (un confirm() qui échoue ne change pas
      // forcément de configuration) sans passer par un rebuild complet.
      bindFactorKeypad(pending, panel);
      updateFactorErrorLine(panel, pending);
    } else {
      // Aucun champ vivant à préserver ici (voir bindFactorKeypad ci-dessus) : repli sur la
      // reconstruction simple d'avant, juste un message d'erreur générique le cas échéant.
      if (factorFieldBound) {
        App.MathKeypad.clearActiveField();
        factorFieldBound = false;
      }
      factorPanelSig = null;
      panel.innerHTML = '';
      if (needsPanel && pending.error) {
        var err = document.createElement('div');
        err.className = 'panel-error';
        err.textContent = pending.error;
        panel.appendChild(err);
      }
    }
    // Retirée seulement ICI, en tout dernier (jamais en tête de fonction) : voir son
    // commentaire de déclaration — tout ce qui précède dans CET appel doit encore la lire
    // à `true`.
    isInitialToolbarRender = false;
  }

  // Repositionne la fenêtre flottante des boutons d'action à gauche de `anchorRowEl`
  // (la ligne "current" de la chaîne principale, ou celle de la branche focalisée — voir
  // renderAll dans render.js, qui appelle ceci APRÈS mise en page, dans un rAF comme
  // App.Arrows.drawAll). `prevRowEl` (la ligne juste au-dessus dans la même chaîne, ou
  // null s'il n'y en a pas) sert de limite HAUTE dure : la fenêtre peut librement
  // chevaucher l'étiquette de la flèche entrante (dans l'écart entre les deux lignes,
  // voir CLAUDE.md/le cahier des charges), mais jamais la ligne précédente elle-même.
  // Aucune limite haute dure symétrique côté bas : dépasser le bas de `anchorRowEl` est
  // évité en priorité (limite MOLLE, voir maxBottom ci-dessous) mais cède si la fenêtre
  // est trop haute pour tenir — un chevauchement occasionnel avec un aperçu en dessous
  // reste préférable à recouvrir la ligne précédente.
  //
  // `hide` (voir renderAll dans render.js, posé dès que l'équation encadrée est résolue,
  // "x=...") : plus aucune opération n'a de sens une fois la solution obtenue, la fenêtre
  // entière disparaît plutôt que de rester affichée avec ses boutons pour la plupart
  // grisés (seul "Opération" resterait actif, ce qui n'a pas de sens sur un résultat
  // final).
  //
  // Pur calcul de placement (mesure + `style.left/top`), SANS toucher à hidden/aux classes
  // d'animation — extrait de positionPanel pour être appelé soit directement (reposition
  // ordinaire), soit après la disparition de l'ancienne position (voir swapPanelToNewStep
  // plus bas) : dans les deux cas, c'est exactement le même calcul.
  function applyPanelPosition(panelEl, anchorRowEl, prevRowEl) {
    var historyScroll = document.getElementById('historyScroll');
    if (!historyScroll) return;

    var anchorLine = anchorRowEl.querySelector('.eq-line') || anchorRowEl;
    var anchorRect = anchorLine.getBoundingClientRect();
    var prevLine = prevRowEl ? (prevRowEl.querySelector('.eq-line') || prevRowEl) : null;
    var prevRect = prevLine ? prevLine.getBoundingClientRect() : null;

    // panelEl est un enfant PERSISTANT de #canvasLayer (voir CLAUDE.md) : sa propre taille
    // (offsetHeight/offsetWidth), jamais affectée par le `transform` de son ancêtre
    // (contrairement à getBoundingClientRect, qui lui EST affecté), reste dans le repère
    // LOCAL (non mis à l'échelle) de #canvasLayer — alors qu'anchorRect/prevRect (mesurés
    // via getBoundingClientRect) sont dans le repère ÉCRAN. Tout ce calcul de placement est
    // donc mené ENTIÈREMENT en repère ÉCRAN (GAP/height/panelEl.offsetWidth multipliés par
    // l'échelle courante pour y entrer) puis converti UNE SEULE FOIS en repère local à la
    // toute fin (voir App.Canvas.zoomAt dans canvas.js pour la même relation écran/local).
    var scale = App.Canvas.getScale();
    var GAP = 26 * scale; // espace entre le bord droit de la fenêtre et le texte de l'équation
    var height = panelEl.offsetHeight * scale;
    var centerY = anchorRect.top + anchorRect.height / 2;

    var top = centerY - height / 2;
    var maxBottom = anchorRect.bottom; // limite molle : ne pas déborder sous la ligne active
    if (top + height > maxBottom) top = maxBottom - height;
    var minTop = prevRect ? prevRect.bottom : -Infinity; // limite dure : jamais sur la ligne précédente
    if (top < minTop) top = minTop;

    var left = anchorRect.left - GAP - panelEl.offsetWidth * scale;

    var hsRect = historyScroll.getBoundingClientRect();
    var scrollLeft = App.Canvas.getX();
    var scrollTop = App.Canvas.getY();
    panelEl.style.left = ((left - hsRect.left) / scale + scrollLeft) + 'px';
    panelEl.style.top = ((top - hsRect.top) / scale + scrollTop) + 'px';

    var arrowEl = panelEl.querySelector('.op-buttons-arrow');
    if (arrowEl) {
      var margin = 14;
      var arrowTop = (centerY - top) / scale;
      var localHeight = height / scale;
      if (arrowTop < margin) arrowTop = margin;
      if (arrowTop > localHeight - margin) arrowTop = localHeight - margin;
      arrowEl.style.top = arrowTop + 'px';
    }
  }

  // Vrai dès que la fenêtre a été positionnée au moins une fois sur une VRAIE cible (pas
  // masquée) : distingue une réapparition (rien à faire disparaître avant, juste un pop,
  // voir positionPanel plus bas) d'un VRAI changement d'étape en cours d'affichage (voir
  // swapPanelToNewStep, qui la fait d'abord disparaître de son ancienne place).
  var panelHasAppearedOnce = false;
  // Vrai pendant la disparition de swapPanelToNewStep (avant que la nouvelle position ne
  // soit appliquée) — évite d'empiler plusieurs écouteurs `transitionend` si un nouveau
  // rendu arrive pendant cette fenêtre (voir son utilisation ci-dessous : lastPositionArgs,
  // déjà tenu à jour à CHAQUE appel de positionPanel, porte alors la cible la plus récente
  // au moment où LA transition en cours se termine).
  var panelSwapping = false;

  // "Pop" à la nouvelle position — même langage que .op-row.row-appearing/.confirm-
  // appearing (voir style.css) : un simple appel, réutilisé aussi bien pour une première
  // apparition que pour la fin d'un swap (voir swapPanelToNewStep).
  function popPanelIn(panelEl) {
    panelEl.classList.remove('panel-swap-in');
    void panelEl.offsetWidth; // au cas où elle serait déjà présente : force un reflow pour pouvoir la rejouer
    panelEl.classList.add('panel-swap-in');
    var cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      panelEl.removeEventListener('animationend', onIn);
      clearTimeout(safetyTimer);
      panelEl.classList.remove('panel-swap-in');
    }
    function onIn(e) {
      if (e.target !== panelEl) return;
      cleanup();
    }
    panelEl.addEventListener('animationend', onIn);
    // Filet de sécurité (voir le même filet dans swapPanelToNewStep) : un `hidden` posé
    // ailleurs PENDANT ce pop (équation résolue juste après) coupe l'animation sans
    // déclencher `animationend` — cette classe resterait alors posée indéfiniment sans ce
    // repli, même si `positionPanel` la retire déjà explicitement dans sa branche `hide`
    // (ceinture et bretelles : un futur appel direct à popPanelIn qui l'oublierait resterait
    // couvert).
    var safetyTimer = setTimeout(cleanup, 320);
  }

  // Fait disparaître la fenêtre depuis sa position ACTUELLE (l'ancienne équation), puis la
  // repositionne (invisible, voir .panel-swap-out dans style.css) et la fait réapparaître
  // ("pop", voir popPanelIn) à la nouvelle — plutôt qu'un simple saut instantané d'une
  // position à l'autre — quand une VRAIE nouvelle étape vient d'être validée (voir
  // isNewStep dans render.js). Relit `lastPositionArgs` (pas les paramètres capturés à
  // l'ouverture) une fois la disparition terminée : un rendu ultérieur a pu survenir
  // entre-temps (voir panelSwapping ci-dessus) et sa cible est plus à jour que celle qui a
  // déclenché ce swap.
  function swapPanelToNewStep(panelEl) {
    panelSwapping = true;
    panelEl.classList.remove('panel-swap-in');
    panelEl.classList.add('panel-swap-out');
    var finished = false;
    // Termine la disparition (repositionne + pop, voir plus haut) — appelée par LE
    // PREMIER des deux déclencheurs ci-dessous à se produire, jamais les deux : `done`
    // les rend mutuellement exclusifs.
    function finish() {
      if (finished) return;
      finished = true;
      panelEl.removeEventListener('transitionend', onOut);
      clearTimeout(safetyTimer);
      panelEl.classList.remove('panel-swap-out');
      panelSwapping = false;
      if (lastPositionArgs.hide || !lastPositionArgs.anchorRowEl) {
        panelEl.hidden = true;
        panelHasAppearedOnce = false;
        return;
      }
      applyPanelPosition(panelEl, lastPositionArgs.anchorRowEl, lastPositionArgs.prevRowEl);
      popPanelIn(panelEl);
    }
    function onOut(e) {
      if (e.target !== panelEl || e.propertyName !== 'opacity') return;
      finish();
    }
    panelEl.addEventListener('transitionend', onOut);
    // Filet de sécurité : si cette disparition interrompt un pop-in tout juste démarré
    // (voir popPanelIn) ALORS que son opacité n'avait pas encore eu le temps de s'écarter
    // de 0 (l'état de départ du @keyframes panelPopIn), la coupure de l'animation ET la
    // pose de .panel-swap-out (qui cible AUSSI opacity:0) laissent l'opacité déjà à sa
    // valeur finale — aucune transition ne se produit alors réellement, et `transitionend`
    // ne se déclenche donc JAMAIS pour "opacity" (observé en pratique : deux rendus
    // "nouvelle étape" très rapprochés au tout premier chargement d'une équation). Ce
    // timer, un peu plus long que les 0.18s déclarés, fait avancer la chorégraphie même
    // dans ce cas plutôt que de rester bloqué indéfiniment en panelSwapping=true.
    var safetyTimer = setTimeout(finish, 240);
  }

  function positionPanel(anchorRowEl, prevRowEl, hide, isNewStep) {
    lastPositionArgs = { anchorRowEl: anchorRowEl, prevRowEl: prevRowEl, hide: hide };
    var panelEl = document.getElementById('opButtons');
    if (!panelEl) return;
    if (hide || !anchorRowEl) {
      panelEl.hidden = true;
      panelEl.classList.remove('panel-swap-out', 'panel-swap-in');
      panelHasAppearedOnce = false;
      return;
    }
    // Une disparition (swapPanelToNewStep) est déjà en cours : elle repositionnera
    // elle-même la fenêtre une fois terminée (voir son `finish`). Sans ce repli, un
    // repositionnement "ordinaire" concurrent (ex. le suivi continu des rangées pendant
    // qu'elles grandissent/rétrécissent, voir trackPanelDuringRowAnimation) glisserait
    // la fenêtre vers la NOUVELLE équation PENDANT qu'elle est censée simplement
    // s'effacer sur PLACE à l'ancienne — perçu comme un petit saut au tout début du
    // fondu plutôt qu'une disparition propre.
    if (panelSwapping) return;
    // Une VRAIE nouvelle étape (isNewStep, voir render.js), déjà visible auparavant (donc
    // quelque chose à faire disparaître) et pas déjà en train de le faire : bascule sur la
    // chorégraphie disparition -> repositionnement -> pop plutôt que le saut instantané
    // ci-dessous. `prefersReducedMotion` (voir setRowVisibility plus haut pour la même
    // logique) : saute directement à l'ancien comportement, un `transitionend` n'ayant
    // sinon aucune chance de se déclencher sans transition active.
    if (isNewStep && panelHasAppearedOnce && !panelEl.hidden && !panelSwapping && !prefersReducedMotion) {
      swapPanelToNewStep(panelEl);
      return;
    }
    panelEl.hidden = false;
    applyPanelPosition(panelEl, anchorRowEl, prevRowEl);
    // Première apparition (jamais rien eu à quitter) sur une VRAIE nouvelle étape : un
    // simple pop direct à la position qui vient d'être calculée, sans disparition
    // préalable — couvre aussi bien le tout premier rendu que la ré-apparition après un
    // état masqué (voir panelHasAppearedOnce, remis à false dans la branche `hide` plus
    // haut).
    if (isNewStep && !panelHasAppearedOnce && !prefersReducedMotion) {
      popPanelIn(panelEl);
    }
    panelHasAppearedOnce = true;
  }

  function initToolbar() {
    var opButtons = document.getElementById('opButtons');
    // Écouteurs posés UNE SEULE FOIS par rangée (jamais reconstruite, voir index.html) au
    // lieu d'être (re)posés à chaque déclenchement dans setRowVisibility : sinon, une
    // rangée qui bascule visible/masquée plusieurs fois au fil d'une session accumulerait
    // un listener par bascule (celui d'une transition annulée en cours de route ne se
    // déclenche jamais, voir "animationcancel"/pas de "transitionend" correspondant).
    Array.prototype.forEach.call(opButtons.querySelectorAll('.op-row'), function (row) {
      row.addEventListener('animationend', function (e) {
        if (e.target === row && e.animationName === 'opRowPopIn') row.classList.remove('row-appearing');
      });
      row.addEventListener('transitionend', function (e) {
        // `row-hidden` encore présent : la ligne n'a pas été rouverte en cours de
        // transition (voir setRowVisibility) — sans ce test, une réduction annulée en
        // route poserait quand même `hidden` une fois la transition (désormais inverse)
        // suivante terminée, faisant disparaître d'un coup une ligne redevenue visible.
        if (e.target === row && e.propertyName === 'max-height' && row.classList.contains('row-hidden')) {
          row.hidden = true;
        }
      });
    });
    Array.prototype.forEach.call(opButtons.querySelectorAll('button[data-op]'), function (btn) {
      var op = btn.getAttribute('data-op');
      if (MESSAGES[op]) btn.setAttribute('data-tooltip', MESSAGES[op]);
      // Survol : condition de l'aperçu en direct (voir shouldShowLivePreview dans
      // render.js) — pour "Opération" (aucune sélection requise), l'aperçu se limite à
      // une ligne "pending" (équation inchangée) avec ses flèches, SANS le pavé "live"
      // lui-même (voir isExprLikeActive dans render.js : volontairement pas réutilisé
      // pour le <math-field> partagé, pour ne jamais risquer d'afficher un contenu tapé
      // lors d'une session précédente avant même d'avoir cliqué).
      if (op === 'simplify' || op === 'factor' || op === 'expand' || op === 'produitnul' || op === 'expr') {
        btn.addEventListener('mouseenter', function () {
          hoveredOp = op;
          App.Render.renderAll();
        });
        btn.addEventListener('mouseleave', function () {
          if (hoveredOp === op) {
            hoveredOp = null;
            App.Render.renderAll();
          }
        });
      }
      btn.addEventListener('click', function () {
        var pending = App.History.getPending();
        // Un mode ('expr'/'factor') déjà engagé bloque tout AUTRE bouton (il faut
        // valider/annuler ce mode d'abord) — géré ICI plutôt qu'en masquant/grisant les
        // autres boutons (voir renderToolbar) : ceux-ci doivent rester visuellement
        // identiques à ce qu'ils étaient juste avant le clic, la fenêtre ne devant jamais
        // bouger au moment même où on clique.
        if (pending.opType && pending.opType !== op) return;
        if (op === 'expr') {
          // Seul mode qui fonctionne encore par "entrer dans le mode puis composer" :
          // il n'y a pas de sélection de termes à faire au préalable pour "Opération".
          if (pending.opType === 'expr') App.History.cancelOp();
          else App.History.selectOp('expr');
        } else if (op === 'simplify') {
          // Agit immédiatement sur la sélection déjà faite (pas d'étape à confirmer) — OU,
          // si cette sélection cible un/deux membre(s) déjà enveloppé(s) par "Racine
          // carrée" (voir squareRootSimplifyAction dans history.js), sur cette forme-là :
          // voir le commentaire de canSimplify dans computeSelectionInfo.
          if (App.History.squareRootAction()) App.History.confirmSquareRoot();
          else App.History.confirmSimplifySelection();
        } else if (op === 'factor') {
          // Encore besoin d'un nombre (le facteur commun) : passe en mode 'factor' sans
          // perdre la sélection, pour afficher son clavier. Re-cliquer sur CE bouton
          // n'annule que le mode (exitFactorKeepSelection, garde la sélection de termes/
          // facteurs) — contrairement à un clic en dehors de la fenêtre, qui efface tout
          // via cancelOp (voir le gestionnaire "click en dehors" plus bas).
          if (pending.opType === 'factor') App.History.exitFactorKeepSelection();
          else App.History.enterFactorWithSelection();
        } else if (op === 'expand') {
          // Développe entièrement l'unique groupe factorisé sélectionné, immédiatement.
          App.History.confirmExpandFullSelection();
        } else if (op === 'produitnul') {
          // Scinde immédiatement (...)(...) = 0 en autant d'équations que de facteurs
          // distincts, sans sélection supplémentaire (voir confirmProduitNul).
          App.History.confirmProduitNul();
        } else if (op === 'existence') {
          // Crée une nouvelle colonne "domaine de définition", SAUF si un domaine
          // structurellement identique existe déjà (voir existenceConditionAction dans
          // history.js) : dans ce cas, on recentre juste la vue dessus plutôt que d'en
          // créer un second. Dans LES DEUX cas (nouvelle colonne OU déjà existante), la
          // vue doit se déplacer jusqu'à elle — sans ça, une toute nouvelle colonne
          // pouvait rester hors du viewport tant qu'on ne pensait pas à panoramiquer
          // manuellement (bug rapporté).
          var result = App.History.existenceConditionAction();
          if (result && (result.spawned || result.pan)) App.Render.panToDomainColumn(result.index);
        } else if (op === 'signchart') {
          // Comme "Condition d'existence" juste au-dessus : (re)crée si besoin, PUIS
          // recentre la vue dessus dans tous les cas — un second clic une fois déjà posé
          // (rien à créer, signChartAction() est alors un no-op) sert ainsi à retrouver
          // le tableau/les facteurs plutôt qu'à ne rien faire du tout.
          App.History.signChartAction();
          App.Render.panToSignChart();
        }
      });
    });

    // Clic en dehors du panneau ET des équations (donc pas sur un terme à sélectionner)
    // => referme le panneau flottant ou efface une sélection en cours, sans gêner la
    // sélection de termes elle-même.
    // Phase de capture : on évalue la cible AVANT qu'un clic sur un bouton du pavé ne
    // déclenche un re-rendu qui détacherait cette cible du DOM.
    document.addEventListener('click', function (e) {
      var pending = App.History.getPending();
      // pending.selectedFactors/selectedFactorGroups (sélection par facteur, voir
      // toggleFactorSelection dans history.js) font PARTIE de ce qu'il faut vérifier ici :
      // ils ne touchent jamais selectedLeft/Right, donc sans ce test un facteur
      // sélectionné seul (ex. "(x+5)"), ou un produit complété facteur par facteur puis
      // abandonné, n'était jamais désélectionné par un clic en dehors de l'équation.
      if (!pending.opType && !pending.selectedFactors.left && !pending.selectedFactors.right &&
          pending.selectedFactorGroups.left.length === 0 && pending.selectedFactorGroups.right.length === 0 &&
          pending.selectedLeft.length === 0 && pending.selectedRight.length === 0) return;
      var modalOverlay = document.getElementById('modalOverlay');
      if (modalOverlay && !modalOverlay.hidden) return;
      var panel = document.getElementById('controlPanel');
      var opBtnsEl = document.getElementById('opButtons');
      var onEquation = e.target.closest && e.target.closest('.eq-row');
      // Mode 'expr'/'factor' commun (voir bindMathKeypad/bindFactorKeypad) : sa saisie vit
      // dans le pavé "live" de la ligne "pending" (voir bindLiveOpField dans
      // mathKeypad.js), un enfant de #historyScroll distinct de #mathKeypadPanel — un
      // clic dessus (champ, réserve "valide si...") ne doit pas non plus fermer le mode.
      // Le miroir en lecture seule du membre opposé (voir drawMirrorField dans arrows.js,
      // .arrow-label-mirror, recréé à chaque rendu donc sans id fixe) non plus : cliquer
      // dessus bascule le champ live vers CE membre (voir switchExprLiveSide), une action
      // délibérée sur la composition en cours, pas un clic "en dehors".
      var mathKeypadEl = document.getElementById('mathKeypadPanel');
      var mathKeypadPeek = document.getElementById('mathKeypadPeekTab');
      var liveOpPillEl = document.getElementById('liveOpPill');
      var onMathKeypad = (mathKeypadEl && mathKeypadEl.contains(e.target)) ||
        (mathKeypadPeek && mathKeypadPeek.contains(e.target)) ||
        (liveOpPillEl && liveOpPillEl.contains(e.target)) ||
        (e.target.closest && e.target.closest('.arrow-label-mirror'));
      // Boutons zoom avant/arrière (voir App.Zoom, js/zoom.js) : un zoom/panorama est un
      // geste de NAVIGATION dans la toile, pas une désélection volontaire de l'équation —
      // sans cette exclusion, cliquer l'un ou l'autre annulait à tort toute sélection/
      // opération en cours (voir cancelOp plus bas), pour ensuite se re-rendre à une
      // position qui, elle, suit correctement le zoom (App.Toolbar.positionPanel) mais
      // pour un panneau ayant perdu son ancrage — perçu comme la fenêtre d'actions
      // "dérivant" au zoom.
      var onZoomBtn = e.target.closest && e.target.closest('#zoomInBtn, #zoomOutBtn');
      // Le tableau de signes (voir renderSignChartTable dans render.js) et son popup de
      // case/rangée (jamais un enfant de #history, ajoutés directement à document.body —
      // voir openSignChartPopup) ne sont ni une équation ni #opButtons : sans cette
      // exclusion, un premier clic dessus alors qu'une sélection/opération restait
      // engagée AILLEURS (ex. juste après avoir travaillé dans une colonne facteur)
      // déclenchait cancelOp() -> renderAll() ICI MÊME, EN PHASE DE CAPTURE — détruisant
      // la cible cliquée avant même que son propre gestionnaire (phase de bulles) n'ait pu
      // s'exécuter (retour utilisateur : "pas cliquable en un seul clic").
      var onSignChart = e.target.closest && e.target.closest('.sign-chart-table-wrap, .sign-chart-popup');
      if (panel.contains(e.target) || opBtnsEl.contains(e.target) || onEquation || onMathKeypad || onZoomBtn || onSignChart) return;
      App.History.cancelOp();
    }, true);
  }

  App.Toolbar = {
    init: initToolbar,
    render: renderToolbar,
    positionPanel: positionPanel,
    computeSelectionInfo: computeSelectionInfo,
    getHoveredOp: function () { return hoveredOp; },
    getExprLiveSide: function () { return exprLiveSide; },
    switchExprLiveSide: switchExprLiveSide
  };
})(window.App = window.App || {});
