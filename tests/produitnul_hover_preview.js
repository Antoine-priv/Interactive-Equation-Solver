const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');

  const noPreviewYet = await page.$('.produit-nul-preview');
  ok('no preview before hovering the button', noPreviewYet === null);

  await page.hover('button[data-op="produitnul"]');
  await page.waitForTimeout(150);

  const previewCols = await page.$$('.produit-nul-preview .produit-nul-branch');
  ok('hovering shows 2 preview columns', previewCols.length === 2);

  const noRealBranchesYet = await page.evaluate(() => window.App.History.getBranches());
  ok('no real branches created by just hovering', noRealBranchesYet === null);

  const previewEqs = await page.evaluate(() => {
    var chains = document.querySelectorAll('.produit-nul-preview .produit-nul-chain .eq-line');
    return Array.from(chains).map((el) => el.closest('.eq-row').textContent);
  });
  console.log('contenu des colonnes d apercu:', JSON.stringify(previewEqs));

  const forkPresent = await page.evaluate(() => {
    var svg = document.querySelector('#history > svg.arrows-overlay');
    return svg ? svg.querySelectorAll('path.arrow-path').length : 0;
  });
  console.log('nombre de fleches (dont la fourchue) dans l apercu:', forkPresent);
  ok('fork arrow(s) drawn toward the preview columns', forkPresent >= 2);

  const notInteractive = await page.evaluate(() => getComputedStyle(document.querySelector('.produit-nul-preview')).pointerEvents);
  ok('preview is non-interactive (pointer-events:none)', notInteractive === 'none');

  await page.screenshot({ path: `${SCRATCH}/produitnul_hover_preview.png` });

  await page.hover('#newEquationBtn');
  await page.waitForTimeout(150);
  const goneAfterLeave = await page.$('.produit-nul-preview');
  ok('preview disappears once the mouse leaves the button', goneAfterLeave === null);

  const stillNoRealBranches = await page.evaluate(() => window.App.History.getBranches());
  ok('still no real branches after hover ended', stillNoRealBranches === null);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
