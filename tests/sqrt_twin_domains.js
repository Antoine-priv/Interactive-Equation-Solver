const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Niveau m8 de la campagne ("Les jumeaux", docs/gamification/plan.md) : "√x = 0" donne
// S = {0}, alors que "√x·√x/√x = 0", qui se simplifie en "√x = 0" (si √x ≠ 0), a pour
// domaine x > 0 et donne donc S = ∅.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  const SQX = { sign: 1, radicand: [{ coeff: 1, pow: 1 }] };

  async function start(latex) {
    await page.evaluate((l) => { window.App.History.startNewEquation(window.App.Parser.parseLatexEquation(l)); }, latex);
    await page.waitForTimeout(100);
  }
  async function squareAndReadFinal() {
    await page.evaluate(() => window.App.History.confirmSquareBothSides());
    await page.waitForTimeout(150);
    return page.evaluate(() => {
      var el = document.querySelector('.final-solution-set');
      return { eq: window.App.History.lastEquation(), text: el ? el.textContent : null };
    });
  }

  // --- f : √x = 0 -> x = 0, S = {0} ---
  await start('\\sqrt{x}=0');
  ok('"√x = 0": square both sides available', await page.evaluate(() => window.App.History.canSquareBothSides()));
  let r = await squareAndReadFinal();
  ok('"√x = 0" -> x = 0', JSON.stringify(r.eq.left) === JSON.stringify([{ coeff: 1, pow: 1 }]) &&
    JSON.stringify(r.eq.right) === JSON.stringify([{ coeff: 0, pow: 0 }]));
  ok('S = {0} is shown', !!r.text && r.text.indexOf('0') !== -1 && r.text.indexOf('∅') === -1);

  // --- g : √x·√x/√x = 0 ---
  await start('\\frac{\\sqrt{x}\\sqrt{x}}{\\sqrt{x}}=0');
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  ok('"Condition d\'existence" available on the √x denominator', await page.evaluate(() => window.App.History.canExistenceCondition()));
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);
  const conds = await page.evaluate(() => window.App.History.getDomainConditions().map((c) => ({ kind: c.kind, op: c.operator, arr: c.capturedArray })));
  ok('denominator column is "√x ≠ 0"', conds.length === 1 && conds[0].kind === 'den' &&
    conds[0].op === '\\neq' && JSON.stringify(conds[0].arr) === JSON.stringify([SQX]));
  // Double-clic sur la racine du dénominateur drillé : "x ≥ 0".
  const conds2 = await page.evaluate(() => {
    var H = window.App.History;
    H.focusMain();
    H.toggleTermSelection('left', 0, null, true); H.toggleTermSelection('left', 0, null, true);
    H.toggleInnerSelection(0); H.toggleInnerSelection(0);
    H.existenceConditionAction();
    H.setFocusedDomain(0); H.confirmSquareBothSides();
    H.focusMain();
    return H.getDomainConditions().map((c) => ({ kind: c.kind, op: c.operator, arr: c.capturedArray }));
  });
  ok('the √ of the denominator gives "x ≥ 0"', conds2.length === 2 && conds2[1].kind === 'sqrt' &&
    conds2[1].op === '\\geq' && JSON.stringify(conds2[1].arr) === JSON.stringify([{ coeff: 1, pow: 1 }]));

  // Le canevas s'est recentré sur la colonne de domaine : sélection via l'API.
  await page.evaluate(() => {
    var H = window.App.History;
    H.focusMain();
    H.toggleTermSelection('left', 0);
    H.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('Simplifier gives the same form as f: "√x = 0"', JSON.stringify(step.equation.left) === JSON.stringify([SQX]));
  ok('with the reserve "si √x ≠ 0"', step.opLeft && JSON.stringify(step.opLeft.nonZero) === JSON.stringify([[SQX]]));

  r = await squareAndReadFinal();
  ok('then x = 0', JSON.stringify(r.eq.left) === JSON.stringify([{ coeff: 1, pow: 1 }]));
  ok('S = ∅ once intersected with the domain ℝ∖{0} ∩ [0;+∞[', !!r.text && r.text.indexOf('∅') !== -1);
  await page.mouse.click(1250, 850);
  await page.waitForTimeout(100);
  await page.screenshot({ path: SCRATCH + '/sqrt_twin_domains.png' });

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
