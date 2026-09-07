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
  function avoidLabelCollisions(el, placedLabels, equationRects) {
    var margin = 4;
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
      el.style.top = (parseFloat(el.style.top) + (collided.bottom + margin - reference.top)) + 'px';
    }
    // Si on est toujours coincé sur une équation après ces tentatives (ex. plus aucune
    // place sans chevaucher un autre libellé), on abandonne l'évitement des AUTRES
    // libellés et on ne fuit plus que l'équation elle-même.
    for (guard = 0; guard < 12; guard++) {
      var rect2 = el.getBoundingClientRect();
      var eqCollision2 = findCollision(rect2, equationRects, margin);
      if (!eqCollision2) break;
      el.style.top = (parseFloat(el.style.top) + (eqCollision2.bottom + margin - rect2.top)) + 'px';
    }
    var finalRect = el.getBoundingClientRect();
    placedLabels.push({ full: finalRect, hitbox: shrinkRect(finalRect, LABEL_HITBOX_INSET_X, LABEL_HITBOX_INSET_Y) });
  }

  // dir: -1 pour le membre gauche (routé dans la marge gauche), +1 pour le membre droit.
  // constrainLabels : recale l'étiquette pour rester DANS `historyRect` plutôt que dans
  // la fenêtre entière — nécessaire dans une colonne "produit nul" (étroite, à côté
  // d'une autre équation) pour ne jamais empiéter sur la colonne voisine.
  function drawSide(svg, history, historyRect, topEl, botEl, label, warn, dir, markerId, constrainLabels, placedLabels, equationRects) {
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

    var path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', buildPathD(topX, topY, botX, botY, bulge));
    path.setAttribute('class', 'arrow-path');
    path.setAttribute('marker-end', 'url(#' + markerId + ')');
    svg.appendChild(path);

    if (!label) return;
    var visualBulge = bulge / 2;
    var extremeX = (topX + botX) / 2 + visualBulge + dir * 14;
    var midY = (topY + botY) / 2;

    var el = document.createElement('div');
    el.className = 'arrow-label ' + (dir < 0 ? 'arrow-label-left' : 'arrow-label-right') +
      (warn ? ' arrow-label-warning' : '');
    el.style.left = extremeX + 'px';
    el.style.top = midY + 'px';
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
    if (rect.left < boundLeft + margin) {
      el.style.left = (extremeX + (boundLeft + margin - rect.left)) + 'px';
    } else if (rect.right > boundRight - margin) {
      el.style.left = (extremeX - (rect.right - (boundRight - margin))) + 'px';
    }
    avoidLabelCollisions(el, placedLabels, equationRects);
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
  // flèches de la chaîne principale (voir drawAll).
  function drawFork(svg, history, historyRect, markerId, fromEl, toEls, labelText, placedLabels, equationRects) {
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

    destinations.forEach(function (d) {
      var path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', buildForkBranchD(originX, originY, d.x, d.y));
      path.setAttribute('class', 'arrow-path');
      path.setAttribute('marker-end', 'url(#' + markerId + ')');
      svg.appendChild(path);
    });

    // Étiquette placée EN DESSOUS du point de scission (pas au-dessus, sur le tronc
    // commun) : peut chevaucher le milieu des flèches, c'est accepté — seules les
    // équations ne doivent jamais être masquées (voir avoidLabelCollisions).
    var avgDestY = destinations.reduce(function (sum, d) { return sum + d.y; }, 0) / destinations.length;
    var labelY = originY + (avgDestY - originY) * 0.4;
    var label = document.createElement('div');
    label.className = 'arrow-label arrow-label-fork';
    label.style.left = originX + 'px';
    label.style.top = labelY + 'px';
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

    overlaySeq += 1;
    var markerId = 'arrowhead-' + overlaySeq;

    var historyRect = history.getBoundingClientRect();
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.classList.add('arrows-overlay');

    var defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML =
      '<marker id="' + markerId + '" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">' +
      '<path d="M0,0 L9,5 L0,10 Z" class="arrowhead-fill"/></marker>';
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
        // La ligne "pending" (aperçu, voir rows[].pending posé dans render.js) garde ses
        // deux flèches même sans opération ; entre deux étapes déjà validées, pas
        // d'opération sur un membre (ex. factoriser/développer un seul côté) => pas de
        // flèche du tout pour ce membre. Se fier à `pending` plutôt qu'à la simple
        // position (dernière ligne) : une étape déjà confirmée peut très bien être la
        // dernière ligne affichée quand il n'y a rien à prévisualiser en plus (voir
        // shouldShowLivePreview) — elle ne doit alors PAS hériter du traitement "toujours
        // les deux flèches" réservé à la vraie ligne fantôme.
        var isPendingArrow = !!rows[i].pending;
        var topLeft = topRow.querySelector('.side[data-side="left"]');
        var topRight = topRow.querySelector('.side[data-side="right"]');
        var botLeft = botRow.querySelector('.side[data-side="left"]');
        var botRight = botRow.querySelector('.side[data-side="right"]');
        if (topLeft && botLeft && (isPendingArrow || rows[i].opLeft)) {
          drawSide(svg, history, historyRect, topLeft, botLeft, rows[i].opLeft, rows[i].opLeftWarn, -1, markerId, opts.constrainLabels, placedLabels, equationRects);
        }
        if (topRight && botRight && (isPendingArrow || rows[i].opRight)) {
          drawSide(svg, history, historyRect, topRight, botRight, rows[i].opRight, rows[i].opRightWarn, 1, markerId, opts.constrainLabels, placedLabels, equationRects);
        }
      }
    }

    if (hasFork) {
      drawFork(svg, history, historyRect, markerId, fork.from, fork.to, fork.label, placedLabels, equationRects);
    }
  }

  App.Arrows = {
    drawAll: drawAll
  };
})(window.App = window.App || {});
