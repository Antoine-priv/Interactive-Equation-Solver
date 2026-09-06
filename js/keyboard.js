/* Saisie clavier physique, en miroir du pavé numérique et de la barre d'outils. */
(function (App) {
  'use strict';

  function isTypingInField() {
    var el = document.activeElement;
    // 'MATH-FIELD' : le clavier mathématique unifié (voir mathKeypad.js) — un <math-field>
    // focalisé gère lui-même les flèches/chiffres/retour arrière nativement (navigation
    // structurelle façon GeoGebra/Desmos), ce gestionnaire global ne doit pas interférer.
    return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'MATH-FIELD');
  }

  function isModalOpen() {
    var overlay = document.getElementById('modalOverlay');
    return overlay && !overlay.hidden;
  }

  function init() {
    document.addEventListener('keydown', function (e) {
      if (isTypingInField() || isModalOpen()) return;

      var key = e.key;
      // +, -, *, / démarrent le mode "Opération" : le <math-field> partagé prend alors le
      // focus (voir bindMathKeypad dans toolbar.js) et reçoit nativement les frappes
      // SUIVANTES — mais cette touche de départ elle-même a lieu AVANT que le champ soit
      // focalisé (ce gestionnaire global ne se déclenche que hors du champ, voir
      // isTypingInField), donc perdue si on ne l'insère pas nous-mêmes une fois le mode
      // engagé (ex. "*x" doit bien composer "×x", pas juste activer le mode et perdre le
      // "×" pressé pour l'ouvrir).
      var OP_LATEX = { '+': '+', '-': '-', '*': '\\times ', '/': '\\div ' };
      if (OP_LATEX[key]) {
        var pend = App.History.getPending();
        if (pend.opType !== 'expr') {
          App.History.selectOp('expr');
          App.MathKeypad.setLatex(OP_LATEX[key]);
          App.History.setExprChainText(OP_LATEX[key]);
        }
        e.preventDefault();
        return;
      }
      if (key === 'Enter') { App.History.confirm(); e.preventDefault(); return; }
      if (key === 'Escape') { App.History.cancelOp(); e.preventDefault(); return; }
    });
  }

  App.Keyboard = { init: init };
})(window.App = window.App || {});
