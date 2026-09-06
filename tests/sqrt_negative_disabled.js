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

// Racine carrée d'un nombre négatif : la touche reste cliquable AVANT validation (l'élève
// doit pouvoir essayer), mais "Valider" affiche un message rouge précis et grise
// durablement la touche (pending.sqrtFailed) — jusqu'à ce que le mode "Opération" soit
// quitté/rouvert (seule échappatoire, la touche elle-même restant désactivée).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=-9');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);

  let sqrtKey = await findSqrtKey(page);
  const beforeState = await sqrtKey.evaluate((el) => el.disabled);
  ok('sqrt key is clickable even for a negative-constant equation', beforeState === false);

  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(80);
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(120);

  const afterFail = await page.evaluate(() => ({
    sqrtFailed: window.App.History.getPending().sqrtFailed,
    branches: window.App.History.getBranches(),
    panelErrorText: (document.querySelector('.math-keypad-error') || {}).textContent || null
  }));
  ok('exact red error message shown', afterFail.panelErrorText === 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.');
  ok('sqrtFailed flag set', afterFail.sqrtFailed === true);
  ok('no branches created (confirm rejected)', afterFail.branches === null);

  sqrtKey = await findSqrtKey(page);
  ok('sqrt key is actually disabled (greyed) after failing', await sqrtKey.evaluate((el) => el.disabled) === true);

  // Message persists even if pending.error alone gets cleared by an unrelated action.
  await page.evaluate(() => { window.App.History.getPending().error = null; App.Render.renderAll(); });
  await page.waitForTimeout(60);
  const afterClearing = await page.evaluate(() => (document.querySelector('.math-keypad-error') || {}).textContent || null);
  ok('red message persists via sqrtFailed fallback even after pending.error is cleared',
    afterClearing === 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.');

  // Clicking the disabled key must have no effect (still stuck armed+failed).
  sqrtKey = await findSqrtKey(page);
  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(80);
  const afterDisabledClick = await page.evaluate(() => window.App.History.getPending());
  ok('clicking the disabled sqrt key has no effect (still armed+failed)',
    afterDisabledClick.sqrtArmed === true && afterDisabledClick.sqrtFailed === true);

  // The only escape hatch: re-clicking the top-level "Opération" toggle (always enabled).
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  const afterEscape = await page.evaluate(() => window.App.History.getPending());
  ok('clicking "Opération" again resets sqrtArmed/sqrtFailed (not stuck)',
    afterEscape.sqrtArmed === false && afterEscape.sqrtFailed === false);

  await page.screenshot({ path: `${SCRATCH}/sqrt_negative_disabled.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
