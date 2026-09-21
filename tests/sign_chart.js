const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Tableau de signes" end to end, using the reference example -(x+1)(x-2)/(1-x) >= 0
// (injected as an AST since a variable-denominator/leading-sign inequality of this shape
// isn't producible through the manual parser yet): the button lives in the contextual
// action window (#opButtons, like "Produit nul"/"Condition d'existence"), not a floating
// top-left button; eligibility gating; per-factor spawning; a re-click once already
// spawned pans to the table/factors instead of doing nothing; factor columns stay
// horizontal (never wrap); the pending "Opération" preview shows the real inequality
// glyph, not "="; adding a row via a factor/total option works even while a factor is
// still focused (regression for a reported "nothing happens" bug); the "+ Ajouter une
// rangée" button only shows on hover; and structural validation matches the printed
// reference tableau's -,0,+,‖,-,0,+ exactly.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const btnSel = 'button[data-op="signchart"]';
  // Sélectionne/désélectionne (idempotent, jamais un simple bascule) le terme 0 du membre
  // gauche via l'API -- jamais un vrai clic DOM -- juste pour ouvrir/fermer #opButtons
  // sans risquer d'interférer avec un double-clic de drill ultérieur sur une PARTIE de ce
  // même terme (ex. [data-fracpart="den"]) : observé empiriquement qu'un terme déjà
  // "selected" perturbe ce double-clic.
  async function isTerm0Selected() {
    return page.evaluate(() => window.App.History.getPending().selectedLeft.indexOf(0) !== -1);
  }
  async function openActionWindow() {
    if (!(await isTerm0Selected())) await page.evaluate(() => window.App.History.toggleTermSelection('left', 0));
    await page.waitForTimeout(80);
  }
  async function closeActionWindow() {
    if (await isTerm0Selected()) await page.evaluate(() => window.App.History.toggleTermSelection('left', 0));
    await page.waitForTimeout(80);
  }
  async function btnHidden() {
    // `row.hidden` seul ne suffit pas : la rangée peut être en cours d'animation de
    // sortie (`.row-hidden` déjà posé, `hidden` réel seulement à la fin de la transition,
    // voir setRowVisibility dans toolbar.js) — les deux comptent comme "cachée" ici.
    return page.evaluate((sel) => {
      var b = document.querySelector(sel);
      if (!b) return true;
      var row = b.closest('.op-row');
      return !!row.hidden || row.classList.contains('row-hidden');
    }, btnSel);
  }

  ok('no floating #signChartBtn anymore', (await page.$('#signChartBtn')) === null);

  // --- Eligibility: no denominator at all -> trivially domain-ready, enabled immediately ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
  });
  await page.waitForTimeout(80);
  await openActionWindow();
  ok('canSignChart true for a pure product >= 0 (no denominator)',
    await page.evaluate(() => window.App.History.canSignChart()));
  ok('button visible in the action window (not the top-left corner)', !(await btnHidden()));
  ok('tooltip explains what it does',
    /tableau de signes/i.test(await page.evaluate((sel) => document.querySelector(sel).getAttribute('data-tooltip'), btnSel)));

  // --- Eligibility: with a denominator, gated on "Condition d'existence" being resolved ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{
        sign: -1, isDivision: true,
        factorTerms: [{ coeff: -1, pow: 1 }, { coeff: 1, pow: 0 }],
        innerTerms: [{ sign: 1, factors: [
          { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
          { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
        ] }]
      }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
  });
  await page.waitForTimeout(80);
  // (No DOM-visibility check here: opening the action window needs selecting term 0, but
  // two quick API toggles on the SAME term are indistinguishable from a real double-click
  // -- which drills INTO this term, since it's itself a FactorGroup -- derailing the
  // denominator drill right below. The eligibility gate itself is still covered via the
  // API, and its DOM wiring is covered before/after this transitional moment.)
  ok('canSignChart false: denominator domain not established yet',
    !(await page.evaluate(() => window.App.History.canSignChart())));

  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.setFocusedDomain(0);
    Hist.selectOp('expr'); Hist.setExprChainText('-1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
  });
  await page.waitForTimeout(100);
  ok('still ineligible: domain column spawned but not yet solved down to x=1',
    !(await page.evaluate(() => window.App.History.canSignChart())));
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.selectOp('expr'); Hist.setExprChainText('\\div-1'); Hist.confirm();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(100);
  await openActionWindow();
  ok('canSignChart now true: domain fully established',
    await page.evaluate(() => window.App.History.canSignChart()));
  ok('button now visible', !(await btnHidden()));

  // --- Inequality preview: the "Opération" pending row shows the real glyph, not "=" ---
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('-1');
  });
  await page.waitForTimeout(80);
  const pendingGlyph = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.pending .eq-sign');
    return el ? el.innerHTML : null;
  });
  ok('pending preview shows "≥", not "="', pendingGlyph && /2265|\\geq|≥/.test(pendingGlyph));
  await page.evaluate(() => { window.App.History.cancelOp(); });
  await page.waitForTimeout(60);
  await openActionWindow();

  // --- Spawning: click via the REAL action-window button, one "<factor> > 0" per factor ---
  await page.click(btnSel, { force: true });
  await page.waitForTimeout(150);
  const spawnInfo = await page.evaluate(() => {
    var sc = window.App.History.getSignChart();
    return sc.factors.map(function (f) {
      return { kind: f.kind, firstStepOperator: f.engine.getSteps()[0].operator };
    });
  });
  console.log('spawned factors:', JSON.stringify(spawnInfo));
  ok('3 factors spawned: den "1-x", num "x+1", num "x-2" (walk order)',
    JSON.stringify(spawnInfo.map(function (f) { return f.kind; })) === JSON.stringify(['den', 'num', 'num']));
  ok('every factor seeded as "> 0" (fixed convention)',
    spawnInfo.every(function (f) { return f.firstStepOperator === '>'; }));

  ok('3 factor columns rendered', (await page.$$('.domain-branch[data-signchart-factor-index]')).length === 3);
  ok('"Tableau de signes" header shown',
    (await page.textContent('.sign-chart-factors-header')) === 'Tableau de signes');
  ok('no table yet: factors unsolved', (await page.$('.sign-chart-table')) === null);

  const colTops = await page.$$eval('.domain-branch[data-signchart-factor-index]',
    (els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('factor columns are horizontally side by side (same top, never wrap)',
    colTops.length === 3 && colTops[0] === colTops[1] && colTops[1] === colTops[2]);

  // --- A second click (already spawned) does not duplicate, and pans instead of no-op ---
  await openActionWindow();
  ok('button stays available once already spawned (not hidden)', !(await btnHidden()));
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(60);
  const canvasBefore = await page.evaluate(() => ({ x: window.App.Canvas.getX(), y: window.App.Canvas.getY() }));
  await page.click(btnSel, { force: true });
  await page.waitForTimeout(150);
  const flashed = await page.evaluate(() => !!document.querySelector('.sign-chart-flash'));
  ok('re-clicking flashes the factors/table to confirm where it focused', flashed);
  await page.waitForTimeout(700);
  const canvasAfter = await page.evaluate(() => ({ x: window.App.Canvas.getX(), y: window.App.Canvas.getY() }));
  ok('re-clicking panned the view (not a no-op)',
    Math.abs(canvasAfter.x - canvasBefore.x) > 3 || Math.abs(canvasAfter.y - canvasBefore.y) > 3);
  ok('still exactly 3 factors (no duplicate spawn)',
    (await page.evaluate(() => window.App.History.getSignChart().factors.length)) === 3);

  // --- Solve all 3 factors, DELIBERATELY leaving one focused (regression scenario) ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.setFocusedSignChartFactor(0);
    Hist.selectOp('expr'); Hist.setExprChainText('-1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.selectOp('expr'); Hist.setExprChainText('\\div-1'); Hist.confirm();

    Hist.setFocusedSignChartFactor(1);
    Hist.selectOp('expr'); Hist.setExprChainText('-1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();

    Hist.setFocusedSignChartFactor(2);
    Hist.selectOp('expr'); Hist.setExprChainText('+2'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    // No focusMain() here on purpose: factor 2 stays focused, reproducing the exact
    // scenario a real user leaves the app in right after solving the last factor.
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  ok('a factor is still focused (not returned to the main chain)',
    (await page.evaluate(() => window.App.History.getFocusedSignChartFactor())) !== null);

  const roots = await page.evaluate(() =>
    window.App.History.getSignChart().factors.map(function (f) {
      return window.App.Equation.solvedValue(f.engine.lastEquation());
    }));
  ok('roots solved correctly (den=1, num=-1, num=2)', JSON.stringify(roots) === JSON.stringify([1, -1, 2]));

  const table = await page.$('.sign-chart-table');
  ok('table now rendered', !!table);
  ok('8 header cells (row-label + 2*3+1 columns)', (await page.$$('.sign-chart-header-cell')).length === 8);

  // --- "+ Ajouter une rangée" only shows on hover ---
  const wrap = page.locator('.sign-chart-table-wrap');
  ok('add-row button hidden before hovering the table', !(await page.locator('.sign-chart-add-row-btn').isVisible()));
  await wrap.hover();
  await page.waitForTimeout(200);
  ok('add-row button visible once hovering the table', await page.locator('.sign-chart-add-row-btn').isVisible());

  // --- THE reported bug: clicking a factor/total option while a factor is still focused
  // must actually add the row (previously silently delegated into the focused factor's
  // own, nonexistent, signChart and did nothing). ---
  await page.click('.sign-chart-add-row-btn', { force: true });
  await page.waitForTimeout(80);
  const optCount = (await page.$$('.sign-chart-popup-btn')).length;
  ok('4 options offered the first time (3 factors + total)', optCount === 4);
  await page.click('.sign-chart-popup-btn:first-child', { force: true });
  await page.waitForTimeout(100);
  ok('clicking a FACTOR option while a factor is still focused actually adds a row',
    (await page.evaluate(() => window.App.History.getSignChart().tableRows.length)) === 1);

  for (let i = 0; i < 3; i++) {
    await wrap.hover();
    await page.waitForTimeout(60);
    await page.click('.sign-chart-add-row-btn', { force: true });
    await page.waitForTimeout(60);
    await page.click('.sign-chart-popup-btn:first-child', { force: true });
    await page.waitForTimeout(60);
  }
  ok('all 4 rows added', (await page.evaluate(() => window.App.History.getSignChart().tableRows.length)) === 4);
  await wrap.hover();
  await page.waitForTimeout(60);
  ok('"+ Ajouter une rangée" now gone (nothing left to add)', (await page.$('.sign-chart-add-row-btn')) === null);

  const rowKinds = await page.evaluate(() => window.App.History.getSignChart().tableRows.map(function (r) {
    return r.rowKind + (r.factorIndex !== undefined ? ':' + r.factorIndex : '');
  }));
  // Row-add popup lists each not-yet-added factor first (factor-array order), then
  // "total" last (see availableOptions in render.js) -- clicking the first option each
  // time therefore adds factor:0, factor:1, factor:2, then total, in that order.
  ok('rows are factor:0 (den), factor:1 (num), factor:2 (num), total, in add order',
    JSON.stringify(rowKinds) === JSON.stringify(['factor:0', 'factor:1', 'factor:2', 'total']));
  const totalRowIndex = rowKinds.indexOf('total');

  // --- Cell popups: interval offers +/-, boundary offers 0/‖ ---
  const intervalCell = page.locator('.sign-chart-data-cell[data-sign-chart-row="1"][data-sign-chart-col="2"]');
  await intervalCell.click({ force: true });
  await page.waitForTimeout(60);
  let popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('interval cell popup offers +/-', JSON.stringify(popupTexts) === JSON.stringify(['+', '−']));
  await page.click('.sign-chart-popup-btn:first-child'); // '+'
  await page.waitForTimeout(60);
  ok('interval cell now shows +', (await intervalCell.textContent()) === '+');

  const boundaryCell = page.locator('.sign-chart-data-cell[data-sign-chart-row="1"][data-sign-chart-col="1"]');
  await boundaryCell.click({ force: true });
  await page.waitForTimeout(60);
  popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('boundary cell popup offers 0/‖', JSON.stringify(popupTexts) === JSON.stringify(['0', '‖']));
  await page.click('.sign-chart-popup-btn:first-child'); // '0'
  await page.waitForTimeout(60);

  // Click-outside closes without picking.
  await page.locator('.sign-chart-data-cell[data-sign-chart-row="1"][data-sign-chart-col="0"]').click({ force: true });
  await page.waitForTimeout(60);
  ok('popup open', (await page.$('.sign-chart-popup')) !== null);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(60);
  ok('popup closed on outside click, no value set',
    (await page.$('.sign-chart-popup')) === null &&
    (await page.evaluate(() => window.App.History.getSignChart().tableRows[1].cells[0])) === null);

  // --- Validation: fill the "total" row with the EXACT reference-image values ---
  const expectedTotal = ['-', '0', '+', 'undef', '-', '0', '+'];
  await page.evaluate(function (args) {
    var Hist = window.App.History;
    args.vals.forEach(function (v, i) { Hist.signChartSetCell(args.row, i, v); });
  }, { row: totalRowIndex, vals: expectedTotal });
  await page.waitForTimeout(80);
  const totalCorrectness = await page.evaluate(function (row) {
    var r = [];
    for (var i = 0; i < 7; i++) r.push(window.App.History.signChartCellCorrect(row, i));
    return r;
  }, totalRowIndex);
  ok('reference tableau row (-,0,+,‖,-,0,+) is entirely correct', totalCorrectness.every(function (c) { return c === true; }));
  ok('no wrong-cell styling on the total row',
    (await page.$$('.sign-chart-data-cell[data-sign-chart-row="' + totalRowIndex + '"].sign-chart-cell-wrong')).length === 0);

  // Now set ONE wrong value and check it is flagged, styled, and stays visible (not reverted).
  await page.evaluate((row) => window.App.History.signChartSetCell(row, 0, '+'), totalRowIndex);
  await page.waitForTimeout(80);
  ok('a wrong cell is flagged incorrect',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 0), totalRowIndex)) === false);
  const wrongCell = page.locator('.sign-chart-data-cell[data-sign-chart-row="' + totalRowIndex + '"][data-sign-chart-col="0"]');
  ok('the wrong cell carries the styling class', (await wrongCell.getAttribute('class')).indexOf('sign-chart-cell-wrong') !== -1);
  ok('the wrong cell still shows what was typed (not reverted)', (await wrongCell.textContent()) === '+');

  // --- The double-rule marks exactly the excluded-domain boundary column (x=1) ---
  const excludedCols = await page.$$eval('.sign-chart-header-cell.sign-chart-col-excluded', function (els) { return els.length; });
  ok('exactly one excluded-domain header column (x=1)', excludedCols === 1);

  await page.screenshot({ path: `${SCRATCH}/sign_chart_full.png`, fullPage: true });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
