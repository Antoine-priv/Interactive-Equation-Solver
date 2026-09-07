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

  // Mode 'factor' (facteur commun/identité) : même principe que mathKeypadBound, mais pour
  // le <math-field> partagé lié DANS #controlPanel (voir bindFactorKeypad) — signature de
  // configuration ('choice' | 'common' | 'id:<mode>:<idFocus>' | null), pour ne reconstruire
  // le panneau (et re-parenter le champ) que sur une vraie transition structurelle, jamais
  // à chaque frappe.
  var factorPanelSig = null;
  var factorFieldBound = false;

  // Explication de chaque mode : affichée en infobulle au survol du bouton correspondant
  // (voir initToolbar).
  var MESSAGES = {
    simplify: 'Sélectionnez au moins 2 termes à combiner.',
    factor: 'Sélectionnez les termes à factoriser, puis saisissez le facteur commun.',
    expand: 'Sélectionnez un groupe factorisé (parenthèse ou fraction) entier pour le développer.',
    expr: 'Composez librement une suite d\'opérations.',
    produitnul: 'Sélectionnez le produit (...)(...) pour résoudre chaque facteur séparément.'
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

  // Étape 2 (cas facteur commun, factorMode === 'common') : un unique champ mathématique
  // (le <math-field> partagé — voir bindFactorKeypad, qui le lie APRÈS que ce wrapper soit
  // attaché au document, sinon focusField() ciblerait un noeud détaché). L'élève tape
  // directement la valeur ("6", "-3", "2x", ...) ; le facteur tapé est déjà visible en
  // direct sur l'étiquette de la flèche (voir computePreview/formatOpLabel) — pas de
  // retour redondant dans le pavé lui-même.
  function buildCommonFactorKeypad() {
    var wrap = document.createElement('div');
    wrap.className = 'keypad';
    wrap.appendChild(buildFactorBackRow());
    var slot = document.createElement('div');
    slot.className = 'factor-field-slot';
    wrap.appendChild(slot);
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
      // Développer dessus (une seule profondeur, voir toggleInnerSelection).
      var isBranch = typeof pending.drilled.branch === 'number' && groupNode && App.Expr.isProductGroup(groupNode);
      if (!groupNode || (!isBranch && !App.Expr.isFactorGroup(groupNode))) {
        return { canSimplify: false, canFactor: false, canExpand: false, canProduitNul: false };
      }
      var inner = isBranch ? groupNode.factors[pending.drilled.branch].terms : groupNode.innerTerms;
      var sel = pending.selectedInner;
      var innerClean = sel.every(function (i) { return !isGroup(inner[i]); });
      var innerCanExpand = !isBranch && sel.length === 1 && isGroup(inner[sel[0]]);
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
        canFactor: (sel.length >= 2 && innerClean) || innerCanFactorGroup || allNumericFactorGroups(inner, sel),
        canExpand: innerCanExpand,
        canProduitNul: false
      };
    }

    var L = pending.selectedLeft, R = pending.selectedRight;

    function sideClean(side, indices) {
      return indices.every(function (i) { return !isGroup(eq[side][i]); });
    }
    var leftClean = sideClean('left', L);
    var rightClean = sideClean('right', R);

    var canSimplify = (L.length >= 2 && leftClean) || (R.length >= 2 && rightClean);
    // Cas particulier "(expr)²-constante" (ex. (x+8)²-4, voir getFactorTargetShape dans
    // history.js) : la sélection contient un groupe (le carré), donc leftClean/rightClean
    // est faux, mais reste factorisable via l'identité 3 avec a=l'expression du carré.
    var shape = App.History.getFactorTargetShape();
    var canFactorGroup = ((L.length === 2 && R.length === 0) || (R.length === 2 && L.length === 0)) &&
      shape && !!(shape.groupBase || (shape.groupBaseA && shape.groupBaseB));
    // Facteur commun d'expressions déjà factorisées (ex. "2(5x-7)-10(9+3x)" par 2, voir
    // Expr.factorAlreadyGroupedNodes) : la sélection contient des groupes, donc
    // leftClean/rightClean est faux, mais reste factorisable.
    var canFactorAlreadyGrouped = (L.length >= 2 && R.length === 0 && allNumericFactorGroups(eq.left, L)) ||
      (R.length >= 2 && L.length === 0 && allNumericFactorGroups(eq.right, R));
    // Factoriser un terme seul n'a rien à "extraire de commun" : exige au moins 2 termes.
    var canFactor = (L.length >= 2 && R.length === 0 && leftClean) ||
      (R.length >= 2 && L.length === 0 && rightClean) || canFactorGroup || canFactorAlreadyGrouped;
    var canExpand = false;
    if (L.length + R.length === 1) {
      var side = L.length === 1 ? 'left' : 'right';
      var idx = L.length === 1 ? L[0] : R[0];
      canExpand = isGroup(eq[side][idx]);
    }
    // Sélection PAR FACTEUR d'un produit à ≥2 parenthèses (voir toggleFactorSelection dans
    // history.js) : au moins 2 facteurs marqués suffit à activer Développer, indépendamment
    // de selectedLeft/Right ci-dessus (les deux sélections sont mutuellement exclusives).
    // Un seul facteur marqué suffit aussi s'il a lui-même un exposant>1 (ex. "(x-6)²" dans
    // "(x-1)(x-6)²") : il y a alors quelque chose à développer sans second facteur à combiner.
    if (pending.selectedFactors) {
      var sfBranches = pending.selectedFactors.branches;
      var sfNode = eq[pending.selectedFactors.side][pending.selectedFactors.index];
      if (sfBranches.length >= 2 ||
          (sfBranches.length === 1 && sfNode && sfNode.factors[sfBranches[0]].exponent > 1)) {
        canExpand = true;
      }
    }
    var canProduitNul = App.History.canProduitNul();
    return {
      canSimplify: canSimplify,
      canFactor: canFactor,
      canExpand: canExpand,
      canProduitNul: canProduitNul
    };
  }

  // Valide l'étape en cours du pavé "Opération" — sauf "√" armée (voir pending.sqrtArmed
  // dans history.js), qui scinde en branches (confirmSquareRoot) plutôt que d'avancer LE
  // MÊME moteur d'une étape ordinaire. Partagé entre la coche à côté du bouton "Opération"
  // et la touche "↵"/Entrée du clavier mathématique unifié (voir bindMathKeypad).
  function confirmExprOrSqrt() {
    var pending = App.History.getPending();
    if (pending.opType === 'expr' && pending.sqrtArmed) App.History.confirmSquareRoot();
    else App.History.confirm();
  }

  // Lie/délie le <math-field> partagé (voir mathKeypad.js) au mode 'expr' : appelé à
  // CHAQUE rendu, mais ne fait quelque chose que sur une vraie transition (voir
  // mathKeypadBound) pour ne jamais réinitialiser le champ en cours de frappe. Contrairement
  // aux anciens pavés (factor/identité), "Opération" n'a plus de panneau à lui — le champ et
  // ses touches vivent entièrement dans le pavé ancré de mathKeypad.js (voir CLAUDE.md).
  function bindMathKeypad(pending) {
    if (pending.opType === 'expr') {
      if (!mathKeypadBound) {
        App.MathKeypad.setActiveField(null, {
          onEnter: confirmExprOrSqrt,
          onEscape: function () { App.History.cancelOp(); },
          onInput: function (latex) { App.History.setExprChainText(latex); },
          onSqrt: function () { App.History.toggleSquareRootArmed(); }
        }, pending.exprLatex || '');
        mathKeypadBound = true;
      }
      var errMsg = pending.error;
      if (!errMsg && pending.sqrtFailed) {
        errMsg = 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.';
      }
      App.MathKeypad.setError(errMsg);

      // Touche "√" (voir opts.onSqrt ci-dessus) : dépend de la FORME de l'équation (voir
      // canSquareRoot/detectSquareRoot dans history.js) ET de l'absence d'une autre
      // composition déjà en cours (une chaîne non vide dans le champ) — sauf si déjà
      // armée, où elle doit rester cliquable pour pouvoir la désarmer ; définitivement
      // grisée après un échec (pending.sqrtFailed), jusqu'à sortie/réentrée du mode.
      var sqrtTitle, sqrtDisabled, sqrtPressed = false;
      if (pending.sqrtFailed) {
        sqrtTitle = 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.';
        sqrtDisabled = true;
      } else if (pending.sqrtArmed) {
        sqrtTitle = 'Racine carrée armée : cliquez "↵" pour scinder, ou re-cliquez ici pour annuler.';
        sqrtDisabled = false;
        sqrtPressed = true;
      } else {
        sqrtTitle = 'Racine carrée des deux membres';
        sqrtDisabled = !App.History.canSquareRoot() || pending.exprLatex !== '';
      }
      // "√" armée : plus rien d'autre à composer avec (voir toggleSquareRootArmed dans
      // history.js) — seul un second clic sur "√" (pour la désarmer) ou "↵" (pour
      // confirmer la scission) reste possible.
      App.MathKeypad.setAllKeysDisabled(pending.sqrtArmed, ['sqrt', 'enter']);
      App.MathKeypad.setKeyState('sqrt', { disabled: sqrtDisabled, pressed: sqrtPressed, title: sqrtTitle });
    } else if (mathKeypadBound) {
      App.MathKeypad.clearActiveField();
      mathKeypadBound = false;
    }
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
      App.MathKeypad.setActiveField(wrapC.querySelector('.factor-field-slot'), {
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

  function renderToolbar() {
    var pending = App.History.getPending();
    var info = computeSelectionInfo();
    bindMathKeypad(pending);
    var opButtons = document.getElementById('opButtons');
    Array.prototype.forEach.call(opButtons.querySelectorAll('button[data-op]'), function (btn) {
      var op = btn.getAttribute('data-op');
      var isActive = op === pending.opType;
      btn.classList.toggle('active', isActive);

      // Simplifier/Factoriser/Développer ne s'activent que si la sélection libre en
      // cours leur convient ("sélectionner d'abord, cliquer sur le bouton ensuite").
      if (op === 'simplify') btn.disabled = !info.canSimplify;
      // Reste cliquable une fois engagé (pour pouvoir l'annuler en re-cliquant), sinon
      // grisé sauf sélection valide — pas seulement à l'état idle : sans le "!== 'factor'"
      // ci-dessous, le bouton restait à tort actif dès qu'un AUTRE mode (ex. "Opération")
      // était engagé, puisque la condition ne testait alors jamais info.canFactor.
      else if (op === 'factor') btn.disabled = pending.opType !== 'factor' && !info.canFactor;
      else if (op === 'expand') btn.disabled = !info.canExpand;
      else if (op === 'produitnul') btn.disabled = !info.canProduitNul;
      else btn.disabled = false;
      // Pendant la saisie du facteur commun (mode 'factor' engagé), les 3 autres
      // boutons sont bloqués : il faut valider ou annuler avant de changer d'action.
      if (pending.opType === 'factor' && op !== 'factor') btn.disabled = true;

      // Coche de validation à côté du bouton actif (mode 'expr'/'factor' seulement,
      // les seuls qui ont encore besoin d'une saisie à confirmer) : une seule et même
      // façon de valider, plutôt que l'ancien bouton "Valider" texte du panneau flottant.
      var row = btn.parentElement;
      var existingConfirm = row.querySelector('.op-confirm-btn');
      if (isActive && !existingConfirm) {
        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'op-confirm-btn';
        confirmBtn.textContent = '✓';
        confirmBtn.title = 'Valider';
        confirmBtn.addEventListener('click', confirmExprOrSqrt);
        row.appendChild(confirmBtn);
      } else if (!isActive && existingConfirm) {
        row.removeChild(existingConfirm);
      }
    });

    var panel = document.getElementById('controlPanel');
    // Seul "Factoriser" a encore besoin d'un pavé de saisie ici ; "Opération" vit
    // entièrement dans le pavé ancré (voir bindMathKeypad/mathKeypad.js), "Simplifier" et
    // "Développer" ne font que sélectionner des termes sur l'équation elle-même — donc pas
    // de panneau tant qu'il n'y a pas d'erreur à signaler.
    var needsPanel = pending.opType === 'factor' || (!!pending.error && pending.opType !== 'expr');
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
  }

  function initToolbar() {
    var opButtons = document.getElementById('opButtons');
    Array.prototype.forEach.call(opButtons.querySelectorAll('button[data-op]'), function (btn) {
      var op = btn.getAttribute('data-op');
      if (MESSAGES[op]) btn.setAttribute('data-tooltip', MESSAGES[op]);
      // Survol : condition de l'aperçu en direct d'une sélection libre (voir
      // shouldShowLivePreview dans render.js) — "Opération" n'en a pas besoin, il a son
      // propre mode "engagé" qui affiche déjà l'aperçu sans survol.
      if (op === 'simplify' || op === 'factor' || op === 'expand' || op === 'produitnul') {
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
        if (op === 'expr') {
          // Seul mode qui fonctionne encore par "entrer dans le mode puis composer" :
          // il n'y a pas de sélection de termes à faire au préalable pour "Opération".
          if (pending.opType === 'expr') App.History.cancelOp();
          else App.History.selectOp('expr');
        } else if (op === 'simplify') {
          // Agit immédiatement sur la sélection déjà faite (pas d'étape à confirmer).
          App.History.confirmSimplifySelection();
        } else if (op === 'factor') {
          // Encore besoin d'un nombre (le facteur commun) : passe en mode 'factor' sans
          // perdre la sélection, pour afficher son clavier. Re-cliquer annule.
          if (pending.opType === 'factor') App.History.cancelOp();
          else App.History.enterFactorWithSelection();
        } else if (op === 'expand') {
          // Développe entièrement l'unique groupe factorisé sélectionné, immédiatement.
          App.History.confirmExpandFullSelection();
        } else if (op === 'produitnul') {
          // Scinde immédiatement (...)(...) = 0 en autant d'équations que de facteurs
          // distincts, sans sélection supplémentaire (voir confirmProduitNul).
          App.History.confirmProduitNul();
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
      if (!pending.opType && pending.selectedLeft.length === 0 && pending.selectedRight.length === 0) return;
      var modalOverlay = document.getElementById('modalOverlay');
      if (modalOverlay && !modalOverlay.hidden) return;
      var panel = document.getElementById('controlPanel');
      var opBtnsEl = document.getElementById('opButtons');
      var onEquation = e.target.closest && e.target.closest('.eq-row');
      // Mode 'expr' (voir bindMathKeypad) : sa saisie vit dans le pavé ancré de
      // mathKeypad.js, pas #controlPanel — un clic dessus (champ, touches, replier/déplier)
      // ne doit pas non plus fermer le mode en cours.
      var mathKeypadEl = document.getElementById('mathKeypadPanel');
      var mathKeypadPeek = document.getElementById('mathKeypadPeekTab');
      var onMathKeypad = (mathKeypadEl && mathKeypadEl.contains(e.target)) ||
        (mathKeypadPeek && mathKeypadPeek.contains(e.target));
      if (panel.contains(e.target) || opBtnsEl.contains(e.target) || onEquation || onMathKeypad) return;
      App.History.cancelOp();
    }, true);
  }

  App.Toolbar = {
    init: initToolbar,
    render: renderToolbar,
    computeSelectionInfo: computeSelectionInfo,
    getHoveredOp: function () { return hoveredOp; }
  };
})(window.App = window.App || {});
