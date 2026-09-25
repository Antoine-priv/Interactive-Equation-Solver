const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Le bouton retour (#undoBtn) agit aussi dans les colonnes "Condition d'existence" et
// "Tableau de signes" (voir undo/canUndo dans createBranchable, history.js) : il défait
// d'abord les étapes de la colonne focalisée, puis la colonne elle-même ; depuis la chaîne
// principale, il retire d'abord une colonne/un tableau créé après sa dernière étape.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  const undoDisabled = () => page.evaluate(() => document.getElementById('undoBtn').disabled);
  async function clickUndo() {
    await page.click('#undoBtn');
    await page.waitForTimeout(120);
  }

  await page.goto(FILE);

  // ===== Condition d'existence =====
  async function startQuotient() {
    await page.evaluate(() => {
      window.App.History.startNewEquation({
        left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
        right: [{ coeff: 10, pow: 0 }]
      });
    });
    await page.waitForTimeout(80);
  }
  async function spawnDomain() {
    const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
    await page.click(denSel, { force: true });
    await page.click(denSel, { force: true });
    await page.click('button[data-op="existence"]');
    await page.waitForTimeout(120);
    await page.evaluate(() => window.App.Canvas.set(0, 0));
  }

  await startQuotient();
  await spawnDomain();
  ok('domain column spawned', await page.evaluate(() => (window.App.History.getDomainConditions() || []).length === 1));

  await page.evaluate(() => {
    var H = window.App.History;
    H.setFocusedDomain(0);
    H.selectOp('expr');
    H.setExprChainText('-3');
    H.confirm();
  });
  await page.waitForTimeout(120);
  const domSteps = () => page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps().length);
  ok('domain column has 2 steps after an operation', (await domSteps()) === 2);
  ok('undo enabled while focused in the domain column', (await undoDisabled()) === false);

  await clickUndo();
  ok('undo removes the domain column step (back to 1)', (await domSteps()) === 1);
  ok('undo still enabled (the column itself can be removed)', (await undoDisabled()) === false);

  await clickUndo();
  let state = await page.evaluate(() => ({
    conds: window.App.History.getDomainConditions(),
    focused: window.App.History.getFocusedDomain(),
    mainSteps: window.App.History.getSteps().length
  }));
  ok('second undo removes the exhausted domain column', state.conds === null && state.focused === null);
  ok('main chain untouched', state.mainSteps === 1);
  ok('undo disabled again (nothing left)', (await undoDisabled()) === true);

  // Depuis la chaîne principale : la colonne créée après la dernière étape part d'abord.
  await page.evaluate(() => {
    var H = window.App.History;
    H.selectOp('expr');
    H.setExprChainText('\\times2');
    H.confirm();
  });
  await page.waitForTimeout(120);
  await spawnDomain();
  await page.evaluate(() => window.App.History.focusMain());
  await clickUndo();
  state = await page.evaluate(() => ({
    conds: window.App.History.getDomainConditions(),
    mainSteps: window.App.History.getSteps().length
  }));
  ok('from the main chain, undo first removes the column created after the last step',
    state.conds === null && state.mainSteps === 2);
  await clickUndo();
  ok('then undo goes back one main step', (await page.evaluate(() => window.App.History.getSteps().length)) === 1);

  // ===== Tableau de signes =====
  async function startProduct() {
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
  }

  await startProduct();
  ok('sign chart created', await page.evaluate(() => !!window.App.History.getSignChart()));
  ok('undo enabled right after creating the sign chart', (await undoDisabled()) === false);

  await page.evaluate(() => {
    var H = window.App.History;
    H.setFocusedSignChartFactor(0);
    H.selectOp('expr');
    H.setExprChainText('-1');
    H.confirm();
  });
  await page.waitForTimeout(120);
  const facSteps = () => page.evaluate(() => window.App.History.getSignChart().factors[0].engine.getSteps().length);
  ok('sign chart factor has 2 steps after an operation', (await facSteps()) === 2);
  await page.screenshot({ path: `${SCRATCH}/undo_columns_signchart_before.png` });

  await clickUndo();
  ok('undo removes the factor step (back to 1)', (await facSteps()) === 1);

  await clickUndo();
  state = await page.evaluate(() => ({
    chart: window.App.History.getSignChart(),
    focused: window.App.History.getFocusedSignChartFactor()
  }));
  ok('second undo removes the whole sign chart', state.chart === null && state.focused === null);
  ok('undo disabled once back to the bare inequation', (await undoDisabled()) === true);

  // Depuis la chaîne principale : retour retire directement le tableau.
  await startProduct();
  await page.evaluate(() => window.App.History.focusMain());
  await clickUndo();
  ok('from the main chain, undo removes the sign chart', await page.evaluate(() => window.App.History.getSignChart() === null));
  await page.screenshot({ path: `${SCRATCH}/undo_columns_after.png` });

  // ===== Grille du tableau de signes =====
  await startProduct();
  await page.evaluate(() => {
    var H = window.App.History;
    H.setFocusedSignChartFactor(0);
    H.selectOp('expr'); H.setExprChainText('-1'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
    H.setFocusedSignChartFactor(1);
    H.selectOp('expr'); H.setExprChainText('+2'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  await page.waitForTimeout(120);
  const grid = () => page.evaluate(() => {
    var c = window.App.History.getSignChart();
    return c && { rows: c.tableRows.map(function (r) { return r.rowKind + ':' + r.cells.join(','); }), verified: c.verified };
  });
  let g = await grid();
  ok('table auto-filled with the 2 factor rows', g && g.rows.length === 2);
  const factor1Steps = await page.evaluate(() => window.App.History.getSignChart().factors[1].engine.getSteps().length);

  await page.evaluate(() => {
    var H = window.App.History;
    H.signChartSetCell(0, 0, '-');
    H.signChartSetCell(0, 1, '0');
    H.signChartAddRow({ rowKind: 'total' });
    H.signChartVerify();
  });
  await page.waitForTimeout(120);
  g = await grid();
  ok('grid actions applied (2 cells, total row, verified)',
    g.rows.length === 3 && g.rows[0] === 'factor:-,0,,,' && g.verified === true);
  await page.screenshot({ path: `${SCRATCH}/undo_columns_grid_before.png` });

  await clickUndo();
  g = await grid();
  ok('undo 1: "Vérifier" undone', g.verified === false && g.rows.length === 3);
  await clickUndo();
  g = await grid();
  ok('undo 2: total row removed', g.rows.length === 2);
  await clickUndo();
  g = await grid();
  ok('undo 3: last cell cleared', g.rows[0] === 'factor:-,,,,');
  await clickUndo();
  g = await grid();
  ok('undo 4: first cell cleared', g.rows[0] === 'factor:,,,,');
  ok('factor steps untouched by grid undos',
    (await page.evaluate(() => window.App.History.getSignChart().factors[1].engine.getSteps().length)) === factor1Steps);
  await clickUndo();
  ok('undo 5: grid exhausted, undoes the focused factor\'s last step',
    (await page.evaluate(() => window.App.History.getSignChart().factors[1].engine.getSteps().length)) === factor1Steps - 1);

  // Depuis la chaîne principale : la grille est aussi défaite avant le tableau lui-même.
  await page.evaluate(() => {
    var H = window.App.History;
    H.setFocusedSignChartFactor(1);
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
    H.focusMain();
    H.signChartSetCell(1, 4, '+');
  });
  await page.waitForTimeout(120);
  g = await grid();
  ok('table back once the factor is re-solved, rows kept', g && g.rows.length === 2 && g.rows[1] === 'factor:,,,,+');
  await clickUndo();
  g = await grid();
  ok('from the main chain, undo first clears the grid cell', g && g.rows[1] === 'factor:,,,,');
  await clickUndo();
  ok('then the sign chart itself is removed', await page.evaluate(() => window.App.History.getSignChart() === null));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
