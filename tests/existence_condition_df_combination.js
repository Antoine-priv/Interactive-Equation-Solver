const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Phase 4 du plan "Condition d'existence" : deux colonnes de domaine indépendantes (une
// pour "5/(x+3)", une pour "√(x-2)", toutes deux dans la MÊME équation
// "5/(x+3)+√(x-2)=10") — le résumé "Df=cond1∩cond2" ne doit apparaître qu'une fois LES
// DEUX résolues, jamais avant ; et un second clic "Condition d'existence" sur un
// dénominateur/radicand déjà spawné doit faire clignoter (".domain-branch-flash") la
// bonne colonne plutôt que d'en créer une seconde (voir panToDomainColumn dans render.js).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [
        { sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true },
        { sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }] }
      ],
      right: [{ coeff: 10, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  // --- Spawn condition #0: the denominator "x+3" ---
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(120);

  // Re-center first: spawning condition #0 above auto-panned the viewport onto its new
  // column (bug fix — the view used to only pan on a dedup click, never on a fresh
  // spawn), which can leave the main equation (and its action window) outside the
  // viewport, same as panning onto a wide "Produit nul" split does.
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(60);

  // --- Spawn condition #1: the radicand "x-2" (index 1 on the left side) ---
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 1);
    window.App.History.toggleTermSelection('left', 1);
  });
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the radicand (second term)', pending.drilled && pending.drilled.part === 'sqrt');
  await page.click('button[data-op="existence"]', { force: true });
  await page.waitForTimeout(120);

  const conditionsCount = await page.evaluate(() => window.App.History.getDomainConditions().length);
  ok('two independent domain conditions were spawned', conditionsCount === 2);

  ok('no "Df=" summary yet (neither condition solved)',
    !(await page.evaluate(() => !!document.querySelector('.domain-df-result'))));

  // --- Solve condition #0 (denominator): x+3=0 -> x=-3 ---
  await page.evaluate(() => {
    window.App.History.setFocusedDomain(0);
    var H = window.App.History;
    H.selectOp('expr');
    H.setExprChainText('-3');
    H.confirm();
    H.toggleTermSelection('left', 1);
    H.toggleTermSelection('left', 2);
    H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0);
    H.toggleTermSelection('right', 1);
    H.confirmSimplifySelection();
  });
  await page.waitForTimeout(120);
  const cond0Solved = await page.evaluate(() => window.App.Equation.isSolved(window.App.History.getDomainConditions()[0].engine.lastEquation()));
  ok('condition #0 (denominator) is solved (x=-3)', cond0Solved);

  ok('still no "Df=" summary (only ONE of the two conditions solved)',
    !(await page.evaluate(() => !!document.querySelector('.domain-df-result'))));

  // --- Solve condition #1 (radicand): x-2>=0 -> +2 -> x>=2 ---
  await page.evaluate(() => {
    window.App.History.setFocusedDomain(1);
    var H = window.App.History;
    H.selectOp('expr');
    H.setExprChainText('+2');
    H.confirm();
    H.toggleTermSelection('left', 1);
    H.toggleTermSelection('left', 2);
    H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0);
    H.toggleTermSelection('right', 1);
    H.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);

  const dfHtml = await page.evaluate(() => {
    var el = document.querySelector('.domain-df-result');
    return el ? el.innerHTML : null;
  });
  ok('the "Df=" summary now appears (both conditions solved)', !!dfHtml);
  await page.screenshot({ path: `${SCRATCH}/existence_condition_df_combination.png` });

  // --- Dedup + flash: re-drill the SAME denominator and click "Condition d'existence"
  // again -> pans + flashes column #0, creates no third condition. ---
  // Also hand focus back to the main chain first: it was left on domain column #1 after
  // solving it above, and a first click on a not-yet-focused chain only refocuses it
  // (same convention as a "Produit nul" branch) rather than registering toward a
  // double-click — without this, the two clicks below would only count as one.
  await page.evaluate(() => {
    window.App.Canvas.set(0, 0);
    window.App.History.focusMain();
  });
  await page.waitForTimeout(60);
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(80);

  const stillTwo = await page.evaluate(() => window.App.History.getDomainConditions().length);
  ok('dedup: still exactly 2 domain conditions (no duplicate)', stillTwo === 2);

  const flashedRightAway = await page.evaluate(() =>
    document.querySelector('.domain-branch[data-domain-index="0"]').classList.contains('domain-branch-flash'));
  ok('the matching column flashes right after the dedup click', flashedRightAway);

  await page.waitForTimeout(1100);
  const flashedLater = await page.evaluate(() =>
    document.querySelector('.domain-branch[data-domain-index="0"]').classList.contains('domain-branch-flash'));
  ok('the flash class is removed again after its animation duration', !flashedLater);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
