const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function findSqrtKey(page) {
  return page.$('[data-key="sqrt"]');
}

// Racine carrée dont le second membre vaut 0 (ex. x²=0) : un SEUL résultat, donc jamais
// une "fourche" à une seule branche (colonnes + flèche double prévues pour plusieurs
// cas) — ni dans l'aperçu (avant de cliquer "Valider"), ni une fois confirmé. Doit se
// comporter comme une étape normale à deux flèches ordinaires (gauche+droite, même
// étiquette √ des deux côtés), voir pushStep dans history.js.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2=0');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);

  const sqrtKey = await findSqrtKey(page);
  await sqrtKey.evaluate((el) => el.click()); // arms it -> preview, not confirmed yet
  await page.waitForTimeout(150);

  const previewState = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    oldStyleColumns: document.querySelectorAll('.produit-nul-branch').length,
    forkLabels: document.querySelectorAll('.arrow-label-fork').length,
    pendingRows: document.querySelectorAll('.eq-row.pending').length,
    arrowPaths: document.querySelectorAll('.arrow-path').length
  }));
  ok('preview: no branches yet (still just armed)', previewState.branches === null);
  ok('preview: no old-style fork+columns layout', previewState.oldStyleColumns === 0 && previewState.forkLabels === 0);
  ok('preview: one normal pending row with 2 ordinary arrows', previewState.pendingRows === 1 && previewState.arrowPaths === 2);

  await page.screenshot({ path: `${SCRATCH}/sqrt_zero_preview.png` });

  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);

  const confirmedState = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    lastEquation: window.App.History.lastEquation(),
    oldStyleColumns: document.querySelectorAll('.produit-nul-branch').length
  }));
  ok('confirm: no branches created', confirmedState.branches === null);
  ok('confirm: no columns in DOM', confirmedState.oldStyleColumns === 0);
  ok('confirm: primary chain\'s last equation is x=0',
    JSON.stringify(confirmedState.lastEquation) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 0, pow: 0 }] }));

  await page.screenshot({ path: `${SCRATCH}/sqrt_zero_confirmed.png` });

  // Regression: sqrt with a non-zero constant still forks into 2 real branches+columns.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=9');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  const sqrtKey2 = await findSqrtKey(page);
  await sqrtKey2.evaluate((el) => el.click());
  await page.waitForTimeout(80);
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);
  const twoRootState = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    columns: document.querySelectorAll('.produit-nul-branch').length
  }));
  ok('regression: two distinct roots still fork into 2 real branches', twoRootState.branches && twoRootState.branches.length === 2);
  ok('regression: two distinct roots still show 2 columns', twoRootState.columns === 2);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
