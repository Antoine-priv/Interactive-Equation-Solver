const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Suite au correctif d'alignement (#history élargie pour correspondre à
// .produit-nul-split, voir renderAll dans render.js) : un utilisateur a signalé que la
// page "sautait" visuellement — d'abord vers une vue incomplète (chaîne principale
// coupée, à peine 2 colonnes visibles, scrollLeft=0 juste après l'élargissement de
// #history), PUIS vers la vue correctement centrée, une fraction de seconde plus tard.
// Cause : le défilement horizontal utilisait une transition "smooth" (comme pour une
// étape normale) même pour ce cas, animant depuis scrollLeft=0 (position de départ non
// pertinente, #history venant d'être radicalement élargie dans le MÊME rendu) vers la
// position correcte — perçu comme deux sauts plutôt qu'une transition utile. Le
// correctif force un défilement INSTANTANÉ (pas de "smooth") dès que la mise en page
// bascule en "large" (isWideSplit), pour que la vue correcte soit là dès la première
// image, sans état intermédiaire visible.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x^2-49)(x-4)(3x+2)(5x+2)=0');
  await page.waitForTimeout(150);

  // Confirm, then check the scroll position and alignment with ZERO wait — if there were
  // any animation in flight, this would still catch it mid-flight (not yet at the target).
  await page.evaluate(() => window.App.History.confirmProduitNul());
  const immediate = await page.evaluate(() => {
    var scroller = document.getElementById('historyScroll');
    var primaryRows = Array.from(document.querySelectorAll('#history > .eq-row'));
    var lastPrimary = primaryRows[primaryRows.length - 1];
    var primaryRect = lastPrimary.getBoundingClientRect();
    var cols = Array.from(document.querySelectorAll('.produit-nul-branch')).map((c) => c.getBoundingClientRect());
    var colsMinLeft = Math.min(...cols.map((c) => c.left));
    var colsMaxRight = Math.max(...cols.map((c) => c.right));
    return {
      scrollLeft: window.App.Canvas.getX(),
      primaryCenter: (primaryRect.left + primaryRect.right) / 2,
      colsCenter: (colsMinLeft + colsMaxRight) / 2
    };
  });
  console.log('immediately after confirmProduitNul (no wait at all):', JSON.stringify(immediate));

  await page.waitForTimeout(600); // let any hypothetical animation fully finish
  const settled = await page.evaluate(() => window.App.Canvas.getX());
  console.log('scrollLeft once fully settled:', settled);

  ok('scrollLeft is already at its final value on the very first frame (no animation to wait for)',
    immediate.scrollLeft === settled);
  ok('the primary chain and columns are already correctly aligned on the very first frame',
    Math.abs(immediate.primaryCenter - immediate.colsCenter) < 2);
  ok('scrollLeft is not the pre-confirm default (0) — a real position was applied immediately',
    immediate.scrollLeft !== 0);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
