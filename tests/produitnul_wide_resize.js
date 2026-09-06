const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté par l'utilisateur : avec beaucoup de colonnes "Produit nul", rétrécir puis
// ré-élargir la fenêtre (ex. zoomer le navigateur) laisse la chaîne principale ET les
// colonnes décalées, hors centre, même une fois revenu à une largeur où tout devrait
// pourtant tenir sans défilement. Cause racine (voir renderAll dans render.js) : quand le
// groupe de colonnes est trop large pour tenir (isWideSplit), le centrage bascule sur un
// scrollLeft explicite calculé une fois ; quand la fenêtre se ré-élargit et que le groupe
// TIENT à nouveau, le centrage redevient un simple margin-left CSS qui suppose scrollLeft
// à 0 — mais rien ne remettait ce scrollLeft à 0 (widthChangedDuringSplit ne se
// déclenchait que tant qu'on restait "large"), laissant l'ancien scrollLeft décaler tout
// le contenu silencieusement.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x^2-10x+25)(x-5)(x+2)(8x+15-2x)=0');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.History.confirmProduitNul());
  await page.waitForTimeout(300);

  async function measure() {
    return page.evaluate(() => {
      var primaryRows = Array.from(document.querySelectorAll('#history > .eq-row'));
      var lastPrimary = primaryRows[primaryRows.length - 1];
      var primaryRect = lastPrimary ? lastPrimary.getBoundingClientRect() : null;
      var cols = Array.from(document.querySelectorAll('.produit-nul-branch')).map((c) => c.getBoundingClientRect());
      var colsMinLeft = Math.min(...cols.map((c) => c.left));
      var colsMaxRight = Math.max(...cols.map((c) => c.right));
      return {
        isWide: document.querySelector('.produit-nul-split-wide') !== null,
        scrollLeft: document.getElementById('historyScroll').scrollLeft,
        primaryCenter: primaryRect ? (primaryRect.left + primaryRect.right) / 2 : null,
        colsCenter: (colsMinLeft + colsMaxRight) / 2,
        viewportCenter: window.innerWidth / 2,
        colsFullyVisible: cols.filter((c) => c.left >= 0 && c.right <= window.innerWidth).length,
        totalCols: cols.length
      };
    });
  }

  const wide = await measure();
  console.log('wide (2200px, fits):', JSON.stringify(wide));
  ok('all 4 columns fit and are fully visible at 2200px', wide.isWide === false && wide.colsFullyVisible === 4);
  ok('columns centered on the viewport at 2200px', Math.abs(wide.colsCenter - wide.viewportCenter) < 5);

  // Shrink far enough that the 4 columns no longer fit (forces isWideSplit).
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.waitForTimeout(300);
  const narrow = await measure();
  console.log('narrow (1100px, overflow):', JSON.stringify(narrow));
  ok('narrow viewport correctly detected as "wide split" (columns do not fit)', narrow.isWide === true);

  // Widen back to the original size: this is the exact regression — everything should
  // return to being perfectly centered, matching the very first measurement.
  await page.setViewportSize({ width: 2200, height: 900 });
  await page.waitForTimeout(300);
  const backToWide = await measure();
  console.log('back to 2200px after having been narrow:', JSON.stringify(backToWide));
  ok('no longer flagged as a wide split once the window is wide again', backToWide.isWide === false);
  ok('scrollLeft reset to 0 (no stale offset left over from the narrow phase)', backToWide.scrollLeft === 0);
  ok('all 4 columns fully visible again', backToWide.colsFullyVisible === 4);
  ok('columns re-centered on the viewport (not stuck at the old narrow-phase position)',
    Math.abs(backToWide.colsCenter - backToWide.viewportCenter) < 5);
  ok('primary equation chain re-centered too (same point as the columns)',
    Math.abs(backToWide.primaryCenter - backToWide.colsCenter) < 5);

  await page.screenshot({ path: `${SCRATCH}/produitnul_wide_resize_restored.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
