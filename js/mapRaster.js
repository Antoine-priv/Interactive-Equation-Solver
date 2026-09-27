/* MapRaster : les parties de la carte qui ne bougent pas pendant qu'on la regarde, dessinées
   en images au lieu de rester des milliers d'éléments SVG dans la page.
   Firefox redessine chaque élément SVG à chaque changement d'échelle, donc à chaque image
   d'un zoom : avec les décors, la carte ramait. Ici, mapArt.js construit ces parties dans
   des SVG détachés, sérialisés avec leurs styles (variables CSS résolues pour le thème
   courant), chargés comme images puis dessinés dans des <canvas>. Glisser et zoomer ne
   font plus que déplacer et mettre à l'échelle ces canvas. Rien à regénérer à la main :
   tout est refait à partir de mapArt.js (au premier affichage, à chaque changement de
   thème, et quand l'état des chemins, niveaux ou nuages change).
   Sources (hors de la page) : `ground` (mer, îles, régions, décors, nuages du ciel, gardé
   dessiné dans un canvas hors page, c'est le plus long à dessiner), `edges` (chemins),
   `nodes` (niveaux et obstacles ; map.js garde leurs éléments SVG, invisibles, pour les
   clics), `clouds` (nuages des régions fermées), `labels` (panneaux).
   Canvas affichés, le moins possible (chacun est une grande texture à composer à chaque
   image) :
   - `below` = ground + edges + nodes, sous le SVG vivant ;
   - `above` = clouds + labels, au-dessus ;
   - `detail`/`detailTop` : en zoom avant au-delà de BASE_RES, les mêmes, nets, pour la
     zone visible, refaits quand la vue s'arrête ; retirés de l'affichage sinon. */
