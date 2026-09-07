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
  // Largeur du scroller au moment du dernier recentrage horizontal (voir plus bas) : une
  // scission ("Produit nul"/"Racine carrée") utilise un scrollLeft ABSOLU calculé une
  // fois, alors que .produit-nul-split (voir style.css) se repositionne tout seul en
  // pixels à chaque redimensionnement de fenêtre via son padding de 50vw — sans ce
  // suivi, un redimensionnement APRÈS le recentrage initial (fenêtre agrandie/réduite,
  // ouverture des DevTools...) désynchronise silencieusement scrollLeft de "où sont
  // vraiment les colonnes à l'écran", les laissant décalées jusqu'à la prochaine étape.
  var lastCenteredWidth = null;

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
      return desc.factor ? '\\text{factoriser par }' + Expr.operandLatex(desc.factor) : '\\text{factoriser}';
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
      return desc.ops.map(function (op) {
        if (op.terms) {
          // Multiplication par une expression (ex. "×(x+5)"), voir wrapSideInProduct.
          var exprOperandLatex = op.terms.map(function (t, i) { return Expr.nodeLatex(t, i === 0); }).join('');
          return OP_SYMBOL_LATEX[op.symbol] + '\\left(' + exprOperandLatex + '\\right)';
        }
        if (op.symbol === '×' || op.symbol === '÷') {
          // formatNumberLatex renvoie une valeur absolue : le signe du multiplicateur/
          // diviseur (±) se rajoute ici séparément.
          return OP_SYMBOL_LATEX[op.symbol] + (op.rawValue < 0 ? '-' : '') + Expr.formatNumberLatex(op.rawValue);
        }
        return Expr.nodeLatex(op.term, false);
      }).join('');
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
  function drilledGroupLatex(node, idPrefix, topIdx, remainingPath, isFirst) {
    var isLeaf = remainingPath.length === 0;
    var innerLatex;
    if (isLeaf) {
      innerLatex = node.innerTerms.map(function (t, i) {
        return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + i + '}{' + Expr.nodeLatex(t, i === 0) + '}';
      }).join('');
    } else {
      var childIdx = remainingPath[0];
      innerLatex = node.innerTerms.map(function (t, i) {
        if (i === childIdx) {
          return drilledGroupLatex(t, idPrefix, topIdx, remainingPath.slice(1), i === 0);
        }
        return Expr.nodeLatex(t, i === 0);
      }).join('');
    }
    var body;
    if (node.isDivision) {
      var frac = '\\frac{' + innerLatex + '}{' + Expr.termLatexBody(node.factor) + '}';
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
  function drilledGroupLatexForOrder(node, remainingPath, orderedLeaf, isFirst) {
    var isLeaf = remainingPath.length === 0;
    var innerLatex;
    if (isLeaf) {
      innerLatex = orderedLeaf.map(function (t, i) {
        return '\\htmlId{dragpv-' + i + '}{' + Expr.nodeLatex(t, i === 0) + '}';
      }).join('');
    } else {
      var childIdx = remainingPath[0];
      innerLatex = node.innerTerms.map(function (t, i) {
        if (i === childIdx) {
          return drilledGroupLatexForOrder(t, remainingPath.slice(1), orderedLeaf, i === 0);
        }
        return Expr.nodeLatex(t, i === 0);
      }).join('');
    }
    var body;
    if (node.isDivision) {
      body = '\\frac{' + innerLatex + '}{' + Expr.termLatexBody(node.factor) + '}';
    } else {
      var factorBody = node.factor ? Expr.termLatexBody({ coeff: node.factor.coeff, pow: node.factor.pow }) : '';
      body = factorBody + '\\left(' + innerLatex + '\\right)';
    }
    var sign = node.sign < 0 ? '-' : '+';
    if (isFirst) return (sign === '-' ? '-' : '') + body;
    return ' ' + sign + ' ' + body;
  }

  // Rendu (non "drillé") d'un ProductGroup au premier niveau : comme Expr.nodeLatex, mais
  // chaque facteur porte en plus un attribut data-branch="0"/"1"/... (via \htmlData) ET son
  // propre \htmlId ("idPrefix-topIdx-factor-i") — le premier sert à retrouver dans quel
  // facteur précis un clic/double-clic a physiquement atterri (voir attachPointerDrag/
  // selectDragOptions plus bas), pour "driller" dedans (pending.drilled.branch, voir
  // history.js) ; le second permet, APRÈS ce même appel KaTeX, de retrouver CE facteur
  // précis par id pour lui appliquer une classe "sélectionné" — voir toggleFactorSelection/
  // pending.selectedFactors dans history.js et le câblage juste après renderSide plus bas :
  // un produit d'au moins 2 facteurs a chacune de ses parenthèses individuellement
  // sélectionnable pour un développement partiel (ex. sélectionner "(x-5)" et "(x+2)" dans
  // "(x²-10x+25)(x-5)(x+2)" pour les développer entre elles, sans toucher au 1er facteur).
  function productGroupBranchesLatex(node, idPrefix, topIdx, isFirst) {
    var bodyP = node.factors.map(function (f, i) {
      var inner = '\\htmlData{branch=' + i + '}{' + Expr.groupSlotLatex(f.terms) + '}';
      var slot = '\\htmlId{' + idPrefix + '-' + topIdx + '-factor-' + i + '}{' + inner + '}';
      return f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
    }).join('');
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
    var bodyP = node.factors.map(function (f, i) {
      if (i !== branch) {
        var slot = Expr.groupSlotLatex(f.terms);
        return f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
      }
      var activeLatex = f.terms.map(function (t, j) {
        return '\\htmlId{' + idPrefix + '-' + topIdx + '-inner-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
      }).join('');
      var activeParen = '\\htmlId{' + idPrefix + '-' + topIdx + '-exit}{\\left(' + activeLatex + '\\right)}';
      return f.exponent === 1 ? activeParen : activeParen + '^{' + f.exponent + '}';
    }).join('');
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
    var bodyP = node.factors.map(function (f, i) {
      if (i !== branch) {
        var slot = Expr.groupSlotLatex(f.terms);
        return f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
      }
      var activeLatex = orderedLeaf.map(function (t, j) {
        return '\\htmlId{dragpv-' + j + '}{' + Expr.nodeLatex(t, j === 0) + '}';
      }).join('');
      var activeParen = '\\left(' + activeLatex + '\\right)';
      return f.exponent === 1 ? activeParen : activeParen + '^{' + f.exponent + '}';
    }).join('');
    var signP = node.sign < 0 ? '-' : '+';
    if (isFirst) return (signP === '-' ? '-' : '') + bodyP;
    return ' ' + signP + ' ' + bodyP;
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
  function productGroupFactorsLatexForOrder(node, idPrefix, topIdx, orderedFactors, isFirst) {
    var bodyP = orderedFactors.map(function (f, i) {
      var slot = '\\htmlId{dragpv-' + i + '}{' + Expr.groupSlotLatex(f.terms) + '}';
      return f.exponent === 1 ? slot : slot + '^{' + f.exponent + '}';
    }).join('');
    var signP = node.sign < 0 ? '-' : '+';
    var body = (isFirst ? (signP === '-' ? '-' : '') : ' ' + signP + ' ') + bodyP;
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
  // options.drilled : { path, branch, selectedInner:Set, onInnerClick, onExitDrill } — le
  // groupe à `path` (path[0] = index de premier niveau, path[1..] = descente dans les
  // innerTerms successifs — jamais utilisé avec `branch`, une seule profondeur là) est
  // alors rendu via drilledGroupLatex (FactorGroup) ou drilledProductBranchLatex
  // (ProductGroup + branch), ses termes intérieurs les plus profonds sélectionnables
  // individuellement, plutôt que comme un bloc opaque.
  function renderSide(container, side, sideName, idPrefix, options) {
    container.innerHTML = '';
    container.setAttribute('data-side', sideName);

    var drilled = options && options.drilled;

    var latex = side.map(function (node, idx) {
      if (drilled && drilled.path[0] === idx) {
        if (typeof drilled.branch === 'number') {
          return drilledProductBranchLatex(node, idPrefix, idx, drilled.branch, idx === 0);
        }
        return drilledGroupLatex(node, idPrefix, idx, drilled.path.slice(1), idx === 0);
      }
      var body = Expr.isProductGroup(node) ? productGroupBranchesLatex(node, idPrefix, idx, idx === 0) : Expr.nodeLatex(node, idx === 0);
      return '\\htmlId{' + idPrefix + '-' + idx + '}{' + body + '}';
    }).join('');
    window.katex.render(latex || '{}', container, { throwOnError: false, trust: true, strict: false });

    if (drilled) {
      var leafNode = Expr.nodeAtPath(side, drilled.path);
      var topIdx = drilled.path[0];
      var innerArr = typeof drilled.branch === 'number' ? leafNode.factors[drilled.branch].terms : leafNode.innerTerms;
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
          return typeof drilled.branch === 'number'
            ? drilledProductBranchLatexForOrder(node, drilled.branch, orderedLeaf, idx === 0)
            : drilledGroupLatexForOrder(node, drilled.path.slice(1), orderedLeaf, idx === 0);
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
          options.onTermClick ? function (targetEl) { options.onTermClick(sideName, idx, targetEl); } : null);
      } else if (options.selectable) {
        el.classList.add('selectable');
        el.addEventListener('click', function (e) {
          options.onTermClick(sideName, idx, e.target);
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
      // bouge) — transmis à `onClick` pour, ex., distinguer laquelle des deux parenthèses
      // d'un ProductGroup a été visée (voir productGroupBranchesLatex/data-branch et
      // selectDragOptions plus haut) : ce clic n'utilise jamais l'évènement DOM natif
      // 'click' (voir onUp ci-dessous), donc rien d'autre ne donnerait cette info.
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
        else if (onClick) onClick(mousedownTarget);
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
    window.katex.render('=', eqSign, { throwOnError: false });
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

    var leftSelected = new Set(pending.selectedLeft);
    var rightSelected = new Set(pending.selectedRight);
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
        leftSelectable = pending.selectedRight.length === 0;
        rightSelectable = pending.selectedLeft.length === 0;
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
          selectedInner: new Set(pending.selectedInner),
          draggable: innerDraggable,
          onInnerClick: function (innerIdx) {
            if (opts.onBeforeAction) opts.onBeforeAction();
            // Le double-clic (descendre encore d'un niveau) est détecté par mesure de
            // temps DANS toggleInnerSelection elle-même (voir consumeDoubleClick), pas ici.
            engine.toggleInnerSelection(innerIdx);
          },
          onExitDrill: function () {
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
      // pending.selectedFactors dans history.js) : au plus un produit à la fois, jamais en
      // même temps que `drilled` (mutuellement exclusifs, voir history.js).
      var selectedFactorsOpt = null;
      if (pending.selectedFactors && pending.selectedFactors.side === sideName) {
        selectedFactorsOpt = { index: pending.selectedFactors.index, branches: new Set(pending.selectedFactors.branches) };
      }
      return {
        selectable: selectable,
        draggable: draggable,
        selected: selected,
        drilled: drilledOpt,
        selectedFactors: selectedFactorsOpt,
        onTermClick: function (side, idx, targetEl) {
          if (opts.onBeforeAction) opts.onBeforeAction();
          // Le double-clic (entrer dans le groupe, ou dans UNE branche précise d'un
          // ProductGroup) est détecté par mesure de temps DANS toggleTermSelection
          // elle-même (voir consumeDoubleClick dans history.js), pas ici. `targetEl` :
          // l'élément DOM réellement cliqué (voir attachPointerDrag) — sert uniquement à
          // repérer, pour un ProductGroup, dans laquelle des deux parenthèses (data-branch,
          // voir productGroupBranchesLatex) le clic a physiquement atterri.
          var branchSpan = targetEl && targetEl.closest && targetEl.closest('[data-branch]');
          engine.toggleTermSelection(side, idx, branchSpan ? parseInt(branchSpan.getAttribute('data-branch'), 10) : null);
        }
      };
    }

    var framedRowEl = null; // la ligne encadrée (dernier résultat obtenu) : celle qu'on centre à l'écran

    steps.forEach(function (step, i) {
      var isLastConfirmed = (i === steps.length - 1);
      var solved = isLastConfirmed && App.Equation.isSolved(step.equation);
      // L'équation encadrée est celle qui vient d'être obtenue (le dernier résultat),
      // pas la ligne "pending" du dessous qui reste, elle, à construire.
      var current = isLastConfirmed && !solved;
      // C'est sur cette équation encadrée (la dernière obtenue) que les termes se
      // sélectionnent pour simplifier/factoriser/développer, pas sur la ligne "pending".
      var rowOpts = { pending: false, solved: solved, current: current };
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
      if (isLastConfirmed) framedRowEl = row;
      rowsData.push({
        el: row,
        opLeft: formatOpLabel(step.opLeft),
        opRight: formatOpLabel(step.opRight),
        pending: false
      });
    });

    var lastEq = engine.lastEquation();

    // La ligne "pending" (aperçu de la prochaine étape) n'existe QUE quand il y a
    // vraiment quelque chose à prévisualiser : voir shouldShowLivePreview — pas de
    // ligne fantôme permanente juste parce que l'équation n'est pas encore résolue.
    var showPendingRow = shouldShowLivePreview(pending, opts);

    if (showPendingRow) {
      var preview = engine.computePreview();
      var pendingRow = createRow(preview.equation, { pending: true, solved: false });
      container.appendChild(pendingRow);
      autoFitRowFont(pendingRow);
      rowsData.push({
        el: pendingRow,
        opLeft: formatOpLabel(preview.opLeft),
        opRight: formatOpLabel(preview.opRight),
        pending: true
      });
    }

    return { rowsData: rowsData, framedRowEl: framedRowEl };
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
    // Vider #history puis le reconstruire rend son contenu momentanément plus court/
    // étroit le temps de tout ré-ajouter ; si une mesure de layout (autoFitRowFont) se
    // produit entre-temps, le navigateur peut "clamper" scrollTop/scrollLeft à cette
    // taille réduite — et rien ne les restaure ensuite tout seul une fois la taille
    // retrouvée. On mémorise donc la position pour la restaurer explicitement plus bas
    // si on ne recentre pas.
    var preservedScrollTop = scroller ? scroller.scrollTop : 0;
    var preservedScrollLeft = scroller ? scroller.scrollLeft : 0;
    history.innerHTML = '';

    var branches = Hist.getBranches();
    history.classList.toggle('produit-nul-active', !!branches);
    var scrollTarget = null;   // ligne à recentrer à l'écran
    var scrollIdentity = null; // objet comparé à lastCenteredStepByEngine.get(scrollEngine)
    var scrollEngine = Hist;   // moteur possédant scrollIdentity (clé du suivi par moteur)

    if (!branches) {
      // Cas normal (pas de "produit nul" en cours) : une seule chaîne, comme avant.
      var res = renderChain(Hist, history, {});
      scrollTarget = res.framedRowEl;
      var steps = Hist.getSteps();
      scrollIdentity = steps[steps.length - 1];

      // Aperçu de "Produit nul" (survol de son bouton, voir previewProduitNul dans
      // history.js) ou de "Racine carrée" (une fois la touche √ du pavé "Opération"
      // ARMÉE — voir pending.sqrtArmed, pas dès qu'elle est simplement cliquable : sinon
      // l'aperçu apparaîtrait dès l'ouverture d'"Opération" sans action explicite de
      // l'élève, en plus de la ligne "pending" générique du mode 'expr', donnant
      // l'impression d'un aperçu en double) : montre à quoi ressembleraient les colonnes
      // ET la flèche fourchue AVANT de cliquer "Valider" — purement visuel (aucune
      // branche réelle créée, lignes non interactives, voir .produit-nul-preview).
      // Disparaît tout seul au prochain rendu dès que la condition n'est plus remplie.
      var previewEquations = null;
      var previewLabel = null;
      if (App.Toolbar.getHoveredOp() === 'produitnul') {
        previewEquations = Hist.previewProduitNul();
        previewLabel = '\\text{produit nul}';
      } else if (Hist.getPending().opType === 'expr' && Hist.getPending().sqrtArmed) {
        previewEquations = Hist.previewSquareRoot();
        previewLabel = '\\sqrt{\\phantom{x}}';
      }
      var previewCols = null;
      // Racine carrée dont l'aperçu ne donne qu'UNE équation (constante nulle, voir
      // confirmSquareRoot/pushStep dans history.js) : même principe que la confirmation
      // réelle — jamais de fourche/colonnes à une seule branche, juste une ligne "pending"
      // normale de plus dans la chaîne, avec ses deux flèches ordinaires (gauche/droite,
      // même étiquette √ des deux côtés).
      if (previewEquations && previewEquations.length === 1 && previewLabel === '\\sqrt{\\phantom{x}}') {
        var soleRowEl = createRow(previewEquations[0], { pending: true, solved: false, current: false });
        history.appendChild(soleRowEl);
        var soleLabel = formatOpLabel({ type: 'sqrt' });
        res.rowsData.push({ el: soleRowEl, opLeft: soleLabel, opRight: soleLabel, pending: true });
      } else if (previewEquations) {
        // PAS .produit-nul-split (dont le padding de 50vw sert uniquement à permettre,
        // une fois une VRAIE scission confirmée, de défiler assez loin pour recentrer
        // n'importe quelle colonne — inutile et contre-productif ici, cet aperçu est
        // éphémère et doit juste apparaître centré là où il est, sans logique de
        // défilement dédiée) : mise en page simple et indépendante, voir style.css.
        var previewWrap = document.createElement('div');
        previewWrap.className = 'produit-nul-preview';
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

      requestAnimationFrame(function () {
        var drawOpts = {};
        if (previewCols) {
          var lastEqSign = res.rowsData.length
            ? res.rowsData[res.rowsData.length - 1].el.querySelector('.eq-sign') : null;
          drawOpts.fork = { from: lastEqSign, to: previewCols, label: previewLabel };
        }
        App.Arrows.drawAll(history, res.rowsData, drawOpts);
      });
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
      var primarySteps = Hist.getPrimarySteps();
      var primaryRowsData = [];
      primarySteps.forEach(function (step) {
        // Jamais "current" (encadré bleu) : une fois scindée, ce n'est plus la ligne
        // active — ce sont les branches ci-dessous, chacune avec son propre cadre.
        var row = createRow(step.equation, { pending: false, solved: false, current: false });
        history.appendChild(row);
        autoFitRowFont(row);
        primaryRowsData.push({ el: row, opLeft: formatOpLabel(step.opLeft), opRight: formatOpLabel(step.opRight), pending: false });
      });

      var splitWrap = document.createElement('div');
      splitWrap.className = 'produit-nul-split';
      history.appendChild(splitWrap);

      var focused = Hist.getFocusedBranch();
      var branchResults = branches.map(function (engine, idx) {
        var col = document.createElement('div');
        col.className = 'produit-nul-branch' + (focused === idx ? ' branch-focused' : '');
        col.addEventListener('click', function () { Hist.setFocusedBranch(idx); });
        var chainEl = document.createElement('div');
        chainEl.className = 'produit-nul-chain';
        col.appendChild(chainEl);
        splitWrap.appendChild(col);

        var branchRes = renderChain(engine, chainEl, {
          noDrag: true, // simplifie le focus multi-branches (voir la tâche associée)
          onBeforeAction: function () { Hist.focusBranch(idx); },
          // Colonne pas active : jamais d'aperçu en direct (voir shouldShowLivePreview),
          // même si une sélection ou un survol y correspondrait par ailleurs.
          focused: focused === idx
        });
        // Pré-marque les branches PAS focalisées comme "déjà vues" (voir
        // lastCenteredStepByEngine tout en haut) : sans ça, cliquer pour focaliser une
        // colonne DÉJÀ affichée à l'écran (juste pas encore "vue" du point de vue du
        // suivi par moteur) déclencherait à tort un recentrage la première fois — comme
        // si elle venait d'apparaître. Sans danger de masquer une VRAIE nouvelle étape :
        // interagir avec une branche la focalise TOUJOURS d'abord (voir onBeforeAction
        // ci-dessus), donc une branche non focalisée ne peut jamais gagner de nouvelle
        // étape pendant qu'elle ne l'est pas. La branche focalisée, elle, n'est PAS
        // pré-marquée ici : c'est le contrôle dédié en fin de fonction qui décide pour
        // elle, en comparant à la dernière valeur réellement enregistrée.
        if (idx !== focused) {
          var otherSteps = engine.getSteps();
          lastCenteredStepByEngine.set(engine, otherSteps[otherSteps.length - 1]);
        }
        // Neutralise le margin-bottom (46px, voir .eq-row) de la DERNIÈRE ligne : sans ça,
        // il s'ajoute au padding bas de .produit-nul-branch et l'espace en bas de la
        // colonne devient nettement plus grand qu'en haut. Fait en JS (pas en CSS
        // :last-child/:last-of-type) car drawAll (arrows.js) ajoute ensuite le calque SVG
        // ET des .arrow-label (des <div>, comme .eq-row) comme frères APRÈS les lignes
        // dans ce même conteneur — aucun sélecteur structurel ne cible alors plus la
        // bonne ligne une fois les flèches dessinées. Fait ICI (juste après renderChain,
        // avant tout ajout de flèche) pour cibler la dernière ligne de façon fiable.
        var chainRows = chainEl.querySelectorAll('.eq-row');
        if (chainRows.length > 0) chainRows[chainRows.length - 1].classList.add('eq-row-flush-bottom');
        requestAnimationFrame(function () {
          // constrainLabels : les étiquettes d'opération restent DANS cette colonne,
          // jamais à cheval sur la colonne voisine (juxtaposées, séparées de 56px seulement).
          App.Arrows.drawAll(chainEl, branchRes.rowsData, { constrainLabels: true });
        });
        return { container: chainEl, col: col, res: branchRes, engine: engine };
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
      var isWideSplit = columnsNaturalWidth > (scroller ? scroller.clientWidth : history.clientWidth);
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
        App.Arrows.drawAll(history, primaryRowsData, { fork: { from: lastPrimaryEqSign, to: forkTargets, label: forkLabel } });
      });

      scrollTarget = branchResults[focused].res.framedRowEl;
      scrollEngine = branchResults[focused].engine;
      var focusedSteps = scrollEngine.getSteps();
      scrollIdentity = focusedSteps[focusedSteps.length - 1];

      // Résumé final une fois TOUTES les branches résolues : "S = {...}", fusionnant les
      // racines identiques (ex. racine double "(x+3)²=0", ou deux facteurs par ailleurs
      // distincts qui finissent par la même solution).
      if (branchResults.every(function (b) { return App.Equation.isSolved(b.engine.lastEquation()); })) {
        var roots = branchResults.map(function (b) { return extractRoot(b.engine.lastEquation()); })
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

    // On restaure D'ABORD la position d'avant le rendu, SYSTÉMATIQUEMENT (annule un
    // clampage éventuel dû à la reconstruction, voir preservedScrollTop/
    // preservedScrollLeft plus haut) — AVANT même de savoir si on va recentrer ensuite :
    // sans ça, une animation "smooth" ci-dessous partirait du bord (clampé) au lieu
    // d'où on était vraiment, donnant l'impression que la page "saute" à CHAQUE
    // confirmation d'étape plutôt que de glisser doucement vers le nouveau résultat.
    if (scroller) {
      scroller.scrollTop = preservedScrollTop;
      scroller.scrollLeft = preservedScrollLeft;
    }

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
    var isNewStep = scrollTarget && scrollIdentity !== lastCenteredStepByEngine.get(scrollEngine);
    var widthChangedDuringSplit = !!branches && isWideSplit && scroller && lastCenteredWidth !== null && scroller.clientWidth !== lastCenteredWidth;
    // Redimensionnement (ex. zoom du navigateur) qui fait REPASSER une scission de "large"
    // (scrollLeft explicite posé plus bas pour centrer le groupe de colonnes, voir
    // isWideSplit) à "tient dans la largeur disponible" : le centrage bascule alors sur le
    // margin-left CSS (voir plus haut), qui suppose un scrollLeft à 0 — sans repli explicite
    // ici, le scrollLeft non nul laissé par le PRÉCÉDENT affichage "large" persiste (rien ne
    // le réinitialise autrement, voir preservedScrollLeft plus haut qui le restaure au
    // contraire à chaque rendu) et décale alors TOUT le contenu (chaîne principale ET
    // colonnes, ensemble) du même montant — silencieusement, jusqu'à ce que quelque chose
    // d'autre force un nouveau recentrage. C'est précisément le bug "colonnes décalées à
    // droite selon le zoom" : reproductible en rétrécissant puis ré-élargissant la fenêtre
    // pendant qu'une scission large est affichée.
    var splitNoLongerWide = !!branches && !isWideSplit && scroller && scroller.scrollLeft !== 0;
    if (scroller && (isNewStep || widthChangedDuringSplit || splitNoLongerWide)) {
      lastCenteredStepByEngine.set(scrollEngine, scrollIdentity);
      lastCenteredWidth = scroller.clientWidth;
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
      var scrollOpts = { behavior: (isNewStep && !isWideSplit) ? 'smooth' : 'auto' };
      if (isNewStep && scrollTarget) {
        var targetRect = scrollTarget.getBoundingClientRect();
        var targetCenter = (targetRect.top - scrollerRect.top) + scroller.scrollTop + targetRect.height / 2;
        scrollOpts.top = targetCenter - scroller.clientHeight / 2;
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
        var splitCenterX = (splitRect.left - scrollerRect.left) + scroller.scrollLeft + splitRect.width / 2;
        scrollOpts.left = splitCenterX - scroller.clientWidth / 2;
      } else if (splitNoLongerWide) {
        scrollOpts.left = 0;
      }
      scroller.scrollTo(scrollOpts);
    }
  }

  App.Render = {
    renderAll: renderAll,
    formatOpLabel: formatOpLabel
  };
})(window.App = window.App || {});
