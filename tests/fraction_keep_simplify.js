const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Une équation saisie "x/2 + x/3 = 5" garde ses fractions (jamais 0,5x), "Simplifier"
// donne 5x/6 (fraction réduite, pas de décimal) et "Développer" n'est pas proposé sur une
// fraction qui ferait apparaître des décimaux.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.goto(FILE);

  await page.click('#newEquationBtn');
  await page.evaluate(() => window.App.MathKeypad.setLatex('\\frac{x}{2}+\\frac{x}{3}=5'));
  await page.click('#manualSubmit');
  await page.waitForTimeout(200);

  const frac = (p, q) => ({ sign: 1, factor: { coeff: q, pow: 0 }, innerTerms: [{ coeff: p, pow: 1 }], isDivision: true });
  let eq = await page.evaluate(() => window.App.History.lastEquation());
  ok('x/2 and x/3 stay fractions', JSON.stringify(eq.left) === JSON.stringify([frac(1, 2), frac(1, 3)]));

  let info = await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    return window.App.Toolbar.computeSelectionInfo();
  });
  ok('Développer unavailable on x/2', !info.canExpand);
  ok('Simplifier unavailable on x/2 alone', !info.canSimplify);

  info = await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 1);
    return window.App.Toolbar.computeSelectionInfo();
  });
  ok('Simplifier available on x/2 + x/3', info.canSimplify);
  ok('Développer unavailable on x/2 + x/3', !info.canExpand);

  await page.click('[data-op="simplify"]');
  eq = await page.evaluate(() => window.App.History.lastEquation());
  ok('Simplifier gives 5x/6', JSON.stringify(eq.left) === JSON.stringify([frac(5, 6)]));

  // ×6 puis Simplifier : 6·(5x/6) -> 5x, sans décimal.
  eq = await page.evaluate(() => {
    var h = window.App.History;
    h.selectOp('expr'); h.setExprChainText('\\times6'); h.confirm();
    h.toggleTermSelection('left', 0);
    h.toggleTermSelection('right', 0);
    h.confirmSimplifySelection();
    return h.lastEquation();
  });
  ok('×6 then Simplifier gives 5x = 30', JSON.stringify(eq.left) === JSON.stringify([{ coeff: 5, pow: 1 }]) &&
    JSON.stringify(eq.right) === JSON.stringify([{ coeff: 30, pow: 0 }]));

  // ×6/5 sur 5x/6 : simplification en croix, x = 6 en une étape ; ÷ une fraction aussi.
  eq = await page.evaluate(() => {
    var h = window.App.History, P = window.App.Parser;
    h.startNewEquation(P.parseLatexEquation('\\frac{5x}{6}=5', { keepFractions: true }));
    h.selectOp('expr'); h.setExprChainText('\\times\\frac{6}{5}'); h.confirm();
    var a = h.lastEquation();
    h.startNewEquation(P.parseLatexEquation('\\frac{x}{6}=1', { keepFractions: true }));
    h.selectOp('expr'); h.setExprChainText('\\div\\frac{3}{4}'); h.confirm();
    return [a, h.lastEquation()];
  });
  ok('5x/6 ×6/5 gives x = 6', JSON.stringify(eq[0].left) === JSON.stringify([{ coeff: 1, pow: 1 }]) &&
    JSON.stringify(eq[0].right) === JSON.stringify([{ coeff: 6, pow: 0 }]));
  ok('x/6 ÷3/4 gives 2x/9', JSON.stringify(eq[1].left) === JSON.stringify([{ sign: 1, factor: { coeff: 9, pow: 0 }, innerTerms: [{ coeff: 2, pow: 1 }], isDivision: true }]));

  // Termes simples et fractions mêlés : x/2 + x -> 3x/2, 1/2 + 1/2 -> 1.
  const r = await page.evaluate(() => {
    var E = window.App.Expr, P = window.App.Parser;
    return [
      E.simplifySelection(P.parseLatexEquation('\\frac{x}{2}+x=1', { keepFractions: true }).left, [0, 1]).side,
      E.simplifySelection(P.parseLatexEquation('\\frac{1}{2}+\\frac{1}{2}=x', { keepFractions: true }).left, [0, 1]).side
    ];
  });
  ok('x/2 + x -> 3x/2', JSON.stringify(r[0]) === JSON.stringify([frac(3, 2)]));
  ok('1/2 + 1/2 -> 1', JSON.stringify(r[1]) === JSON.stringify([{ coeff: 1, pow: 0 }]));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
