/* Map : écran "La Carte des équations" (voir docs/gamification/plan.md). Un calque plein
   écran (#mapOverlay) par-dessus le canevas, construit en SVG à partir d'App.Levels et
   d'App.Progress. Se déplace par glisser et se zoome à la molette, comme le canevas.
   Au retour d'un niveau réussi (open({ from, unlocked })), anime le chemin vers les
   niveaux qui viennent de s'ouvrir : tracé, cadenas, jeton "x", brouillard qui se lève.
   Uniquement des transitions/animations CSS (même raison que canvas.js). */
(function (App) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var overlay, viewport, plane, svg, topSvg, world, card, badgePanel;
  var view = { x: 0, y: 0, s: 1 };
  var zoomInBtn = null, zoomOutBtn = null;
  var selectedId = null;
  // La fiche suit le survol d'un nœud (`hoverId`) tant qu'aucun niveau n'est fixé par un
  // clic (`pinned`, fiche de `selectedId`).
  var pinned = false, hoverId = null, hoverTimer = null;
  function shownId() { return pinned ? selectedId : hoverId; }
  var onPlay = null;

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Niveau "courant" : le premier niveau ouvert pas encore résolu (ordre du catalogue).
  function currentLevel() {
    var P = App.Progress;
    return App.Levels.LEVELS.filter(function (l) { return P.isAvailable(l) && !P.isSolved(l.id); })[0] || null;
  }

  function nodeState(level) {
    var P = App.Progress;
    if (P.isSolved(level.id)) return 'done';
    return P.isAvailable(level) ? 'open' : 'locked';
  }

  function zoneOpen(zone) {
    return App.Levels.LEVELS.some(function (l) { return l.zone === zone.id && App.Progress.isAvailable(l); });
  }

  // Transform CSS pour pouvoir l'animer comme le canevas (voir .map-world-animated dans
  // style.css, même courbe que .canvas-panning-animated). Il porte sur le plan HTML qui
  // contient le SVG, pas sur un groupe SVG : le plan est un calque composité (will-change),
  // dessiné une fois puis seulement déplacé par le GPU, au lieu de repeindre les milliers
  // de décors à chaque image du glisser.
  var lastScale = null;
  function applyView(animated) {
    plane.classList.toggle('map-world-animated', !!animated);
    card.classList.toggle('map-card-animated', !!animated);
    // Translation arrondie au pixel écran : sinon Firefox rend les textes décalés
    // pendant le glisser puis les recale au repos (les titres des régions sautaient).
    var dpr = window.devicePixelRatio || 1;
    plane.style.transform = 'translate(' + Math.round(view.x * dpr) / dpr + 'px, ' + Math.round(view.y * dpr) / dpr + 'px) scale(' + view.s + ')';
    if (lastScale !== null && lastScale !== view.s) resharpenSoon(animated);
    lastScale = view.s;
    App.MapRaster.updateDetail(view, viewport.clientWidth, viewport.clientHeight);
    positionCard();
    refreshZoomButtons();
  }

  // Un calque composité garde la résolution à laquelle il a été dessiné : après un zoom, on
  // le fait redessiner à la nouvelle échelle (sinon flou en zoom avant) en retirant
  // will-change le temps d'une image, une fois le zoom (et son animation) terminé.
  var sharpenTimer = null;
  function resharpenSoon(animated) {
    clearTimeout(sharpenTimer);
    sharpenTimer = setTimeout(function () {
      plane.style.willChange = 'auto';
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { plane.style.willChange = ''; });
      });
    }, animated ? 380 : 180);
  }

  var MIN_FACTOR = 0.9, MAX_SCALE = 3;
  function refreshZoomButtons() {
    if (!zoomInBtn) return;
    zoomInBtn.disabled = view.s >= MAX_SCALE - 1e-6;
    zoomOutBtn.disabled = view.s <= fitScale() * MIN_FACTOR + 1e-6;
  }

  // La fiche du niveau flotte à côté de son nœud (à droite, ou à gauche si la place
  // manque), et le suit quand la carte bouge.
  function positionCard() {
    if (!card || card.hidden) return;
    var l = App.Levels.get(shownId());
    if (!l) return;
    var w = viewport.clientWidth, h = viewport.clientHeight;
    // Hauteur de la fiche sans « Jouer » (révélé au survol) : elle s'allonge vers le bas
    // sans remonter. `full` sert seulement à la garder dans l'écran une fois allongée.
    var actions = card.querySelector('.map-card-actions');
    var extra = actions ? actions.scrollHeight + 10 : 0;
    var cw = card.offsetWidth, ch = card.offsetHeight - (actions ? 10 + parseFloat(getComputedStyle(actions).marginTop) + actions.offsetHeight : 0);
    var nx = view.x + l.x * view.s, ny = view.y + l.y * view.s;
    var gap = 28 * Math.max(0.8, view.s);
    var right = nx + gap + cw <= w - 12;
    var left = right ? nx + gap : nx - gap - cw;
    left = Math.max(12, Math.min(w - cw - 12, left));
    var top = Math.max(74, Math.min(h - ch - extra - 12, ny - ch / 2));
    card.style.left = left + 'px';
    card.style.top = top + 'px';
    card.classList.toggle('on-left', !right);
    card.style.setProperty('--card-arrow-y', Math.max(18, Math.min(ch - 18, ny - top)) + 'px');
  }

  function fitScale() {
    var w = viewport.clientWidth || 1, h = viewport.clientHeight || 1;
    return Math.min(w / App.MapArt.W, h / App.MapArt.H);
  }

  function clampView() {
    var w = viewport.clientWidth, h = viewport.clientHeight;
    var mw = App.MapArt.W * view.s, mh = App.MapArt.H * view.s;
    var margin = 120;
    view.x = mw < w ? (w - mw) / 2 : Math.min(margin, Math.max(w - mw - margin, view.x));
    view.y = mh < h ? (h - mh) / 2 : Math.min(margin, Math.max(h - mh - margin, view.y));
  }

  function centerOn(x, y) {
    view.x = viewport.clientWidth / 2 - x * view.s;
    view.y = viewport.clientHeight / 2 - y * view.s;
    clampView();
    applyView();
  }

  function zoomAt(factor, cx, cy, animated) {
    var fit = fitScale();
    var s = Math.max(fit * MIN_FACTOR, Math.min(MAX_SCALE, view.s * factor));
    view.x = cx - (cx - view.x) * (s / view.s);
    view.y = cy - (cy - view.y) * (s / view.s);
    view.s = s;
    clampView();
    applyView(animated);
  }

  // ---- Construction ----
  // Du sol vers le ciel (voir mapArt.js pour le dessin, mapRaster.js pour les images) :
  // image du sol, des chemins et des niveaux ; SVG principal (chemin qui se trace, bateau
  // et moulin, niveaux et obstacles invisibles pour les clics, jeton, nuages qui
  // s'écartent) ; image des nuages et des panneaux ; SVG du dessus (symboles des
  // panneaux). Les SVG ne gardent que peu d'éléments visibles : glisser et zoomer restent
  // fluides.
  var layers = null, rasterClouds = [], rasterEdges = [];
  function buildLayers() {
    layers = {};
    ['edges', 'live', 'obstacles', 'nodes', 'pulse', 'token', 'clouds'].forEach(function (k) {
      layers[k] = el('g', { class: 'map-layer-' + k }, svg);
    });
    layers.labels = el('g', { class: 'map-layer-labels' }, topSvg);
    App.MapArt.buildLive(layers.live);
    // Panneaux : en image, sauf leur symbole (police KaTeX, inaccessible à une image).
    App.MapArt.buildLabels(layers.labels, 'mark');
    App.MapRaster.renderGround();
    App.MapRaster.renderLabels();
  }

  // Une pastille de niveau (sans écouteurs) : sert au SVG vivant et à l'image des niveaux.
  function drawNode(parent, l, cls, st, isFresh) {
    var g = el('g', { class: 'map-node ' + cls, transform: 'translate(' + l.x + ' ' + l.y + ')', 'data-level': l.id }, parent);
    var r = l.boss ? 21 : 17;
    el('ellipse', { cx: 0, cy: 8, rx: r + 3, ry: 6, class: 'map-node-shadow' }, g);
    if (l.boss) {
      el('path', { d: 'M' + (-r + 4) + ' -4V' + (-r - 20), class: 'map-node-pole' }, g);
      el('path', { d: 'M' + (-r + 4) + ' ' + (-r - 20) + 'l14 4.5l-14 4.5Z', class: 'map-node-flag' }, g);
    }
    el('circle', { cy: 5, r: r, class: 'map-node-side' }, g);
    el('circle', { r: r, class: 'map-node-body' }, g);
    var t = el('text', { class: 'map-node-label' }, g);
    t.textContent = l.daily ? '★' : App.Levels.code(l);
    if (st === 'locked' || isFresh) {
      // Le tremblement (transform CSS) est sur un groupe intérieur : sur celui qui porte
      // l'attribut transform, il l'écraserait et ramènerait le cadenas au centre du nœud.
      var lock = el('g', { class: 'map-node-lock', transform: 'translate(' + (l.boss ? 14 : 12) + ' ' + (l.boss ? -14 : -12) + ')' }, g);
      var shake = el('g', { class: 'map-node-lock-shake' }, lock);
      el('circle', { r: 7, class: 'map-node-lock-bg' }, shake);
      el('path', { d: 'M-3 0h6v4h-6zM-2 0v-2a2 2 0 0 1 4 0v2', class: 'map-node-lock-icon' }, shake);
    }
    if (st === 'done' && App.Levels.starred(l)) {
      var s = el('text', { class: 'map-node-stars', y: l.boss ? 38 : 34 }, g);
      var n = App.Progress.stars(l.id);
      s.textContent = '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n);
    }
    return g;
  }

  function buildWorld(opts) {
    var P = App.Progress;
    var fresh = (opts && opts.unlocked) || [];
    if (!layers) buildLayers();
    ['edges', 'obstacles', 'nodes', 'token', 'clouds', 'pulse'].forEach(function (k) { layers[k].innerHTML = ''; });

    // Nuages : une région encore fermée en est couverte (image, voir mapRaster.js) ; celle
    // qui s'ouvre à l'instant garde des nuages SVG, qui s'écartent (classe `revealed`, voir
    // playUnlock).
    rasterClouds = [];
    App.Levels.ZONES.forEach(function (z) {
      var freshZone = App.Levels.LEVELS.some(function (l) { return l.zone === z.id && fresh.indexOf(l.id) !== -1; }) &&
        !App.Levels.LEVELS.some(function (l) { return l.zone === z.id && fresh.indexOf(l.id) === -1 && P.isAvailable(l); });
      var fogged = !zoneOpen(z) || freshZone;
      var g = el('g', { class: 'map-zone map-zone-' + z.id + (fogged ? ' fogged' : ''), 'data-zone': z.id }, layers.clouds);
      if (freshZone) App.MapArt.drawClouds(g, z.id);
      else if (fogged) rasterClouds.push(z.id);
    });
    App.MapRaster.setClouds(rasterClouds);

    // Chemins : en image (mapRaster.js), sauf celui qui se trace à l'instant.
    rasterEdges = [];
    // Obstacles et niveaux : aussi en image (SVG détaché, voir drawNode).
    var rasterNodes = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    App.MapArt.edges().forEach(function (e) {
      var l = App.Levels.get(e.to);
      var state = P.isSolved(l.id) ? 'walked' : (P.isSolved(e.from) ? 'open' : 'locked');
      var drawIn = fresh.indexOf(l.id) !== -1 && opts && opts.from === e.from;
      if (!drawIn) rasterEdges.push({ edge: e, state: state });
      else {
        var g = App.MapArt.drawEdge(layers.edges, e, state, 'draw-in');
        // Tracé progressif : masque dont le trait se déroule (voir playUnlock).
        var id = 'map-reveal-' + e.key;
        var mask = el('mask', { id: id, maskUnits: 'userSpaceOnUse', x: -500, y: -500,
          width: App.MapArt.W + 1000, height: App.MapArt.H + 1000 }, layers.edges);
        el('path', { d: e.d, class: 'map-edge-reveal' }, mask);
        g.setAttribute('mask', 'url(#' + id + ')');
      }
      // Chemin entravé : le niveau d'arrivée attend encore d'autres prérequis.
      var waiting = l.req.filter(function (r) { return !P.isSolved(r); });
      if (l.req.length > 1 && (waiting.length || fresh.indexOf(l.id) !== -1) && !P.isSolved(l.id)) {
        var names = waiting.map(function (r) { return App.Levels.code(App.Levels.get(r)); });
        var title = names.length ? 'Réussis aussi ' + names.join(' et ') + ' pour passer' : 'Passage libre';
        var ob = App.MapArt.drawObstacle(layers.obstacles, e, title);
        if (fresh.indexOf(l.id) !== -1) ob.classList.add('will-clear');
        else App.MapArt.drawObstacle(rasterNodes, e, title);
      }
    });
    App.MapRaster.setEdges(rasterEdges);

    var cur = currentLevel();
    App.Levels.LEVELS.forEach(function (l) {
      var st = nodeState(l);
      var isFresh = fresh.indexOf(l.id) !== -1;
      var cls = (isFresh ? 'locked will-open' : st) + (l.boss ? ' boss' : '') + (selectedId === l.id ? ' selected' : '');
      var g = drawNode(layers.nodes, l, cls, st, isFresh);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', l.title);
      // Dans l'image des niveaux (mapRaster.js), sauf celui qui s'ouvre à l'instant : lui
      // reste dessiné en SVG, son état va changer sous les yeux.
      if (!isFresh) drawNode(rasterNodes, l, st + (l.boss ? ' boss' : ''), st, false);
      if (st === 'open' && !isFresh && cur && cur.id === l.id) {
        // Animation SVG (rayon, opacité) : la même en CSS (scale + transform-box) coûtait
        // une image sur deux pendant le glisser.
        var pulse = el('circle', { r: 18, class: 'map-node-pulse' }, el('g', { transform: 'translate(' + l.x + ' ' + l.y + ')' }, layers.pulse));
        el('animate', { attributeName: 'r', values: '18;34', dur: '1.8s', repeatCount: 'indefinite', calcMode: 'spline', keyTimes: '0;1', keySplines: '0 0 0.58 1' }, pulse);
        el('animate', { attributeName: 'opacity', values: '0.7;0', dur: '1.8s', repeatCount: 'indefinite', calcMode: 'spline', keyTimes: '0;1', keySplines: '0 0 0.58 1' }, pulse);
      }
      g.addEventListener('click', function (e) { e.stopPropagation(); toggle(l.id); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(l.id); }
      });
      g.addEventListener('mouseenter', function () { hover(l.id); });
      g.addEventListener('mouseleave', unhoverSoon);
    });
    App.MapRaster.setNodes(rasterNodes);

    var tokenAt = (opts && opts.from && App.Levels.get(opts.from)) || cur;
    if (tokenAt) {
      var tok = el('g', { class: 'map-token', transform: 'translate(' + tokenAt.x + ' ' + tokenAt.y + ')' }, layers.token);
      var inner = el('g', { transform: 'translate(0 -40)' }, tok);
      el('path', { d: 'M-5 11 L0 19 L5 11 Z', class: 'map-token-body' }, inner);
      el('circle', { r: 13, class: 'map-token-body' }, inner);
      var tx = el('text', { class: 'map-token-x' }, inner);
      tx.textContent = 'x';
    }
  }

  // Animation de retour d'un niveau réussi (voir open) : chemin tracé, cadenas qui
  // tremble puis disparaît, jeton qui avance, brouillard qui se lève.
  function playUnlock(opts) {
    var fresh = opts.unlocked || [];
    var target = fresh.length ? App.Levels.get(fresh[0]) : null;
    var delay = reducedMotion() ? 0 : 1;
    world.querySelectorAll('.map-edge-reveal').forEach(function (p) {
      var len = p.getTotalLength();
      p.style.strokeDasharray = len;
      p.style.strokeDashoffset = len;
      p.getBoundingClientRect();
      p.classList.add('drawing');
      p.style.strokeDashoffset = 0;
    });
    setTimeout(function () {
      fresh.forEach(function (id) {
        var n = world.querySelector('[data-level="' + id + '"]');
        if (n) n.classList.add('unlocking');
      });
    }, 850 * delay);
    setTimeout(function () {
      fresh.forEach(function (id) {
        var n = world.querySelector('[data-level="' + id + '"]');
        if (!n) return;
        n.classList.remove('locked', 'will-open', 'unlocking');
        world.querySelectorAll('.map-obstacle.will-clear').forEach(function (o) { o.classList.add('clearing'); });
        n.classList.add('open', 'just-opened');
        var lock = n.querySelector('.map-node-lock');
        if (lock) lock.remove();
      });
      moveToken(opts.from, target);
      world.querySelectorAll('.map-zone.fogged').forEach(function (z) {
        var zone = App.Levels.ZONES.filter(function (zz) { return zz.id === z.getAttribute('data-zone'); })[0];
        if (zone && zoneOpen(zone)) {
          z.classList.remove('fogged');
          z.classList.add('revealed');
          showBanner('Nouvelle région', zone.name + ' · ' + zone.sub);
        }
      });
    }, 1250 * delay);
    // Fin de l'animation : le jeton a fini d'avancer (voir moveToken).
    unlockTimer = setTimeout(function () {
      unlockTimer = null;
      if (opts.onUnlockEnd) opts.onUnlockEnd();
    }, (1350 + tokenTravelMs(opts.from, target)) * delay);
  }

  function tokenEdge(fromId, target) {
    if (!fromId || !target) return null;
    return App.MapArt.edges().filter(function (e) { return e.from === fromId && e.to === target.id; })[0] || null;
  }
  // Durée du trajet : proportionnelle à la longueur du chemin (la traversée en bateau est
  // plus longue qu'un pas d'une région).
  function tokenTravelMs(fromId, target) {
    var e = tokenEdge(fromId, target);
    if (!e) return 900;
    var len = 0;
    for (var i = 1; i < e.line.length; i++) len += Math.hypot(e.line[i][0] - e.line[i - 1][0], e.line[i][1] - e.line[i - 1][1]);
    return Math.round(Math.max(900, Math.min(2000, len * 5)));
  }
  // Le jeton suit le tracé du chemin (<animateMotion> : animation SVG cadencée sur
  // l'horloge du document, comme une transition CSS, pas sur requestAnimationFrame).
  function moveToken(fromId, target) {
    var tok = world.querySelector('.map-token');
    if (!tok || !target) return;
    var e = tokenEdge(fromId, target);
    var anim = el('animateMotion', {
      path: e ? e.d : '', dur: tokenTravelMs(fromId, target) + 'ms', begin: 'indefinite', fill: 'freeze',
      calcMode: 'spline', keyTimes: '0;1', keyPoints: '0;1', keySplines: '0.45 0.05 0.3 1'
    });
    if (!e || reducedMotion() || typeof anim.beginElement !== 'function') {
      tok.setAttribute('transform', 'translate(' + target.x + ' ' + target.y + ')');
      return;
    }
    tok.removeAttribute('transform');
    tok.appendChild(anim);
    anim.beginElement();
  }
  var unlockTimer = null;

  function showBanner(title, text) {
    var b = overlay.querySelector('.map-banner');
    b.querySelector('b').textContent = title;
    b.querySelector('span').textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(b._t);
    b._t = setTimeout(function () { b.classList.remove('show'); }, 2600);
  }

  // ---- Carte d'un niveau (au clic sur un nœud) ----
  // Un niveau verrouillé n'ouvre pas de fiche : son cadenas tremble, c'est tout.
  function select(id) {
    var l = App.Levels.get(id);
    if (l && nodeState(l) === 'locked') {
      var n = world.querySelector('.map-node[data-level="' + id + '"]');
      if (n) { n.classList.remove('unlocking'); void n.getBoundingClientRect(); n.classList.add('unlocking'); }
      id = null;
    }
    selectedId = id;
    pinned = !!id;
    hoverId = null;
    clearTimeout(hoverTimer);
    world.querySelectorAll('.map-node').forEach(function (n) {
      n.classList.toggle('selected', n.getAttribute('data-level') === id);
    });
    renderCard();
  }

  // Clic sur le nœud du niveau déjà fixé : ferme sa fiche, comme un clic à côté.
  function toggle(id) {
    select(pinned && selectedId === id ? null : id);
  }

  // Survol : aperçu de la fiche, tant qu'aucune n'est fixée. Le court délai à la sortie
  // laisse la souris passer du nœud à la fiche sans la fermer.
  function hover(id) {
    if (pinned || viewport.classList.contains('dragging')) return;
    var l = App.Levels.get(id);
    if (!l || nodeState(l) === 'locked') return;
    clearTimeout(hoverTimer);
    hoverId = id;
    renderCard();
  }
  function unhoverSoon() {
    if (pinned) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      if (pinned) return;
      hoverId = null;
      renderCard();
    }, 120);
  }

  // Ouverture/fermeture animées de la fiche (voir .map-card-in/.map-card-out dans
  // style.css) ; elle grandit depuis sa pointe, donc depuis le nœud.
  var cardTimer = null, cardShownFor = null;
  var CARD_OUT_MS = 160;
  function showCard(id) {
    clearTimeout(cardTimer);
    var wasHidden = card.hidden || card.classList.contains('map-card-out');
    card.classList.remove('map-card-out');
    card.hidden = false;
    if (wasHidden || cardShownFor !== id) {
      card.classList.remove('map-card-in');
      void card.offsetWidth;
      card.classList.add('map-card-in');
    }
    cardShownFor = id;
  }
  function hideCard(instant) {
    clearTimeout(cardTimer);
    cardShownFor = null;
    if (card.hidden) return;
    if (instant || reducedMotion()) { card.hidden = true; card.classList.remove('map-card-out'); return; }
    card.classList.remove('map-card-in');
    card.classList.add('map-card-out');
    cardTimer = setTimeout(function () { card.hidden = true; card.classList.remove('map-card-out'); }, CARD_OUT_MS);
  }

  function renderCard() {
    var l = App.Levels.get(shownId());
    if (!l || nodeState(l) === 'locked') { hideCard(); return; }
    // Fiche déjà affichée pour ce niveau (aperçu qu'on fixe d'un clic, retour du survol sur
    // le nœud…) : on garde son contenu pour que « Jouer » apparaisse/disparaisse avec la
    // transition de .map-card-actions, au lieu d'être reconstruit directement dans son
    // état final.
    if (cardShownFor === l.id && !card.hidden && !card.classList.contains('map-card-out')) {
      card.classList.toggle('map-card-pinned', pinned);
      return;
    }
    var P = App.Progress;
    var st = nodeState(l);
    var z = App.Levels.zone(l.zone);
    card.innerHTML = '';
    function div(cls, text, parent) {
      var d = document.createElement('div');
      d.className = cls;
      if (text !== undefined) d.textContent = text;
      (parent || card).appendChild(d);
      return d;
    }
    div('map-card-zone', z.name + ' · ' + z.sub);
    div('map-card-title', l.title);
    var eqBox = div('map-card-eq');
    var latexes = l.daily ? [] : App.Levels.partsOf(l).map(function (p) { return p.latex; });
    if (l.daily) {
      eqBox.textContent = 'Une nouvelle équation chaque jour';
    } else {
      latexes.forEach(function (lx) {
        var one = div('map-card-eq-line', undefined, eqBox);
        try { window.katex.render(lx, one, { throwOnError: false }); } catch (e) { one.textContent = lx; }
      });
    }
    if (l.daily && P.dailyDoneToday()) {
      var meta = div('map-card-meta');
      var done = document.createElement('span');
      done.textContent = 'Réussi aujourd\'hui';
      meta.appendChild(done);
    }
    var actions = div('map-card-actions');
    var play = document.createElement('button');
    play.type = 'button';
    play.className = 'map-play-btn';
    play.setAttribute('data-map-play', l.id);
    play.textContent = st === 'done' && !l.daily ? 'Rejouer' : 'Jouer';
    play.addEventListener('click', function () { if (onPlay) onPlay(l.id); });
    // Enveloppe sans padding : elle peut se replier à 0 (voir .map-card-actions).
    var fold = document.createElement('div');
    fold.appendChild(play);
    actions.appendChild(fold);
    card.classList.toggle('map-card-pinned', pinned);
    showCard(l.id);
    positionCard();
  }

  function renderBar() {
    var P = App.Progress;
    var top = App.Levels.LEVELS.filter(function (l) { return l.daily; })[0];
    var daily = overlay.querySelector('[data-map-daily]');
    daily.hidden = !(top && P.isAvailable(top));
    daily.textContent = P.dailyDoneToday() ? 'Défi du jour ✓' : 'Défi du jour';
    overlay.querySelector('[data-map-stars]').textContent = P.totalStars();
    overlay.querySelector('[data-map-max]').textContent = P.maxStars();
    overlay.querySelector('[data-map-badges]').textContent = P.badges().length;
  }

  function renderBadges() {
    var owned = App.Progress.badges();
    badgePanel.innerHTML = '';
    App.Levels.BADGES.forEach(function (b) {
      var row = document.createElement('div');
      row.className = 'map-badge' + (owned.indexOf(b.id) !== -1 ? ' owned' : '');
      var ico = document.createElement('span');
      ico.className = 'map-badge-ico';
      ico.textContent = b.mark;
      var txt = document.createElement('span');
      txt.innerHTML = '<b></b><br><small></small>';
      txt.querySelector('b').textContent = b.name;
      txt.querySelector('small').textContent = b.desc;
      row.appendChild(ico);
      row.appendChild(txt);
      badgePanel.appendChild(row);
    });
  }

  // opts : { focus: id, from: id réussi, unlocked: [ids qui viennent de s'ouvrir],
  //         noCard: pas de fiche ouverte, instant: pas d'animation d'ouverture }
  function open(opts) {
    opts = opts || {};
    if (closing) { clearTimeout(closeTimer); closing = false; overlay.classList.remove('map-closing'); }
    overlay.hidden = false;
    document.body.classList.add('map-open');
    // Animation d'ouverture (voir .map-opening dans style.css), sauf au lancement de
    // l'application (opts.instant) : la carte est là d'emblée.
    overlay.classList.remove('map-opening');
    if (!opts.instant) {
      void overlay.offsetWidth;
      overlay.classList.add('map-opening');
    }
    if (App.Coach) App.Coach.refresh();
    App.Progress.setLastScreen('map');
    badgePanel.hidden = true;
    var focus = App.Levels.get(opts.focus) || (opts.unlocked && opts.unlocked.length && App.Levels.get(opts.unlocked[0])) ||
      App.Levels.get(opts.from) || currentLevel() || App.Levels.LEVELS[0];
    selectedId = focus.id;
    pinned = true;
    hoverId = null;
    buildWorld(opts);
    renderBar();
    view.s = Math.max(fitScale(), Math.min(1.5, fitScale() * 1.9));
    centerOn(focus.x, focus.y);
    clearTimeout(unlockTimer);
    unlockTimer = null;
    if (opts.unlocked && opts.unlocked.length) {
      // La fiche du niveau débloqué n'apparaît qu'une fois l'animation terminée (sauf si
      // `onUnlockEnd` prend le relais, ex. « Suivant » qui lance directement le niveau).
      hideCard(true);
      world.querySelectorAll('.map-node.selected').forEach(function (n) { n.classList.remove('selected'); });
      var then = opts.onUnlockEnd;
      opts.onUnlockEnd = function () {
        // Carte fermée ou autre nœud choisi entre-temps : on ne prend pas la main.
        if (!isOpen() || selectedId !== focus.id) return;
        if (then) then();
        else select(focus.id);
      };
      playUnlock(opts);
    } else if (opts.noCard) {
      // Niveau refait (rien de débloqué) : la carte se centre dessus, sans ouvrir sa fiche.
      select(null);
    } else renderCard();
  }

  // Fermeture animée (voir .map-closing dans style.css) : la carte n'est plus "ouverte"
  // dès l'appel (isOpen, body.map-open, clics qui traversent), le calque disparaît à la
  // fin de l'animation.
  var closeTimer = null, closing = false;
  var CLOSE_MS = 260;
  function close() {
    if (overlay.hidden || closing) return;
    clearTimeout(unlockTimer);
    unlockTimer = null;
    document.body.classList.remove('map-open');
    if (App.Coach) App.Coach.refresh();
    if (reducedMotion()) { finishClose(); return; }
    closing = true;
    overlay.classList.remove('map-opening');
    overlay.classList.add('map-closing');
    closeTimer = setTimeout(finishClose, CLOSE_MS);
  }
  function finishClose() {
    clearTimeout(closeTimer);
    closing = false;
    overlay.classList.remove('map-closing');
    overlay.hidden = true;
    hideCard(true);
  }

  function isOpen() { return !!overlay && !overlay.hidden && !closing; }

  function initPanZoom() {
    var drag = null;
    viewport.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        // Glisser la carte ferme la fiche (fixée ou aperçu).
        if (selectedId || hoverId) select(null);
      }
      if (!drag.moved) return;
      viewport.classList.add('dragging');
      view.x = drag.vx + dx;
      view.y = drag.vy + dy;
      clampView();
      applyView();
    });
    window.addEventListener('mouseup', function () {
      if (drag && drag.moved) {
        // Le "click" qui suit un glisser ne doit pas sélectionner le nœud d'arrivée.
        var swallow = function (ev) { ev.stopPropagation(); window.removeEventListener('click', swallow, true); };
        window.addEventListener('click', swallow, true);
        setTimeout(function () { window.removeEventListener('click', swallow, true); }, 0);
      }
      drag = null;
      viewport.classList.remove('dragging');
    });
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = viewport.getBoundingClientRect();
      // Comme le canevas (voir initCanvasPan dans main.js) : Ctrl + molette zoome,
      // la molette seule déplace.
      if (e.ctrlKey) {
        zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - rect.left, e.clientY - rect.top);
        return;
      }
      view.x -= e.deltaX;
      view.y -= e.deltaY;
      clampView();
      applyView();
    }, { passive: false });
    // Mêmes loupes, même pas et même animation que le zoom du canevas (voir zoom.js).
    zoomInBtn = overlay.querySelector('[data-map-zoom="in"]');
    zoomOutBtn = overlay.querySelector('[data-map-zoom="out"]');
    zoomInBtn.innerHTML = App.Zoom.ZOOM_IN_SVG;
    zoomOutBtn.innerHTML = App.Zoom.ZOOM_OUT_SVG;
    zoomInBtn.addEventListener('click', function () {
      if (!zoomInBtn.disabled) zoomAt(App.Zoom.ZOOM_STEP, viewport.clientWidth / 2, viewport.clientHeight / 2, true);
    });
    zoomOutBtn.addEventListener('click', function () {
      if (!zoomOutBtn.disabled) zoomAt(1 / App.Zoom.ZOOM_STEP, viewport.clientWidth / 2, viewport.clientHeight / 2, true);
    });
    window.addEventListener('resize', function () { if (isOpen()) { clampView(); applyView(); } });
  }

  // Changement de thème : les images de la carte sont refaites avec les nouvelles couleurs.
  function watchTheme() {
    function redraw() {
      App.MapRaster.invalidate();
      if (!layers) return;
      App.MapRaster.renderGround();
      App.MapRaster.renderLabels();
      App.MapRaster.setEdges(rasterEdges);
      App.MapRaster.setNodes(null);
      App.MapRaster.setClouds(rasterClouds);
      App.MapRaster.updateDetail(view, viewport.clientWidth, viewport.clientHeight);
    }
    new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (window.matchMedia) {
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.addEventListener) mq.addEventListener('change', redraw);
    }
  }

  function init(options) {
    onPlay = options && options.onPlay;
    overlay = document.getElementById('mapOverlay');
    viewport = overlay.querySelector('.map-viewport');
    plane = overlay.querySelector('.map-world');
    svg = overlay.querySelector('svg.map-svg');
    svg.setAttribute('width', App.MapArt.W);
    svg.setAttribute('height', App.MapArt.H);
    topSvg = el('svg', { class: 'map-svg map-svg-top', width: App.MapArt.W, height: App.MapArt.H, 'aria-hidden': 'true' }, plane);
    App.MapRaster.init(plane, svg, topSvg);
    // Toutes les recherches de nœuds, chemins, nuages… se font dans le plan entier.
    world = plane;
    App.MapArt.injectStyles();
    watchTheme();
    card = overlay.querySelector('.map-card');
    card.addEventListener('mouseenter', function () { clearTimeout(hoverTimer); });
    card.addEventListener('mouseleave', unhoverSoon);
    badgePanel = overlay.querySelector('.map-badges');
    initPanZoom();
    overlay.querySelector('[data-map-free]').addEventListener('click', function () {
      close();
      App.Progress.setLastScreen('free');
      if (options && options.onFree) options.onFree();
    });
    overlay.querySelector('[data-map-daily]').addEventListener('click', function () {
      var top = App.Levels.LEVELS.filter(function (l) { return l.daily; })[0];
      select(top.id);
      centerOn(top.x, top.y);
    });
    overlay.querySelector('[data-map-badges-btn]').addEventListener('click', function () {
      renderBadges();
      badgePanel.hidden = !badgePanel.hidden;
    });
    // Un clic à côté (fond de la carte, pas un glisser) ferme la fiche du niveau et le
    // panneau des badges ; un clic sur un nœud, lui, ne remonte pas jusqu'ici.
    viewport.addEventListener('click', function () {
      badgePanel.hidden = true;
      if (!card.hidden && cardShownFor) select(null);
    });
    document.addEventListener('keydown', function (e) {
      // Échap ferme la carte et ramène à l'équation en cours (sauf si les réglages sont
      // ouverts par-dessus : c'est eux qu'Échap ferme alors).
      if (e.key !== 'Escape' || !isOpen()) return;
      var settings = document.getElementById('settingsOverlay');
      if (settings && !settings.hidden) return;
      e.preventDefault();
      close();
    });
    App.Progress.subscribe(function () { if (isOpen()) renderBar(); });
  }

  App.Map = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    select: function (id) { select(id); },
    view: function () { return { x: view.x, y: view.y, s: view.s }; }
  };
})(window.App = window.App || {});
