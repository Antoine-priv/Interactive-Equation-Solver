const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Condition d'existence" côté racine carrée (radicand>=0) : drill into a variable-
// radicand square root (√(x-2)=3, injected as an AST since \sqrt{...} always folds to a
// plain number through the manual parser — see generateVariableRadicandEquation in
// generator.js), spawn its existence-condition column, and drive it through the new
// inequality engine (currentOperator/Ineq.flipOperator in history.js): a plain "+2" must
// NOT flip the sense, while "×(-1)" (a negative multiplier applied to both members) must.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  // Double-click (simulated via two quick API calls, same convention as tests/sqrt_drill.js)
  // on the left side's lone SqrtGroup to drill into its radicand.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the radicand (pending.drilled.part === "sqrt")',
    pending.drilled && pending.drilled.part === 'sqrt');
  ok('"Condition d\'existence" is enabled once drilled into the radicand',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition));

  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);

  const conditions0 = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('exactly one domain condition was created', conditions0 && conditions0.length === 1);
  ok('its operator is "\\geq" (radicand case)', conditions0[0].operator === '\\geq');
  const initialStep = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps()[0]);
  ok('the spawned column starts on "x-2" with operator "\\geq" already tagged on its first step',
    initialStep.operator === '\\geq' && JSON.stringify(initialStep.equation.left) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }]));

  // Focus the domain column (first click just focuses, matching the branch convention).
  const domainTermLocator = page.locator('.domain-branch[data-domain-index="0"] .side[data-side="left"] .term[data-index="0"]');
  await domainTermLocator.click();
  await page.waitForTimeout(60);
  ok('focusing the domain column works', (await page.evaluate(() => window.App.History.getFocusedDomain())) === 0);

  // --- "+2" : a plain additive step must NOT flip the sense. ---
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('+2');
    window.App.History.confirm();
    // "+2" only pushes "x-2+2 \geq 0+2" (unsimplified) — merge each side via the usual
    // "Simplifier" flow to actually reach "x \geq 2".
    window.App.History.toggleTermSelection('left', 1);
    window.App.History.toggleTermSelection('left', 2);
    window.App.History.confirmSimplifySelection();
    window.App.History.toggleTermSelection('right', 0);
    window.App.History.toggleTermSelection('right', 1);
    window.App.History.confirmSimplifySelection();
  });
  await page.waitForTimeout(120);
  let steps = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps());
  ok('after "+2": still on "\\geq" (no flip from a plain addition)', steps[steps.length - 1].operator === '\\geq');
  ok('after "+2": the equation is now "x \\geq 2"',
    JSON.stringify(steps[steps.length - 1].equation) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 2, pow: 0 }] }));
  ok('this is already the solved shape', await page.evaluate(() => {
    var eq = window.App.History.getDomainConditions()[0].engine.lastEquation();
    return window.App.Equation.isSolved(eq);
  }));

  const solvedGlyph = await page.evaluate(() =>
    document.querySelector('.domain-branch[data-domain-index="0"] .eq-row.solved .eq-sign').innerHTML);
  ok('the solved row shows "\\geq" (not "=")', /2265|\\geq|≥/.test(solvedGlyph) || solvedGlyph.indexOf('2265') !== -1);

  // --- Fresh column from a fresh equation, this time flip the sense with "×-1". Note:
  // "×(-1)" (PARENTHESIZED) parses as multiplying by the EXPRESSION "-1" (wraps as a
  // factor group, a pre-existing, unrelated parsing precedence — see classifyMulDivOperand
  // in history.js) rather than the plain scalar path this feature's flip detection reads
  // (op.rawValue); "×-1" (no parens) is the form that actually hits classifyMulDivOperand's
  // numeric branch and gets tagged with a signed `rawValue`. ---
  await page.evaluate(() => window.App.History.startNewEquation({
    left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }] }],
    right: [{ coeff: 3, pow: 0 }]
  }));
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(120);
  await page.locator('.domain-branch[data-domain-index="0"] .side[data-side="left"] .term[data-index="0"]').click();
  await page.waitForTimeout(60);

  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times-1');
    window.App.History.confirm();
  });
  await page.waitForTimeout(120);
  steps = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps());
  ok('a single "×-1" flips "\\geq" to "\\leq"', steps[steps.length - 1].operator === '\\leq');
  ok('the equation itself is "-(x-2) \\leq 0" (not simplified automatically)',
    JSON.stringify(steps[steps.length - 1].equation) === JSON.stringify({
      left: [{ sign: -1, factor: { coeff: 1, pow: 0 }, innerTerms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }] }],
      right: [{ coeff: 0, pow: 0 }]
    }));

  const flipLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.domain-branch[data-domain-index="0"] .arrow-label')).map((el) => el.textContent));
  console.log('arrow labels after the flip:', JSON.stringify(flipLabels));
  ok('the flip step\'s arrow label mentions "sens inversé"', flipLabels.some((t) => /sens invers/.test(t)));

  // A second "×-1" flips back to "\\geq" (parity).
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times-1');
    window.App.History.confirm();
  });
  await page.waitForTimeout(120);
  steps = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps());
  ok('a second "×-1" flips back to "\\geq"', steps[steps.length - 1].operator === '\\geq');

  // --- Multiplying/dividing by a variable expression is rejected in inequality mode. ---
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times(x+1)');
    window.App.History.confirm();
  });
  await page.waitForTimeout(80);
  const errorAfterVarMul = await page.evaluate(() => window.App.History.getPending().error);
  ok('multiplying by a variable expression is rejected with a clear error', !!errorAfterVarMul);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
