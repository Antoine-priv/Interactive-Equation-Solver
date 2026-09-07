/* Etat de l'historique des étapes + de la ligne "en attente" (opération en cours de
   construction). createEngine() fabrique un moteur de résolution indépendant pour UNE
   équation (steps + pending) ; App.History est un chef d'orchestre autour d'un moteur
   `primary`, qui peut se scinder en N moteurs `branches[0..N-1]` indépendants au clic
   sur "Produit nul" ou "Racine carrée" (voir plus bas), affichés côte à côte et
   travaillables séparément par l'élève. */
(function (App) {
  'use strict';
  var Expr = App.Expr;
  var Eq = App.Equation;

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
      // { side, index, branches: number[] } — un clic simple sur une parenthèse précise
      // (jamais un FactorGroup classique, ni un produit à un seul facteur/exponent>1,
      // aucune ambiguïté là) la bascule dans "branches" SANS toucher selectedLeft/Right,
      // indépendamment de la sélection classique. Développer devient possible dès que
      // branches.length >= 2, OU dès qu'un seul facteur marqué a lui-même un exposant>1
      // (ex. "(x-6)²" dans "(x-1)(x-6)²", qui a alors quelque chose à développer tout seul) :
      // voir Expr.expandProductFactorSubset/computeSelectionInfo dans toolbar.js. Un seul
      // produit à la fois (comme `drilled` ci-dessus) ; null si rien n'est actuellement
      // sélectionné de cette façon.
      selectedFactors: null,
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
      // toolbar.js) : contrairement
      // à +/-/×/÷, aucun opérande à composer — cliquer dessus "arme" juste la racine
      // carrée (comme un +/-/×/÷ tout juste pressé), incompatible avec toute AUTRE
      // opération en cours (voir hasCurrentDraft) puisqu'elle scinde en
      // branches plutôt que de transformer l'équation en place. Il faut ensuite cliquer
      // "↵" comme pour toute autre opération de ce pavé (voir bindMathKeypad dans
      // toolbar.js) pour l'exécuter réellement (confirmSquareRoot dans history.js) —
      // jamais exécutée au simple clic sur la touche elle-même.
      sqrtArmed: false,
      // Une tentative de racine carrée a échoué (constante négative, voir
      // confirmSquareRoot) : persiste indépendamment de pending.error (que d'autres
      // actions peuvent effacer entre-temps, voir needsPanel/displayError dans
      // toolbar.js) pour griser durablement la touche "√" — même principe que
      // pending.factorChoiceFailed pour les identités remarquables. Remis à false en
      // quittant/rouvrant le mode "Opération" (voir emptyPending) ou en désarmant "√".
      sqrtFailed: false,
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
      steps.push({ equation: equation, opLeft: opDesc, opRight: opDesc });
      resetPending();
    }

    function init(equation) {
      steps = [{ equation: equation, opLeft: null, opRight: null }];
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
      // pending.selectedFactors (voir toggleFactorSelection) fait PARTIE de ce qu'il faut
      // vérifier ici : il ne touche jamais selectedLeft/Right (voir son commentaire), donc
      // sans ce test un facteur sélectionné seul restait bloqué (ni Échap, ni clic en
      // dehors de l'équation ne le désélectionnait, contrairement à un terme classique).
      if (!pending.opType && !pending.drilled && !pending.selectedFactors &&
          pending.selectedLeft.length === 0 && pending.selectedRight.length === 0) return;
      resetPending();
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
    function toggleTermSelection(side, index, branchHint) {
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
        if (node && Expr.isFactorGroup(node)) {
          drillIntoGroup(side, index);
          return; // drillIntoGroup appelle déjà notify()
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
    // sélection par facteurs en cours (pending.selectedFactors) — un seul produit à la
    // fois : cliquer un facteur d'un AUTRE produit repart d'une sélection neuve plutôt que
    // d'accumuler des facteurs de deux produits différents (aucune opération ne combine
    // ça). Sélectionner AU MOINS 2 facteurs active "Développer" (voir computeSelectionInfo
    // dans toolbar.js et confirmExpandFullSelection/Expr.expandProductFactorSubset), en
    // développant SEULEMENT ces facteurs-là entre eux, les autres restant intacts.
    function toggleFactorSelection(side, index, branch) {
      var sel = pending.selectedFactors;
      if (!sel || sel.side !== side || sel.index !== index) {
        pending.selectedFactors = { side: side, index: index, branches: [branch] };
        return;
      }
      var i = sel.branches.indexOf(branch);
      if (i === -1) {
        sel.branches.push(branch);
      } else {
        sel.branches.splice(i, 1);
        if (sel.branches.length === 0) pending.selectedFactors = null;
      }
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
      pending.selectedFactors = null;
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
      pending.selectedFactors = null;
      pending.error = null;
      notify();
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
      // branche de ProductGroup (pending.drilled.branch) est toujours une profondeur
      // terminale (voir drillIntoProductBranch), ses termes sont supposés plats.
      if (isDouble && typeof pending.drilled.branch !== 'number') {
        var currentNode = Expr.nodeAtPath(lastEquation()[pending.drilled.side], pending.drilled.path);
        var innerNode = currentNode && currentNode.innerTerms[innerIndex];
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
      var innerNode = currentNode && currentNode.innerTerms[innerIndex];
      if (!innerNode || !Expr.isFactorGroup(innerNode)) return;
      var i = pending.selectedInner.indexOf(innerIndex);
      if (i !== -1) pending.selectedInner.splice(i, 1);
      pending.drilled = { side: pending.drilled.side, path: pending.drilled.path.concat([innerIndex]) };
      pending.selectedInner = [];
      pending.error = null;
      notify();
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
        // Branche d'un ProductGroup (ex. "(x+2-3)" dans "(x+2-3)(x+2+3)", voir
        // drillIntoProductBranch) : même principe qu'un FactorGroup ci-dessous, mais
        // l'array cible est factors[d.branch].terms et la reconstitution passe par
        // withProductBranchAtPath plutôt que withGroupInnerTermsAtPath.
        if (typeof d.branch === 'number') {
          if (!Expr.isProductGroup(groupNode)) return null;
          return {
            side: d.side,
            array: groupNode.factors[d.branch].terms,
            indices: pending.selectedInner,
            apply: function (newArray) {
              var out = Eq.cloneEquation(eq);
              out[d.side] = Expr.withProductBranchAtPath(eq[d.side], d.path, d.branch, newArray);
              return out;
            }
          };
        }
        if (!Expr.isFactorGroup(groupNode)) return null;
        return {
          side: d.side,
          array: groupNode.innerTerms,
          indices: pending.selectedInner,
          apply: function (newArray) {
            var out = Eq.cloneEquation(eq);
            out[d.side] = Expr.withGroupInnerTermsAtPath(eq[d.side], d.path, newArray);
            return out;
          }
        };
      }
      var side = pending.selectedLeft.length > 0 ? 'left' : (pending.selectedRight.length > 0 ? 'right' : null);
      if (!side) return null;
      return {
        side: side,
        array: eq[side],
        indices: side === 'left' ? pending.selectedLeft : pending.selectedRight,
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
      pending.sqrtFailed = false;
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
        if (!/^[0-9]+(?:[.,][0-9]+)?$/.test(sD)) {
          throw new Error('Division seulement par un nombre (pas par x).');
        }
        var value = parseFloat(sD.replace(',', '.'));
        if (negD) value = -value;
        if (Expr.roundClean(value) === 0) throw new Error('Division par zéro impossible.');
        return { symbol: '÷', factor: 1 / value, rawValue: value };
      }
      var s = raw;
      var negate = false;
      if (s.charAt(0) === '-') { negate = true; s = s.slice(1); }
      if (s === '') throw new Error('Saisissez une valeur.');
      // Un simple nombre nu reste un facteur scalaire "classique" (distribué terme à
      // terme via wrapSideInFactor, voir Eq.applyOpSequence), jamais enveloppé dans un
      // ProductGroup — exactement comme avant.
      if (/^[0-9]+(?:[.,][0-9]+)?$/.test(s)) {
        var xVal = parseFloat(s.replace(',', '.'));
        if (negate) xVal = -xVal;
        return { symbol: '×', factor: xVal, rawValue: xVal };
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
          return { symbol: '×', terms: bareTerms };
        }
      }
      // Tout le reste (x, x^N, N(...), (...)(...) ..., (...)^N, N(...)(...)^N chaîné...) :
      // délègue entièrement au même parseur que la saisie manuelle d'équation, réutilisé
      // ici pour UN opérande isolé — déjà généralisé aux produits N-aires et aux exposants
      // quelconques (voir parser.js), pas de logique dupliquée à maintenir ici.
      var terms = App.Parser.parseSide(s);
      if (negate) terms = negateTerms(terms);
      return { symbol: '×', terms: terms };
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

    // Terme du facteur commun (mode 'factor', factorMode==='common') : pending.factorLatex,
    // alimenté par setFactorTermLatex — analysé via le même pont LaTeX que "Opération" et
    // la modale "Nouvelle équation" (App.Parser.parseLatexSide). Doit se réduire à un SEUL
    // terme plat (pas un groupe, pas une somme) de degré 0 ou 1 : un facteur commun est
    // toujours un simple nombre ou un coefficient de x (jamais x², jamais une expression).
    // Renvoie null si vide ou si la forme ne convient pas (voir confirm(), qui choisit le
    // message d'erreur adapté selon lequel des deux cas c'est).
    function parseOperandTerm() {
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
        var newEqExpr;
        try {
          newEqExpr = Eq.applyOpSequence(eq, ops);
        } catch (eExpr) {
          pending.error = eExpr.message;
          notify();
          return false;
        }
        var opDescExpr = { type: 'expr', ops: ops };
        steps.push({ equation: newEqExpr, opLeft: opDescExpr, opRight: opDescExpr });
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
              : 'Le facteur commun doit être un simple nombre ou un coefficient de x.';
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
        steps.push(stepF);
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
        if (!groupNode || (!isBranch && !Expr.isFactorGroup(groupNode))) return false;
        var innerArr = isBranch ? groupNode.factors[d.branch].terms : groupNode.innerTerms;
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
          outD[d.side] = isBranch
            ? Expr.withProductBranchAtPath(eq[d.side], d.path, d.branch, newInner)
            : Expr.withGroupInnerTermsAtPath(eq[d.side], d.path, newInner);
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
        steps.push(stepD);
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
      steps.push({ equation: result.equation, opLeft: result.opLeft, opRight: result.opRight });
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
      var L = pending.selectedLeft.length, R = pending.selectedRight.length;
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
      if (p.selectedFactors) {
        var sf = p.selectedFactors;
        var nodeSF = eq[sf.side][sf.index];
        if (nodeSF && Expr.isProductGroup(nodeSF) && sf.branches.length >= 1 &&
            !(sf.branches.length === 1 && nodeSF.factors[sf.branches[0]].exponent < 2)) {
          targets.push({ side: sf.side, index: sf.index, kind: 'partial', branches: sf.branches.slice(), node: nodeSF });
        }
      }
      ['left', 'right'].forEach(function (side) {
        var arr = side === 'left' ? p.selectedLeft : p.selectedRight;
        arr.forEach(function (idx) {
          var node = eq[side][idx];
          if (node && Expr.isGroup(node)) targets.push({ side: side, index: idx, kind: 'full', node: node });
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
        if (!groupNode || !Expr.isFactorGroup(groupNode) || pending.selectedInner.length !== 1) return false;
        var targetIdx = pending.selectedInner[0];
        var targetNode = groupNode.innerTerms[targetIdx];
        if (!targetNode || !Expr.isGroup(targetNode)) return false;
        var newInnerD, descD;
        try {
          if (Expr.isProductGroup(targetNode)) {
            var expandedTermsD = Expr.expandProductGroup(targetNode);
            newInnerD = [];
            groupNode.innerTerms.forEach(function (t, i) {
              if (i === targetIdx) expandedTermsD.forEach(function (e) { newInnerD.push(e); });
              else newInnerD.push(Expr.cloneNode(t));
            });
            descD = fullExpandProductDesc(targetNode);
          } else {
            var allInnerIdx = targetNode.innerTerms.map(function (_, i) { return i; });
            newInnerD = Expr.expandFactorGroup(groupNode.innerTerms, targetIdx, allInnerIdx);
            descD = fullExpandDesc(targetNode);
          }
        } catch (eExp) {
          pending.error = eExp.message;
          notify();
          return false;
        }
        var outExpD = Eq.cloneEquation(eq);
        outExpD[d.side] = Expr.withGroupInnerTermsAtPath(eq[d.side], d.path, newInnerD);
        var stepExpD = { equation: outExpD, opLeft: null, opRight: null };
        stepExpD[d.side === 'left' ? 'opLeft' : 'opRight'] = descD;
        steps.push(stepExpD);
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
      steps.push(stepExpand);
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
          if (!groupNodePrev || (!isBranchPrev && !Expr.isFactorGroup(groupNodePrev))) {
            return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
          }
          var innerArrPrev = isBranchPrev ? groupNodePrev.factors[dPrev.branch].terms : groupNodePrev.innerTerms;
          // Une branche de ProductGroup n'a jamais de descente plus profonde (voir
          // drillIntoProductBranch/toggleInnerSelection) : pas d'aperçu "Développer" à y
          // chercher, ses termes sont supposés plats.
          if (!isBranchPrev && p.selectedInner.length === 1) {
            var targetIdxPrev = p.selectedInner[0];
            var targetNodePrev = groupNodePrev.innerTerms[targetIdxPrev];
            if (targetNodePrev && Expr.isGroup(targetNodePrev)) {
              try {
                var newInnerExpPrev, descPrev;
                if (Expr.isProductGroup(targetNodePrev)) {
                  var expandedPrev = Expr.expandProductGroup(targetNodePrev);
                  newInnerExpPrev = [];
                  groupNodePrev.innerTerms.forEach(function (t, i) {
                    if (i === targetIdxPrev) expandedPrev.forEach(function (e) { newInnerExpPrev.push(e); });
                    else newInnerExpPrev.push(Expr.cloneNode(t));
                  });
                  descPrev = fullExpandProductDesc(targetNodePrev);
                } else {
                  var allInnerIdxPrev = targetNodePrev.innerTerms.map(function (_, i) { return i; });
                  newInnerExpPrev = Expr.expandFactorGroup(groupNodePrev.innerTerms, targetIdxPrev, allInnerIdxPrev);
                  descPrev = fullExpandDesc(targetNodePrev);
                }
                var eqExpPrev = Eq.cloneEquation(last);
                eqExpPrev[dPrev.side] = Expr.withGroupInnerTermsAtPath(last[dPrev.side], dPrev.path, newInnerExpPrev);
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
              eqPrevD[dPrev.side] = isBranchPrev
                ? Expr.withProductBranchAtPath(last[dPrev.side], dPrev.path, dPrev.branch, newInnerPrev)
                : Expr.withGroupInnerTermsAtPath(last[dPrev.side], dPrev.path, newInnerPrev);
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
        // pas besoin d'un repli "texte brut" séparé comme avant (rawText).
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
          try {
            if (factorTerm && Expr.roundClean(factorTerm.coeff) !== 0) {
              previewEqF = pTarget.apply(Expr.factorNodes(pTarget.array, pTarget.indices, factorTerm));
              previewDesc = { type: 'factor', factor: factorTerm };
            } else {
              // Facteur commun pas encore saisi : parenthèses seules, comme si c'était 1.
              previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
            }
          } catch (e3) {
            try {
              previewEqF = pTarget.apply(Expr.factorNodesRaw(pTarget.array, pTarget.indices));
            } catch (e3b) {
              return { equation: Eq.cloneEquation(last), opLeft: null, opRight: null };
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
      var side = pending.drilled.side;
      var path = pending.drilled.path;
      var branch = pending.drilled.branch;
      var isBranchIdx = typeof branch === 'number';
      var node = Expr.nodeAtPath(lastStep.equation[side], path);
      if (!node) return;
      var oldArr = isBranchIdx ? node.factors[branch].terms : node.innerTerms;
      var isIdentity = orderOfOrigIndices.length === oldArr.length &&
        orderOfOrigIndices.every(function (v, i) { return v === i; });
      if (!isIdentity) {
        var newArr = orderOfOrigIndices.map(function (i) { return oldArr[i]; });
        var newSide = isBranchIdx
          ? Expr.withProductBranchAtPath(lastStep.equation[side], path, branch, newArr)
          : Expr.withGroupInnerTermsAtPath(lastStep.equation[side], path, newArr);
        var newEquation = { left: lastStep.equation.left, right: lastStep.equation.right };
        newEquation[side] = newSide;
        lastStep.equation = newEquation;
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
      pushStep: pushStep,
      selectOp: selectOp,
      cancelOp: cancelOp,
      toggleTermSelection: toggleTermSelection,
      toggleInnerSelection: toggleInnerSelection,
      drillIntoGroup: drillIntoGroup,
      drillIntoProductBranch: drillIntoProductBranch,
      drillIntoInnerGroup: drillIntoInnerGroup,
      exitDrill: exitDrill,
      confirmSimplifySelection: confirmSimplifySelection,
      enterFactorWithSelection: enterFactorWithSelection,
      getFactorTargetShape: getFactorTargetShape,
      chooseFactorMode: chooseFactorMode,
      goBackToFactorChoice: goBackToFactorChoice,
      setIdentityFocus: setIdentityFocus,
      confirmExpandFullSelection: confirmExpandFullSelection,
      toggleSquareRootArmed: toggleSquareRootArmed,
      setExprChainText: setExprChainText,
      setFactorTermLatex: setFactorTermLatex,
      setIdentityFieldLatex: setIdentityFieldLatex,
      parseOperandTerm: parseOperandTerm,
      confirm: confirm,
      computePreview: computePreview,
      setSideOrder: setSideOrder,
      setInnerOrder: setInnerOrder,
      setFactorOrder: setFactorOrder,
      undo: undo
    };
  }

  // ---- Chef d'orchestre : un moteur `primary`, qui peut se scinder en N moteurs
  // indépendants `branches[0..N-1]` au clic sur "Produit nul" (une équation factorisée
  // en (A)(B)...=0 se résout en scindant en N équations A=0/B=0/..., un produit est nul
  // si et seulement si l'un de ses facteurs l'est — voir Expr.flattenProductFactors, qui
  // extrait directement les N facteurs du ProductGroup, voir expression.js)
  // ou "Racine carrée" (1 ou 2 branches selon que la constante vaut 0 ou non). Les
  // branches s'affichent côte à côte (voir render.js) et se travaillent indépendamment —
  // les actions du clavier/pavé s'appliquent à la branche "active" (celle sur laquelle
  // l'élève a cliqué en dernier, voir setFocusedBranch). ----

  var primary = null;
  var branches = null;        // null, ou [engine, engine, ...] (au moins 1)
  var focusedBranch = 0;      // index dans `branches` — quelle branche reçoit clavier/pavé/sélection
  var branchSplitLabel = '';  // LaTeX affiché sur la flèche fourchue (voir drawFork dans arrows.js) — du texte ("\text{...}") ou un symbole mathématique brut, selon l'action
  var listeners = [];

  function notify() {
    listeners.forEach(function (fn) { fn(); });
  }

  // Moteur qui reçoit les actions de l'utilisateur en ce moment : la branche focalisée
  // une fois une scission déclenchée, sinon le moteur principal.
  function active() {
    return branches ? branches[focusedBranch] : primary;
  }

  // Toujours possible dès qu'il y a quoi que ce soit à annuler : soit une étape dans le
  // moteur actif (primary ou la branche focalisée), soit — à défaut — la scission
  // elle-même (voir undo ci-dessous).
  function canUndo() {
    if (branches) return true;
    return primary.getSteps().length > 1;
  }

  // Annule la dernière étape du moteur ACTIF (primary, ou la branche focalisée). Si
  // cette branche est déjà à son tout premier step (juste après la scission, rien à
  // annuler EN SON SEIN), annule directement la scission elle-même plutôt que de ne rien
  // faire : retour à `primary`, qui n'a jamais été modifié par la scission (elle ne fait
  // que créer de NOUVEAUX moteurs à partir de sa dernière équation), donc rien d'autre à
  // restaurer. Peu importe l'avancement des AUTRES branches à ce moment : annuler la
  // scission les annule toutes ensemble, symétriquement à la façon dont elle les a
  // toutes créées ensemble.
  function undo() {
    if (branches) {
      var focusedEngine = branches[focusedBranch];
      if (focusedEngine.getSteps().length > 1) {
        return focusedEngine.undo();
      }
      branches = null;
      focusedBranch = 0;
      branchSplitLabel = '';
      notify();
      return true;
    }
    return primary.undo();
  }

  function init(equation) {
    branches = null;
    focusedBranch = 0;
    primary = createEngine();
    primary.subscribe(notify);
    primary.init(equation);
  }

  function startNewEquation(equation) {
    init(equation);
  }

  function setFocusedBranch(index) {
    if (!branches || index < 0 || index >= branches.length || focusedBranch === index) return;
    focusedBranch = index;
    notify();
  }

  // Variante silencieuse (pas de notify) : utilisée juste avant de déléguer une action
  // à cette branche (ex. un clic sur un terme), pour que active() la cible déjà
  // correctement — l'action elle-même déclenchera son propre (unique) rendu.
  function focusBranch(index) {
    if (branches && index >= 0 && index < branches.length) focusedBranch = index;
  }

  // Scinde `primary` en N moteurs indépendants, un par élément de `sides` (chacun
  // l'équation "side = 0", ou une valeur explicite via `rightOverride`), les affecte à
  // `branches`, et notifie une seule fois à la fin. Commun à "Produit nul" et
  // "Racine carrée" (voir confirmProduitNul/confirmSquareRoot ci-dessous). `labelLatex`
  // est du LaTeX déjà prêt à l'affichage (pas juste du texte brut à envelopper) — voir
  // drawFork dans arrows.js : "\text{produit nul}" pour l'un, un symbole mathématique
  // brut pour l'autre.
  function splitIntoBranches(equations, labelLatex) {
    var engines = equations.map(function (eq) {
      var eng = createEngine();
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

  // Détecte si `eq` est de la forme (A)(B)...=0 ou 0=(A)(B)... (un ProductGroup seul
  // d'un côté, potentiellement imbriqué à volonté — voir Expr.flattenProductFactors,
  // ex. "(a+b)(c+d)²" — la constante 0 seule de l'autre) ; renvoie { factors: Side[] },
  // les facteurs DISTINCTS après déduplication structurelle (voir Expr.sidesEquivalent —
  // ex. "(a+bx)²=0" ne donne qu'UN facteur, une seule colonne ; "(a+b)(c+d)²=0" en donne
  // deux), ou null sinon. Le signe (à n'importe quel niveau d'imbrication) est
  // indifférent : un produit nul reste nul quel que soit son signe global.
  function detectProduitNul(eq) {
    function trySide(prodSide, zeroSide) {
      var pSide = eq[prodSide], zSide = eq[zeroSide];
      if (pSide.length !== 1 || !Expr.isProductGroup(pSide[0])) return null;
      if (zSide.length !== 1 || Expr.isGroup(zSide[0]) || zSide[0].pow !== 0 || Expr.roundClean(zSide[0].coeff) !== 0) return null;
      var allFactors = Expr.flattenProductFactors(pSide[0]);
      var distinct = [];
      allFactors.forEach(function (f) {
        if (!distinct.some(function (d) { return Expr.sidesEquivalent(d, f); })) distinct.push(f);
      });
      return { factors: distinct };
    }
    return trySide('left', 'right') || trySide('right', 'left');
  }

  // Comme "Racine carrée" (voir canSquareRoot/detectSquareRoot plus bas), pas de
  // sélection préalable à faire : "Produit nul" ne distingue de toute façon jamais QUELS
  // facteurs on a cliqués, seulement la FORME de l'équation entière ((...)( ...)...=0) —
  // exiger un clic n'ajoutait qu'une étape artificielle. Pas de scission imbriquée d'une
  // branche déjà scindée (aucun facteur généré par cette appli n'est lui-même un produit,
  // ce cas ne se présente donc pas en pratique).
  function canProduitNul() {
    return !branches && !!detectProduitNul(primary.lastEquation());
  }

  // Aperçu en lecture seule pour le survol du bouton "Produit nul" (voir
  // shouldShowLivePreview dans render.js) : mêmes équations que confirmProduitNul
  // produirait, mais SANS RIEN modifier (aucune branche créée, aucun notify) — juste les
  // données nécessaires pour dessiner un aperçu statique des colonnes qui SERAIENT
  // créées si l'élève cliquait vraiment.
  function previewProduitNul() {
    if (!canProduitNul()) return null;
    var detected = detectProduitNul(primary.lastEquation());
    return detected.factors.map(function (side) {
      return { left: Expr.cloneSide(side), right: [{ coeff: 0, pow: 0 }] };
    });
  }

  function confirmProduitNul() {
    if (branches) return false;
    var detected = detectProduitNul(primary.lastEquation());
    if (!detected) return false;
    var equations = detected.factors.map(function (side) {
      return { left: Expr.cloneSide(side), right: [{ coeff: 0, pow: 0 }] };
    });
    splitIntoBranches(equations, '\\text{produit nul}');
    return true;
  }

  // Détecte si `eq` est de la forme (expr)² = c ou c = (expr)² (un carré parfait d'un
  // côté — soit un ProductGroup.isSquare "(a+bx)²", soit un simple "x²" nu de
  // coefficient 1 — une constante numérique de l'autre) ; renvoie { base: Side, constant:
  // number } ou null sinon. `base` est l'expression dont il faudra prendre la racine
  // (ex. "a+bx", ou "x").
  function detectSquareRoot(eq) {
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

  // Contrairement à "Produit nul", pas de sélection préalable à faire : "Racine carrée"
  // est une touche du pavé "Opération" (voir mathKeypad.js/bindMathKeypad dans
  // toolbar.js), au même
  // titre que +/-/×/÷ qui, eux non plus, n'exigent aucune sélection — juste une forme
  // d'équation valide (voir detectSquareRoot). Comme "Produit nul", pas de scission
  // imbriquée d'une branche déjà scindée : ne s'applique qu'à l'équation principale.
  function canSquareRoot() {
    return !branches && !!detectSquareRoot(primary.lastEquation());
  }

  // Aperçu en lecture seule pour "Racine carrée" (voir previewProduitNul ci-dessus pour
  // le même principe côté "Produit nul") : les mêmes équations que confirmSquareRoot
  // produirait, sans rien modifier. Contrairement à confirmSquareRoot, ne montre RIEN
  // (renvoie null) quand la constante est négative — l'aperçu n'a pas vocation à montrer
  // un message d'erreur, seulement une scission valide.
  function previewSquareRoot() {
    if (!canSquareRoot()) return null;
    var detected = detectSquareRoot(primary.lastEquation());
    if (detected.constant < 0) return null;
    var rootVal = Expr.roundClean(Math.sqrt(detected.constant));
    var equations = [{ left: Expr.cloneSide(detected.base), right: [{ coeff: rootVal, pow: 0 }] }];
    if (rootVal !== 0) {
      equations.push({ left: Expr.cloneSide(detected.base), right: [{ coeff: -rootVal, pow: 0 }] });
    }
    return equations;
  }

  function confirmSquareRoot() {
    if (branches) return false;
    var detected = detectSquareRoot(primary.lastEquation());
    if (!detected) return false;
    if (detected.constant < 0) {
      // Pas de scission : juste un message d'erreur, comme un choix d'identité
      // remarquable qui ne correspond pas (voir chooseFactorMode) — le panneau flottant
      // l'affiche dès que pending.error est posé, même sans opType engagé (voir
      // needsPanel dans toolbar.js). sqrtFailed (persistant, voir emptyPending) grise
      // durablement la touche "√" tant que cette équation reste ainsi — même principe
      // que pending.factorChoiceFailed pour les identités remarquables.
      var pFail = primary.getPending();
      pFail.error = 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.';
      pFail.sqrtFailed = true;
      notify();
      return false;
    }
    var rootVal = Expr.roundClean(Math.sqrt(detected.constant));
    var soleEquation = { left: Expr.cloneSide(detected.base), right: [{ coeff: rootVal, pow: 0 }] };
    // Racine de 0 : +0 et -0 donneraient deux colonnes strictement identiques (même
    // principe que la déduplication de Produit nul) — un SEUL résultat, donc jamais une
    // "fourche" à une seule branche (flèche double + colonnes prévues pour plusieurs cas,
    // voir splitIntoBranches) : reste une étape normale de la chaîne principale, à deux
    // flèches identiques (gauche ET droite, comme pour "÷2" ou toute autre opération
    // portant sur les deux membres à la fois) — voir pushStep plus bas dans createEngine.
    if (rootVal === 0) {
      primary.pushStep(soleEquation, { type: 'sqrt' });
      return true;
    }
    var equations = [soleEquation, { left: Expr.cloneSide(detected.base), right: [{ coeff: -rootVal, pow: 0 }] }];
    splitIntoBranches(equations, '\\sqrt{\\phantom{x}}');
    return true;
  }

  App.History = {
    subscribe: function (fn) { listeners.push(fn); },
    init: init,
    startNewEquation: startNewEquation,
    getPrimarySteps: function () { return primary.getSteps(); },
    getBranches: function () { return branches; },
    getFocusedBranch: function () { return focusedBranch; },
    getBranchSplitLabel: function () { return branchSplitLabel; },
    setFocusedBranch: setFocusedBranch,
    focusBranch: focusBranch,
    canUndo: canUndo,
    undo: undo,
    getSteps: function () { return active().getSteps(); },
    getPending: function () { return active().getPending(); },
    lastEquation: function () { return active().lastEquation(); },
    selectOp: function (t) { active().selectOp(t); },
    cancelOp: function () { active().cancelOp(); },
    toggleTermSelection: function (side, idx, branchHint) { active().toggleTermSelection(side, idx, branchHint); },
    toggleInnerSelection: function (idx) { active().toggleInnerSelection(idx); },
    drillIntoGroup: function (side, idx) { active().drillIntoGroup(side, idx); },
    drillIntoProductBranch: function (side, idx, branch) { active().drillIntoProductBranch(side, idx, branch); },
    drillIntoInnerGroup: function (idx) { active().drillIntoInnerGroup(idx); },
    exitDrill: function () { active().exitDrill(); },
    confirmSimplifySelection: function () { return active().confirmSimplifySelection(); },
    enterFactorWithSelection: function () { return active().enterFactorWithSelection(); },
    getFactorTargetShape: function () { return active().getFactorTargetShape(); },
    chooseFactorMode: function (mode) { active().chooseFactorMode(mode); },
    goBackToFactorChoice: function () { active().goBackToFactorChoice(); },
    setIdentityFocus: function (which) { active().setIdentityFocus(which); },
    confirmExpandFullSelection: function () { return active().confirmExpandFullSelection(); },
    canProduitNul: canProduitNul,
    previewProduitNul: previewProduitNul,
    previewSquareRoot: previewSquareRoot,
    confirmProduitNul: confirmProduitNul,
    canSquareRoot: canSquareRoot,
    confirmSquareRoot: confirmSquareRoot,
    toggleSquareRootArmed: function () { active().toggleSquareRootArmed(); },
    setExprChainText: function (latex) { active().setExprChainText(latex); },
    setFactorTermLatex: function (latex) { active().setFactorTermLatex(latex); },
    setIdentityFieldLatex: function (latex) { active().setIdentityFieldLatex(latex); },
    parseOperandTerm: function () { return active().parseOperandTerm(); },
    confirm: function () { return active().confirm(); },
    computePreview: function () { return active().computePreview(); },
    setSideOrder: function (side, order) { active().setSideOrder(side, order); },
    setInnerOrder: function (order) { active().setInnerOrder(order); },
    setFactorOrder: function (side, groupIndex, order) { active().setFactorOrder(side, groupIndex, order); }
  };
})(window.App = window.App || {});
