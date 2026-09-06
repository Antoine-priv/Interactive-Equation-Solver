const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Une équation assez longue pour qu'autoFitRowFont (render.js) doive déjà réduire sa
// police AVANT tout "drill" : entrer dans un groupe factorisé (double-clic, voir
// pending.drilled dans history.js) ajoute des poignées de sortie/termes cliquables
// individuels au rendu KaTeX de ce membre, ce qui a pu, avant correctif, faire
// retourner le membre à la ligne À LA TAILLE PAR DÉFAUT (pas encore réduite) : KaTeX
// scinde son rendu HTML en plusieurs groupes ".base" (chacun "white-space:nowrap"
// individuellement, mais rien n'empêchait le NAVIGATEUR de retourner à la ligne ENTRE
// deux ".base" voisins) — scrollWidth mesurait alors la largeur déjà repliée sur 2
// lignes (qui "tient"), donc autoFitRowFont ne réduisait jamais la police : la ligne
// devenait plus grande ET sur deux lignes au lieu de rester sur une seule, réduite (voir
// le "white-space:nowrap" ajouté à .eq-line dans style.css).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2-14x+49-(-8+x)^2+5-8(7-3x)=0');
  await page.waitForTimeout(200);

  function measure() {
    return page.evaluate(() => {
      var row = document.querySelector('.eq-row.current');
      var line = row.querySelector('.eq-line');
      return { rowHeight: row.getBoundingClientRect().height, fontSize: line.style.fontSize };
    });
  }

  const before = await measure();
  console.log('before drill:', JSON.stringify(before));
  ok('long equation fits on one line before drilling', before.rowHeight < 100);

  const groupIdx = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left.findIndex(function (n) { return n && n.factor; });
  });
  await page.dblclick(`.eq-row.current .side[data-side="left"] [data-index="${groupIdx}"]`);
  await page.waitForTimeout(200);

  const pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the common-factor group', !!pending.drilled && pending.drilled.path[0] === groupIdx);

  const after = await measure();
  console.log('after drill:', JSON.stringify(after));
  ok('row stays single-line height after drilling (no forced wrap)', Math.abs(after.rowHeight - before.rowHeight) < 1);
  ok('font size is not enlarged back to default after drilling', after.fontSize === before.fontSize);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
