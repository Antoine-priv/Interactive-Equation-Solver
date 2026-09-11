/* Boutons flottants "zoom avant"/"zoom arrière" (loupe) — pilotent App.Canvas.zoomAt
   (voir canvas.js) en centrant le zoom sur le milieu du viewport, avec une petite
   animation (comme App.Canvas.scrollTo({behavior:'smooth'})). Ctrl+molette (voir
   initCanvasPan dans main.js) passe directement par wheelZoom ci-dessous plutôt que par
   ces boutons : centré sur le curseur, jamais animé (pour suivre la molette au pixel près,
   comme un vrai zoom continu). */
(function (App) {
  'use strict';

  var ZOOM_STEP = 1.2;
  // Doit rester synchronisé avec MIN_SCALE/MAX_SCALE dans canvas.js (App.Canvas.zoomAt
  // clampe déjà silencieusement à ces mêmes bornes) : seulement utilisé ici pour griser
  // les boutons une fois la borne atteinte, jamais pour appliquer le zoom lui-même.
  var MIN_SCALE = 0.4;
  var MAX_SCALE = 2.5;
  // Molette : un pas continu (par petit incrément de deltaY) plutôt qu'un facteur fixe par
  // "cran", pour rester fluide aussi bien avec une molette de souris classique (gros pas
  // discrets) qu'un trackpad (deltaY fin et continu).
  var WHEEL_RATE = 1.0015;

  var zoomInBtn = null, zoomOutBtn = null;

  var MAGNIFIER = '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>';
  var ZOOM_IN_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + MAGNIFIER +
    '<line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>';
  var ZOOM_OUT_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + MAGNIFIER +
    '<line x1="8" y1="11" x2="14" y2="11"/></svg>';

  function refreshButtons() {
    var scale = App.Canvas.getScale();
    if (zoomInBtn) zoomInBtn.disabled = scale >= MAX_SCALE - 1e-6;
    if (zoomOutBtn) zoomOutBtn.disabled = scale <= MIN_SCALE + 1e-6;
  }

  // Centré sur le milieu du viewport (App.Canvas.zoomAt sans coordonnées écran explicites
  // retombe déjà sur ce même centre, voir canvas.js — passé ici explicitement uniquement
  // pour ne pas dépendre de cet aiguillage par défaut).
  function zoomByFactor(factor, opts) {
    var scroller = document.getElementById('historyScroll');
    var cx, cy;
    if (scroller) { cx = scroller.clientWidth / 2; cy = scroller.clientHeight / 2; }
    App.Canvas.zoomAt(App.Canvas.getScale() * factor, cx, cy, opts);
    refreshButtons();
  }

  var Zoom = {
    init: function () {
      zoomInBtn = document.getElementById('zoomInBtn');
      zoomOutBtn = document.getElementById('zoomOutBtn');
      if (zoomInBtn) {
        zoomInBtn.innerHTML = ZOOM_IN_SVG;
        zoomInBtn.addEventListener('click', function () {
          if (zoomInBtn.disabled) return;
          zoomByFactor(ZOOM_STEP, { behavior: 'smooth' });
        });
      }
      if (zoomOutBtn) {
        zoomOutBtn.innerHTML = ZOOM_OUT_SVG;
        zoomOutBtn.addEventListener('click', function () {
          if (zoomOutBtn.disabled) return;
          zoomByFactor(1 / ZOOM_STEP, { behavior: 'smooth' });
        });
      }
      refreshButtons();
    },
    // Ctrl+molette (voir initCanvasPan dans main.js) : `screenX`/`screenY` sont les
    // coordonnées du curseur relatives au coin haut-gauche de #historyScroll, transmises
    // telles quelles à App.Canvas.zoomAt pour garder le point survolé immobile à l'écran.
    // Jamais animé (contrairement aux boutons) : un geste continu doit rester instantané,
    // une transition CSS entre chaque évènement 'wheel' accumulerait un retard croissant.
    wheelZoom: function (deltaY, screenX, screenY) {
      var factor = Math.pow(WHEEL_RATE, -deltaY);
      App.Canvas.zoomAt(App.Canvas.getScale() * factor, screenX, screenY);
      refreshButtons();
    }
  };

  App.Zoom = Zoom;
})(window.App = window.App || {});
