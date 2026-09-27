// Tableau de signes : un facteur "x" s'écrit sans parenthèses dans la rangée de
// l'expression totale — "x(x-1)(x+2)", pas "(x)(x-1)(x+2)" (niveau S3 de la campagne).
const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.goto(FILE);
  await page.evaluate(() => {
    var App = window.App, h = App.History;
    App.Settings.set('autoSimplify', true);
    var eq = App.Parser.parseLatexEquation('x(x-1)(x+2)<0');
    h.startNewEquation({ left: eq.left, right: eq.right }, { operator: eq.operator });
    h.signChartAction();
    h.getSignChart().factors.forEach(function (f, i) {
      h.setFocusedSignChartFactor(i);
      var e = h.lastEquation();
      if (e.left.length > 1) { h.selectOp('expr'); h.setExprChainText(e.left[1].coeff < 0 ? '+' + (-e.left[1].coeff) : '-' + e.left[1].coeff); h.confirm(); }
    });
    h.focusMain();
    h.signChartAddRow({ rowKind: 'total' });
  });
  await page.waitForTimeout(300);
  const latexes = await page.evaluate(() => Array.from(document.querySelectorAll('annotation')).map((a) => a.textContent));
  ok('total row reads x(x-1)(x+2)', latexes.indexOf('x\\left(x - 1\\right)\\left(x + 2\\right)') !== -1);
  ok('no "(x)" anywhere', !latexes.some((l) => l.indexOf('\\left(x\\right)') !== -1));
  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
