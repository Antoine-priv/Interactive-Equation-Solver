const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Simplifier" sur une fraction dont le numérateur et le dénominateur ont un facteur
// commun : il s'annule, et l'étape garde la réserve "si (facteur)≠0" (desc.nonZero), comme
// pour une fraction de numérateur nul (voir Expr.cancelCommonQuotientFactor).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function simplifyLeftQuotient(latex) {
    await page.evaluate((l) => { window.App.History.startNewEquation(window.App.Parser.parseLatexEquation(l)); }, latex);
    await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
    const enabled = await page.evaluate(() => !!window.App.Expr.simplifySelection(window.App.History.lastEquation().left, [0]));
    await page.click('button[data-op="simplify"]');
    await page.waitForTimeout(150);
    const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
    return { enabled: enabled, step: step };
  }
  const T = (c, p) => ({ coeff: c, pow: p });
  function sideIs(side, terms) {
    // Accepte le résultat nu ("x+1") ou entre parenthèses ("(x+1)", FactorGroup de facteur 1).
    if (side.length === 1 && side[0].innerTerms && !side[0].isDivision && side[0].sign === 1 &&
        side[0].factor && side[0].factor.coeff === 1 && side[0].factor.pow === 0) side = side[0].innerTerms;
    return JSON.stringify(side) === JSON.stringify(terms);
  }

  // --- 1. (x+3)(x+1)/(x+3) = 0 -> x+1 = 0, "si (x+3)≠0" ---
  let r = await simplifyLeftQuotient('\\frac{(x+3)(x+1)}{x+3}=0');
  ok('Simplifier enabled on (x+3)(x+1)/(x+3)', r.enabled);
  ok('(x+3)(x+1)/(x+3) -> x+1', sideIs(r.step.equation.left, [T(1, 1), T(1, 0)]));
  ok('step keeps "(x+3)≠0"', r.step.opLeft && r.step.opLeft.nonZero && r.step.opLeft.nonZero.length === 1 &&
    JSON.stringify(r.step.opLeft.nonZero[0]) === JSON.stringify([T(1, 1), T(3, 0)]));
  const label = await page.evaluate(() => {
    var els = Array.from(document.querySelectorAll('.op-label, .arrow-label, [class*="label"]'));
    return els.map((e) => e.textContent).join(' | ');
  });
  ok('arrow label shows the reserve (≠)', label.indexOf('≠') !== -1);
  ok('lone result is written x+1, without parentheses', JSON.stringify(r.step.equation.left) === JSON.stringify([T(1, 1), T(1, 0)]));
  await page.mouse.click(1000, 700);
  await page.waitForTimeout(150);
  await page.screenshot({ path: SCRATCH + '/simplify_quotient_common_factor.png' });

  // --- 2. Exercice 24 : (3x-2)(x+5)/((4-x)(3x-2)) -> (x+5)/(4-x), "si (3x-2)≠0" ---
  r = await simplifyLeftQuotient('\\frac{(3x-2)(x+5)}{(4-x)(3x-2)}=3');
  const q = r.step.equation.left[0];
  ok('h simplifies to (x+5)/(4-x)', r.step.equation.left.length === 1 && q.isDivision && q.sign === 1 &&
    JSON.stringify(q.innerTerms) === JSON.stringify([T(1, 1), T(5, 0)]) &&
    JSON.stringify(q.factorTerms) === JSON.stringify([T(4, 0), T(-1, 1)]));
  ok('reserve is the cancelled factor (3x-2), not a value of x',
    r.step.opLeft && JSON.stringify(r.step.opLeft.nonZero) === JSON.stringify([[T(3, 1), T(-2, 0)]]));

  // --- 3. Facteur opposé : (x-3)(x+1)/(3-x) -> -(x+1) ---
  r = await simplifyLeftQuotient('\\frac{(x-3)(x+1)}{3-x}=0');
  const n = r.step.equation.left;
  const flat = n.length === 1 && n[0].innerTerms ? n[0] : null;
  ok('(x-3)(x+1)/(3-x) -> -(x+1)', sideIs(n, [T(-1, 1), T(-1, 0)]) ||
    (flat && flat.sign === -1 && JSON.stringify(flat.innerTerms) === JSON.stringify([T(1, 1), T(1, 0)])));

  // --- 4. Pas de facteur commun : Simplifier reste indisponible ---
  await page.evaluate((l) => { window.App.History.startNewEquation(window.App.Parser.parseLatexEquation(l)); }, '\\frac{(x+2)(x+1)}{x+3}=0');
  const nothing = await page.evaluate(() => window.App.Expr.simplifySelection(window.App.History.lastEquation().left, [0]));
  ok('no common factor: nothing to simplify', nothing === null);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
