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

  // --- Retour utilisateur : the left column ("x") pre-fills automatically with one BARE
  // row per distinct factor as soon as the table becomes available, instead of forcing the
  // student to click "+ Ajouter une rangée" for each one ("since the user has to add them
  // manually anyway"). Checked here while factor 2 is STILL focused (regression: this must
  // fire regardless of focus state -- signChartAutoFillRows is deliberately never
  // delegated via activeChild(), same reasoning as signChartAddRow just below it). ---
  const autoFilledRowKinds = await page.evaluate(() => window.App.History.getSignChart().tableRows.map(function (r) {
    return r.rowKind + (r.factorIndex !== undefined ? ':' + r.factorIndex : '');
  }));
  ok('the 3 factor rows are pre-filled automatically, bare, no "total" row yet',
    JSON.stringify(autoFilledRowKinds) === JSON.stringify(['factor:0', 'factor:1', 'factor:2']));
  const autoFilledLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sign-chart-row-label')).map(function (c) {
      var a = c.querySelector('annotation');
      return a ? a.textContent : null;
    }));
  console.log('auto-filled row labels:', JSON.stringify(autoFilledLabels));
  ok('pre-filled rows show the BARE factor, no power attached (retour utilisateur: "without their powers")',
    autoFilledLabels.every(function (l) { return l.indexOf('^') === -1; }));

  // --- "+ Ajouter une rangée" only shows on hover ---
  const wrap = page.locator('.sign-chart-table-wrap');
  ok('add-row button hidden before hovering the table', !(await page.locator('.sign-chart-add-row-btn').isVisible()));
  await wrap.hover();
  await page.waitForTimeout(200);
  ok('add-row button visible once hovering the table', await page.locator('.sign-chart-add-row-btn').isVisible());

  // --- "Vérifier" button only becomes available once the "total" row exists (retour
  // utilisateur) -- checked here, before it has been added at all ---
  const verifyBtnDisabledBeforeTotal = await page.evaluate(() => {
    var b = document.querySelector('.sign-chart-verify-btn');
    return b ? b.disabled : undefined;
  });
  ok('verify button exists and is disabled before the "total" row exists', verifyBtnDisabledBeforeTotal === true);
  ok('signChartVerify() is a no-op before the "total" row exists',
    !(await page.evaluate(() => window.App.History.signChartVerify())) &&
    !(await page.evaluate(() => window.App.History.getSignChart().verified)));

  // --- Only ONE option left to add: "Expression totale" -- all 3 factors are already
  // pre-filled bare above, and none of them has a power in this equation. ---
  await page.click('.sign-chart-add-row-btn', { force: true });
  await page.waitForTimeout(80);
  const optCount = (await page.$$('.sign-chart-popup-btn')).length;
  ok('only 1 option left: "Expression totale" (every factor already pre-filled, none has a power)', optCount === 1);
  ok('that option is real KaTeX, not the generic "Expression totale" text',
    await page.evaluate(() => {
      var last = document.querySelector('.sign-chart-popup-btn');
      return !!last.querySelector('.katex') && last.textContent.indexOf('Expression totale') === -1;
    }));

  // --- Retour utilisateur : the popup must FOLLOW the "+ Ajouter une rangée" button when
  // the page is dragged/panned, not stay frozen at its screen position from when it
  // opened (it lives in document.body, position:fixed, outside #canvasLayer -- see
  // followSignChartPopup in render.js). Pan by an arbitrary amount while it's open and
  // confirm it moved by EXACTLY the same on-screen delta as the button itself. ---
  const beforePan = await page.evaluate(() => ({
    popup: document.querySelector('.sign-chart-popup').getBoundingClientRect(),
    btn: document.querySelector('.sign-chart-add-row-btn').getBoundingClientRect()
  }));
  const panBefore = await page.evaluate(() => ({ x: window.App.Canvas.getX(), y: window.App.Canvas.getY() }));
  await page.evaluate(() => window.App.Canvas.set(window.App.Canvas.getX() - 220, window.App.Canvas.getY() - 90));
  await page.waitForTimeout(120); // a few rAF ticks for followSignChartPopup to catch up
  const afterPan = await page.evaluate(() => ({
    popup: document.querySelector('.sign-chart-popup') ? document.querySelector('.sign-chart-popup').getBoundingClientRect() : null,
    btn: document.querySelector('.sign-chart-add-row-btn').getBoundingClientRect()
  }));
  console.log('popup follow-pan check:', JSON.stringify({ beforePan, afterPan }));
  ok('popup is still open after panning (did not get dismissed)', afterPan.popup !== null);
  const btnDeltaX = afterPan.btn.left - beforePan.btn.left, btnDeltaY = afterPan.btn.top - beforePan.btn.top;
  const popupDeltaX = afterPan.popup.left - beforePan.popup.left, popupDeltaY = afterPan.popup.top - beforePan.popup.top;
  ok('the button itself actually moved (pan had an effect, sanity check)', Math.abs(btnDeltaX) > 50 || Math.abs(btnDeltaY) > 50);
  ok('the popup moved by the SAME horizontal delta as the button (it followed the pan)', Math.abs(popupDeltaX - btnDeltaX) < 1);
  ok('the popup moved by the SAME vertical delta as the button (it followed the pan)', Math.abs(popupDeltaY - btnDeltaY) < 1);
  // Restore the canvas position so the rest of this scenario proceeds unaffected.
  await page.evaluate((p) => window.App.Canvas.set(p.x, p.y), panBefore);
  await page.waitForTimeout(80);

  // --- THE reported bug (originally about a FACTOR option; the only manual add left now
  // that factors pre-fill automatically is "total", same underlying regression): clicking
  // it while a factor is still focused must actually add the row (previously silently
  // delegated into the focused factor's own, nonexistent, signChart and did nothing). ---
  await page.click('.sign-chart-popup-btn:first-child', { force: true });
  await page.waitForTimeout(100);
  ok('clicking "Expression totale" while a factor is still focused actually adds it',
    (await page.evaluate(() => window.App.History.getSignChart().tableRows.length)) === 4);

  // --- No "." placeholder in a still-empty row (retour utilisateur) ---
  const emptyTargetText = await page.evaluate(() => {
    var t = document.querySelector('.sign-chart-target-empty');
    return t ? t.textContent : undefined;
  });
  ok('an empty target has no "." placeholder text', emptyTargetText === '');

  await wrap.hover();
  await page.waitForTimeout(60);
  ok('"+ Ajouter une rangée" now gone (nothing left to add)', (await page.$('.sign-chart-add-row-btn')) === null);
  const verifyBtnEnabledAfterTotal = await page.evaluate(() => {
    var b = document.querySelector('.sign-chart-verify-btn');
    return b ? !b.disabled : undefined;
  });
  ok('verify button enabled once the "total" row exists', verifyBtnEnabledAfterTotal === true);
  ok('signChart.verified is still false (Vérifier not clicked yet)',
    !(await page.evaluate(() => window.App.History.getSignChart().verified)));

  const rowKinds = await page.evaluate(() => window.App.History.getSignChart().tableRows.map(function (r) {
    return r.rowKind + (r.factorIndex !== undefined ? ':' + r.factorIndex : '');
  }));
  ok('rows are factor:0 (den), factor:1 (num), factor:2 (num), total, in extraction order',
    JSON.stringify(rowKinds) === JSON.stringify(['factor:0', 'factor:1', 'factor:2', 'total']));
  const totalRowIndex = rowKinds.indexOf('total');

  // --- The "total" row's label shows the ACTUAL expression (-(x+1)(x-2)/(1-x), see the
  // eligibility setup above), not the generic "Expression totale" text (retour
  // utilisateur) ---
  const totalRowLabelLatex = await page.evaluate((idx) => {
    var cell = document.querySelectorAll('.sign-chart-row-label')[idx];
    var a = cell.querySelector('annotation');
    return a ? a.textContent : null;
  }, totalRowIndex);
  console.log('total row label LaTeX:', totalRowLabelLatex);
  ok('total row label is not the generic placeholder text', totalRowLabelLatex !== 'Expression totale');
  ok('total row label is real KaTeX (not plain text)',
    await page.evaluate((idx) => !!document.querySelectorAll('.sign-chart-row-label')[idx].querySelector('.katex'), totalRowIndex));
  ok('total row label renders as a fraction (has a denominator factor)', /\\frac/.test(totalRowLabelLatex));
  ok('total row label includes every factor (num "x+1", num "x-2", den "1-x")',
    /x\s*\+\s*1/.test(totalRowLabelLatex) && /x\s*-\s*2/.test(totalRowLabelLatex) && /-x\s*\+\s*1|1\s*-\s*x/.test(totalRowLabelLatex));
  ok('total row label carries the leading minus sign from the original expression',
    /^\\frac\{-/.test(totalRowLabelLatex));

  // --- Cell popups: interval offers +/-, boundary offers 0/‖ -- clicking the small
  // centered .sign-chart-target (never the whole .sign-chart-data-cell, retour
  // utilisateur) opens them. ---
  const intervalTarget = page.locator('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="2"]');
  ok('empty target shows the discreet placeholder, not a real value',
    (await intervalTarget.getAttribute('class')).indexOf('sign-chart-target-empty') !== -1);
  await intervalTarget.click({ force: true });
  await page.waitForTimeout(60);
  let popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('interval cell popup offers +/-/✕ (clear)', JSON.stringify(popupTexts) === JSON.stringify(['+', '−', '✕']));
  await page.click('.sign-chart-popup-btn:first-child'); // '+'
  await page.waitForTimeout(60);
  ok('interval target now renders "+" via KaTeX (like the equations)', (await targetLatex(page, 1, 2)) === '+');
  ok('no longer shows the empty placeholder',
    (await intervalTarget.getAttribute('class')).indexOf('sign-chart-target-empty') === -1);

  // --- Clear (✕) button: lets the user cancel a selection and leave the spot empty again
  // (retour utilisateur) ---
  await intervalTarget.click({ force: true });
  await page.waitForTimeout(60);
  await page.click('.sign-chart-popup-btn:last-child'); // '✕'
  await page.waitForTimeout(60);
  ok('clicking ✕ clears the cell back to null',
    (await page.evaluate(() => window.App.History.getSignChart().tableRows[1].cells[2])) === null);
  ok('target shows the empty placeholder again after clearing',
    (await intervalTarget.getAttribute('class')).indexOf('sign-chart-target-empty') !== -1);
  // Refill it: later checks assume this cell is set.
  await intervalTarget.click({ force: true });
  await page.waitForTimeout(60);
  await page.click('.sign-chart-popup-btn:first-child'); // '+'
  await page.waitForTimeout(60);

  const boundaryTarget = page.locator('.sign-chart-target[data-sign-chart-row="1"][data-sign-chart-col="1"]');
  await boundaryTarget.click({ force: true });
  await page.waitForTimeout(60);
  popupTexts = await page.$$eval('.sign-chart-popup-btn', function (els) { return els.map(function (e) { return e.textContent; }); });
  ok('boundary cell popup offers 0/‖/✕ (clear)', JSON.stringify(popupTexts) === JSON.stringify(['0', '‖', '✕']));
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

  // --- Strict boundary validation: a 0/‖ in a FACTOR row at an x-value that is NOT that
  // factor's own root must be flagged wrong (retour utilisateur) -- row "factor:1" has
  // root x=-1 (column 1); columns 3 (x=1) and 5 (x=2) are boundaries belonging to the
  // OTHER two factors. ---
  const factor1Row = rowKinds.indexOf('factor:1');
  await page.evaluate((row) => window.App.History.signChartSetCell(row, 3, '0'), factor1Row);
  await page.waitForTimeout(60);
  ok('a "0" at a boundary that is not this factor\'s own root is flagged incorrect',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 3), factor1Row)) === false);
  await page.evaluate((row) => window.App.History.signChartSetCell(row, 5, 'undef'), factor1Row);
  await page.waitForTimeout(60);
  ok('a "‖" in a factor row (never legitimately undefined) is flagged incorrect',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 5), factor1Row)) === false);
  await page.evaluate((row) => {
    window.App.History.signChartSetCell(row, 3, null);
    window.App.History.signChartSetCell(row, 5, null);
  }, factor1Row);
  await page.waitForTimeout(60);

  // Now set TWO wrong values (col 0 and col 6, both part of the reference row filled in
  // above): each must be flagged STRUCTURALLY and keep showing what was typed right away,
  // but must NOT get the red "wrong" styling until "Vérifier" is clicked (retour
  // utilisateur: "don't immediately indicate if a selection is wrong"). Two, not one, so
  // the NEXT block can prove that fixing one leaves the other still flagged.
  await page.evaluate((row) => {
    window.App.History.signChartSetCell(row, 0, '+'); // was '-'
    window.App.History.signChartSetCell(row, 6, '-'); // was '+'
  }, totalRowIndex);
  await page.waitForTimeout(80);
  ok('cell 0 is flagged incorrect (structurally, independent of display)',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 0), totalRowIndex)) === false);
  ok('cell 6 is flagged incorrect (structurally, independent of display)',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 6), totalRowIndex)) === false);
  const wrongTarget = page.locator('.sign-chart-target[data-sign-chart-row="' + totalRowIndex + '"][data-sign-chart-col="0"]');
  const wrongTarget2 = page.locator('.sign-chart-target[data-sign-chart-row="' + totalRowIndex + '"][data-sign-chart-col="6"]');
  ok('the wrong targets still show what was typed', (await targetLatex(page, totalRowIndex, 0)) === '+' && (await targetLatex(page, totalRowIndex, 6)) === '-');
  ok('NOT styled red yet: "Vérifier" has not been clicked',
    (await wrongTarget.getAttribute('class')).indexOf('sign-chart-target-wrong') === -1 &&
    (await wrongTarget2.getAttribute('class')).indexOf('sign-chart-target-wrong') === -1);
  ok('signChart.verified is still false', !(await page.evaluate(() => window.App.History.getSignChart().verified)));

  // --- Clicking "Vérifier" reveals wrong-cell styling for everything already filled in,
  // without reverting any value ---
  await wrap.hover();
  await page.waitForTimeout(60);
  await page.click('.sign-chart-verify-btn', { force: true });
  await page.waitForTimeout(80);
  ok('signChart.verified becomes true after clicking "Vérifier"',
    await page.evaluate(() => window.App.History.getSignChart().verified));
  ok('BOTH wrong targets now carry the red styling class',
    (await wrongTarget.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1 &&
    (await wrongTarget2.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1);
  ok('the wrong targets still show what was typed (not reverted)',
    (await targetLatex(page, totalRowIndex, 0)) === '+' && (await targetLatex(page, totalRowIndex, 6)) === '-');
  ok('a correct cell is still not styled wrong after verifying',
    (await page.locator('.sign-chart-target[data-sign-chart-row="' + totalRowIndex + '"][data-sign-chart-col="1"]').getAttribute('class')).indexOf('sign-chart-target-wrong') === -1);

  // --- Retour utilisateur, this round: "when the user clicks on a cell after verifying,
  // do not remove the red outlines from the OTHER cells -- only the specific cell that was
  // just modified." Edit ONLY cell 0 (re-pick the SAME, still-wrong, value -- nothing about
  // the value itself changes, only the fact that it was touched): its own red styling must
  // clear immediately, but cell 6 -- untouched, still wrong -- must stay flagged. Also,
  // unlike an earlier round's table-wide gate, signChart.verified itself no longer resets
  // on edit (only the touched cell's own "dirty" flag does, see history.js). ---
  await wrongTarget.click({ force: true });
  await page.waitForTimeout(60);
  await page.click('.sign-chart-popup-btn:first-child'); // '+' again (still wrong)
  await page.waitForTimeout(80);
  ok('signChart.verified stays TRUE (no table-wide reset on a single edit)',
    await page.evaluate(() => window.App.History.getSignChart().verified));
  ok('the EDITED cell (0) loses its red styling immediately (no instant re-judgement of it)',
    (await wrongTarget.getAttribute('class')).indexOf('sign-chart-target-wrong') === -1);
  ok('the OTHER wrong cell (6), untouched, KEEPS its red styling',
    (await wrongTarget2.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1);
  ok('the edited value itself is preserved (still shows "+")', (await targetLatex(page, totalRowIndex, 0)) === '+');
  // Re-clicking "Vérifier" re-flags the edited cell too, proving the gate isn't just
  // permanently disabled for it -- a fresh judgement pass re-covers everyone.
  await wrap.hover();
  await page.waitForTimeout(60);
  await page.click('.sign-chart-verify-btn', { force: true });
  await page.waitForTimeout(80);
  ok('clicking "Vérifier" again re-flags the edited-but-still-wrong cell',
    (await wrongTarget.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1);
  ok('the never-touched wrong cell is still flagged too', (await wrongTarget2.getAttribute('class')).indexOf('sign-chart-target-wrong') !== -1);
  // Leave both correct again for the structural checks further down.
  await page.evaluate((row) => {
    window.App.History.signChartSetCell(row, 0, '-');
    window.App.History.signChartSetCell(row, 6, '+');
  }, totalRowIndex);
  await page.waitForTimeout(60);

  // --- Retour utilisateur: no automatic double-bar marker on the excluded-domain boundary
  // column (x=1) -- it's the student's own job to figure out and enter "‖" there via the
  // cell popup, never a giveaway the app draws for them. Structural validation (a den root
  // must still grade as "undef"/'‖' correct, "0" wrong there) stays entirely unaffected --
  // already covered by the reference-tableau row check above. ---
  const excludedCols = await page.$$eval('.sign-chart-col-excluded', function (els) { return els.length; });
  ok('no automatic "excluded column" marker anywhere in the table', excludedCols === 0);
  const denBoundaryBorder = await page.evaluate(function (row) {
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    // x=1 is a den root in this equation -- find its header cell by its rendered value.
    var target = headers.find(function (h) {
      var a = h.querySelector('annotation');
      return a && a.textContent === '1';
    });
    return target ? getComputedStyle(target).borderRightStyle : null;
  });
  ok('that boundary column has an ordinary (non-double) right border, same as any other',
    denBoundaryBorder !== 'double');

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

  // --- Factor row labels are CENTERED in the label column, like "x" in the header row
  // (retour utilisateur), not left-aligned ---
  const xLabelJustify = await page.evaluate(() => getComputedStyle(document.querySelector('.sign-chart-x-label')).justifyContent);
  const rowLabelJustify = await page.evaluate(() => getComputedStyle(document.querySelector('.sign-chart-row-label')).justifyContent);
  ok('factor row labels use the same centered justification as the "x" header label',
    rowLabelJustify === xLabelJustify && rowLabelJustify === 'center');

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
  // (x-8)(x+5): the gap between -5 and 8 must equal the gap between -\infty and -5.
  // Measured at the VISIBLE GLYPH position, not the outer header-cell box: -\infty/+\infty
  // now sit near the edge of their (still wide, for spacing purposes) column instead of
  // centered in it (retour utilisateur: reduce the empty space between -\infty/+\infty and
  // the table's edge/divider -- see the gutter check further below), so only the glyph
  // center is the actual "label position" for the two edge columns from here on; a
  // boundary cell has no such override and stays centered in its cell as before. ---
  const spacingCheck = await page.evaluate(function () {
    function centerX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
    function glyphCenter(cell) { var k = cell.querySelector('.katex'); return centerX(k || cell); }
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    // [0]=edge(-inf), [1]=boundary, [2]=interval, [3]=boundary, [4]=interval, [5]=boundary, [6]=edge(+inf)
    var realLabelCenters = [headers[0], headers[1], headers[3], headers[5], headers[6]].map(glyphCenter);
    var gaps = [];
    for (var i = 1; i < realLabelCenters.length; i++) gaps.push(Math.round(realLabelCenters[i] - realLabelCenters[i - 1]));
    return gaps;
  });
  console.log('gaps between -\\infty, each real x-value, and +\\infty (glyph positions):', JSON.stringify(spacingCheck));
  // Tolerance of a couple pixels: the row-label column is auto-sized to its (KaTeX) content,
  // which can leave the grid's overall width a non-integer number of pixels, spreading a
  // sub-pixel rounding remainder unevenly across tracks -- confirmed exact (226,226,226,226)
  // by hand with a simpler 2-factor example; not a real alignment bug.
  ok('all 4 gaps between -infinity/x-values/+infinity are equal (within rounding)',
    spacingCheck.every(function (g) { return Math.abs(g - spacingCheck[0]) <= 2; }));

  // --- The EDGE interval signs (next to -\infty/+\infty) sit at the exact midpoint
  // between that infinity label's GLYPH and the nearest real x-value -- NOT directly
  // under the infinity symbol itself (retour utilisateur, earlier round). ---
  const edgeSignCheck = await page.evaluate(function (row) {
    function centerX(el) { var r = el.getBoundingClientRect(); return r.left + r.width / 2; }
    function glyphCenter(cell) { var k = cell.querySelector('.katex'); return centerX(k || cell); }
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    var lastCol = headers.length - 1;
    var leftSign = document.querySelector('.sign-chart-target[data-sign-chart-row="' + row + '"][data-sign-chart-col="0"]');
    var rightSign = document.querySelector('.sign-chart-target[data-sign-chart-row="' + row + '"][data-sign-chart-col="' + lastCol + '"]');
    return {
      leftSignCenter: centerX(leftSign),
      leftExpectedMid: (glyphCenter(headers[0]) + centerX(headers[1])) / 2,
      leftInfinityCenter: glyphCenter(headers[0]),
      rightSignCenter: centerX(rightSign),
      rightExpectedMid: (centerX(headers[lastCol - 1]) + glyphCenter(headers[lastCol])) / 2
    };
  }, totalRowIndex);
  console.log('edge sign check:', JSON.stringify(edgeSignCheck));
  ok('left edge sign is NOT under -infinity',
    Math.abs(edgeSignCheck.leftSignCenter - edgeSignCheck.leftInfinityCenter) > 20);
  ok('left edge sign sits at the exact midpoint between -infinity and the nearest x-value',
    Math.abs(edgeSignCheck.leftSignCenter - edgeSignCheck.leftExpectedMid) < 0.5);
  ok('right edge sign sits at the exact midpoint between +infinity and the nearest x-value',
    Math.abs(edgeSignCheck.rightSignCenter - edgeSignCheck.rightExpectedMid) < 0.5);

  // --- The gutter between the label/content divider and -\infty (mirrored: between
  // +\infty and the table's own right edge) is small but no longer near-zero (retour
  // utilisateur, this round: "a very small amount of space... but not as much as there
  // was originally" -- a prior round had shrunk it to ~2px, reading as glued to the edge;
  // still nowhere near the large gap from before ANY reduction). ---
  const gutterCheck = await page.evaluate(function () {
    var headers = Array.from(document.querySelectorAll('.sign-chart-header-cell')).slice(1);
    var lastCol = headers.length - 1;
    var leftCell = headers[0], rightCell = headers[lastCol];
    var leftGlyph = leftCell.querySelector('.katex').getBoundingClientRect();
    var rightGlyph = rightCell.querySelector('.katex').getBoundingClientRect();
    return {
      leftGutter: leftGlyph.left - leftCell.getBoundingClientRect().left,
      rightGutter: rightCell.getBoundingClientRect().right - rightGlyph.right
    };
  });
  console.log('edge label gutters (divider-to-glyph, glyph-to-table-end):', JSON.stringify(gutterCheck));
  ok('the gutter between the divider and -infinity is small but visible (not glued to the edge)',
    gutterCheck.leftGutter >= 8 && gutterCheck.leftGutter < 25);
  ok('the gutter between +infinity and the table edge is small but visible (not glued to the edge)',
    gutterCheck.rightGutter >= 8 && gutterCheck.rightGutter < 25);

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

  // --- Isolated scenario: a factor with a POWER in the original equation, e.g.
  // "(x+2)²(x-1)≥0" (retour utilisateur: "if the equation includes a factor with a power
  // like (ax+b)^n, allow the user to add this full factor, including the power, into the
  // table"). The bare root row still auto-pre-fills (retour utilisateur: "without their
  // powers") -- the POWERED variant is an extra, opt-in row, addable via "+ Ajouter une
  // rangée", validated with the correct parity (an even power is never negative). ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 2 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -1, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    Hist.signChartAction();
    Hist.setFocusedSignChartFactor(0);
    Hist.selectOp('expr'); Hist.setExprChainText('-2'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.setFocusedSignChartFactor(1);
    Hist.selectOp('expr'); Hist.setExprChainText('+1'); Hist.confirm();
    Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
    Hist.confirmSimplifySelection();
    Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
    Hist.confirmSimplifySelection();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);

  const poweredScFactors = await page.evaluate(() => window.App.History.getSignChart().factors.map(function (f) { return f.exponent; }));
  ok('extraction preserves each factor\'s real exponent (2, then 1)', JSON.stringify(poweredScFactors) === JSON.stringify([2, 1]));

  const poweredAutoRows = await page.evaluate(() => window.App.History.getSignChart().tableRows.map(function (r) {
    return { factorIndex: r.factorIndex, withPower: r.withPower };
  }));
  ok('both factors pre-fill automatically, BARE (withPower false), even though factor 0 has a power',
    JSON.stringify(poweredAutoRows) === JSON.stringify([{ factorIndex: 0, withPower: false }, { factorIndex: 1, withPower: false }]));
  const poweredAutoLabel = await page.evaluate(() => {
    var a = document.querySelectorAll('.sign-chart-row-label')[0].querySelector('annotation');
    return a ? a.textContent : null;
  });
  ok('the pre-filled row for the squared factor shows the BARE form, no exponent', poweredAutoLabel === 'x + 2');

  const poweredWrap = page.locator('.sign-chart-table-wrap');
  await poweredWrap.hover();
  await page.waitForTimeout(100);
  await page.click('.sign-chart-add-row-btn', { force: true });
  await page.waitForTimeout(80);
  const poweredOptionTexts = await page.evaluate(() => Array.from(document.querySelectorAll('.sign-chart-popup-btn')).map(function (e) {
    var a = e.querySelector('annotation'); return a ? a.textContent : e.textContent;
  }));
  console.log('add-row options for a squared factor:', JSON.stringify(poweredOptionTexts));
  ok('add-row offers exactly 2 options: the powered factor (only exponent>1 gets one) and "total"',
    poweredOptionTexts.length === 2);
  ok('one option is the factor WITH its real power, "(x+2)^{2}" -- proves no THIRD option for the other factor exists either',
    poweredOptionTexts.some(function (t) { return t === '\\left(x + 2\\right)^{2}'; }));
  // Retour utilisateur, this round: the "total" option/row must show the power too, e.g.
  // "(x+1)²(x+4)" rather than "(x+1)(x+4)" -- checked here on "(x+2)²(x-1)".
  ok('the "total" option ALSO carries the power on the squared factor: "(x+2)^{2}(x-1)"',
    poweredOptionTexts.some(function (t) { return t === '\\left(x + 2\\right)^{2}\\left(x - 1\\right)'; }));

  await page.evaluate(() => window.App.History.signChartAddRow({ rowKind: 'factor', factorIndex: 0, withPower: true }));
  await page.waitForTimeout(80);
  const poweredRowIndex = await page.evaluate(() =>
    window.App.History.getSignChart().tableRows.findIndex(function (r) { return r.withPower; }));
  ok('signChartAddRow accepts the withPower row and adds it', poweredRowIndex !== -1);
  ok('signChartAddRow rejects a withPower row for a factor whose real exponent is 1',
    !(await page.evaluate(() => window.App.History.signChartAddRow({ rowKind: 'factor', factorIndex: 1, withPower: true }))));
  const poweredRowLabel = await page.evaluate((idx) => {
    var a = document.querySelectorAll('.sign-chart-row-label')[idx].querySelector('annotation');
    return a ? a.textContent : null;
  }, poweredRowIndex);
  ok('the powered row\'s own label includes the exponent, "(x+2)^{2}"', poweredRowLabel === '\\left(x + 2\\right)^{2}');

  // Columns: root -2 (factor 0, even power) and root 1 (factor 1) -> [interval(-inf,-2),
  // boundary(-2), interval(-2,1), boundary(1), interval(1,inf)]. An EVEN power is never
  // negative: '+' on BOTH sides of its own root, '0' only exactly at it.
  await page.evaluate((row) => {
    var Hist = window.App.History;
    Hist.signChartSetCell(row, 0, '+'); // below -2 -- even power, still +
    Hist.signChartSetCell(row, 1, '0'); // at its own root
    Hist.signChartSetCell(row, 2, '+'); // between -2 and 1 -- still + (a NAIVE odd-power reading would say '-')
    Hist.signChartSetCell(row, 4, '+'); // above 1
  }, poweredRowIndex);
  await page.waitForTimeout(80);
  const poweredCorrectness = await page.evaluate((row) => {
    var r = {};
    [0, 1, 2, 4].forEach(function (i) { r[i] = window.App.History.signChartCellCorrect(row, i); });
    return r;
  }, poweredRowIndex);
  console.log('squared-factor row correctness:', JSON.stringify(poweredCorrectness));
  ok('every cell of the squared-factor row validates correctly (always +, 0 only at its root)',
    Object.keys(poweredCorrectness).every(function (k) { return poweredCorrectness[k] === true; }));
  // A naive (unpowered) reading would expect '-' between -2 and 1 (leading coeff > 0,
  // below the root) -- confirm that reading is explicitly REJECTED for this row.
  await page.evaluate((row) => window.App.History.signChartSetCell(row, 2, '-'), poweredRowIndex);
  await page.waitForTimeout(60);
  ok('a naive (non-parity-aware) "-" between -2 and 1 is flagged wrong for the squared factor',
    (await page.evaluate((row) => window.App.History.signChartCellCorrect(row, 2), poweredRowIndex)) === false);

  // --- Isolated scenario: "Produit nul" must become UNAVAILABLE once a sign chart already
  // exists on this equation (retour utilisateur: hovering it previously showed a
  // mis-positioned preview, and clicking it made the sign chart disappear entirely --
  // splitIntoBranches poses `branches`, which the renderer shows INSTEAD of the main
  // chain/sign chart, without ever clearing `signChart` itself: its data survived, but
  // nothing displayed it any more). ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    Hist.signChartAction();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(120);
  ok('canProduitNul() is false once a sign chart already exists on this node',
    !(await page.evaluate(() => window.App.History.canProduitNul())));
  const pnBtnHidden = await page.evaluate(() => {
    var b = document.querySelector('button[data-op="produitnul"]');
    if (!b) return true;
    var row = b.closest('.op-row');
    return !!row.hidden || row.classList.contains('row-hidden');
  });
  ok('the "Produit nul" button itself is hidden (no hoverable preview possible)', pnBtnHidden);
  ok('confirmProduitNul() is a no-op (returns false, does not touch the sign chart)',
    !(await page.evaluate(() => window.App.History.confirmProduitNul())));
  ok('the sign chart is still present and the main chain is still what renders (no branches created)',
    (await page.evaluate(() => !!window.App.History.getSignChart())) &&
    (await page.evaluate(() => window.App.History.getBranches())) === null);

  // --- Isolated scenario: "Tableau de signes" must NOT appear while focused inside an
  // "Condition d'existence" column (retour utilisateur) -- that column's own equation,
  // once solved down to e.g. "x - 1 = 0", is itself trivially "chartable" in isolation
  // (Expr.extractSignChartFactors sees a single bare linear factor), the same trap
  // focusedSignChartFactor already guards against for a factor's own mini-inequation. ---
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
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(80);
  const domDenSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(domDenSel, { force: true });
  await page.click(domDenSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(120);
  await page.evaluate(() => window.App.History.setFocusedDomain(0));
  await page.waitForTimeout(100);
  ok('canSignChart() is false while focused inside an existence-condition column',
    !(await page.evaluate(() => window.App.History.canSignChart())));
  const scBtnHiddenInDomain = await page.evaluate(() => {
    var b = document.querySelector('button[data-op="signchart"]');
    if (!b) return true;
    var row = b.closest('.op-row');
    return !!row.hidden || row.classList.contains('row-hidden');
  });
  ok('the "Tableau de signes" button is hidden while inside that column', scBtnHiddenInDomain);
  await page.evaluate(() => window.App.History.focusMain());
  await page.waitForTimeout(80);

  // --- Isolated scenario: the "Condition d'existence" group must shift right of the sign
  // chart's own equations once one is generated, never overlapping it (retour utilisateur)
  // -- positionDomainGroup now also measures the sign-chart factors row/table, not just the
  // main equation's own width. ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
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
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(80);
  await page.click(domDenSel, { force: true });
  await page.click(domDenSel, { force: true });
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
    Hist.selectOp('expr'); Hist.setExprChainText('\\div-1'); Hist.confirm();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.History.signChartAction());
  await page.waitForTimeout(80);
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
    Hist.signChartAddRow({ rowKind: 'total' });
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(200);
  const overlapRects = await page.evaluate(() => {
    function r(sel) { var e = document.querySelector(sel); return e ? e.getBoundingClientRect() : null; }
    return { domainGroup: r('.domain-group'), factorsGroup: r('.sign-chart-factors-group'), table: r('.sign-chart-table-wrap') };
  });
  console.log('domain-group vs sign-chart rects:', JSON.stringify(overlapRects));
  function rectsOverlap(a, b) {
    return !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }
  ok('the domain group does not overlap the sign chart factors row',
    !rectsOverlap(overlapRects.domainGroup, overlapRects.factorsGroup));
  ok('the domain group does not overlap the sign chart table',
    !rectsOverlap(overlapRects.domainGroup, overlapRects.table));
  ok('the domain group sits entirely to the RIGHT of both (never merely stacked/clipped)',
    overlapRects.domainGroup.left >= overlapRects.factorsGroup.right &&
    overlapRects.domainGroup.left >= overlapRects.table.right);

  // --- Isolated scenario: switching context (clicking into a sign-chart factor's own
  // equation) must NOT animate the main equation's now-irrelevant action-window buttons
  // away (retour utilisateur: "remove this animation, as those old buttons were only
  // meant for the main equation's action window anyway") -- while a genuine SELECTION
  // change WITHIN the same context still animates normally, unaffected. ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    Hist.signChartAction();
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
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  // Select a term on the main chain first, so switching context has something to hide.
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]', { force: true });
  await page.waitForTimeout(100);
  await page.click('.domain-branch[data-signchart-factor-index="0"] .side[data-side="left"] .term[data-index="0"]', { force: true });
  await page.waitForTimeout(20); // checked immediately: a real animation would still be mid-transition here
  const rowsRightAfterSwitch = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#opButtons .op-row')).map(function (r) { return { hidden: r.hidden, cls: r.className }; }));
  console.log('op-rows immediately after a context switch:', JSON.stringify(rowsRightAfterSwitch));
  ok('no row is left mid-transition (row-hidden class present but not yet actually hidden) after a context switch',
    !rowsRightAfterSwitch.some(function (r) { return r.cls.indexOf('row-hidden') !== -1 && !r.hidden; }));
  ok('no row keeps the "row-appearing" pop class either after a context switch',
    !rowsRightAfterSwitch.some(function (r) { return r.cls.indexOf('row-appearing') !== -1; }));

  // --- Isolated scenario: clicking "+ Ajouter une rangée" right after a real drag/pan
  // gesture must open the popup NEXT TO THE BUTTON, not at the top-left of the screen
  // (retour utilisateur). Root cause: a real mousedown-then-drag landing on a factor
  // column (matching .produit-nul-branch, in CANVAS_PAN_EXCLUDE so no actual panning
  // happens) ends with a native "phantom" click on plain background -- which
  // initBranchOutlineDismissal (a capture-phase document listener) reads as "outside",
  // hiding the branch outline. The VERY NEXT click, landing back inside a "keep" zone
  // like the add-row button, used to re-render SYNCHRONOUSLY in that same capture phase
  // to restore the outline -- destroying the button (and the click handler's own
  // `anchorEl` closure) before its own bubble-phase handler could run, so
  // openSignChartPopup anchored to an already-detached node (getBoundingClientRect() all
  // zero -> popup pinned near the screen origin). ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' });
    Hist.signChartAction();
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
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  // Real mousedown+move+up starting ON a factor column (excluded from panning, but still
  // produces the native phantom click on release) -- NOT the App.Canvas.set() API, which
  // wouldn't reproduce this at all (no real click/mousedown sequence involved).
  const panStartBox = await page.evaluate(() => {
    var el = document.querySelector('.domain-branch[data-signchart-factor-index="0"]');
    var r = el.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + 10 };
  });
  await page.mouse.move(panStartBox.x, panStartBox.y);
  await page.mouse.down();
  await page.mouse.move(panStartBox.x - 150, panStartBox.y - 150, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const panWrap = page.locator('.sign-chart-table-wrap');
  await panWrap.hover();
  await page.waitForTimeout(150);
  const addRowBtnRect = await page.evaluate(() => document.querySelector('.sign-chart-add-row-btn').getBoundingClientRect());
  await page.click('.sign-chart-add-row-btn', { force: true });
  await page.waitForTimeout(100);
  const popupAfterPanRect = await page.evaluate(() => {
    var p = document.querySelector('.sign-chart-popup');
    return p ? p.getBoundingClientRect() : null;
  });
  console.log('add-row button rect:', JSON.stringify(addRowBtnRect), 'popup rect after pan+click:', JSON.stringify(popupAfterPanRect));
  ok('the popup opened at all (not silently swallowed)', popupAfterPanRect !== null);
  ok('the popup is anchored next to the button, not pinned near the screen origin',
    popupAfterPanRect !== null &&
    Math.abs((popupAfterPanRect.left + popupAfterPanRect.width / 2) - (addRowBtnRect.left + addRowBtnRect.width / 2)) < 50);
  // Picking an option still works normally afterward.
  await page.click('.sign-chart-popup-btn:first-child', { force: true });
  await page.waitForTimeout(80);
  ok('picking an option from that popup still adds the row correctly',
    (await page.evaluate(() => window.App.History.getSignChart().tableRows.length)) > 0);

  // --- Isolated scenario: the "Condition d'existence" group must clear not just the sign
  // chart factor columns' own layout box, but the ARROWS drawn inside them too (retour
  // utilisateur: "still a bit of overlap between the arrows of the rightmost inequality...
  // and the leftmost arrows in the existence condition section") -- those arrows live in
  // an `overflow:visible` <svg>, so their operation-label text can paint well past their
  // column's own CSS layout width without ever growing it. ---
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
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
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(80);
  await page.click(domDenSel, { force: true });
  await page.click(domDenSel, { force: true });
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
    Hist.selectOp('expr'); Hist.setExprChainText('\\div-1'); Hist.confirm();
    Hist.focusMain();
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.History.signChartAction());
  await page.waitForTimeout(80);
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
    Hist.signChartAddRow({ rowKind: 'total' });
  });
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(200);
  const arrowClearance = await page.evaluate(() => {
    function rightEdge(el) { return el ? el.getBoundingClientRect().right : null; }
    var domain = document.querySelector('.domain-group');
    var cols = Array.from(document.querySelectorAll('.sign-chart-factors-group .produit-nul-branch'));
    var lastCol = cols[cols.length - 1];
    var svg = lastCol ? lastCol.querySelector('svg.arrows-overlay') : null;
    var painted = svg ? Array.from(svg.querySelectorAll('path, text, tspan')) : [];
    var arrowMaxRight = null;
    painted.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (arrowMaxRight === null || r.right > arrowMaxRight) arrowMaxRight = r.right;
    });
    return { domainLeft: domain ? domain.getBoundingClientRect().left : null, arrowMaxRight: arrowMaxRight };
  });
  console.log('domain group vs rightmost factor arrows:', JSON.stringify(arrowClearance));
  ok('the rightmost factor column actually drew some arrow content (sanity check)', arrowClearance.arrowMaxRight !== null);
  ok('the domain group sits to the right of that arrow content, not just the column\'s own layout box',
    arrowClearance.domainLeft !== null && arrowClearance.domainLeft > arrowClearance.arrowMaxRight);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
