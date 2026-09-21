/* Clavier mathématique unifié (façon GeoGebra/Desmos) : un unique <math-field> (MathLive,
   vendor/mathlive/) + un pavé de TOUCHES (pas de champ) ancré en bas à droite de l'écran,
   repliable. Remplace progressivement les anciens pavés de toolbar.js (voir le plan
   d'implémentation) — pour l'instant, seule la modale "Nouvelle équation" l'utilise.

   Le <math-field> lui-même reste dans le DOM en permanence (jamais recréé) et vit là où le
   contexte appelant le place (ex. dans la boîte de la modale, pas dans le pavé) : chaque
   appelant fournit son propre `slot` (élément conteneur) à setActiveField, qui y déplace le
   champ partagé — jamais détruit/recréé, pour ne pas perdre le focus/curseur au fil des
   re-rendus. Seul le pavé de TOUCHES reste ancré en bas à droite, indépendamment de
   l'endroit où vit le champ actif. */
(function (App) {
  'use strict';

  var COLLAPSE_KEY = 'equations-keypad-collapsed';

  var KEYBOARD_DOWN_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="4" width="20" height="12" rx="2"/>' +
    '<path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 11h.01M10 11h.01M14 11h.01M18 11h.01M8 13.5h8"/>' +
    '<path d="M12 19v3M9 19.5 12 22l3-2.5"/></svg>';

  var KEYBOARD_UP_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="2" y="4" width="20" height="12" rx="2"/>' +
    '<path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M6 11h.01M10 11h.01M14 11h.01M18 11h.01M8 13.5h8"/>' +
    '<path d="M12 22v-3M9 21.5 12 19l3 2.5"/></svg>';

  var BACKSPACE_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 4H9L2 12l7 8h11a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/>' +
    '<path d="M17 9.5 11.5 15M11.5 9.5 17 15"/></svg>';

  var ENTER_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M20 5v6a2 2 0 0 1-2 2H6"/><path d="M10 9 6 13l4 4"/></svg>';

  var ARROW_LEFT_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/></svg>';

  var ARROW_RIGHT_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
    'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';

  // Associe une touche PHYSIQUE (e.key) à l'identifiant `data-key` de la touche virtuelle
  // correspondante — pour la refléter visuellement en train d'être "pressée" (voir
  // flashPhysicalKey plus bas), même quand la frappe est traitée nativement par MathLive
  // (chiffres/x/parenthèses tapés directement dans le champ focalisé) plutôt que par
  // handleKey ci-dessous. Purement cosmétique : aucune de ces touches n'est réellement
  // ACTIONNÉE ici, seulement mise en surbrillance un court instant.
  var PHYSICAL_KEY_MAP = {
    '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
    '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
    'x': 'x', 'X': 'x',
    '(': '(', ')': ')',
    '+': 'plus', '-': 'minus', '*': 'times', '/': 'div', '=': 'eq',
    ',': ',', '.': ',',
    'Backspace': 'backspace', 'ArrowLeft': 'left', 'ArrowRight': 'right', 'Enter': 'enter'
  };

  // Chaque touche : { label } (texte) ou { html } (SVG/KaTeX déjà construit), et soit
  // `insert` (chaîne LaTeX insérée telle quelle), soit `cmd` (commande MathLive), soit
  // `action` ('enter'/'left'/'right'/'backspace', gérées à part).
  // `key` : identifiant stable posé en attribut `data-key` sur le bouton (voir buildKeys) —
  // pour cibler une touche depuis les tests, comme le veut la convention du projet
  // (tests/README.md : `data-*`/état `App.*`, jamais le texte affiché ou une classe CSS).
  // Grille à 7 colonnes : les 4 rangées ont TOUTES 7 touches réelles, aucune n'a besoin
  // d'un remplissage invisible (voir l'ancien "key-filler", retiré — il ne servait plus
  // qu'à occuper une 8e colonne fantôme, laissant un vide entre les touches et le bord
  // droit du pavé maintenant que celui-ci est ancré au bord de la fenêtre, voir
  // .math-keypad-panel dans style.css) — "enter" n'occupe jamais 2 colonnes (voir son
  // propre commentaire plus bas).
  var KEY_ROWS = [
    [
      { key: 'x', label: 'x', insert: 'x' },
      { key: '(', label: '(', insert: '(' },
      { key: '7', label: '7', insert: '7' },
      { key: '8', label: '8', insert: '8' },
      { key: '9', label: '9', insert: '9' },
      { key: 'times', label: '×', insert: '\\times ' },
      { key: 'div', label: '÷', insert: '\\div ' }
    ],
    [
      { key: 'sq', label: 'x²', insert: '^2' },
      { key: ')', label: ')', insert: ')' },
      { key: '4', label: '4', insert: '4' },
      { key: '5', label: '5', insert: '5' },
      { key: '6', label: '6', insert: '6' },
      { key: 'plus', label: '+', insert: '+' },
      { key: 'minus', label: '−', insert: '-' }
    ],
    [
      { key: 'pow', label: 'xⁿ', insert: '^{#?}' },
      { key: 'frac', label: 'a/b', insert: '\\frac{#@}{#?}' },
      { key: '1', label: '1', insert: '1' },
      { key: '2', label: '2', insert: '2' },
      { key: '3', label: '3', insert: '3' },
      { key: 'eq', label: '=', insert: '=' },
      { key: 'backspace', html: BACKSPACE_SVG, action: 'backspace' }
    ],
    [
      // sqrtKey : quand le champ actif fournit `opts.onSqrt` (voir setActiveField), cette
      // touche appelle ce callback au lieu d'insérer "\sqrt{}" — utilisé par le pavé
      // "Opération" où "√" est une action immédiate (scinder en branches), pas un symbole
      // à composer dans l'expression, voir toolbar.js.
      { key: 'sqrt', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13h3l3 7 5-17h9"/></svg>', insert: '\\sqrt{#@}', sqrtKey: true },
      // squareKey : même principe que sqrtKey ci-dessus, pour le champ actif qui fournit
      // `opts.onSquare` (utilisé par le pavé "Opération" — "élever les deux membres au
      // carré" est, là aussi, une action immédiate, pas un symbole à composer). Sans
      // callback fourni (ex. le champ de la modale "Nouvelle équation"), retombe sur le
      // même repli que "x²" (insert '^2') plutôt que de ne rien faire.
      // Libellé à DEUX points ("‥", U+2025) plutôt que les trois de l'ellipsis normale
      // ("⋯") : sur une touche aussi étroite, "(⋯)²" débordait légèrement du centre de sa
      // cellule ; un point de moins suffit à le recentrer.
      { key: 'square', label: '(‥)²', insert: '^2', squareKey: true },
      { key: ',', label: ',', insert: ',' },
      { key: '0', label: '0', insert: '0' },
      { key: 'left', html: ARROW_LEFT_SVG, action: 'left' },
      { key: 'right', html: ARROW_RIGHT_SVG, action: 'right' },
      // Seule action de validation du pavé (l'ancien bouton "Valider" séparé a été retiré) :
      // une seule cellule comme toute autre touche (jamais `span:2`), pour rester alignée
      // avec la 7e colonne réelle des 3 autres rangées.
      { key: 'enter', html: ENTER_SVG, action: 'enter', primary: true }
    ]
  ];

  var panel = null;
  var keysGrid = null;
  var fieldSlot = null;
  var errorLine = null;
  var peekTab = null;
  var mathField = null;
  var activeField = null;
  var onEnterCb = null;
  var onEscapeCb = null;
  var onInputCb = null;
  var onSqrtCb = null;
  var onSquareCb = null;
  var onTabCb = null;
  var collapsed = false;

  // Doit rester en phase avec la transition CSS de .math-keypad-panel (voir style.css) :
  // durée du fondu/rétrécissement de disparition, après laquelle `hidden` est enfin posé
  // (voir setPanelHidden plus bas).
  var PANEL_VANISH_MS = 180;
  var panelVanishTimer = null;
  var prefersReducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Pavé "live" (voir #liveOpPill dans style.css) : accueille le <math-field> partagé à
  // même la ligne "pending" (pendant qu'une "Opération" ou un facteur commun est en train
  // d'être tapé, voir bindLiveOpField) plutôt que dans le pavé ancré/#controlPanel. Un
  // enfant PERSISTANT de #historyScroll (jamais #history, entièrement reconstruit à
  // chaque frappe, voir renderAll dans render.js) — créé une seule fois ici, repositionné
  // (jamais détruit/reparenté) à chaque rendu par arrows.js (voir positionLiveField).
  var liveOpPill = null;
  var liveOpPrefix = null;
  var liveOpFieldWrap = null;
  var liveOpWarn = null;

  try {
    collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch (e) { /* stockage indisponible : réduit à false */ }

  function render() {
    var show = !!activeField;
    setPanelHidden(!show || collapsed);
    peekTab.hidden = !show || !collapsed;
  }

  // Bascule le pavé visible/masqué en animant l'apparition ("pop", .keypad-pop-in) et la
  // disparition (fondu + rétrécissement, .keypad-vanish) plutôt que de poser `hidden` d'un
  // coup — même chorégraphie que setRowVisibility dans toolbar.js. Idempotent : appelé à
  // chaque render(), donc ne doit rien redéclencher si l'état visuel demandé est déjà celui
  // en cours (y compris EN COURS de disparition).
  function setPanelHidden(hidden) {
    if (prefersReducedMotion) {
      panel.hidden = hidden;
      return;
    }
    // `panel.hidden` seul ne suffit pas : un pavé en cours de disparition a `keypad-vanish`
    // posé mais `hidden` pas encore (posé par le minuteur ci-dessous) — sans le `||`, une
    // disparition suivie d'une réapparition rapide (avant la fin du minuteur) ne serait pas
    // détectée comme un changement d'état réel.
    var currentlyHidden = panel.hidden || panel.classList.contains('keypad-vanish');
    if (hidden === currentlyHidden) return;
    if (panelVanishTimer !== null) { clearTimeout(panelVanishTimer); panelVanishTimer = null; }
    if (hidden) {
      panel.classList.remove('keypad-pop-in');
      // Force un reflow AVANT d'ajouter keypad-vanish : sans lui, retirer une classe
      // d'animation encore active (keypad-pop-in, jamais nettoyée après coup) et ajouter
      // keypad-vanish dans le MÊME tour peut fusionner les deux en une seule frame, sans
      // jamais peindre l'état de départ (opaque) séparément de l'arrivée (transparent) —
      // la transition n'a alors rien à interpoler et saute directement à la cible (même
      // parade que pour l'apparition ci-dessous et que setRowVisibility dans toolbar.js).
      void panel.offsetWidth;
      panel.classList.add('keypad-vanish');
      panelVanishTimer = setTimeout(function () {
        panel.hidden = true;
        panel.classList.remove('keypad-vanish');
        panelVanishTimer = null;
      }, PANEL_VANISH_MS);
    } else {
      panel.classList.remove('keypad-vanish');
      panel.hidden = false;
      // Force un reflow AVANT d'ajouter keypad-pop-in : même parade que setRowVisibility
      // dans toolbar.js (voir son commentaire) — sans lui, le navigateur peut fusionner le
      // `hidden` tout juste retiré avec l'état de départ de l'animation en une seule frame.
      void panel.offsetWidth;
      panel.classList.add('keypad-pop-in');
    }
  }

  function setCollapsed(next) {
    collapsed = next;
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (e) { /* ignore */ }
    render();
  }

  // Met brièvement en surbrillance la touche virtuelle correspondant à une frappe
  // physique (voir PHYSICAL_KEY_MAP) — s'appuie sur un minuteur par bouton (stocké
  // directement dessus) plutôt que sur un couple keydown/keyup : une touche maintenue
  // (répétition du système d'exploitation) redéclenche ce minuteur à chaque répétition et
  // reste donc en surbrillance tout du long, sans dépendre de recevoir un keyup fiable
  // (perdu par ex. si le focus change pendant que la touche est enfoncée).
  function flashPhysicalKey(e) {
    var dataKey = PHYSICAL_KEY_MAP[e.key];
    if (!dataKey || !keysGrid) return;
    var btn = keysGrid.querySelector('[data-key="' + dataKey + '"]');
    if (!btn) return;
    btn.classList.add('key-physical-active');
    clearTimeout(btn._physicalFlashTimer);
    btn._physicalFlashTimer = setTimeout(function () {
      btn.classList.remove('key-physical-active');
    }, 150);
  }

  function handleKey(key) {
    if (!activeField) return;
    activeField.focus();
    if (key.action === 'backspace') { activeField.executeCommand('deleteBackward'); return; }
    if (key.action === 'left') { activeField.executeCommand('moveToPreviousChar'); return; }
    if (key.action === 'right') { activeField.executeCommand('moveToNextChar'); return; }
    if (key.action === 'enter') { if (onEnterCb) onEnterCb(); return; }
    if (key.sqrtKey && onSqrtCb) { onSqrtCb(); return; }
    if (key.squareKey && onSquareCb) { onSquareCb(); return; }
    activeField.executeCommand(['insert', key.insert]);
  }

  function buildKeys() {
    keysGrid.innerHTML = '';
    KEY_ROWS.forEach(function (row) {
      row.forEach(function (key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = key.primary ? 'key-btn panel-confirm-cell' : 'key-btn';
        btn.setAttribute('data-key', key.key);
        if (key.span) btn.style.gridColumn = 'span ' + key.span;
        if (key.html) btn.innerHTML = key.html;
        else btn.textContent = key.label;
        btn.addEventListener('mousedown', function (e) { e.preventDefault(); }); // ne vole pas le focus du champ
        btn.addEventListener('click', function () { handleKey(key); });
        keysGrid.appendChild(btn);
      });
    });
  }

  function init() {
    if (panel) return; // déjà initialisé (init() appelé une seule fois, voir main.js)

    if (window.MathfieldElement) {
      window.MathfieldElement.soundsDirectory = null;
      window.MathfieldElement.decimalSeparator = ',';
    }

    mathField = document.createElement('math-field');
    mathField.setAttribute('math-virtual-keyboard-policy', 'manual');
    mathField.className = 'math-keypad-field';
    // MathLive gère nativement flèches/retour arrière/chiffres (voir isTypingInField dans
    // keyboard.js, qui laisse justement la main ici), mais PAS "Entrée" (rien à committer
    // dans un champ mathématique par défaut) : on la relie nous-mêmes à la même action que
    // la touche "↵" du pavé (seule action de validation, voir KEY_ROWS/buildKeys).
    mathField.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && onEnterCb) {
        e.preventDefault();
        onEnterCb();
      } else if (e.key === 'Escape' && onEscapeCb) {
        e.preventDefault();
        onEscapeCb();
      } else if (e.key === 'Tab' && onTabCb) {
        // Bascule d'un champ à l'autre au clavier physique (ex. "a"/"b" d'une identité
        // remarquable, voir toolbar.js) plutôt que le Tab natif du navigateur (sortir du
        // champ) — seulement quand l'appelant fournit `opts.onTab`. `onTabCb` re-parente
        // en général le champ ailleurs (nouvelle case focalisée, voir bindFactorKeypad) :
        // le faire de façon DIFFÉRÉE (après la fin de ce dispatch d'évènement), par
        // précaution, pour ne jamais déplacer l'élément EN PLEIN MILIEU de son propre
        // gestionnaire keydown.
        e.preventDefault();
        var tabCb = onTabCb;
        setTimeout(function () { tabCb(); }, 0);
      }
    });
    // Aperçu en direct (ex. mode 'expr' d'"Opération", voir toolbar.js) : chaque appelant
    // qui en a besoin fournit `opts.onInput`, appelé à chaque frappe avec le LaTeX courant.
    mathField.addEventListener('input', function () {
      if (onInputCb) onInputCb(mathField.value);
    });
    // Retour visuel "cette touche vient d'être pressée" sur le pavé ancré quand l'élève
    // tape au clavier physique (voir flashPhysicalKey) — sur `document`, pas seulement
    // `mathField`, pour couvrir aussi les touches +/-/×/÷ qui démarrent "Opération" AVANT
    // que le champ soit focalisé (voir keyboard.js).
    document.addEventListener('keydown', flashPhysicalKey);

    panel = document.createElement('div');
    panel.id = 'mathKeypadPanel';
    panel.className = 'math-keypad-panel';
    panel.hidden = true;

    var header = document.createElement('div');
    header.className = 'math-keypad-header';
    var collapseBtn = document.createElement('button');
    collapseBtn.type = 'button';
    collapseBtn.className = 'math-keypad-collapse';
    collapseBtn.title = 'Réduire le clavier';
    collapseBtn.innerHTML = KEYBOARD_DOWN_SVG;
    collapseBtn.addEventListener('click', function () { setCollapsed(true); });
    header.appendChild(collapseBtn);

    // Emplacement par défaut du <math-field> partagé, utilisé quand `setActiveField` est
    // appelé sans `slot` (ex. "Opération", qui n'a pas de modale pour l'héberger — voir
    // toolbar.js) : le champ vit alors ici, dans le pavé lui-même, entre l'en-tête et les
    // touches.
    fieldSlot = document.createElement('div');
    fieldSlot.className = 'math-keypad-field-slot';
    fieldSlot.hidden = true;

    errorLine = document.createElement('div');
    errorLine.className = 'math-keypad-error';
    errorLine.hidden = true;

    keysGrid = document.createElement('div');
    keysGrid.className = 'math-keypad-keys';

    buildKeys();

    panel.appendChild(header);
    panel.appendChild(fieldSlot);
    panel.appendChild(errorLine);
    panel.appendChild(keysGrid);
    document.body.appendChild(panel);

    peekTab = document.createElement('button');
    peekTab.type = 'button';
    peekTab.id = 'mathKeypadPeekTab';
    peekTab.className = 'math-keypad-peek';
    peekTab.title = 'Afficher le clavier';
    peekTab.hidden = true;
    peekTab.innerHTML = KEYBOARD_UP_SVG;
    peekTab.addEventListener('click', function () { setCollapsed(false); });
    document.body.appendChild(peekTab);

    // Voir la déclaration de liveOpPill plus haut : un enfant persistant de #canvasLayer
    // (jamais document.body — doit se déplacer AVEC l'historique, pas rester fixe à
    // l'écran, voir canvas.js), créé une seule fois, jamais retiré du DOM ensuite.
    var canvasLayer = document.getElementById('canvasLayer');
    liveOpPill = document.createElement('div');
    liveOpPill.id = 'liveOpPill';
    // PAS la classe partagée .arrow-label (voir style.css) : cet élément existe en
    // PERMANENCE dans le DOM (juste masqué via `hidden` quand inactif, jamais retiré, voir
    // sa déclaration plus haut), et .arrow-label est utilisée par plusieurs tests Playwright
    // pour compter les étiquettes RÉELLEMENT affichées à un instant donné (ex.
    // no_orphan_labels.js, mul_zero_warning.js) — le compte serait faussé par cet élément
    // toujours présent, même masqué. .arrow-label-live porte donc sa PROPRE copie des
    // styles de base nécessaires (voir style.css).
    liveOpPill.className = 'arrow-label-live';
    liveOpPill.hidden = true;
    // Rangée horizontale "préfixe + champ" (ex. "factoriser par [champ]", voir
    // liveOpPrefix/positionLiveField dans arrows.js) — la réserve ("valide si..."), elle,
    // reste EN DESSOUS de cette rangée, jamais dedans (voir liveOpWarn plus bas).
    var liveOpRow = document.createElement('div');
    liveOpRow.className = 'arrow-label-live-row';
    liveOpPrefix = document.createElement('span');
    liveOpPrefix.className = 'arrow-label-live-prefix';
    liveOpPrefix.hidden = true;
    liveOpRow.appendChild(liveOpPrefix);
    liveOpFieldWrap = document.createElement('div');
    liveOpRow.appendChild(liveOpFieldWrap);
    liveOpPill.appendChild(liveOpRow);
    liveOpWarn = document.createElement('div');
    liveOpWarn.className = 'arrow-label-live-warn';
    liveOpWarn.hidden = true;
    liveOpPill.appendChild(liveOpWarn);
    if (canvasLayer) canvasLayer.appendChild(liveOpPill);
  }

  // Déplace le <math-field> partagé dans le pavé "live" de la ligne "pending" (voir
  // liveOpPill ci-dessus) au lieu d'un emplacement du pavé ancré/#controlPanel — utilisé
  // par le mode 'expr' ("Opération") et 'factor'/'common' (facteur commun), voir
  // bindMathKeypad/bindFactorKeypad dans toolbar.js. Rend le pavé visible ET focalise le
  // champ immédiatement (avant même que arrows.js ne le positionne précisément au prochain
  // rendu — un élément masqué ne peut pas recevoir le focus) ; ne JAMAIS appeler ceci à
  // chaque rendu (seulement sur une vraie transition d'entrée dans le mode, comme
  // setActiveField), sous peine de réinitialiser le curseur/contenu à chaque frappe.
  function bindLiveOpField(opts, initialLatex) {
    liveOpPill.hidden = false;
    setActiveField(liveOpFieldWrap, opts, initialLatex);
  }

  // Accesseurs DOM bruts pour arrows.js/positionLiveField, seul endroit qui repositionne
  // réellement le pavé (coordonnées calculées après mise en page, recalculées à chaque
  // rendu), rend le texte de la réserve ("valide si ...") dans liveOpWarn, et le préfixe
  // ("factoriser par", voir liveOpPrefix) dans liveOpPrefix.
  function getLiveOpPillEl() { return liveOpPill; }
  function getLiveOpPrefixEl() { return liveOpPrefix; }
  function getLiveOpWarnEl() { return liveOpWarn; }

  // Masque le pavé "live" sans désengager le champ (voir hideLiveOpPill) — utilisé par
  // render.js dès que la ligne "pending" en cours n'a de toute façon aucun côté "live" à
  // montrer cette fois-ci (ex. racine carrée armée, voir shouldShowLivePreview) : appelé
  // de façon SYNCHRONE (jamais depuis le rAF différé de drawAll) pour ne jamais laisser le
  // champ visible un instant à une position obsolète avant d'être cliché lors du dessin.
  function hideLiveOpPill() {
    if (liveOpPill) liveOpPill.hidden = true;
  }

  // Lie le pavé à un champ logique : `slot` est l'élément DOM qui doit accueillir le
  // <math-field> partagé (jamais détruit/recréé, voir en-tête de fichier) — omis (null/
  // undefined) pour utiliser l'emplacement interne par défaut, DANS le pavé lui-même (voir
  // fieldSlot dans init, cas "Opération" qui n'a pas de modale). `opts.onEnter` est appelé
  // par la touche "↵" du pavé ET par la touche Entrée du clavier physique (même action) ;
  // `opts.onEscape` (optionnel) par la touche Échap physique — ex. fermer la modale
  // "Nouvelle équation" sans rien valider ; `opts.onInput` (optionnel) à chaque frappe, avec
  // le LaTeX courant (aperçu en direct) ; `opts.onSqrt` (optionnel) redéfinit la touche "√"
  // pour appeler ce callback au lieu d'insérer "\sqrt{}" (voir sqrtKey dans KEY_ROWS) ;
  // `opts.onSquare` (optionnel), même principe pour la touche "(⋯)²" (voir squareKey) ;
  // `opts.onTab` (optionnel) par la touche Tab physique au lieu de son comportement natif
  // (sortir du champ) — ex. basculer entre les champs "a"/"b" d'une identité remarquable.
  // `initialLatex` préremplit le champ.
  function setActiveField(slot, opts, initialLatex) {
    var target = slot || fieldSlot;
    if (target === fieldSlot) fieldSlot.hidden = false;
    else fieldSlot.hidden = true;
    target.appendChild(mathField);
    mathField.value = initialLatex || '';
    activeField = mathField;
    onEnterCb = (opts && opts.onEnter) || null;
    onEscapeCb = (opts && opts.onEscape) || null;
    onInputCb = (opts && opts.onInput) || null;
    onSqrtCb = (opts && opts.onSqrt) || null;
    onSquareCb = (opts && opts.onSquare) || null;
    onTabCb = (opts && opts.onTab) || null;
    setError(null);
    render();
    focusField();
  }

  // Message d'erreur affiché sous le champ (ex. "Parenthèse non fermée." pour la chaîne
  // "Opération" en cours de saisie) — `null`/'' le masque. Pas de DOM de modale ici (voir
  // en-tête de fichier), donc porté par le pavé lui-même plutôt que par l'appelant.
  function setError(message) {
    errorLine.textContent = message || '';
    errorLine.hidden = !message;
  }

  // Ajuste l'état affiché d'UNE touche par son `data-key` (voir KEY_ROWS) — pour une touche
  // dont la disponibilité dépend d'un état propre à l'appelant plutôt que du pavé
  // lui-même (ex. "√" en mode "Opération", grisée selon la forme de l'équation, voir
  // bindMathKeypad dans toolbar.js) : le pavé reste générique, c'est l'appelant qui sait
  // QUAND l'appliquer. `state.disabled`/`state.pressed`/`state.title` sont chacun
  // optionnels (omis = inchangé).
  function setKeyState(keyName, state) {
    var btn = keysGrid.querySelector('[data-key="' + keyName + '"]');
    if (!btn) return;
    if (state.disabled !== undefined) btn.disabled = state.disabled;
    if (state.pressed !== undefined) btn.classList.toggle('key-pressed', state.pressed);
    if (state.title !== undefined) btn.title = state.title;
  }

  // Grise/dégrise TOUTES les touches sauf celles listées dans `exceptKeys` — ex. "√"
  // armée (voir bindMathKeypad dans toolbar.js) : plus rien d'autre à composer avec tant
  // qu'elle n'est pas désarmée ou validée, seuls un second clic sur "√" et "↵" (pour
  // confirmer la scission) restent possibles.
  function setAllKeysDisabled(disabled, exceptKeys) {
    Array.prototype.forEach.call(keysGrid.querySelectorAll('.key-btn'), function (btn) {
      if (exceptKeys.indexOf(btn.getAttribute('data-key')) === -1) btn.disabled = disabled;
    });
  }

  // Ré-ouvrir la modale juste après une fermeture (ex. boucle "Générer aléatoirement" +
  // Valider répétée) fait parfois planter la gestion interne focus/blur de MathLive (bug
  // de la librairie : "Cannot read properties of undefined (reading 'options')" dans
  // atomToString/getValue, en rappelant onBlur sur un état interne pas encore stabilisé) —
  // sans aucune conséquence observable (le champ reste utilisable normalement juste après),
  // d'où le try/catch : on ne laisse pas un détail interne de la librairie faire planter
  // l'appli ni polluer la console pour rien.
  function focusField() {
    try { mathField.focus(); } catch (e) { /* voir commentaire ci-dessus */ }
  }

  function clearActiveField() {
    activeField = null;
    onEnterCb = null;
    onEscapeCb = null;
    onInputCb = null;
    onSqrtCb = null;
    onSquareCb = null;
    onTabCb = null;
    fieldSlot.hidden = true;
    hideLiveOpPill();
    setError(null);
    render();
  }

  // Insère `latex` au curseur du champ actif — même geste que handleKey ci-dessus pour une
  // touche `insert` ordinaire, exposé pour un bouton VIVANT EN DEHORS du pavé de touches
  // (ex. le sélecteur de relation =/>/</\geq/\leq de la modale "Nouvelle équation", voir
  // newEquationModal.js — ces tokens ne vivent pas dans KEY_ROWS pour ne pas apparaître
  // aussi dans le champ "Opération" en cours de résolution, où une relation n'a pas de
  // sens).
  function insertAtCursor(latex) {
    if (!activeField) return;
    activeField.focus();
    activeField.executeCommand(['insert', latex]);
  }

  function getLatex() {
    return mathField ? mathField.value : '';
  }

  function setLatex(latex) {
    if (mathField) mathField.value = latex || '';
  }

  App.MathKeypad = {
    init: init,
    setActiveField: setActiveField,
    clearActiveField: clearActiveField,
    insertAtCursor: insertAtCursor,
    getLatex: getLatex,
    setLatex: setLatex,
    setError: setError,
    setKeyState: setKeyState,
    setAllKeysDisabled: setAllKeysDisabled,
    bindLiveOpField: bindLiveOpField,
    getLiveOpPillEl: getLiveOpPillEl,
    getLiveOpPrefixEl: getLiveOpPrefixEl,
    getLiveOpWarnEl: getLiveOpWarnEl,
    hideLiveOpPill: hideLiveOpPill
  };
})(window.App = window.App || {});
