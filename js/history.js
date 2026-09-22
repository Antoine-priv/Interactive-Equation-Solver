/* Etat de l'historique des étapes + de la ligne "en attente" (opération en cours de
   construction). createEngine() fabrique un moteur de résolution indépendant pour UNE
   équation (steps + pending) ; createBranchable() (plus bas) l'enrobe pour lui donner la
   capacité de se scinder en N enfants — RÉCURSIVEMENT, chaque enfant étant lui-même un
   createBranchable() complet — au clic sur "Produit nul" ou "Racine carrée", affichés côte
   à côte et travaillables séparément par l'élève. App.History EST l'un de ces noeuds (la
   racine de l'arbre) ; voir le commentaire au-dessus de createBranchable pour le détail. */
(function (App) {
  'use strict';
  var Expr = App.Expr;
  var Eq = App.Equation;
  var Ineq = App.Ineq;

  function emptyPending() {
    return {
      opType: null,        // 'expr' | 'factor' | null — simplifier/développer n'ont plus
                            // de mode persistant : ils se déclenchent directement depuis
                            // la sélection libre (opType null), voir plus bas.
      selectedLeft: [],     // indices sélectionnés sur le membre gauche (sélection libre
      selectedRight: [],    // ou mode 'factor'), utilisés par simplifier/factoriser/développer
      // "Entré" dans un groupe factorisé pour factoriser/simplifier SES termes intérieurs
      // (ex. "2(x²+5x+6)" → entrer dans "(...)" pour le factoriser en "2(x+2)(x+3)"), à
      // n'importe quelle profondeur d'imbrication (une factorisation dans une
      // factorisation...) : { side, path } où path est le chemin des indices depuis le
      // membre jusqu'au groupe courant (ex. [2] = side[2] ; [2,1] = side[2].innerTerms[1]),
      // ou null si on est au niveau normal. Un reclic sur l'unique terme déjà sélectionné
      // (au niveau du membre OU parmi selectedInner) qui est LUI-MÊME un FactorGroup
      // descend d'un niveau de plus (voir toggleTermSelection/toggleInnerSelection) ;
      // selectedInner (ci-dessous) sélectionne alors les termes du niveau le plus profond.
      drilled: null,
      selectedInner: [],    // indices sélectionnés dans les innerTerms du niveau le plus profond de `drilled`
      // Sélection PAR FACTEUR d'un ProductGroup à ≥2 facteurs (voir toggleFactorSelection) :
      // { left: {index, branches: number[]}|null, right: idem|null } — un clic simple sur
      // une parenthèse précise (jamais un FactorGroup classique, ni un produit à un seul
      // facteur/exponent>1, aucune ambiguïté là) la bascule dans "branches" SANS toucher
      // selectedLeft/Right, indépendamment de la sélection classique. Développer devient
      // possible dès que branches.length >= 2, OU dès qu'un seul facteur marqué a lui-même
      // un exposant>1 (ex. "(x-6)²" dans "(x-1)(x-6)²", qui a alors quelque chose à
      // développer tout seul) : voir Expr.expandProductFactorSubset/computeSelectionInfo
      // dans toolbar.js. Un seul produit à la fois PAR MEMBRE (comme `drilled` ci-dessus,
      // mais côté gauche et côté droit restent indépendants — voir computeExpandTargets,
      // qui combine les deux côtés en une seule étape de "Développer").
      selectedFactors: { left: null, right: null },
      // Indices de ProductGroup à ≥2 facteurs dont TOUS les facteurs ont été marqués via
      // toggleFactorSelection à un moment donné (voir updateFactorGroupCompletion) : à la
      // différence de selectedFactors ci-dessus (un seul produit à la fois PAR MEMBRE),
      // PERSISTE même après être passé à un AUTRE produit — permet à l'élève de
      // sélectionner facteur par facteur PLUSIEURS produits ENTIERS de l'équation (ex.
      // "(x+1)(x+2)+(x+1)(x+5)"), pour ensuite les factoriser par un facteur commun partagé
      // (voir Expr.factorCommonProductFactor), sans avoir à viser le signe/bord du noeud
      // (voir combinedFactorIndices, qui fusionne ceci avec selectedLeft/Right pour
      // factorTarget/enterFactorWithSelection/computeSelectionInfo).
      selectedFactorGroups: { left: [], right: [] },
      // Mode 'factor' (bouton "Factoriser") : 2 étapes à partir d'un choix explicite,
      // plutôt que de deviner automatiquement une identité remarquable à partir d'un
      // simple nombre tapé (ancien comportement) — voir chooseFactorMode.
      // factorMode : null = étape 1 (choix de la méthode pas encore fait) ; 'common' =
      // facteur commun classique (factorLatex ci-dessous) ; 1/2/3 = identité remarquable
      // a²+2ab+b², a²-2ab+b², a²-b² (voir Expr.factorRemarkableIdentityChoice), auquel cas
      // idALatex/idBLatex sont les deux champs, idFocus indiquant lequel des deux le champ
      // mathématique unifié édite actuellement (voir setIdentityFocus). L'élève tape
      // directement la valeur voulue dans chacun ("2x", "x", "5", ...) — lequel des deux
      // porte le x est déduit du LaTeX tapé (voir parseIdentityAB), pas d'une désignation
      // séparée.
      factorMode: null,
      // Facteur commun (factorMode==='common') : LaTeX brut du champ mathématique unifié,
      // alimenté par setFactorTermLatex (voir mathKeypad.js) — même principe que
      // pending.exprLatex pour "Opération", mais pour un seul terme (pas une chaîne
      // d'opérations). Analysé via App.Parser.parseLatexSide (voir parseOperandTerm).
      factorLatex: '',
      // "a"/"b" d'une identité remarquable (factorMode 1/2/3) : LaTeX brut de chacun,
      // alimenté par setIdentityFieldLatex selon lequel des deux a le focus (idFocus) —
      // analysés via App.Parser.parseLatexSide (voir parseIdentityAB). Chacun peut être un
      // simple nombre, un coefficient de x ("2x", "x"), ou — quand idGroupBase/
      // idGroupBaseB est posé (voir ci-dessous) — une petite expression ("x+2") comparée
      // structurellement à l'expression réellement au carré.
      idALatex: '',
      idBLatex: '',
      idFocus: 'a',
      // 3e identité (a²-b²) quand "a" est une EXPRESSION déjà factorisée sélectionnée
      // directement (ex. "(x+8)²-4" avec b=2, voir getFactorTargetShape/chooseFactorMode
      // et Expr.factorDifferenceOfSquaresFromGroup) plutôt qu'un simple coefficient de x :
      // le Node[] cloné de cette expression, contre lequel l'élève doit lui-même faire
      // correspondre "a" en le TAPANT dans idALatex (voir parseIdentityAB, qui compare
      // structurellement à idGroupBase — jamais réutilisé tel quel) ; null dans le cas
      // normal (a/b deux simples nombres/coefficients de x).
      idGroupBase: null,
      // Même principe qu'idGroupBase, mais pour "b" quand LUI AUSSI est une expression déjà
      // factorisée plutôt qu'une simple constante (ex. "(x-2)²-(x+6)²", voir
      // getFactorTargetShape/chooseFactorMode et Expr.factorDifferenceOfTwoSquareGroups) :
      // le Node[] cloné, comparé à idBLatex — null dans tous les autres cas (b reste alors
      // un simple nombre).
      idGroupBaseB: null,
      // Étape 1 : quand l'élève clique une identité remarquable dont la FORME ne peut
      // structurellement pas correspondre à la sélection (avant même de savoir quelles
      // valeurs a/b conviendraient), on reste à l'étape 1 plutôt que d'avancer — le(s)
      // bouton(s) concerné(s) (ces numéros, PLUSIEURS essais ratés indépendants restent
      // chacun grisé) sont alors grisés mais restent cliquables (voir chooseFactorMode et
      // buildFactorChoiceStep dans toolbar.js).
      factorChoiceFailed: [],
      // Mode 'expr' (bouton "Opération") : la chaîne COMPLÈTE tapée dans le champ
      // mathématique unifié (ex. "+3-2×(5+2x)÷4"), alimentée par setExprChainText (voir
      // mathKeypad.js) — analysée d'un coup à la validation (voir parseExprChain/confirm),
      // pas caractère par caractère comme l'ancien tampon exprRaw.
      exprLatex: '',
      // Touche "√" du pavé "Opération" (voir opts.onSqrt câblé par bindMathKeypad dans
      // toolbar.js) : uniquement l'étape 1 de "Racine carrée" (envelopper les deux
      // membres, voir squareRootStage dans history.js) — l'étape 2 (simplifier : annuler
      // racine+carré et calculer la racine numérique) se fait désormais directement via le
      // bouton "Simplifier" habituel, plus intuitif qu'un second armement de cette même
      // touche (voir computeSelectionInfo/le clic sur data-op="simplify" dans toolbar.js).
      // Contrairement à +/-/×/÷, aucun opérande à composer — cliquer dessus "arme" juste la
      // racine carrée (comme un +/-/×/÷ tout juste pressé), incompatible avec toute AUTRE
      // opération en cours (voir hasCurrentDraft). Il faut ensuite cliquer "↵" comme pour
      // toute autre opération de ce pavé (voir bindMathKeypad dans toolbar.js) pour
      // l'exécuter réellement (confirmSquareRoot dans history.js) — jamais exécutée au
      // simple clic sur la touche elle-même.
      sqrtArmed: false,
      // Touche "carré" du pavé "Opération" (voir opts.onSquare câblé par bindMathKeypad
      // dans toolbar.js), à droite de "√" : élève au carré les DEUX membres en une seule
      // étape (voir Expr.wrapSideInSquare/confirmSquareBothSides) — l'inverse de "√"
      // ci-dessus, pour résoudre une équation qui contient déjà une racine carrée (ex.
      // "√(x-7)=4"). Contrairement à "√", aucune étape 2 séparée n'est nécessaire :
      // "(±√A)²" vaut toujours A, sans ambiguïté (jamais besoin d'un ± comme pour la
      // racine elle-même) — une seule étape suffit, elle-même armée puis validée par
      // cohérence avec le reste de ce pavé (voir hasCurrentDraft), jamais appliquée au
      // simple clic sur la touche.
      squareArmed: false,
      error: null
    };
  }

  // Un moteur de résolution complet (steps + pending) pour UNE équation, indépendant de
  // tout autre : c'est exactement l'ancien contenu (unique) de ce fichier, réutilisable
  // pour la ligne principale ET pour chacune des deux branches d'un "produit nul".
  // Seuil (ms) pour détecter un "double-clic" par mesure de temps entre deux clics sur
  // le même terme, plutôt qu'en s'appuyant sur l'évènement DOM natif 'dblclick' : les
  // termes de premier niveau utilisent leur propre détection de clic au mousedown/mouseup
  // (voir attachPointerDrag dans render.js, nécessaire pour distinguer clic et glisser),
  // ce qui empêche 'click'/'dblclick' natifs de se déclencher de façon fiable dessus.
  var DOUBLE_CLICK_MS = 400;

  function createEngine() {
    var steps = [];
    var pending = null;
    var listeners = [];
    var lastClickKey = null;
    var lastClickTime = 0;
    // Opérateur COURANT ('\geq'/'\leq'/'<'/'>'), non nul UNIQUEMENT pour un moteur de
    // colonne "Condition d'existence" en mode inégalité (radicand>=0 d'une racine carrée,
    // voir existenceConditionAction dans l'orchestrateur/App.Ineq dans inequality.js) —
    // null pour toute équation normale ("=" implicite partout, voir Equation dans
    // equation.js, volontairement jamais touché). Posé une fois pour toutes par
    // init(equation, opts), puis mis à jour par confirm() (mode 'expr' seulement : seule
    // une multiplication/division PAR UN NOMBRE NÉGATIF peut jamais le faire changer,
    // voir plus bas) — jamais remis à zéro par resetPending (une étape confirmée doit
    // garder son sens, pas juste sa sélection en cours).
    var currentOperator = null;

    // Point de passage UNIQUE pour empiler une nouvelle étape (remplace tout
    // `steps.push(...)` direct) : y accroche `currentOperator` (voir ci-dessus) sur
    // CHAQUE étape confirmée, y compris celles qui ne changent jamais le sens
    // (Simplifier/Factoriser/Développer) — seul confirm() en mode 'expr' le fait
    // réellement varier, mais toute étape doit porter la valeur EN VIGUEUR à ce
    // moment-là pour que chaque ligne affiche le bon opérateur (voir renderChain dans
    // render.js, qui lit `step.operator`).
    function pushRaw(stepObj) {
      if (currentOperator) stepObj.operator = currentOperator;
      steps.push(stepObj);
    }

    // Vrai si ce clic (identifié par `key`, une chaîne stable pour "ce terme précis")
    // arrive assez vite après le précédent clic sur EXACTEMENT le même terme pour
    // compter comme un double-clic. Consomme le match (repart à zéro) pour qu'un
    // éventuel 3e clic rapproché ne redéclenche pas un second cran.
    function consumeDoubleClick(key) {
      var now = Date.now();
      var isDouble = key === lastClickKey && (now - lastClickTime) < DOUBLE_CLICK_MS;
      lastClickKey = isDouble ? null : key;
      lastClickTime = now;
      return isDouble;
    }

    function notify() {
      listeners.forEach(function (fn) { fn(); });
    }

    function resetPending() {
      pending = emptyPending();
      // Toute action confirmée (nouvelle étape, changement de mode...) invalide un
      // double-clic en cours de détection : sans ça, reclique plus tard sur un terme au
      // même (side, index) — même après une étape entièrement différente entre-temps —
      // pourrait à tort compter comme la suite d'un double-clic (voir consumeDoubleClick).
      lastClickKey = null;
      notify();
    }

    function lastEquation() {
      return steps[steps.length - 1].equation;
    }

    // Pousse directement une étape "à deux flèches identiques" (même description des deux
    // côtés, voir formatOpLabel dans render.js) sans passer par pending/confirm — pour une
    // opération qui porte sur les DEUX membres à la fois mais n'a, cette fois, produit
    // qu'un seul résultat (ex. "Racine carrée" quand elle ne scinde pas en plusieurs
    // branches, voir confirmSquareRoot dans l'orchestrateur App.History) : reste une étape
    // normale de LA chaîne, jamais une "fourche" à une seule branche.
    function pushStep(equation, opDesc) {
      pushRaw({ equation: equation, opLeft: opDesc, opRight: opDesc });
      resetPending();
    }

    // Variante de pushStep pour une opération qui ne porte QUE sur un seul membre (ex.
    // "Simplifier" appliqué au seul côté "constante" d'une racine carrée déjà enveloppée,
    // voir squareRootSimplifyAction/confirmSquareRoot dans l'orchestrateur App.History) :
    // l'autre membre, inchangé, reste muet (opDesc null, pas de flèche étiquetée dessus) —
    // même principe que confirmSimplifySelection pour une sélection intérieure SEULE.
    function pushAsymmetricStep(equation, opLeft, opRight) {
      pushRaw({ equation: equation, opLeft: opLeft, opRight: opRight });
      resetPending();
    }

    // `opts.operator` (optionnel) : voir la déclaration de `currentOperator` plus haut —
    // posé UNE FOIS ici pour toute la vie de ce moteur (jamais remis à zéro ailleurs),
    // absent/undefined pour toute équation normale.
    function init(equation, opts) {
      currentOperator = (opts && opts.operator) || null;
      var firstStep = { equation: equation, opLeft: null, opRight: null };
      if (currentOperator) firstStep.operator = currentOperator;
      steps = [firstStep];
      pending = emptyPending();
      lastClickKey = null;
      notify();
    }

    function selectOp(opType) {
      pending = emptyPending();
      pending.opType = opType;
      lastClickKey = null;
      notify();
    }

    // Annule le DERNIER step confirmé (retour à l'équation juste avant), et réinitialise
    // toute composition en cours (comme cancelOp) — jamais en dessous d'UN SEUL step :
    // l'équation de départ elle-même n'est jamais annulable (rien "avant" elle).
    function undo() {
      if (steps.length <= 1) return false;
      steps.pop();
      resetPending();
      return true;
    }

    function cancelOp() {
      // Rien à annuler : ne pas redéclencher un rendu (et l'animation de défilement)
      // pour rien, sinon maintenir Échap enfoncé (répétition clavier) fait "sauter" la page.
      // pending.selectedFactors/selectedFactorGroups (voir toggleFactorSelection) font
      // PARTIE de ce qu'il faut vérifier ici : ils ne touchent jamais selectedLeft/Right
      // (voir leurs commentaires), donc sans ce test un facteur sélectionné seul (ou un
      // produit complété facteur par facteur puis abandonné) restait bloqué (ni Échap, ni
      // clic en dehors de l'équation ne le désélectionnait, contrairement à un terme
      // classique).
      if (!pending.opType && !pending.drilled && !pending.selectedFactors.left && !pending.selectedFactors.right &&
          pending.selectedFactorGroups.left.length === 0 && pending.selectedFactorGroups.right.length === 0 &&
          pending.selectedLeft.length === 0 && pending.selectedRight.length === 0) return;
      resetPending();
    }

    // Sort du mode 'factor' EN GARDANT la sélection de termes/facteurs déjà faite (re-clic
    // sur le bouton "Factoriser" lui-même pour annuler CE mode, pas toute la sélection —
    // contrairement à cancelOp ci-dessus, utilisé pour Échap/clic en dehors de la fenêtre,
    // qui efface tout via resetPending). Ne réinitialise que les champs propres au mode
    // 'factor' (voir emptyPending), jamais selectedLeft/Right/selectedFactors/drilled.
    function exitFactorKeepSelection() {
      if (pending.opType !== 'factor') return;
      pending.opType = null;
      pending.factorMode = null;
      pending.factorLatex = '';
      pending.idALatex = '';
      pending.idBLatex = '';
      pending.idFocus = 'a';
      pending.idGroupBase = null;
      pending.idGroupBaseB = null;
      pending.factorChoiceFailed = [];
      pending.error = null;
      notify();
    }

    // Sélection d'un terme de premier niveau (Term ou groupe factorisé) sur la ligne
    // courante. Utilisable librement (opType null : c'est la sélection qui décide ensuite
    // quel bouton — Simplifier/Factoriser/Développer — s'active, voir computeSelectionInfo
    // dans toolbar.js), ou en mode 'factor' une fois le clavier numérique engagé. Simple
    // bascule sélectionné/désélectionné — entrer dans un groupe factorisé se fait
    // désormais par double-clic (voir drillIntoGroup), jamais par un second clic simple.
    // `branchHint` ('left'|'right', optionnel) : pour un ProductGroup, quelle parenthèse
    // précise le double-clic visait (voir render.js — déterminé via l'élément DOM
    // réellement ciblé, "data-branch", jamais depuis le geste lui-même) ; sans incidence
    // sur un simple clic (toggle normal), ni sur un FactorGroup (une seule innerTerms,
    // aucune ambiguïté).
    function toggleTermSelection(side, index, branchHint, isDenPart) {
      if (pending.opType !== null && pending.opType !== 'factor') return;
      // Le membre où l'on est "entré" (pending.drilled.side) n'est plus cliquable à son
      // premier niveau (voir render.js) : ce cas ne devrait donc pas se produire, gardé
      // par sécurité (ignore plutôt que de casser l'état). L'AUTRE membre, lui, reste
      // normalement sélectionnable pendant qu'on est entré dans un groupe — ex.
      // simplifier l'intérieur d'un groupe à gauche ET des termes à droite d'un coup —
      // et ne doit surtout pas faire ressortir du groupe en cours.
      if (pending.drilled && pending.drilled.side === side) return;
      var node = lastEquation()[side][index];
      // La clé inclut branchHint quand présent : sans ça, deux clics simples RAPIDES sur
      // DEUX parenthèses DIFFÉRENTES du même produit (ex. sélectionner "(x-5)" puis
      // "(x+2)" pour un développement partiel, voir toggleFactorSelection plus bas)
      // seraient à tort détectés comme un double-clic sur le PRODUIT ("top:side:index"
      // identique pour les deux, la branche n'y figurant pas) et déclencheraient un
      // "drill" non voulu au lieu d'ajouter la seconde parenthèse à la sélection.
      var clickKey = 'top:' + side + ':' + index + (typeof branchHint === 'number' ? ':' + branchHint : '');
      var isDouble = consumeDoubleClick(clickKey);
      // Sélection PAR FACTEUR (voir toggleFactorSelection/Expr.expandProductFactorSubset) :
      // un produit d'au moins 2 facteurs a chacune de ses parenthèses individuellement
      // sélectionnable par défaut, en sélection libre uniquement (jamais en mode 'factor',
      // qui cible un facteur commun numérique classique). Seul un clic SIMPLE visant
      // précisément une parenthèse (branchHint) l'engage : un double-clic garde son sens
      // existant ("driller" dedans, voir plus bas) ; un clic ne visant aucune parenthèse
      // précise (branchHint null — ex. le signe devant le produit) retombe sur la
      // sélection classique du noeud entier ci-dessous. Un produit à un seul facteur
      // (ex. "(x+3)²", exponent>1) n'a rien à combiner avec lui-même : reste sur l'ancien
      // comportement (sélection du noeud entier, développement complet).
      if (pending.opType === null && !isDouble && typeof branchHint === 'number' &&
          node && Expr.isProductGroup(node) && node.factors.length >= 2) {
        toggleFactorSelection(side, index, branchHint);
        pending.error = null;
        notify();
        return;
      }
      var arr = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var other = side === 'left' ? pending.selectedRight : pending.selectedLeft;
      // En mode 'factor' (facteur commun déjà engagé), la sélection reste limitée à ce
      // membre. En sélection libre, aucune restriction ici : c'est l'activation des
      // boutons qui filtre ce qui est réellement possible pour chacun.
      if (pending.opType === 'factor' && other.length > 0) return;
      var i = arr.indexOf(index);
      if (i === -1) arr.push(index);
      else arr.splice(i, 1);
      pending.error = null;
      if (isDouble) {
        // Double-clic visant précisément le dénominateur-expression d'une fraction (voir
        // \htmlData{fracpart=den} dans Expr.nodeLatex et sa détection dans onTermClick,
        // render.js) : entre DANS ce dénominateur plutôt que dans le numérateur (le
        // comportement par défaut de isFactorGroup ci-dessous, qui reste celui d'un
        // double-clic ailleurs sur la même fraction).
        if (isDenPart && node && Expr.isExpressionQuotient(node)) {
          drillIntoQuotientDenominator(side, index);
          return;
        }
        if (node && Expr.isFactorGroup(node)) {
          drillIntoGroup(side, index);
          return; // drillIntoGroup appelle déjà notify()
        }
        // Double-clic sur une racine carrée (SqrtGroup, voir "Racine carrée" dans le pavé
        // "Opération") : entre dans son radicand, même principe que drillIntoGroup.
        if (node && Expr.isSqrtGroup(node)) {
          drillIntoSqrt(side, index);
          return; // drillIntoSqrt appelle déjà notify()
        }
        // (x+2-3)(x+2+3) etc. : double-clic sur UNE parenthèse précise (branchHint) d'un
        // produit entre dedans pour en simplifier l'intérieur — jamais l'autre branche
        // (ambiguë sans branchHint, donc ignorée plutôt que de deviner). Rien pour un carré
        // dont la branche visée n'aurait qu'un seul terme : aucun intérêt à "entrer" là où
        // il n'y a rien à simplifier.
        if (node && Expr.isProductGroup(node) && typeof branchHint === 'number') {
          var isSq = Expr.isSquareFactorGroup(node);
          var targetArr = isSq ? node.factors[0].terms : node.factors[branchHint].terms;
          if (targetArr && targetArr.length >= 2) {
            drillIntoProductBranch(side, index, isSq ? 0 : branchHint);
            return;
          }
        }
      }
      notify();
    }

    // Bascule le facteur d'indice `branch` du ProductGroup à (side,index) dans/hors de la
    // sélection par facteurs en cours pour CE membre (pending.selectedFactors[side]) — un
    // seul produit à la fois PAR MEMBRE : cliquer un facteur d'un AUTRE produit DU MÊME
    // membre repart d'une sélection neuve pour ce membre (aucune opération ne combine deux
    // produits d'un même côté), mais le membre opposé garde la sienne intacte — voir
    // computeExpandTargets, qui combine les deux membres en une seule étape de
    // "Développer". Sélectionner AU MOINS 2 facteurs (sur un membre donné) active
    // "Développer" (voir computeSelectionInfo dans toolbar.js et
    // confirmExpandFullSelection/Expr.expandProductFactorSubset), en développant SEULEMENT
    // ces facteurs-là entre eux, les autres restant intacts.
    function toggleFactorSelection(side, index, branch) {
      var sel = pending.selectedFactors[side];
      if (!sel || sel.index !== index) {
        pending.selectedFactors[side] = { index: index, branches: [branch] };
      } else {
        var i = sel.branches.indexOf(branch);
        if (i === -1) {
          sel.branches.push(branch);
        } else {
          sel.branches.splice(i, 1);
          if (sel.branches.length === 0) pending.selectedFactors[side] = null;
        }
      }
      updateFactorGroupCompletion(side, index);
    }

    // Tient à jour pending.selectedFactorGroups[side] pour CE `index` précis : y entre dès
    // que TOUS ses facteurs sont marqués dans pending.selectedFactors[side] (voir
    // toggleFactorSelection), en ressort si un reclic ultérieur sur UN de ses facteurs (avant
    // de passer à un autre produit) le rend à nouveau incomplet. Ne touche jamais les
    // entrées d'autres indices — c'est précisément ce qui permet à ce tableau, contrairement
    // à pending.selectedFactors[side], de retenir plusieurs produits complétés l'un après
    // l'autre sur le même membre.
    function updateFactorGroupCompletion(side, index) {
      var node = lastEquation()[side][index];
      var sel = pending.selectedFactors[side];
      var isComplete = !!node && Expr.isProductGroup(node) && sel && sel.index === index &&
        sel.branches.length === node.factors.length;
      var list = pending.selectedFactorGroups[side];
      var pos = list.indexOf(index);
      if (isComplete && pos === -1) {
        list.push(index);
      } else if (!isComplete && pos !== -1) {
        list.splice(pos, 1);
      }
    }

    // Fusionne selectedLeft/Right (sélection classique) et selectedFactorGroups[side]
    // (produits complétés facteur par facteur, voir updateFactorGroupCompletion) pour CE
    // side : vue unifiée consommée par factorTarget/enterFactorWithSelection ainsi que par
    // App.History.getFactorSelectionIndices (utilisé par computeSelectionInfo dans
    // toolbar.js) — les deux gestes (clic sur le bord du noeud, ou clic sur chacun de ses
    // facteurs) doivent compter à l'identique pour "Factoriser".
    // Retire `index` de pending.selectedFactorGroups[side] s'il y était (voir
    // drillIntoGroup/drillIntoProductBranch/drillIntoQuotientDenominator, qui l'appellent en
    // même temps qu'ils retirent ce même index de selectedLeft/Right : "entrer" dans ce
    // noeud en fait le membre courant du drill, pas une sélection de premier niveau).
    function removeFromFactorGroups(side, index) {
      var list = pending.selectedFactorGroups[side];
      var i = list.indexOf(index);
      if (i !== -1) list.splice(i, 1);
    }

    function combinedFactorIndices(side) {
      var base = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var extra = pending.selectedFactorGroups[side];
      if (!extra || extra.length === 0) return base;
      var out = base.slice();
      extra.forEach(function (i) { if (out.indexOf(i) === -1) out.push(i); });
      return out;
    }

    // Entre dans le groupe factorisé sélectionné au premier niveau (double-clic sur un
    // terme, voir render.js) : ses termes intérieurs deviennent sélectionnables. Marche
    // que le terme ait été simplement sélectionné ou non au moment du double-clic (les
    // deux clics simples du geste ont déjà pu le sélectionner puis désélectionner —
    // aucune importance, l'état est ici forcé explicitement).
    function drillIntoGroup(side, index) {
      if (pending.opType !== null) return;
      // Un seul groupe "entré" à la fois (pending.drilled ne retient qu'un side+path) :
      // un double-clic sur un groupe de l'AUTRE membre pendant qu'on est déjà entré
      // ailleurs se comporte donc comme deux clics simples normaux (sélection/
      // désélection), plutôt que d'écraser silencieusement le premier drill en cours.
      if (pending.drilled) return;
      var node = lastEquation()[side][index];
      if (!node || !Expr.isFactorGroup(node)) return;
      var arr = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var i = arr.indexOf(index);
      if (i !== -1) arr.splice(i, 1);
      pending.drilled = { side: side, path: [index] };
      pending.selectedInner = [];
      pending.selectedFactors[side] = null;
      removeFromFactorGroups(side, index);
      pending.error = null;
      notify();
    }

    // Même principe que drillIntoGroup, pour UNE branche ('left'|'right') d'un ProductGroup
    // — ex. "(x+2-3)" dans "(x+2-3)(x+2+3)". Une seule profondeur (jamais de descente plus
    // loin dans cette branche, voir toggleInnerSelection) : ses termes sont supposés plats.
    function drillIntoProductBranch(side, index, branch) {
      if (pending.opType !== null) return;
      if (pending.drilled) return;
      var node = lastEquation()[side][index];
      if (!node || !Expr.isProductGroup(node)) return;
      var arr = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var i = arr.indexOf(index);
      if (i !== -1) arr.splice(i, 1);
      pending.drilled = { side: side, path: [index], branch: branch };
      pending.selectedInner = [];
      pending.selectedFactors[side] = null;
      removeFromFactorGroups(side, index);
      pending.error = null;
      notify();
    }

    // Même principe, pour le DÉNOMINATEUR d'une fraction dont le diviseur est une
    // expression (ex. "(...)/(x+5)", voir isExpressionQuotient/wrapSideInQuotient dans
    // expression.js) — ex. double-clic sur "(x+5)" dans "\frac{...}{x+5}" (voir
    // \htmlData{fracpart=den} dans nodeLatex et sa détection dans onTermClick/render.js).
    // Même restriction qu'une branche de ProductGroup : une seule profondeur, jamais
    // imbriquée plus loin (voir toggleInnerSelection).
    function drillIntoQuotientDenominator(side, index) {
      if (pending.opType !== null) return;
      if (pending.drilled) return;
      var node = lastEquation()[side][index];
      if (!node || !Expr.isExpressionQuotient(node)) return;
      var arr = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var i = arr.indexOf(index);
      if (i !== -1) arr.splice(i, 1);
      pending.drilled = { side: side, path: [index], part: 'den' };
      pending.selectedInner = [];
      pending.selectedFactors[side] = null;
      removeFromFactorGroups(side, index);
      pending.error = null;
      notify();
    }

    // Même principe, pour le RADICAND d'une racine carrée (SqrtGroup, voir "Racine carrée"
    // dans le pavé "Opération" / confirmSquareRoot) — ex. double-clic sur "√((x+3)²)" une
    // fois l'équation enveloppée à l'étape 1. Même restriction qu'un dénominateur-
    // expression : une seule profondeur, jamais imbriquée plus loin (voir
    // toggleInnerSelection) — la forme attendue pour l'étape 2 (un carré parfait ou une
    // constante nue) n'en a de toute façon jamais besoin.
    function drillIntoSqrt(side, index) {
      if (pending.opType !== null) return;
      if (pending.drilled) return;
      var node = lastEquation()[side][index];
      if (!node || !Expr.isSqrtGroup(node)) return;
      var arr = side === 'left' ? pending.selectedLeft : pending.selectedRight;
      var i = arr.indexOf(index);
      if (i !== -1) arr.splice(i, 1);
      pending.drilled = { side: side, path: [index], part: 'sqrt' };
      pending.selectedInner = [];
      pending.selectedFactors[side] = null;
      removeFromFactorGroups(side, index);
      pending.error = null;
      notify();
    }

    // Reconstruit l'équation avec `newArray` remis à sa place pour ce `pending.drilled`
    // (voir Expr.drilledWorkingArray/withDrilledArrayAtPath — partagés avec toolbar.js —
    // pour la résolution du tableau Node[] correspondant : intérieur d'un FactorGroup
    // classique, branche de ProductGroup, dénominateur-expression d'une fraction, ou
    // radicand d'une racine carrée).
    function applyDrilledArray(eq, d, newArray) {
      var out = Eq.cloneEquation(eq);
      out[d.side] = Expr.withDrilledArrayAtPath(eq[d.side], d, newArray);
      return out;
    }

    // Sélectionne/désélectionne un terme À L'INTÉRIEUR du groupe dans lequel on est
    // "entré" (voir toggleTermSelection/drillIntoGroup ci-dessus et pending.drilled).
    // Simple bascule — descendre encore d'un niveau se fait par double-clic (voir
    // drillIntoInnerGroup), jamais par un second clic simple.
    function toggleInnerSelection(innerIndex) {
      if (!pending.drilled) return;
      if (pending.opType !== null && pending.opType !== 'factor') return;
      var isDouble = consumeDoubleClick('inner:' + pending.drilled.path.join(',') + ':' + innerIndex);
      var i = pending.selectedInner.indexOf(innerIndex);
      if (i === -1) pending.selectedInner.push(innerIndex);
      else pending.selectedInner.splice(i, 1);
      pending.error = null;
      // Descendre encore d'un niveau (drillIntoInnerGroup) suppose un FactorGroup — une
      // branche de ProductGroup (pending.drilled.branch), un dénominateur-expression
      // (pending.drilled.part==='den', voir drillIntoQuotientDenominator) OU un radicand de
      // racine carrée (part==='sqrt', voir drillIntoSqrt) sont toujours une profondeur
      // terminale, leurs termes sont supposés plats.
      if (isDouble && typeof pending.drilled.branch !== 'number' && pending.drilled.part !== 'den' && pending.drilled.part !== 'sqrt') {
        var currentNode = Expr.nodeAtPath(lastEquation()[pending.drilled.side], pending.drilled.path);
        var innerNode = currentNode && Expr.drilledWorkingArray(currentNode, pending.drilled)[innerIndex];
        if (innerNode && Expr.isFactorGroup(innerNode)) {
          drillIntoInnerGroup(innerIndex);
          return; // drillIntoInnerGroup appelle déjà notify()
        }
      }
      notify();
    }

    // Descend encore d'un niveau : le terme intérieur à `innerIndex` (double-cliqué,
    // voir render.js) est lui-même un FactorGroup, une factorisation dans une
    // factorisation. Même principe que drillIntoGroup, transposé au niveau intérieur.
    function drillIntoInnerGroup(innerIndex) {
      if (!pending.drilled) return;
      if (pending.opType !== null) return;
      var currentNode = Expr.nodeAtPath(lastEquation()[pending.drilled.side], pending.drilled.path);
      var innerNode = currentNode && Expr.drilledWorkingArray(currentNode, pending.drilled)[innerIndex];
      if (!innerNode || !Expr.isFactorGroup(innerNode)) return;
      var i = pending.selectedInner.indexOf(innerIndex);
      if (i !== -1) pending.selectedInner.splice(i, 1);
      pending.drilled = { side: pending.drilled.side, path: pending.drilled.path.concat([innerIndex]) };
      pending.selectedInner = [];
      pending.error = null;
      notify();
    }

    // Même principe que drillIntoInnerGroup, mais pour LE FACTEUR `branch` d'un
    // ProductGroup trouvé À L'INTÉRIEUR du membre drillé (ex. "(x+9)" dans "(x+9)²(x-8)"
    // niché dans le numérateur d'une fraction, voir productGroupBranchesLatex/
    // buildNestedFactorDragLatex dans render.js pour le rendu et le glisser de CES
    // facteurs) — la cible ici est un ProductGroup, pas un FactorGroup, et on précise EN
    // PLUS quel facteur précis (voir drillIntoProductBranch, l'équivalent pour un produit
    // au premier niveau du membre plutôt que niché).
    function drillIntoNestedProductBranch(innerIndex, branch) {
      if (!pending.drilled) return;
      if (pending.opType !== null) return;
      // Une branche, un dénominateur ou un radicand déjà engagés sont des profondeurs
      // terminales (voir toggleInnerSelection) : jamais de nouvelle descente depuis là.
      if (typeof pending.drilled.branch === 'number' || pending.drilled.part === 'den' || pending.drilled.part === 'sqrt') return;
      var currentNode = Expr.nodeAtPath(lastEquation()[pending.drilled.side], pending.drilled.path);
      var innerNode = currentNode && Expr.drilledWorkingArray(currentNode, pending.drilled)[innerIndex];
      if (!innerNode || !Expr.isProductGroup(innerNode)) return;
      var branchArr = innerNode.factors[branch] && innerNode.factors[branch].terms;
      if (!branchArr || branchArr.length < 2) return;
      pending.drilled = { side: pending.drilled.side, path: pending.drilled.path.concat([innerIndex]), branch: branch };
      pending.selectedInner = [];
      pending.error = null;
      notify();
    }

    // Point d'entrée depuis render.js pour un clic sur un facteur d'un ProductGroup
    // niché (voir ci-dessus) : détecte ICI le double-clic (consumeDoubleClick, privé à ce
    // moteur) avant de vraiment descendre — un simple clic ne fait rien de plus (pas de
    // sélection par facteur pour un produit niché, seul le glisser est câblé).
    function clickNestedFactor(innerIndex, branch) {
      if (!pending.drilled) return;
      var key = 'nestedfactor:' + pending.drilled.side + ':' + pending.drilled.path.join(',') + ':' + innerIndex + ':' + branch;
      if (consumeDoubleClick(key)) drillIntoNestedProductBranch(innerIndex, branch);
    }

    // Ressort d'UN niveau (clic droit n'importe où sur la page, ou clic gauche sur la
    // parenthèse elle-même plutôt que sur un terme précis, voir render.js/main.js) : le
    // groupe qu'on vient de quitter n'est PAS resélectionné (aucune surbrillance jaune
    // résiduelle) — juste ressorti, sélection vide, comme un rendu neutre. Ressortir du
    // niveau le plus haut revient à la sélection libre normale, rien de présélectionné.
    function exitDrill() {
      if (!pending.drilled) return;
      var side = pending.drilled.side;
      var path = pending.drilled.path;
      if (path.length === 1) {
        pending.drilled = null;
      } else {
        pending.drilled = { side: side, path: path.slice(0, -1) };
      }
      pending.selectedInner = [];
      pending.error = null;
      notify();
    }

    // Cible de la sélection courante pour factoriser : soit le membre {left|right} de
    // l'équation (cas normal), soit les innerTerms du groupe (à n'importe quelle
    // profondeur) dans lequel on est "entré" (voir pending.drilled) — même tableau
    // Node[] dans les deux cas, donc les mêmes fonctions Expr.factorNodes/
    // factorRemarkableIdentityChoice s'appliquent sans distinction ; seule la façon de
    // reconstituer l'équation ensuite (`apply`) diffère.
    function factorTarget(eq) {
      if (pending.drilled) {
        var d = pending.drilled;
        var groupNode = Expr.nodeAtPath(eq[d.side], d.path);
        if (!groupNode) return null;
        // Branche d'un ProductGroup, dénominateur-expression d'une fraction, radicand
        // d'une racine carrée, ou intérieur d'un FactorGroup classique (voir
        // drilledWorkingArray/applyDrilledArray) : même tableau Node[] dans les quatre cas,
        // seule la reconstitution ensuite diffère.
        if (typeof d.branch === 'number' && !Expr.isProductGroup(groupNode)) return null;
        if (d.part === 'den' && !Expr.isExpressionQuotient(groupNode)) return null;
        if (d.part === 'sqrt' && !Expr.isSqrtGroup(groupNode)) return null;
        if (!d.part && typeof d.branch !== 'number' && !Expr.isFactorGroup(groupNode)) return null;
        return {
          side: d.side,
          array: Expr.drilledWorkingArray(groupNode, d),
          indices: pending.selectedInner,
          apply: function (newArray) { return applyDrilledArray(eq, d, newArray); }
        };
      }
      // Fusionne selectedLeft/Right avec selectedFactorGroups[side] (produits complétés
      // facteur par facteur, voir combinedFactorIndices) : les deux gestes de sélection
      // d'un produit ENTIER (clic sur son bord/signe, ou clic sur chacun de ses facteurs)
      // comptent à l'identique ici.
      var leftIdx = combinedFactorIndices('left'), rightIdx = combinedFactorIndices('right');
      var side = leftIdx.length > 0 ? 'left' : (rightIdx.length > 0 ? 'right' : null);
      if (!side) return null;
      return {
        side: side,
        array: eq[side],
        indices: side === 'left' ? leftIdx : rightIdx,
        apply: function (newArray) {
          var out = Eq.cloneEquation(eq);
          out[side] = newArray;
          return out;
        }
      };
    }

    // Vrai si une chaîne d'opération est en cours de saisie dans le champ mathématique
    // unifié (mode 'expr' — voir pending.exprLatex, alimenté par mathKeypad.js).
    function hasCurrentDraft(p) {
      return p.exprLatex !== '';
    }

    // Touche "√" du pavé "Opération" (voir pending.sqrtArmed) : bascule, ne CONFIRME rien
    // elle-même — il faut ensuite cliquer "↵" (voir confirmExprOrSqrt dans toolbar.js, qui
    // appelle alors App.History.confirmSquareRoot() plutôt que le confirm() normal de ce
    // moteur). Incompatible avec toute composition d'une chaîne +/-/×/÷ déjà en
    // cours (elle transforme l'équation en place, la racine carrée la scinde en branches à
    // la place) : ignorée tant qu'un opérande est en cours de saisie.
    function toggleSquareRootArmed() {
      if (pending.opType !== 'expr') return;
      if (!pending.sqrtArmed && hasCurrentDraft(pending)) return;
      pending.sqrtArmed = !pending.sqrtArmed;
      pending.error = null;
      notify();
    }

    // Touche "carré" du pavé "Opération" (voir pending.squareArmed) : même principe que
    // toggleSquareRootArmed ci-dessus (bascule, ne confirme rien elle-même — il faut
    // ensuite cliquer "↵", voir confirmExprOrSquare dans toolbar.js).
    function toggleSquareArmed() {
      if (pending.opType !== 'expr') return;
      if (!pending.squareArmed && hasCurrentDraft(pending)) return;
      pending.squareArmed = !pending.squareArmed;
      pending.error = null;
      notify();
    }

    // Alimente pending.exprLatex depuis le contenu live du <math-field> unifié (voir
    // mathKeypad.js, appelé à chaque frappe pour l'aperçu en direct) — remplace
    // entièrement l'ancien tampon exprRaw/digits/hasX pour ce mode.
    function setExprChainText(latex) {
      if (pending.opType !== 'expr') return;
      pending.exprLatex = latex;
      pending.error = null;
      notify();
    }

    // Alimente pending.factorLatex depuis le contenu live du <math-field> unifié (mode
    // 'factor', facteur commun) — voir parseOperandTerm, qui l'analyse.
    function setFactorTermLatex(latex) {
      if (pending.opType !== 'factor' || pending.factorMode !== 'common') return;
      pending.factorLatex = latex;
      pending.error = null;
      notify();
    }

    // Alimente idALatex OU idBLatex (selon pending.idFocus, voir setIdentityFocus) depuis
    // le contenu live du <math-field> unifié (mode 'factor', identité remarquable) — voir
    // parseIdentityAB, qui les analyse. Pas de paramètre `which` séparé : le champ visé est
    // toujours celui qui a actuellement le focus, exactement comme setExprChainText n'a
    // besoin d'aucun paramètre de mode.
    function setIdentityFieldLatex(latex) {
      if (pending.opType !== 'factor' || typeof pending.factorMode !== 'number') return;
      if (pending.idFocus === 'a') pending.idALatex = latex;
      else pending.idBLatex = latex;
      pending.error = null;
      notify();
    }

    // ---- Mode 'expr' (Opération) : chaîne d'opération tapée d'un coup ------------------
    // L'élève tape la SÉQUENCE ENTIÈRE dans le champ mathématique unifié, ex.
    // "+3-2×(5+2x)÷4", puis valide une seule fois — plutôt que l'ancien modèle où chaque
    // +/-/×/÷ cliqué validait le terme en cours et en armait un nouveau. Le résultat
    // (Eq.applyOpSequence sur la liste d'entrées obtenue) est identique à avant : une SEULE
    // nouvelle étape, voir confirm() plus bas.

    // Découpe `s` (déjà normalisé, voir parseExprChain) en entrées {op, operand} à chaque
    // "+"/"-"/"\times"/"\div" de profondeur 0 (jamais À L'INTÉRIEUR d'une parenthèse) —
    // signe de tête implicite "+" si absent (ex. "3-2" = "+3" puis "-2"). Un "-" collé
    // JUSTE APRÈS un opérateur fait partie du SIGNE de l'opérande qui suit (ex. "×-3"),
    // jamais un nouvel opérateur. Ne lève jamais d'exception : une parenthèse non fermée
    // laisse simplement un opérande "en travaux" que classifyChainEntry rejettera plus
    // loin (voir parseExprChain, qui décide alors de tolérer ou de signaler l'erreur).
    function splitOpChain(s) {
      var n = s.length;
      function opAt(i) {
        if (s.charAt(i) === '+') return '+';
        if (s.charAt(i) === '-') return '-';
        if (s.slice(i, i + 6) === '\\times') return '\\times';
        if (s.slice(i, i + 4) === '\\div') return '\\div';
        return null;
      }
      var entries = [];
      var pos = 0;
      var lead = opAt(0);
      var currentOp = lead || '+';
      if (lead) pos += lead.length;
      while (pos <= n) {
        var start = pos;
        if (s.charAt(pos) === '-') pos++; // signe de l'opérande, pas un nouveau séparateur
        var depth = 0;
        while (pos < n) {
          var c = s.charAt(pos);
          if (c === '(') { depth++; pos++; continue; }
          if (c === ')') { depth--; pos++; continue; }
          if (depth <= 0 && opAt(pos)) break;
          pos++;
        }
        entries.push({ op: currentOp, operand: s.slice(start, pos) });
        if (pos >= n) break;
        var nextOp = opAt(pos);
        currentOp = nextOp;
        pos += nextOp.length;
      }
      return entries;
    }

    // Inverse le signe d'un "terms" isolé (un nouveau facteur × ou un nouveau terme +/-,
    // voir classifyMulDivOperand/classifyPlusMinusOperand) : un noeud GROUPE (Factor/
    // ProductGroup) porte son signe sur `.sign`, jamais sur un `.coeff` (il n'en a pas) —
    // le mapper comme un Term laisserait la négation silencieusement perdue.
    function negateTerms(terms) {
      if (terms.length === 1 && Expr.isGroup(terms[0])) {
        var negGroup = Expr.cloneNode(terms[0]);
        negGroup.sign = -negGroup.sign;
        return [negGroup];
      }
      return terms.map(function (t) { return Expr.isGroup(t) ? t : { coeff: -t.coeff, pow: t.pow }; });
    }

    // Classe un opérande "×"/"÷" (texte normalisé, ex. "2(3x+5)", "(5+2x)^2", "x^7", "3")
    // en une entrée de séquence — exposant "^N" quelconque accepté (Term.pow n'est plus
    // plafonné, voir CLAUDE.md).
    function classifyMulDivOperand(symbol, raw) {
      if (symbol === '÷') {
        var sD = raw;
        var negD = false;
        if (sD.charAt(0) === '-') { negD = true; sD = sD.slice(1); }
        if (/^[0-9]+(?:[.,][0-9]+)?$/.test(sD)) {
          var value = parseFloat(sD.replace(',', '.'));
          if (negD) value = -value;
          if (Expr.roundClean(value) === 0) throw new Error('Division par zéro impossible.');
          return { symbol: '÷', factor: 1 / value, rawValue: value };
        }
        // Pas un nombre nu : diviser par une EXPRESSION (ex. "÷(x+5)") tombe dans le même
        // parsing générique que "×" ci-dessous (voir wrapSideInQuotient/Eq.applyOpSequence)
        // — plus de restriction "division seulement par un nombre" : le risque (dénominateur
        // pouvant s'annuler) est signalé sur l'étiquette de flèche, voir isZeroRiskOp
        // dans render.js.
      }
      var s = raw;
      var negate = false;
      if (s.charAt(0) === '-') { negate = true; s = s.slice(1); }
      if (s === '') throw new Error('Saisissez une valeur.');
      // Un simple nombre nu reste un facteur scalaire "classique" (distribué terme à
      // terme via wrapSideInFactor, voir Eq.applyOpSequence), jamais enveloppé dans un
      // ProductGroup — exactement comme avant. Pour "÷", ce cas est déjà couvert par le
      // test numérique ci-dessus (donc jamais atteint ici) ; `symbol` (pas '×' en dur)
      // reste correct si cette fonction change un jour d'ordre d'appel.
      if (/^[0-9]+(?:[.,][0-9]+)?$/.test(s)) {
        var xVal = parseFloat(s.replace(',', '.'));
        if (negate) xVal = -xVal;
        return { symbol: symbol, factor: xVal, rawValue: xVal };
      }
      // Cas particulier : une SEULE parenthèse nue, sans coefficient devant ni "^N"/"²"
      // derrière (ex. "(5+2x)") — un opérande de multiplication tout à fait normal ("×
      // (5+2x)"), mais que parseSide rejette pour une saisie manuelle d'ÉQUATION complète
      // (un groupe seul, exposant 1, sans coefficient, y serait redondant avec l'absence de
      // parenthèses — voir son message d'erreur dédié). Ici on veut justement CE cas : on
      // parse juste le contenu et on le renvoie tel quel, wrapSideInProduct l'enveloppera
      // en un nouveau facteur du produit (voir Eq.applyOpSequence).
      if (s.charAt(0) === '(') {
        var depth0 = 0, closeAt0 = -1;
        for (var i0 = 0; i0 < s.length; i0++) {
          if (s.charAt(i0) === '(') depth0++;
          else if (s.charAt(i0) === ')') { depth0--; if (depth0 === 0) { closeAt0 = i0; break; } }
        }
        if (closeAt0 === s.length - 1) {
          var bareInner = s.slice(1, -1);
          if (!bareInner) throw new Error('Parenthèses vides.');
          var bareTerms = App.Parser.parseSide(bareInner);
          if (negate) bareTerms = negateTerms(bareTerms);
          return { symbol: symbol, terms: bareTerms };
        }
      }
      // Tout le reste (x, x^N, N(...), (...)(...) ..., (...)^N, N(...)(...)^N chaîné...) :
      // délègue entièrement au même parseur que la saisie manuelle d'équation, réutilisé
      // ici pour UN opérande isolé — déjà généralisé aux produits N-aires et aux exposants
      // quelconques (voir parser.js), pas de logique dupliquée à maintenir ici. Partagé
      // entre "×" et "÷" (voir ci-dessus) : `symbol` porte lequel des deux appelle.
      var terms = App.Parser.parseSide(s);
      if (negate) terms = negateTerms(terms);
      return { symbol: symbol, terms: terms };
    }

    // Classe un opérande "+"/"-" : soit un simple terme signé (nombre, x, "Nx^N", "x^N"),
    // soit — un groupe entre parenthèses AVEC coefficient et/ou exposant (ex. "5(8x-2)",
    // "(8x-2)^2"), ajouté TEL QUEL comme nouveau terme du membre (jamais distribué/combiné
    // avec l'existant, contrairement à "×" qui multiplie tout le membre — voir
    // classifyMulDivOperand) : "+3-5(8x-2)" donne "(membre)+3-5(8x-2)", pas
    // "(membre)+3-40x+10". `term` peut donc être un simple Term OU un noeud groupe ;
    // Eq.applyOpSequence/Expr.addTermToSide gèrent déjà les deux uniformément.
    var CHAIN_PLUS_MINUS_RE = /^(-)?(?:([0-9]+(?:[.,][0-9]+)?)(x(?:\^([0-9]+))?)?|(x)(?:\^([0-9]+))?)$/;
    function classifyPlusMinusOperand(symbol, raw) {
      if (raw === '') throw new Error('Saisissez une valeur.');
      var m = CHAIN_PLUS_MINUS_RE.exec(raw);
      if (m) {
        var coeff, pow;
        if (m[5]) { coeff = 1; pow = m[6] ? parseInt(m[6], 10) : 1; }
        else { coeff = parseFloat(m[2].replace(',', '.')); pow = m[3] ? (m[4] ? parseInt(m[4], 10) : 1) : 0; }
        if (m[1]) coeff = -coeff; // signe embarqué dans l'opérande (rare, ex. "+-3")
        if (symbol === '-') coeff = -coeff;
        return { symbol: symbol, term: { coeff: coeff, pow: pow } };
      }
      // Pas un simple terme : un groupe entre parenthèses (coefficient/exposant requis —
      // une parenthèse totalement nue, ex. "(8x-2)" sans rien devant/derrière, n'a pas de
      // notation dédiée ici ; l'élève peut de toute façon taper "+8x-2" directement) —
      // délègue au même parseur que "×"/la saisie manuelle.
      var s = raw;
      var embeddedNegate = false;
      if (s.charAt(0) === '-') { embeddedNegate = true; s = s.slice(1); }
      var terms;
      try {
        terms = App.Parser.parseSide(s);
      } catch (e) {
        throw new Error('Expression invalide : "' + raw + '".');
      }
      if (terms.length !== 1 || !Expr.isGroup(terms[0])) {
        throw new Error('Expression invalide : "' + raw + '".');
      }
      var node = terms[0];
      if (embeddedNegate) node = negateTerms([node])[0];
      if (symbol === '-') node = negateTerms([node])[0];
      return { symbol: symbol, term: node };
    }

    function classifyChainEntry(op, operand) {
      if (op === '\\times') return classifyMulDivOperand('×', operand);
      if (op === '\\div') return classifyMulDivOperand('÷', operand);
      return classifyPlusMinusOperand(op, operand);
    }

    // Priorité usuelle : un ×/÷ qui suit directement un terme +/- multiplie CE terme
    // (ex. "+5x×2" -> "+10x", un seul terme), au lieu d'ajouter une opération séparée
    // qui multiplierait toute l'équation. Ne s'applique qu'à un terme +/- PLAT (`.coeff`) —
    // un terme +/- GROUPE (ex. "+3-5(8x-2)", voir classifyPlusMinusOperand) n'a pas de
    // `.coeff` à multiplier ; un ×/÷ qui le suit retombe alors sur le comportement par
    // défaut (multiplie/divise tout le membre accumulé), plus sûr qu'une fausse
    // multiplication silencieuse (NaN). Ne mute jamais `sequence`, renvoie un nouveau
    // tableau (sûr à appeler avec la séquence déjà validée comme avec une copie d'aperçu).
    function withOpEntry(sequence, entry) {
      if ((entry.symbol === '×' || entry.symbol === '÷') && entry.factor !== undefined && sequence.length > 0) {
        var last = sequence[sequence.length - 1];
        if ((last.symbol === '+' || last.symbol === '-') && last.term && !Expr.isGroup(last.term)) {
          var merged = {
            symbol: last.symbol,
            term: { coeff: Expr.roundClean(last.term.coeff * entry.factor), pow: last.term.pow }
          };
          return sequence.slice(0, -1).concat([merged]);
        }
      }
      return sequence.concat([entry]);
    }

    // Normalise le LaTeX du <math-field> unifié avant découpage — mêmes normalisations que
    // parseLatexSide dans parser.js (accolades \left/\right, "{,}" décimal, exposants
    // accolés), dupliquées ici car le découpage top-level (+/-/×/÷) est un grammaire
    // différente de celle d'un membre d'équation (parseSide n'a pas de notion d'opérateur
    // entre "termes", juste une somme implicite).
    function normalizeChainLatex(latex) {
      return String(latex).replace(/\{,\}/g, ',').replace(/\\left|\\right/g, '')
        .replace(/\^\{([0-9]+)\}/g, '^$1').replace(/\s+/g, '');
    }

    // Analyse la chaîne complète : `tolerant` garde le plus long préfixe d'entrées valides
    // et s'arrête silencieusement à la première erreur (aperçu en direct, voir
    // computePreview) ; sinon, la moindre erreur est remontée telle quelle (voir confirm).
    function parseExprChain(latex, tolerant) {
      var s = normalizeChainLatex(latex);
      if (s === '') {
        return { ops: [], error: tolerant ? null : 'Saisissez au moins une opération (ex. +5-2x).' };
      }
      var rawEntries = splitOpChain(s);
      var ops = [];
      for (var i = 0; i < rawEntries.length; i++) {
        try {
          var entry = classifyChainEntry(rawEntries[i].op, rawEntries[i].operand);
          ops = withOpEntry(ops, entry);
        } catch (e) {
          if (tolerant) break;
          return { ops: ops, error: e.message };
        }
      }
      return { ops: ops, error: null };
    }

    // Vrai si la sélection actuelle pour factoriser est une SOMME d'au moins 2 ProductGroup
    // (ex. "(x+1)(x+2)+(x+1)(x+5)") : le facteur commun à saisir y est alors une EXPRESSION
    // quelconque (ex. "x+1"), jamais un simple nombre/coefficient de x — voir
    // parseOperandTerm ci-dessous et Expr.factorCommonProductFactor.
    function isProductFactorSelection(target) {
      return !!target && target.indices.length >= 2 &&
        target.indices.every(function (i) { return Expr.isProductGroup(target.array[i]); });
    }

    // Terme du facteur commun (mode 'factor', factorMode==='common') : pending.factorLatex,
    // alimenté par setFactorTermLatex — analysé via le même pont LaTeX que "Opération" et
    // la modale "Nouvelle équation" (App.Parser.parseLatexSide). Cas normal : doit se
    // réduire à un SEUL terme plat (pas un groupe, pas une somme) de degré 0 ou 1, un
    // facteur commun étant alors un simple nombre ou un coefficient de x (jamais x², jamais
    // une expression). Cas d'une sélection de ProductGroup (voir isProductFactorSelection) :
    // le facteur commun est au contraire une expression quelconque, renvoyée comme Side
    // (Node[]) plutôt que comme Term — Expr.factorNodes distingue les deux via
    // Array.isArray. Renvoie null si vide ou si la forme ne convient pas (voir confirm(),
    // qui choisit le message d'erreur adapté selon lequel des deux cas c'est).
    function parseOperandTerm() {
      if (isProductFactorSelection(factorTarget(lastEquation()))) {
        if (!pending.factorLatex || !pending.factorLatex.trim()) return null;
        try {
          var parsedSide = App.Parser.parseLatexSide(pending.factorLatex);
          return (parsedSide && parsedSide.length > 0) ? parsedSide : null;
        } catch (eSide) {
          return null;
        }
      }
      var t = singleFlatTerm(pending.factorLatex);
      if (!t || t.pow > 1) return null;
      return t;
    }

    // Analyse `latex` en un UNIQUE terme plat (ni groupe, ni somme de plusieurs termes) —
    // utilisé par le facteur commun et par "a"/"b" d'une identité remarquable (cas normal,
    // pas idGroupBase/idGroupBaseB, voir plus bas) : null si vide, invalide, ou si le
    // résultat n'est pas un terme unique. Même pont LaTeX que partout ailleurs
    // (App.Parser.parseLatexSide) — pas de logique de parsing dupliquée ici.
    function singleFlatTerm(latex) {
      if (!latex || !latex.trim()) return null;
      var terms;
      try {
        terms = App.Parser.parseLatexSide(latex);
      } catch (e) {
        return null;
      }
      if (terms.length !== 1 || Expr.isGroup(terms[0])) return null;
      return terms[0];
    }

    // "a"/"b" d'une identité remarquable (mode 'factor', factorMode 1/2/3) : l'élève tape
    // directement la valeur voulue dans idALatex/idBLatex (ex. "2x", "x", "5", ou une petite
    // expression pour les cas idGroupBase/idGroupBaseB ci-dessous) — lequel des deux porte
    // le x est déduit du résultat, pas d'une désignation séparée (voir
    // project_mathlive_keypad_overhaul memory / plan Phase C).
    function parseIdentityAB() {
      // Cas "(x-2)²-(x+6)²" etc. (voir getFactorTargetShape/chooseFactorMode) : "a" ET "b"
      // doivent être TAPÉS par l'élève et correspondre structurellement à
      // idGroupBase/idGroupBaseB (les expressions réellement au carré) — jamais réutilisés
      // tels quels, sinon rien ne validerait que l'élève les a bien reconnues.
      if (pending.idGroupBase && pending.idGroupBaseB) {
        if (!pending.idALatex.trim() || !pending.idBLatex.trim()) return null;
        var parsedA2, parsedB2;
        try {
          parsedA2 = App.Parser.parseLatexSide(pending.idALatex);
          parsedB2 = App.Parser.parseLatexSide(pending.idBLatex);
        } catch (eParse2) {
          return null;
        }
        if (!Expr.sidesEquivalent(parsedA2, pending.idGroupBase)) return null;
        if (!Expr.sidesEquivalent(parsedB2, pending.idGroupBaseB)) return null;
        return { groupBaseA: pending.idGroupBase, groupBaseB: pending.idGroupBaseB };
      }
      // Cas "(expr)²-constante" (voir getFactorTargetShape/chooseFactorMode) : "a" doit
      // être TAPÉ par l'élève (ex. "x+2") et correspondre structurellement à idGroupBase
      // (l'expression réellement au carré) — jamais réutilisé tel quel, sinon rien ne
      // validerait que l'élève l'a bien reconnue. "b" reste un simple nombre positif.
      if (pending.idGroupBase) {
        if (!pending.idALatex.trim()) return null;
        var bG = singleFlatTerm(pending.idBLatex);
        if (!bG || bG.pow !== 0) return null;
        var parsedA;
        try {
          parsedA = App.Parser.parseLatexSide(pending.idALatex);
        } catch (eParseA) {
          return null;
        }
        if (!Expr.sidesEquivalent(parsedA, pending.idGroupBase)) return null;
        return { groupBase: pending.idGroupBase, b: bG.coeff };
      }
      // Cas normal : chacun des deux doit être un simple nombre OU un coefficient de x
      // (jamais x², jamais une somme) — exactement l'un des deux doit être le terme en x,
      // l'autre une constante.
      var termA = singleFlatTerm(pending.idALatex);
      var termB = singleFlatTerm(pending.idBLatex);
      if (!termA || !termB || termA.pow > 1 || termB.pow > 1) return null;
      var aIsX = termA.pow === 1, bIsX = termB.pow === 1;
      if (aIsX === bIsX) return null; // ni l'un ni l'autre (ou les deux) porte le x
      return {
        a: termA.coeff,
        b: termB.coeff,
        aIsX: aIsX,
        xCoeff: aIsX ? termA.coeff : termB.coeff,
        constVal: aIsX ? termB.coeff : termA.coeff
      };
    }

    function confirm() {
      var eq = lastEquation();
      var opType = pending.opType;
      if (!opType) return false;

      if (opType === 'expr') {
        var parsedChain = parseExprChain(pending.exprLatex, false);
        if (parsedChain.error) {
          pending.error = parsedChain.error;
          notify();
          return false;
        }
        var ops = parsedChain.ops;
        if (ops.length === 0) {
          pending.error = 'Saisissez au moins une opération (ex. +5-2x).';
          notify();
          return false;
        }
        // Mode inégalité (currentOperator non nul, voir sa déclaration plus haut) : ×/÷
        // par une EXPRESSION (ops[i].terms présent, ex. "×(x+5)") reste hors-champ pour
        // l'instant — son signe dépend de x, une inversion de sens ne peut pas se décider
        // aveuglément comme pour un simple nombre (voir CLAUDE.md/le plan). Vérifié AVANT
        // d'appliquer quoi que ce soit : un rejet clair plutôt qu'un résultat mal posé.
        if (currentOperator && ops.some(function (op) { return (op.symbol === '×' || op.symbol === '÷') && op.terms; })) {
          pending.error = 'Multiplier ou diviser par une expression n\'est pas encore pris en charge dans une inégalité.';
          notify();
          return false;
        }
        var newEqExpr;
        try {
          newEqExpr = Eq.applyOpSequence(eq, ops);
        } catch (eExpr) {
          pending.error = eExpr.message;
          notify();
          return false;
        }
        // Chaque ×/÷ par un nombre NÉGATIF (rawValue déjà signé, voir
        // classifyMulDivOperand) inverse le sens de l'inégalité ; un nombre pair
        // d'inversions revient au sens de départ (ex. ÷(-2) puis ×(-3) : deux
        // inversions, sens inchangé) — voir App.Ineq.flipOperator (inequality.js).
        // N'importe pour une équation normale (currentOperator déjà null, jamais mis à
        // jour ici).
        if (currentOperator) {
          var signFlips = ops.filter(function (op) {
            return (op.symbol === '×' || op.symbol === '÷') && typeof op.rawValue === 'number' && op.rawValue < 0;
          }).length;
          if (signFlips % 2 === 1) currentOperator = Ineq.flipOperator(currentOperator);
        }
        var opDescExpr = { type: 'expr', ops: ops };
        pushRaw({ equation: newEqExpr, opLeft: opDescExpr, opRight: opDescExpr });
      } else if (opType === 'factor') {
        var target = factorTarget(eq);
        if (!target || target.indices.length < 1) {
          pending.error = 'Sélectionnez au moins un terme à factoriser.';
          notify();
          return false;
        }
        if (pending.factorMode === null) {
          pending.error = 'Choisissez d\'abord une méthode.';
          notify();
          return false;
        }
        var newEqF, stepDesc;
        if (pending.factorMode === 'common') {
          var factorTerm = parseOperandTerm();
          if (!factorTerm) {
            pending.error = pending.factorLatex.trim() === ''
              ? 'Saisissez le facteur commun.'
              : (isProductFactorSelection(target)
                ? 'Le facteur commun doit être une expression valide.'
                : 'Le facteur commun doit être un simple nombre ou un coefficient de x.');
            notify();
            return false;
          }
          try {
            newEqF = target.apply(Expr.factorNodes(target.array, target.indices, factorTerm));
          } catch (e3) {
            pending.error = e3.message;
            notify();
            return false;
          }
          stepDesc = { type: 'factor', side: target.side, factor: factorTerm };
        } else {
          var ab = parseIdentityAB();
          if (!ab) {
            var aEmptyNow = pending.idALatex.trim() === '';
            var bEmptyNow = pending.idBLatex.trim() === '';
            if (pending.idGroupBase && pending.idGroupBaseB) {
              if (aEmptyNow && bEmptyNow) {
                pending.error = 'Saisissez "a" et "b".';
              } else if (aEmptyNow) {
                pending.error = 'Saisissez "a".';
              } else if (bEmptyNow) {
                pending.error = 'Saisissez "b".';
              } else {
                pending.error = 'La valeur de "a" ou "b" ne correspond pas à l\'expression sélectionnée.';
              }
            } else if (pending.idGroupBase) {
              if (aEmptyNow && bEmptyNow) {
                pending.error = 'Saisissez "a" et "b".';
              } else if (aEmptyNow) {
                pending.error = 'Saisissez "a".';
              } else if (bEmptyNow) {
                pending.error = 'Saisissez "b".';
              } else {
                pending.error = 'La valeur de "a" ne correspond pas à l\'expression sélectionnée.';
              }
            } else if (aEmptyNow && bEmptyNow) {
              pending.error = 'Saisissez "a" et "b".';
            } else if (aEmptyNow) {
              pending.error = 'Saisissez "a".';
            } else if (bEmptyNow) {
              pending.error = 'Saisissez "b".';
            } else {
              pending.error = 'L\'un des deux doit être un simple nombre, l\'autre un coefficient de x.';
            }
            notify();
            return false;
          }
          try {
            if (ab.groupBaseA && ab.groupBaseB) {
              newEqF = target.apply(Expr.factorDifferenceOfTwoSquareGroups(target.array, target.indices));
            } else if (ab.groupBase) {
              newEqF = target.apply(Expr.factorDifferenceOfSquaresFromGroup(target.array, target.indices, ab.b));
            } else {
              newEqF = target.apply(Expr.factorRemarkableIdentityChoice(target.array, target.indices, pending.factorMode, ab.xCoeff, ab.constVal, ab.aIsX));
            }
          } catch (e3b) {
            pending.error = e3b.message;
            notify();
            return false;
          }
          if (ab.groupBaseA && ab.groupBaseB) {
            stepDesc = { type: 'factorIdentity', side: target.side, identityType: pending.factorMode, aExpr: ab.groupBaseA, bExpr: ab.groupBaseB };
          } else if (ab.groupBase) {
            stepDesc = { type: 'factorIdentity', side: target.side, identityType: pending.factorMode, aExpr: ab.groupBase, b: ab.b };
          } else {
            stepDesc = { type: 'factorIdentity', side: target.side, identityType: pending.factorMode, a: ab.a, b: ab.b, aIsX: ab.aIsX };
          }
        }
        var stepF = { equation: newEqF, opLeft: null, opRight: null };
        stepF[target.side === 'left' ? 'opLeft' : 'opRight'] = stepDesc;
        pushRaw(stepF);
      } else {
        return false;
      }
      resetPending();
      return true;
    }

    // Étiquette d'étape "développer" pour un développement COMPLET (tous les innerTerms
    // sortent) : partagée entre confirmExpandFullSelection et l'aperçu en direct.
    function fullExpandDesc(node) {
      return {
        type: 'expand',
        factor: { coeff: node.factor.coeff, pow: node.factor.pow },
        terms: node.innerTerms.slice(),
        isDivision: !!node.isDivision
      };
    }

    // Étiquette d'étape "développer" pour un ProductGroup "(a+b)(c+d)" (double
    // distributivité) : partagée entre confirmExpandFullSelection et l'aperçu en direct.
    function fullExpandProductDesc(node) {
      return { type: 'expandProduct', factors: node.factors.map(function (f) { return { terms: f.terms.slice(), exponent: f.exponent }; }) };
    }

    // ---- Sélection libre (opType null) : simplifier/factoriser/développer se déclenchent
    // directement depuis les termes sélectionnés, sans "entrer" dans un mode au préalable
    // (voir computeSelectionInfo dans toolbar.js pour l'activation des boutons). ----

    // "Simplifier" agit immédiatement (pas d'étape intermédiaire à confirmer).
    function confirmSimplifySelection() {
      if (pending.opType !== null) return false;
      var eq = lastEquation();
      if (pending.drilled) {
        var d = pending.drilled;
        var otherSide = d.side === 'left' ? 'right' : 'left';
        var otherIndices = otherSide === 'left' ? pending.selectedLeft : pending.selectedRight;
        var groupNode = Expr.nodeAtPath(eq[d.side], d.path);
        var isBranch = typeof d.branch === 'number' && groupNode && Expr.isProductGroup(groupNode);
        var isDen = d.part === 'den' && groupNode && Expr.isExpressionQuotient(groupNode);
        var isSqrt = d.part === 'sqrt' && groupNode && Expr.isSqrtGroup(groupNode);
        if (!groupNode || (!isBranch && !isDen && !isSqrt && !Expr.isFactorGroup(groupNode))) return false;
        var innerArr = Expr.drilledWorkingArray(groupNode, d);
        var innerOk = pending.selectedInner.length >= 2;
        var otherOk = otherIndices.length >= 2;
        if (!innerOk && !otherOk) return false;
        var outD = Eq.cloneEquation(eq);
        var innerOpDesc = null, otherOpDesc = null;
        if (innerOk) {
          var newInner;
          try {
            newInner = Expr.simplifyNodes(innerArr, pending.selectedInner);
          } catch (eD) {
            return false;
          }
          var selectedTerms = pending.selectedInner.slice().sort(function (a, b) { return a - b; })
            .map(function (i) { return innerArr[i]; });
          outD[d.side] = applyDrilledArray(eq, d, newInner)[d.side];
          innerOpDesc = { type: 'simplify', terms: selectedTerms };
        }
        // L'autre membre se simplifie indépendamment, dans la MÊME étape (voir
        // computeSelectionInfo dans toolbar.js) — exactement comme applySimplifyBoth le
        // fait déjà pour une sélection libre gauche+droite classique.
        if (otherOk) {
          var otherSorted = otherIndices.slice().sort(function (a, b) { return a - b; });
          var otherTerms = otherSorted.map(function (i) { return eq[otherSide][i]; });
          try {
            outD[otherSide] = Expr.simplifyNodes(eq[otherSide], otherIndices);
          } catch (eOther) {
            return false;
          }
          otherOpDesc = { type: 'simplify', terms: otherTerms };
        }
        var stepD = { equation: outD, opLeft: null, opRight: null };
        stepD[d.side === 'left' ? 'opLeft' : 'opRight'] = innerOpDesc;
        stepD[otherSide === 'left' ? 'opLeft' : 'opRight'] = otherOpDesc;
        pushRaw(stepD);
        resetPending();
        return true;
      }
      var result;
      try {
        result = Eq.applySimplifyBoth(eq, pending.selectedLeft, pending.selectedRight);
      } catch (e) {
        return false;
      }
      if (!result.opLeft && !result.opRight) return false; // sélection insuffisante/invalide
      pushRaw({ equation: result.equation, opLeft: result.opLeft, opRight: result.opRight });
      resetPending();
      return true;
    }

    // "Factoriser" a encore besoin d'un nombre (le facteur commun) : on passe en mode
    // 'factor' SANS réinitialiser la sélection déjà faite, pour afficher son clavier.
    function enterFactorWithSelection() {
      if (pending.opType !== null) return false;
      // Factoriser un terme SEUL n'a rien à "extraire de commun" : exige au moins 2
      // termes sélectionnés (voir aussi computeSelectionInfo dans toolbar.js, qui grise
      // le bouton "Factoriser" tant que ce n'est pas le cas).
      if (pending.drilled) {
        if (pending.selectedInner.length < 2) return false;
        pending.opType = 'factor';
        pending.factorChoiceFailed = [];
        pending.error = null;
        notify();
        return true;
      }
      // combinedFactorIndices (pas selectedLeft/Right seuls) : un produit sélectionné
      // facteur par facteur (voir toggleFactorSelection/selectedFactorGroups) doit compter
      // ici exactement comme un produit sélectionné en bloc, sous peine de bloquer
      // silencieusement l'entrée en mode 'factor' alors même que le bouton est actif (voir
      // computeSelectionInfo dans toolbar.js, qui utilise la même fusion).
      var L = combinedFactorIndices('left').length, R = combinedFactorIndices('right').length;
      if (!((L >= 2 && R === 0) || (R >= 2 && L === 0))) return false;
      pending.opType = 'factor';
      pending.factorChoiceFailed = [];
      pending.error = null;
      notify();
      return true;
    }

    // Décrit la FORME (nombre de termes, degrés présents) de la sélection actuellement
    // ciblée pour factoriser, indépendamment de tout facteur/identité déjà choisi — sert à
    // détecter, AU CLIC sur une identité remarquable (voir chooseFactorMode), qu'elle ne
    // peut structurellement pas s'appliquer (avant même de savoir quelles valeurs a/b
    // conviendraient). Renvoie null si la sélection ne peut de toute façon pas être
    // factorisée (groupe imbriqué, etc.), SAUF le cas particulier "(expr)²-constante"
    // (ex. (x+8)²-4) où l'expression au carré déjà factorisée sert de "a" fixe pour
    // l'identité 3 : signalé par le champ groupBase (Node[] de l'intérieur du carré).
    function getFactorTargetShape() {
      var target = factorTarget(lastEquation());
      if (!target || target.indices.length < 1) return null;
      var nodes = target.indices.map(function (i) { return target.array[i]; });
      if (nodes.length === 2) {
        // "(x-2)²-(x+6)²" etc. : DEUX carrés déjà factorisés, de signes opposés — "a" ET
        // "b" sont chacun une expression (voir Expr.factorDifferenceOfTwoSquareGroups),
        // testé AVANT le cas "carré + simple constante" ci-dessous (mutuellement exclusifs
        // de toute façon, un carré n'étant jamais aussi une simple constante).
        var posSq = null, negSq = null;
        nodes.forEach(function (n) {
          if (Expr.isSquareFactorGroup(n) && n.sign === 1) posSq = n;
          if (Expr.isSquareFactorGroup(n) && n.sign === -1) negSq = n;
        });
        if (posSq && negSq) {
          return { count: 2, hasX2: false, hasX1: false, hasX0: false, groupBaseA: posSq.factors[0].terms, groupBaseB: negSq.factors[0].terms };
        }
        var sq = null, constNode = null;
        nodes.forEach(function (n) {
          if (Expr.isSquareFactorGroup(n) && n.sign === 1) sq = n;
          else if (!Expr.isGroup(n) && n.pow === 0) constNode = n;
        });
        if (sq && constNode && constNode.coeff < 0) {
          return { count: 2, hasX2: false, hasX1: false, hasX0: true, groupBase: sq.factors[0].terms };
        }
      }
      if (nodes.some(Expr.isGroup)) return null;
      return {
        count: nodes.length,
        hasX2: nodes.some(function (n) { return n.pow === 2; }),
        hasX1: nodes.some(function (n) { return n.pow === 1; }),
        hasX0: nodes.some(function (n) { return n.pow === 0; })
      };
    }

    // Vrai si la sélection actuelle a structurellement la forme requise par l'identité
    // `mode` (1/2/3), indépendamment des valeurs a/b (voir getFactorTargetShape) : 1/2
    // veulent exactement x²+x+constante, 3 veut exactement x²+constante (sans terme en x)
    // OU la forme "(expr)²-constante" (shape.groupBase).
    function shapeMatchesIdentity(mode) {
      var shape = getFactorTargetShape();
      if (!shape) return false;
      if (mode === 3) {
        if (shape.groupBaseA && shape.groupBaseB) return shape.count === 2;
        return shape.count === 2 && shape.hasX0 && (shape.groupBase || (shape.hasX2 && !shape.hasX1));
      }
      return shape.count === 3 && shape.hasX2 && shape.hasX1 && shape.hasX0;
    }

    // Étape 1 -> étape 2 du sélecteur "Factoriser" : mode 'common' (facteur commun,
    // digits/hasX/negative comme avant) ou 1/2/3 (identité remarquable, idA/idB/idXField).
    // Tous les boutons de l'étape 1 restent cliquables même quand la forme ne correspond
    // pas (voir buildFactorChoiceStep dans toolbar.js) : dans ce cas, on ne quitte pas
    // l'étape 1, on affiche une erreur explicite et on marque ce bouton comme "grisé" sans
    // pour autant le désactiver. pending.factorChoiceFailed accumule CHAQUE identité déjà
    // essayée sans succès (jamais remis à zéro par un autre essai, même réussi — seule une
    // toute nouvelle sélection via enterFactorWithSelection repart de zéro) : plusieurs
    // boutons peuvent donc rester grisés simultanément.
    function chooseFactorMode(mode) {
      if (pending.opType !== 'factor') return;
      if (typeof mode === 'number' && !shapeMatchesIdentity(mode)) {
        if (pending.factorChoiceFailed.indexOf(mode) === -1) pending.factorChoiceFailed.push(mode);
        pending.error = 'L\'expression n\'est pas factorisable par cette identité remarquable.';
        notify();
        return;
      }
      var shapeNow = typeof mode === 'number' ? getFactorTargetShape() : null;
      pending.factorMode = mode;
      pending.factorLatex = '';
      pending.idALatex = '';
      pending.idBLatex = '';
      pending.idFocus = 'a';
      if (shapeNow && shapeNow.groupBaseA && shapeNow.groupBaseB) {
        // "(x-2)²-(x+6)²" etc. : "a" ET "b" sont chacun une expression à taper (voir
        // idALatex/idBLatex et Expr.factorDifferenceOfTwoSquareGroups).
        pending.idGroupBase = shapeNow.groupBaseA.map(Expr.cloneNode);
        pending.idGroupBaseB = shapeNow.groupBaseB.map(Expr.cloneNode);
      } else if (shapeNow && shapeNow.groupBase) {
        pending.idGroupBase = shapeNow.groupBase.map(Expr.cloneNode);
        pending.idGroupBaseB = null;
      } else {
        pending.idGroupBase = null;
        pending.idGroupBaseB = null;
      }
      pending.error = null;
      notify();
    }

    // Bouton retour (étape 2 -> étape 1) : revient au choix de méthode sans perdre la
    // sélection de termes (voir factorTarget, inchangée par cet appel).
    function goBackToFactorChoice() {
      if (pending.opType !== 'factor') return;
      chooseFactorMode(null);
    }

    // Change quel champ ("a" ou "b") le <math-field> partagé édite (voir
    // setIdentityFieldLatex) — clic sur le champ correspondant dans le pavé (voir
    // toolbar.js), ou touche Tab pendant que le champ est focalisé (voir opts.onTab dans
    // mathKeypad.js).
    function setIdentityFocus(which) {
      if (pending.opType !== 'factor' || typeof pending.factorMode !== 'number') return;
      if (which !== 'a' && which !== 'b') return;
      pending.idFocus = which;
      pending.error = null;
      notify();
    }

    // Rassemble, pour une sélection libre (jamais drilled) donnée, TOUS les groupes à
    // développer en une seule étape : chaque top-level group marqué dans
    // selectedLeft/Right (développement COMPLET chacun) PLUS, indépendamment, le
    // sous-ensemble de facteurs marqué via toggleFactorSelection sur UN ProductGroup
    // (développement PARTIEL de celui-ci, voir Expr.expandProductFactorSubset) — ex.
    // "(x−6)²−(x+6)(x−9)²=0" : sélectionner "(x−6)²" en entier ET seulement la
    // parenthèse "(x−9)²" du second produit développe les deux à la fois, "(x+6)"
    // restant intact. Renvoie [] si rien de valide n'est sélectionné (jamais null) : les
    // noeuds non-groupes glissés par erreur dans selectedLeft/Right sont simplement
    // ignorés plutôt que d'invalider toute la sélection (cohérent avec computeSelectionInfo
    // dans toolbar.js, qui ne compte que les indices réellement développables).
    function computeExpandTargets(eq, p) {
      var targets = [];
      // Sélection par facteur (voir toggleFactorSelection) : au plus UN produit par membre,
      // mais les deux membres se combinent ici en une seule étape, exactement comme
      // selectedLeft/Right ci-dessous.
      ['left', 'right'].forEach(function (side) {
        var sf = p.selectedFactors[side];
        if (!sf) return;
        var nodeSF = eq[side][sf.index];
        if (nodeSF && Expr.isProductGroup(nodeSF) && sf.branches.length >= 1 &&
            !(sf.branches.length === 1 && nodeSF.factors[sf.branches[0]].exponent < 2)) {
          targets.push({ side: side, index: sf.index, kind: 'partial', branches: sf.branches.slice(), node: nodeSF });
        }
      });
      ['left', 'right'].forEach(function (side) {
        var arr = side === 'left' ? p.selectedLeft : p.selectedRight;
        arr.forEach(function (idx) {
          var node = eq[side][idx];
          // Une fraction dont le dénominateur est une expression (isExpressionQuotient) ne
          // se développe pas "en entier" (distribuer la division sur chaque terme du
          // numérateur répéterait juste le même dénominateur, voir wrapSideInQuotient) —
          // son numérateur ET son dénominateur restent chacun développables séparément en
          // "entrant" dedans (pending.drilled), pas via cette sélection libre au premier
          // niveau.
          if (node && Expr.isGroup(node) && !Expr.isExpressionQuotient(node)) {
            targets.push({ side: side, index: idx, kind: 'full', node: node });
          }
        });
      });
      return targets;
    }

    // Applique tous les `targets` (voir computeExpandTargets) en une seule étape, en
    // traitant les indices d'un même membre du plus grand au plus petit (un développement
    // change la longueur du membre — traiter dans cet ordre garde les indices des
    // groupes restant à traiter valides). Combine les étiquettes de chaque membre touché
    // en un seul desc ('expandMulti' dès que >1 partie, sinon la forme habituelle
    // inchangée — voir formatOpLabel dans render.js) pour rester une seule flèche/étape.
    function applyExpandTargets(eq, targets) {
      var eqOut = Eq.cloneEquation(eq);
      var partsBySide = { left: [], right: [] };
      ['left', 'right'].forEach(function (side) {
        var sideTargets = targets.filter(function (t) { return t.side === side; });
        if (sideTargets.length === 0) return;
        sideTargets.sort(function (a, b) { return b.index - a.index; });
        var descsDesc = [];
        sideTargets.forEach(function (t) {
          if (t.kind === 'full') {
            if (Expr.isProductGroup(t.node)) {
              eqOut = Eq.applyExpandProduct(eqOut, side, t.index);
              descsDesc.push(fullExpandProductDesc(t.node));
            } else {
              var allIdx = t.node.innerTerms.map(function (_, i) { return i; });
              eqOut = Eq.applyExpand(eqOut, side, t.index, allIdx);
              descsDesc.push(fullExpandDesc(t.node));
            }
          } else {
            eqOut = Eq.applyExpandProductFactorSubset(eqOut, side, t.index, t.branches);
            var sortedBranches = t.branches.slice().sort(function (a, b) { return a - b; });
            descsDesc.push({
              type: 'expandProduct',
              factors: sortedBranches.map(function (i) {
                return { terms: t.node.factors[i].terms.slice(), exponent: t.node.factors[i].exponent };
              })
            });
          }
        });
        // Reconstitué en ordre descendant (voir tri ci-dessus) : remis en ordre de lecture
        // gauche->droite pour l'étiquette combinée.
        partsBySide[side] = descsDesc.reverse();
      });
      var out = { equation: eqOut, opLeft: null, opRight: null };
      if (partsBySide.left.length === 1) out.opLeft = partsBySide.left[0];
      else if (partsBySide.left.length > 1) out.opLeft = { type: 'expandMulti', parts: partsBySide.left };
      if (partsBySide.right.length === 1) out.opRight = partsBySide.right[0];
      else if (partsBySide.right.length > 1) out.opRight = { type: 'expandMulti', parts: partsBySide.right };
      return out;
    }

    // "Développer" agit immédiatement sur la sélection courante, en la développant
    // entièrement (plus de développement partiel terme par terme) — voir
    // computeExpandTargets/applyExpandTargets ci-dessus pour la sélection libre (un ou
    // plusieurs groupes/sous-ensembles de facteurs à la fois, combinés en une seule étape).
    function confirmExpandFullSelection() {
      if (pending.opType !== null) return false;
      var eq = lastEquation();
      if (pending.drilled) {
        var d = pending.drilled;
        var groupNode = Expr.nodeAtPath(eq[d.side], d.path);
        // Une branche de ProductGroup (d.branch) n'atteint jamais ce cas : `groupNode` y est
        // un ProductGroup, jamais un FactorGroup (voir isFactorGroup) — exclue naturellement
        // ci-dessous, exactement comme avant. Le dénominateur-expression (d.part==='den') et
        // le radicand d'une racine carrée (d.part==='sqrt'), eux, sont ajoutés explicitement
        // (leurs propres termes intérieurs restent développables normalement).
        var isDenExp = d.part === 'den' && groupNode && Expr.isExpressionQuotient(groupNode);
        var isSqrtExp = d.part === 'sqrt' && groupNode && Expr.isSqrtGroup(groupNode);
        if (!groupNode || (!isDenExp && !isSqrtExp && !Expr.isFactorGroup(groupNode)) || pending.selectedInner.length !== 1) return false;
        var targetIdx = pending.selectedInner[0];
        var drilledArr = Expr.drilledWorkingArray(groupNode, d);
        var targetNode = drilledArr[targetIdx];
        // Un dénominateur-expression imbriqué (ex. "÷d1" puis "÷d2" sans annulation, voir
        // wrapSideInQuotient) reste exclu même trouvé DANS un membre drillé : expandFactorGroup/
        // expandOneInner supposent un `factor` numérique classique.
        if (!targetNode || !Expr.isGroup(targetNode) || Expr.isExpressionQuotient(targetNode)) return false;
        var newInnerD, descD;
        try {
          if (Expr.isProductGroup(targetNode)) {
            var expandedTermsD = Expr.expandProductGroup(targetNode);
            newInnerD = [];
            drilledArr.forEach(function (t, i) {
              if (i === targetIdx) expandedTermsD.forEach(function (e) { newInnerD.push(e); });
              else newInnerD.push(Expr.cloneNode(t));
            });
            descD = fullExpandProductDesc(targetNode);
          } else {
            var allInnerIdx = targetNode.innerTerms.map(function (_, i) { return i; });
            newInnerD = Expr.expandFactorGroup(drilledArr, targetIdx, allInnerIdx);
            descD = fullExpandDesc(targetNode);
          }
        } catch (eExp) {
          pending.error = eExp.message;
          notify();
          return false;
        }
        var outExpD = applyDrilledArray(eq, d, newInnerD);
        var stepExpD = { equation: outExpD, opLeft: null, opRight: null };
        stepExpD[d.side === 'left' ? 'opLeft' : 'opRight'] = descD;
        pushRaw(stepExpD);
        resetPending();
        return true;
      }
      var targets = computeExpandTargets(eq, pending);
      if (targets.length === 0) return false;
      var res;
      try {
        res = applyExpandTargets(eq, targets);
      } catch (eT) {
        pending.error = eT.message;
        notify();
        return false;
      }
      var stepExpand = { equation: res.equation, opLeft: res.opLeft, opRight: res.opRight };
      pushRaw(stepExpand);
      resetPending();
      return true;
    }

    // Calcule l'équation et les étiquettes d'opération "en direct" pour la ligne en attente,
    // sans committer quoi que ce soit dans `steps`.
    function computePreview() {
      var last = lastEquation();
      var p = pending;

      if (!p.opType) {
        // "Entré" dans un groupe (voir pending.drilled) : aperçu de Développer (un seul
        // terme intérieur qui est lui-même un groupe sélectionné) ou de Simplifier
        // (sélection intérieure suffisante) — même logique que le niveau du membre,
        // transposée aux termes intérieurs.
        if (p.drilled) {
          var dPrev = p.drilled;
          var groupNodePrev = Expr.nodeAtPath(last[dPrev.side], dPrev.path);
          var isBranchPrev = typeof dPrev.branch === 'number' && groupNodePrev && Expr.isProductGroup(groupNodePrev);
          var isDenPrev = dPrev.part === 'den' && groupNodePrev && Expr.isExpressionQuotient(groupNodePrev);
          var isSqrtPrev = dPrev.part === 'sqrt' && groupNodePrev && Expr.isSqrtGroup(groupNodePrev);
          if (!groupNodePrev || (!isBranchPrev && !isDenPrev && !isSqrtPrev && !Expr.isFactorGroup(groupNodePrev))) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
          var innerArrPrev = Expr.drilledWorkingArray(groupNodePrev, dPrev);
          // Une branche de ProductGroup n'a jamais de descente plus profonde (voir
          // drillIntoProductBranch/toggleInnerSelection) : pas d'aperçu "Développer" à y
          // chercher, ses termes sont supposés plats. Un dénominateur-expression et un
          // radicand de racine carrée, eux, se comportent comme un FactorGroup classique
          // ici (voir isDenPrev/isSqrtPrev ci-dessus).
          if (!isBranchPrev && p.selectedInner.length === 1) {
            var targetIdxPrev = p.selectedInner[0];
            var targetNodePrev = innerArrPrev[targetIdxPrev];
            // Même exclusion que confirmExpandFullSelection : un dénominateur-expression
            // imbriqué n'a pas de `factor` numérique pour expandFactorGroup/expandOneInner.
            if (targetNodePrev && Expr.isGroup(targetNodePrev) && !Expr.isExpressionQuotient(targetNodePrev)) {
              try {
                var newInnerExpPrev, descPrev;
                if (Expr.isProductGroup(targetNodePrev)) {
                  var expandedPrev = Expr.expandProductGroup(targetNodePrev);
                  newInnerExpPrev = [];
                  innerArrPrev.forEach(function (t, i) {
                    if (i === targetIdxPrev) expandedPrev.forEach(function (e) { newInnerExpPrev.push(e); });
                    else newInnerExpPrev.push(Expr.cloneNode(t));
                  });
                  descPrev = fullExpandProductDesc(targetNodePrev);
                } else {
                  var allInnerIdxPrev = targetNodePrev.innerTerms.map(function (_, i) { return i; });
                  newInnerExpPrev = Expr.expandFactorGroup(innerArrPrev, targetIdxPrev, allInnerIdxPrev);
                  descPrev = fullExpandDesc(targetNodePrev);
                }
                var eqExpPrev = applyDrilledArray(last, dPrev, newInnerExpPrev);
                var stepExpPrev = { equation: eqExpPrev, opLeft: null, opRight: null };
                stepExpPrev[dPrev.side === 'left' ? 'opLeft' : 'opRight'] = descPrev;
                return stepExpPrev;
              } catch (ePrevExpD) {
                return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
              }
            }
          }
          // L'AUTRE membre (pas celui où l'on est "entré") reste sélectionnable pendant
          // qu'on est dans un groupe (voir render.js) : son aperçu se combine ici avec
          // celui de l'intérieur du groupe, pour rester fidèle à ce que confirme
          // confirmSimplifySelection (les deux simplifiés dans la même étape).
          var otherSidePrev = dPrev.side === 'left' ? 'right' : 'left';
          var otherIndicesPrev = otherSidePrev === 'left' ? p.selectedLeft : p.selectedRight;
          var innerOkPrev = p.selectedInner.length >= 2;
          var otherOkPrev = otherIndicesPrev.length >= 2;
          if (!innerOkPrev && !otherOkPrev) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
          try {
            var eqPrevD = Eq.cloneEquation(last);
            var innerDescPrev = null, otherDescPrev = null;
            if (innerOkPrev) {
              var newInnerPrev = Expr.simplifyNodes(innerArrPrev, p.selectedInner);
              var selectedTermsPrev = p.selectedInner.slice().sort(function (a, b) { return a - b; })
                .map(function (i) { return innerArrPrev[i]; });
              eqPrevD[dPrev.side] = applyDrilledArray(last, dPrev, newInnerPrev)[dPrev.side];
              innerDescPrev = { type: 'simplify', terms: selectedTermsPrev };
            }
            if (otherOkPrev) {
              var otherSortedPrev = otherIndicesPrev.slice().sort(function (a, b) { return a - b; });
              var otherTermsPrev = otherSortedPrev.map(function (i) { return last[otherSidePrev][i]; });
              eqPrevD[otherSidePrev] = Expr.simplifyNodes(last[otherSidePrev], otherIndicesPrev);
              otherDescPrev = { type: 'simplify', terms: otherTermsPrev };
            }
            var stepPrevD = { equation: eqPrevD, opLeft: null, opRight: null };
            stepPrevD[dPrev.side === 'left' ? 'opLeft' : 'opRight'] = innerDescPrev;
            stepPrevD[otherSidePrev === 'left' ? 'opLeft' : 'opRight'] = otherDescPrev;
            return stepPrevD;
          } catch (ePrevD) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
        }
        // Sélection libre : aperçu de ce que ferait Développer (un ou plusieurs groupes/
        // sous-ensembles de facteurs marqués, voir computeExpandTargets/applyExpandTargets
        // ci-dessus) ou Simplifier (sélection suffisante), pour voir le résultat avant
        // même de cliquer sur le bouton correspondant.
        var pL = p.selectedLeft, pR = p.selectedRight;
        var pTargets = computeExpandTargets(last, p);
        if (pTargets.length > 0) {
          try {
            var previewRes = applyExpandTargets(last, pTargets);
            return { equation: previewRes.equation, opLeft: previewRes.opLeft, opRight: previewRes.opRight };
          } catch (ePrevExp) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
        }
        if (pL.length >= 2 || pR.length >= 2) {
          try {
            return Eq.applySimplifyBoth(last, pL, pR);
          } catch (ePrevSimp) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
        }
        return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
      }

      if (p.opType === 'expr') {
        // Aperçu tolérant : garde le plus long préfixe d'entrées déjà valides dans la
        // chaîne en cours de frappe (voir parseExprChain), ignore silencieusement le reste
        // encore incomplet — le <math-field> lui-même affiche déjà tout ce qui est tapé,
        // pas besoin d'un repli "texte brut" séparé comme avant (rawText). ("√"/"(‥)²"
        // ARMÉES, voir pending.sqrtArmed/squareArmed, n'atteignent jamais ce chemin : leur
        // propre aperçu dédié, voir previewSquareRoot/previewSquareBothSides plus bas et
        // shouldShowLivePreview dans render.js, remplace celui-ci pendant qu'elles le sont.)
        var chainPreview = parseExprChain(p.exprLatex, true);
        if (chainPreview.ops.length === 0) {
          return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
        }
        var exprDesc = { type: 'expr', ops: chainPreview.ops };
        try {
          var newEqExprP = Eq.applyOpSequence(last, chainPreview.ops);
          return { equation: newEqExprP, opLeft: exprDesc, opRight: exprDesc };
        } catch (eExprP) {
          return { equation: Eq.cloneEquation(last), opLeft: exprDesc, opRight: exprDesc };
        }
      }

      if (p.opType === 'factor') {
        var pTarget = factorTarget(last);
        if (!pTarget || pTarget.indices.length < 1) {
          return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
        }
        var previewEqF, previewDesc = null;
        if (p.factorMode === null) {
          // Étape 1 : méthode pas encore choisie, parenthèses seules (comme si le facteur
          // valait 1) — rien de plus à prévisualiser tant que rien n'est choisi.
          try {
            previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
          } catch (e3z) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
        } else if (p.factorMode === 'common') {
          var factorTerm = parseOperandTerm();
          var hasFactorTerm = !!factorTerm && (Array.isArray(factorTerm) || Expr.roundClean(factorTerm.coeff) !== 0);
          if (hasFactorTerm) {
            try {
              previewEqF = pTarget.apply(Expr.factorNodes(pTarget.array, pTarget.indices, factorTerm));
            } catch (e3) {
              // Le facteur tapé ne s'applique pas ENCORE (ex. "x+1" en cours de frappe sur
              // une sélection de ProductGroup — voir Expr.factorCommonProductFactor, qui
              // exige une correspondance structurelle EXACTE — ou un nombre qui ne divise
              // rien de la sélection) : on retombe sur un simple groupement entre
              // parenthèses quand c'est possible (termes plats, voir factorNodesRaw), ou
              // sinon sur l'équation INCHANGÉE (une sélection de groupes déjà factorisés/
              // ProductGroup ne peut de toute façon pas se grouper entre parenthèses
              // davantage — factorNodesRaw refuse tout noeud déjà groupe). Dans tous les
              // cas, l'étiquette "factoriser par ..." ci-dessous doit malgré tout refléter
              // ce qui est tapé EN DIRECT (retour visuel immédiat pour l'élève), plutôt que
              // de disparaître tant que ça ne "matche" pas exactement.
              try {
                previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
              } catch (e3b) {
                previewEqF = Eq.cloneEquation(last);
              }
            }
            previewDesc = { type: 'factor', factor: factorTerm };
          } else {
            // Facteur commun pas encore saisi : parenthèses seules si possible (comme si
            // c'était 1), sinon l'équation inchangée (voir commentaire ci-dessus).
            try {
              previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
            } catch (e3c) {
              previewEqF = Eq.cloneEquation(last);
            }
          }
        } else {
          // Identité remarquable (factorMode 1/2/3) : tant que "b" n'est pas saisi, ou que
          // la sélection ne correspond pas au motif attendu avec les a/b actuels, on
          // retombe sur les parenthèses seules plutôt que de laisser fuiter une erreur
          // "en direct" pendant la saisie (voir le même principe pour '×' plus haut).
          var abPrev = parseIdentityAB();
          try {
            if (abPrev && abPrev.groupBaseA && abPrev.groupBaseB) {
              previewEqF = pTarget.apply(Expr.factorDifferenceOfTwoSquareGroups(pTarget.array, pTarget.indices));
              previewDesc = { type: 'factorIdentity', identityType: p.factorMode, aExpr: abPrev.groupBaseA, bExpr: abPrev.groupBaseB };
            } else if (abPrev && abPrev.groupBase) {
              previewEqF = pTarget.apply(Expr.factorDifferenceOfSquaresFromGroup(pTarget.array, pTarget.indices, abPrev.b));
              previewDesc = { type: 'factorIdentity', identityType: p.factorMode, aExpr: abPrev.groupBase, b: abPrev.b };
            } else if (abPrev) {
              previewEqF = pTarget.apply(Expr.factorRemarkableIdentityChoice(pTarget.array, pTarget.indices, p.factorMode, abPrev.xCoeff, abPrev.constVal, abPrev.aIsX));
              previewDesc = { type: 'factorIdentity', identityType: p.factorMode, a: abPrev.a, b: abPrev.b, aIsX: abPrev.aIsX };
            } else {
              previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
            }
          } catch (e3c) {
            try {
              previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
            } catch (e3d) {
              return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
            }
          }
        }
        var stepPreviewF = { equation: previewEqF, opLeft: null, opRight: null };
        stepPreviewF[pTarget.side === 'left' ? 'opLeft' : 'opRight'] = previewDesc;
        return stepPreviewF;
      }

      return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
    }

    // Applique un nouvel ordre (permutation complète, par indices d'origine) aux termes
    // d'un membre de la dernière équation (glisser-déposer) : purement visuel, sans effet
    // mathématique (l'addition est commutative), donc pas une nouvelle étape de
    // l'historique — on remplace juste l'équation courante en place. Toujours notifié,
    // même sans changement réel, pour effacer proprement les artefacts visuels du glisser
    // (transformations CSS temporaires, terme estompé) via un rendu normal.
    function setSideOrder(side, orderOfOrigIndices) {
      var lastStep = steps[steps.length - 1];
      var oldArr = lastStep.equation[side];
      var isIdentity = orderOfOrigIndices.length === oldArr.length &&
        orderOfOrigIndices.every(function (v, i) { return v === i; });
      if (!isIdentity) {
        var newArr = orderOfOrigIndices.map(function (i) { return oldArr[i]; });
        var newEquation = { left: lastStep.equation.left, right: lastStep.equation.right };
        newEquation[side] = newArr;
        lastStep.equation = newEquation;
      }
      notify();
    }

    // Même principe que setSideOrder, mais pour les termes INTÉRIEURS du groupe dans
    // lequel on est "entré" (voir pending.drilled) plutôt que pour un membre entier —
    // permet de réordonner à la souris les termes à l'intérieur d'une parenthèse, que ce
    // soit un FactorGroup classique (innerTerms) ou UN FACTEUR d'un ProductGroup
    // (pending.drilled.branch, index numérique — ex. "(x+2-3)" dans "(x+2-3)(x+2+3)" ou
    // "(x+3)" dans "(x+3)²" — voir withProductBranchAtPath dans expression.js).
    function setInnerOrder(orderOfOrigIndices) {
      if (!pending.drilled) return;
      var lastStep = steps[steps.length - 1];
      var d = pending.drilled;
      var side = d.side;
      var path = d.path;
      var node = Expr.nodeAtPath(lastStep.equation[side], path);
      if (!node) return;
      var oldArr = Expr.drilledWorkingArray(node, d);
      var isIdentity = orderOfOrigIndices.length === oldArr.length &&
        orderOfOrigIndices.every(function (v, i) { return v === i; });
      if (!isIdentity) {
        var newArr = orderOfOrigIndices.map(function (i) { return oldArr[i]; });
        lastStep.equation = applyDrilledArray(lastStep.equation, d, newArr);
      }
      notify();
    }

    // Même principe que setInnerOrder, mais pour les FACTEURS d'un ProductGroup NICHÉ dans
    // le membre drillé, à l'indice `innerIndex` de son tableau courant (voir
    // Expr.drilledWorkingArray) — ex. "(x+5)²(x-1)" trouvé dans le numérateur d'une
    // fraction (voir le marquage ajouté dans drilledGroupLatex, render.js). Purement
    // visuel (un produit reste commutatif), donc pas une nouvelle étape — modifie juste ses
    // `factors` en place, comme setFactorOrder pour un ProductGroup de premier niveau.
    function setDrilledFactorOrder(innerIndex, orderOfOrigIndices) {
      if (!pending.drilled) return;
      var lastStep = steps[steps.length - 1];
      var d = pending.drilled;
      var groupNode = Expr.nodeAtPath(lastStep.equation[d.side], d.path);
      if (!groupNode) return;
      var workingArr = Expr.drilledWorkingArray(groupNode, d);
      var productNode = workingArr[innerIndex];
      if (!productNode || !Expr.isProductGroup(productNode)) return;
      var oldFactors = productNode.factors;
      var isIdentity = orderOfOrigIndices.length === oldFactors.length &&
        orderOfOrigIndices.every(function (v, i) { return v === i; });
      if (!isIdentity) {
        var newFactors = orderOfOrigIndices.map(function (i) { return oldFactors[i]; });
        var newProductNode = { sign: productNode.sign, factors: newFactors };
        var newArr = workingArr.map(function (n, i) { return i === innerIndex ? newProductNode : n; });
        lastStep.equation = applyDrilledArray(lastStep.equation, d, newArr);
      }
      notify();
    }

    // Même principe que setSideOrder, mais pour les FACTEURS d'un ProductGroup de PREMIER
    // NIVEAU (pas "drillé" — voir productGroupFactorsLatexForOrder/escalateFactorDragToTopLevel
    // dans render.js) : glisser-déposer réordonnant par exemple "(x+7)²(x+5)" en
    // "(x+5)(x+7)²". Purement visuel (un produit reste commutatif), donc pas une nouvelle
    // étape — modifie juste `factors` en place, comme setSideOrder pour `equation[side]`.
    function setFactorOrder(side, groupIndex, orderOfOrigIndices) {
      var lastStep = steps[steps.length - 1];
      var node = lastStep.equation[side][groupIndex];
      if (!node || !Expr.isProductGroup(node)) return;
      var oldFactors = node.factors;
      var isIdentity = orderOfOrigIndices.length === oldFactors.length &&
        orderOfOrigIndices.every(function (v, i) { return v === i; });
      if (!isIdentity) {
        var newFactors = orderOfOrigIndices.map(function (i) { return oldFactors[i]; });
        var newNode = { sign: node.sign, factors: newFactors };
        var newSide = lastStep.equation[side].map(function (n, i) { return i === groupIndex ? newNode : n; });
        var newEquation = { left: lastStep.equation.left, right: lastStep.equation.right };
        newEquation[side] = newSide;
        lastStep.equation = newEquation;
      }
      notify();
    }

    return {
      subscribe: function (fn) { listeners.push(fn); },
      init: init,
      getSteps: function () { return steps; },
      getPending: function () { return pending; },
      lastEquation: lastEquation,
      // Opérateur en vigueur pour CE moteur ('\geq'/'\leq'/'<'/'>', ou null pour "="
      // implicite) — voir la déclaration de `currentOperator` plus haut. Sert à
      // newEquationModal.js pour réafficher la bonne relation en rouvrant la modale sur
      // l'équation en cours d'édition (equationToLatex).
      getCurrentOperator: function () { return currentOperator; },
      pushStep: pushStep,
      pushAsymmetricStep: pushAsymmetricStep,
      selectOp: selectOp,
      cancelOp: cancelOp,
      exitFactorKeepSelection: exitFactorKeepSelection,
      toggleTermSelection: toggleTermSelection,
      toggleInnerSelection: toggleInnerSelection,
      drillIntoGroup: drillIntoGroup,
      drillIntoProductBranch: drillIntoProductBranch,
      drillIntoInnerGroup: drillIntoInnerGroup,
      exitDrill: exitDrill,
      confirmSimplifySelection: confirmSimplifySelection,
      enterFactorWithSelection: enterFactorWithSelection,
      getFactorTargetShape: getFactorTargetShape,
      getFactorSelectionIndices: combinedFactorIndices,
      chooseFactorMode: chooseFactorMode,
      goBackToFactorChoice: goBackToFactorChoice,
      setIdentityFocus: setIdentityFocus,
      confirmExpandFullSelection: confirmExpandFullSelection,
      toggleSquareRootArmed: toggleSquareRootArmed,
      toggleSquareArmed: toggleSquareArmed,
      setExprChainText: setExprChainText,
      setFactorTermLatex: setFactorTermLatex,
      setIdentityFieldLatex: setIdentityFieldLatex,
      parseOperandTerm: parseOperandTerm,
      confirm: confirm,
      computePreview: computePreview,
      setSideOrder: setSideOrder,
      setInnerOrder: setInnerOrder,
      setDrilledFactorOrder: setDrilledFactorOrder,
      clickNestedFactor: clickNestedFactor,
      setFactorOrder: setFactorOrder,
      undo: undo
    };
  }

  // ---- createBranchable() : enrobe un moteur "feuille" (createEngine()) avec la
  // capacité de se scinder en N enfants indépendants au clic sur "Produit nul" (une
  // équation factorisée en (A)(B)...=0 se résout en scindant en N équations
  // A=0/B=0/..., un produit est nul si et seulement si l'un de ses facteurs l'est — voir
  // Expr.flattenProductFactors, qui extrait directement les N facteurs du ProductGroup,
  // voir expression.js) ou "Racine carrée" (1 ou 2 enfants selon que la constante vaut 0
  // ou non). RÉCURSIF : chaque enfant est lui-même un createBranchable() complet, donc
  // capable de se scinder À NOUVEAU — ex. un facteur "x²+18x+81=0" réécrit par une
  // identité remarquable en "(9+x)²=0" À L'INTÉRIEUR d'une colonne "Produit nul" reste
  // résoluble par "Racine carrée" dans CETTE colonne, plutôt que de rester bloqué comme
  // si seule l'équation de tout premier niveau pouvait jamais s'y prêter. App.History
  // EST un de ces noeuds (la racine de l'arbre) ; chaque colonne affichée (voir
  // render.js, Hist.getBranches()) en est un autre, avec exactement la même API.
  //
  // Toute méthode "active" (qui agit sur/lit la chaîne EN COURS DE TRAVAIL, listée dans
  // DELEGATED_METHODS plus bas) se contente de déléguer, SI ce noeud a des enfants, à
  // l'enfant focalisé — qui, étant lui-même un createBranchable(), refait exactement le
  // même test avant d'agir : la récursion à profondeur arbitraire se fait donc via la
  // pile d'appels JS normale, sans boucle de descente explicite ici. `leaf.<method>`
  // n'est appelé QUE quand ce noeud n'a PAS d'enfants (cas terminal — un enfant qui n'a
  // jamais lui-même été scindé davantage).
  function createBranchable() {
    var leaf = createEngine();
    var branches = null;        // null, ou [branchable, branchable, ...] (au moins 1) — récursif
    var focusedBranch = 0;      // index dans `branches` — quel enfant reçoit clavier/pavé/sélection
    var branchSplitLabel = '';  // LaTeX affiché sur la flèche fourchue (voir drawFork dans arrows.js) — du texte ("\text{...}") ou un symbole mathématique brut, selon l'action
    // Colonnes "Condition d'existence" (domaine de définition) : contrairement à
    // `branches`, qui REMPLACE `leaf` (gelé, toute délégation part vers focusedChild()),
    // ces colonnes COEXISTENT avec `leaf` toujours actif — chacune est son propre
    // createBranchable() indépendant, née d'un dénominateur/radicand "figé" au moment du
    // clic (voir existenceConditionAction). null, ou [{ id, kind: 'den'|'sqrt',
    // capturedArray, operator, engine, solved, solvedSetLatex }, ...]. `focusedDomain` est
    // null tant que le clavier/pavé cible `leaf` (ou un enfant de `branches`) ; sinon
    // l'index dans `domainConditions` dont l'`engine` reçoit la délégation à la place.
    // Restriction v1 (voir CLAUDE.md/plan) : un même noeud n'a jamais `branches` ET
    // `domainConditions` à la fois — Produit nul/Racine carrée deviennent indisponibles
    // sur CE noeud une fois `domainConditions` posé (voir canProduitNul/canSquareRoot).
    var domainConditions = null;
    var focusedDomain = null;
    // "Tableau de signes" (voir canSignChart/signChartAction plus bas) : même principe de
    // COEXISTENCE que `domainConditions` juste au-dessus (un noeud garde son `leaf` actif),
    // et pour cause — signChartAction() exige `domainConditions` déjà entièrement résolu
    // avant de pouvoir s'activer (voir canSignChart). null, ou { factors: [{ id,
    // kind:'num'|'den', capturedSide, engine }, ...], constantSign, tableRows }, créé UNE
    // SEULE FOIS par noeud (signChartAction() est un no-op si déjà posé, contrairement à
    // `domainConditions` qui accumule une entrée par dénominateur/radicand distinct).
    var signChart = null;
    var focusedSignChartFactor = null;
    var listeners = [];

    function notify() {
      listeners.forEach(function (fn) { fn(); });
    }
    // Toute mutation de `leaf` (à ce niveau OU, par ricochet, dans n'importe quel enfant
    // plus bas — chaque enfant s'abonne de même à SON PROPRE parent, voir
    // splitIntoBranches) remonte ainsi jusqu'à la racine : render.js ne s'abonne qu'une
    // fois, à App.History (voir main.js).
    leaf.subscribe(notify);

    function focusedChild() { return branches[focusedBranch]; }

    // Enfant vers lequel toute méthode "active" (DELEGATED_METHODS ci-dessous, ou les
    // méthodes à délégation manuelle comme confirmProduitNul/confirmSquareRoot) doit
    // déléguer EN CE MOMENT, ou null si c'est `leaf` lui-même la cible (cas terminal).
    // `branches` a toujours priorité (voir la restriction v1 ci-dessus : jamais les deux
    // à la fois sur un même noeud).
    function activeChild() {
      if (branches) return focusedChild();
      if (domainConditions && focusedDomain !== null) return domainConditions[focusedDomain].engine;
      if (signChart && focusedSignChartFactor !== null) return signChart.factors[focusedSignChartFactor].engine;
      return null;
    }

    function init(equation, opts) {
      branches = null;
      focusedBranch = 0;
      branchSplitLabel = '';
      domainConditions = null;
      focusedDomain = null;
      signChart = null;
      focusedSignChartFactor = null;
      leaf.init(equation, opts);
    }

    function setFocusedBranch(index) {
      if (!branches || index < 0 || index >= branches.length || focusedBranch === index) return;
      focusedBranch = index;
      notify();
    }

    // Variante silencieuse (pas de notify) : utilisée juste avant de déléguer une action
    // à cet enfant (ex. un clic sur un terme), pour que la délégation le cible déjà
    // correctement — l'action elle-même déclenchera son propre (unique) rendu.
    function focusBranch(index) {
      if (branches && index >= 0 && index < branches.length) focusedBranch = index;
    }

    // Même principe que setFocusedBranch/focusBranch, mais pour `domainConditions` (voir
    // ce champ plus haut) : `setFocusedDomain` notifie (clic direct sur une colonne),
    // `focusDomain` est la variante silencieuse utilisée juste avant de déléguer un clic
    // de terme à l'intérieur d'une colonne. `focusMain()` rend la main à `leaf` (clic sur
    // la chaîne principale, ou sur une branche Produit nul) — notifie, symétriquement à
    // setFocusedDomain.
    function setFocusedDomain(index) {
      if (!domainConditions || index < 0 || index >= domainConditions.length || focusedDomain === index) return;
      focusedDomain = index;
      notify();
    }

    function focusDomain(index) {
      if (domainConditions && index >= 0 && index < domainConditions.length) focusedDomain = index;
    }

    // Même principe encore, cette fois pour `signChart.factors` (voir ce champ plus haut).
    function setFocusedSignChartFactor(index) {
      if (!signChart || index < 0 || index >= signChart.factors.length || focusedSignChartFactor === index) return;
      focusedSignChartFactor = index;
      notify();
    }

    function focusSignChartFactor(index) {
      if (signChart && index >= 0 && index < signChart.factors.length) focusedSignChartFactor = index;
    }

    function focusMain() {
      if (focusedDomain === null && focusedSignChartFactor === null) return;
      focusedDomain = null;
      focusedSignChartFactor = null;
      notify();
    }

    // Toujours possible dès qu'il y a quoi que ce soit à annuler : soit une étape dans
    // l'enfant focalisé (à N'IMPORTE quelle profondeur, via la récursion sur canUndo
    // elle-même), soit — à défaut — la scission de CE noeud (voir undo ci-dessous).
    function canUndo() {
      if (branches) return true;
      return leaf.getSteps().length > 1;
    }

    // Annule la dernière étape du noeud ACTIF (celui atteint en suivant la chaîne des
    // enfants focalisés). Si cet enfant n'a plus RIEN à annuler EN SON SEIN (ni étape
    // propre, ni sa propre scission plus bas), annule directement CETTE scission-ci
    // plutôt que de ne rien faire : retour à `leaf`, qui n'a jamais été modifié par la
    // scission (elle ne fait que créer de NOUVEAUX enfants à partir de sa dernière
    // équation), donc rien d'autre à restaurer. Peu importe l'avancement des AUTRES
    // enfants à ce moment : annuler la scission les annule tous ensemble, symétriquement
    // à la façon dont elle les a tous créés ensemble.
    function undo() {
      if (branches) {
        if (focusedChild().canUndo()) return focusedChild().undo();
        branches = null;
        focusedBranch = 0;
        branchSplitLabel = '';
        notify();
        return true;
      }
      return leaf.undo();
    }

    // Scinde CE noeud en N enfants indépendants, un par élément de `equations`, les
    // affecte à `branches`, et notifie une seule fois à la fin. Commun à "Produit nul"
    // et "Racine carrée" (voir confirmProduitNul/confirmSquareRoot ci-dessous).
    // `labelLatex` est du LaTeX déjà prêt à l'affichage (pas juste du texte brut à
    // envelopper) — voir drawFork dans arrows.js : "\text{produit nul}" pour l'un, un
    // symbole mathématique brut pour l'autre.
    function splitIntoBranches(equations, labelLatex) {
      var engines = equations.map(function (eq) {
        var eng = createBranchable();
        // init() déclenche son propre notify() interne : s'y abonner AVANT l'appel
        // provoquerait un rendu prématuré (branches pas encore affecté ci-dessous), dont
        // les éléments DOM seraient aussitôt détachés par le rendu suivant — laissant des
        // étiquettes de flèche fantômes bloquées en (0,0) (position d'un élément détaché).
        eng.init(eq);
        eng.subscribe(notify);
        return eng;
      });
      branches = engines;
      focusedBranch = 0;
      branchSplitLabel = labelLatex;
      notify();
    }

    // Détecte si `eq` est de la forme (A)(B)...=0 ou 0=(A)(B)... — soit un ProductGroup
    // seul d'un côté, potentiellement imbriqué à volonté (voir Expr.flattenProductFactors,
    // ex. "(a+b)(c+d)²"), soit un FactorGroup issu d'un facteur commun (ex. "x(x-5)=0",
    // voir "Factoriser" dans history.js/confirm : `factor·innerTerms`, PAS une division) —
    // la constante 0 seule de l'autre côté dans tous les cas ; renvoie { factors: Side[] },
    // les facteurs DISTINCTS après déduplication structurelle (voir Expr.sidesEquivalent —
    // ex. "(a+bx)²=0" ne donne qu'UN facteur, une seule colonne ; "(a+b)(c+d)²=0" en donne
    // deux), ou null sinon. Un facteur purement numérique constant (le `factor` d'un
    // FactorGroup, ex. "2" dans "2(x-5)=0" ; ou un facteur terminal d'un ProductGroup, ex.
    // "-1" dans "(x+1)(-1)=0") n'est jamais retenu comme branche : il ne dépend jamais de x
    // et ne peut donc jamais s'annuler — pas de branche "2=0" ou "-1=0" vide de sens, seuls
    // les facteurs dépendant de x comptent alors. Renvoie null si aucun facteur ainsi
    // filtré ne subsiste. Le signe (à n'importe quel niveau d'imbrication, et
    // FactorGroup.sign) est indifférent : un produit nul reste nul quel que soit son signe
    // global.
    function detectProduitNul(eq) {
      function trySide(prodSide, zeroSide) {
        var pSide = eq[prodSide], zSide = eq[zeroSide];
        if (pSide.length !== 1) return null;
        if (zSide.length !== 1 || Expr.isGroup(zSide[0]) || zSide[0].pow !== 0 || Expr.roundClean(zSide[0].coeff) !== 0) return null;
        var node = pSide[0];
        var allFactors;
        if (Expr.isProductGroup(node)) {
          // Comme pour le facteur numérique d'un FactorGroup ci-dessous (ex. "2" dans
          // "2(x-5)=0"), un facteur purement constant (ex. "-1" dans "(x+1)(-1)=0", produit
          // par "×(-1)" — voir wrapSideInProduct/operandFactors) ne dépend jamais de x et ne
          // peut donc jamais s'annuler : pas de branche "-1=0" vide de sens.
          allFactors = Expr.flattenProductFactors(node).filter(function (f) {
            return !(f.length === 1 && !Expr.isGroup(f[0]) && f[0].pow === 0);
          });
        } else if (Expr.isFactorGroup(node) && !node.isDivision) {
          allFactors = [];
          if (node.factor.pow !== 0) allFactors.push([node.factor]);
          allFactors.push(node.innerTerms);
        } else {
          return null;
        }
        var distinct = [];
        allFactors.forEach(function (f) {
          if (!distinct.some(function (d) { return Expr.sidesEquivalent(d, f); })) distinct.push(f);
        });
        if (distinct.length === 0) return null;
        return { factors: distinct };
      }
      return trySide('left', 'right') || trySide('right', 'left');
    }

    // Comme "Racine carrée" (voir canSquareRoot/detectSquareRoot plus bas), pas de
    // sélection préalable à faire : "Produit nul" ne distingue de toute façon jamais QUELS
    // facteurs on a cliqués, seulement la FORME de l'équation entière ((...)( ...)...=0) —
    // exiger un clic n'ajoutait qu'une étape artificielle. Scission imbriquée d'un enfant
    // déjà scindé : déléguée à l'enfant focalisé, à profondeur arbitraire (voir le
    // commentaire au-dessus de createBranchable) plutôt qu'interdite.
    // Détecte si "Condition d'existence" est disponible EN CE MOMENT : l'élève est
    // "entré" (pending.drilled, voir drillIntoQuotientDenominator/drillIntoSqrt) dans un
    // dénominateur-expression (part==='den') ou un radicand de racine carrée
    // (part==='sqrt') — aucune sélection intérieure requise, contrairement à
    // Simplifier/Factoriser (voir computeSelectionInfo dans toolbar.js, qui appelle
    // directement ceci plutôt que de redupliquer cette détection).
    // Un radicand de degré <= 1 (aucun terme de puissance >= 2, aucun groupe imbriqué) :
    // seule forme dont la condition "radicand >= 0" reste résolvable par une colonne de
    // domaine, via le moteur d'inégalité linéaire habituel (×/÷ négatif inverse le sens,
    // voir confirm() en mode 'expr'). Un radicand degré >= 2 (ex. "x²-9") donnerait, une
    // fois factorisé, une inégalité de produit qui exigerait une étude de signe — retirée
    // (voir CLAUDE.md) — donc jamais offerte comme point de départ ici.
    function isLinearRadicand(radicand) {
      return radicand.every(function (n) { return !Expr.isGroup(n) && n.pow <= 1; });
    }

    function canExistenceCondition() {
      if (activeChild()) return activeChild().canExistenceCondition();
      var d = leaf.getPending().drilled;
      if (!d) return false;
      var groupNode = Expr.nodeAtPath(leaf.lastEquation()[d.side], d.path);
      if (!groupNode) return false;
      if (d.part === 'den') return Expr.isExpressionQuotient(groupNode);
      if (d.part === 'sqrt') return Expr.isSqrtGroup(groupNode) && isLinearRadicand(groupNode.radicand);
      return false;
    }

    // Clic sur "Condition d'existence" : crée une nouvelle colonne "domaine de
    // définition" à partir du dénominateur/radicand actuellement drillé (dénominateur ≠
    // 0, radicand ≥ 0), OU — si un domaine STRUCTURELLEMENT identique (voir
    // Expr.sidesEquivalent) a déjà été créé par un clic précédent — signale juste son
    // index pour que l'appelant (toolbar.js) recentre la vue dessus au lieu d'en créer un
    // second (voir App.Render.panToDomainColumn). `capturedArray` fige une COPIE du
    // dénominateur/radicand au moment du clic : la colonne créée est ensuite totalement
    // indépendante de l'équation principale, exactement comme une branche Produit nul.
    function existenceConditionAction() {
      if (activeChild()) return activeChild().existenceConditionAction();
      if (!canExistenceCondition()) return { spawned: false, pan: false };
      var d = leaf.getPending().drilled;
      var groupNode = Expr.nodeAtPath(leaf.lastEquation()[d.side], d.path);
      var arr = Expr.drilledWorkingArray(groupNode, d);
      var existingIdx = -1;
      if (domainConditions) {
        for (var i = 0; i < domainConditions.length; i++) {
          if (Expr.sidesEquivalent(domainConditions[i].capturedArray, arr)) { existingIdx = i; break; }
        }
      }
      if (existingIdx >= 0) return { spawned: false, pan: true, index: existingIdx };
      var conditionOperator = d.part === 'den' ? '\\neq' : '\\geq';
      var eng = createBranchable();
      // Le dénominateur (part==='den') reste une équation NORMALE ("=0" à résoudre, sa
      // colonne relabellise juste la ligne finale en "≠", voir renderDomainSplit dans
      // render.js) — seul le radicand (part==='sqrt') passe réellement en mode inégalité
      // (opts.operator, voir init() dans createEngine), sens inversé par tout ×/÷ négatif
      // le long de sa propre résolution (voir confirm() en mode 'expr').
      eng.init({ left: Expr.cloneSide(arr), right: [{ coeff: 0, pow: 0 }] },
        d.part === 'sqrt' ? { operator: conditionOperator } : undefined);
      eng.subscribe(notify);
      domainConditions = (domainConditions || []).concat([{
        id: domainConditions ? domainConditions.length : 0,
        kind: d.part,
        capturedArray: Expr.cloneSide(arr),
        operator: conditionOperator,
        engine: eng,
        solved: false,
        solvedSetLatex: null
      }]);
      // Ressort du drill, comme n'importe quelle autre action qui "confirme" (Simplifier,
      // Factoriser...) — sans ça, l'élève reste bloqué dans CE dénominateur/radicand
      // (pending.drilled.side toujours posé empêche tout nouveau clic sur l'AUTRE membre,
      // voir toggleTermSelection) et ne pourrait jamais drills un second
      // dénominateur/radicand du même côté sans d'abord ressortir manuellement (Échap).
      // exitDrill() notifie déjà lui-même : pas besoin d'un second notify() ici.
      leaf.exitDrill();
      return { spawned: true, pan: false, index: domainConditions.length - 1 };
    }

    function canProduitNul() {
      if (activeChild()) return activeChild().canProduitNul();
      // v1 : indisponible sur ce noeud une fois qu'il porte déjà des colonnes "Condition
      // d'existence" (voir la restriction en tête de createBranchable) — pas de conflit
      // de délégation possible plus bas (activeChild() aurait déjà intercepté).
      if (domainConditions) return false;
      // Même restriction pour un "Tableau de signes" déjà posé ICI (retour utilisateur :
      // survoler "Produit nul" une fois le tableau construit montrait un aperçu de flèches
      // mal positionné, et cliquer dessus faisait carrément DISPARAÎTRE le tableau —
      // `splitIntoBranches` pose `branches`, que le rendu affiche À LA PLACE de la chaîne
      // principale/du tableau, sans jamais toucher `signChart` lui-même : ses données
      // restaient donc intactes mais plus rien ne les affichait). Les deux scissions
      // restent mutuellement exclusives sur un même noeud, comme `domainConditions`
      // l'est déjà — voir aussi canSignChart, qui refuse symétriquement tant que
      // `branches` est posé.
      if (signChart) return false;
      return !!detectProduitNul(leaf.lastEquation());
    }

    // Aperçu en lecture seule pour le survol du bouton "Produit nul" (voir
    // shouldShowLivePreview dans render.js) : mêmes équations que confirmProduitNul
    // produirait, mais SANS RIEN modifier (aucun enfant créé, aucun notify) — juste les
    // données nécessaires pour dessiner un aperçu statique des colonnes qui SERAIENT
    // créées si l'élève cliquait vraiment.
    function previewProduitNul() {
      if (activeChild()) return activeChild().previewProduitNul();
      if (!canProduitNul()) return null;
      var detected = detectProduitNul(leaf.lastEquation());
      return detected.factors.map(function (side) {
        return { left: Expr.cloneSide(side), right: [{ coeff: 0, pow: 0 }] };
      });
    }

    function confirmProduitNul() {
      if (activeChild()) return activeChild().confirmProduitNul();
      if (domainConditions) return false;
      if (signChart) return false;
      var detected = detectProduitNul(leaf.lastEquation());
      if (!detected) return false;
      var equations = detected.factors.map(function (side) {
        return { left: Expr.cloneSide(side), right: [{ coeff: 0, pow: 0 }] };
      });
      splitIntoBranches(equations, '\\text{produit nul}');
      return true;
    }

    // Détecte si `eq` est de la forme "<expression factorisée> <op> 0" (comme
    // detectProduitNul, mais SANS exiger "=0" — le côté "expression" peut être n'importe
    // quel side, généralisé à une expression-quotient via Expr.extractSignChartFactors),
    // pour "Tableau de signes" (voir canSignChart plus bas). Renvoie
    // { factors: [{terms, kind}], constantSign } ou null.
    function detectSignChartFactors(eq) {
      function trySide(exprSide, zeroSide) {
        var eSide = eq[exprSide], zSide = eq[zeroSide];
        if (zSide.length !== 1 || Expr.isGroup(zSide[0]) || zSide[0].pow !== 0 || Expr.roundClean(zSide[0].coeff) !== 0) return null;
        return Expr.extractSignChartFactors(eSide);
      }
      return trySide('left', 'right') || trySide('right', 'left');
    }

    // Vrai si CHAQUE facteur `kind:'den'` de `denFactors` a une colonne "Condition
    // d'existence" correspondante (même dénominateur, voir Expr.sidesEquivalent) ET déjà
    // résolue (App.Equation.isSolved, opérateur-agnostique comme partout ailleurs — pas
    // besoin de la latex "Df=..." de renderDomainSplit, juste ce même test). Un
    // `denFactors` vide (aucun dénominateur du tout) est trivialement prêt : le domaine
    // est alors R tout entier, rien à établir.
    function signChartDomainReady(denFactors) {
      return denFactors.every(function (f) {
        return !!(domainConditions && domainConditions.some(function (cond) {
          return Expr.sidesEquivalent(cond.capturedArray, f.terms) && Eq.isSolved(cond.engine.lastEquation());
        }));
      });
    }

    // Bouton "Tableau de signes" : disponible une fois l'équation déjà de la forme
    // "<produit/quotient de facteurs degré <= 1> <op> 0" ET (s'il y a un dénominateur) une
    // fois le domaine de définition de CHAQUE dénominateur entièrement établi (voir
    // signChartDomainReady) — contrairement à Produit nul/Racine carrée, PEUT coexister
    // avec `domainConditions` sur ce même noeud (il en dépend, au contraire de les
    // exclure) ; reste indisponible une fois `branches` posé (v1, même restriction que les
    // deux autres scissions).
    function canSignChart() {
      // Jamais depuis L'INTÉRIEUR d'un des propres facteurs d'un tableau déjà posé ICI
      // (focusedSignChartFactor !== null, voir sa déclaration plus haut) : sa mini-
      // inéquation "<facteur> > 0" est un contexte de RÉSOLUTION, pas un nouveau point de
      // départ pour "Tableau de signes" — sans cette garde, un facteur linéaire isolé (ex.
      // "x+1 > 0") reste lui-même trivialement "chartable" au sens de
      // Expr.extractSignChartFactors (un seul facteur = lui-même), le bouton restait donc
      // à tort offert en travaillant DANS le tableau (retour utilisateur). Testée AVANT
      // activeChild() ci-dessous, qui déléguerait justement vers ce facteur.
      if (focusedSignChartFactor !== null) return false;
      // Même raison, cette fois pour une colonne "Condition d'existence" focalisée (retour
      // utilisateur : le bouton "Tableau de signes" ne doit pas apparaître À L'INTÉRIEUR de
      // cette section) — sa propre mini-équation, une fois résolue jusqu'à "x - 1 = 0" par
      // exemple, reste elle-même trivialement "chartable" au sens de
      // Expr.extractSignChartFactors (un facteur linéaire nu = lui-même), exactement le même
      // piège que focusedSignChartFactor juste au-dessus, sur un contexte de résolution
      // différent. Testée AVANT activeChild(), qui déléguerait justement vers cette colonne.
      if (focusedDomain !== null) return false;
      if (activeChild()) return activeChild().canSignChart();
      if (branches) return false;
      // Déjà posé sur ce noeud : reste disponible (jamais false) plutôt que de disparaître
      // une fois utilisé — un second clic (voir signChartAction/App.Render.panToSignChart
      // dans toolbar.js) sert alors à retrouver le tableau/les facteurs plutôt qu'à en
      // recréer un second (signChartAction() est déjà lui-même un no-op dans ce cas).
      if (signChart) return true;
      // Réservé aux INÉQUATIONS (retour utilisateur) : un "tableau de signes" n'a de sens
      // que pour étudier le signe d'une expression comparée à 0 avec <, >, ≤ ou ≥ — jamais
      // pour une simple égalité "=" (currentOperator alors null, voir init()/leaf plus
      // haut), où "Produit nul" reste le bon outil.
      if (!leaf.getCurrentOperator()) return false;
      var extracted = detectSignChartFactors(leaf.lastEquation());
      if (!extracted) return false;
      var denFactors = extracted.factors.filter(function (f) { return f.kind === 'den'; });
      return signChartDomainReady(denFactors);
    }

    // Clic sur "Tableau de signes" : crée UNE colonne par facteur distinct détecté par
    // detectSignChartFactors, chacune une inéquation "<facteur> > 0" indépendante (moteur
    // d'inégalité habituel, voir init()/currentOperator plus haut) — convention fixe (voir
    // CLAUDE.md/le plan) : toujours "> 0", jamais laissée au choix de l'élève, le signe en
    // dessous du zéro se déduisant de la résolution elle-même. No-op si déjà posé sur ce
    // noeud (voir `signChart` plus haut : une seule fois par noeud, contrairement à
    // `domainConditions` qui accumule une entrée par clic).
    function signChartAction() {
      // Mêmes gardes que canSignChart juste au-dessus, pour les mêmes raisons (jamais
      // imbriqué dans l'un de ses propres facteurs, ni déclenché depuis une colonne
      // "Condition d'existence" focalisée).
      if (focusedSignChartFactor !== null) return { spawned: false };
      if (focusedDomain !== null) return { spawned: false };
      if (activeChild()) return activeChild().signChartAction();
      if (signChart) return { spawned: false };
      if (!canSignChart()) return { spawned: false };
      var extracted = detectSignChartFactors(leaf.lastEquation());
      var factors = extracted.factors.map(function (f, i) {
        var eng = createBranchable();
        eng.init({ left: Expr.cloneSide(f.terms), right: [{ coeff: 0, pow: 0 }] }, { operator: '>' });
        // Dès que CE facteur (et donc, potentiellement, le dernier restant) devient
        // résolu, tente le pré-remplissage (voir signChartAutoFillRows plus bas) avant de
        // notifier normalement — se déclenche naturellement une seule fois, exactement
        // quand getSignChartColumns() passe de null à non-null pour la première fois.
        eng.subscribe(function () { signChartAutoFillRows(); notify(); });
        return { id: i, kind: f.kind, capturedSide: Expr.cloneSide(f.terms), exponent: f.exponent, engine: eng };
      });
      signChart = { factors: factors, constantSign: extracted.constantSign, tableRows: [], verified: false };
      focusedSignChartFactor = null;
      notify();
      return { spawned: true };
    }

    // Pré-remplit la colonne de gauche ("x") avec une rangée par facteur DISTINCT, sous sa
    // forme NUE (sans sa puissance, retour utilisateur : "puisque l'élève doit de toute
    // façon toutes les ajouter") dès que le tableau devient disponible (toutes les
    // mini-inéquations résolues, voir getSignChartColumns) — jamais la rangée "Expression
    // totale" (rangée optionnelle, un choix de l'élève, jamais automatique) ni la variante
    // "avec puissance" d'un facteur (retour utilisateur : une rangée EN PLUS, disponible
    // via "+ Ajouter une rangée" quand pertinente — voir signChartAddRow/exponent plus
    // bas — jamais ajoutée à la place de la rangée nue). Ne fait rien si déjà rempli une
    // fois (tableRows non vide) ou si le tableau n'est pas encore prêt : un simple GARDE
    // suffit, ceci n'est appelé qu'à chaque résolution d'UN facteur (voir signChartAction
    // ci-dessus), donc potentiellement plusieurs fois avant que le dernier ne le soit.
    function signChartAutoFillRows() {
      if (!signChart || signChart.tableRows.length > 0) return;
      if (!getSignChartColumns()) return;
      signChart.factors.forEach(function (f, i) { signChartAddRow({ rowKind: 'factor', factorIndex: i }); });
    }

    // Coefficient du terme degré 1 d'un facteur linéaire déjà extrait par
    // Expr.extractSignChartFactors (toujours présent et non nul, la restriction v1 excluant
    // tout facteur qui n'en aurait pas) — détermine si le facteur est croissant (>0) ou
    // décroissant (<0), donc son signe de part et d'autre de sa racine.
    function factorLeadingCoeff(terms) {
      var t = terms.filter(function (n) { return n.pow === 1; })[0];
      return t ? t.coeff : 0;
    }

    // Signe (+1/-1) d'un facteur linéaire dans un intervalle (from, to) — `from`/`to` ne
    // contiennent jamais la racine PROPRE d'un autre facteur strictement à l'intérieur
    // (voir getSignChartColumns : les colonnes sont justement découpées à CHAQUE racine
    // distincte), donc `root` (la racine de CE facteur) est toujours <= from ou >= to :
    // comparer `from` à `root` suffit à savoir de quel côté tombe tout l'intervalle, qu'il
    // soit borné ou infini (-Infinity/+Infinity se comparent normalement en JS).
    function factorSignInInterval(terms, root, from) {
      var above = from >= root;
      var positiveWhenAbove = factorLeadingCoeff(terms) > 0;
      return above === positiveWhenAbove ? 1 : -1;
    }

    // Signe (+1/-1) d'un facteur ÉLEVÉ À SA PUISSANCE dans un intervalle — une puissance
    // PAIRE reste toujours positive (jamais négative) de part et d'autre de sa racine,
    // seule une puissance IMPAIRE préserve le signe du facteur nu (factorSignInInterval).
    // Utilisée à la fois pour la rangée "Expression totale" (toujours la VRAIE puissance
    // du facteur dans l'équation d'origine, voir signChart.factors[i].exponent) et pour la
    // rangée "facteur, puissance comprise" qu'un élève peut choisir d'ajouter en plus de
    // la racine nue (row.withPower, retour utilisateur — voir signChartAddRow plus bas).
    function factorPowerSignInInterval(terms, root, from, exponent) {
      if (exponent % 2 === 0) return 1;
      return factorSignInInterval(terms, root, from);
    }

    // Dérive les colonnes du tableau de signes (2N+1, alternant intervalle/frontière — voir
    // le commentaire de modèle de données en tête de fichier / le plan) à partir des racines
    // déjà résolues de CHAQUE facteur (App.Equation.solvedValue) — null tant qu'il en manque
    // au moins une (voir Eq.isSolved). Racines dédupliquées/triées (deux facteurs distincts
    // peuvent coïncider, ex. un facteur numérateur et un facteur dénominateur — une seule
    // colonne frontière pour cette valeur, voir signChartExpectedCell plus bas pour la
    // distinction par rangée).
    function getSignChartColumns() {
      if (!signChart) return null;
      var allSolved = signChart.factors.every(function (f) { return Eq.isSolved(f.engine.lastEquation()); });
      if (!allSolved) return null;
      var distinctRoots = [];
      signChart.factors.forEach(function (f) {
        var r = Eq.solvedValue(f.engine.lastEquation());
        if (distinctRoots.indexOf(r) === -1) distinctRoots.push(r);
      });
      distinctRoots.sort(function (a, b) { return a - b; });
      var cols = [{ type: 'interval', from: -Infinity, to: distinctRoots[0] }];
      distinctRoots.forEach(function (r, i) {
        cols.push({ type: 'boundary', value: r });
        cols.push({ type: 'interval', from: r, to: i + 1 < distinctRoots.length ? distinctRoots[i + 1] : Infinity });
      });
      return cols;
    }

    // Valeur ATTENDUE d'une case du tableau, pour validation (voir signChartCellCorrect
    // plus bas) — calculée structurellement à partir des racines déjà résolues, jamais à
    // partir de ce que l'élève a rempli ailleurs (indépendant de l'ordre de remplissage).
    // `row` = { rowKind:'factor', factorIndex } ou { rowKind:'total' }, `col` une entrée de
    // getSignChartColumns(). Renvoie '+'|'-'|'0'|'undef' — ou 'none' si NI '0' NI 'undef'
    // n'est correct à cette frontière pour cette rangée-facteur (retour utilisateur :
    // "0"/"‖" à une valeur de x qui n'est ni la racine ni un point d'exclusion DOIT être
    // signalé faux, jamais silencieusement accepté — un facteur linéaire simple n'est de
    // toute façon jamais "indéfini" nulle part, seule sa PROPRE racine y vaut "0" ; laisser
    // la case VIDE, elle, reste toujours accepté, voir signChartCellCorrect : seul un
    // ACTUAL non-null est comparé à 'none').
    function signChartExpectedCell(row, col) {
      if (row.rowKind === 'factor') {
        var f = signChart.factors[row.factorIndex];
        var root = Eq.solvedValue(f.engine.lastEquation());
        if (col.type === 'boundary') return col.value === root ? '0' : 'none';
        // `row.withPower` (retour utilisateur) : la rangée du facteur "tel quel" dans
        // l'équation, puissance comprise (ex. "(x+2)³"), plutôt que sa racine nue — voir
        // factorPowerSignInInterval plus haut, jamais utilisée quand withPower est absent
        // (l'exposant réel n'a alors aucun effet sur CETTE rangée-là, seulement sur
        // "Expression totale" ci-dessous, toujours calculée avec la vraie puissance).
        var sign = row.withPower
          ? factorPowerSignInInterval(f.capturedSide, root, col.from, f.exponent)
          : factorSignInInterval(f.capturedSide, root, col.from);
        return sign > 0 ? '+' : '-';
      }
      var denRoots = signChart.factors.filter(function (f) { return f.kind === 'den'; })
        .map(function (f) { return Eq.solvedValue(f.engine.lastEquation()); });
      if (col.type === 'boundary') return denRoots.indexOf(col.value) !== -1 ? 'undef' : '0';
      var sign = signChart.constantSign;
      signChart.factors.forEach(function (f) {
        sign *= factorPowerSignInInterval(f.capturedSide, Eq.solvedValue(f.engine.lastEquation()), col.from, f.exponent);
      });
      return sign > 0 ? '+' : '-';
    }

    // Ajoute une rangée au tableau (voir "cliquer pour ajouter une rangée, choisir un
    // facteur" dans le plan) : une par facteur distinct au plus (ou DEUX, voir
    // `row.withPower` ci-dessous), plus au plus une rangée `rowKind:'total'` ("expression
    // totale", voir signChartExpectedCell). `cells` démarre entièrement à null (rien n'est
    // jamais pré-rempli pour l'élève au-delà de l'étiquette elle-même, voir
    // signChartAutoFillRows plus haut/signChartSetCell). Retourne false sans rien faire si
    // cette rangée existe déjà, ou si le tableau n'est pas encore prêt (tous les facteurs
    // pas encore résolus, voir getSignChartColumns).
    // `row.withPower` (retour utilisateur : "si l'équation contient un facteur avec une
    // puissance, comme (ax+b)^n, permettre de l'ajouter en entier, puissance comprise") :
    // rangée DISTINCTE de la racine nue du même `factorIndex` (jamais un remplacement —
    // voir signChartAutoFillRows, qui n'ajoute lui que la variante nue), rejetée si le
    // facteur visé n'a en réalité aucune puissance à afficher (exponent<=1, où les deux
    // variantes seraient rigoureusement identiques).
    // JAMAIS délégué via activeChild() (contrairement à canSignChart/signChartAction, qui
    // ciblent l'équation ACTIVE) : le tableau rendu à l'écran est TOUJOURS celui de CE
    // noeud précis (voir Hist.getSignChart(), non délégué lui non plus, utilisé tel quel
    // par renderAll) — jamais celui d'un facteur focalisé pour être résolu (focusedSignChartFactor),
    // qui n'a de toute façon pas son propre `signChart`. Déléguer ici aurait fait silencieusement
    // échouer tout ajout de rangée/remplissage de case tant qu'un facteur restait focalisé
    // après l'avoir résolu (bug rapporté : "rien ne se passe").
    function signChartAddRow(row) {
      if (!signChart) return false;
      var cols = getSignChartColumns();
      if (!cols) return false;
      if (row.rowKind === 'factor' && row.withPower) {
        var targetFactor = signChart.factors[row.factorIndex];
        if (!targetFactor || targetFactor.exponent <= 1) return false;
      }
      var exists = row.rowKind === 'total'
        ? signChart.tableRows.some(function (r) { return r.rowKind === 'total'; })
        : signChart.tableRows.some(function (r) {
          return r.rowKind === 'factor' && r.factorIndex === row.factorIndex && !!r.withPower === !!row.withPower;
        });
      if (exists) return false;
      signChart.tableRows.push({
        rowKind: row.rowKind,
        factorIndex: row.rowKind === 'factor' ? row.factorIndex : undefined,
        withPower: row.rowKind === 'factor' ? !!row.withPower : undefined,
        cells: cols.map(function () { return null; }),
        // Case par case (voir signChartSetCell/signChartVerify plus bas, retour
        // utilisateur : modifier UNE case après "Vérifier" ne doit décolorer QUE celle-là,
        // jamais tout le tableau) : `true` = modifiée depuis le dernier "Vérifier", donc
        // jamais signalée fausse tant qu'on n'a pas re-cliqué "Vérifier".
        dirty: cols.map(function () { return false; })
      });
      notify();
      return true;
    }

    // Pose la valeur d'une case (voir le plan : une case "intervalle" n'accepte que +/-,
    // une case "frontière" que 0/‖ — appliqué ici aussi, pas seulement côté UI, pour rester
    // cohérent si jamais appelé autrement qu'à travers le popup prévu). `value` peut être
    // null (efface la case).
    // Modifier CETTE case (et elle seule) la marque "dirty" (retour utilisateur : cliquer
    // une case après "Vérifier" ne doit décolorer QUE cette case-là, jamais les autres,
    // encore signalées fausses tant qu'on ne les a pas retouchées OU re-cliqué "Vérifier"
    // — voir row.dirty/signChartVerify plus bas). Jamais délégué non plus (voir
    // signChartAddRow juste au-dessus pour la raison).
    function signChartSetCell(rowIndex, colIndex, value) {
      if (!signChart) return false;
      var row = signChart.tableRows[rowIndex];
      var cols = getSignChartColumns();
      if (!row || !cols || !cols[colIndex]) return false;
      var allowed = cols[colIndex].type === 'boundary' ? ['0', 'undef'] : ['+', '-'];
      if (value !== null && allowed.indexOf(value) === -1) return false;
      row.cells[colIndex] = value;
      row.dirty[colIndex] = true;
      notify();
      return true;
    }

    // Tri-état : true (correcte), false (erronée), ou null (case encore VIDE — jamais
    // signalée comme fausse, voir signChartSetCell(..., null) pour l'effacer). Le
    // rendu (voir render.js) ne montre ce résultat que si signChart.verified est vrai
    // (bouton "Vérifier", retour utilisateur : "ne pas indiquer immédiatement qu'une
    // case est fausse") — cette fonction, elle, reste pure et toujours calculable, cette
    // décision d'AFFICHAGE n'est pas de son ressort. Jamais délégué non plus (voir
    // signChartAddRow plus haut pour la raison).
    function signChartCellCorrect(rowIndex, colIndex) {
      if (!signChart) return null;
      var row = signChart.tableRows[rowIndex];
      var cols = getSignChartColumns();
      if (!row || !cols || !cols[colIndex]) return null;
      var actual = row.cells[colIndex];
      if (actual === null) return null;
      return actual === signChartExpectedCell(row, cols[colIndex]);
    }

    // Bouton "Vérifier" (voir render.js) : bascule signChart.verified à vrai et efface le
    // "dirty" de TOUTES les cases (une nouvelle passe de jugement repart de zéro pour
    // chacune — voir row.dirty dans signChartAddRow/signChartSetCell : SEULE une case
    // retouchée ENSUITE, individuellement, redevient dirty, retour utilisateur) — n'a
    // d'effet QUE si une rangée "Expression totale" existe déjà (retour utilisateur),
    // jamais délégué (même raison que signChartAddRow plus haut : toujours CE noeud
    // précis, jamais un facteur focalisé).
    function signChartVerify() {
      if (!signChart) return false;
      var hasTotal = signChart.tableRows.some(function (r) { return r.rowKind === 'total'; });
      if (!hasTotal) return false;
      signChart.verified = true;
      signChart.tableRows.forEach(function (row) {
        row.dirty = row.dirty.map(function () { return false; });
      });
      notify();
      return true;
    }

    // Vrai une fois "Vérifier" cliqué (signChart.verified), la rangée "Expression totale"
    // ENTIÈREMENT remplie (aucune case à null : c'est elle qu'on lit pour la solution
    // finale, voir signChartSolutionRanges plus bas) ET AUCUNE case du tableau entier —
    // total ou facteur — n'est actuellement fausse (une rangée facteur peut, elle, rester
    // partiellement/pas remplie sans empêcher ceci : seules ses cases éventuellement
    // REMPLIES doivent être correctes). Seule condition d'affichage de "S=..." (retour
    // utilisateur), jamais calculée/affichée avant.
    function signChartFullyVerifiedCorrect() {
      if (!signChart || !signChart.verified) return false;
      var totalRow = signChart.tableRows.filter(function (r) { return r.rowKind === 'total'; })[0];
      if (!totalRow || totalRow.cells.some(function (v) { return v === null; })) return false;
      if (!getSignChartColumns()) return false;
      return signChart.tableRows.every(function (row, ri) {
        return row.cells.every(function (v, ci) { return v === null || signChartCellCorrect(ri, ci) === true; });
      });
    }

    // Union d'intervalles solution de l'INÉQUATION D'ORIGINE (jamais la convention "> 0"
    // interne à chaque mini-facteur, voir signChartAction plus haut — ici, le VRAI
    // opérateur de CE noeud, leaf.getCurrentOperator(), déjà garanti non-null par
    // canSignChart), lue directement dans la rangée "Expression totale" une fois
    // entièrement correcte (signChartFullyVerifiedCorrect, seul appelant légitime — renvoie
    // null sinon). Renvoie [{ from, fromIncluded, to, toIncluded }, ...] triés, `from`/`to`
    // pouvant valoir -Infinity/+Infinity (jamais "inclus" dans ce cas — une borne infinie
    // n'est jamais un point atteint) ; [] si aucune solution. Construit en balayant les
    // colonnes une seule fois : une case intervalle compte si son signe correspond à celui
    // demandé par l'opérateur, une case frontière compte comme un point ISOLÉ inclus
    // seulement si l'opérateur admet l'égalité ET que sa valeur y vaut '0' (jamais 'undef',
    // quel que soit l'opérateur — un point hors domaine n'est jamais solution) ; un point
    // inclus adjacent à un intervalle inclus (des deux côtés à la fois, potentiellement)
    // fusionne naturellement avec lui plutôt que de rester un singleton, simplement en
    // laissant `current` ouvert d'une colonne à l'autre.
    function signChartSolutionRanges() {
      if (!signChartFullyVerifiedCorrect()) return null;
      var totalRow = signChart.tableRows.filter(function (r) { return r.rowKind === 'total'; })[0];
      var cols = getSignChartColumns();
      var operator = leaf.getCurrentOperator() || '\\geq';
      var wantSign = (operator === '>' || operator === '\\geq') ? '+' : '-';
      var includeEquality = operator === '\\geq' || operator === '\\leq';
      var ranges = [];
      var current = null;
      cols.forEach(function (col, i) {
        var v = totalRow.cells[i];
        if (col.type === 'interval') {
          if (v === wantSign) {
            if (!current) current = { from: col.from, fromIncluded: false, to: col.to, toIncluded: false };
            else { current.to = col.to; current.toIncluded = false; }
          } else if (current) { ranges.push(current); current = null; }
        } else {
          var pointIncluded = includeEquality && v === '0';
          if (pointIncluded) {
            if (current) { current.to = col.value; current.toIncluded = true; }
            else current = { from: col.value, fromIncluded: true, to: col.value, toIncluded: true };
          } else if (current) { ranges.push(current); current = null; }
        }
      });
      if (current) ranges.push(current);
      return ranges;
    }

    // Détecte si `eq` est de la forme (expr)² = c ou c = (expr)² (un carré parfait d'un
    // côté — soit un ProductGroup.isSquare "(a+bx)²", soit un simple "x²" nu de
    // coefficient 1 — une constante numérique de l'autre), PAS ENCORE enveloppée dans une
    // racine : renvoie { base: Side, constant: number } ou null sinon. `base` est
    // l'expression dont il faudra prendre la racine (ex. "a+bx", ou "x"). Étape 1 de
    // "Racine carrée" (voir confirmSquareRoot plus bas) : enveloppe l'INTÉGRALITÉ des deux
    // membres dans un SqrtGroup ("(expr)²=c" -> "√((expr)²)=√(c)"), sans rien résoudre —
    // voir detectSquareRootSide ci-dessous pour l'étape 2 (résoudre, MEMBRE PAR MEMBRE,
    // cette forme enveloppée).
    function detectSquareRootUnwrapped(eq) {
      function trySide(sqSide, constSide) {
        var sSide = eq[sqSide], cSide = eq[constSide];
        if (cSide.length !== 1 || Expr.isGroup(cSide[0]) || cSide[0].pow !== 0) return null;
        if (sSide.length !== 1) return null;
        var node = sSide[0];
        var base;
        if (Expr.isSquareFactorGroup(node)) {
          base = node.factors[0].terms;
        } else if (!Expr.isGroup(node) && node.pow === 2 && Expr.roundClean(node.coeff) === 1) {
          base = [{ coeff: 1, pow: 1 }];
        } else {
          return null;
        }
        return { base: base, constant: Expr.roundClean(cSide[0].coeff) };
      }
      return trySide('left', 'right') || trySide('right', 'left');
    }

    // Étape 2 de "Racine carrée", vue UN SEUL membre à la fois (contrairement à l'ancienne
    // detectSquareRootWrapped, qui exigeait les deux ensemble) — voir
    // squareRootSimplifyAction juste en dessous, qui combine ceci avec la sélection en
    // cours pour savoir QUOI faire. Ce `side` est-il déjà "√(...)" (produit par l'étape 1
    // ci-dessus, voir Expr.wrapSideInSqrt) ET son radicand a-t-il une forme exploitable ?
    // Renvoie { kind: 'square', base: Side } (un carré parfait, ex. "√((x+3)²)" —
    // annulable, voir mode 'split' plus bas) ou { kind: 'constant', constant: number } (une
    // constante nue, ex. "√9" — éventuellement déjà SIGNÉE par un 'split' précédent sur
    // L'AUTRE membre, voir le champ `sign` du SqrtGroup/Expr.multiplySide — annulable, voir
    // mode 'calc'), ou null si la forme n'est pas (encore) reconnaissable — ex. le radicand
    // a été développé/modifié entre-temps (voir "drill inside a square root" dans
    // pending.drilled.part==='sqrt') : il faut alors d'abord le refactoriser pour retrouver
    // un carré avant que cette étape ne redevienne possible pour ce membre.
    function detectSquareRootSide(side) {
      if (side.length !== 1 || !Expr.isSqrtGroup(side[0])) return null;
      var node = side[0];
      if (node.radicand.length !== 1) return null;
      var inner = node.radicand[0];
      if (Expr.isSquareFactorGroup(inner)) {
        return { kind: 'square', base: inner.factors[0].terms };
      }
      if (!Expr.isGroup(inner) && inner.pow === 2 && Expr.roundClean(inner.coeff) === 1) {
        return { kind: 'square', base: [{ coeff: 1, pow: 1 }] };
      }
      if (!Expr.isGroup(inner) && inner.pow === 0) {
        // `constant` reste le RADICAND brut (jamais signé) : c'est LUI qui doit être
        // non-négatif pour que √constant soit calculable, pas le résultat final signé
        // (ex. "-√9" est parfaitement valide, -3 — seul "√(-9)" serait impossible). Le
        // signe du SqrtGroup (voir Expr.multiplySide/le 'split' d'un membre voisin plus
        // haut) s'applique SÉPARÉMENT, une fois la racine calculée — voir resultSign,
        // utilisé par computeSquareRootSimplify.
        return { kind: 'constant', constant: Expr.roundClean(inner.coeff), resultSign: node.sign < 0 ? -1 : 1 };
      }
      return null;
    }

    // Touche "√" du pavé "Opération" : ne porte plus jamais que l'étape 1 (envelopper),
    // toujours disponible sans sélection (comme +/-/×/÷, elle porte sur l'équation ENTIÈRE)
    // — l'étape 2 dépend désormais de la sélection en cours, voir squareRootSimplifyAction,
    // jamais vérifiée ici.
    function canSquareRoot() {
      if (activeChild()) return activeChild().canSquareRoot();
      if (domainConditions) return false;
      return !!detectSquareRootUnwrapped(leaf.lastEquation());
    }

    // 'wrap' (étape 1 disponible) ou null — utilisé par toolbar.js pour la touche "√" ELLE-
    // MÊME (titre/désactivation) : elle ne porte plus jamais l'étape 2 (voir
    // squareRootSimplifyAction, portée par "Simplifier" à la place).
    function squareRootStage() {
      if (activeChild()) return activeChild().squareRootStage();
      if (domainConditions) return null;
      return detectSquareRootUnwrapped(leaf.lastEquation()) ? 'wrap' : null;
    }

    // Touche "carré" du pavé "Opération" (à droite de "√") : élève les DEUX membres au
    // carré en une seule étape, voir confirmSquareBothSides plus bas — l'inverse de "√"
    // ci-dessus. Contrairement à "√" (qui n'a de sens QUE sur une forme "(expr)²=c" déjà
    // reconnue, voir detectSquareRootUnwrapped), élever au carré reste toujours
    // mathématiquement DÉFINI quelle que soit l'équation, mais n'en reste une ÉQUIVALENCE
    // (⟺, jamais seulement une implication ⟹ qui pourrait introduire une solution parasite)
    // que si les DEUX membres sont prouvablement non négatifs À CE STADE — voir
    // Expr.sideIsNonNegative (expression.js). Sans cette condition, "x=-3" élevé au carré
    // donnerait "x²=9", qui admet aussi x=3, jamais solution de l'équation de départ.
    // PAS de garde `domainConditions` ici (contrairement à canProduitNul/canSquareRoot,
    // voir la restriction v1 au sommet de createBranchable) : confirmSquareBothSides ne
    // scinde JAMAIS `leaf` en `branches` (toujours un pushStep normal, un seul résultat,
    // voir plus bas) — aucun conflit structurel avec `domainConditions`, qui COEXISTE
    // avec `leaf`. Sans cette exception, établir le domaine d'une équation comme
    // "√(x-3)=3" AVANT de l'élever au carré (l'enchaînement pédagogique normal : domaine
    // d'abord, résolution ensuite) bloquait définitivement toute suite (bug rapporté).
    function canSquareBothSides() {
      if (activeChild()) return activeChild().canSquareBothSides();
      var eq = leaf.lastEquation();
      return Expr.sideIsNonNegative(eq.left) && Expr.sideIsNonNegative(eq.right);
    }

    // Étape 2 ("Simplifier") : que ferait un clic MAINTENANT, d'après la sélection libre en
    // cours (pending.selectedLeft/Right — un membre déjà enveloppé n'a jamais qu'UN seul
    // noeud, donc "sélectionné" y équivaut toujours à "cet index unique présent") ? Exige
    // TOUJOURS au moins un membre sélectionné (contrairement à l'étape 1, jamais
    // automatique — voir la demande de l'utilisateur : cliquer "Simplifier" sans rien
    // sélectionner ne doit rien faire de surprenant) :
    //  - un seul membre sélectionné, "constante" (ex. "√9", ou déjà "-√9" après un 'split'
    //    précédent sur l'AUTRE membre) -> { mode: 'calc', side } : calcule CE membre seul,
    //    sans toucher l'autre ni scinder.
    //  - un seul membre sélectionné, "carré" (ex. "√((x+3)²)") -> { mode: 'split', side } :
    //    annule racine+carré de CE membre et scinde en ±, SANS calculer l'autre (qui reste
    //    tel quel — potentiellement encore "√(...)" — dans chaque branche, à simplifier
    //    plus tard, indépendamment, dans l'une ou l'autre).
    //  - LES DEUX membres sélectionnés (un "carré", l'autre "constante", n'importe quel
    //    ordre) -> { mode: 'both' } : les deux à la fois, comme le bouton le faisait sans
    //    sélection auparavant.
    // null sinon (rien sélectionné ; une sélection qui ne correspond à aucune forme
    // exploitable, ex. un membre déjà résolu en simple nombre sélectionné seul ; ou les
    // deux mêmes membres — même kind des deux côtés — sélectionnés ensemble).
    function squareRootSimplifyAction(eq, pending) {
      var leftSel = pending.selectedLeft.length === 1;
      var rightSel = pending.selectedRight.length === 1;
      if (!leftSel && !rightSel) return null;
      var leftInfo = detectSquareRootSide(eq.left);
      var rightInfo = detectSquareRootSide(eq.right);
      if (leftSel && rightSel) {
        if (leftInfo && rightInfo && leftInfo.kind !== rightInfo.kind) return { mode: 'both' };
        return null;
      }
      var side = leftSel ? 'left' : 'right';
      var info = leftSel ? leftInfo : rightInfo;
      if (!info) return null;
      return { mode: info.kind === 'constant' ? 'calc' : 'split', side: side };
    }

    // Version "publique" de squareRootSimplifyAction (sans arguments, auto-délégation aux
    // branches comme canSquareRoot/squareRootStage ci-dessus) — utilisée par
    // toolbar.js/render.js pour savoir CE QUE ferait un clic sur "Simplifier" maintenant
    // (activation du bouton, aperçu au survol), sans dupliquer ici la détection de forme.
    function squareRootAction() {
      if (activeChild()) return activeChild().squareRootAction();
      if (domainConditions) return null;
      return squareRootSimplifyAction(leaf.lastEquation(), leaf.getPending());
    }

    // Calcule le résultat de squareRootSimplifyAction SANS rien modifier (voir
    // previewSquareRoot) ni committer (voir confirmSquareRoot, qui appelle ceci puis pousse
    // le(s) résultat(s) comme un step normal ou une scission) : { error: true } (constante
    // négative), ou { equations: [eq] } (résultat unique — 'calc' ne scinde jamais ;
    // 'split'/'both' seulement si les deux résultats possibles seraient de toute façon
    // rigoureusement équivalents, ex. l'autre membre valant déjà 0, voir
    // Expr.sidesEquivalent — même principe que la déduplication de Produit nul), ou
    // { equations: [eqPos, eqNeg] } (± scindé).
    function computeSquareRootSimplify(eq, action) {
      if (action.mode === 'calc') {
        var infoC = detectSquareRootSide(eq[action.side]);
        if (infoC.constant < 0) return { error: true };
        var rootValC = Expr.roundClean(Math.sqrt(infoC.constant)) * infoC.resultSign;
        var outEq = Eq.cloneEquation(eq);
        outEq[action.side] = [{ coeff: rootValC, pow: 0 }];
        return { equations: [outEq] };
      }
      var otherSide = action.side === 'left' ? 'right' : 'left';
      if (action.mode === 'split') {
        var infoS = detectSquareRootSide(eq[action.side]);
        var otherPos = Expr.cloneSide(eq[otherSide]);
        // Négation d'un membre entier (voir Expr.multiplySide, partagé avec "×(-1)" du
        // pavé "Opération") : gère aussi bien un membre déjà résolu (simple nombre) qu'un
        // membre encore "√(...)" (SqrtGroup) — ce dernier restera à simplifier plus tard,
        // indépendamment, dans SA branche (voir Expr.scaleNode).
        var otherNeg = Expr.multiplySide(eq[otherSide], -1);
        var eqPosS = {}, eqNegS = {};
        eqPosS[action.side] = Expr.cloneSide(infoS.base); eqPosS[otherSide] = otherPos;
        eqNegS[action.side] = Expr.cloneSide(infoS.base); eqNegS[otherSide] = otherNeg;
        if (Expr.sidesEquivalent(otherPos, otherNeg)) return { equations: [eqPosS] };
        return { equations: [eqPosS, eqNegS] };
      }
      // 'both' : squareRootSimplifyAction n'a gardé qu'un booléen (les deux membres sont de
      // kind différent) — on redétecte les deux ici pour savoir précisément lequel est le
      // carré et lequel est la constante.
      var leftInfoB = detectSquareRootSide(eq.left), rightInfoB = detectSquareRootSide(eq.right);
      var squareSide = leftInfoB && leftInfoB.kind === 'square' ? 'left' : 'right';
      var constSide = squareSide === 'left' ? 'right' : 'left';
      var infoSq = squareSide === 'left' ? leftInfoB : rightInfoB;
      var infoCn = constSide === 'left' ? leftInfoB : rightInfoB;
      if (infoCn.constant < 0) return { error: true };
      var rootValB = Expr.roundClean(Math.sqrt(infoCn.constant)) * infoCn.resultSign;
      var eqPosB = {}, eqNegB = {};
      eqPosB[squareSide] = Expr.cloneSide(infoSq.base); eqPosB[constSide] = [{ coeff: rootValB, pow: 0 }];
      eqNegB[squareSide] = Expr.cloneSide(infoSq.base); eqNegB[constSide] = [{ coeff: -rootValB, pow: 0 }];
      if (rootValB === 0) return { equations: [eqPosB] };
      return { equations: [eqPosB, eqNegB] };
    }

    // Aperçu en lecture seule pour "Racine carrée" (voir previewProduitNul ci-dessus pour
    // le même principe côté "Produit nul") : les mêmes équations que confirmSquareRoot
    // produirait, sans rien modifier. À l'étape 1 (envelopper), une SEULE équation (jamais
    // de scission ici — voir confirmSquareRoot). À l'étape 2 ("Simplifier"), reflète la
    // sélection en cours (voir squareRootSimplifyAction) ; ne montre RIEN (renvoie null) si
    // rien n'est sélectionné, si la sélection ne correspond à aucune forme exploitable, ou
    // si le calcul échouerait (constante négative) — l'aperçu n'a pas vocation à montrer un
    // message d'erreur, seulement un résultat valide.
    function previewSquareRoot() {
      if (activeChild()) return activeChild().previewSquareRoot();
      var eq = leaf.lastEquation();
      if (detectSquareRootUnwrapped(eq)) {
        return [{ left: Expr.wrapSideInSqrt(eq.left), right: Expr.wrapSideInSqrt(eq.right) }];
      }
      var action = squareRootSimplifyAction(eq, leaf.getPending());
      if (!action) return null;
      var result = computeSquareRootSimplify(eq, action);
      if (result.error) return null;
      return result.equations;
    }

    // Étape 1 (envelopper) : appelée par la touche "√" du pavé "Opération" (armée puis
    // validée, voir confirmExprOrSqrt dans toolbar.js), jamais besoin de sélection. Étape 2
    // ("Simplifier") : appelée directement par le bouton "Simplifier" habituel, une fois AU
    // MOINS un membre déjà enveloppé sélectionné (voir squareRootSimplifyAction/le clic sur
    // data-op="simplify" dans toolbar.js) — pas de second armement de la touche "√", jugé
    // peu clair (même geste répété pour un effet complètement différent).
    function confirmSquareRoot() {
      if (activeChild()) return activeChild().confirmSquareRoot();
      if (domainConditions) return false;
      var eq = leaf.lastEquation();
      // Étape 1 : enveloppe l'INTÉGRALITÉ des deux membres dans une racine carrée — une
      // étape normale de la chaîne (deux flèches "√" identiques, comme "÷2" ou toute autre
      // opération portant sur les deux membres à la fois), jamais une scission : rien n'est
      // encore résolu, juste posé (voir Expr.wrapSideInSqrt/pushStep). L'élève peut alors
      // "entrer" dans chaque racine (pending.drilled.part==='sqrt', voir drillIntoSqrt plus
      // bas) pour y simplifier/factoriser/développer, puis sélectionner un membre (ou les
      // deux) et cliquer "Simplifier" pour l'étape 2.
      if (detectSquareRootUnwrapped(eq)) {
        var wrapped = { left: Expr.wrapSideInSqrt(eq.left), right: Expr.wrapSideInSqrt(eq.right) };
        leaf.pushStep(wrapped, { type: 'sqrt' });
        return true;
      }
      // Étape 2 : voir squareRootSimplifyAction pour le détail des 3 modes ('calc'/'split'
      // ne touchent qu'UN membre, 'both' les deux à la fois).
      var pending = leaf.getPending();
      var action = squareRootSimplifyAction(eq, pending);
      if (!action) return false;
      var result = computeSquareRootSimplify(eq, action);
      if (result.error) {
        // Pas de scission : juste un message d'erreur, comme un choix d'identité
        // remarquable qui ne correspond pas (voir chooseFactorMode) — le panneau flottant
        // l'affiche dès que pending.error est posé, même sans opType engagé (voir
        // needsPanel dans toolbar.js). Rien à griser durablement ici (contrairement à
        // l'ancien pending.sqrtFailed) : "Simplifier" reste cliquable, un réessai
        // reproduirait juste la même erreur — la seule vraie issue est de revenir en
        // arrière (undo) jusqu'à une équation différente.
        pending.error = 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.';
        notify();
        return false;
      }
      var equations = result.equations;
      if (equations.length === 1) {
        if (action.mode === 'calc') {
          // Ne touche qu'UN SEUL membre : une seule flèche étiquetée, l'autre muette (voir
          // pushAsymmetricStep) — exactement comme confirmSimplifySelection pour une
          // sélection intérieure SEULE (voir plus haut) : les deux flèches "simplifier" à
          // la fois serait trompeur, l'autre membre n'a, lui, pas bougé.
          leaf.pushAsymmetricStep(equations[0],
            action.side === 'left' ? { type: 'simplify' } : null,
            action.side === 'right' ? { type: 'simplify' } : null);
          return true;
        }
        // 'split'/'both' réduits à un seul résultat (les deux branches auraient été
        // rigoureusement équivalentes, voir computeSquareRootSimplify) : reste une étape
        // normale de la chaîne, à deux flèches identiques (comme "÷2") plutôt qu'une
        // "fourche" à une seule branche.
        leaf.pushStep(equations[0], { type: 'simplify' });
        return true;
      }
      splitIntoBranches(equations, '\\text{simplifier}');
      return true;
    }

    // Aperçu en lecture seule pour "(‥)²" pendant qu'elle est armée (voir previewSquareRoot
    // ci-dessus pour le même principe côté "√" — appelé depuis renderAll dans render.js,
    // voir Hist.getPending().squareArmed) : TOUJOURS un seul résultat (jamais de fourche,
    // contrairement à previewSquareRoot — voir confirmSquareBothSides plus bas), donc pas
    // besoin de gérer plusieurs équations ici.
    function previewSquareBothSides() {
      if (activeChild()) return activeChild().previewSquareBothSides();
      var eq = leaf.lastEquation();
      return [{ left: Expr.wrapSideInSquare(eq.left), right: Expr.wrapSideInSquare(eq.right) }];
    }

    // Touche "carré" du pavé "Opération" (armée puis validée, voir confirmExprOrSquare
    // dans toolbar.js) : élève l'INTÉGRALITÉ des deux membres au carré EN UNE SEULE étape
    // — contrairement à "Racine carrée" (2 étapes : envelopper, PUIS simplifier), pas
    // d'ambiguïté ici à laisser à l'élève : "(±√A)²" vaut toujours A, jamais besoin d'un
    // ±, donc jamais de scission en branches non plus (voir Expr.wrapSideInSquare, qui
    // annule directement racine+carré quand un membre est déjà un SqrtGroup nu).
    function confirmSquareBothSides() {
      if (activeChild()) return activeChild().confirmSquareBothSides();
      var eq = leaf.lastEquation();
      var squared = { left: Expr.wrapSideInSquare(eq.left), right: Expr.wrapSideInSquare(eq.right) };
      leaf.pushStep(squared, { type: 'square' });
      return true;
    }

    // Toute autre méthode "active" de l'API : déléguée à l'enfant focalisé s'il y en a
    // un, sinon exécutée directement sur `leaf`. Chaque nom ci-dessous existe à
    // l'identique sur `leaf` (voir la fin de createEngine plus haut) ET, une fois généré
    // ci-dessous, sur l'objet renvoyé par createBranchable lui-même — la récursion à
    // profondeur arbitraire se fait via la pile d'appels JS normale (appeler la méthode
    // de l'enfant refait le même test un niveau plus bas), sans avoir à la dérouler ici.
    var DELEGATED_METHODS = [
      'getSteps', 'getPending', 'lastEquation', 'getCurrentOperator', 'selectOp', 'cancelOp',
      'exitFactorKeepSelection', 'toggleTermSelection', 'toggleInnerSelection',
      'drillIntoGroup', 'drillIntoProductBranch', 'drillIntoInnerGroup', 'exitDrill',
      'confirmSimplifySelection', 'enterFactorWithSelection', 'getFactorTargetShape',
      'getFactorSelectionIndices',
      'chooseFactorMode', 'goBackToFactorChoice', 'setIdentityFocus',
      'confirmExpandFullSelection', 'toggleSquareRootArmed', 'toggleSquareArmed', 'setExprChainText',
      'setFactorTermLatex', 'setIdentityFieldLatex', 'parseOperandTerm', 'confirm',
      'computePreview', 'setSideOrder', 'setInnerOrder', 'setDrilledFactorOrder',
      'clickNestedFactor', 'setFactorOrder'
    ];

    var api = {
      subscribe: function (fn) { listeners.push(fn); },
      init: init,
      // Chaîne PROPRE à ce noeud, AVANT toute scission éventuelle en son sein (jamais
      // déléguée) : les pas "gelés" affichés au-dessus des colonnes une fois ce noeud
      // scindé — voir renderNode dans render.js. Hors scission, identique à getSteps().
      getOwnSteps: function () { return leaf.getSteps(); },
      // Arbre PROPRE à ce noeud (un seul niveau, jamais délégué) : null, ou les enfants
      // directs — chacun potentiellement scindé à nouveau plus bas (voir render.js, qui
      // parcourt cet arbre récursivement).
      getBranches: function () { return branches; },
      getFocusedBranch: function () { return focusedBranch; },
      getBranchSplitLabel: function () { return branchSplitLabel; },
      setFocusedBranch: setFocusedBranch,
      focusBranch: focusBranch,
      // Colonnes "Condition d'existence" propres à CE noeud (jamais déléguées, même
      // principe que getBranches ci-dessus) : voir la déclaration de `domainConditions`
      // plus haut pour la forme de chaque entrée.
      getDomainConditions: function () { return domainConditions; },
      getFocusedDomain: function () { return focusedDomain; },
      setFocusedDomain: setFocusedDomain,
      focusDomain: focusDomain,
      // "Tableau de signes" propre à CE noeud (jamais délégué, même principe que
      // getDomainConditions ci-dessus) : voir la déclaration de `signChart` plus haut pour
      // sa forme.
      getSignChart: function () { return signChart; },
      getFocusedSignChartFactor: function () { return focusedSignChartFactor; },
      setFocusedSignChartFactor: setFocusedSignChartFactor,
      focusSignChartFactor: focusSignChartFactor,
      focusMain: focusMain,
      // Accès DIRECT à `leaf`, jamais délégué (contrairement à getSteps/getPending/etc.,
      // voir DELEGATED_METHODS plus bas) : sert à render.js pour continuer à afficher/
      // faire vivre la chaîne PRINCIPALE elle-même, quel que soit l'état de
      // `focusedDomain` (une colonne "Condition d'existence" focalisée ne doit jamais
      // faire disparaître ou geler la chaîne principale — voir renderAll).
      getLeaf: function () { return leaf; },
      canUndo: canUndo,
      undo: undo,
      canProduitNul: canProduitNul,
      previewProduitNul: previewProduitNul,
      confirmProduitNul: confirmProduitNul,
      canExistenceCondition: canExistenceCondition,
      existenceConditionAction: existenceConditionAction,
      canSignChart: canSignChart,
      signChartAction: signChartAction,
      getSignChartColumns: getSignChartColumns,
      signChartAddRow: signChartAddRow,
      signChartSetCell: signChartSetCell,
      signChartCellCorrect: signChartCellCorrect,
      signChartVerify: signChartVerify,
      signChartFullyVerifiedCorrect: signChartFullyVerifiedCorrect,
      signChartSolutionRanges: signChartSolutionRanges,
      canSquareRoot: canSquareRoot,
      squareRootStage: squareRootStage,
      squareRootAction: squareRootAction,
      previewSquareRoot: previewSquareRoot,
      confirmSquareRoot: confirmSquareRoot,
      canSquareBothSides: canSquareBothSides,
      previewSquareBothSides: previewSquareBothSides,
      confirmSquareBothSides: confirmSquareBothSides
    };
    DELEGATED_METHODS.forEach(function (name) {
      api[name] = function () {
        var target = activeChild() || leaf;
        return target[name].apply(target, arguments);
      };
    });
    return api;
  }

  var root = createBranchable();
  App.History = root;
  // Alias historique : (re)part d'une équation entièrement neuve (identique à init).
  App.History.startNewEquation = root.init;
})(window.App = window.App || {});
