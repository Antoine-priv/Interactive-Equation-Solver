const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function applyChain(eq, latex) {
    await page.evaluate(({ eq, latex }) => {
      window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(latex);
      window.App.History.confirm();
    }, { eq: eq, latex: latex });
  }

  // --- 1) "×x²" (bare x squared) ---
  await applyChain('x=5', '\\times x^2');
  let step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after ×x^2:', JSON.stringify(step.equation));
  ok('×x² produces (x)(x^2) with the multiplier as a plain pow=2 term',
    step.equation.left[0].factors[1].terms.length === 1 && step.equation.left[0].factors[1].terms[0].coeff === 1 && step.equation.left[0].factors[1].terms[0].pow === 2);

  await page.screenshot({ path: `${SCRATCH}/multiply_x_squared.png` });

  // --- 2) "×(x+3)²" (whole expression squared) ---
  await applyChain('x=5', '\\times(3+x)^2');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after ×(3+x)^2:', JSON.stringify(step.equation));
  const mult = step.equation.left[0].factors[1];
  ok('×(3+x)² produces a squared factor (exponent 2), merged into the same product', mult && mult.exponent === 2 &&
    JSON.stringify(mult.terms) === JSON.stringify([{ coeff: 3, pow: 0 }, { coeff: 1, pow: 1 }]));

  await page.screenshot({ path: `${SCRATCH}/multiply_paren_squared.png` });

  // --- 3) Regression: bare "x" (pow 1) and bare "(...)" (no power) still work ---
  await applyChain('x=5', '\\times x');
  const stepBareX = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  // "x" (le membre de départ) fois "x" (le multiplicateur) fusionne en un seul facteur
  // d'exposant 2 (x·x = x²), voir canonicalizeFactors dans expression.js.
  ok('regression: bare "×x" still produces a pow=1 multiplier, merged into a squared factor',
    stepBareX.equation.left[0].factors.length === 1 && stepBareX.equation.left[0].factors[0].exponent === 2 &&
    stepBareX.equation.left[0].factors[0].terms[0].pow === 1);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
