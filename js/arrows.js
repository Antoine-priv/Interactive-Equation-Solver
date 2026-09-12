/* Dessine les flèches, routées dans les marges gauche/droite (jamais entre les lignes de texte). */
(function (App) {
  'use strict';
  var SVG_NS = 'http://www.w3.org/2000/svg';
  // Plusieurs conteneurs peuvent avoir chacun leur propre svg de flèches en même temps
  // (les deux colonnes "produit nul" + la chaîne principale) : un id de marker partagé
  // entre ces appels ferait que chacun écrase la définition <marker> des autres (l'id
  // "arrowhead" ne serait alors plus résolu que pour un seul des trois). Un compteur
  // donne un id unique par appel de drawAll.
  var overlaySeq = 0;

  // Courbe quadratique à un seul point de contrôle : arc régulier, jamais de forme "tordue"
  // même quand les deux extrémités ne sont pas alignées horizontalement.
  function buildPathD(x1, y1, x2, y2, bulge) {
    var ctrlX = (x1 + x2) / 2 + bulge;
    var ctrlY = (y1 + y2) / 2;
    return 'M ' + x1 + ' ' + y1 + ' Q ' + ctrlX + ' ' + ctrlY + ', ' + x2 + ' ' + y2;
  }

  // Espace horizontal laissé entre le texte de l'équation et la base/pointe de la flèche.
  // Doit dépasser le padding horizontal du cadre (.eq-line, actuellement 26px) pour que
  // la pointe atterrisse toujours en dehors de son fond coloré.
  var TEXT_GAP = 36;

  function rectsCollide(a, b, margin) {
    return a.left < b.right + margin && b.left < a.right + margin &&
      a.top < b.bottom + margin && b.top < a.bottom + margin;
  }

  function findCollision(rect, others, margin) {
    for (var i = 0; i < others.length; i++) {
      if (rectsCollide(rect, others[i], margin)) return others[i];
    }
    return null;
  }

  // Rectangle réduit vers l'intérieur (le fond d'une étiquette dépasse largement son
  // texte, voir .arrow-label { padding: 4px 12px }) : sert de "hitbox" pour la détection
  // de collision ENTRE étiquettes, afin que leurs fonds puissent légèrement se chevaucher
  // sans jamais que leur texte, lui, se recouvre.
  var LABEL_HITBOX_INSET_X = 9;
  var LABEL_HITBOX_INSET_Y = 3;
  function shrinkRect(rect, insetX, insetY) {
    return { left: rect.left + insetX, right: rect.right - insetX, top: rect.top + insetY, bottom: rect.bottom - insetY };
  }

  // Décale `el` (déjà positionné en `left`/`top`) verticalement pour ne plus chevaucher ni
  // une équation ni un autre libellé déjà placé — mais si les deux ne peuvent pas être
  // évités à la fois, ne fuit plus QUE les équations : mieux vaut deux libellés qui se
  // chevauchent entre eux qu'un libellé qui masque une équation. `equationRects` est donc
  // une contrainte dure (rectangle complet), `placedLabels` une contrainte souple évaluée
  // sur une hitbox réduite (voir shrinkRect) : un léger chevauchement de fond entre deux
  // étiquettes est toléré, pas un chevauchement de texte.
  function avoidLabelCollisions(el, placedLabels, equationRects, ownTopRect, ownBotRect) {
    var margin = 4;
    // el.style.top est en repère LOCAL (non mis à l'échelle, voir computeSideGeometry),
    // alors que tous les rectangles ci-dessous (getBoundingClientRect) sont en repère
    // ÉCRAN (affecté par le zoom App.Canvas, voir canvas.js) : chaque décalage calculé à
    // partir d'eux doit donc repasser en local (/scale) avant de s'ajouter à
    // parseFloat(el.style.top).
    var scale = App.Canvas.getScale();
    var guard;
    for (guard = 0; guard < 12; guard++) {
      var rect = el.getBoundingClientRect();
      var hitbox = shrinkRect(rect, LABEL_HITBOX_INSET_X, LABEL_HITBOX_INSET_Y);
      var eqCollision = findCollision(rect, equationRects, margin);
      var labelCollision = eqCollision ? null : findCollision(hitbox, placedLabels.map(function (p) { return p.hitbox; }), margin);
      var collided = eqCollision || labelCollision;
      if (!collided) break;
      // Le décalage se calcule dans le même repère que le rectangle qui a servi à le
      // détecter (complet pour une équation, hitbox pour un autre libellé) : l'inset
      // vertical étant constant, la translation obtenue reste correcte pour `el` en entier.
      var reference = eqCollision ? rect : hitbox;
      el.style.top = (parseFloat(el.style.top) + (collided.bottom + margin - reference.top) / scale) + 'px';
    }
    // Si on est toujours coincé sur une équation après ces tentatives (ex. plus aucune
    // place sans chevaucher un autre libellé), on abandonne l'évitement des AUTRES
    // libellés et on ne fuit plus que l'équation elle-même.
    for (guard = 0; guard < 12; guard++) {
      var rect2 = el.getBoundingClientRect();
      var eqCollision2 = findCollision(rect2, equationRects, margin);
      if (!eqCollision2) break;
      el.style.top = (parseFloat(el.style.top) + (eqCollision2.bottom + margin - rect2.top) / scale) + 'px';
    }
    // Dernier recours : les deux boucles ci-dessus ne poussent QUE vers le bas (jamais
    // vers le haut), donc rien ne les empêche de faire déborder le libellé sous
    // l'équation du BAS elle-même — celle avec laquelle il forme pourtant sa propre
    // paire (`ownBotRect`, l'équation qui suit directement, voir drawAll) — surtout
    // quand un autre libellé (ex. le membre opposé) ou une équation plus lointaine ont
    // déclenché ces poussées en cascade. On force donc ici le libellé à rester DANS
    // l'écart qui sépare ses deux équations propres : repoussé sous `ownTopRect` s'il
    // empiète encore dessus, puis (priorité, car c'est le bug reporté) ramené AU-DESSUS
    // de `ownBotRect` même si ça réintroduit un léger chevauchement avec `ownTopRect` —
    // mieux vaut recouvrir un peu l'équation du dessus que finir sous celle du dessous,
    // qui donnerait l'impression que le libellé appartient à l'étape suivante.
    if (ownTopRect || ownBotRect) {
      if (ownTopRect) {
        var rTop = el.getBoundingClientRect();
        if (rTop.top < ownTopRect.bottom + margin) {
          el.style.top = (parseFloat(el.style.top) + (ownTopRect.bottom + margin - rTop.top) / scale) + 'px';
        }
      }
      if (ownBotRect) {
        var rBot = el.getBoundingClientRect();
        if (rBot.bottom > ownBotRect.top - margin) {
          el.style.top = (parseFloat(el.style.top) - (rBot.bottom - (ownBotRect.top - margin)) / scale) + 'px';
        }
      }
    }
    var finalRect = el.getBoundingClientRect();
    placedLabels.push({ full: finalRect, hitbox: shrinkRect(finalRect, LABEL_HITBOX_INSET_X, LABEL_HITBOX_INSET_Y) });
  }

  // Géométrie partagée entre le tracé du chemin (path) et le positionnement d'une
  // étiquette, statique (drawSide) ou "live" (positionLiveField) — toutes deux exprimées
  // en coordonnées relatives à `historyRect` (le conteneur passé à drawAll, `#history` ou
  // une colonne "produit nul"). dir: -1 pour le membre gauche (routé dans la marge
  // gauche), +1 pour le membre droit.
  function computeSideGeometry(historyRect, topEl, botEl, dir) {
    var topRect = topEl.getBoundingClientRect();
    var botRect = botEl.getBoundingClientRect();
    var topX = (dir < 0 ? topRect.left : topRect.right) - historyRect.left + dir * TEXT_GAP;
    var botX = (dir < 0 ? botRect.left : botRect.right) - historyRect.left + dir * TEXT_GAP;
    // La base part un peu sous le milieu de la ligne du haut, la pointe vise un peu
    // au-dessus du milieu de la ligne du bas : l'un et l'autre restent à distance du texte.
    var topY = topRect.top + topRect.height * 0.74 - historyRect.top;
    var botY = botRect.top + botRect.height * 0.26 - historyRect.top;
    var available = dir < 0
      ? Math.min(topX, botX)
      : Math.min(historyRect.width - topX, historyRect.width - botX);
    // bulge = décalage du point de contrôle ; le renflement visuel réel d'une quadratique
    // symétrique n'est qu'environ la moitié de cette valeur.
    var bulge = Math.max(34, Math.min(130, available * 1.15)) * dir;
    // Repère ÉCRAN (getBoundingClientRect, affecté par le zoom App.Canvas — voir canvas.js) :
    // ses deux consommateurs (buildPathD/computeLabelAnchor via drawSide/drawMirrorField, où
    // l'élément peint vit dans le repère LOCAL de `history` ; positionLiveField, qui
    // reconvertit lui-même en repère local via l'offset App.Canvas) n'ont pas le même besoin
    // de repère final — chacun divise donc par l'échelle à SON point de consommation plutôt
    // qu'ici, à la source.
    return { topX: topX, topY: topY, botX: botX, botY: botY, bulge: bulge };
  }

  function computeLabelAnchor(geom, dir) {
    var visualBulge = geom.bulge / 2;
    return {
      extremeX: (geom.topX + geom.botX) / 2 + visualBulge + dir * 14,
      midY: (geom.topY + geom.botY) / 2
    };
  }

  // Tracé progressif ("grandit de la base vers la pointe") d'une flèche qui vient
  // d'apparaître — jamais une flèche déjà confirmée, voir le flag `grow` posé par les
  // appelants (drawAll : rows[i].pending / drawFork : fork.preview). stroke-dasharray et
  // --arrow-len sont posés à la longueur RÉELLE du chemin (getTotalLength, seule façon
  // d'obtenir un tracé qui avance à vitesse régulière — un dasharray arbitrairement plus
  // grand que le chemin ne révèlerait le trait qu'en toute fin d'animation, le reste du
  // temps invisible) ; le reste (stroke-dashoffset: var(--arrow-len) -> 0) est purement
  // déclaratif, voir @keyframes arrowGrow dans style.css.
  function markGrowingPath(path) {
    var len = path.getTotalLength();
    path.style.setProperty('--arrow-len', len);
    path.style.strokeDasharray = len;
  }

  // constrainLabels : recale l'étiquette pour rester DANS `historyRect` plutôt que dans
  // la fenêtre entière — nécessaire dans une colonne "produit nul" (étroite, à côté
  // d'une autre équation) pour ne jamais empiéter sur la colonne voisine.
  // grow/growMarkerId : voir markGrowingPath ci-dessus — growMarkerId pointe vers un
  // second <marker> dédié (voir drawAll), jamais celui, partagé, des flèches confirmées :
  // sa propre pointe peut ainsi "apparaître" avec un léger délai (voir .arrowhead-fill-
  // grow dans style.css) sans affecter les pointes, déjà là, de ces autres flèches.
  function drawSide(svg, history, historyRect, topEl, botEl, label, warn, dir, markerId, constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, grow, growMarkerId) {
    var geom = computeSideGeometry(historyRect, topEl, botEl, dir);
    // geom (voir computeSideGeometry) est en repère ÉCRAN, alors que `svg` et `el`
    // ci-dessous vivent tous deux dans le repère LOCAL de `history` (descendants du même
    // #canvasLayer transformé, voir canvas.js) : on divise donc par l'échelle courante à
    // CE point de consommation, pour tout ce qui en est directement issu.
    var scale = App.Canvas.getScale();

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', buildPathD(geom.topX / scale, geom.topY / scale, geom.botX / scale, geom.botY / scale, geom.bulge / scale));
    path.setAttribute('class', 'arrow-path' + (grow ? ' arrow-path-grow' : ''));
    path.setAttribute('marker-end', 'url(#' + (grow ? growMarkerId : markerId) + ')');
    svg.appendChild(path);
    if (grow) markGrowingPath(path);

    if (!label) return;
    var anchor = computeLabelAnchor(geom, dir);
    var localExtremeX = anchor.extremeX / scale;
    var localMidY = anchor.midY / scale;

    var el = document.createElement('div');
    el.className = 'arrow-label ' + (dir < 0 ? 'arrow-label-left' : 'arrow-label-right') +
      (warn ? ' arrow-label-warning' : '');
    el.style.left = localExtremeX + 'px';
    el.style.top = localMidY + 'px';
    // Rendu en LaTeX (comme les équations) : x et signes identiques, plus de police système.
    window.katex.render(label, el, { throwOnError: false, trust: true, strict: false });
    history.appendChild(el);

    // Les libellés longs ("développer 3(2x)", "factoriser par 6") peuvent déborder de
    // l'écran (ou, dans une colonne "produit nul", de la colonne elle-même) sur les
    // membres proches du bord ; on les recale une fois leur largeur connue.
    var margin = 6;
    var rect = el.getBoundingClientRect();
    var boundLeft = constrainLabels ? historyRect.left : 0;
    var boundRight = constrainLabels ? historyRect.right : window.innerWidth;
    // rect/boundLeft/boundRight sont en repère ÉCRAN, localExtremeX déjà en repère LOCAL :
    // la correction (un écart entre deux mesures écran) doit repasser en local (/scale)
    // avant de s'additionner.
    if (rect.left < boundLeft + margin) {
      el.style.left = (localExtremeX + (boundLeft + margin - rect.left) / scale) + 'px';
    } else if (rect.right > boundRight - margin) {
      el.style.left = (localExtremeX - (rect.right - (boundRight - margin)) / scale) + 'px';
    }
    avoidLabelCollisions(el, placedLabels, equationRects, ownTopRect, ownBotRect);
  }

  // Positionne le pavé "live" partagé (le <math-field> lui-même, voir bindLiveOpField
  // dans mathKeypad.js) à l'endroit exact où un pill statique apparaîtrait pour ce côté —
  // même géométrie que drawSide, mais écrite en coordonnées de #canvasLayer (offset
  // App.Canvas inclus, voir canvas.js) plutôt qu'en viewport : le pavé est un enfant
  // PERSISTANT de #canvasLayer (jamais de `history`, reconstruit à chaque frappe, voir
  // renderAll dans render.js), positionné en absolute pour se déplacer avec le contenu
  // SANS le moindre code de synchronisation JS dédié au défilement.
  function positionLiveField(historyRect, topEl, botEl, dir, warn, warnLatex, prefixLatex, constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect) {
    var pillEl = App.MathKeypad.getLiveOpPillEl();
    if (!pillEl) return;
    var geom = computeSideGeometry(historyRect, topEl, botEl, dir);
    var anchor = computeLabelAnchor(geom, dir);

    pillEl.classList.toggle('arrow-label-left', dir < 0);
    pillEl.classList.toggle('arrow-label-right', dir >= 0);
    pillEl.classList.toggle('arrow-label-warning', !!warn);
    var prefixEl = App.MathKeypad.getLiveOpPrefixEl();
    if (prefixLatex) {
      prefixEl.hidden = false;
      window.katex.render(prefixLatex, prefixEl, { throwOnError: false, trust: true, strict: false });
    } else {
      prefixEl.hidden = true;
    }
    var warnEl = App.MathKeypad.getLiveOpWarnEl();
    if (warnLatex) {
      warnEl.hidden = false;
      window.katex.render(warnLatex, warnEl, { throwOnError: false, trust: true, strict: false });
    } else {
      warnEl.hidden = true;
    }
    pillEl.hidden = false;

    var historyScroll = document.getElementById('historyScroll');
    var hsRect = historyScroll ? historyScroll.getBoundingClientRect() : historyRect;
    var scrollLeft = App.Canvas.getX();
    var scrollTop = App.Canvas.getY();
    // pillEl est un enfant DIRECT de #canvasLayer (jamais de `history`, voir plus haut) :
    // contrairement à drawSide (où l'élément peint vit dans le repère LOCAL de `history`,
    // voir sa propre division par l'échelle), on reconstruit ici une position ÉCRAN absolue
    // (historyRect/hsRect, tous deux via getBoundingClientRect) puis on ne repasse en local
    // qu'à la toute fin, comme le fait le recentrage automatique dans render.js — seule la
    // PARTIE écran (le delta measuré depuis hsRect) doit être divisée par l'échelle avant de
    // s'ajouter à scrollLeft/scrollTop (déjà en repère local, voir App.Canvas.getX/getY).
    var scale = App.Canvas.getScale();
    var viewportX = historyRect.left + anchor.extremeX;
    var viewportY = historyRect.top + anchor.midY;
    pillEl.style.left = ((viewportX - hsRect.left) / scale + scrollLeft) + 'px';
    pillEl.style.top = ((viewportY - hsRect.top) / scale + scrollTop) + 'px';

    // Débordement/collision : même logique que drawSide, appliquée au pavé "live".
    var margin = 6;
    var rect = pillEl.getBoundingClientRect();
    var boundLeft = constrainLabels ? historyRect.left : 0;
    var boundRight = constrainLabels ? historyRect.right : window.innerWidth;
    if (rect.left < boundLeft + margin) {
      pillEl.style.left = (parseFloat(pillEl.style.left) + (boundLeft + margin - rect.left) / scale) + 'px';
    } else if (rect.right > boundRight - margin) {
      pillEl.style.left = (parseFloat(pillEl.style.left) - (rect.right - (boundRight - margin)) / scale) + 'px';
    }
    avoidLabelCollisions(pillEl, placedLabels, equationRects, ownTopRect, ownBotRect);
  }

  // "Miroir" du pavé "live" (voir positionLiveField) pour le membre OPPOSÉ, uniquement en
  // mode 'expr' (voir computeLiveOpInfo dans render.js) : la même chaîne tapée s'applique
  // TOUJOURS aux deux membres à la fois, donc les deux affichent un <math-field> — mais un
  // seul (positionLiveField) est le vrai champ partagé (saisie réelle), CELUI-CI n'est
  // qu'un second <math-field> "read-only" recopiant le même texte tapé, recréé à chaque
  // rendu comme un pill statique ordinaire (aucun focus à y préserver, donc aucun besoin
  // de le rendre persistant comme liveOpPill). Un champ en lecture seule ne peut PAS
  // recevoir le focus ni afficher son propre curseur natif (un seul curseur RÉEL possible
  // à la fois, côté "live") : un curseur clignotant FACTICE (voir .arrow-label-mirror-
  // caret) est donc dessiné juste après, pour que les deux membres se ressemblent
  // vraiment comme un DUPLICATA complet plutôt qu'un champ "actif" à côté d'un champ
  // visiblement "éteint". Rendu APRÈS le tracé du chemin (voir l'appel drawSide(..., null,
  // ...) juste avant, dans drawAll) pour la même raison que drawSide : la flèche existe
  // même quand rien n'est encore à afficher.
  //
  // Cliquable (voir .arrow-label-mirror { pointer-events: auto } dans style.css, qui
  // réactive ce qu'un .arrow-label ordinaire désactive) : bascule le VRAI champ live vers
  // CE membre (voir App.Toolbar.switchExprLiveSide/computeLiveOpInfo dans render.js), pour
  // continuer à composer l'opération depuis n'importe quel membre plutôt que rester
  // coincé sur celui de départ — plutôt qu'un champ figé qu'un clic annulerait à tort
  // (voir aussi l'exclusion .arrow-label-mirror dans le clic-en-dehors de toolbar.js).
  function drawMirrorField(history, historyRect, topEl, botEl, dir, warn, rawLatex, warnLatex, constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect) {
    var anchor = computeLabelAnchor(computeSideGeometry(historyRect, topEl, botEl, dir), dir);
    // Voir drawSide : `el` vit dans le repère LOCAL de `history`, anchor est en repère
    // ÉCRAN (computeSideGeometry) — division par l'échelle courante à ce point de
    // consommation.
    var scale = App.Canvas.getScale();
    var localExtremeX = anchor.extremeX / scale;
    var localMidY = anchor.midY / scale;

    var el = document.createElement('div');
    el.className = 'arrow-label arrow-label-mirror ' + (dir < 0 ? 'arrow-label-left' : 'arrow-label-right') +
      (warn ? ' arrow-label-warning' : '');
    el.style.left = localExtremeX + 'px';
    el.style.top = localMidY + 'px';
    // Couvre aussi un clic sur le padding/la réserve ("valide si...") du pill, en dehors
    // de la zone du champ lui-même (voir l'overlay dédié, plus fiable, posé sur CETTE
    // zone-là juste en dessous) — un double appel (overlay ET bulle jusqu'ici) ne fait
    // rien de plus la seconde fois, voir le repli anticipé dans switchExprLiveSide.
    el.addEventListener('click', function () {
      App.Toolbar.switchExprLiveSide(dir < 0 ? 'left' : 'right');
    });
    history.appendChild(el);

    var row = document.createElement('div');
    row.className = 'arrow-label-mirror-row';
    el.appendChild(row);

    var mf = document.createElement('math-field');
    mf.className = 'math-keypad-field';
    mf.setAttribute('tabindex', '-1');
    // Posé en ATTRIBUT AVANT l'ajout au DOM (comme math-virtual-keyboard-policy dans
    // mathKeypad.js/init) plutôt qu'en propriété `.readOnly` après coup : cette dernière
    // retombe sur les options internes de MathLive, pas fiables tant que l'élément n'a
    // pas fini son "upgrade" de custom element.
    mf.setAttribute('read-only', '');
    row.appendChild(mf);
    mf.value = rawLatex || '';

    // Overlay opaque aux évènements pointeur, au-dessus du champ (voir .arrow-label-
    // mirror-overlay dans style.css) : MathLive écoute lui-même "pointerdown" DIRECTEMENT
    // sur le champ (voir connectedCallback dans vendor/mathlive) pour gérer son propre
    // focus/clavier virtuel — sans cet overlay, cliquer PILE sur le champ (le cas le plus
    // courant, vu sa taille dans le pill) laisse MathLive intercepter/stopper l'évènement
    // pour lui-même AVANT qu'il n'atteigne switchExprLiveSide de façon fiable. Un <div>
    // tout bête, sans aucune logique MathLive, capte donc l'interaction à sa place — ce
    // champ en lecture seule ne voit ainsi jamais la moindre interaction. (Séparément : un
    // <math-field> qui vient d'être (re)focalisé a besoin d'un bref instant avant
    // d'accepter la frappe — un trait de MathLive déjà présent partout ailleurs dans
    // l'appli, ex. juste après avoir cliqué "Opération" pour la première fois, voir le
    // délai systématique dans tests/expr_chain_typing.js — sans lien avec CET overlay.)
    // d'un champ" lui fait alors reperdre le focus qu'on venait tout juste de donner au
    // VRAI champ relocalisé, une fraction de seconde après. Un simple listener posé
    // au-dessus (même en phase de capture) ne suffit donc pas : le champ en lecture
    // seule ne doit tout simplement JAMAIS voir cet évènement. Cet overlay, un <div> tout
    // bête sans aucune logique MathLive, capte donc l'interaction à sa place.
    var overlay = document.createElement('div');
    overlay.className = 'arrow-label-mirror-overlay';
    overlay.addEventListener('click', function () {
      App.Toolbar.switchExprLiveSide(dir < 0 ? 'left' : 'right');
    });
    row.appendChild(overlay);

    // Curseur factice (voir commentaire de la fonction) : une simple barre clignotante en
    // CSS, toujours en fin de texte (pas de vraie position à suivre, ce champ n'étant
    // jamais réellement édité) — suffisant pour l'effet "duplicata" recherché.
    var caret = document.createElement('span');
    caret.className = 'arrow-label-mirror-caret';
    row.appendChild(caret);

    if (warnLatex) {
      var warnEl = document.createElement('div');
      warnEl.className = 'arrow-label-live-warn';
      el.appendChild(warnEl);
      window.katex.render(warnLatex, warnEl, { throwOnError: false, trust: true, strict: false });
    }

    var margin = 6;
    var rect = el.getBoundingClientRect();
    var boundLeft = constrainLabels ? historyRect.left : 0;
    var boundRight = constrainLabels ? historyRect.right : window.innerWidth;
    if (rect.left < boundLeft + margin) {
      el.style.left = (localExtremeX + (boundLeft + margin - rect.left) / scale) + 'px';
    } else if (rect.right > boundRight - margin) {
      el.style.left = (localExtremeX - (rect.right - (boundRight - margin)) / scale) + 'px';
    }
    avoidLabelCollisions(el, placedLabels, equationRects, ownTopRect, ownBotRect);
  }

  // Cubique en forme de S : tangente de départ VERTICALE (premier point de contrôle
  // juste sous l'origine, même x — le tronc commun aux deux branches) puis une seconde
  // portion qui s'incurve vers la destination. Le second point de contrôle n'est PAS
  // aligné exactement sur la destination (contrairement au premier sur l'origine) : décalé
  // d'une fraction du trajet, la tangente d'arrivée penche donc légèrement plutôt que
  // d'être forcée verticale — la pointe du triangle (orienté sur cette tangente réelle,
  // "orient=auto") reste cohérente avec le corps de la courbe juste avant elle.
  function buildForkBranchD(oX, oY, dX, dY) {
    var dy = dY - oY;
    var dx = dX - oX;
    var c1y = oY + dy * 0.42;
    var c2y = dY - dy * 0.42;
    var c2x = dX - dx * 0.22;
    return 'M ' + oX + ' ' + oY + ' C ' + oX + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + dX + ' ' + dY;
  }

  // Flèche "produit nul" : part du "=" de la dernière ligne de la chaîne principale, se
  // scinde en deux, et pointe vers le bord (la zone de sélection) de chacune des deux
  // colonnes ci-dessous — pas vers l'équation elle-même, et sans jamais toucher ce bord
  // (petite marge). Distincte du système de flèches classique (une origine, une seule
  // destination) : une origine, plusieurs destinations, dessinée dans le MÊME svg que les
  // flèches de la chaîne principale (voir drawAll). grow/growMarkerId : voir drawSide —
  // seule la fourche d'APERÇU (opts.fork.preview dans drawAll) se trace progressivement,
  // jamais la vraie scission confirmée (même fonction, réutilisée pour les deux).
  function drawFork(svg, history, historyRect, markerId, fromEl, toEls, labelText, placedLabels, equationRects, grow, growMarkerId) {
    var fromRect = fromEl.getBoundingClientRect();
    var originY = fromRect.bottom - historyRect.top + 10;

    var destinations = toEls.map(function (toEl) {
      var toRect = toEl.getBoundingClientRect();
      return {
        rawX: toRect.left + toRect.width / 2 - historyRect.left,
        width: toRect.width,
        // Marge avant la bordure de la colonne : la pointe du triangle ne doit jamais la toucher.
        y: toRect.top - historyRect.top - 10
      };
    });
    // Origine centrée horizontalement entre les destinations plutôt que sur le "="
    // d'origine lui-même : la position de ce "=" dépend de la largeur propre de chaque
    // membre, souvent très asymétrique (ex. "(x+2)(x+3)=0" a un membre gauche bien plus
    // large que "0"), ce qui placerait l'origine presque au-dessus d'une seule colonne —
    // la branche vers l'AUTRE colonne longerait alors son bord dès le départ. Centrer
    // entre les deux destinations garde un tronc commun symétrique, toujours dans
    // l'espace entre les colonnes.
    var originX = destinations.reduce(function (sum, d) { return sum + d.rawX; }, 0) / destinations.length;
    // Nombre de colonnes IMPAIR : celle du milieu est déjà (à peu près) alignée avec
    // l'origine (moyenne des positions, qui coïncide avec la médiane pour un nombre
    // impair de colonnes régulièrement réparties) — sa branche reste donc verticale
    // (aucun "tirage" latéral, voir plus bas), pointant droit vers son propre milieu,
    // plutôt que d'être arbitrairement décalée comme les autres.
    var midIndex = destinations.length % 2 === 1 ? (destinations.length - 1) / 2 : -1;
    // La flèche n'a pas besoin de viser le centre de la colonne : un point plus proche de
    // l'origine (vers l'intérieur, côté du "tronc" commun) réduit la distance horizontale
    // à parcourir, ce qui adoucit la courbe et son angle d'arrivée.
    destinations.forEach(function (d, i) {
      if (i === midIndex) {
        d.x = originX;
        return;
      }
      var pull = d.width * 0.18;
      d.x = d.rawX + (originX < d.rawX ? -pull : pull);
    });

    // Toute la géométrie ci-dessus est mesurée en repère ÉCRAN (getBoundingClientRect,
    // affecté par le zoom App.Canvas) alors que `svg` et `label` vivent tous deux dans le
    // repère LOCAL de `history` (voir drawSide) : division par l'échelle courante à ce
    // point de consommation, pour le chemin comme pour l'étiquette.
    var scale = App.Canvas.getScale();
    destinations.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', buildForkBranchD(originX / scale, originY / scale, d.x / scale, d.y / scale));
      path.setAttribute('class', 'arrow-path' + (grow ? ' arrow-path-grow' : ''));
      path.setAttribute('marker-end', 'url(#' + (grow ? growMarkerId : markerId) + ')');
      svg.appendChild(path);
      if (grow) markGrowingPath(path);
    });

    // Étiquette placée EN DESSOUS du point de scission (pas au-dessus, sur le tronc
    // commun) : peut chevaucher le milieu des flèches, c'est accepté — seules les
    // équations ne doivent jamais être masquées (voir avoidLabelCollisions).
    var avgDestY = destinations.reduce(function (sum, d) { return sum + d.y; }, 0) / destinations.length;
    var labelY = originY + (avgDestY - originY) * 0.4;
    var label = document.createElement('div');
    label.className = 'arrow-label arrow-label-fork';
    label.style.left = (originX / scale) + 'px';
    label.style.top = (labelY / scale) + 'px';
    // `labelText` est du LaTeX déjà prêt à l'affichage (voir splitIntoBranches dans
    // history.js) : "\text{produit nul}" pour l'un (texte), un symbole mathématique brut
    // pour l'autre (ex. "\sqrt{...}" pour la racine carrée) — jamais enveloppé ici, pour
    // ne pas forcer du texte en mode mathématique.
    window.katex.render(labelText || '\\text{produit nul}', label, { throwOnError: false, trust: true, strict: false });
    history.appendChild(label);
    avoidLabelCollisions(label, placedLabels, equationRects);
  }

  // opts.constrainLabels : voir drawSide. opts.fork : { from, to } éléments DOM (voir
  // drawFork) — dessiné dans le même svg, même en l'absence de flèches entre étapes
  // (ex. une équation tapée directement, aussitôt scindée par "Produit nul").
  function drawAll(history, rows, opts) {
    opts = opts || {};
    // Scopé à un enfant DIRECT de `history` : plusieurs conteneurs (les deux colonnes
    // "produit nul" + la chaîne principale) ont chacun leur propre svg de flèches au
    // même moment, il ne faut retirer que celui de CE conteneur, pas celui d'un autre.
    var old = history.querySelector(':scope > svg.arrows-overlay');
    if (old) old.remove();
    // Idem pour les étiquettes (.arrow-label, des <div> ajoutés comme frères du svg, PAS
    // dedans — voir plus bas) : sans ce nettoyage, un appel RETARDÉ (ce sont TOUJOURS des
    // appels planifiés via requestAnimationFrame, voir renderAll dans render.js) dont le
    // rendu d'origine a depuis été remplacé par un rendu plus récent (ex. survol d'un
    // aperçu suivi d'une confirmation avant que le rAF de l'aperçu n'ait eu le temps de
    // s'exécuter) ajoute ses étiquettes, calculées à partir d'éléments désormais détachés
    // du DOM (position (0,0)), dans le conteneur ACTUEL sans jamais les retirer ensuite —
    // elles s'accumulent alors indéfiniment, visibles bloquées en haut à gauche de l'écran.
    Array.prototype.forEach.call(history.querySelectorAll(':scope > .arrow-label'), function (el) {
      el.remove();
    });
    var hasRowArrows = rows.length >= 2;
    var fork = opts.fork;
    var hasFork = fork && fork.from && fork.to && fork.to.length > 0;
    if (!hasRowArrows && !hasFork) return;

    // La ligne/le bloc "pending" qui vient d'apparaître (voir .preview-pop-in dans
    // style.css, posée par render.js) est encore en plein "pop" (transform: scale(...))
    // au moment précis où CE rendu s'exécute — toujours planifié un cran plus tard via
    // requestAnimationFrame (voir renderAll dans render.js), donc bien après l'insertion
    // dans le DOM, mais pas forcément après que l'animation ait fini de grandir. Or
    // TOUTE la géométrie ci-dessous (computeSideGeometry, drawFork) se base sur
    // getBoundingClientRect(), qui reflète ce scale TRANSITOIRE plutôt que la position
    // RÉELLE, au repos, du texte — la flèche viserait alors où le texte se trouvait
    // pendant le "pop", pas où il finit par se stabiliser (la pointe atterrit alors trop
    // loin À L'INTÉRIEUR de l'équation, voir le rapport de bug associé). On neutralise
    // donc temporairement cette seule animation (jamais celles, déjà réglées, des flèches
    // elles-mêmes) le temps de mesurer/tracer, avant de la restaurer : elle reprend alors
    // sa course depuis son tout DÉBUT, mais toujours avant le moindre repaint réel côté
    // utilisateur (tout se joue de façon synchrone, dans le même tick JS), donc sans le
    // moindre saut visible.
    var poppingEls = Array.prototype.slice.call(history.querySelectorAll(':scope > .preview-pop-in'));
    var poppingElsPrevAnimation = poppingEls.map(function (el) { return el.style.animation; });
    poppingEls.forEach(function (el) { el.style.animation = 'none'; });

    overlaySeq += 1;
    var markerId = 'arrowhead-' + overlaySeq;
    // Second marqueur, dédié aux flèches "en train de se tracer" (voir markGrowingPath/
    // drawSide) : sa pointe (.arrowhead-fill-grow) porte sa PROPRE animation d'apparition
    // retardée (voir style.css), un simple `id` partagé avec les flèches déjà confirmées
    // ferait rejouer cette animation sur LEURS pointes aussi à chaque rendu.
    var growMarkerId = markerId + '-grow';

    var historyRect = history.getBoundingClientRect();
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.classList.add('arrows-overlay');

    var defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML =
      '<marker id="' + markerId + '" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">' +
      '<path d="M0,0 L9,5 L0,10 Z" class="arrowhead-fill"/></marker>' +
      '<marker id="' + growMarkerId + '" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">' +
      '<path d="M0,0 L9,5 L0,10 Z" class="arrowhead-fill arrowhead-fill-grow"/></marker>';
    svg.appendChild(defs);
    history.appendChild(svg);

    // Partagé entre tous les libellés dessinés dans CET appel (voir avoidLabelCollisions) :
    // deux libellés proches (ex. les deux facteurs d'un "produit nul", ou des étapes
    // rapprochées) ne se chevauchent jamais si possible, et ne masquent JAMAIS une équation.
    var placedLabels = [];
    var equationRects = rows.map(function (r) {
      var line = r.el.querySelector('.eq-line');
      return line ? line.getBoundingClientRect() : r.el.getBoundingClientRect();
    });

    if (hasRowArrows) {
      for (var i = 1; i < rows.length; i++) {
        var topRow = rows[i - 1].el;
        var botRow = rows[i].el;
        // La ligne "pending" (aperçu, voir rows[].pending posé dans render.js) garde une
        // flèche par côté même sans étiquette, mais SEULEMENT sur le(s) côté(s) que
        // rows[i].pendingForceLeft/pendingForceRight désignent (voir renderChain : les
        // deux pour 'expr', toujours symétrique y compris chaîne encore vide ; seulement
        // le côté qui change réellement pour tout le reste — notamment "factoriser", qui
        // ne porte jamais que sur un seul membre à la fois, voir factorTarget dans
        // history.js). Entre deux étapes déjà validées, pas d'opération sur un membre =>
        // pas de flèche du tout pour ce membre.
        var isPendingLeftArrow = !!rows[i].pending && !!rows[i].pendingForceLeft;
        var isPendingRightArrow = !!rows[i].pending && !!rows[i].pendingForceRight;
        // Se trace progressivement (voir markGrowingPath) dès que la ligne DESTINATION est
        // la ligne "pending"/aperçu — plus large que isPendingLeftArrow/isPendingRightArrow
        // ci-dessus (qui ne couvrent que le besoin d'une flèche SANS étiquette) : l'aperçu
        // racine carrée à une seule ligne, par exemple, garde ses étiquettes "√" normales
        // (rows[i].opLeft/opRight) sans jamais poser pendingForceLeft/Right, mais sa flèche
        // reste bien celle d'un aperçu qui vient d'apparaître.
        // rows[i].pendingIsNew (voir isNewPendingPreview dans render.js) : `undefined` pour
        // les aperçus qui ne suivent pas encore ce mécanisme (racine carrée/produit nul,
        // jamais reconduits d'un survol vers un clic comme "Opération") — traité comme
        // "nouveau" par défaut, `!== false` plutôt que `!!` pour ne pas les faire régresser.
        var isGrowingArrow = !!rows[i].pending && rows[i].pendingIsNew !== false;
        // opts.live (voir computeLiveOpInfo dans render.js) : SEULE la ligne "pending" peut
        // héberger le pavé "live" (le <math-field> partagé), jamais une étape déjà
        // confirmée — sur CE côté, le pill statique habituel (drawSide) est remplacé par
        // le champ éditable lui-même plutôt que dupliqué à côté de lui.
        var liveSide = (rows[i].pending && opts.live) ? opts.live.side : null;
        // opts.live.mirror (voir computeLiveOpInfo) : 'expr' porte TOUJOURS sur les deux
        // membres — le membre qui n'héberge pas le vrai champ affiche un second
        // <math-field> "en lecture seule" (voir drawMirrorField) plutôt qu'un pill KaTeX.
        var mirrorSide = (liveSide && opts.live.mirror) ? (liveSide === 'left' ? 'right' : 'left') : null;
        var topLeft = topRow.querySelector('.side[data-side="left"]');
        var topRight = topRow.querySelector('.side[data-side="right"]');
        var botLeft = botRow.querySelector('.side[data-side="left"]');
        var botRight = botRow.querySelector('.side[data-side="right"]');
        // Bornes dures propres à CETTE paire de lignes (voir le dernier recours dans
        // avoidLabelCollisions) : l'étiquette qui relie topRow à botRow ne doit jamais
        // finir ni sur topRow, ni — priorité — sous botRow, quel que soit ce qui l'a
        // poussée entre-temps (collision avec une équation plus lointaine ou un autre
        // libellé).
        var ownTopRect = equationRects[i - 1];
        var ownBotRect = equationRects[i];
        if (topLeft && botLeft && (isPendingLeftArrow || rows[i].opLeft)) {
          if (liveSide === 'left') {
            drawSide(svg, history, historyRect, topLeft, botLeft, null, false, -1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
            positionLiveField(historyRect, topLeft, botLeft, -1, rows[i].opLeftWarn, opts.live.warnLatex, opts.live.prefixLatex, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect);
          } else if (mirrorSide === 'left') {
            drawSide(svg, history, historyRect, topLeft, botLeft, null, false, -1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
            drawMirrorField(history, historyRect, topLeft, botLeft, -1, rows[i].opLeftWarn, opts.live.rawLatex, opts.live.warnLatex, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect);
          } else {
            drawSide(svg, history, historyRect, topLeft, botLeft, rows[i].opLeft, rows[i].opLeftWarn, -1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
          }
        }
        if (topRight && botRight && (isPendingRightArrow || rows[i].opRight)) {
          if (liveSide === 'right') {
            drawSide(svg, history, historyRect, topRight, botRight, null, false, 1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
            positionLiveField(historyRect, topRight, botRight, 1, rows[i].opRightWarn, opts.live.warnLatex, opts.live.prefixLatex, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect);
          } else if (mirrorSide === 'right') {
            drawSide(svg, history, historyRect, topRight, botRight, null, false, 1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
            drawMirrorField(history, historyRect, topRight, botRight, 1, rows[i].opRightWarn, opts.live.rawLatex, opts.live.warnLatex, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect);
          } else {
            drawSide(svg, history, historyRect, topRight, botRight, rows[i].opRight, rows[i].opRightWarn, 1, markerId, opts.constrainLabels, placedLabels, equationRects, ownTopRect, ownBotRect, isGrowingArrow, growMarkerId);
          }
        }
      }
    }

    if (hasFork) {
      drawFork(svg, history, historyRect, markerId, fork.from, fork.to, fork.label, placedLabels, equationRects, fork.preview, growMarkerId);
    }

    // Restaure l'animation "pop" suspendue plus haut : tout ce qui précède (mesures ET
    // tracé) s'est déroulé de façon purement synchrone, donc rien n'a encore été peint à
    // l'écran avec `animation: none` — la relâcher ici la fait repartir de son tout début
    // sans le moindre saut visible pour l'utilisateur.
    poppingEls.forEach(function (el, i) { el.style.animation = poppingElsPrevAnimation[i]; });
  }

  App.Arrows = {
    drawAll: drawAll
  };
})(window.App = window.App || {});
