const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Retour utilisateur : choisir +/−/‖ dans une case du "Tableau de signes" faisait bouger
// les flèches d'opération des colonnes de facteurs au-dessus. Cause : une fois zoomé
// (App.Canvas scale != 1), arrows.js mêlait des constantes LOCALES (TEXT_GAP, bornes du
// bulge, marges) à des mesures ÉCRAN avant de tout diviser par l'échelle — le rendu qui
// suit le choix d'une case redessinait donc les flèches ailleurs qu'avant le zoom. Le
// tracé d'une flèche doit ne dépendre QUE du repère local, jamais du zoom courant.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.goto(FILE);

  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    Hist.toggleTermSelection('left', 0);
    Hist.signChartAction();
    Hist.setFocusedSignChartFactor(0);
    Hist.selectOp('expr'); Hist.setExprChainText('-1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.setFocusedSignChartFactor(1);
    Hist.selectOp('expr'); Hist.setExprChainText('+2'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.focusMain();
  });
  await page.waitForTimeout(300);
  ok('sign chart table rendered', (await page.$('.sign-chart-table')) !== null);

  // Flèches + étiquettes des colonnes de facteurs, relatives à la première équation de
  // la section (insensible à tout panoramique du canevas entre deux mesures).
  async function arrowGeometry() {
    return page.evaluate(() => {
      var ref = document.querySelector('.sign-chart-factors-group .eq-line').getBoundingClientRect();
      var out = [];
      document.querySelectorAll('.sign-chart-factors-group svg.arrows-overlay path.arrow-path, .sign-chart-factors-group .arrow-label')
        .forEach(function (el) {
          var r = el.getBoundingClientRect();
          out.push([r.left - ref.left, r.top - ref.top, r.width, r.height].map(Math.round).join(','));
        });
      return out.join(' | ');
    });
  }

  // Colonne 0 : intervalle (+/−), colonne 1 : frontière (0/‖).
  const picks = [[0, '+'], [0, '−'], [1, '‖'], [1, '✕']];
  for (const scale of [0.7, 1.4]) {
    await page.evaluate((s) => {
      var C = window.App.Canvas;
      C.zoomAt(s, 640, 360);
      // Ramène la première case du tableau au centre de l'écran (sinon hors champ à 1.4).
      var r = document.querySelector('.sign-chart-target[data-sign-chart-row="0"][data-sign-chart-col="0"]').getBoundingClientRect();
      C.set(C.getX() + (r.left - 640) / s, C.getY() + (r.top - 360) / s);
    }, scale);
    await page.waitForTimeout(300);
    const before = await arrowGeometry();
    ok('zoom ' + scale + ': factor columns have arrows', before.length > 0);
    for (const [col, label] of picks) {
      await page.click('.sign-chart-target[data-sign-chart-row="0"][data-sign-chart-col="' + col + '"]');
      await page.locator('.sign-chart-popup-btn', { hasText: label }).first().click();
      await page.waitForTimeout(150);
      ok('zoom ' + scale + ': arrows unchanged after picking "' + label + '"', (await arrowGeometry()) === before);
    }
  }

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
