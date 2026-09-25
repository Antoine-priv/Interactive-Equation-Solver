const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// 1. "Simplifier" une fraction de numérateur nul : vaut 0 ; étiquette orange "si (…)≠0"
//    quand le dénominateur dépend de x (desc.nonZero, voir Expr.simplifySelection).
// 2-4. "Racine carrée" dans une colonne "Condition d'existence" (dénominateur, "≠") :
//    aperçu affiché dans la colonne, constante calculée directement avec le réglage
//    "Toujours simplifier", sous-branches toujours affichées "≠", Df = réunion des feuilles.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => { try { localStorage.removeItem('equations-settings'); } catch (e) {} });
  await page.reload();

  // --- 1. Numérateur nul ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [
        { sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }], innerTerms: [{ coeff: 0, pow: 0 }], isDivision: true },
        { coeff: 2, pow: 1 }
      ],
      right: [{ coeff: 4, pow: 0 }]
    });
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  ok('0/(x+5) selected: "Simplifier" is enabled',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canSimplify));
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(200);
  let st = await page.evaluate(() => {
    var steps = window.App.History.getSteps();
    return { left: steps[steps.length - 1].equation.left, opLeft: steps[steps.length - 1].opLeft,
      warnLabels: document.querySelectorAll('.arrow-label.arrow-label-warning').length };
  });
  ok('0/(x+5)+2x -> 2x (the 0 disappears)', JSON.stringify(st.left) === JSON.stringify([{ coeff: 2, pow: 1 }]));
  ok('simplify desc carries nonZero = [x+5]',
    st.opLeft && JSON.stringify(st.opLeft.nonZero) === JSON.stringify([[{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }]]));
  ok('its arrow label is orange (warning)', st.warnLabels === 1);
  await page.screenshot({ path: `${SCRATCH}/zero_numerator_simplify.png` });

  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factor: { coeff: 3, pow: 0 }, innerTerms: [{ coeff: 0, pow: 0 }], isDivision: true }],
      right: [{ coeff: 1, pow: 1 }]
    });
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);
  st = await page.evaluate(() => {
    var steps = window.App.History.getSteps();
    return { left: steps[steps.length - 1].equation.left, opLeft: steps[steps.length - 1].opLeft,
      warnLabels: document.querySelectorAll('.arrow-label.arrow-label-warning').length };
  });
  ok('0/3 -> 0, kept since alone on its side', JSON.stringify(st.left) === JSON.stringify([{ coeff: 0, pow: 0 }]));
  ok('numeric denominator: no condition, no orange label', !st.opLeft.nonZero && st.warnLabels === 0);

  // --- 2-4. Racine carrée dans une colonne "≠" ---
  await page.evaluate(() => {
    window.App.Settings.set('autoSimplify', true);
    window.App.History.startNewEquation({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 2 }, { coeff: -4, pow: 0 }], innerTerms: [{ coeff: 1, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);
  await page.locator('.domain-branch[data-domain-index="0"] .side[data-side="left"] .term[data-index="0"]').click();
  await page.waitForTimeout(60);
  ok('domain column focused', (await page.evaluate(() => window.App.History.getFocusedDomain())) === 0);

  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('+4');
    window.App.History.confirm();
  });
  await page.waitForTimeout(120);
  ok('column reads x²=4 after "+4" (auto-simplified)', await page.evaluate(() =>
    JSON.stringify(window.App.History.lastEquation()) === JSON.stringify({ left: [{ coeff: 1, pow: 2 }], right: [{ coeff: 4, pow: 0 }] })));

  await page.evaluate(() => { window.App.History.selectOp('expr'); window.App.History.toggleSquareRootArmed(); });
  await page.waitForTimeout(150);
  ok('√ armed: preview row shown inside the domain column',
    await page.evaluate(() => document.querySelectorAll('.domain-branch .eq-row.pending.preview-pop-in').length === 1));
  await page.screenshot({ path: `${SCRATCH}/sqrt_domain_preview.png` });

  await page.evaluate(() => window.App.History.confirmSquareRoot());
  await page.waitForTimeout(150);
  let eq = await page.evaluate(() => window.App.History.lastEquation());
  ok('autoSimplify: √4 computed directly in the wrap step (√(x²)=2)',
    eq.left.length === 1 && !!eq.left[0].radicand && JSON.stringify(eq.right) === JSON.stringify([{ coeff: 2, pow: 0 }]));

  await page.evaluate(() => window.App.History.toggleTermSelection('left', 0));
  await page.hover('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('hovering "Simplifier": ± fork preview (2 columns) inside the domain column',
    await page.evaluate(() => document.querySelectorAll('.domain-branch .produit-nul-preview > .produit-nul-branch').length === 2));
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(250);

  const branched = await page.evaluate(() => {
    var cond = window.App.History.getDomainConditions()[0];
    var signs = Array.prototype.map.call(document.querySelectorAll('.domain-branch .eq-sign annotation'), function (el) { return el.textContent; });
    var df = document.querySelector('.domain-df-result annotation');
    return { branches: cond.engine.getBranches() ? cond.engine.getBranches().length : 0, signs: signs, df: df ? df.textContent : null };
  });
  ok('the column split into 2 branches', branched.branches === 2);
  ok('every row of the split column still reads "≠" (' + branched.signs.join(' ') + ')',
    branched.signs.length >= 4 && branched.signs.every(function (s) { return s === '\\neq'; }));
  ok('Df = R\\{-2;2} (both branches, not just the focused one): ' + branched.df,
    branched.df && /-2\\,;\\,2/.test(branched.df));
  await page.screenshot({ path: `${SCRATCH}/sqrt_domain_branches.png` });

  // Sans le réglage : le membre constant reste "√4".
  await page.evaluate(() => {
    window.App.Settings.set('autoSimplify', false);
    window.App.History.startNewEquation(window.App.Parser.parseEquation('x^2=9'));
    window.App.History.selectOp('expr');
    window.App.History.toggleSquareRootArmed();
    window.App.History.confirmSquareRoot();
  });
  eq = await page.evaluate(() => window.App.History.lastEquation());
  ok('autoSimplify off: constant side stays wrapped (√9)', eq.right.length === 1 && !!eq.right[0].radicand);

  ok('no page errors (' + errs.join(' | ') + ')', errs.length === 0);
  await browser.close();
})();
