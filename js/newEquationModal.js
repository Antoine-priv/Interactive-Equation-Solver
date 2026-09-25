/* Modale "+" : nouvelle équation saisie via le clavier mathématique unifié (voir
   mathKeypad.js) ou générée aléatoirement. */
(function (App) {
  'use strict';

  // Texte signé d'un noeud (Term, FactorGroup ou ProductGroup) en LaTeX, réutilisé tel
  // quel pour préremplir le champ (voir App.Expr.nodeLatex, déjà utilisé partout ailleurs
  // pour l'affichage KaTeX des étapes — aucune notation "à part" à maintenir ici).
  function sideToLatex(side) {
    return App.Expr.sideLatex(side);
  }

  // `operator` : '\geq'/'\leq'/'<'/'>' (voir App.Ineq.OPERATORS) ou null/undefined pour
  // "=" implicite — mêmes tokens que ceux reconnus par App.Parser.splitTopLevelRelation,
  // pour que le round-trip (préremplissage puis reparsing à la validation) soit exact.
  function equationToLatex(eq, operator) {
    return sideToLatex(eq.left) + (operator || '=') + sideToLatex(eq.right);
  }

  // Doit rester en phase avec la transition CSS de .modal-overlay/.modal-box (voir
  // style.css) : durée du fondu/rétrécissement de fermeture, après laquelle `hidden` est
  // enfin posé (voir close() plus bas).
  var VANISH_MS = 180;

  function init() {
    var btn = document.getElementById('newEquationBtn');
    var overlay = document.getElementById('modalOverlay');
    var box = overlay.querySelector('.modal-box');
    var manualInputSlot = document.getElementById('manualInputSlot');
    var manualError = document.getElementById('manualError');
    var manualSubmit = document.getElementById('manualSubmit');
    var randomBtn = document.getElementById('randomGenerate');
    var closeBtn = document.getElementById('modalClose');
    var relationButtons = document.querySelectorAll('#relationPicker .relation-btn');
    var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var closeTimer = null;

    function submitManual() {
      try {
        var eq = App.Parser.parseLatexEquation(App.MathKeypad.getLatex());
        App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
        close();
      } catch (err) {
        manualError.textContent = err.message;
      }
    }

    function open() {
      // Réouverture pendant une fermeture encore en cours (voir close() plus bas) : annule
      // le `hidden` différé et repart d'un état stable avant de rejouer le "pop" d'entrée.
      if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
      overlay.classList.remove('modal-overlay-hiding');
      box.classList.remove('modal-vanish');
      overlay.hidden = false;
      manualError.textContent = '';
      // Toujours l'équation INITIALE (première étape de la chaîne principale, jamais
      // déléguée à une colonne focalisée), pas l'étape courante : la modale sert à
      // repartir de l'énoncé, éventuellement corrigé, pas de là où l'élève en est.
      var first = App.History.getOwnSteps()[0];
      App.MathKeypad.setActiveField(manualInputSlot, { onEnter: submitManual, onEscape: close }, equationToLatex(first.equation, first.operator));
      if (prefersReducedMotion) return;
      // Fondu d'entrée du fond (même classe que la fermeture, voir .modal-overlay-hiding
      // dans style.css) : posée puis retirée après un reflow forcé pour que le navigateur
      // voie bien le départ "transparent" avant d'interpoler vers l'opacité finale, plutôt
      // que de sauter directement dessus (même parade que setRowVisibility dans toolbar.js).
      overlay.classList.add('modal-overlay-hiding');
      void overlay.offsetWidth;
      overlay.classList.remove('modal-overlay-hiding');
      // "Pop" de la boîte elle-même (grossissement + fondu, voir @keyframes modalPopIn) —
      // classe retirée avant d'être reposée pour permettre de rejouer l'animation même si
      // elle était déjà présente (ouverture/fermeture/réouverture rapides).
      box.classList.remove('modal-pop-in');
      void box.offsetWidth;
      box.classList.add('modal-pop-in');
    }

    function close() {
      // Idempotent : déjà fermée, ou fermeture déjà en cours (voir closeTimer) — un second
      // appel (ex. Échap puis clic sur la croix) ne doit pas relancer le fondu depuis le
      // milieu de la transition en cours.
      if (overlay.hidden || closeTimer !== null) return;
      App.MathKeypad.clearActiveField();
      if (prefersReducedMotion) {
        overlay.hidden = true;
        return;
      }
      box.classList.remove('modal-pop-in');
      // Force un reflow AVANT d'ajouter les classes de disparition : sans lui, retirer
      // modal-pop-in (une animation jamais nettoyée après coup) et ajouter
      // modal-overlay-hiding/modal-vanish dans le MÊME tour peut fusionner les deux en une
      // seule frame, sans jamais peindre l'état de départ séparément de l'arrivée — la
      // transition n'a alors rien à interpoler et saute directement à la cible (même parade
      // qu'à l'ouverture juste au-dessus, et que setPanelHidden dans mathKeypad.js).
      void box.offsetWidth;
      overlay.classList.add('modal-overlay-hiding');
      box.classList.add('modal-vanish');
      closeTimer = setTimeout(function () {
        overlay.hidden = true;
        overlay.classList.remove('modal-overlay-hiding');
        box.classList.remove('modal-vanish');
        closeTimer = null;
      }, VANISH_MS);
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    // Bouton explicite en plus de la touche "↵" du pavé/clavier physique (voir
    // setActiveField ci-dessus) — même action, juste une seconde façon, plus visible, de
    // valider (l'icône "↵" du pavé ancré n'est pas forcément évidente au premier abord).
    manualSubmit.addEventListener('mousedown', function (e) { e.preventDefault(); }); // ne vole pas le focus du champ
    manualSubmit.addEventListener('click', submitManual);
    // Sélecteur de relation (=, >, <, ≥, ≤, voir index.html) : insère le token LaTeX du
    // bouton au curseur du champ actif (voir insertAtCursor dans mathKeypad.js), même
    // parade "mousedown préventif" que manualSubmit ci-dessus pour ne pas voler le focus.
    Array.prototype.forEach.call(relationButtons, function (relBtn) {
      relBtn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      relBtn.addEventListener('click', function () {
        App.MathKeypad.insertAtCursor(relBtn.getAttribute('data-relation'));
      });
    });
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    // "Générer aléatoirement" remplit le champ en LaTeX pour relecture (voir ci-dessous),
    // qui devra donc pouvoir être RE-analysé par le parseur manuel une fois validé (voir
    // submitManual) — contrairement à App.History.init(App.Generator.generateEquation())
    // au chargement de la page (main.js), qui charge l'AST directement, sans jamais
    // repasser par le parseur. Toutes les formes produites par generateEquation() round-
    // trippent désormais : un dénominateur-expression (isExpressionQuotient, voir
    // generateVariableDenominatorEquation dans generator.js) et un radicand-expression au
    // premier niveau (isSqrtGroup, voir generateVariableRadicandEquation/
    // generateVariableRadicandQuadraticEquation) passent tous deux par
    // stripHtmlWrappers/foldSqrt dans parser.js — plus besoin de filtrer/retirer
    // aucune forme au hasard ici.
    randomBtn.addEventListener('click', function () {
      // Remplit juste le champ (sans appliquer ni fermer) : l'élève peut relire/modifier
      // avant de valider lui-même, exactement comme une saisie manuelle.
      var gen = App.Generator.generateEquation();
      App.MathKeypad.setLatex(equationToLatex(gen, gen.operator));
      manualError.textContent = '';
    });
  }

  App.Modal = { init: init };
})(window.App = window.App || {});
