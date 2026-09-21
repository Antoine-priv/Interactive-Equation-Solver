const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Valeur exacte rendue dans un .sign-chart-target (voir SIGN_CHART_CELL_LATEX dans
// render.js) : lue via l'annotation KaTeX (le LaTeX brut passé à katex.render), jamais
// .textContent -- qui agrège AUSSI le MathML caché et l'annotation en plus du HTML
// visuellement affiché, donc jamais une valeur exacte unique à comparer. Renvoie null si
// la case est encore vide (pas de <math> rendu, juste le repère "." textuel).
async function targetLatex(page, row, col) {
  return page.evaluate(function (args) {
    var target = document.querySelector(
      '.sign-chart-target[data-sign-chart-row="' + args.row + '"][data-sign-chart-col="' + args.col + '"]');
    if (!target) return undefined;
    var annotation = target.querySelector('annotation');
    return annotation ? annotation.textContent : null;
  }, { row: row, col: col });
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
  const page = await browser.newPage({ viewport: { width: 1500, height: 1800 } });
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

  // --- The button hides while working INSIDE the sign chart's own factors ---
  ok('canSignChart is false while a factor is focused (even with a term selected)',
    !(await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      return window.App.History.canSignChart();
    })));
  ok('button row hidden while focused inside the sign chart', await btnHidden());
  await page.evaluate(() => window.App.History.focusMain());
  await page.waitForTimeout(80);
  ok('canSignChart true again once back on the main chain',
    await page.evaluate(() => window.App.History.canSignChart()));
  // Refocus factor 2 to resume the intended flow (table not built yet at this point).
  await page.evaluate(() => window.App.History.setFocusedSignChartFactor(2));
  await page.waitForTimeout(80);

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

  // --- No "." placeholder in a freshly-added, still-empty row (retour utilisateur) ---
  const emptyTargetText = await page.evaluate(() => {
    var t = document.querySelector('.sign-chart-target-empty');
    return t ? t.textContent : undefined;
  });
  ok('an empty target has no "." placeholder text', emptyTargetText === '');

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

  // --- Cell popups: interval offers +/-, boundary offers 0/‖ -- clicking the small
  // centered .sign-chart-target (never the whole .sign-chart-data-cell, retour
  // utilisateur) opens them. ---
  const intervalTarget = page.locator('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="2"]');
  ok('empty target shows the discreet placeholder, not a real value',
    (await intervalTarget.getAttribute('class')).indexOf('sign-chart-target-empty') !== -1);
  await intervalTarget.click({ force: true });
  await page.waitForTimeout(60);
  let popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('interval cell popup offers +/-', JSON.stringify(popupTexts) === JSON.stringify(['+', '−']));
  await page.click('.sign-chart-popup-btn:first-child'); // '+'
  await page.waitForTimeout(60);
  ok('interval target now renders "+" via KaTeX (like the equations)', (await targetLatex(page, 1, 2)) === '+');
  ok('no longer shows the empty placeholder',
    (await intervalTarget.getAttribute('class')).indexOf('sign-chart-target-empty') === -1);

  const boundaryTarget = page.locator('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="1"]');
  await boundaryTarget.click({ force: true });
  await page.waitForTimeout(60);
  popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('boundary cell popup offers 0/‖', JSON.stringify(popupTexts) === JSON.stringify(['0', '‖']));
  await page.click('.sign-chart-popup-btn:first-child'); // '0'
  await page.waitForTimeout(60);

  // Click-outside closes without picking.
  await page.locator('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="0"]').click({ force: true });
  await page.waitForTimeout(60);
  ok('popup open', (await page.$('.sign-chart-popup')) !== null);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(60);
  ok('popup closed on outside click, no value set',
    (await page.$('.sign-chart-popup')) === null &&
    (await page.evaluate(() => window.App.History.getSignChart().tableRows[1].cells[0])) === null);

  // --- Clicking OUTSIDE the target but still inside the (wide) cell does nothing (only
  // the small centered target is interactive, retour utilisateur) ---
  await page.evaluate(() => {
    var cell = document.querySelector('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="2"]').closest('.sign-chart-data-cell');
    var rect = cell.getBoundingClientRect();
    var ev = new MouseEvent('click', { bubbles: true, clientX: rect.left + 3, clientY: rect.top + rect.height / 2 });
    cell.dispatchEvent(ev);
  });
  await page.waitForTimeout(60);
  ok('clicking the cell edge (outside the target) does not open a popup',
    (await page.$('.sign-chart-popup')) === null);

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
  ok('no wrong-target styling on the total row',
    (await page.$$('.sign-chart-target[data-sign-chart-row="' + totalRowIndex + '"].sign-chart-target-wrong')).length === 0);

  // Now set ONE wrong value and check it is flagged, styled, and stays visible (not reverted).
  await page.evaluate((row) => window.App.History.signChartSetCell(row, 0, '+'), totalRowIndex);
  await page.waitForTimeout(80);
  ok('a wrong cell is flagged incorrect',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 0), totalRowIndex)) === false);
  const wrongTarget = page.locator('.sign-chart-target[data-sign-chart-row="' + totalRowIndex + '"][data-sign-chart-col="0"]');
  ok('the wrong target carries the styling class', (await wrongTarget.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1);
  ok('the wrong target still shows what was typed (not reverted)', (await targetLatex(page, totalRowIndex, 0)) === '+');

  // --- The double-rule marks exactly the excluded-domain boundary column (x=1) ---
  const excludedCols = await page.$$eval('.sign-chart-header-cell.sign-chart-col-excluded', function (els) { return els.length; });
  ok('exactly one excluded-domain header column (x=1)', excludedCols === 1);

  // --- No outer border on the table itself (per-cell borders only) ---
  const tableBorderWidth = await page.evaluate(() => getComputedStyle(document.querySelector('.sign-chart-table')).borderWidth);
  ok('the table has no outer border of its own', tableBorderWidth === '0px');

  // --- Only the label/content divider exists -- no border along the table's own outer
  // edges (top, right, bottom), which would otherwise still show through even without an
  // explicit .sign-chart-table border (retour utilisateur : "je vois encore des bouts de
  // la bordure extérieure") ---
  const edgeBorders = await page.evaluate((row) => {
    var lastHeaderCell = document.querySelectorAll('.sign-chart-header-cell');
    var topRight = lastHeaderCell[lastHeaderCell.length - 1];
    var lastRowLastCell = document.querySelector('.sign-chart-data-cell[data-sign-chart-row="' + row + '"]:last-of-type');
    function borders(el) {
      var s = getComputedStyle(el);
      return { top: s.borderTopWidth, right: s.borderRightWidth, bottom: s.borderBottomWidth };
    }
    return { topRight: borders(topRight), bottomRight: lastRowLastCell ? borders(lastRowLastCell) : null };
  }, totalRowIndex);
  console.log('edge borders:', JSON.stringify(edgeBorders));
  ok('no top/right border on the top-right header cell',
    edgeBorders.topRight.top === '0px' && edgeBorders.topRight.right === '0px');
  ok('no right/bottom border on the bottom-right data cell',
    edgeBorders.bottomRight && edgeBorders.bottomRight.right === '0px' && edgeBorders.bottomRight.bottom === '0px');

  // --- The single divider sits between the label column and the content columns ---
  const labelBorderRight = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.sign-chart-x-label')).borderRightWidth);
  ok('the label column has its own right-side divider', parseFloat(labelBorderRight) > 0);

  // --- Horizontal lines: every row EXCEPT the last one has a bottom border ---
  const rowBorders = await page.evaluate(function () {
    var labels = Array.from(document.querySelectorAll('.sign-chart-x-label, .sign-chart-row-label'));
    return labels.map(function (el) { return getComputedStyle(el).borderBottomWidth; });
  });
  console.log('row bottom borders (header + each data row):', JSON.stringify(rowBorders));
  ok('every row but the last has a horizontal line under it',
    rowBorders.slice(0, -1).every(function (w) { return parseFloat(w) > 0; }) &&
    parseFloat(rowBorders[rowBorders.length - 1]) === 0);

  // --- The "x" header row no longer reads as grayed-out (same text color as the rest) ---
  const headerColor = await page.evaluate(() => getComputedStyle(document.querySelector('.sign-chart-x-label')).color);
  const bodyColor = await page.evaluate(() => getComputedStyle(document.querySelector('.sign-chart-row-label')).color);
  ok('the header ("x") row uses the same text color as the rest of the table', headerColor === bodyColor);

  // --- "x" itself is rendered via KaTeX, not plain italic text ---
  ok('the "x" header cell is real KaTeX markup', await page.evaluate(() => !!document.querySelector('.sign-chart-x-label .katex')));

  // --- Signs sit at the EXACT pixel midpoint between their two neighboring x-value
  // labels (fixed-width boundary columns, never auto-sized to content) ---
  const midpointCheck = await page.evaluate(function () {
    function centerX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
    // .sign-chart-header-cell ALSO matches the "x" label cell (index 0) -- skip it.
    // Remaining order for 3 roots: [0]=edge(-\infty), [1]=boundary(-1),
    // [2]=middle interval(-1,1), [3]=boundary(1), ...
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    var leftBoundary = centerX(headers[1]);
    var rightBoundary = centerX(headers[3]);
    var middleInterval = centerX(headers[2]);
    return { expectedMid: (leftBoundary + rightBoundary) / 2, actual: middleInterval };
  });
  console.log('midpoint check:', JSON.stringify(midpointCheck));
  ok('a sign column sits at the EXACT midpoint between its two neighboring x-values',
    Math.abs(midpointCheck.expectedMid - midpointCheck.actual) < 0.5);

  // --- Every REAL header label (-\infty, each boundary value, +\infty) is equally
  // spaced along the row -- retour utilisateur, using the exact reported example
  // (x-8)(x+5): the gap between -5 and 8 must equal the gap between -\infty and -5 (it
  // was previously about double, since a whole extra "middle interval" column sat
  // between two real boundaries with nothing analogous on the -\infty/+\infty side). ---
  const spacingCheck = await page.evaluate(function () {
    function centerX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    // [0]=edge(-inf), [1]=boundary, [2]=interval, [3]=boundary, [4]=interval, [5]=boundary, [6]=edge(+inf)
    var realLabelCenters = [headers[0], headers[1], headers[3], headers[5], headers[6]].map(centerX);
    var gaps = [];
    for (var i = 1; i < realLabelCenters.length; i++) gaps.push(Math.round(realLabelCenters[i] - realLabelCenters[i - 1]));
    return gaps;
  });
  console.log('gaps between -\\infty, each real x-value, and +\\infty:', JSON.stringify(spacingCheck));
  ok('all 4 gaps between -infinity/x-values/+infinity are equal',
    spacingCheck.every(function (g) { return g === spacingCheck[0]; }));

  // --- The EDGE interval signs (next to -\infty/+\infty) sit at the exact midpoint
  // between that infinity label and the nearest real x-value -- NOT directly under the
  // infinity symbol itself (retour utilisateur), even though -\infty/+\infty are
  // centered in their own (wide) column for the equal-spacing property just above. ---
  const edgeSignCheck = await page.evaluate(function (row) {
    function centerX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    var lastCol = headers.length - 1;
    var leftSign = document.querySelector('.sign-chart-target[data-sign-chart-row="' + row + '"][data-sign-chart-col="0"]');
    var rightSign = document.querySelector('.sign-chart-target[data-sign-chart-row="' + row + '"][data-sign-chart-col="' + lastCol + '"]');
    return {
      leftSignCenter: centerX(leftSign),
      leftExpectedMid: (centerX(headers[0]) + centerX(headers[1])) / 2,
      leftInfinityCenter: centerX(headers[0]),
      rightSignCenter: centerX(rightSign),
      rightExpectedMid: (centerX(headers[lastCol - 1]) + centerX(headers[lastCol])) / 2
    };
  }, totalRowIndex);
  console.log('edge sign check:', JSON.stringify(edgeSignCheck));
  ok('left edge sign is NOT under -infinity',
    Math.abs(edgeSignCheck.leftSignCenter - edgeSignCheck.leftInfinityCenter) > 20);
  ok('left edge sign sits at the exact midpoint between -infinity and the nearest x-value',
    Math.abs(edgeSignCheck.leftSignCenter - edgeSignCheck.leftExpectedMid) < 0.5);
  ok('right edge sign sits at the exact midpoint between +infinity and the nearest x-value',
    Math.abs(edgeSignCheck.rightSignCenter - edgeSignCheck.rightExpectedMid) < 0.5);

  // --- Boundary (x-value) columns are visibly narrower than interval columns: a sign
  // can never look like it belongs directly under -\infty/+\infty (which live in the
  // outermost INTERVAL columns, not their own boundary column). ---
  const colWidths = await page.evaluate(() => {
    var cells = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1); // skip the "x" label cell
    return cells.map(function (c) { return c.getBoundingClientRect().width; });
  });
  console.log('column widths (interval,boundary,interval,...):', colWidths.map((w) => Math.round(w)));
  // Columns alternate interval,boundary,interval,...,interval (7 for 3 roots).
  const intervalWidths = colWidths.filter(function (_, i) { return i % 2 === 0; });
  const boundaryWidths = colWidths.filter(function (_, i) { return i % 2 === 1; });
  ok('every boundary column is narrower than every interval column',
    Math.max.apply(null, boundaryWidths) < Math.min.apply(null, intervalWidths));

  // --- The header ("x") row's data columns and the total row's data columns share the
  // exact same left edges (same grid columns, nothing offset between them) ---
  const headerDataLefts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1)
      .map((e) => Math.round(e.getBoundingClientRect().left)));
  const totalRowDataLefts = await page.evaluate((row) =>
    Array.from(document.querySelectorAll('.sign-chart-data-cell[data-sign-chart-row="' + row + '"]'))
      .sort((a, b) => Number(a.getAttribute('data-sign-chart-col')) - Number(b.getAttribute('data-sign-chart-col')))
      .map((e) => Math.round(e.getBoundingClientRect().left)), totalRowIndex);
  console.log('header data-column lefts:', headerDataLefts, 'total-row data-column lefts:', totalRowDataLefts);
  ok('the total row\'s columns line up exactly with the header row\'s columns',
    JSON.stringify(totalRowDataLefts) === JSON.stringify(headerDataLefts));

  await page.screenshot({ path: `${SCRATCH}/sign_chart_full.png`, fullPage: true });

  // --- Isolated scenario: the whole factors row stays visually centered even once one
  // column grows much wider than the others, instead of drifting/pushing to one side.
  // Uses a fresh simple equation rather than reusing the state above, to avoid any
  // undo/cleanup fragility. ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    window.App.History.signChartAction();
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.setFocusedSignChartFactor(0);
    Hist.selectOp('expr'); Hist.setExprChainText('+111111-222222+333333-444444'); Hist.confirm();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  const rowRect = await page.evaluate(() => document.querySelector('.sign-chart-factors-row').getBoundingClientRect());
  const viewportWidth = page.viewportSize().width;
  const rowCenter = rowRect.x + rowRect.width / 2;
  console.log('factors row center:', rowCenter, 'viewport center:', viewportWidth / 2);
  ok('the factors row stays centered on the viewport even after one column grows wide',
    Math.abs(rowCenter - viewportWidth / 2) < 2);

  // --- Isolated scenario: a sign-chart target/button responds to a SINGLE real click
  // even while some OTHER pending state is active elsewhere (retour utilisateur: "make
  // buttons inside the table clickable... even if the table isn't currently selected or
  // focused"). Root cause was two capture-phase document click listeners (toolbar.js's
  // cancelOp-on-outside-click, render.js's branch-outline dismissal) that could re-render
  // -- destroying the just-clicked DOM node -- before its own bubble-phase listener ever
  // ran. Reproduced two ways: a lingering term selection on the main chain, and
  // branchOutlineVisible left true by a real click inside a factor column. ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    window.App.History.signChartAction();
    var Hist = window.App.History;
    Hist.setFocusedSignChartFactor(0);
    Hist.selectOp('expr'); Hist.setExprChainText('-1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.setFocusedSignChartFactor(1);
    Hist.selectOp('expr'); Hist.setExprChainText('+2'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.focusMain();
    Hist.signChartAddRow({ rowKind: 'total' });
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);

  // Scenario A: a term selected on the MAIN chain (real API call, leaves pending non-empty).
  await page.evaluate(() => window.App.History.toggleTermSelection('left', 0));
  await page.waitForTimeout(80);
  await page.locator('.sign-chart-target[data-sign-chart-row="0"][data-sign-chart-col="1"]').click();
  await page.waitForTimeout(100);
  ok('scenario A: popup opens on a single click with a term selected elsewhere',
    await page.evaluate(() => !!document.querySelector('.sign-chart-popup')));
  await page.mouse.click(10, 10); // close the popup, deselect
  await page.waitForTimeout(80);
  await page.evaluate(() => window.App.History.cancelOp());

  // Scenario B: a REAL click inside a factor column (sets branchOutlineVisible=true via
  // the actual DOM listener, not an API call) right before clicking the table.
  await page.click('.domain-branch[data-signchart-factor-index="0"] .side[data-side="left"] .term[data-index="0"]', { force: true });
  await page.waitForTimeout(80);
  await page.locator('.sign-chart-target[data-sign-chart-row="0"][data-sign-chart-col="2"]').click({ force: true });
  await page.waitForTimeout(100);
  ok('scenario B: popup opens on a single click right after a real click inside a factor column',
    await page.evaluate(() => !!document.querySelector('.sign-chart-popup')));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
