const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Tableau de signes" avec un facteur de signe constant (trinôme sans racine, ex. "x²+1",
// exercice 23 question 2) : sa colonne "x²+1 > 0" est posée déjà résolue (en vert), sa
// rangée est ajoutée comme les autres et l'élève y inscrit lui-même les "+".
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const started = await page.evaluate(() => {
    var eq = window.App.Parser.parseLatexEquation('\\frac{(2x-1)(x-1)}{x^2+1}\\leq0');
    window.App.History.startNewEquation({ left: eq.left, right: eq.right }, { operator: eq.operator });
    return { canSignChart: window.App.History.canSignChart() };
  });
  ok('Tableau de signes available on (2x-1)(x-1)/(x²+1) ≤ 0', started.canSignChart);

  const chart = await page.evaluate(() => {
    var H = window.App.History;
    H.signChartAction();
    var sc = H.getSignChart();
    return sc.factors.map(function (f) {
      var first = f.engine.getSteps()[0];
      return { kind: f.kind, constant: f.constant, side: f.capturedSide, alwaysTrue: !!first.alwaysTrue, op: first.operator };
    });
  });
  const cst = chart.filter((f) => f.constant)[0];
  ok('3 factor columns, one of constant sign', chart.length === 3 && !!cst);
  ok('constant column is "x²+1 > 0", posed already true', cst && cst.constant === 1 && cst.kind === 'den' &&
    cst.alwaysTrue && cst.op === '>' &&
    JSON.stringify(cst.side) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: 1, pow: 0 }]));

  await page.waitForTimeout(150);
  const cstIdx = chart.indexOf(cst);
  const solvedClass = await page.evaluate((i) => {
    var row = document.querySelector('.domain-branch[data-signchart-factor-index="' + i + '"] .eq-row');
    return !!row && row.classList.contains('solved');
  }, cstIdx);
  ok('constant column is rendered as solved (green)', solvedClass);

  // Résout les deux facteurs du 1er degré ("Toujours simplifier" pour aller droit au but).
  const cols = await page.evaluate(() => {
    var H = window.App.History;
    window.App.Settings.set('autoSimplify', true);
    var sc = H.getSignChart();
    sc.factors.forEach(function (f, i) {
      if (f.constant) return;
      H.setFocusedSignChartFactor(i);
      var lead = f.capturedSide.filter(function (t) { return t.pow === 1; })[0].coeff;
      var c = f.capturedSide.filter(function (t) { return t.pow === 0; })[0].coeff;
      H.selectOp('expr'); H.setExprChainText(c < 0 ? '+' + (-c) : '-' + c); H.confirm();
      if (lead !== 1) { H.selectOp('expr'); H.setExprChainText('\\div' + lead); H.confirm(); }
    });
    H.focusMain();
    window.App.Settings.set('autoSimplify', false);
    return H.getSignChartColumns();
  });
  ok('columns come from the two real roots only (1/2 and 1)', cols && cols.length === 5 &&
    cols[1].value === 0.5 && cols[3].value === 1);

  const rows = await page.evaluate(() => window.App.History.getSignChart().tableRows.map((r) => r.factorIndex));
  ok('a row is pre-added for every factor, including x²+1', rows.length === 3 && rows.indexOf(cstIdx) !== -1);

  const cells = await page.evaluate((ci) => {
    var H = window.App.History;
    var ri = H.getSignChart().tableRows.map((r) => r.factorIndex).indexOf(ci);
    [0, 2, 4].forEach(function (c) { H.signChartSetCell(ri, c, '+'); });
    var plusOk = [0, 2, 4].every(function (c) { return H.signChartCellCorrect(ri, c) === true; });
    H.signChartSetCell(ri, 1, '0');
    var zeroWrong = H.signChartCellCorrect(ri, 1) === false;
    H.signChartSetCell(ri, 1, null);
    return { plusOk: plusOk, zeroWrong: zeroWrong };
  }, cstIdx);
  ok('"+" is the expected sign on every interval of the x²+1 row', cells.plusOk);
  ok('"0" at a root of another factor is wrong on the x²+1 row', cells.zeroWrong);

  const sol = await page.evaluate(() => {
    var H = window.App.History;
    H.signChartAddRow({ rowKind: 'total' });
    var ri = H.getSignChart().tableRows.length - 1;
    ['+', '0', '-', '0', '+'].forEach(function (v, c) { H.signChartSetCell(ri, c, v); });
    H.signChartVerify();
    return H.signChartSolutionRanges();
  });
  ok('S = [1/2 ; 1]', sol && sol.length === 1 && sol[0].from === 0.5 && sol[0].fromIncluded &&
    sol[0].to === 1 && sol[0].toIncluded);

  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  await page.screenshot({ path: SCRATCH + '/sign_chart_constant_factor.png' });

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
