const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function approx(a, b, eps) {
  return Math.abs(a - b) < (eps || 0.001);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+3=7');
  await page.waitForTimeout(100);

  // 1) Etat initial : zoom 1, aucun bouton desactive, icones loupe presentes.
  let scale = await page.evaluate(() => window.App.Canvas.getScale());
  ok('scale initiale = 1', scale === 1);
  let inDisabled = await page.evaluate(() => document.getElementById('zoomInBtn').disabled);
  let outDisabled = await page.evaluate(() => document.getElementById('zoomOutBtn').disabled);
  ok('zoomInBtn actif au depart', inDisabled === false);
  ok('zoomOutBtn actif au depart', outDisabled === false);
  const hasIcons = await page.evaluate(() =>
    !!document.querySelector('#zoomInBtn svg') && !!document.querySelector('#zoomOutBtn svg'));
  ok('icones loupe presentes sur les deux boutons', hasIcons);

  // 2) Clic "zoom avant" : l'echelle augmente et le transform de #canvasLayer la reflete.
  await page.click('#zoomInBtn');
  await page.waitForTimeout(200);
  scale = await page.evaluate(() => window.App.Canvas.getScale());
  ok('zoom avant augmente l\'echelle (' + scale + ')', scale > 1);
  const transformHasScale = await page.evaluate((s) => {
    var m = new DOMMatrixReadOnly(getComputedStyle(document.getElementById('canvasLayer')).transform);
    return Math.abs(m.a - s) < 0.01;
  }, scale);
  ok('le transform CSS reflete bien cette echelle', transformHasScale);

  // 3) Clic "zoom arriere" repete : revient sous 1, puis se bloque a la borne basse (0.4)
  // et desactive le bouton (un bouton HTML "disabled" refuse tout clic natif, d'ou l'arret
  // de la boucle des qu'il l'est) — jamais en dessous.
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => document.getElementById('zoomOutBtn').disabled)) break;
    await page.click('#zoomOutBtn');
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);
  scale = await page.evaluate(() => window.App.Canvas.getScale());
  outDisabled = await page.evaluate(() => document.getElementById('zoomOutBtn').disabled);
  ok('zoom arriere clampe a 0.4 (' + scale + ')', approx(scale, 0.4, 0.01));
  ok('zoomOutBtn desactive a la borne basse', outDisabled === true);

  // 4) Symetrique vers le haut : borne haute (2.5), bouton desactive.
  for (let i = 0; i < 20; i++) {
    if (await page.evaluate(() => document.getElementById('zoomInBtn').disabled)) break;
    await page.click('#zoomInBtn');
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);
  scale = await page.evaluate(() => window.App.Canvas.getScale());
  inDisabled = await page.evaluate(() => document.getElementById('zoomInBtn').disabled);
  ok('zoom avant clampe a 2.5 (' + scale + ')', approx(scale, 2.5, 0.01));
  ok('zoomInBtn desactive a la borne haute', inDisabled === true);

  // 5) Ctrl+molette : zoom centre sur le curseur, sans passer par les boutons.
  const hsBox = await page.locator('#historyScroll').boundingBox();
  await page.mouse.move(hsBox.x + hsBox.width / 2, hsBox.y + hsBox.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 500); // molette "vers le bas" -> zoom arriere
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const scaleAfterCtrlWheel = await page.evaluate(() => window.App.Canvas.getScale());
  ok('Ctrl+molette (bas) reduit l\'echelle depuis 2.5 (' + scaleAfterCtrlWheel + ')', scaleAfterCtrlWheel < 2.5);

  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -500); // molette "vers le haut" -> zoom avant
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  const scaleAfterCtrlWheelUp = await page.evaluate(() => window.App.Canvas.getScale());
  ok('Ctrl+molette (haut) augmente a nouveau l\'echelle (' + scaleAfterCtrlWheelUp + ')', scaleAfterCtrlWheelUp > scaleAfterCtrlWheel);

  // 6) Une molette SANS Ctrl continue de panorâmer la toile (pas de regression sur le
  // comportement existant, voir initCanvasPan dans main.js).
  const xBefore = await page.evaluate(() => window.App.Canvas.getX());
  await page.mouse.wheel(80, 0);
  await page.waitForTimeout(100);
  const xAfter = await page.evaluate(() => window.App.Canvas.getX());
  ok('molette sans Ctrl panorame toujours la toile', xAfter !== xBefore);

  // Repart d'un panorama/zoom neutres (App.Canvas.set/zoomAt) avant de continuer : le
  // recentrage automatique d'une NOUVELLE equation (renderAll dans render.js) ne gere que
  // l'axe vertical pour la chaine principale (le centrage horizontal normal vient du CSS
  // "justify-content: center" de .eq-row, voir CLAUDE.md) — un panorama horizontal
  // manuel prononcé (comme le mouse.wheel(80, 0) ci-dessus) peut donc laisser une equation
  // fraichement créée hors du viewport, un comportement déjà présent AVANT ce zoom (verifié
  // en reproduisant le même panorama sans jamais toucher au zoom), pas une régression liée
  // au zoom — sans intérêt pour la suite de ce test, qui vérifie seulement que tout reste
  // utilisable/bien positionné UNE FOIS zoomé, pas la reconstitution d'un panorama extrême.
  // window.App.Zoom.wheelZoom(0, ...) : deltaY=0 => facteur 1 (aucun changement d'échelle
  // réel), mais passe par App.Zoom plutôt que App.Canvas.zoomAt directement pour aussi
  // rafraîchir l'état "disabled" des boutons loupe (voir refreshButtons dans zoom.js) —
  // sinon un bouton resté désactivé après un appel bas niveau à App.Canvas.zoomAt (comme
  // celui juste avant) refuserait tout clic natif ultérieur dans ce test, alors qu'un
  // vrai utilisateur ne passe JAMAIS par cette API bas niveau (seul App.Zoom le fait).
  await page.evaluate(() => { window.App.Canvas.set(0, 0); window.App.Canvas.zoomAt(1); window.App.Zoom.wheelZoom(0, 0, 0); });
  await page.waitForTimeout(100);

  // 7) La fenêtre d'action flottante (#opButtons, voir positionPanel dans toolbar.js) reste
  // ancrée sur la ligne "current" à travers zoom ET panorama : elle est un enfant PERSISTANT
  // de #canvasLayer, donc positionnée UNE FOIS en repère LOCAL (non affecté par le
  // `transform` de son ancêtre) doit suivre le transform SANS recalcul — nécessite
  // `#canvasLayer { transform-origin: 0 0 }` (voir style.css) pour que la relation
  // écran = échelle × (local − offset) posée dans canvas.js reste vraie une fois zoom ≠ 1
  // (le défaut CSS, le CENTRE de la boîte, la casserait), ET que cliquer les boutons
  // loupe n'annule pas la sélection en cours (voir l'exclusion #zoomInBtn/#zoomOutBtn dans
  // le clic-en-dehors de toolbar.js).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '3x+5=17');
  await page.waitForTimeout(150);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.waitForTimeout(150);

  function panelGapAndDy(panel, anchor) {
    return { gap: anchor.x - (panel.x + panel.width), dy: (panel.y + panel.height / 2) - (anchor.y + anchor.height / 2) };
  }
  let panelBox = await page.locator('#opButtons').boundingBox();
  let anchorBox = await page.locator('.eq-row.current .eq-line').boundingBox();
  let rel = panelGapAndDy(panelBox, anchorBox);
  ok('fenêtre d\'action correctement alignée avant tout zoom (dy=' + rel.dy.toFixed(2) + ')', approx(rel.dy, 0, 1));

  await page.click('#zoomInBtn');
  await page.click('#zoomInBtn');
  await page.waitForTimeout(300);
  const selectionAfterZoomClicks = await page.evaluate(() => window.App.History.getPending().selectedLeft);
  ok('cliquer les boutons loupe ne desselectionne pas le terme en cours', JSON.stringify(selectionAfterZoomClicks) === '[0]');
  const scaleNow = await page.evaluate(() => window.App.Canvas.getScale());
  panelBox = await page.locator('#opButtons').boundingBox();
  anchorBox = await page.locator('.eq-row.current .eq-line').boundingBox();
  rel = panelGapAndDy(panelBox, anchorBox);
  ok('fenêtre d\'action reste alignée verticalement apres 2 clics "zoom avant" (dy=' + rel.dy.toFixed(2) + ')', approx(rel.dy, 0, 1));
  ok('l\'ecart avec l\'equation suit l\'echelle courante (gap=' + rel.gap.toFixed(2) + ' vs attendu ' + (26 * scaleNow).toFixed(2) + ')', approx(rel.gap, 26 * scaleNow, 1));

  await page.mouse.wheel(120, 60);
  await page.waitForTimeout(150);
  panelBox = await page.locator('#opButtons').boundingBox();
  anchorBox = await page.locator('.eq-row.current .eq-line').boundingBox();
  rel = panelGapAndDy(panelBox, anchorBox);
  ok('fenêtre d\'action reste alignée apres un panorama (molette) une fois zoomee (dy=' + rel.dy.toFixed(2) + ')', approx(rel.dy, 0, 1));

  // 8) Le zoom lui-même reste ancré : le point local qui était pile au centre du viewport
  // avant un clic "zoom avant" doit toujours peindre exactement à ce même centre après —
  // pas seulement "un zoom qui se produit quelque part".
  // window.App.Zoom.wheelZoom(0, ...) : deltaY=0 => facteur 1 (aucun changement d'échelle
  // réel), mais passe par App.Zoom plutôt que App.Canvas.zoomAt directement pour aussi
  // rafraîchir l'état "disabled" des boutons loupe (voir refreshButtons dans zoom.js) —
  // sinon un bouton resté désactivé après un appel bas niveau à App.Canvas.zoomAt (comme
  // celui juste avant) refuserait tout clic natif ultérieur dans ce test, alors qu'un
  // vrai utilisateur ne passe JAMAIS par cette API bas niveau (seul App.Zoom le fait).
  await page.evaluate(() => { window.App.Canvas.set(0, 0); window.App.Canvas.zoomAt(1); window.App.Zoom.wheelZoom(0, 0, 0); });
  await page.waitForTimeout(100);
  const anchorCheck = await page.evaluate(() => {
    var scroller = document.getElementById('historyScroll');
    var before = { x: window.App.Canvas.getX(), y: window.App.Canvas.getY(), s: window.App.Canvas.getScale() };
    var vcx = scroller.clientWidth / 2, vcy = scroller.clientHeight / 2;
    var localAtCenter = { x: before.x + vcx / before.s, y: before.y + vcy / before.s };
    window.App.Canvas.zoomAt(before.s * 1.5, vcx, vcy);
    var after = { x: window.App.Canvas.getX(), y: window.App.Canvas.getY(), s: window.App.Canvas.getScale() };
    return {
      screenX: after.s * (localAtCenter.x - after.x),
      screenY: after.s * (localAtCenter.y - after.y),
      vcx: vcx, vcy: vcy
    };
  });
  ok('le zoom (bouton, centré sur le viewport) garde le point central immobile à l\'écran (x=' +
    anchorCheck.screenX.toFixed(2) + ' vs ' + anchorCheck.vcx.toFixed(2) + ', y=' + anchorCheck.screenY.toFixed(2) + ' vs ' + anchorCheck.vcy.toFixed(2) + ')',
    approx(anchorCheck.screenX, anchorCheck.vcx, 1) && approx(anchorCheck.screenY, anchorCheck.vcy, 1));

  // Même ancrage, mais PENDANT l'animation "smooth" (boutons loupe) et pas seulement à la
  // fin : le point central doit rester immobile à chaque frame peinte, pas filer vers le
  // bas-droite puis se rattraper (voir l'ordre translate/scale dans apply(), canvas.js).
  const midAnimCheck = await page.evaluate(async () => {
    var scroller = document.getElementById('historyScroll');
    var layer = document.getElementById('canvasLayer');
    window.App.Canvas.zoomAt(1); window.App.Canvas.set(0, 0);
    var vcx = scroller.clientWidth / 2, vcy = scroller.clientHeight / 2;
    var local = { x: vcx, y: vcy };
    window.App.Canvas.zoomAt(2, vcx, vcy, { behavior: 'smooth' });
    var samples = [];
    for (var i = 0; i < 4; i++) {
      await new Promise(function (r) { setTimeout(r, 40); });
      var m = new DOMMatrixReadOnly(getComputedStyle(layer).transform);
      samples.push({ s: m.a, dx: m.a * local.x + m.m41 - vcx, dy: m.d * local.y + m.m42 - vcy });
    }
    return samples;
  });
  console.log('echantillons en cours d\'animation:', JSON.stringify(midAnimCheck));
  ok('au moins un échantillon pris en cours de transition (echelle strictement entre 1 et 2)',
    midAnimCheck.some(function (p) { return p.s > 1.01 && p.s < 1.99; }));
  ok('le point central reste immobile PENDANT l\'animation du zoom',
    midAnimCheck.every(function (p) { return Math.abs(p.dx) < 1 && Math.abs(p.dy) < 1; }));
  await page.waitForTimeout(400);

  const cursorAnchorCheck = await page.evaluate(() => {
    var before = { x: window.App.Canvas.getX(), y: window.App.Canvas.getY(), s: window.App.Canvas.getScale() };
    var cursor = { x: 180, y: 260 }; // point volontairement hors du centre du viewport
    var localAtCursor = { x: before.x + cursor.x / before.s, y: before.y + cursor.y / before.s };
    window.App.Zoom.wheelZoom(-200, cursor.x, cursor.y);
    var after = { x: window.App.Canvas.getX(), y: window.App.Canvas.getY(), s: window.App.Canvas.getScale() };
    return {
      screenX: after.s * (localAtCursor.x - after.x),
      screenY: after.s * (localAtCursor.y - after.y),
      cursor: cursor
    };
  });
  ok('le zoom (Ctrl+molette, centré sur le curseur) garde ce point immobile a l\'écran (x=' +
    cursorAnchorCheck.screenX.toFixed(2) + ' vs ' + cursorAnchorCheck.cursor.x + ', y=' + cursorAnchorCheck.screenY.toFixed(2) + ' vs ' + cursorAnchorCheck.cursor.y + ')',
    approx(cursorAnchorCheck.screenX, cursorAnchorCheck.cursor.x, 1) && approx(cursorAnchorCheck.screenY, cursorAnchorCheck.cursor.y, 1));

  // window.App.Zoom.wheelZoom(0, ...) : deltaY=0 => facteur 1 (aucun changement d'échelle
  // réel), mais passe par App.Zoom plutôt que App.Canvas.zoomAt directement pour aussi
  // rafraîchir l'état "disabled" des boutons loupe (voir refreshButtons dans zoom.js) —
  // sinon un bouton resté désactivé après un appel bas niveau à App.Canvas.zoomAt (comme
  // celui juste avant) refuserait tout clic natif ultérieur dans ce test, alors qu'un
  // vrai utilisateur ne passe JAMAIS par cette API bas niveau (seul App.Zoom le fait).
  await page.evaluate(() => { window.App.Canvas.set(0, 0); window.App.Canvas.zoomAt(1); window.App.Zoom.wheelZoom(0, 0, 0); });
  await page.waitForTimeout(100);

  // 9) L'equation reste utilisable une fois zoomee : cliquer un terme le selectionne toujours,
  // sans erreur JS (verifie au passage tout le recalage d'ecran/local dans arrows.js/render.js).
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('(x+2)(x+3)=0')); });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.Canvas.zoomAt(1.6));
  await page.waitForTimeout(200);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  const selectedAfterZoom = await page.evaluate(() => !!window.App.History.getPending().selectedFactors.left);
  ok('selection d\'un terme fonctionne toujours une fois zoome', selectedAfterZoom);

  // 10) "Produit nul" (scission en colonnes, flèches + étiquettes recalculées) sous zoom :
  // ne doit produire ni NaN ni erreur JS dans le positionnement (arrows.js/toolbar.js).
  // Clic DOM direct (comme branch_scroll_center2.js) plutôt que page.click : le pavé
  // d'actions suit l'équation active et peut légitimement déborder du viewport une fois
  // zoomé (une ligne large, positionnée à gauche d'elle, voir positionPanel dans
  // toolbar.js) — Playwright refuserait alors le clic "hors viewport" alors que l'appli,
  // elle, fonctionne très bien (l'utilisateur panorâmerait simplement pour l'atteindre).
  await page.evaluate(() => document.querySelector('button[data-op="produitnul"]').click());
  await page.waitForTimeout(300);
  const geomOk = await page.evaluate(() => {
    var els = document.querySelectorAll('.arrow-label, #opButtons');
    for (var i = 0; i < els.length; i++) {
      var l = parseFloat(els[i].style.left);
      var t = parseFloat(els[i].style.top);
      if (isNaN(l) || isNaN(t)) return false;
    }
    return true;
  });
  ok('aucune position NaN pour les etiquettes/le panneau sous "produit nul" zoome', geomOk);

  await page.screenshot({ path: `${SCRATCH}/zoom_controls.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
