const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Tableau de signes" end to end, using the reference example -(x+1)(x-2)/(1-x) >= 0
// (injected as an AST since a variable-denominator/leading-sign inequality of this shape
// isn't producible through the manual parser yet): eligibility gating (disabled until the
// domain of definition is established), per-factor spawning ("<factor> > 0", fixed
// convention), factor-column rendering, the interactive table (appears only once every
// factor is solved), row/cell popups, and structural validation - checked against the
// exact values of the printed reference tableau (-,0,+,‖,-,0,+ on the combined row).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 4200 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

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
  ok('canSignChart true for a pure product >= 0 (no denominator)',
    await page.evaluate(() => window.App.History.canSignChart()));
  ok('#signChartBtn enabled', !(await page.evaluate(() => document.getElementById('signChartBtn').disabled)));

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
  ok('canSignChart false: denominator domain not established yet',
    !(await page.evaluate(() => window.App.History.canSignChart())));
  ok('#signChartBtn disabled', await page.evaluate(() => document.getElementById('signChartBtn').disabled));
  ok('tooltip mentions the domain condition',
    /condition d.existence/i.test(await page.evaluate(() => document.getElementById('signChartBtn').title)));

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
  ok('still disabled: domain column spawned but not yet solved down to x=1',
    !(await page.evaluate(() => window.App.History.canSignChart())));
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.selectOp('expr'); Hist.setExprChainText('\\div-1'); Hist.confirm();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(100);
  ok('canSignChart now true: domain fully established',
    await page.evaluate(() => window.App.History.canSignChart()));
  ok('#signChartBtn now enabled', !(await page.evaluate(() => document.getElementById('signChartBtn').disabled)));

  // --- Spawning: one "<factor> > 0" engine per distinct factor, num/den tagged ---
  await page.click('#signChartBtn');
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
  ok('a second click does not spawn a duplicate set',
    (await page.evaluate(() => window.App.History.signChartAction())).spawned === false);

  ok('3 factor columns rendered', (await page.$$('.domain-branch[data-signchart-factor-index]')).length === 3);
  ok('"Tableau de signes" header shown',
    (await page.textContent('.sign-chart-factors-header')) === 'Tableau de signes');
  ok('no table yet: factors unsolved', (await page.$('.sign-chart-table')) === null);

  // --- Solve all 3 factors: "1-x>0" -> "x<1" (flip) ; "x+1>0" -> "x>-1" ; "x-2>0" -> "x>2" ---
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

    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);

  const roots = await page.evaluate(() =>
    window.App.History.getSignChart().factors.map(function (f) {
      return window.App.Equation.solvedValue(f.engine.lastEquation());
    }));
  ok('roots solved correctly (den=1, num=-1, num=2)', JSON.stringify(roots) === JSON.stringify([1, -1, 2]));

  const table = await page.$('.sign-chart-table');
  ok('table now rendered', !!table);
  ok('8 header cells (row-label + 2*3+1 columns)', (await page.$$('.sign-chart-header-cell')).length === 8);

  // --- Add all 4 rows (3 factors + total) through the REAL button/popup ---
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.App.Canvas.set(0, 0));
    await page.click('.sign-chart-add-row-btn', { force: true });
    await page.waitForTimeout(60);
    const optCount = (await page.$$('.sign-chart-popup-btn')).length;
    if (i === 0) ok('4 options offered the first time (3 factors + total)', optCount === 4);
    await page.click('.sign-chart-popup-btn:first-child', { force: true });
    await page.waitForTimeout(60);
  }
  ok('all 4 rows added, "+ Ajouter une rangée" now gone', (await page.$('.sign-chart-add-row-btn')) === null);
  const rowKinds = await page.evaluate(() => window.App.History.getSignChart().tableRows.map(function (r) {
    return r.rowKind + (r.factorIndex !== undefined ? ':' + r.factorIndex : '');
  }));
  // Row-add popup lists each not-yet-added factor first (in factor-array order), then
  // "total" last (see availableOptions in render.js) -- clicking the first option each
  // time therefore adds factor:0, factor:1, factor:2, then total, in that order.
  ok('rows are factor:0 (den), factor:1 (num), factor:2 (num), total, in add order',
    JSON.stringify(rowKinds) === JSON.stringify(['factor:0', 'factor:1', 'factor:2', 'total']));
  const totalRowIndex = rowKinds.indexOf('total');

  // --- Cell popups: interval offers +/-, boundary offers 0/‖ ---
  await page.evaluate(() => window.App.Canvas.set(0, 0));
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

  // --- The double-rule marks exactly the excluded-domain boundary column (x=1, col index 3) ---
  const excludedCols = await page.$$eval('.sign-chart-header-cell.sign-chart-col-excluded', function (els) { return els.length; });
  ok('exactly one excluded-domain header column (x=1)', excludedCols === 1);

  await page.screenshot({ path: `${SCRATCH}/sign_chart_full.png`, fullPage: true });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
