/* MapArt : le dessin de "La Carte des équations" (map.js garde l'interaction).
   Style flat, sol vu de dessus et décors vus de 3/4 :
   - deux îles avec leur tranche de falaise : celle du Port (tutoriel) et la grande île,
     reliées par une traversée en bateau ;
   - les régions de la grande île sont calculées sur une grille (BIOME_CELL) : chaque case
     revient au germe le plus proche (les niveaux de la région, plus quelques ANCHORS), la
     distance étant perturbée par un bruit propre à chaque région, d'où des frontières
     irrégulières et entremêlées ; les contours sont ensuite lissés ;
   - les décors sont semés de façon déterministe (graine fixe) hors des chemins, des
     niveaux, des panneaux et des monuments (LANDMARKS), puis triés par profondeur ;
   - toutes les couleurs passent par des classes CSS (variables --m-*, voir style.css),
     redéfinies pour la version nuit du thème sombre.
   La géométrie est calculée une seule fois (geometry()) ; map.js construit le calque
   statique une fois et ne reconstruit que chemins, nœuds et nuages. */
(function (App) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var W = 2420, H = 1160;

  // ---- Géographie ----
  // Contours de base des îles (lissés et bruités à la construction).
  var ISLANDS = [
    { id: 'port', seed: 11, amp: 14, pts: [[120, 700], [135, 580], [190, 490], [300, 450], [420, 465], [515, 510],
      [550, 590], [505, 680], [430, 770], [340, 850], [225, 875], [140, 815]] },
    { id: 'main', seed: 23, amp: 24, pts: [[760, 420], [800, 300], [900, 215], [1010, 160], [1130, 118], [1290, 100],
      [1450, 112], [1570, 140], [1690, 150], [1810, 140], [1930, 165], [2040, 225], [2140, 300], [2240, 385],
      [2310, 490], [2350, 610], [2345, 735], [2290, 815], [2180, 860], [2060, 915], [1960, 960], [1850, 1010],
      [1720, 1040], [1560, 1052], [1420, 1068], [1280, 1045], [1150, 1005], [1020, 965], [900, 905], [800, 825],
      [748, 720], [735, 600], [742, 500]] }
  ];

  // Germes des régions en plus de leurs niveaux, pour leur donner du territoire.
  var ANCHORS = {
    plaine: [[770, 640], [800, 740], [890, 820], [960, 560], [1000, 650], [1110, 670], [880, 510]],
    foret: [[800, 360], [830, 260], [940, 215], [1060, 165], [1190, 150], [990, 420], [1130, 300], [1300, 140]],
    coll: [[920, 880], [1030, 960], [1160, 960], [1240, 1010], [1340, 1000], [1470, 1015], [1560, 1000]],
    mont: [[1230, 610], [1310, 660], [1440, 590], [1560, 610], [1250, 470], [1560, 470], [1150, 500]],
    grotte: [[1250, 340], [1290, 290], [1410, 400], [1480, 330], [1400, 210], [1300, 220]],
    source: [[1400, 750], [1400, 900], [1520, 870], [1250, 780], [1560, 770]],
    marais: [[1540, 230], [1660, 440], [1800, 300], [1910, 380], [1680, 180], [1800, 185], [1910, 220], [1660, 540], [1560, 330]],
    cit: [[1600, 900], [1700, 980], [1850, 950], [1960, 870], [1720, 790], [1860, 720], [2010, 800], [1560, 820]],
    obs: [[2060, 380], [2200, 390], [2270, 470], [2100, 560], [2040, 650], [2090, 720], [2000, 460]],
    som: [[2300, 600], [2250, 790], [2330, 700], [2180, 760]]
  };

  // Chemins : points de passage imposés (évite les croisements) et type de chemin.
  var EDGE_VIA = {
    't7-l1': [[580, 552], [700, 540]],
    'f3-m1': [[1170, 185], [1330, 165], [1490, 190], [1555, 305]],
    'iB-s1': [[1390, 992], [1550, 945]]
  };
  var PATH_KIND = { port: 'dirt', plaine: 'dirt', foret: 'trail', coll: 'dirt', mont: 'stone', grotte: 'stone',
    source: 'plank', marais: 'plank', cit: 'road', obs: 'road', som: 'stone' };
  var EDGE_KIND = { 't7-l1': 'sea', 'f3-m1': 'road', 'iB-s1': 'road' };

  // Panneaux des régions (centre).
  var LABELS = {
    port: [330, 470], plaine: [820, 850], foret: [900, 180], coll: [1110, 1010], mont: [1250, 640],
    grotte: [1300, 190], source: [1320, 900], marais: [1780, 175], cit: [1830, 980], obs: [2150, 330], som: [2270, 820]
  };

  var LAKES = [{ x: 1400, y: 742, rx: 46, ry: 24 }];
  var RIVERS = [[[1438, 752], [1462, 815], [1452, 900], [1470, 985], [1462, 1070]]];

  // Monuments dessinés à la main (base au sol en x, y).
  var LANDMARKS = [
    { type: 'lighthouse', x: 172, y: 560, r: 26 },
    { type: 'house', x: 392, y: 672, s: 1.1, r: 18 }, { type: 'house', x: 430, y: 700, s: 0.95, r: 16 },
    { type: 'house', x: 365, y: 712, s: 0.9, r: 16 },
    { type: 'pier', x: 540, y: 572, len: 58, ground: true },
    { type: 'pier', x: 745, y: 546, len: -52, ground: true },
    { type: 'boat', x: 1040, y: 62, s: 0.8, sea: true }, { type: 'boat', x: 2395, y: 470, s: 0.9, sea: true },
    { type: 'windmill', x: 985, y: 690, r: 30 },
    { type: 'field', x: 900, y: 690, ground: true, r: 0 },
    { type: 'cabin', x: 960, y: 255, r: 20 },
    { type: 'farm', x: 1120, y: 990, r: 22 },
    { type: 'cave', x: 1290, y: 310, s: 1.1, r: 26 }, { type: 'cave', x: 1455, y: 420, s: 0.9, r: 22 },
    { type: 'castle', x: 1718, y: 808, r: 40 },
    { type: 'hut', x: 1795, y: 575, r: 20 },
    { type: 'observatory', x: 2128, y: 530, r: 34 },
    { type: 'bigpeak', x: 2282, y: 672, r: 40 },
    { type: 'spring', x: 1352, y: 752, r: 14 }
  ];

  // Décors semés par région : pas de la grille et tirage pondéré.
  var DECOR = {
    port: { step: 34, items: [['palm', 3], ['bush', 2], ['tuft', 5], ['flowers', 2], ['rock', 1]] },
    plaine: { step: 34, items: [['tree', 3], ['bush', 3], ['tuft', 6], ['flowers', 4]] },
    foret: { step: 24, items: [['tree', 5], ['pine', 6], ['bush', 1], ['mushroom', 1]] },
    coll: { step: 38, items: [['hill', 5], ['bush', 2], ['tuft', 3], ['sheep', 2], ['tree', 1]] },
    mont: { step: 44, items: [['peak', 7], ['rock', 3], ['pine', 1]] },
    grotte: { step: 34, items: [['boulders', 4], ['crystal', 3], ['rock', 2]] },
    source: { step: 32, items: [['reeds', 2], ['bush', 2], ['tree', 3], ['tuft', 3], ['flowers', 3]] },
    marais: { step: 30, items: [['reeds', 5], ['puddle', 4], ['deadtree', 2], ['tuft', 2]] },
    cit: { step: 36, items: [['house', 3], ['bush', 2], ['tuft', 2], ['tree', 1]] },
    obs: { step: 38, items: [['rock', 2], ['pine', 2], ['tuft', 2], ['crystal', 1]] },
    som: { step: 42, items: [['snowpeak', 5], ['rock', 2]] }
  };

  // Règles de dessin de la carte (couleurs : variables --m-* de style.css, jour et nuit).
  // Elles vivent ici plutôt que dans style.css parce que mapRaster.js doit aussi les
  // intégrer dans les images qu'il dessine, et qu'une page ouverte en file:// ne peut pas
  // relire ses propres feuilles de style. injectStyles() les ajoute à la page.
  var MAP_CSS = [
    '.m-night { display: none; }',
    '.m-wave { fill: none; stroke: var(--m-wave); stroke-width: 1.6; stroke-linecap: round; }',
    '.m-star { fill: #fff; opacity: 0.6; }',
    '.m-shallow { fill: var(--m-shallow); stroke: var(--m-shallow); stroke-width: 44; stroke-linejoin: round; }',
    '.m-cliff1 { fill: var(--m-cliff1); }',
    '.m-cliff2 { fill: var(--m-cliff2); }',
    '.m-cliff-line { fill: none; stroke: var(--m-cliff-line); stroke-width: 2; opacity: 0.5; }',
    '.m-beach { fill: var(--m-sand); stroke: var(--m-sand); stroke-width: 16; stroke-linejoin: round; }',
    '.m-grass { fill: var(--m-grass); stroke: var(--m-sand); stroke-width: 0; }',
    '.m-beach-inner { fill: none; stroke: var(--m-sand); stroke-width: 12; stroke-linejoin: round; }',
    '.m-biome { stroke-width: 2; }',
    '.m-z-port { fill: var(--m-z-port); stroke: var(--m-z-port); }',
    '.m-z-plaine { fill: var(--m-z-plaine); stroke: var(--m-z-plaine); }',
    '.m-z-foret { fill: var(--m-z-foret); stroke: var(--m-z-foret); }',
    '.m-z-coll { fill: var(--m-z-coll); stroke: var(--m-z-coll); }',
    '.m-z-mont { fill: var(--m-z-mont); stroke: var(--m-z-mont); }',
    '.m-z-grotte { fill: var(--m-z-grotte); stroke: var(--m-z-grotte); }',
    '.m-z-source { fill: var(--m-z-source); stroke: var(--m-z-source); }',
    '.m-z-marais { fill: var(--m-z-marais); stroke: var(--m-z-marais); }',
    '.m-z-cit { fill: var(--m-z-cit); stroke: var(--m-z-cit); }',
    '.m-z-obs { fill: var(--m-z-obs); stroke: var(--m-z-obs); }',
    '.m-z-som { fill: var(--m-z-som); stroke: var(--m-z-som); }',
    '.m-tex-dark { fill: var(--m-tex-dark); }',
    '.m-tex-light { fill: var(--m-tex-light); }',
    '.m-tex-faint { fill: var(--m-tex-dark); opacity: 0.45; }',
    '.m-tex-stroke { fill: none; stroke: var(--m-tex-dark); stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }',
    '.m-tex-line { fill: none; stroke: var(--m-tex-dark); stroke-width: 1.3; stroke-linecap: round; }',
    '.m-water { fill: var(--m-water); }',
    '.m-water-line { fill: none; stroke: var(--m-water-hi); stroke-width: 1.6; stroke-linecap: round; }',
    '.m-water-jet { fill: none; stroke: var(--m-water-hi); stroke-width: 2.4; stroke-linecap: round; }',
    '.m-lake-rim { fill: var(--m-sand); }',
    '.m-foam { fill: var(--m-foam); opacity: 0.8; }',
    '.m-river-bank { fill: none; stroke: var(--m-sand); stroke-width: 15; stroke-linecap: round; stroke-linejoin: round; }',
    '.m-river { fill: none; stroke: var(--m-water); stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }',
    '.m-murk { fill: var(--m-murk); }',
    '.m-field { fill: var(--m-field); }',
    '.m-field-line { stroke: var(--m-field-line); stroke-width: 1.5; }',
    '.m-shadow { fill: var(--m-shadow); }',
    '.m-leaf { fill: var(--m-leaf); } .m-leaf-dk { fill: var(--m-leaf-dk); } .m-leaf-hi { fill: var(--m-leaf-hi); }',
    '.m-pine { fill: var(--m-pine); } .m-pine-hi { fill: var(--m-pine-hi); }',
    '.m-trunk { fill: var(--m-trunk); }',
    '.m-bush { fill: var(--m-bush); } .m-bush-hi { fill: var(--m-bush-hi); }',
    '.m-tuft { fill: none; stroke: var(--m-tuft); stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }',
    '.m-flower-a { fill: var(--m-flower-a); } .m-flower-b { fill: var(--m-flower-b); } .m-flower-c { fill: var(--m-flower-c); }',
    '.m-rock { fill: var(--m-rock); } .m-rock-dk { fill: var(--m-rock-dk); }',
    '.m-peak { fill: var(--m-peak); } .m-peak-dk { fill: var(--m-peak-dk); }',
    '.m-snow { fill: var(--m-snow); } .m-snow-dk { fill: var(--m-snow-dk); }',
    '.m-hill { fill: var(--m-hill); } .m-hill-dk { fill: var(--m-hill-dk); }',
    '.m-wall { fill: var(--m-wall); } .m-wall-dk { fill: var(--m-wall-dk); }',
    '.m-roof { fill: var(--m-roof); } .m-roof-dk { fill: var(--m-roof-dk); } .m-roof-b { fill: var(--m-roof-b); }',
    '.m-door { fill: var(--m-door); } .m-window { fill: var(--m-window); } .m-stripe { fill: var(--m-stripe); }',
    '.m-stone { fill: var(--m-stone); } .m-stone-dk { fill: var(--m-stone-dk); } .m-flag { fill: var(--m-flag); }',
    '.m-wood { fill: var(--m-wood); } .m-wood-dk { fill: var(--m-wood-dk); } .m-thatch { fill: var(--m-thatch); }',
    '.m-barn { fill: var(--m-barn); } .m-barn-dk { fill: var(--m-barn-dk); }',
    '.m-barn-line { fill: none; stroke: var(--m-wall); stroke-width: 1.2; }',
    '.m-plank-line { stroke: var(--m-wood-dk); stroke-width: 1; }',
    '.m-rail { stroke: var(--m-wood-dk); stroke-width: 2.4; stroke-linecap: round; }',
    '.m-reed { fill: none; stroke: var(--m-reed); stroke-width: 1.5; stroke-linecap: round; }',
    '.m-cattail { fill: var(--m-cattail); }',
    '.m-deadwood { fill: none; stroke: var(--m-deadwood); stroke-width: 2.2; stroke-linecap: round; }',
    '.m-lily { fill: var(--m-lily); }',
    '.m-crystal { fill: var(--m-crystal); } .m-crystal-hi { fill: var(--m-crystal-hi); }',
    '.m-cave { fill: var(--m-cave); }',
    '.m-sheep { fill: var(--m-sheep); } .m-sheep-head { fill: var(--m-sheep-head); }',
    '.m-sheep-leg { stroke: var(--m-sheep-head); stroke-width: 1.4; }',
    '.m-mush { fill: var(--m-mush); }',
    '.m-dome { fill: var(--m-dome); } .m-dome-dk { fill: var(--m-dome-dk); }',
    '.m-scope { stroke: var(--m-scope); stroke-width: 4; stroke-linecap: round; }',
    '.m-hull { fill: var(--m-hull); } .m-sail { fill: var(--m-sail); } .m-sail-dk { fill: var(--m-sail-dk); }',
    '.m-mast { fill: none; stroke: var(--m-mast); stroke-width: 1.6; stroke-linecap: round; }',
    '.m-lamp { fill: var(--m-lamp); }',
    '.m-beam { fill: var(--m-lamp); opacity: 0.22; }',
    '.map-sky-cloud { opacity: 0.85; }',
    '.m-gull { fill: none; stroke: var(--m-gull); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }',
    '.m-sparkle { fill: var(--m-sparkle); }',
    '.m-water-streak { fill: none; stroke: var(--m-water-hi); stroke-width: 1.8; stroke-linecap: round; }',
    '.m-smoke { fill: var(--m-smoke); }',
    '.m-palm-trunk { fill: none; stroke: var(--m-trunk); stroke-width: 3; stroke-linecap: round; }',
    '.m-palm-leaf { fill: none; stroke: var(--m-leaf-hi); stroke-width: 4; stroke-linecap: round; }',
    '.m-palm-leaf-dk { fill: none; stroke: var(--m-leaf); stroke-width: 4; stroke-linecap: round; }',
    '.m-windmill-blades { animation: map-spin 14s linear infinite; }',
    '.m-sign { fill: var(--m-sign); }',
    '.m-sign-sh { fill: var(--m-sign-sh); }',
    '.map-edge-dirt .m-p-edge { stroke: var(--m-p-dirt-edge); } .map-edge-dirt .m-p-fill { stroke: var(--m-p-dirt); }',
    '.map-edge-trail .m-p-edge { stroke: var(--m-p-trail-edge); } .map-edge-trail .m-p-fill { stroke: var(--m-p-trail); }',
    '.map-edge-trail .m-p-dots { stroke: var(--m-p-trail-edge); stroke-dasharray: 0 9; stroke-width: 3.2 !important; opacity: 0.6; }',
    '.map-edge-stone .m-p-edge { stroke: var(--m-p-stone-edge); stroke-dasharray: 0.1 12.5; }',
    '.map-edge-stone .m-p-fill { stroke: var(--m-p-stone); stroke-dasharray: 0.1 12.5; }',
    '.map-edge-plank .m-p-edge { stroke: var(--m-p-plank-edge); } .map-edge-plank .m-p-fill { stroke: var(--m-p-plank); }',
    '.map-edge-plank .m-p-steps { stroke: var(--m-p-plank-edge); stroke-dasharray: 1.2 4.2; stroke-linecap: butt !important; }',
    '.map-edge-road .m-p-edge { stroke: var(--m-p-road-edge); } .map-edge-road .m-p-fill { stroke: var(--m-p-road); }',
    '.map-edge-road .m-p-line { stroke: var(--m-p-road-line); stroke-dasharray: 7 7; stroke-linecap: butt !important; }',
    '.map-edge-sea .m-p-line { stroke: var(--m-p-sea); stroke-dasharray: 2 9; }',
    '.m-bridge rect { stroke: none; }',
    '.m-barrier { fill: var(--m-barrier); }',
    '.m-barrier-stripe { fill: none; stroke: var(--m-barrier-stripe); stroke-width: 2.6; }',
    '.m-post { fill: none; stroke: var(--m-post); stroke-width: 2.4; stroke-linecap: round; }',
    '.m-cloud { fill: var(--m-cloud); }',
    '.m-cloud-sh { fill: var(--m-cloud-sh); }'
,
    '.map-edge path { fill: none; stroke-linecap: round; stroke-linejoin: round; }',
    '.map-edge.locked { opacity: 0.4; }'
,
    '.map-sign { pointer-events: none; }',
    '.map-sign-mark { font: italic 700 13px "KaTeX_Math", "Times New Roman", serif; fill: var(--text); text-anchor: middle; dominant-baseline: central; opacity: 0.75; }',
    '.map-sign-mark.long { font-size: 8.5px; }',
    '.map-zone-name { font: 700 13px "Inter", sans-serif; fill: var(--text); }',
    '.map-zone-sub { font: 500 10px "Inter", sans-serif; fill: var(--text-muted); }',
    '.map-obstacle { cursor: help; }',
    '.map-obstacle-inner { transition: transform 0.5s ease, opacity 0.5s ease; transform-box: fill-box; transform-origin: center; }',
    '.map-obstacle.clearing .map-obstacle-inner { transform: translate(0, 10px) scale(0.6); opacity: 0; }',
    '.map-node { cursor: pointer; outline: none; }',
    '.map-node-shadow { fill: var(--m-shadow); }',
    '.map-node-body { stroke-width: 3; transition: fill 0.3s ease, stroke 0.3s ease; }',
    '.map-node-side { transition: fill 0.3s ease; }',
    '.map-node.done .map-node-body { fill: var(--success-soft); stroke: var(--m-node-side-done); }',
    '.map-node.done .map-node-side { fill: var(--m-node-side-done); }',
    '.map-node.open .map-node-body { fill: var(--surface); stroke: var(--m-node-side-open); }',
    '.map-node.open .map-node-side { fill: var(--m-node-side-open); }',
    '.map-node.open.boss .map-node-body { fill: var(--warning-soft); stroke: var(--m-node-side-boss); }',
    '.map-node.open.boss .map-node-side { fill: var(--m-node-side-boss); }',
    '.map-node.locked .map-node-body { fill: var(--m-node-locked); stroke: var(--m-node-side-locked); }',
    '.map-node.locked .map-node-side { fill: var(--m-node-side-locked); }',
    '.map-node.selected .map-node-body { stroke-width: 5; }',
    '.map-node:focus-visible .map-node-body { stroke-width: 5; stroke: var(--accent); }',
    '.map-node-pole { stroke: var(--m-mast); stroke-width: 2; stroke-linecap: round; }',
    '.map-node-flag { fill: var(--m-flag); }',
    '.map-node.locked .map-node-flag { fill: var(--m-node-side-locked); }',
    '.map-node-label { font: 700 11px "Inter", sans-serif; text-anchor: middle; dominant-baseline: central; fill: var(--text); pointer-events: none; }',
    '.map-node.locked .map-node-label { fill: var(--text-faint); }',
    '.map-node-stars { font-size: 11px; text-anchor: middle; fill: var(--star); letter-spacing: 1px; pointer-events: none; paint-order: stroke; stroke: var(--m-halo); stroke-width: 3px; stroke-linejoin: round; }',
    '.map-node-lock-bg { fill: var(--surface); stroke: var(--m-node-side-locked); stroke-width: 1.5; }',
    '.map-node-lock-icon { fill: none; stroke: var(--text-muted); stroke-width: 1.4; stroke-linejoin: round; }',
    '.map-node.unlocking .map-node-lock-shake { animation: map-lock-shake 0.35s ease; transform-box: fill-box; transform-origin: center; }',
    '.map-node.just-opened .map-node-body { animation: map-pop 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); transform-box: fill-box; transform-origin: center; }',
    '.map-node-pulse { fill: none; stroke: var(--accent); stroke-width: 2; pointer-events: none; }'
  ].join('\n');

  function injectStyles() {
    if (document.getElementById('map-art-style')) return;
    var st = document.createElement('style');
    st.id = 'map-art-style';
    st.textContent = MAP_CSS;
    document.head.appendChild(st);
  }

  // ---- Outils ----
  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k) && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function f1(v) { return Math.round(v * 10) / 10; }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(ix, iy, seed) {
    var h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // Bruit de valeur lissé dans [-1, 1].
  function noise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy) * 2 - 1;
  }
  function fbm(x, y, seed) { return noise(x, y, seed) * 0.67 + noise(x * 2.3, y * 2.3, seed + 7) * 0.33; }

  // Spline de Catmull-Rom → segments cubiques [p0, c1, c2, p1].
  function splineSegments(pts, closed) {
    var n = pts.length, segs = [];
    var count = closed ? n : n - 1;
    function at(i) {
      if (closed) return pts[(i + n) % n];
      return pts[Math.max(0, Math.min(n - 1, i))];
    }
    for (var i = 0; i < count; i++) {
      var p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      segs.push([p1, [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
        [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6], p2]);
    }
    return segs;
  }
  function segmentsD(segs, closed) {
    var d = 'M' + f1(segs[0][0][0]) + ' ' + f1(segs[0][0][1]);
    segs.forEach(function (s) {
      d += 'C' + f1(s[1][0]) + ' ' + f1(s[1][1]) + ' ' + f1(s[2][0]) + ' ' + f1(s[2][1]) + ' ' + f1(s[3][0]) + ' ' + f1(s[3][1]);
    });
    return closed ? d + 'Z' : d;
  }
  function sampleSegments(segs, per) {
    var out = [];
    segs.forEach(function (s, k) {
      for (var i = k ? 1 : 0; i <= per; i++) {
        var t = i / per, u = 1 - t;
        var a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
        out.push([a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]]);
      }
    });
    return out;
  }
  function inPoly(poly, x, y) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segIntersect(a, b, c, d) {
    var r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
    var den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-9) return null;
    var t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    var u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [a[0] + r[0] * t, a[1] + r[1] * t];
  }
  // Premier point de croisement de deux polylignes (ou null).
  function polylineCross(p, q) {
    for (var i = 0; i < p.length - 1; i++) {
      for (var j = 0; j < q.length - 1; j++) {
        var x = segIntersect(p[i], p[i + 1], q[j], q[j + 1]);
        if (x) return { at: x, i: i };
      }
    }
    return null;
  }

  // ---- Géométrie (calculée une fois) ----
  var geo = null;

  function buildIsland(isl) {
    // Subdivise le contour de base, décale chaque point le long de la normale selon un
    // bruit (côte irrégulière), puis lisse.
    var base = splineSegments(isl.pts, true);
    var dense = sampleSegments(base, 5);
    dense.pop();
    var n = dense.length, pts = [];
    for (var i = 0; i < n; i++) {
      var p = dense[i], a = dense[(i - 1 + n) % n], b = dense[(i + 1) % n];
      var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
      var k = fbm(p[0] / 70, p[1] / 70, isl.seed) * isl.amp;
      pts.push([p[0] + ty / l * k, p[1] - tx / l * k]);
    }
    var segs = splineSegments(pts, true);
    return { id: isl.id, d: segmentsD(segs, true), poly: sampleSegments(segs, 3) };
  }

  function levelsOf(zone) {
    return App.Levels.LEVELS.filter(function (l) { return l.zone === zone; });
  }

  function edgeKey(a, b) { return a + '-' + b; }

  function buildEdges() {
    var edges = [];
    App.Levels.LEVELS.forEach(function (l) {
      l.req.forEach(function (r) {
        var a = App.Levels.get(r), key = edgeKey(r, l.id);
        var pts = [[a.x, a.y]];
        if (EDGE_VIA[key]) pts = pts.concat(EDGE_VIA[key]);
        else {
          // Légère courbe, d'un côté ou de l'autre selon le chemin.
          var dx = l.x - a.x, dy = l.y - a.y, sgn = hash2(a.x, l.y, 5) < 0.5 ? -1 : 1;
          pts.push([(a.x + l.x) / 2 - dy * 0.12 * sgn, (a.y + l.y) / 2 + dx * 0.12 * sgn]);
        }
        pts.push([l.x, l.y]);
        var segs = splineSegments(pts, false);
        edges.push({
          key: key, from: r, to: l.id, d: segmentsD(segs, false), line: sampleSegments(segs, 14),
          kind: EDGE_KIND[key] || PATH_KIND[l.zone] || 'dirt'
        });
      });
    });
    return edges;
  }

  // Régions : grille de BIOME_CELL px sur la grande île.
  var BIOME_CELL = 12;
  function buildBiomes() {
    var zones = App.Levels.ZONES.filter(function (z) { return z.id !== 'port'; });
    var seeds = zones.map(function (z, zi) {
      return levelsOf(z.id).map(function (l) { return [l.x, l.y]; }).concat(ANCHORS[z.id] || []);
    });
    var x0 = 640, y0 = 40, cols = Math.ceil((2440 - x0) / BIOME_CELL), rows = Math.ceil((1130 - y0) / BIOME_CELL);
    var lab = new Int8Array(cols * rows);
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var x = x0 + (i + 0.5) * BIOME_CELL, y = y0 + (j + 0.5) * BIOME_CELL, best = -1, bd = Infinity;
        for (var zi = 0; zi < zones.length; zi++) {
          var s = seeds[zi], md = Infinity;
          for (var k = 0; k < s.length; k++) {
            var dx = s[k][0] - x, dy = s[k][1] - y, dd = dx * dx + dy * dy;
            if (dd < md) md = dd;
          }
          var dist = Math.sqrt(md) - fbm(x / 75, y / 75, 100 + zi * 13) * 34 - noise(x / 22, y / 22, 300 + zi) * 9;
          if (dist < bd) { bd = dist; best = zi; }
        }
        lab[j * cols + i] = best;
      }
    }
    // Contours : arêtes de cases orientées (région à droite), enchaînées en boucles, puis
    // lissées en B-spline quadratique (sommets de contrôle = coins, passages = milieux).
    var shapes = {};
    zones.forEach(function (z, zi) {
      var next = {};
      function add(ax, ay, bx, by) { (next[ax + ',' + ay] = next[ax + ',' + ay] || []).push([bx, by]); }
      function other(i, j) { return i < 0 || j < 0 || i >= cols || j >= rows || lab[j * cols + i] !== zi; }
      for (var j = 0; j < rows; j++) {
        for (var i = 0; i < cols; i++) {
          if (lab[j * cols + i] !== zi) continue;
          if (other(i, j - 1)) add(i, j, i + 1, j);
          if (other(i + 1, j)) add(i + 1, j, i + 1, j + 1);
          if (other(i, j + 1)) add(i + 1, j + 1, i, j + 1);
          if (other(i - 1, j)) add(i, j + 1, i, j);
        }
      }
      var d = '';
      Object.keys(next).forEach(function (startKey) {
        while (next[startKey] && next[startKey].length) {
          var loop = [], cur = startKey.split(',').map(Number), guard = 0;
          do {
            loop.push(cur);
            var k = cur[0] + ',' + cur[1], list = next[k];
            if (!list || !list.length) break;
            cur = list.pop();
          } while ((cur[0] + ',' + cur[1]) !== startKey && ++guard < 100000);
          // Coins seulement (on retire les points alignés).
          var pts = loop.filter(function (p, idx) {
            var a = loop[(idx - 1 + loop.length) % loop.length], b = loop[(idx + 1) % loop.length];
            return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
          }).map(function (p) { return [x0 + p[0] * BIOME_CELL, y0 + p[1] * BIOME_CELL]; });
          if (pts.length < 3) continue;
          var m = pts.length;
          function mid(a, b) { return f1((a[0] + b[0]) / 2) + ' ' + f1((a[1] + b[1]) / 2); }
          d += 'M' + mid(pts[m - 1], pts[0]);
          for (var q = 0; q < m; q++) d += 'Q' + f1(pts[q][0]) + ' ' + f1(pts[q][1]) + ' ' + mid(pts[q], pts[(q + 1) % m]);
          d += 'Z';
        }
      });
      shapes[z.id] = d;
    });
    return {
      shapes: shapes,
      zoneAt: function (x, y) {
        var i = Math.floor((x - x0) / BIOME_CELL), j = Math.floor((y - y0) / BIOME_CELL);
        if (i < 0 || j < 0 || i >= cols || j >= rows) return null;
        return zones[lab[j * cols + i]].id;
      }
    };
  }

  // Grille d'occupation (OCC px) : terre à distance de la côte, cases bloquées par les
  // chemins, niveaux, panneaux, monuments.
  var OCC = 8;
  function buildOccupancy(g) {
    var cols = Math.ceil(W / OCC), rows = Math.ceil(H / OCC);
    var land = new Int16Array(cols * rows), blocked = new Uint8Array(cols * rows);
    var island = new Int8Array(cols * rows);
    var q = [];
    for (var j = 0; j < rows; j++) {
      for (var i = 0; i < cols; i++) {
        var x = (i + 0.5) * OCC, y = (j + 0.5) * OCC, idx = j * cols + i;
        island[idx] = -1;
        g.islands.forEach(function (isl, k) { if (island[idx] < 0 && inPoly(isl.poly, x, y)) island[idx] = k; });
        if (island[idx] < 0) { land[idx] = 0; q.push(idx); } else land[idx] = 32767;
      }
    }
    // Distance (en cases) à la mer, par parcours en largeur.
    for (var h = 0; h < q.length; h++) {
      var c = q[h], ci = c % cols, cj = (c - ci) / cols;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (o) {
        var ni = ci + o[0], nj = cj + o[1];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) return;
        var n = nj * cols + ni;
        if (land[n] > land[c] + 1) { land[n] = land[c] + 1; q.push(n); }
      });
    }
    function stamp(x, y, r) {
      var i0 = Math.max(0, Math.floor((x - r) / OCC)), i1 = Math.min(cols - 1, Math.floor((x + r) / OCC));
      var j0 = Math.max(0, Math.floor((y - r) / OCC)), j1 = Math.min(rows - 1, Math.floor((y + r) / OCC));
      for (var j = j0; j <= j1; j++) {
        for (var i = i0; i <= i1; i++) {
          var dx = (i + 0.5) * OCC - x, dy = (j + 0.5) * OCC - y;
          if (dx * dx + dy * dy <= r * r) blocked[j * cols + i] = 1;
        }
      }
    }
    return {
      stamp: stamp,
      free: function (x, y) {
        var i = Math.floor(x / OCC), j = Math.floor(y / OCC);
        if (i < 0 || j < 0 || i >= cols || j >= rows) return false;
        return !blocked[j * cols + i];
      },
      coastDist: function (x, y) {
        var i = Math.floor(x / OCC), j = Math.floor(y / OCC);
        if (i < 0 || j < 0 || i >= cols || j >= rows) return 0;
        return land[j * cols + i] * OCC;
      }
    };
  }

  function geometry() {
    if (geo) return geo;
    var g = {};
    g.islands = ISLANDS.map(buildIsland);
    g.edges = buildEdges();
    g.biomes = buildBiomes();
    g.rivers = RIVERS.map(function (pts) {
      var segs = splineSegments(pts, false);
      return { d: segmentsD(segs, false), line: sampleSegments(segs, 10) };
    });
    // Ponts : là où un chemin croise une rivière.
    g.bridges = [];
    g.edges.forEach(function (e) {
      g.rivers.forEach(function (r) {
        var x = polylineCross(e.line, r.line);
        if (!x) return;
        var a = e.line[x.i], b = e.line[x.i + 1];
        g.bridges.push({ edge: e.key, x: x.at[0], y: x.at[1], angle: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI });
      });
    });
    g.occ = buildOccupancy(g);
    g.edges.forEach(function (e) {
      if (e.kind === 'sea') return;
      e.line.forEach(function (p) { g.occ.stamp(p[0], p[1], 15); });
    });
    g.rivers.forEach(function (r) { r.line.forEach(function (p) { g.occ.stamp(p[0], p[1], 11); }); });
    LAKES.forEach(function (l) { g.occ.stamp(l.x, l.y, l.rx + 8); });
    App.Levels.LEVELS.forEach(function (l) {
      g.occ.stamp(l.x, l.y, l.boss ? 32 : 28);
      g.occ.stamp(l.x, l.y + 24, 20);
    });
    Object.keys(LABELS).forEach(function (id) {
      var p = LABELS[id], w = labelWidth(App.Levels.zone(id)) / 2 + 6;
      for (var dx = -w; dx <= w; dx += 10) g.occ.stamp(p[0] + dx, p[1], 22);
    });
    LANDMARKS.forEach(function (m) { if (m.r) g.occ.stamp(m.x, m.y - m.r * 0.6, m.r * 1.25); });
    g.decor = scatterDecor(g);
    geo = g;
    return g;
  }

  // Décors semés : grille décalée au hasard, une case par point.
  var TALL = { peak: 70, snowpeak: 70, tree: 34, pine: 44, deadtree: 30, palm: 38, house: 24 };
  function scatterDecor(g) {
    var out = [], rand = rng(20260927);
    function zoneAt(x, y) {
      var bz = g.biomes.zoneAt(x, y);
      if (inPoly(g.islands[0].poly, x, y)) return 'port';
      return bz;
    }
    Object.keys(DECOR).forEach(function (zone) {
      var cfg = DECOR[zone], step = cfg.step, total = 0;
      cfg.items.forEach(function (it) { total += it[1]; });
      for (var y = 60; y < H - 40; y += step) {
        for (var x = 60; x < W - 40; x += step) {
          var px = x + (rand() - 0.5) * step * 0.9, py = y + (rand() - 0.5) * step * 0.9;
          var pick = rand() * total, type = null;
          for (var k = 0; k < cfg.items.length; k++) { pick -= cfg.items[k][1]; if (pick <= 0) { type = cfg.items[k][0]; break; } }
          var s = 0.8 + rand() * 0.45, v = rand();
          if (zoneAt(px, py) !== zone) continue;
          if (g.occ.coastDist(px, py) < 22) continue;
          var tall = (TALL[type] || 10) * s, half = type === 'peak' || type === 'snowpeak' ? 26 * s : 8 * s;
          var probe = [[px, py], [px - half, py], [px + half, py], [px, py - tall * 0.5], [px, py - tall]];
          if (!probe.every(function (p) { return g.occ.free(p[0], p[1]); })) continue;
          out.push({ type: type, x: Math.round(px), y: Math.round(py), s: s, v: v, zone: zone });
        }
      }
    });
    return out;
  }

  // ---- Dessins (base au sol en 0,0) ----
  function shadow(g, rx, ry) { el('ellipse', { cx: 0, cy: 0, rx: rx, ry: ry || rx * 0.32, class: 'm-shadow' }, g); }

  var DRAW = {
    tree: function (g, v) {
      shadow(g, 11);
      el('rect', { x: -2, y: -14, width: 4, height: 14, rx: 1, class: 'm-trunk' }, g);
      var r = 11 + v * 3;
      el('circle', { cx: 0, cy: -14 - r * 0.8, r: r, class: v < 0.3 ? 'm-leaf-dk' : 'm-leaf' }, g);
      el('circle', { cx: -r * 0.3, cy: -14 - r * 1.05, r: r * 0.55, class: 'm-leaf-hi' }, g);
    },
    pine: function (g, v) {
      shadow(g, 9);
      el('rect', { x: -1.8, y: -8, width: 3.6, height: 8, class: 'm-trunk' }, g);
      var h = 34 + v * 12;
      el('path', { d: 'M0 ' + (-h) + 'L-11 -6L11 -6Z', class: 'm-pine' }, g);
      el('path', { d: 'M0 ' + (-h) + 'L-11 -6L0 -6Z', class: 'm-pine-hi' }, g);
    },
    bush: function (g) {
      shadow(g, 10);
      el('circle', { cx: -5, cy: -5, r: 6, class: 'm-bush' }, g);
      el('circle', { cx: 5, cy: -5, r: 6, class: 'm-bush' }, g);
      el('circle', { cx: 0, cy: -9, r: 7, class: 'm-bush' }, g);
      el('circle', { cx: -2, cy: -11, r: 3.5, class: 'm-bush-hi' }, g);
    },
    tuft: function (g) {
      el('path', { d: 'M-5 0L-3 -6L-1 0M-1 0L1 -8L3 0M3 0L5 -5L6 0', class: 'm-tuft' }, g);
    },
    flowers: function (g, v) {
      var c = v < 0.33 ? 'm-flower-a' : v < 0.66 ? 'm-flower-b' : 'm-flower-c';
      [[-4, -2], [3, -4], [0, 2], [6, 1]].forEach(function (p) { el('circle', { cx: p[0], cy: p[1], r: 1.8, class: c }, g); });
    },
    rock: function (g) {
      shadow(g, 10);
      el('path', { d: 'M-10 0L-7 -8L0 -11L8 -6L10 0Z', class: 'm-rock-dk' }, g);
      el('path', { d: 'M-10 0L-7 -8L0 -11L-1 0Z', class: 'm-rock' }, g);
    },
    boulders: function (g, v) {
      shadow(g, 16);
      el('path', { d: 'M-16 0L-13 -12L-4 -17L2 -8L3 0Z', class: 'm-rock-dk' }, g);
      el('path', { d: 'M-16 0L-13 -12L-4 -17L-6 0Z', class: 'm-rock' }, g);
      el('path', { d: 'M0 0L4 -9L11 -11L16 0Z', class: 'm-rock-dk' }, g);
      el('path', { d: 'M0 0L4 -9L11 -11L8 0Z', class: 'm-rock' }, g);
      if (v > 0.6) el('path', { d: 'M-8 -4L-6 -10L-4 -4Z', class: 'm-crystal' }, g);
    },
    crystal: function (g) {
      shadow(g, 9);
      el('path', { d: 'M-7 0L-5 -14L-2 0Z', class: 'm-crystal' }, g);
      el('path', { d: 'M-2 0L1 -22L5 0Z', class: 'm-crystal' }, g);
      el('path', { d: 'M-2 0L1 -22L1 0Z', class: 'm-crystal-hi' }, g);
      el('path', { d: 'M4 0L7 -11L9 0Z', class: 'm-crystal-hi' }, g);
    },
    peak: function (g, v) {
      var w = 26 + v * 10, h = 52 + v * 26;
      shadow(g, w * 0.9, 6);
      el('path', { d: 'M' + (-w) + ' 0L0 ' + (-h) + 'L' + w + ' 0Z', class: 'm-peak-dk' }, g);
      el('path', { d: 'M' + (-w) + ' 0L0 ' + (-h) + 'L' + (w * 0.12) + ' 0Z', class: 'm-peak' }, g);
      var sy = -h * 0.66;
      el('path', { d: 'M0 ' + (-h) + 'L' + f1(-w * 0.34) + ' ' + f1(sy) + 'L' + f1(-w * 0.16) + ' ' + f1(sy + 6) + 'L0 ' + f1(sy - 2) +
        'L' + f1(w * 0.14) + ' ' + f1(sy + 7) + 'L' + f1(w * 0.34) + ' ' + f1(sy) + 'Z', class: 'm-snow-dk' }, g);
      el('path', { d: 'M0 ' + (-h) + 'L' + f1(-w * 0.34) + ' ' + f1(sy) + 'L' + f1(-w * 0.16) + ' ' + f1(sy + 6) + 'L0 ' + f1(sy - 2) + 'Z', class: 'm-snow' }, g);
    },
    snowpeak: function (g, v) {
      // Comme `peak`, mais enneigé jusqu'à mi-pente.
      var w = 24 + v * 10, h = 48 + v * 22, sy = -h * 0.42;
      shadow(g, w * 0.9, 6);
      el('path', { d: 'M' + (-w) + ' 0L0 ' + (-h) + 'L' + w + ' 0Z', class: 'm-peak-dk' }, g);
      el('path', { d: 'M' + (-w) + ' 0L0 ' + (-h) + 'L' + (w * 0.12) + ' 0Z', class: 'm-peak' }, g);
      el('path', { d: 'M0 ' + (-h) + 'L' + f1(-w * 0.58) + ' ' + f1(sy) + 'L' + f1(-w * 0.3) + ' ' + f1(sy + 7) + 'L' + f1(-w * 0.05) + ' ' + f1(sy - 1) +
        'L' + f1(w * 0.25) + ' ' + f1(sy + 8) + 'L' + f1(w * 0.58) + ' ' + f1(sy) + 'Z', class: 'm-snow-dk' }, g);
      el('path', { d: 'M0 ' + (-h) + 'L' + f1(-w * 0.58) + ' ' + f1(sy) + 'L' + f1(-w * 0.3) + ' ' + f1(sy + 7) + 'L' + f1(-w * 0.05) + ' ' + f1(sy - 1) + 'Z', class: 'm-snow' }, g);
    },
    hill: function (g, v) {
      var w = 22 + v * 12, h = 12 + v * 8;
      el('path', { d: 'M' + (-w) + ' 0A' + w + ' ' + h + ' 0 0 1 ' + w + ' 0Z', class: 'm-hill-dk' }, g);
      el('path', { d: 'M' + (-w) + ' 0A' + w + ' ' + h + ' 0 0 1 ' + f1(w * 0.3) + ' ' + f1(-h * 0.95) + 'Q' + f1(-w * 0.2) + ' ' + f1(-h * 0.5) + ' ' + f1(-w * 0.1) + ' 0Z', class: 'm-hill' }, g);
    },
    sheep: function (g) {
      shadow(g, 7);
      el('path', { d: 'M-3 0v-3M3 0v-3', class: 'm-sheep-leg' }, g);
      el('ellipse', { cx: 0, cy: -6, rx: 7, ry: 4.5, class: 'm-sheep' }, g);
      el('ellipse', { cx: 7, cy: -8, rx: 2.6, ry: 2.2, class: 'm-sheep-head' }, g);
    },
    mushroom: function (g) {
      el('rect', { x: -1.2, y: -4, width: 2.4, height: 4, class: 'm-wall' }, g);
      el('path', { d: 'M-5 -4A5 4.5 0 0 1 5 -4Z', class: 'm-mush' }, g);
      el('circle', { cx: -1.5, cy: -6, r: 0.9, class: 'm-wall' }, g);
      el('circle', { cx: 2, cy: -5.5, r: 0.8, class: 'm-wall' }, g);
    },
    reeds: function (g, v) {
      el('path', { d: 'M-4 0Q-5 -8 -6 -13M0 0V-16M4 0Q5 -7 7 -11', class: 'm-reed' }, g);
      el('ellipse', { cx: 0, cy: -16, rx: 1.6, ry: 3.4, class: 'm-cattail' }, g);
      if (v > 0.4) el('ellipse', { cx: -6, cy: -13, rx: 1.4, ry: 3, class: 'm-cattail' }, g);
    },
    puddle: function (g, v) {
      var rx = 11 + v * 7;
      el('ellipse', { cx: 0, cy: 0, rx: rx, ry: rx * 0.42, class: 'm-murk' }, g);
      el('path', { d: 'M' + f1(-rx * 0.5) + ' -1h' + f1(rx * 0.5), class: 'm-water-line' }, g);
      if (v > 0.5) el('circle', { cx: rx * 0.4, cy: 1, r: 2.4, class: 'm-lily' }, g);
    },
    deadtree: function (g) {
      shadow(g, 7);
      el('path', { d: 'M0 0V-22M0 -12L-7 -19M0 -16L6 -24M-7 -19L-9 -24M0 -22L-2 -27', class: 'm-deadwood' }, g);
    },
    palm: function (g, v) {
      shadow(g, 9);
      var lean = v < 0.5 ? -1 : 1;
      el('path', { d: 'M0 0Q' + (lean * 2) + ' -16 ' + (lean * 7) + ' -30', class: 'm-palm-trunk' }, g);
      var tx = lean * 7, ty = -30;
      [[-14, 4], [14, 4], [-10, -8], [10, -8], [0, -12]].forEach(function (o, k) {
        el('path', { d: 'M' + tx + ' ' + ty + 'Q' + f1(tx + o[0] * 0.5) + ' ' + f1(ty + o[1] - 6) + ' ' + f1(tx + o[0]) + ' ' + f1(ty + o[1]),
          class: k % 2 ? 'm-palm-leaf' : 'm-palm-leaf-dk' }, g);
      });
      el('circle', { cx: tx, cy: ty + 2, r: 2, class: 'm-trunk' }, g);
    },
    house: function (g, v) {
      shadow(g, 13);
      el('rect', { x: -10, y: -11, width: 12, height: 11, class: 'm-wall' }, g);
      el('rect', { x: 2, y: -11, width: 9, height: 11, class: 'm-wall-dk' }, g);
      el('path', { d: 'M-11 -11L-4 -19L3 -11Z', class: 'm-wall' }, g);
      el('path', { d: 'M-4 -19L7 -19L12 -11L3 -11Z', class: v > 0.5 ? 'm-roof' : 'm-roof-b' }, g);
      el('rect', { x: -6, y: -7, width: 4, height: 7, class: 'm-door' }, g);
      el('rect', { x: 5, y: -8, width: 3, height: 3, class: 'm-window' }, g);
    }
  };

  var LANDMARK_DRAW = {
    lighthouse: function (g) {
      shadow(g, 16);
      el('path', { d: 'M-9 0L-6 -46L6 -46L9 0Z', class: 'm-wall' }, g);
      el('path', { d: 'M-8.2 -12L-7.5 -22L7.5 -22L8.2 -12Z', class: 'm-stripe' }, g);
      el('path', { d: 'M-6.9 -32L-6.4 -40L6.4 -40L6.9 -32Z', class: 'm-stripe' }, g);
      el('rect', { x: -8, y: -48, width: 16, height: 3, class: 'm-wall-dk' }, g);
      el('rect', { x: -5, y: -56, width: 10, height: 8, class: 'm-lamp' }, g);
      el('path', { d: 'M-6 -56L0 -63L6 -56Z', class: 'm-stripe' }, g);
      el('rect', { x: -2, y: -8, width: 4, height: 8, class: 'm-door' }, g);
    },
    house: function (g, m) { DRAW.house(g, 0.7); },
    pier: function (g, m) {
      var dir = m.len < 0 ? -1 : 1, len = Math.abs(m.len);
      for (var i = 0; i < len; i += 12) el('rect', { x: dir > 0 ? i + 2 : -i - 5, y: 5, width: 3, height: 7, class: 'm-wood-dk' }, g);
      el('rect', { x: dir > 0 ? 0 : -len, y: -5, width: len, height: 10, class: 'm-wood' }, g);
      for (var k = 6; k < len; k += 6) el('path', { d: 'M' + (dir * k) + ' -5v10', class: 'm-plank-line' }, g);
    },
    boat: function (g) {
      el('path', { d: 'M-16 4q16 5 32 0', class: 'm-wave' }, g);
      el('path', { d: 'M-14 -4L14 -4L9 3L-9 3Z', class: 'm-hull' }, g);
      el('path', { d: 'M0 -5V-30', class: 'm-mast' }, g);
      el('path', { d: 'M1 -29L1 -7L14 -7Z', class: 'm-sail' }, g);
      el('path', { d: 'M-1 -26L-1 -8L-10 -8Z', class: 'm-sail-dk' }, g);
    },
    windmill: function (g) {
      shadow(g, 16);
      el('path', { d: 'M-11 0L-7 -40L7 -40L11 0Z', class: 'm-wall' }, g);
      el('path', { d: 'M2 0L3 -40L7 -40L11 0Z', class: 'm-wall-dk' }, g);
      el('path', { d: 'M-9 -40L0 -52L9 -40Z', class: 'm-roof' }, g);
      el('rect', { x: -3, y: -9, width: 6, height: 9, class: 'm-door' }, g);
      el('rect', { x: -2, y: -26, width: 4, height: 5, class: 'm-window' }, g);
      // Les ailes tournent : dessinées dans le calque animé (voir buildLive).
    },
    field: function (g) {
      var wrap = el('g', { transform: 'skewX(-18)' }, g);
      el('rect', { x: -26, y: -16, width: 52, height: 32, rx: 2, class: 'm-field' }, wrap);
      for (var y = -12; y < 16; y += 6) el('path', { d: 'M-24 ' + y + 'h48', class: 'm-field-line' }, wrap);
    },
    cabin: function (g) {
      shadow(g, 16);
      el('rect', { x: -12, y: -12, width: 14, height: 12, class: 'm-wood' }, g);
      el('rect', { x: 2, y: -12, width: 11, height: 12, class: 'm-wood-dk' }, g);
      el('path', { d: 'M-13 -12L-5 -21L3 -12Z', class: 'm-wood' }, g);
      el('path', { d: 'M-5 -21L8 -21L14 -12L3 -12Z', class: 'm-roof-b' }, g);
      el('rect', { x: -8, y: -8, width: 5, height: 8, class: 'm-door' }, g);
      el('rect', { x: 6, y: -9, width: 4, height: 4, class: 'm-window' }, g);
      el('rect', { x: 5, y: -26, width: 3, height: 6, class: 'm-rock-dk' }, g);
    },
    farm: function (g) {
      shadow(g, 20);
      el('rect', { x: -16, y: -16, width: 18, height: 16, class: 'm-barn' }, g);
      el('rect', { x: 2, y: -16, width: 14, height: 16, class: 'm-barn-dk' }, g);
      el('path', { d: 'M-17 -16L-7 -27L3 -16Z', class: 'm-barn' }, g);
      el('path', { d: 'M-7 -27L9 -27L17 -16L3 -16Z', class: 'm-roof-b' }, g);
      el('path', { d: 'M-11 0v-9h8v9M-11 -9l8 9M-3 -9l-8 9', class: 'm-barn-line' }, g);
      el('rect', { x: 20, y: -22, width: 7, height: 22, rx: 3, class: 'm-wall' }, g);
      el('path', { d: 'M20 -22a3.5 3.5 0 0 1 7 0', class: 'm-roof' }, g);
    },
    cave: function (g) {
      shadow(g, 24);
      el('path', { d: 'M-26 0Q-24 -26 -4 -32Q18 -34 26 0Z', class: 'm-rock-dk' }, g);
      el('path', { d: 'M-26 0Q-24 -26 -4 -32Q-8 -14 -6 0Z', class: 'm-rock' }, g);
      el('path', { d: 'M-8 0Q-7 -17 3 -17Q12 -16 13 0Z', class: 'm-cave' }, g);
      el('path', { d: 'M16 -2L18 -10L21 -2Z', class: 'm-crystal' }, g);
    },
    castle: function (g) {
      shadow(g, 38, 8);
      // Mur d'enceinte avec créneaux, deux tours à toit conique, donjon.
      el('rect', { x: -30, y: -20, width: 60, height: 20, class: 'm-stone' }, g);
      for (var x = -30; x < 30; x += 8) el('rect', { x: x, y: -24, width: 5, height: 4, class: 'm-stone' }, g);
      el('rect', { x: -12, y: -46, width: 24, height: 30, class: 'm-stone' }, g);
      el('rect', { x: 2, y: -46, width: 10, height: 30, class: 'm-stone-dk' }, g);
      for (var k = -12; k < 12; k += 6) el('rect', { x: k, y: -50, width: 4, height: 4, class: 'm-stone' }, g);
      el('path', { d: 'M-5 0v-9a5 5 0 0 1 10 0v9Z', class: 'm-door' }, g);
      el('rect', { x: -4, y: -38, width: 3, height: 6, class: 'm-window' }, g);
      el('rect', { x: 5, y: -38, width: 3, height: 6, class: 'm-window' }, g);
      [-30, 30].forEach(function (tx) {
        el('rect', { x: tx - 7, y: -36, width: 14, height: 36, class: 'm-stone' }, g);
        el('rect', { x: tx, y: -36, width: 7, height: 36, class: 'm-stone-dk' }, g);
        el('path', { d: 'M' + (tx - 9) + ' -36L' + tx + ' -52L' + (tx + 9) + ' -36Z', class: 'm-roof' }, g);
        el('path', { d: 'M' + tx + ' -52L' + (tx + 9) + ' -36L' + tx + ' -36Z', class: 'm-roof-dk' }, g);
        el('rect', { x: tx - 1.5, y: -28, width: 3, height: 5, class: 'm-window' }, g);
      });
      el('path', { d: 'M0 -50V-64', class: 'm-mast' }, g);
      el('path', { d: 'M0 -64L11 -60L0 -56Z', class: 'm-flag' }, g);
    },
    hut: function (g) {
      shadow(g, 14);
      el('path', { d: 'M-9 0v-8M9 0v-8M0 0v-8', class: 'm-deadwood' }, g);
      el('rect', { x: -12, y: -10, width: 24, height: 3, class: 'm-wood-dk' }, g);
      el('rect', { x: -9, y: -20, width: 18, height: 10, class: 'm-wood' }, g);
      el('path', { d: 'M-13 -19L0 -30L13 -19Z', class: 'm-thatch' }, g);
      el('rect', { x: -3, y: -17, width: 5, height: 7, class: 'm-door' }, g);
    },
    observatory: function (g) {
      shadow(g, 30, 7);
      el('rect', { x: -24, y: -20, width: 48, height: 20, class: 'm-wall' }, g);
      el('rect', { x: 6, y: -20, width: 18, height: 20, class: 'm-wall-dk' }, g);
      el('path', { d: 'M-20 -20A20 20 0 0 1 20 -20Z', class: 'm-dome' }, g);
      el('path', { d: 'M4 -20A20 20 0 0 0 0 -40A20 20 0 0 1 20 -20Z', class: 'm-dome-dk' }, g);
      el('path', { d: 'M-3 -21L-3 -39L3 -39L3 -21Z', class: 'm-cave' }, g);
      el('path', { d: 'M0 -30L16 -48', class: 'm-scope' }, g);
      el('rect', { x: -4, y: -11, width: 8, height: 11, class: 'm-door' }, g);
      el('rect', { x: -18, y: -14, width: 5, height: 5, class: 'm-window' }, g);
      el('rect', { x: 12, y: -14, width: 5, height: 5, class: 'm-window' }, g);
    },
    bigpeak: function (g) {
      shadow(g, 46, 9);
      el('path', { d: 'M-48 0L-6 -118L46 0Z', class: 'm-peak-dk' }, g);
      el('path', { d: 'M-48 0L-6 -118L2 0Z', class: 'm-peak' }, g);
      el('path', { d: 'M-6 -118L-24 -70L-14 -76L-6 -66L4 -78L14 -68Z', class: 'm-snow-dk' }, g);
      el('path', { d: 'M-6 -118L-24 -70L-14 -76L-6 -66Z', class: 'm-snow' }, g);
      el('path', { d: 'M-6 -118V-134', class: 'm-mast' }, g);
      el('path', { d: 'M-6 -134L7 -130L-6 -126Z', class: 'm-flag' }, g);
    },
    spring: function (g) {
      el('path', { d: 'M-12 0Q-12 -9 0 -10Q12 -9 12 0Z', class: 'm-rock' }, g);
      el('path', { d: 'M-6 -9Q0 -20 6 -9', class: 'm-water-jet' }, g);
    }
  };

  // ---- Panneaux ----
  function labelWidth(z) {
    return Math.max(z.name.length * 8.2, z.sub.length * 5.9) + 52;
  }
  // part : 'box' (cadre, pastille, nom), 'mark' (symbole seul) ou les deux.
  function drawLabel(parent, z, part) {
    var p = LABELS[z.id];
    if (!p) return;
    var w = labelWidth(z), h = 36;
    var g = el('g', { class: 'map-sign', 'data-sign': z.id, transform: 'translate(' + f1(p[0] - w / 2) + ' ' + f1(p[1] - h / 2) + ')' }, parent);
    if (part !== 'mark') {
      el('rect', { x: 0, y: 3, width: w, height: h, rx: 10, class: 'm-sign-sh' }, g);
      el('rect', { x: 0, y: 0, width: w, height: h, rx: 10, class: 'm-sign' }, g);
      el('circle', { cx: 20, cy: h / 2, r: 12, class: 'm-z-' + z.id }, g);
      var n = el('text', { x: 40, y: 15, class: 'map-zone-name' }, g);
      n.textContent = z.name;
      var s = el('text', { x: 40, y: 28, class: 'map-zone-sub' }, g);
      s.textContent = z.sub;
    }
    if (part !== 'box') {
      var mk = el('text', { x: 20, y: h / 2 + 0.5, class: 'map-sign-mark' + (z.mark.length > 3 ? ' long' : '') }, g);
      mk.textContent = z.mark;
    }
  }

  // ---- Calques statiques ----
  var PATTERNS = {
    port: function (p) { tufts(p, 'm-tex-dark', 7); },
    plaine: function (p) { tufts(p, 'm-tex-dark', 9); },
    foret: function (p) { dots(p, 'm-tex-dark', 14, 1.6); },
    coll: function (p) {
      [[8, 14], [40, 36], [18, 50]].forEach(function (q) { el('path', { d: 'M' + q[0] + ' ' + q[1] + 'q9 -6 18 0', class: 'm-tex-line' }, p); });
    },
    mont: function (p) { specks(p, 'm-tex-dark', 10); },
    grotte: function (p) {
      [[6, 10], [36, 30], [16, 46]].forEach(function (q) { el('path', { d: 'M' + q[0] + ' ' + q[1] + 'l5 4l-2 5l6 3', class: 'm-tex-line' }, p); });
    },
    source: function (p) { dots(p, 'm-tex-light', 10, 1.8); },
    marais: function (p) {
      [[6, 12], [34, 22], [14, 38], [42, 50]].forEach(function (q) { el('path', { d: 'M' + q[0] + ' ' + q[1] + 'h10', class: 'm-tex-line' }, p); });
    },
    cit: function (p) {
      var r = rng(41);
      for (var y = 6; y < 60; y += 15) {
        for (var x = (y / 15) % 2 ? 4 : 12; x < 60; x += 17) {
          el('rect', { x: f1(x + r() * 3), y: f1(y + r() * 3), width: 9, height: 6, rx: 2, class: 'm-tex-faint' }, p);
        }
      }
    },
    obs: function (p) { dots(p, 'm-tex-light', 8, 1.3); },
    som: function (p) { dots(p, 'm-tex-light', 12, 2); }
  };
  function tufts(p, cls, n) {
    var r = rng(n * 31);
    for (var i = 0; i < n; i++) {
      var x = f1(r() * 56 + 2), y = f1(r() * 56 + 4);
      el('path', { d: 'M' + x + ' ' + y + 'l2 -4l2 4', class: cls + ' m-tex-stroke' }, p);
    }
  }
  function dots(p, cls, n, rr) {
    var r = rng(n * 17 + 3);
    for (var i = 0; i < n; i++) el('circle', { cx: f1(r() * 60), cy: f1(r() * 60), r: rr, class: cls }, p);
  }
  function specks(p, cls, n) {
    var r = rng(n * 7 + 1);
    for (var i = 0; i < n; i++) {
      var x = r() * 56 + 2, y = r() * 56 + 2;
      el('path', { d: 'M' + f1(x) + ' ' + f1(y) + 'l3 -3l2 3Z', class: cls }, p);
    }
  }

  function buildDefs(defs) {
    Object.keys(PATTERNS).forEach(function (id) {
      var p = el('pattern', { id: 'm-pat-' + id, width: 60, height: 60, patternUnits: 'userSpaceOnUse' }, defs);
      PATTERNS[id](p);
    });
    el('path', { id: 'm-island-main', d: geometry().islands[1].d }, el('clipPath', { id: 'm-clip-main' }, defs));
  }

  // Sol : mer, îles, régions, lacs et rivières.
  function buildGround(parent, defs) {
    var g = geometry();
    buildDefs(defs);
    // La mer elle-même est le fond de #mapOverlay : un rectangle géant ici agrandirait
    // d'autant le calque composité de la carte (voir applyView dans map.js).
    var rand = rng(77);
    var sea = el('g', {}, parent);
    for (var i = 0; i < 170; i++) {
      var x = -300 + rand() * (W + 600), y = -200 + rand() * (H + 400);
      if (g.islands.some(function (isl) { return inPoly(isl.poly, x, y); }) || g.occ.coastDist(x, y) > 0) continue;
      if (rand() < 0.55) el('path', { d: 'M' + f1(x) + ' ' + f1(y) + 'q4 -4 8 0q4 -4 8 0', class: 'm-wave' }, sea);
      else el('circle', { cx: f1(x), cy: f1(y), r: f1(0.8 + rand() * 1.2), class: 'm-star m-night' }, sea);
    }
    g.islands.forEach(function (isl) {
      var ig = el('g', { class: 'm-island', 'data-island': isl.id }, parent);
      el('path', { d: isl.d, class: 'm-shallow' }, ig);
      el('path', { d: isl.d, class: 'm-cliff2', transform: 'translate(0 34)' }, ig);
      el('path', { d: isl.d, class: 'm-cliff1', transform: 'translate(0 18)' }, ig);
      el('path', { d: isl.d, class: 'm-cliff-line', transform: 'translate(0 26)' }, ig);
      el('path', { d: isl.d, class: 'm-beach' }, ig);
      el('path', { d: isl.d, class: isl.id === 'port' ? 'm-z-port' : 'm-grass' }, ig);
      if (isl.id === 'port') el('path', { d: isl.d, fill: 'url(#m-pat-port)' }, ig);
    });
    // Cascade là où la rivière rejoint la mer (l'eau qui coule : buildWaterfall).
    g.rivers.forEach(function (r) {
      var end = r.line[r.line.length - 1];
      var wf = el('g', { transform: 'translate(' + f1(end[0]) + ' ' + f1(end[1] - 6) + ')' }, parent);
      el('rect', { x: -7, y: 0, width: 14, height: 44, rx: 2, class: 'm-water' }, wf);
    });
    var bio = el('g', { 'clip-path': 'url(#m-clip-main)' }, parent);
    Object.keys(g.biomes.shapes).forEach(function (id) {
      el('path', { d: g.biomes.shapes[id], class: 'm-biome m-z-' + id, 'data-biome': id }, bio);
      el('path', { d: g.biomes.shapes[id], fill: 'url(#m-pat-' + id + ')', class: 'm-biome-tex' }, bio);
    });
    // Liseré de plage par-dessus les régions.
    el('path', { d: g.islands[1].d, class: 'm-beach-inner' }, parent);
    LAKES.forEach(function (l) {
      el('ellipse', { cx: l.x, cy: l.y + 3, rx: l.rx + 4, ry: l.ry + 3, class: 'm-lake-rim' }, parent);
      el('ellipse', { cx: l.x, cy: l.y, rx: l.rx, ry: l.ry, class: 'm-water' }, parent);
      el('path', { d: 'M' + (l.x - l.rx * 0.5) + ' ' + (l.y - 4) + 'h' + l.rx * 0.5 + 'M' + (l.x) + ' ' + (l.y + 6) + 'h' + l.rx * 0.4, class: 'm-water-line' }, parent);
    });
    g.rivers.forEach(function (r) {
      el('path', { d: r.d, class: 'm-river-bank' }, parent);
      el('path', { d: r.d, class: 'm-river' }, parent);
    });
    LANDMARKS.forEach(function (m) { if (m.ground) drawLandmark(parent, m); });
  }

  // Bateau qui fait lentement le tour de l'île du Port (animations SVG, cadencées sur
  // l'horloge du document). Il se retourne quand il change de sens horizontal.
  var BOAT_LAP_S = 280, BOAT_OFFSET = 80;
  function buildBoatLoop(parent) {
    var base = ISLANDS[0].pts, cx = 0, cy = 0;
    base.forEach(function (p) { cx += p[0] / base.length; cy += p[1] / base.length; });
    var pts = base.map(function (p) {
      var dx = p[0] - cx, dy = p[1] - cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
      return [p[0] + dx / l * BOAT_OFFSET, p[1] + dy / l * BOAT_OFFSET];
    });
    var segs = splineSegments(pts, true), d = segmentsD(segs, true), line = sampleSegments(segs, 12);
    // Sens horizontal le long du tour, en fraction de la longueur (animateMotion avance à
    // vitesse constante).
    var lens = [0];
    for (var i = 1; i < line.length; i++) lens.push(lens[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    var total = lens[lens.length - 1], times = [], values = [], cur = 0;
    for (var k = 1; k < line.length; k++) {
      var dx = line[k][0] - line[k - 1][0];
      if (Math.abs(dx) < 0.4) continue;
      var sgn = dx > 0 ? 1 : -1;
      if (sgn !== cur) { times.push(times.length ? f1(lens[k - 1] / total * 1000) / 1000 : 0); values.push(sgn + ' 1'); cur = sgn; }
    }
    var g = el('g', { class: 'map-boat' }, parent);
    el('animateMotion', { path: d, dur: BOAT_LAP_S + 's', repeatCount: 'indefinite' }, g);
    var bob = el('g', { class: 'map-boat-bob' }, g);
    var flip = el('g', {}, bob);
    el('animateTransform', { attributeName: 'transform', type: 'scale', calcMode: 'discrete', values: values.join(';'),
      keyTimes: times.join(';'), dur: BOAT_LAP_S + 's', repeatCount: 'indefinite' }, flip);
    LANDMARK_DRAW.boat(flip);
  }

  function drawLandmark(parent, m) {
    var g = el('g', { transform: 'translate(' + m.x + ' ' + m.y + ')' + (m.s ? ' scale(' + m.s + ')' : ''),
      class: 'm-lm m-lm-' + m.type + (m.cls ? ' ' + m.cls : '') }, parent);
    LANDMARK_DRAW[m.type](g, m);
    return g;
  }

  // Décors en relief, triés par profondeur (base au sol).
  function buildDecor(parent) {
    var g = geometry();
    var items = g.decor.map(function (d) { return { y: d.y, d: d }; })
      .concat(LANDMARKS.filter(function (m) { return !m.ground; }).map(function (m) { return { y: m.y, m: m }; }));
    items.sort(function (a, b) { return a.y - b.y; });
    items.forEach(function (it) {
      if (it.m) { drawLandmark(parent, it.m); return; }
      var d = it.d;
      var gg = el('g', { transform: 'translate(' + d.x + ' ' + d.y + ') scale(' + f1(d.s * 10) / 10 + ')', class: 'm-deco m-deco-' + d.type }, parent);
      DRAW[d.type](gg, d.v);
    });
  }

  function buildLabels(parent, part) {
    App.Levels.ZONES.forEach(function (z) { drawLabel(parent, z, part); });
  }
  function buildLabelsSvg() {
    var root = detachedSvg();
    buildLabels(root, 'box');
    return root;
  }

  // ---- Chemins ----
  // state : 'locked' | 'open' | 'walked'
  function drawEdge(parent, e, state, extraCls) {
    var g = el('g', { class: 'map-edge map-edge-' + e.kind + ' ' + state + (extraCls ? ' ' + extraCls : ''), 'data-edge': e.key }, parent);
    var layers = {
      dirt: [['edge', 13], ['fill', 8]],
      trail: [['edge', 11], ['fill', 7], ['dots', 7]],
      stone: [['edge', 12], ['fill', 9]],
      plank: [['edge', 13], ['fill', 10], ['steps', 10]],
      road: [['edge', 15], ['fill', 12], ['line', 1.6]],
      sea: [['line', 3]]
    }[e.kind];
    layers.forEach(function (l) {
      el('path', { d: e.d, class: 'm-p-' + l[0], 'stroke-width': l[1] }, g);
    });
    geometry().bridges.forEach(function (b) {
      if (b.edge !== e.key) return;
      var bg = el('g', { transform: 'translate(' + f1(b.x) + ' ' + f1(b.y) + ') rotate(' + f1(b.angle) + ')', class: 'm-bridge' }, g);
      el('rect', { x: -16, y: -8, width: 32, height: 16, rx: 2, class: 'm-wood' }, bg);
      for (var x = -12; x < 16; x += 5) el('path', { d: 'M' + x + ' -8v16', class: 'm-plank-line' }, bg);
      el('path', { d: 'M-16 -8h32M-16 8h32', class: 'm-rail' }, bg);
    });
    return g;
  }

  // Obstacle sur un chemin vers un niveau qui attend encore d'autres prérequis : placé
  // près de l'arrivée, orienté en travers du chemin.
  function drawObstacle(parent, e, title) {
    var line = e.line, n = line.length;
    var at = line[Math.floor(n * 0.72)];
    var g = el('g', { class: 'map-obstacle', 'data-obstacle': e.key, transform: 'translate(' + f1(at[0]) + ' ' + f1(at[1]) + ')' }, parent);
    var t = el('title', {}, g);
    t.textContent = title;
    var inner = el('g', { class: 'map-obstacle-inner' }, g);
    // Barrière rayée (de face, comme les autres décors), avec un rocher ou un tronc selon
    // le terrain.
    var bar = el('g', { transform: 'translate(0 4)' }, inner);
    if (e.kind === 'stone') {
      el('path', { d: 'M13 6Q12 -4 19 -6Q27 -5 26 6Z', class: 'm-rock-dk' }, bar);
      el('path', { d: 'M13 6Q12 -4 19 -6Q18 0 19 6Z', class: 'm-rock' }, bar);
    } else if (e.kind === 'plank' || e.kind === 'trail') {
      el('rect', { x: -26, y: 1, width: 14, height: 6, rx: 3, class: 'm-wood-dk' }, bar);
    }
    el('ellipse', { cx: 0, cy: 6, rx: 15, ry: 3, class: 'm-shadow' }, bar);
    el('path', { d: 'M-12 -8v14M12 -8v14', class: 'm-post' }, bar);
    el('rect', { x: -16, y: -9, width: 32, height: 7, rx: 2, class: 'm-barrier' }, bar);
    el('path', { d: 'M-10 -9l-4 7M-2 -9l-4 7M6 -9l-4 7M14 -9l-4 7', class: 'm-barrier-stripe' }, bar);
    return g;
  }

  // ---- Nuages ----
  var cloudCache = {};
  function cloudsFor(zoneId) {
    if (cloudCache[zoneId]) return cloudCache[zoneId];
    var g = geometry(), rand = rng(zoneId.length * 97 + zoneId.charCodeAt(0));
    var pts = [], step = 78;
    function inZone(x, y) {
      if (zoneId === 'port') return inPoly(g.islands[0].poly, x, y);
      return g.biomes.zoneAt(x, y) === zoneId && inPoly(g.islands[1].poly, x, y);
    }
    for (var y = 40; y < H; y += step * 0.8) {
      for (var x = 40; x < W; x += step) {
        var px = x + (rand() - 0.5) * step * 0.6, py = y + (rand() - 0.5) * step * 0.5;
        if (inZone(px, py)) pts.push([px, py, 46 + rand() * 24, rand()]);
      }
    }
    levelsOf(zoneId).forEach(function (l) { pts.push([l.x + 4, l.y + 10, 40 + rand() * 10, rand()]); });
    var cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
    cx /= pts.length || 1; cy /= pts.length || 1;
    pts.sort(function (a, b) { return a[1] - b[1]; });
    cloudCache[zoneId] = { pts: pts, cx: cx, cy: cy };
    return cloudCache[zoneId];
  }
  // Tracé d'un nuage (cercles + base arrondie), en un seul chemin : il y en a des centaines.
  function cloudPath(r, v) {
    var puffs = [[-0.75, -0.05, 0.5], [-0.25, -0.38, 0.62 + v * 0.1], [0.35, -0.25, 0.55], [0.8, 0, 0.42]];
    var d = '';
    puffs.forEach(function (p) {
      var cx = p[0] * r, cy = p[1] * r, rr = p[2] * r;
      d += 'M' + f1(cx - rr) + ' ' + f1(cy) + 'a' + f1(rr) + ' ' + f1(rr) + ' 0 1 1 ' + f1(2 * rr) + ' 0a' + f1(rr) + ' ' + f1(rr) + ' 0 1 1 ' + f1(-2 * rr) + ' 0Z';
    });
    var bx = r * 0.8, by = -r * 0.2, bh = r * 0.42, br = r * 0.2;
    d += 'M' + f1(-bx + br) + ' ' + f1(by) + 'H' + f1(bx - br) + 'a' + f1(br) + ' ' + f1(br) + ' 0 0 1 ' + f1(br) + ' ' + f1(br) +
      'V' + f1(by + bh - br) + 'a' + f1(br) + ' ' + f1(br) + ' 0 0 1 ' + f1(-br) + ' ' + f1(br) + 'H' + f1(-bx + br) +
      'a' + f1(br) + ' ' + f1(br) + ' 0 0 1 ' + f1(-br) + ' ' + f1(-br) + 'V' + f1(by + br) + 'a' + f1(br) + ' ' + f1(br) + ' 0 0 1 ' + f1(br) + ' ' + f1(-br) + 'Z';
    return d;
  }
  function drawCloud(parent, x, y, r, v, cls) {
    var g = el('g', { transform: 'translate(' + f1(x) + ' ' + f1(y) + ')' }, parent);
    var inner = el('g', { class: cls || 'map-cloud' }, g);
    var d = cloudPath(r, v);
    el('path', { d: d, class: 'm-cloud-sh', transform: 'translate(0 ' + f1(r * 0.14) + ')' }, inner);
    el('path', { d: d, class: 'm-cloud' }, inner);
    return inner;
  }

  function drawClouds(parent, zoneId) {
    var c = cloudsFor(zoneId);
    c.pts.forEach(function (p) {
      var inner = drawCloud(parent, p[0], p[1], p[2], p[3]);
      var dx = p[0] - c.cx, dy = p[1] - c.cy, l = Math.sqrt(dx * dx + dy * dy) || 1;
      var push = 160 + p[3] * 80;
      inner.style.setProperty('--cloud-dx', f1(dx / l * push) + 'px');
      inner.style.setProperty('--cloud-dy', f1(dy / l * push - 30) + 'px');
      inner.style.setProperty('--cloud-delay', f1(p[3] * 0.3) + 's');
    });
  }
  // ---- Calques animés (map.js les place dans ses SVG vivants) ----
  // Uniquement des animations SVG (<animate…>), cadencées sur l'horloge du document ; pas
  // d'animation CSS à transform-box (coûteuse, voir map.js). `begin` négatif : chaque
  // élément démarre déjà en cours de cycle, sans synchronisme visible.
  function anim(tag, attrs, parent) {
    attrs.repeatCount = attrs.repeatCount || 'indefinite';
    return el(tag, attrs, parent);
  }

  // Quelques nuages décoratifs au-dessus de la mer (immobiles : dans l'image du décor).
  function buildSkyClouds(parent) {
    [[640, 360, 34], [150, 330, 28], [2380, 250, 40], [600, 980, 30], [2100, 1040, 36], [1150, 60, 30], [2390, 960, 26]]
      .forEach(function (p, i) { drawCloud(parent, p[0], p[1], p[2], i / 7, 'map-sky-cloud'); });
  }

  // Mouettes qui planent en cercles (ellipses : vue de 3/4) ; l'une passe au-dessus du Port.
  var GULLS = [[640, 300, 60, 34], [1050, 45, 50, 30], [2385, 380, 55, 36], [600, 1030, 45, 28], [2250, 980, 50, 32],
    [400, 610, 250, 70]];
  function buildGulls(parent) {
    var rand = rng(99);
    GULLS.forEach(function (c) {
      var rx = c[2], ry = c[2] * 0.6;
      var path = 'M' + (c[0] - rx) + ' ' + c[1] + 'a' + rx + ' ' + f1(ry) + ' 0 1 1 ' + (2 * rx) + ' 0a' + rx + ' ' + f1(ry) + ' 0 1 1 ' + (-2 * rx) + ' 0Z';
      var g = el('g', { class: 'm-gull-wrap' }, parent);
      anim('animateMotion', { path: path, dur: c[3] + 's', begin: '-' + f1(rand() * c[3]) + 's' }, g);
      var wings = el('path', { d: 'M-6 0Q-3 -4 0 0Q3 -4 6 0', class: 'm-gull' }, g);
      // Deux coups d'ailes, puis vol plané.
      var flap = f1(2.5 + rand() * 2);
      anim('animateTransform', { attributeName: 'transform', type: 'scale', values: '1 1;1 0.3;1 1;1 0.3;1 1;1 1',
        keyTimes: '0;0.08;0.16;0.24;0.32;1', dur: flap + 's', begin: '-' + f1(rand() * 3) + 's' }, wings);
    });
  }

  // Reflets qui scintillent sur la mer et le lac de la Source.
  function buildSparkles(parent) {
    var g = geometry(), rand = rng(7), pts = [], tries = 0;
    function nearLand(x, y) {
      return g.islands.some(function (isl) {
        return [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40]].some(function (o) { return inPoly(isl.poly, x + o[0], y + o[1]); });
      });
    }
    while (pts.length < 26 && tries++ < 400) {
      var x = -100 + rand() * (W + 200), y = -60 + rand() * (H + 120);
      if (!nearLand(x, y)) pts.push([x, y]);
    }
    LAKES.forEach(function (l) { pts.push([l.x - l.rx * 0.4, l.y - 5], [l.x + l.rx * 0.35, l.y + 4], [l.x + 4, l.y - 9]); });
    pts.forEach(function (p) {
      var s = el('path', { d: 'M0 -3.2L0.8 0L0 3.2L-0.8 0ZM-3.2 0L0 0.8L3.2 0L0 -0.8Z', class: 'm-sparkle', opacity: 0,
        transform: 'translate(' + f1(p[0]) + ' ' + f1(p[1]) + ')' }, parent);
      var dur = 4 + rand() * 4;
      anim('animate', { attributeName: 'opacity', values: '0;0;0.95;0', keyTimes: '0;0.7;0.82;1', dur: f1(dur) + 's',
        begin: '-' + f1(rand() * dur) + 's' }, s);
    });
  }

  // Cascade : traits d'eau qui défilent vers le bas, écume qui pulse.
  function buildWaterfall(parent) {
    geometry().rivers.forEach(function (r, i) {
      var end = r.line[r.line.length - 1];
      var wf = el('g', { transform: 'translate(' + f1(end[0]) + ' ' + f1(end[1] - 6) + ')' }, parent);
      var clipId = 'm-fall-clip-' + i;
      el('rect', { x: -7, y: 0, width: 14, height: 44 }, el('clipPath', { id: clipId }, wf));
      var streaks = el('g', { 'clip-path': 'url(#' + clipId + ')' }, wf);
      var move = el('g', {}, streaks);
      el('path', { d: 'M-3 -40v12M2 -30v14M-1 -12v10M3 2v12M-3 8v10M1 20v12', class: 'm-water-streak' }, move);
      anim('animateTransform', { attributeName: 'transform', type: 'translate', values: '0 0;0 44', dur: '1.3s' }, move);
      var foam = el('ellipse', { cx: 0, cy: 44, rx: 14, ry: 4, class: 'm-foam' }, wf);
      anim('animate', { attributeName: 'rx', values: '12;17;12', dur: '1.8s' }, foam);
      anim('animate', { attributeName: 'opacity', values: '0.55;0.95;0.55', dur: '1.8s' }, foam);
    });
  }

  // Fumée de la cheminée de la cabane.
  function buildSmoke(parent) {
    LANDMARKS.forEach(function (m) {
      if (m.type !== 'cabin') return;
      var g = el('g', { transform: 'translate(' + (m.x + 6.5) + ' ' + (m.y - 27) + ')' }, parent);
      for (var k = 0; k < 3; k++) {
        var p = el('circle', { r: 2, class: 'm-smoke', opacity: 0 }, g);
        var begin = '-' + f1(k * 1.3) + 's';
        anim('animate', { attributeName: 'cy', values: '0;-30', dur: '3.9s', begin: begin }, p);
        anim('animate', { attributeName: 'cx', values: '0;3;8', dur: '3.9s', begin: begin }, p);
        anim('animate', { attributeName: 'r', values: '2;7', dur: '3.9s', begin: begin }, p);
        anim('animate', { attributeName: 'opacity', values: '0;0.8;0', keyTimes: '0;0.2;1', dur: '3.9s', begin: begin }, p);
      }
    });
  }

  // Faisceau du phare (nuit seulement, voir .m-night) : il tourne, aplati en ellipse (3/4).
  function buildBeam(parent) {
    LANDMARKS.forEach(function (m) {
      if (m.type !== 'lighthouse') return;
      var g = el('g', { class: 'm-night', transform: 'translate(' + m.x + ' ' + (m.y - 52) + ') scale(1 0.42)' }, parent);
      var rot = el('g', {}, g);
      anim('animateTransform', { attributeName: 'transform', type: 'rotate', values: '0;360', dur: '10s' }, rot);
      el('path', { d: 'M0 0L120 -16L120 16Z', class: 'm-beam' }, rot);
      el('circle', { r: 10, class: 'm-beam' }, g);
    });
  }

  // Au niveau du sol (sous les nuages des régions fermées) et dans le ciel (mouettes).
  function buildLive(ground, sky) {
    buildSparkles(ground);
    buildWaterfall(ground);
    buildBoatLoop(ground);
    buildSmoke(ground);
    buildBeam(ground);
    LANDMARKS.forEach(function (m) {
      if (m.type !== 'windmill') return;
      var blades = el('g', { transform: 'translate(' + m.x + ' ' + (m.y - 42) + ')' }, ground);
      var spin = el('g', { class: 'm-windmill-blades' }, blades);
      for (var a = 0; a < 4; a++) {
        var b = el('g', { transform: 'rotate(' + (a * 90 + 20) + ')' }, spin);
        el('rect', { x: -1, y: -30, width: 2, height: 30, class: 'm-wood-dk' }, b);
        el('rect', { x: 1, y: -29, width: 7, height: 20, class: 'm-sail' }, b);
      }
      el('circle', { r: 2.5, class: 'm-wood-dk' }, blades);
    });
    buildGulls(sky);
  }

  // ---- SVG détachés, dessinés en images par mapRaster.js ----
  function detachedSvg() { return document.createElementNS(NS, 'svg'); }
  // Tout ce qui ne dépend pas de la progression : mer, îles, régions, décors, nuages du ciel.
  // Deux parties, pour que l'image nette du zoom (mapRaster.js) glisse les chemins entre le
  // sol et les décors.
  function buildStaticSvg() {
    var ground = detachedSvg(), decor = detachedSvg();
    buildGround(el('g', {}, ground), el('defs', {}, ground));
    buildDecor(el('g', {}, decor));
    buildSkyClouds(el('g', {}, decor));
    return { ground: ground, decor: decor };
  }
  // list : [{ edge, state }]
  function buildEdgesSvg(list) {
    var root = detachedSvg();
    list.forEach(function (it) { drawEdge(root, it.edge, it.state); });
    return root;
  }
  function buildCloudSvg(zoneIds) {
    var root = detachedSvg();
    zoneIds.forEach(function (id) { drawClouds(el('g', {}, root), id); });
    return root;
  }
  function isNight() { return !!App.Theme && App.Theme.current() === 'dark'; }

  App.MapArt = {
    CSS: MAP_CSS,
    injectStyles: injectStyles,
    buildStaticSvg: buildStaticSvg,
    buildCloudSvg: buildCloudSvg,
    buildEdgesSvg: buildEdgesSvg,
    buildLabelsSvg: buildLabelsSvg,
    isNight: isNight,
    W: W,
    H: H,
    geometry: geometry,
    buildGround: buildGround,
    buildDecor: buildDecor,
    buildLabels: buildLabels,
    buildLive: buildLive,
    drawEdge: drawEdge,
    drawObstacle: drawObstacle,
    drawClouds: drawClouds,
    edges: function () { return geometry().edges; },
    zoneAt: function (x, y) { return geometry().biomes.zoneAt(x, y); }
  };
})(window.App = window.App || {});