(function (App) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  // Marge autour du monde (vagues, halo des côtes, nuages du ciel).
  var PAD_X = 320, PAD_Y = 240;
  var BASE_RES = 1.4, MAX_DETAIL_PX = 4096;

  var shown = {};           // canvas affichés : below, above, detail, detailTop
  var src = {};             // sources : { inner, img } (ground : { inner, canvas })
  var keys = {};
  var parts = null, styleText = null, generation = 0;
  var detailFor = null, detailTimer = null, lastView = null;

  function canvasEl(cls) {
    var c = document.createElement('canvas');
    c.className = 'map-raster map-raster-' + cls;
    c.setAttribute('aria-hidden', 'true');
    return c;
  }

  // Règles de dessin de la carte (App.MapArt.CSS), variables résolues sur #mapOverlay pour
  // le thème courant : un SVG chargé en image n'a accès ni à la page ni à ses variables.
  function styles() {
    if (styleText) return styleText;
    var cs = getComputedStyle(document.getElementById('mapOverlay'));
    styleText = App.MapArt.CSS.replace(/var\((--[\w-]+)\)/g, function (m, name) { return cs.getPropertyValue(name).trim() || 'none'; }) +
      (App.MapArt.isNight() ? '\n.m-night { display: inline; }' : '');
    return styleText;
  }

  function serialize(svgEl) {
    var s = new XMLSerializer(), out = '';
    Array.prototype.forEach.call(svgEl.childNodes, function (n) { out += s.serializeToString(n); });
    return out;
  }

  function padded() { return { x: -PAD_X, y: -PAD_Y, w: App.MapArt.W + 2 * PAD_X, h: App.MapArt.H + 2 * PAD_Y }; }

  // Charge le contenu SVG `inner` (coordonnées du monde, région r) comme image de
  // pw × ph pixels. Résout null si un changement de thème l'a rendue obsolète.
  function load(inner, r, pw, ph) {
    var text = '<svg xmlns="' + NS + '" width="' + pw + '" height="' + ph + '" viewBox="' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h +
      '"><style>' + styles() + '</style>' + inner + '</svg>';
    var url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    var gen = generation;
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(gen === generation ? img : null); };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // Dimensionne un canvas pour la région r à `res` pixels par unité et le place dans le plan
  // (unités du monde).
  function fit(c, r, res) {
    var pw = Math.max(1, Math.round(r.w * res)), ph = Math.max(1, Math.round(r.h * res));
    if (c.width !== pw) c.width = pw;
    if (c.height !== ph) c.height = ph;
    c.style.left = r.x + 'px';
    c.style.top = r.y + 'px';
    c.style.width = r.w + 'px';
    c.style.height = r.h + 'px';
    return c.getContext('2d');
  }

  function hide(c) { c.classList.remove('ready'); }

  // Compose un canvas affiché à partir de sources (images SVG ou canvas), toutes dans la
  // région rembourrée ou dans le monde seul (`world`).
  function compose(c, list) {
    var r = padded(), ctx = fit(c, r, BASE_RES);
    ctx.clearRect(0, 0, c.width, c.height);
    list.forEach(function (s) {
      if (!s || !(s.img || s.canvas)) return;
      var x = s.world ? PAD_X * BASE_RES : 0, y = s.world ? PAD_Y * BASE_RES : 0;
      var w = s.world ? App.MapArt.W * BASE_RES : c.width, h = s.world ? App.MapArt.H * BASE_RES : c.height;
      ctx.drawImage(s.img || s.canvas, x, y, w, h);
    });
    c.classList.add('ready');
  }
  function composeBelow() { if (src.ground && src.ground.canvas) compose(shown.below, [src.ground, src.edges, src.nodes]); }
  function composeAbove() { compose(shown.above, [src.clouds, src.labels]); }

  // Source SVG dessinée à la demande (chemins, niveaux, nuages, panneaux).
  function setSource(name, inner, world, then) {
    var r = world ? { x: 0, y: 0, w: App.MapArt.W, h: App.MapArt.H } : padded();
    var entry = src[name] = { inner: inner, world: world, img: null };
    if (!inner) { then(); return; }
    load(inner, r, Math.round(r.w * BASE_RES), Math.round(r.h * BASE_RES)).then(function (img) {
      if (!img || src[name] !== entry) return;
      entry.img = img;
      then();
    });
  }

  function staticParts() {
    if (!parts) {
      var p = App.MapArt.buildStaticSvg();
      parts = { ground: serialize(p.ground), decor: serialize(p.decor) };
    }
    return parts;
  }

  // ---- API ----
  // Crée les canvas affichés dans le plan : `below` et `detail` sous `beforeEl` (le SVG des
  // nœuds), `above` et `detailTop` sous `topBeforeEl` (le SVG des panneaux).
  function init(plane, beforeEl, topBeforeEl) {
    ['below', 'detail'].forEach(function (k) { plane.insertBefore(shown[k] = canvasEl(k), beforeEl); });
    ['above', 'detailTop'].forEach(function (k) { plane.insertBefore(shown[k] = canvasEl(k), topBeforeEl); });
  }

  function renderGround() {
    var p = staticParts(), r = padded();
    var pw = Math.round(r.w * BASE_RES), ph = Math.round(r.h * BASE_RES);
    load(p.ground + p.decor, r, pw, ph).then(function (img) {
      if (!img) return;
      var c = document.createElement('canvas');
      c.width = pw;
      c.height = ph;
      c.getContext('2d').drawImage(img, 0, 0, pw, ph);
      src.ground = { canvas: c };
      composeBelow();
    });
  }

  // Panneaux des régions découvertes `ids` (null : redessine les derniers).
  function setLabels(ids) {
    ids = ids || keys.labelIds || [];
    var key = ids.join(',');
    if (key === keys.labels) return;
    keys.labels = key;
    keys.labelIds = ids;
    setSource('labels', serialize(App.MapArt.buildLabelsSvg(ids)), false, composeAbove);
    refreshDetail();
  }

  // Chemins : [{ edge, state }] (sauf celui qui se trace à l'instant, resté en SVG).
  function setEdges(list) {
    var key = list.map(function (it) { return it.edge.key + ':' + it.state; }).join(',');
    if (key === keys.edges) return;
    keys.edges = key;
    setSource('edges', serialize(App.MapArt.buildEdgesSvg(list)), true, composeBelow);
    refreshDetail();
  }

  // Niveaux et obstacles : SVG détaché construit par map.js (null : redessine le dernier).
  function setNodes(svgEl) {
    var inner = svgEl ? serialize(svgEl) : (src.nodes && src.nodes.inner);
    if (svgEl && src.nodes && inner === src.nodes.inner) return;
    setSource('nodes', inner || '', true, composeBelow);
    refreshDetail();
  }

  // Nuages des régions `zoneIds` (encore fermées, hors celle qui s'ouvre à l'instant et dont
  // les nuages s'écartent en SVG).
  function setClouds(zoneIds) {
    var key = zoneIds.join(',');
    if (key === keys.clouds) return;
    keys.clouds = key;
    setSource('clouds', zoneIds.length ? serialize(App.MapArt.buildCloudSvg(zoneIds)) : '', false, composeAbove);
    refreshDetail();
  }

  function refreshDetail() {
    detailFor = null;
    if (lastView) updateDetail(lastView.view, lastView.vw, lastView.vh);
  }

  // Vue arrêtée : images nettes de la zone visible si l'échelle dépasse la résolution de base.
  function updateDetail(view, vw, vh) {
    lastView = { view: { x: view.x, y: view.y, s: view.s }, vw: vw, vh: vh };
    clearTimeout(detailTimer);
    var need = view.s * (window.devicePixelRatio || 1);
    if (need <= BASE_RES * 1.05) {
      hide(shown.detail);
      hide(shown.detailTop);
      detailFor = null;
      return;
    }
    var x0 = -view.x / view.s, y0 = -view.y / view.s, w = vw / view.s, h = vh / view.s;
    if (detailFor && detailFor.res >= need * 0.95 && x0 >= detailFor.x && y0 >= detailFor.y &&
      x0 + w <= detailFor.x + detailFor.w && y0 + h <= detailFor.y + detailFor.h) return;
    detailTimer = setTimeout(function () {
      var m = 0.3, wr = padded();
      var r = { x: x0 - w * m, y: y0 - h * m, w: w * (1 + 2 * m), h: h * (1 + 2 * m) };
      r.x = Math.max(wr.x, r.x); r.y = Math.max(wr.y, r.y);
      r.w = Math.min(wr.x + wr.w - r.x, r.w); r.h = Math.min(wr.y + wr.h - r.y, r.h);
      var res = Math.min(need, MAX_DETAIL_PX / Math.max(r.w, r.h));
      var pw = Math.round(r.w * res), ph = Math.round(r.h * res);
      var p = staticParts(), ticket = detailTimer;
      function inner(name) { return (src[name] && src[name].inner) || ''; }
      [['detail', p.ground + inner('edges') + p.decor + inner('nodes')], ['detailTop', inner('clouds') + inner('labels')]]
        .forEach(function (d) {
          load(d[1], r, pw, ph).then(function (img) {
            if (!img || ticket !== detailTimer) return;
            var c = shown[d[0]], ctx = fit(c, r, res);
            ctx.clearRect(0, 0, c.width, c.height);
            ctx.drawImage(img, 0, 0, c.width, c.height);
            c.classList.add('ready');
            if (d[0] === 'detail') detailFor = { x: r.x, y: r.y, w: r.w, h: r.h, res: res };
          });
        });
    }, 220);
  }

  // Thème changé : couleurs résolues à refaire ; l'appelant redessine ensuite.
  function invalidate() {
    generation++;
    styleText = null;
    detailFor = null;
    keys = { labelIds: keys.labelIds };
    hide(shown.detail);
    hide(shown.detailTop);
  }

  App.MapRaster = {
    init: init,
    renderGround: renderGround,
    setLabels: setLabels,
    setNodes: setNodes,
    setEdges: setEdges,
    setClouds: setClouds,
    updateDetail: updateDetail,
    invalidate: invalidate
  };
})(window.App = window.App || {});
