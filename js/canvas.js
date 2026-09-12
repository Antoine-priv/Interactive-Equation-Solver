/* Position de la toile "infinie" (voir #canvasLayer dans index.html).
   #historyScroll ne défile plus nativement (overflow:hidden, voir style.css) : son enfant
   PERSISTANT #canvasLayer (qui héberge #history, #opButtons et #liveOpPill, voir
   mathKeypad.js) est déplacé par un simple `transform: translate()`, piloté ici par un
   offset {x, y} SANS AUCUNE BORNE — contrairement à scrollLeft/scrollTop natifs, qui ne
   peuvent jamais être négatifs ni dépasser scrollWidth/scrollHeight, ce module autorise un
   panorama complètement libre dans toutes les directions.

   API délibérément calquée sur scrollLeft/scrollTop/scrollTo (mêmes concepts, même sens :
   x/y croissants déplacent la VUE vers la droite/le bas, donc le contenu visuellement vers
   la gauche/le haut, exactement comme scrollLeft/scrollTop natifs) : le reste du code
   (arrows.js, toolbar.js, render.js, main.js) continue de raisonner en "position de
   défilement" sans changer son arithmétique — seul le stockage change ici, plus jamais
   sujet au clampage natif (ex. lors d'un reflow pendant renderAll, voir son commentaire).

   L'animation "smooth" (voir scrollTo plus bas) passe par une VRAIE transition CSS
   (.canvas-panning-animated dans style.css) plutôt qu'une boucle requestAnimationFrame
   pilotée à la main : un rAF tourne sur le thread principal et peut être fortement
   throttlé (page masquée, mode headless...), désynchronisant silencieusement sa durée
   RÉELLE de sa durée programmée — observé en pratique avec la suite Playwright (l'écart
   suffisait à laisser l'animation en cours bien après le délai que les tests attendent
   après une confirmation, faisant manquer sa cible à un double-clic immédiat sur la ligne
   qui venait de se recentrer). Une transition CSS est prise en charge par le compositeur,
   pas par la boucle JS, et respecte donc sa durée réelle indépendamment de ce throttling. */
