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
  await page.evaluate(() => { window.App.Canvas.set(0, 0); window.App.Canvas.zoomAt(1); });
  await page.waitForTimeout(100);

  // 7) L'equation reste utilisable une fois zoomee : cliquer un terme le selectionne toujours,
  // sans erreur JS (verifie au passage tout le recalage d'ecran/local dans arrows.js/render.js).
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('(x+2)(x+3)=0')); });
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.Canvas.zoomAt(1.6));
  await page.waitForTimeout(200);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  const selectedAfterZoom = await page.evaluate(() => !!window.App.History.getPending().selectedFactors.left);
  ok('selection d\'un terme fonctionne toujours une fois zoome', selectedAfterZoom);

  // 8) "Produit nul" (scission en colonnes, flèches + étiquettes recalculées) sous zoom :
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
