const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Top-level inequality equations (>, <, \geq, \leq), the prerequisite for the "Sign
// chart" feature: the parser now recognizes a relation OTHER than "=" at the top level
// (splitTopLevelRelation in parser.js), the modal's new relation picker (=, >, <, \geq,
// \leq buttons, index.html/newEquationModal.js) inserts it into the shared MathLive
// field, and the ROOT engine (not just a nested "Condition d'existence" column) now
// drives `currentOperator`/App.Ineq.flipOperator end to end through the SAME rendering
// path already used by domain columns (createRow/renderChain in render.js).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function parse(eq) {
    return page.evaluate((e) => {
      try { return { ok: true, eq: window.App.Parser.parseLatexEquation(e) }; }
      catch (err) { return { ok: false, error: err.message }; }
    }, eq);
  }

  // --- Parser: each of the 4 inequality tokens + plain "=" ---
  let r = await parse('2x+3>7');
  ok('">" parses with operator ">" and correct sides', r.ok && r.eq.operator === '>' &&
    JSON.stringify(r.eq.left) === JSON.stringify([{ coeff: 2, pow: 1 }, { coeff: 3, pow: 0 }]) &&
    JSON.stringify(r.eq.right) === JSON.stringify([{ coeff: 7, pow: 0 }]));

  r = await parse('2x+3<7');
  ok('"<" parses with operator "<"', r.ok && r.eq.operator === '<');

  r = await parse('2x+3\\geq7');
  ok('"\\geq" parses with operator "\\geq"', r.ok && r.eq.operator === '\\geq');

  r = await parse('2x+3\\leq7');
  ok('"\\leq" parses with operator "\\leq"', r.ok && r.eq.operator === '\\leq');

  r = await parse('2x+3=7');
  ok('"=" still parses with operator null (unchanged default)', r.ok && r.eq.operator === null);

  r = await parse('2x+3>7>1');
  ok('two top-level relations is rejected, same as two "=" before', !r.ok);

  r = await parse('\\frac{5}{x+3}=2');
  ok('regression: a variable-denominator fraction with "=" still parses (isExpressionQuotient)',
    r.ok && r.eq.operator === null && JSON.stringify(r.eq.left) === JSON.stringify(
      [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }]));

  // --- Root-level rendering: relation glyph + no-flip on a plain step ---
  await page.evaluate(() => {
    window.App.History.startNewEquation(
      { left: [{ coeff: 2, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 7, pow: 0 }] },
      { operator: '>' });
  });
  await page.waitForTimeout(80);

  let steps = await page.evaluate(() => window.App.History.getSteps());
  ok('the root engine tags its first step with operator ">"', steps[0].operator === '>');
  ok('getCurrentOperator() reflects it too', (await page.evaluate(() => window.App.History.getCurrentOperator())) === '>');

  let currentGlyph = await page.evaluate(() =>
    document.querySelector('.eq-row.current .eq-sign').innerHTML);
  ok('the MAIN chain (not a domain column) already renders ">" via the shared row builder',
    currentGlyph.indexOf('3E') !== -1 || /&gt;|>/.test(currentGlyph));

  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('-3');
    window.App.History.confirm();
    window.App.History.toggleTermSelection('left', 1);
    window.App.History.toggleTermSelection('left', 2);
    window.App.History.confirmSimplifySelection();
    window.App.History.toggleTermSelection('right', 0);
    window.App.History.toggleTermSelection('right', 1);
    window.App.History.confirmSimplifySelection();
  });
  await page.waitForTimeout(120);
  steps = await page.evaluate(() => window.App.History.getSteps());
  ok('a plain "-3" step does not flip ">"', steps[steps.length - 1].operator === '>');
  ok('the equation reduces to "2x > 4"',
    JSON.stringify(steps[steps.length - 1].equation) === JSON.stringify({
      left: [{ coeff: 2, pow: 1 }], right: [{ coeff: 4, pow: 0 }]
    }));
  ok('App.Equation.isSolved is still operator-agnostic (false here, not solved yet)',
    !(await page.evaluate(() => window.App.Equation.isSolved(window.App.History.lastEquation()))));

  // --- Root-level sign flip on a negative multiply/divide ---
  await page.evaluate(() => window.App.History.startNewEquation(
    { left: [{ coeff: -2, pow: 1 }], right: [{ coeff: 4, pow: 0 }] },
    { operator: '>' }));
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\div-2');
    window.App.History.confirm();
  });
  await page.waitForTimeout(120);
  steps = await page.evaluate(() => window.App.History.getSteps());
  ok('dividing both sides by -2 flips ">" to "<"', steps[steps.length - 1].operator === '<');
  ok('App.Equation.isSolved sees "x < -2" as solved (operator-agnostic)',
    await page.evaluate(() => window.App.Equation.isSolved(window.App.History.lastEquation())));

  const flipLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label')).map((el) => el.textContent));
  ok('the flip step\'s arrow label mentions "sens inversé" at the ROOT chain too',
    flipLabels.some((t) => /sens invers/.test(t)));

  const solvedGlyph = await page.evaluate(() =>
    document.querySelector('.eq-row.solved .eq-sign').innerHTML);
  ok('the solved root row shows "<" (post-flip), not the original ">"',
    /3C|&lt;|</.test(solvedGlyph));

  // --- New-equation modal: relation picker buttons insert their token into the field ---
  await page.click('#newEquationBtn');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.MathKeypad.setLatex('3x'));
  await page.evaluate(() => {
    var btn = Array.prototype.find.call(document.querySelectorAll('#relationPicker .relation-btn'),
      function (b) { return b.getAttribute('data-relation') === '\\geq'; });
    btn.click();
  });
  await page.waitForTimeout(60);
  let fieldLatex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  ok('clicking the "≥" relation button inserts "\\geq" into the active field',
    fieldLatex.indexOf('\\geq') !== -1);

  // Full manual round-trip through the real modal (setLatex + the pavé's confirm key,
  // same convention as tests/manual_entry_variable_denominator.js).
  await page.evaluate(() => window.App.MathKeypad.setLatex('3x+1\\geq10'));
  await page.waitForTimeout(80);
  await page.click('.math-keypad-keys .panel-confirm-cell');
  await page.waitForTimeout(200);
  const errText = await page.$eval('#manualError', (el) => el.textContent);
  const modalOpen = await page.evaluate(() => !document.getElementById('modalOverlay').hidden);
  ok('the real modal accepts a "\\geq" inequality (no error, modal closes)', errText === '' && !modalOpen);
  ok('the resulting equation carries operator "\\geq"',
    (await page.evaluate(() => window.App.History.getCurrentOperator())) === '\\geq');
  const finalEq = await page.evaluate(() => window.App.History.lastEquation());
  ok('and the correct sides', JSON.stringify(finalEq) === JSON.stringify({
    left: [{ coeff: 3, pow: 1 }, { coeff: 1, pow: 0 }], right: [{ coeff: 10, pow: 0 }]
  }));

  // Reopening the modal on this equation must reflect its relation back in the field.
  await page.click('#newEquationBtn');
  await page.waitForTimeout(150);
  const reopenedLatex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  ok('reopening the modal prefills the field with "\\geq" (round-trip via getCurrentOperator)',
    reopenedLatex.indexOf('\\geq') !== -1);

  // --- Generator: generateLinearInequality() always returns a valid operator ---
  const genCheck = await page.evaluate(() => {
    var Ineq = window.App.Ineq;
    for (var i = 0; i < 200; i++) {
      var eq = window.App.Generator.generateLinearInequality();
      if (Ineq.OPERATORS.indexOf(eq.operator) === -1) return { ok: false, eq: JSON.stringify(eq) };
      try { window.App.History.startNewEquation({ left: eq.left, right: eq.right }, { operator: eq.operator }); }
      catch (e) { return { ok: false, error: e.message, eq: JSON.stringify(eq) }; }
    }
    return { ok: true };
  });
  ok('generateLinearInequality() always returns one of App.Ineq.OPERATORS and always loads', genCheck.ok);
  if (!genCheck.ok) console.log(JSON.stringify(genCheck));

  // --- "Produit nul" is reserved for equalities: the SAME "(x+2)(x+3) <op> 0" shape
  // that's produit-nul-eligible as an equality must hide/disable the button once it's an
  // inequality instead (retour utilisateur) — "Tableau de signes" is the right tool
  // there, exactly like canSignChart already refuses symmetrically for a plain "=". ---
  await page.evaluate(() => window.App.History.startNewEquation(
    { left: [{ sign: 1, factors: [
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 1 }
    ] }], right: [{ coeff: 0, pow: 0 }] },
    { operator: '\\geq' }));
  await page.waitForTimeout(120);
  ok('canProduitNul() is false for "(x+2)(x+3) \\geq 0" (an inequality)',
    !(await page.evaluate(() => window.App.History.canProduitNul())));
  ok('the "Produit nul" button row is hidden for this inequality',
    await page.evaluate(() => {
      var row = document.querySelector('button[data-op="produitnul"]').closest('.op-row');
      return row.hidden || row.classList.contains('row-hidden');
    }));

  // Same exact shape, but as a plain equality: Produit nul must be available again.
  await page.evaluate(() => window.App.History.startNewEquation(
    { left: [{ sign: 1, factors: [
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 1 }
    ] }], right: [{ coeff: 0, pow: 0 }] }));
  await page.waitForTimeout(120);
  ok('canProduitNul() is true for the same shape as a plain equality "=0"',
    await page.evaluate(() => window.App.History.canProduitNul()));
  ok('the "Produit nul" button row is visible again for the equality',
    await page.evaluate(() => {
      var row = document.querySelector('button[data-op="produitnul"]').closest('.op-row');
      return !row.hidden && !row.classList.contains('row-hidden');
    }));

  // --- Generator: generateEquation() draws roughly half inequalities, half equalities
  // (retour utilisateur) — a loose statistical band (not exactly 50%, to avoid flakiness
  // on a fixed sample size) over a large sample. ---
  const ratioCheck = await page.evaluate(() => {
    var N = 1000, ineqCount = 0;
    for (var i = 0; i < N; i++) {
      var eq = window.App.Generator.generateEquation();
      if (eq.operator) ineqCount++;
    }
    return { N: N, ineqCount: ineqCount };
  });
  const ineqRatio = ratioCheck.ineqCount / ratioCheck.N;
  console.log('generateEquation() inequality ratio over ' + ratioCheck.N + ' draws:', ineqRatio);
  ok('roughly half of generateEquation() draws are inequalities (within [0.4, 0.6])',
    ineqRatio >= 0.4 && ineqRatio <= 0.6);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