(function (App) {
  'use strict';

  var x = 0, y = 0;
  var scale = 1;
  var MIN_SCALE = 0.4;
  var MAX_SCALE = 2.5;
  var layer = null;
  var transitionCleanupTimer = null;
  var animating = false;

  function clampScale(s) {
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, s));
  }

  // Ordre important : `scale(...)` PUIS `translate(...)` — un point du repère local (non
  // transformé) de #canvasLayer subit donc d'abord la translation, puis la mise à
  // l'échelle (les fonctions d'une liste `transform` s'appliquent de la DERNIÈRE vers la
  // PREMIÈRE à un point donné). La position visible d'un point local `p` vaut alors
  // `scale * (p - {x, y})` : c'est cette relation que zoomAt() (voir plus bas) inverse
  // pour garder un point ÉCRAN fixe pendant un changement de zoom.
  function apply() {
    if (layer) layer.style.transform = 'scale(' + scale + ') translate(' + (-x) + 'px, ' + (-y) + 'px)';
  }

  function stopAnimated() {
    animating = false;
    if (transitionCleanupTimer !== null) { clearTimeout(transitionCleanupTimer); transitionCleanupTimer = null; }
    if (layer) layer.classList.remove('canvas-panning-animated');
  }

  // Pendant une transition CSS (voir scrollTo plus bas), `x`/`y` valent déjà la position
  // CIBLE (mise à jour immédiatement, pour que tout appel ultérieur raisonne sur "où on va
  // finir") alors que ce qui est réellement PEINT à l'écran est encore en train d'y glisser
  // — contrairement à un défilement natif, où scrollLeft/scrollTop reflètent TOUJOURS,
  // même en cours d'animation "smooth", la position RÉELLEMENT peinte à cet instant précis
  // (les deux sont pilotés par le même état du compositeur). Sans ce correctif, tout code
  // lisant getX/getY au MILIEU d'une transition (ex. le recentrage vertical déclenché par
  // l'étape suivante, voir renderAll dans render.js) combinerait un offset "final" avec des
  // getBoundingClientRect() encore "en chemin", un mélange incohérent qui a pu produire des
  // positions aberrantes en pratique. On retombe donc ici sur la valeur RÉELLEMENT peinte
  // (lue depuis la matrice CSS calculée) tant qu'une transition est en cours.
  function paintedOffset() {
    if (!animating || !layer) return { x: x, y: y };
    var m = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
    // m41/m42 portent la translation APRÈS mise à l'échelle (voir apply() : `scale()`
    // englobe `translate()`), donc `-x*scale`/`-y*scale`, pas `-x`/`-y` — diviser par
    // `m.a` (le facteur d'échelle courant, lu sur la même matrice plutôt que sur `scale`
    // pour rester cohérent avec ce qui est réellement peint pendant la transition) annule
    // ce facteur et retrouve l'offset "local" non transformé.
    return { x: -m.m41 / m.a, y: -m.m42 / m.a };
  }

  var Canvas = {
    init: function () {
      layer = document.getElementById('canvasLayer');
      apply();
    },
    getX: function () { return paintedOffset().x; },
    getY: function () { return paintedOffset().y; },
    getScale: function () { return scale; },
    // Positionnement immédiat, sans animation (équivalent à poser scrollLeft/scrollTop
    // natifs directement) — `nx`/`ny` optionnels : omis, l'axe correspondant reste
    // inchangé (même comportement que `Element.scrollTo({...})` avec un seul axe fourni).
    set: function (nx, ny) {
      stopAnimated();
      if (typeof nx === 'number') x = nx;
      if (typeof ny === 'number') y = ny;
      apply();
    },
    panBy: function (dx, dy) {
      stopAnimated();
      x += dx;
      y += dy;
      apply();
    },
    // Équivalent de `scroller.scrollTo({left, top, behavior})` : `opts.left`/`opts.top`
    // optionnels (axe laissé inchangé si omis), `opts.behavior === 'smooth'` anime plutôt
    // que de sauter directement à la position finale (voir .canvas-panning-animated dans
    // style.css pour la durée réelle de cette transition).
    scrollTo: function (opts) {
      opts = opts || {};
      var targetX = typeof opts.left === 'number' ? opts.left : x;
      var targetY = typeof opts.top === 'number' ? opts.top : y;
      stopAnimated();
      x = targetX; y = targetY;
      if (opts.behavior !== 'smooth' || !layer) {
        apply();
        return;
      }
      // Force un reflow AVANT d'ajouter la classe de transition : sans ça, si `apply()`
      // posait déjà un `transform` avec la classe active dans le MÊME tour (peu probable
      // ici vu stopAnimated() juste au-dessus, mais robuste par construction), le
      // navigateur pourrait fusionner l'état de départ et d'arrivée en une seule frame,
      // sautant directement à la cible sans jamais animer.
      animating = true;
      layer.classList.add('canvas-panning-animated');
      void layer.offsetHeight;
      apply();
      // Filet de sécurité (retire la classe même si 'transitionend' ne se déclenche pas,
      // ex. si x/y n'ont en fait pas changé) : durée alignée sur celle de la transition
      // CSS (voir style.css), avec une marge.
      transitionCleanupTimer = setTimeout(stopAnimated, 360);
    },
    // Change le zoom vers `newScale` (borné à [MIN_SCALE, MAX_SCALE]) en gardant le point
    // ÉCRAN (`screenX`, `screenY` — coordonnées relatives au coin haut-gauche de
    // #historyScroll, PAS du viewport) visuellement immobile : d'après la relation posée
    // dans apply() (`écran = échelle * (local - offset)`), le nouvel offset à appliquer
    // pour que ce même point local reste au même endroit à l'écran est
    // `offset + écran * (1/ancienneÉchelle - 1/nouvelleÉchelle)`. `screenX`/`screenY`
    // optionnels : par défaut, le centre du viewport (zoom "sur place" déclenché par un
    // bouton plutôt que par la molette sous le curseur).
    zoomAt: function (newScale, screenX, screenY, opts) {
      opts = opts || {};
      newScale = clampScale(newScale);
      if (typeof screenX !== 'number' || typeof screenY !== 'number') {
        var viewport = layer && layer.parentNode;
        screenX = viewport ? viewport.clientWidth / 2 : 0;
        screenY = viewport ? viewport.clientHeight / 2 : 0;
      }
      stopAnimated();
      if (newScale !== scale) {
        x += screenX * (1 / scale - 1 / newScale);
        y += screenY * (1 / scale - 1 / newScale);
        scale = newScale;
      }
      if (opts.behavior !== 'smooth' || !layer) {
        apply();
        return;
      }
      // Voir scrollTo ci-dessus pour le détail de ces trois lignes (même parade au
      // fusionnement de frame).
      animating = true;
      layer.classList.add('canvas-panning-animated');
      void layer.offsetHeight;
      apply();
      transitionCleanupTimer = setTimeout(stopAnimated, 360);
    }
  };

  App.Canvas = Canvas;
})(window.App = window.App || {});
