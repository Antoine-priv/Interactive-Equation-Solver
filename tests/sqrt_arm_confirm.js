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

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=9');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(150);

  // 1) Juste apres avoir ouvert "Operation" : PAS de branches, PAS de preview colonnes.
  let state = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    previewCount: document.querySelectorAll('.produit-nul-preview').length,
    pendingRowCount: document.querySelectorAll('.eq-row.pending').length
  }));
  console.log('juste apres Operation:', JSON.stringify(state));
  ok('no branches yet', state.branches === null);
  ok('no sqrt preview columns before arming', state.previewCount === 0);
  ok('generic pending echo row still shows normally (nothing armed yet)', state.pendingRowCount === 1);

  // 2) Clique sur "V" (arme la racine carree) : preview colonnes visible, PAS de ligne pending generique en double.
  const sqrtKey = await findSqrtKey(page);
  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(150);
  state = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    previewCount: document.querySelectorAll('.produit-nul-preview .produit-nul-branch').length,
    pendingRowCount: document.querySelectorAll('.eq-row.pending').length,
    sqrtArmed: window.App.History.getPending().sqrtArmed
  }));
  console.log('apres avoir clique sur la touche racine carree (armee):', JSON.stringify(state));
  ok('sqrtArmed is true', state.sqrtArmed === true);
  ok('still no real branches (armed, not confirmed)', state.branches === null);
  ok('sqrt preview columns now visible (2 columns)', state.previewCount === 2);
  ok('no duplicate generic pending echo row while armed (no "preview of a preview")', state.pendingRowCount === 0);

  await page.screenshot({ path: `${SCRATCH}/sqrt_armed.png` });

  // 3) Les autres touches du pave sont desactivees pendant que "racine" est armee.
  const digitDisabled = await page.evaluate(() => {
    var sevenBtn = document.querySelector('[data-key="7"]');
    return sevenBtn ? sevenBtn.disabled : null;
  });
  ok('other keys (e.g. digit 7) disabled while sqrt is armed', digitDisabled === true);

  // 4) Clique sur "Valider" : la scission se produit REELLEMENT maintenant.
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(300);
  state = await page.evaluate(() => ({
    branches: window.App.History.getBranches() ? window.App.History.getBranches().map((b) => b.lastEquation()) : null
  }));
  console.log('apres avoir clique sur Valider:', JSON.stringify(state));
  ok('confirming with "Valider" actually creates the branches', state.branches && state.branches.length === 2);

  await page.screenshot({ path: `${SCRATCH}/sqrt_confirmed.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
