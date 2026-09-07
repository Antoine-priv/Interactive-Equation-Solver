const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Multiplier par "N(...)" (ex. "2(3x+5)") via le champ mathématique unifié (voir
// classifyMulDivOperand dans history.js) : le multiplicateur se déplie en DEUX facteurs
// distincts du produit résultant — le coefficient "2" ET la parenthèse "(3x+5)" — plutôt
// qu'un FactorGroup imbriqué comme facteur unique (voir operandFactors dans
// expression.js) : imbriquer produisait un rendu ambigu, deux facteurs "nus" adjacents se
// lisant comme collés (ex. "25" suivi de "5(x+13)" -> "255(x+13)"), et empêchait tout
// "Développer" dessus (expandProductFactorSubset attend des facteurs plats).
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

  await applyChain('x=5', '\\times2(3x+5)');
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after ×2(3x+5):', JSON.stringify(step.equation));
  ok('left side is a 3-factor product: x, 2, (3x+5) — no FactorGroup nested as a single factor',
    step.equation.left[0].sign === 1 && step.equation.left[0].factors.length === 3 &&
    JSON.stringify(step.equation.left[0].factors[0]) === JSON.stringify({ terms: [{ coeff: 1, pow: 1 }], exponent: 1 }) &&
    JSON.stringify(step.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 2, pow: 0 }], exponent: 1 }) &&
    JSON.stringify(step.equation.left[0].factors[2]) === JSON.stringify({ terms: [{ coeff: 3, pow: 1 }, { coeff: 5, pow: 0 }], exponent: 1 }));

  const latexSource = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.current .side[data-side="left"] .katex-mathml annotation');
    return el ? el.textContent : null;
  });
  console.log('rendered LaTeX:', JSON.stringify(latexSource));
  const normalized = (latexSource || '').replace(/\\htmlId\{[^}]*\}/g, '').replace(/\\htmlData\{[^}]*\}/g, '').replace(/\\left|\\right/g, '').replace(/[{}]/g, '').replace(/\s+/g, '');
  ok('renders as "x\\cdot2(3x+5)" — an explicit "\\cdot" disambiguates the adjacent bare "x" and "2"',
    normalized === 'x\\cdot2(3x+5)');

  await page.screenshot({ path: `${SCRATCH}/multiply_coeff_paren.png` });

  // Both factors are independently developable now (see product_partial_expand.js):
  // select "2" and "(3x+5)" together to fold them into "6x+10".
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-2"]');
  ok('"Développer" enabled once the coefficient and the parenthesis are both selected',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const stepDev = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('after developing "2(3x+5)":', JSON.stringify(stepDev.equation.left));
  ok('"x" untouched, "2" and "(3x+5)" merged into "6x+10"',
    stepDev.equation.left[0].factors.length === 2 &&
    JSON.stringify(stepDev.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 6, pow: 1 }, { coeff: 10, pow: 0 }], exponent: 1 }));

  // Negative coefficient too: "-2(3)".
  await applyChain('x=5', '\\times-2(3)');
  const step2 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after ×-2(3):', JSON.stringify(step2.equation));
  ok('negative coefficient produces sign -1 on the whole product, factor "2" itself stays positive',
    step2.equation.left[0].sign === -1 &&
    JSON.stringify(step2.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 2, pow: 0 }], exponent: 1 }) &&
    JSON.stringify(step2.equation.left[0].factors[2]) === JSON.stringify({ terms: [{ coeff: 3, pow: 0 }], exponent: 1 }));

  // Regression: bare parens (no coefficient) still work as before.
  await applyChain('x=5', '\\times(5+2x)');
  const step3 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('regression bare-parens equation:', JSON.stringify(step3.equation));
  ok('regression: bare "×(5+2x)" still produces a ProductGroup as before',
    !!(step3.equation.left[0].factors && step3.equation.left[0].factors.length === 2));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
