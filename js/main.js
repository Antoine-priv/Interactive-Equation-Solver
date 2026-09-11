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
      if (e.target.closest('.term, .drilled-exit, button, #controlPanel, #opButtons, #mathKeypadPanel, #mathKeypadPeekTab, #liveOpPill, math-field')) return;
      App.History.cancelOp();
    });
  }

  // Un glisser qui a effectivement panorâmé la toile (voir initCanvasPan plus bas) laisse
  // le curseur au-dessus de TOUT AUTRE CHOSE qu'au départ (le contenu, lui, a défilé sous
  // un curseur resté fixe à l'écran) — le navigateur émet quand même un 'click' natif
  // juste après le mouseup qui termine le geste, ciblant QUOI QUE CE SOIT qui se trouve
  // maintenant sous le curseur. Sans repli, ce clic "fantôme" déclenche bel et bien la
  // logique de CE qu'il touche : un terme de colonne "Produit nul"/"Racine carrée" (non
  // glissable là, voir CLAUDE.md, donc (dé)sélectionné par ce même 'click' natif,
  // contrairement au premier niveau normal qui n'en dépend jamais, voir attachPointerDrag
  // dans render.js) ou, plus vicieux encore, le fond LUI-MÊME — "clic en dehors de
  // l'équation efface la sélection en cours" (voir toolbar.js, initToolbar) est un
  // comportement VOULU pour un vrai clic, mais s'applique alors à tort à la fin d'un
  // panorama qui n'avait rien d'une désélection volontaire.
  //
  // `panJustEnded` (mis à true par initCanvasPan juste avant ce 'click' fantôme) et CE
  // gestionnaire doivent être : (a) posés sur `document`, comme tous les gestionnaires de
  // clic "en dehors" qu'ils doivent devancer (toolbar.js/initDrillDismissal) ; (b) en
  // phase de capture, comme eux ; (c) enregistrés AVANT eux (App.Toolbar.init() etc., plus
  // bas) — deux gestionnaires de capture sur la MÊME cible s'exécutent dans leur ordre
  // D'ENREGISTREMENT, jamais celui, dynamique, des gestes utilisateur. Sans ce tout premier
  // rang, un swallowClick ajouté seulement au moment du mouseup (essayé d'abord) arrive
  // TROP TARD : les gestionnaires "en dehors", déjà enregistrés depuis le chargement de la
  // page, s'exécutent avant lui et ont déjà agi. stopImmediatePropagation (pas seulement
  // stopPropagation) : bloque aussi tout AUTRE gestionnaire de capture ultérieur sur
  // `document` lui-même, pas seulement la suite de la remontée vers des ancêtres.
  var panJustEnded = false;
  document.addEventListener('click', function (e) {
    if (!panJustEnded) return;
    panJustEnded = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);

  // Toile "infinie" : cliquer-glisser le FOND de #historyScroll fait "panorâmer" le
  // tableau (voir App.Canvas dans canvas.js, qui porte l'offset — SANS AUCUNE BORNE,
  // contrairement à un défilement natif) — mousedown/mousemove/mouseup plutôt que du
  // natif, même schéma que attachPointerDrag dans render.js (seuil de quelques pixels
  // avant d'engager le geste, pour ne jamais gêner un simple clic). Aucun code de
  // repositionnement dédié requis ailleurs (flèches, pavé live, fenêtre d'actions...) :
  // tout se déplace déjà naturellement avec #canvasLayer, voir son commentaire dans
  // style.css.
  var CANVAS_PAN_EXCLUDE = '.term, .factor-slot, .draggable-term, .drilled-exit, ' +
    '.produit-nul-branch, .solution-set, .arrow-label-live, .arrow-label-mirror, ' +
    'button, a, input, textarea, select, math-field, ' +
    '#controlPanel, #opButtons, #mathKeypadPanel, #mathKeypadPeekTab, #liveOpPill';
  function initCanvasPan() {
    var scroller = document.getElementById('historyScroll');
    if (!scroller) return;
    scroller.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return; // clic gauche uniquement
      if (e.target.closest(CANVAS_PAN_EXCLUDE)) return;
      e.preventDefault(); // évite la sélection de texte pendant le glisser
      var startX = e.clientX, startY = e.clientY;
      var startPanX = App.Canvas.getX(), startPanY = App.Canvas.getY();
      var moved = false;
      function onMove(e2) {
        if (!moved) {
          if (Math.abs(e2.clientX - startX) < 4 && Math.abs(e2.clientY - startY) < 4) return;
          moved = true;
          scroller.classList.add('panning');
        }
        App.Canvas.set(startPanX - (e2.clientX - startX), startPanY - (e2.clientY - startY));
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        scroller.classList.remove('panning');
        // Voir le tout premier gestionnaire de clic du fichier (panJustEnded) : avale le
        // 'click' fantôme que le navigateur est sur le point d'émettre suite à ce mouseup.
        if (moved) panJustEnded = true;
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Molette/trackpad : reproduit le comportement d'un défilement natif (mêmes signes),
    // simplement piloté par App.Canvas plutôt qu'un vrai scroll — sauf quand la cible est
    // une ligne d'équation ENCORE scrollable nativement dans cette direction (voir
    // .eq-row { overflow-x: auto }, pour les équations trop larges à taille de police
    // minimale) : on lui laisse alors gérer elle-même son propre défilement horizontal,
    // exactement comme le "scroll chaining" natif l'aurait fait avant ce module. Ctrl+molette
    // (zoom du navigateur) n'est jamais intercepté.
    scroller.addEventListener('wheel', function (e) {
      if (e.ctrlKey) return;
      var row = e.target.closest('.eq-row');
      if (row && row.scrollWidth > row.clientWidth) {
        var canRowScroll = (e.deltaX < 0 && row.scrollLeft > 0) ||
          (e.deltaX > 0 && row.scrollLeft < row.scrollWidth - row.clientWidth);
        if (canRowScroll) return;
      }
      e.preventDefault();
      App.Canvas.panBy(e.deltaX, e.deltaY);
    }, { passive: false });
  }

  document.addEventListener('DOMContentLoaded', function () {
    App.History.subscribe(function () {
      // App.Toolbar.render() D'ABORD : il peut masquer/afficher des `.op-row` de
      // #opButtons (voir renderToolbar dans toolbar.js), un enfant PERSISTANT de
      // #canvasLayer. Plus une nécessité stricte depuis le passage à la toile "infinie"
      // (voir canvas.js) : App.Canvas.scrollTo anime via son propre rAF plutôt que le
      // scroll natif, donc une mutation DOM synchrone ailleurs ne peut plus l'interrompre
      // comme le faisait Chromium avec l'ancien scroller.scrollTo({behavior:'smooth'}).
      // Ordre conservé pour la seule dépendance qui reste : App.Toolbar.render() ne lit
      // jamais le DOM reconstruit par renderAll (seulement le modèle de données, voir
      // computeSelectionInfo), donc rien n'empêche de le garder en premier.
      App.Toolbar.render();
      App.Render.renderAll();
    });

    App.Canvas.init();
    App.Toolbar.init();
    App.MathKeypad.init();
    App.Keyboard.init();
    App.Modal.init();
    App.Theme.init();
    initUndoButton();
    initDrillDismissal();
    initCanvasPan();

    App.History.init(App.Generator.generateEquation());

    window.addEventListener('resize', function () {
      App.Render.renderAll();
    });
  });
})(window.App = window.App || {});
