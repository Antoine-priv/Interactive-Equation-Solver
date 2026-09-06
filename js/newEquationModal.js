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

  function equationToLatex(eq) {
    return sideToLatex(eq.left) + '=' + sideToLatex(eq.right);
  }

  function init() {
    var btn = document.getElementById('newEquationBtn');
    var overlay = document.getElementById('modalOverlay');
    var manualInputSlot = document.getElementById('manualInputSlot');
    var manualError = document.getElementById('manualError');
    var manualSubmit = document.getElementById('manualSubmit');
    var randomBtn = document.getElementById('randomGenerate');
    var closeBtn = document.getElementById('modalClose');

    function submitManual() {
      try {
        var eq = App.Parser.parseLatexEquation(App.MathKeypad.getLatex());
        App.History.startNewEquation(eq);
        close();
      } catch (err) {
        manualError.textContent = err.message;
      }
    }

    function open() {
      overlay.hidden = false;
      manualError.textContent = '';
      App.MathKeypad.setActiveField(manualInputSlot, { onEnter: submitManual, onEscape: close }, '');
    }

    function close() {
      overlay.hidden = true;
      App.MathKeypad.clearActiveField();
    }

    btn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    // Bouton explicite en plus de la touche "↵" du pavé/clavier physique (voir
    // setActiveField ci-dessus) — même action, juste une seconde façon, plus visible, de
    // valider (l'icône "↵" du pavé ancré n'est pas forcément évidente au premier abord).
    manualSubmit.addEventListener('mousedown', function (e) { e.preventDefault(); }); // ne vole pas le focus du champ
    manualSubmit.addEventListener('click', submitManual);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    randomBtn.addEventListener('click', function () {
      // Remplit juste le champ (sans appliquer ni fermer) : l'élève peut relire/modifier
      // avant de valider lui-même, exactement comme une saisie manuelle.
      App.MathKeypad.setLatex(equationToLatex(App.Generator.generateEquation()));
      manualError.textContent = '';
    });
  }

  App.Modal = { init: init };
})(window.App = window.App || {});
