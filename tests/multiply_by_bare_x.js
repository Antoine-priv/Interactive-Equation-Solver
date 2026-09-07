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

  async function applyChain(eq, latex) {
    await page.evaluate(({ eq, latex }) => {
      window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(latex);
      window.App.History.confirm();
    }, { eq: eq, latex: latex });
  }

  // --- Test 1 : ×x nu ---
  await page.goto(FILE);
  await applyChain('x=5', '\\times x');
  let step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×x (nu):', JSON.stringify(step.equation), JSON.stringify(step.opLeft));
  const leftIsProduct = step.equation.left.length === 1 && Array.isArray(step.equation.left[0].factors);
  ok('×x (bare) produces a ProductGroup', leftIsProduct);
  if (leftIsProduct) {
    // "x" (le membre de départ) fois "x" (le multiplicateur) : structurellement le MÊME
    // facteur, fusionné en un seul d'exposant 2 plutôt que deux facteurs séparés identiques
    // (voir canonicalizeFactors dans expression.js — x·x = x² légitimement).
    ok('x times x merges into a single squared factor', step.equation.left[0].factors.length === 1 &&
      step.equation.left[0].factors[0].exponent === 2 &&
      JSON.stringify(step.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }]));
  }
  await page.screenshot({ path: `${SCRATCH}/bare_x_result.png` });

  // --- Test 2 : ×2x nu (avec coefficient) ---
  await applyChain('x=5', '\\times2x');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×2x (nu):', JSON.stringify(step.equation));
  ok('×2x (bare) gives multiplier [2x]', JSON.stringify(step.equation.left[0].factors[1].terms) === JSON.stringify([{ coeff: 2, pow: 1 }]));

  // --- Test 3 : ×x au clavier physique (démarre le mode ET tape dans le champ) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.keyboard.press('*');
  await page.waitForTimeout(60);
  await page.keyboard.press('x');
  await page.waitForTimeout(60);
  let latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex apres "*" puis "x" au clavier physique:', JSON.stringify(latex));
  ok('physical keyboard "*x" arms × and types "x" into the shared field', /\\times/.test(latex) && /x/.test(latex));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  // "x" (départ) fois "x" (multiplicateur physique) fusionne aussi en un facteur carré.
  ok('physical-keyboard ×x confirms correctly', step.equation.left[0].factors.length === 1 &&
    step.equation.left[0].factors[0].exponent === 2 &&
    JSON.stringify(step.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }]));

  // --- Test 4 : ÷ par x est maintenant accepté (voir Expr.wrapSideInQuotient et
  // tests/divide_by_expression.js pour la couverture complète de cette fonctionnalité) —
  // ancienne restriction "division seulement par un nombre" levée pour les mêmes raisons
  // que "×" (avertissement "valide si x≠0" sur l'étiquette plutôt qu'un blocage).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\div x');
    window.App.History.confirm();
  });
  const afterDivX = await page.evaluate(() => window.App.History.getPending());
  const stepDivX = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ÷x:', JSON.stringify(stepDivX.equation));
  ok('÷x is now accepted (no pending error)', !afterDivX.error);
  ok('÷x wraps both sides as a quotient with x as the denominator',
    JSON.stringify(stepDivX.equation) === JSON.stringify({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }], innerTerms: [{ coeff: 1, pow: 1 }], isDivision: true }],
      right: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }]
    }));

  // --- Test 5 : round-trip avec Developper ---
  await applyChain('x=5', '\\times x');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const finalStep = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('apres developper (x)(x) (attendu x^2):', JSON.stringify(finalStep.equation.left));
  ok('(x)(x) develops correctly into x^2', JSON.stringify(finalStep.equation.left) === JSON.stringify([{ coeff: 1, pow: 2 }]));

  await page.screenshot({ path: `${SCRATCH}/bare_x_expanded.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
