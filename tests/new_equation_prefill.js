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

  // 3) Manual entry of "x(x+a)=b" (a FactorGroup whose factor is x itself, coeff 1/pow 1
  // — not just a numeric coefficient, see App.Expr.factorNodes/"Facteur commun" already
  // producing this shape) must be accepted directly through the modal's submit path, not
  // only via the internal API — see VAR_FACTOR_RE in parser.js. Modal is already open
  // from step 2 above (never closed) : reuse it rather than reopening.
  await page.evaluate(() => window.App.MathKeypad.setLatex('x(x-5)=12'));
  await page.waitForTimeout(80);
  await page.click('#manualSubmit');
  await page.waitForTimeout(80);
  const eqAfterVarFactor = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation after submitting "x(x-5)=12":', JSON.stringify(eqAfterVarFactor));
  ok('modal accepts "x(x-5)=12" and builds a FactorGroup with x as the factor', JSON.stringify(eqAfterVarFactor) === JSON.stringify({
    left: [{ sign: 1, factor: { coeff: 1, pow: 1 }, innerTerms: [{ coeff: 1, pow: 1 }, { coeff: -5, pow: 0 }] }],
    right: [{ coeff: 12, pow: 0 }]
  }));
  const modalClosedAfterSubmit = await page.evaluate(() => document.getElementById('modalOverlay').hidden);
  ok('modal closes after a successful "x(x-5)=12" submit (no parse error)', modalClosedAfterSubmit === true);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  ok('aucune erreur JS', errs.length === 0);

  await browser.close();
})();
