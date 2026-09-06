/* Point d'entrée : câble les modules ensemble. */
(function (App) {
  'use strict';

  var UNDO_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';

  // Bouton flottant "annuler la dernière opération" (voir undo/canUndo dans history.js) :
  // annule la dernière étape confirmée du moteur actif (membre principal, ou branche
  // focalisée après un "Produit nul"/"Racine carrée"), ou — à défaut, si cette branche
  // est déjà à son tout premier step — la scission elle-même. Jamais en dessous de
  // l'équation de départ (bouton grisé quand il n'y a plus rien à annuler).
  function initUndoButton() {
    var btn = document.getElementById('undoBtn');
    if (!btn) return;
    btn.innerHTML = UNDO_SVG;
    btn.addEventListener('click', function () { App.History.undo(); });
    App.History.subscribe(function () { btn.disabled = !App.History.canUndo(); });
  }

  // Ressortir d'un groupe "entré" (pending.drilled, voir history.js) sans avoir à viser
  // précisément la parenthèse elle-même (voir .drilled-exit dans render.js, qui gère déjà
  // ce même geste MAIS seulement quand il atterrit dessus) : un clic droit N'IMPORTE OÙ
  // sur la page ressort d'UN niveau (même action que exitDrill) ; un clic gauche EN DEHORS
  // de toute zone interactive (aucun terme, bouton, panneau flottant...) annule tout,
  // comme Échap (voir cancelOp/Keyboard.init) — cliquer "dans le vide" doit pouvoir sortir
  // du mode sans avoir à viser quoi que ce soit de précis. Rien de tout ça pendant que la
  // modale "+" est ouverte (ex. un clic droit dans son champ de saisie doit rester un
  // simple clic droit natif, pour coller/etc.).
  function initDrillDismissal() {
    function modalOpen() {
      var overlay = document.getElementById('modalOverlay');
      return !!overlay && !overlay.hidden;
    }
    document.addEventListener('contextmenu', function (e) {
      if (modalOpen() || !App.History.getPending().drilled) return;
      e.preventDefault();
      App.History.exitDrill();
    });
    document.addEventListener('click', function (e) {
      if (modalOpen() || !App.History.getPending().drilled) return;
      if (e.target.closest('.term, .drilled-exit, button, #controlPanel, #opButtons, #mathKeypadPanel, #mathKeypadPeekTab, math-field')) return;
      App.History.cancelOp();
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    App.History.subscribe(function () {
      App.Render.renderAll();
      App.Toolbar.render();
    });

    App.Toolbar.init();
    App.MathKeypad.init();
    App.Keyboard.init();
    App.Modal.init();
    App.Theme.init();
    initUndoButton();
    initDrillDismissal();

    App.History.init(App.Generator.generateEquation());

    window.addEventListener('resize', function () {
      App.Render.renderAll();
    });
  });
})(window.App = window.App || {});
