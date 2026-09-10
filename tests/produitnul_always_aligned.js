const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Suite à un rapport utilisateur (capture d'écran) : quand le groupe de colonnes "Produit
// nul" ne tient pas dans la largeur disponible, il ne doit JAMAIS être un compromis
// "centré sur lui-même, décalé de la chaîne principale" — les deux DOIVENT toujours
// partager le même centre, quitte à devoir défiler pour voir toutes les colonnes à la
// fois (voir renderAll dans render.js : #history est élargi pour correspondre EXACTEMENT
// à la largeur intrinsèque de .produit-nul-split, qui reste "flush" — chaque .eq-row de
// la chaîne principale, centrée dans #history comme d'habitude, se retrouve alors
// centrée sur EXACTEMENT le même point que le groupe de colonnes, sans marge négative ni
// calcul de défilement hasardeux).
//
// #opButtons est désormais une fenêtre flottante ANCRÉE à gauche de la ligne "current" de
// la branche focalisée (voir App.Toolbar.positionPanel), plus un pavé fixe en bas à
// gauche — elle PEUT donc légitimement chevaucher une colonne NON focalisée (voir
// CLAUDE.md), ce n'est plus un bug à couvrir ici. Seule invariante encore vérifiée : elle
// reste bien à gauche de la ligne "current" de la colonne FOCALISÉE elle-même (celle dont
// elle affiche les actions), jamais par-dessus son propre texte.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x^2-49)(x-4)(3x+2)(5x+2)=0');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.History.confirmProduitNul());
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => {
    var primaryRows = Array.from(document.querySelectorAll('#history > .eq-row'));
    var lastPrimary = primaryRows[primaryRows.length - 1];
    var primaryRect = lastPrimary.getBoundingClientRect();
    var cols = Array.from(document.querySelectorAll('.produit-nul-branch')).map((c) => c.getBoundingClientRect());
    var colsMinLeft = Math.min(...cols.map((c) => c.left));
    var colsMaxRight = Math.max(...cols.map((c) => c.right));
    var toolbar = document.getElementById('opButtons').getBoundingClientRect();
    var focusedLine = document.querySelector('.produit-nul-branch.branch-focused .eq-row.current .eq-line');
    var focusedRect = focusedLine ? focusedLine.getBoundingClientRect() : null;
    return {
      isWide: document.querySelector('.produit-nul-split-wide') !== null,
      primaryCenter: (primaryRect.left + primaryRect.right) / 2,
      colsCenter: (colsMinLeft + colsMaxRight) / 2,
      toolbarLeftOfFocusedCurrent: !!focusedRect && toolbar.right <= focusedRect.left,
      colsFullyVisible: cols.filter((c) => c.left >= 0 && c.right <= window.innerWidth).length,
      totalCols: cols.length
    };
  });
  console.log(JSON.stringify(state, null, 2));

  ok('this equation genuinely needs the "wide split" fallback (repro condition met)', state.isWide === true);
  ok('not all columns fit at once (repro condition met)', state.colsFullyVisible < state.totalCols);
  ok('the primary equation chain and the column group share the exact same center (no trade-off)',
    Math.abs(state.primaryCenter - state.colsCenter) < 2);
  ok('the floating toolbar stays left of the focused branch\'s own current equation',
    state.toolbarLeftOfFocusedCurrent === true);

  await page.screenshot({ path: `${SCRATCH}/produitnul_always_aligned.png` });

  // Scroll to each extreme: every column must become fully visible, none permanently
  // clipped by an unreachable "negative overflow" (see the comments in render.js).
  await page.evaluate(() => { document.getElementById('historyScroll').scrollLeft = -999999; });
  await page.waitForTimeout(80);
  const leftmost = await page.evaluate(() => document.querySelectorAll('.produit-nul-branch')[0].getBoundingClientRect());
  ok('the leftmost column is fully reachable by scrolling left', leftmost.left >= 0 && leftmost.right <= 1366);

  await page.evaluate(() => { document.getElementById('historyScroll').scrollLeft = 999999; });
  await page.waitForTimeout(80);
  const cols2 = await page.evaluate(() => document.querySelectorAll('.produit-nul-branch'));
  const rightmost = await page.evaluate(() => {
    var cols = document.querySelectorAll('.produit-nul-branch');
    return cols[cols.length - 1].getBoundingClientRect();
  });
  ok('the rightmost column is fully reachable by scrolling right', rightmost.left >= 0 && rightmost.right <= 1366);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
