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

  // 1) Opening "+" pre-fills the manual field with the CURRENT equation (not blank).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '3x+5=2x-1');
  await page.waitForTimeout(80);
  await page.click('#newEquationBtn');
  await page.waitForTimeout(80);
  let latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  ok('field pre-filled with the current equation on open', latex === '3x + 5=2x - 1');
  await page.click('#modalClose');
  await page.waitForTimeout(80);

  // 2) After solving a step further, reopening "+" reflects the NEW current equation, not
  // the one from the previous time the modal was opened.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '5x=10');
  await page.waitForTimeout(80);
  await page.click('#newEquationBtn');
  await page.waitForTimeout(80);
  latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  ok('field reflects the latest current equation on reopen', latex === '5x=10');
  ok('does not still show the previous equation', latex !== '3x + 5=2x - 1');

  await page.screenshot({ path: `${SCRATCH}/new_equation_prefill.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  ok('aucune erreur JS', errs.length === 0);

  await browser.close();
})();
