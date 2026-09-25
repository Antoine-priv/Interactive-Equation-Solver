const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Racine carrée en x utilisée comme FACTEUR (dans un produit, un numérateur ou un
// dénominateur), ex. "\frac{(x+8)(x-4)}{(x-6)\cdot\sqrt{x+2}}\leq0" — refusée jusqu'ici
// ("La racine carrée n'est prise en charge que sur un nombre."). Couvre : l'analyse de
// cette forme et de ses variantes, la saisie via la vraie modale, "Condition d'existence"
// sur un dénominateur contenant une racine (une colonne par facteur, "> 0" strict pour la
// racine), le "Tableau de signes" (rangée √ : "0" en sa racine, "+" au-delà, non définie
// en deçà — case intervalle hachurée), la solution finale, et une racine au numérateur.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function parse(latex) {
    return page.evaluate((l) => {
      try { return { ok: true, eq: window.App.Parser.parseLatexEquation(l) }; }
      catch (err) { return { ok: false, error: err.message }; }
    }, latex);
  }
  const SQ = (c) => ({ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: c, pow: 0 }] });
  const LIN = (c) => [{ coeff: 1, pow: 1 }, { coeff: c, pow: 0 }];

  // --- Analyse ---
  const USER_LATEX = '\\frac{\\left(x+8\\right)\\left(x-4\\right)}{\\htmlData{fracpart=den}{\\left(x-6\\right)\\cdot\\sqrt{x+2}}}\\leq0';
  let r = await parse(USER_LATEX);
  ok('the reported inequality parses (√ as a denominator factor, "\\cdot" accepted)',
    r.ok && JSON.stringify(r.eq.left[0].factorTerms) === JSON.stringify([{ sign: 1, factors: [
      { terms: LIN(-6), exponent: 1 }, { terms: [SQ(2)], exponent: 1 }] }]) && r.eq.operator === '\\leq');
  if (!r.ok) console.log('  parse error:', r.error);

  r = await parse('(x-1)\\sqrt{x+2}\\geq0');
  ok('"(x-1)√(x+2)" parses as a 2-factor product',
    r.ok && JSON.stringify(r.eq.left) === JSON.stringify([{ sign: 1, factors: [{ terms: LIN(-1), exponent: 1 }, { terms: [SQ(2)], exponent: 1 }] }]));
  r = await parse('\\frac{x-1}{\\sqrt{x+2}}<0');
  ok('a lone √ denominator parses as a SqrtGroup denominator',
    r.ok && JSON.stringify(r.eq.left[0].factorTerms) === JSON.stringify([SQ(2)]));
  r = await parse('\\frac{\\sqrt{x+2}}{x-1}>0');
  ok('a lone √ numerator parses as a SqrtGroup numerator',
    r.ok && JSON.stringify(r.eq.left[0].innerTerms) === JSON.stringify([SQ(2)]));
  r = await parse('2\\sqrt{x+1}=6');
  ok('"2√(x+1)" parses (numeric coefficient before a √)', r.ok && r.eq.left[0].factors.length === 2);
  r = await parse('x\\times\\sqrt{x+1}=0');
  ok('"x × √(x+1)" parses ("×" before a √ is plain juxtaposition)', r.ok && r.eq.left[0].factors.length === 2);
  r = await parse('-\\sqrt{x+3}=4');
  ok('regression: a whole-side "-√(x+3)" is still a signed SqrtGroup',
    r.ok && JSON.stringify(r.eq.left) === JSON.stringify([{ sign: -1, radicand: LIN(3) }]));
  r = await parse('\\sqrt{25}+x=3');
  ok('regression: a numeric radicand still folds to a number',
    r.ok && JSON.stringify(r.eq.left) === JSON.stringify([{ coeff: 5, pow: 0 }, { coeff: 1, pow: 1 }]));

  // --- Saisie via la vraie modale "Nouvelle équation" ---
  await page.click('#newEquationBtn');
  await page.waitForTimeout(150);
  await page.evaluate((l) => window.App.MathKeypad.setLatex(l), USER_LATEX);
  await page.click('#manualSubmit');
  await page.waitForTimeout(200);
  ok('no error shown in the modal', ((await page.textContent('#manualError')) || '') === '');
  ok('equation started as an inequality "≤"',
    (await page.evaluate(() => window.App.History.getCurrentOperator())) === '\\leq');
  ok('the √ is rendered in the denominator',
    await page.evaluate(() => !!document.querySelector('.eq-row.current [data-fracpart="den"] .sqrt')));

  // --- Condition d'existence : une colonne par facteur du dénominateur ---
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  ok('"Condition d\'existence" available once drilled into the denominator',
    await page.evaluate(() => window.App.History.canExistenceCondition()));
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);
  const conds = await page.evaluate(() => window.App.History.getDomainConditions().map(function (c) {
    return { kind: c.kind, operator: c.operator, arr: c.capturedArray };
  }));
  ok('two domain columns: "x-6 ≠ 0" and "x+2 > 0" (strict: √ in a denominator)',
    JSON.stringify(conds) === JSON.stringify([
      { kind: 'den', operator: '\\neq', arr: LIN(-6) },
      { kind: 'sqrt', operator: '>', arr: LIN(2) }]));

  await page.evaluate(() => {
    var Hist = window.App.History;
    function solve(chain) {
      Hist.selectOp('expr'); Hist.setExprChainText(chain); Hist.confirm();
      Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
      Hist.confirmSimplifySelection();
      Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
      Hist.confirmSimplifySelection();
    }
    Hist.setFocusedDomain(0); solve('+6');
    Hist.setFocusedDomain(1); solve('-2');
    Hist.focusMain();
  });
  await page.waitForTimeout(150);
  const dfLatex = await page.evaluate(() => {
    var a = document.querySelector('.domain-df-result annotation');
    return a ? a.textContent : null;
  });
  ok('Df combines both columns: ℝ∖{6} ∩ ]-2;+∞[',
    !!dfLatex && dfLatex.indexOf('\\setminus\\left\\{6\\right\\}') !== -1 && dfLatex.indexOf('\\left]-2;+\\infty\\right[') !== -1);
  if (!dfLatex) console.log('  Df latex missing');

  // --- Tableau de signes ---
  ok('"Tableau de signes" available once the domain is established',
    await page.evaluate(() => window.App.History.canSignChart()));
  const factors = await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.signChartAction();
    return Hist.getSignChart().factors.map(function (f) { return { kind: f.kind, sqrt: f.sqrt, side: f.capturedSide }; });
  });
  ok('4 factors: den x-6, den √(x+2), num x+8, num x-4',
    JSON.stringify(factors) === JSON.stringify([
      { kind: 'den', sqrt: false, side: LIN(-6) }, { kind: 'den', sqrt: true, side: LIN(2) },
      { kind: 'num', sqrt: false, side: LIN(8) }, { kind: 'num', sqrt: false, side: LIN(-4) }]));
  await page.evaluate(() => {
    var Hist = window.App.History;
    function solve(chain) {
      Hist.selectOp('expr'); Hist.setExprChainText(chain); Hist.confirm();
      Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
      Hist.confirmSimplifySelection();
      Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
      Hist.confirmSimplifySelection();
    }
    ['+6', '-2', '-8', '+4'].forEach(function (c, i) { Hist.setFocusedSignChartFactor(i); solve(c); });
    Hist.focusMain();
  });
  await page.waitForTimeout(150);
  const cols = await page.evaluate(() => window.App.History.getSignChartColumns().map(function (c) {
    return c.type === 'boundary' ? c.value : 'I';
  }));
  ok('columns split at -8, -2, 4, 6', JSON.stringify(cols) === JSON.stringify(['I', -8, 'I', -2, 'I', 4, 'I', 6, 'I']));
  ok('the √ row label renders as a square root',
    await page.evaluate(() => Array.prototype.some.call(document.querySelectorAll('.sign-chart-table annotation'),
      function (a) { return a.textContent === '\\sqrt{x + 2}'; })));

  // Rangées pré-remplies : 0 = x-6, 1 = √(x+2), 2 = x+8, 3 = x-4 ; + la rangée totale (4).
  const sqrtRow = [
    'undef', 'undef', 'undef', '0', '+', null, '+', null, '+'];
  const totalRow = [
    'undef', 'undef', 'undef', 'undef', '+', '0', '-', 'undef', '+'];
  const res = await page.evaluate((args) => {
    var Hist = window.App.History;
    Hist.signChartAddRow({ rowKind: 'total' });
    var totalIdx = Hist.getSignChart().tableRows.length - 1;
    var out = { sqrt: [], total: [], rejected: null };
    args.sqrtRow.forEach(function (v, i) { if (v !== null) Hist.signChartSetCell(1, i, v); });
    args.totalRow.forEach(function (v, i) { Hist.signChartSetCell(totalIdx, i, v); });
    args.sqrtRow.forEach(function (v, i) { out.sqrt.push(v === null ? null : Hist.signChartCellCorrect(1, i)); });
    args.totalRow.forEach(function (v, i) { out.total.push(Hist.signChartCellCorrect(totalIdx, i)); });
    out.totalIdx = totalIdx;
    return out;
  }, { sqrtRow, totalRow });
  ok('√ row: undefined below -2, 0 at -2, + above — all judged correct',
    res.sqrt.every(function (v) { return v === null || v === true; }));
  ok('total row: undefined outside Df (incl. x=-8 and x=6), +, 0, −, + — all correct',
    res.total.every(function (v) { return v === true; }));
  const wrongChecks = await page.evaluate((totalIdx) => {
    var Hist = window.App.History;
    Hist.signChartSetCell(totalIdx, 0, '+');
    var a = Hist.signChartCellCorrect(totalIdx, 0);
    Hist.signChartSetCell(totalIdx, 0, 'undef');
    Hist.signChartSetCell(1, 5, '0');
    var b = Hist.signChartCellCorrect(1, 5);
    Hist.signChartSetCell(1, 5, null);
    return { a: a, b: b };
  }, res.totalIdx);
  ok('"+" left of the domain is judged wrong', wrongChecks.a === false);
  ok('"0" on the √ row at x=4 (not its root) is judged wrong', wrongChecks.b === false);

  await page.waitForTimeout(100);
  ok('an undefined interval cell is hatched',
    await page.evaluate(() => !!document.querySelector('.sign-chart-cell-hatched')));
  // Popup d'une case intervalle : "Non défini" offert en plus de +/− (racine présente).
  await page.click('.sign-chart-target[data-sign-chart-row="0"][data-sign-chart-col="4"]', { force: true });
  await page.waitForTimeout(100);
  const popupLabels = await page.evaluate(() => Array.prototype.map.call(
    document.querySelectorAll('.sign-chart-popup button'), function (b) { return b.textContent; }));
  ok('interval popup offers "Non défini"', popupLabels.indexOf('Non défini') !== -1);
  if (popupLabels.indexOf('Non défini') === -1) console.log('  popup labels:', JSON.stringify(popupLabels));
  await page.keyboard.press('Escape');

  const ranges = await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.signChartVerify();
    return Hist.signChartSolutionRanges();
  });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    var C = window.App.Canvas;
    var rect = document.querySelector('.sign-chart-table-wrap').getBoundingClientRect();
    C.set(C.getX() + rect.left - 60, C.getY() + rect.top - 120);
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: __dirname + '/screenshots/sqrt_factor_sign_chart.png' });
  ok('S = [4;6[', JSON.stringify(ranges) === JSON.stringify([{ from: 4, fromIncluded: true, to: 6, toIncluded: false }]));

  // --- Racine au numérateur : "(x-1)√(x+2) ≥ 0" ---
  await page.evaluate(() => {
    var eq = window.App.Parser.parseLatexEquation('(x-1)\\sqrt{x+2}\\geq0');
    window.App.History.startNewEquation({ left: eq.left, right: eq.right }, { operator: eq.operator });
  });
  await page.waitForTimeout(100);
  ok('sign chart gated until the radicand condition exists',
    !(await page.evaluate(() => window.App.History.canSignChart())));
  await page.evaluate(() => { window.App.History.drillIntoProductBranch('left', 0, 1); });
  const numCond = await page.evaluate(() => {
    var Hist = window.App.History;
    if (!Hist.canExistenceCondition()) return null;
    Hist.existenceConditionAction();
    return Hist.getDomainConditions().map(function (c) { return { kind: c.kind, operator: c.operator }; });
  });
  ok('drilling the √ factor offers "x+2 ≥ 0"', JSON.stringify(numCond) === JSON.stringify([{ kind: 'sqrt', operator: '\\geq' }]));
  const numRanges = await page.evaluate(() => {
    var Hist = window.App.History;
    function solve(chain) {
      Hist.selectOp('expr'); Hist.setExprChainText(chain); Hist.confirm();
      Hist.toggleTermSelection('left', 1); Hist.toggleTermSelection('left', 2);
      Hist.confirmSimplifySelection();
      Hist.toggleTermSelection('right', 0); Hist.toggleTermSelection('right', 1);
      Hist.confirmSimplifySelection();
    }
    Hist.setFocusedDomain(0); solve('-2'); Hist.focusMain();
    if (!Hist.canSignChart()) return 'not chartable';
    Hist.signChartAction();
    // Ordre de parcours : x-1 puis √(x+2).
    Hist.setFocusedSignChartFactor(0); solve('+1');
    Hist.setFocusedSignChartFactor(1); solve('-2');
    Hist.focusMain();
    Hist.signChartAddRow({ rowKind: 'total' });
    var t = Hist.getSignChart().tableRows.length - 1;
    // Colonnes : ]-∞;-2[, -2, ]-2;1[, 1, ]1;+∞[
    ['undef', '0', '-', '0', '+'].forEach(function (v, i) { Hist.signChartSetCell(t, i, v); });
    Hist.signChartVerify();
    return Hist.signChartSolutionRanges();
  });
  ok('"(x-1)√(x+2) ≥ 0" solves to {-2} ∪ [1;+∞[',
    JSON.stringify(numRanges) === JSON.stringify([
      { from: -2, fromIncluded: true, to: -2, toIncluded: true },
      { from: 1, fromIncluded: true, to: Infinity, toIncluded: false }]));
  if (!Array.isArray(numRanges)) console.log('  got:', JSON.stringify(numRanges));

  // --- Équation : "Produit nul" accepte un facteur racine ---
  const pn = await page.evaluate(() => {
    var eq = window.App.Parser.parseLatexEquation('(x-3)\\sqrt{x+2}=0');
    var Hist = window.App.History;
    Hist.startNewEquation({ left: eq.left, right: eq.right });
    if (!Hist.canProduitNul()) return null;
    Hist.confirmProduitNul();
    return Hist.getBranches().map(function (b) { return window.App.Expr.sideLatex(b.lastEquation().left); });
  });
  ok('"(x-3)√(x+2)=0" splits via Produit nul into x-3=0 and √(x+2)=0',
    JSON.stringify(pn) === JSON.stringify(['x - 3', '\\sqrt{x + 2}']));

  // --- Deux colonnes de domaine créées d'un coup : côte à côte, jamais empilées ---
  // (bug rapporté avec "(x+5)√(x+5)" au dénominateur, "+5x" des deux côtés).
  await page.evaluate(() => {
    var eq = window.App.Parser.parseLatexEquation('\\frac{\\left(x+8\\right)\\left(x-6\\right)\\left(x+1\\right)}' +
      '{\\htmlData{fracpart=den}{\\left(x+5\\right)\\sqrt{x+5}}}+5x<5x');
    window.App.History.startNewEquation({ left: eq.left, right: eq.right }, { operator: eq.operator });
    window.App.Canvas.set(0, 0);
  });
  await page.waitForTimeout(150);
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(900);
  const domCols = await page.$$eval('.domain-split > .domain-branch', (els) => els.map((e) => {
    var r = e.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
  }));
  ok('two domain columns spawned', domCols.length === 2);
  ok('domain columns side by side (same top, second to the right of the first)',
    domCols.length === 2 && domCols[0].top === domCols[1].top && domCols[1].left >= domCols[0].right);
  if (domCols.length === 2 && domCols[0].top !== domCols[1].top) console.log('  columns:', JSON.stringify(domCols));
  await page.screenshot({ path: __dirname + '/screenshots/sqrt_factor_domain_columns.png' });

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
