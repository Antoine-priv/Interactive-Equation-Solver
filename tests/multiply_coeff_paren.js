const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Multiplier par "N(...)" (ex. "2(3x+5)") via le champ mathématique unifié (voir
// classifyMulDivOperand dans history.js) : doit produire un FactorGroup à un seul
// élément, rendu SANS parenthèse supplémentaire ("2(3x+5)", pas "(2(3x+5))").
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
  // wrapSideInProduct enveloppe le membre courant ("x") ET le multiplicateur dans un
  // ProductGroup : le FactorGroup "2(3x+5)" est donc le côté DROIT de ce produit, pas le
  // noeud de premier niveau lui-même.
  const g = step.equation.left[0].factors[1].terms[0];
  ok('left side became (x)(2(3x+5)) with the FactorGroup as the right factor', g && g.factor && g.factor.coeff === 2 && g.sign === 1);
  ok('inner terms are 3x+5', JSON.stringify(g.innerTerms) === JSON.stringify([{ coeff: 3, pow: 1 }, { coeff: 5, pow: 0 }]));

  const latexSource = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.current .side[data-side="left"] .katex-mathml annotation');
    return el ? el.textContent : null;
  });
  console.log('rendered LaTeX:', JSON.stringify(latexSource));
  const normalized = (latexSource || '').replace(/\\htmlId\{[^}]*\}/g, '').replace(/\\htmlData\{[^}]*\}/g, '').replace(/\\left|\\right/g, '').replace(/[{}]/g, '').replace(/\s+/g, '');
  ok('renders as "x2(3x+5)" with no extra outer parens', normalized === 'x2(3x+5)');

  await page.screenshot({ path: `${SCRATCH}/multiply_coeff_paren.png` });

  // Negative coefficient too: "-2(3)".
  await applyChain('x=5', '\\times-2(3)');
  const step2 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after ×-2(3):', JSON.stringify(step2.equation));
  const g2 = step2.equation.left[0].factors[1].terms[0];
  ok('negative coefficient produces sign -1', g2 && g2.factor && g2.factor.coeff === 2 && g2.sign === -1);

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
