// Inéquation : pas de ×/÷ par une expression en x — la touche "x" du pavé est grisée
// pendant la saisie de l'opérande d'un ×/÷, et la chaîne est refusée à la validation.
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
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const start = (latex) => page.evaluate((lx) => {
    var eq = window.App.Parser.parseLatexEquation(lx);
    window.App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
    window.App.History.selectOp('expr');
  }, latex);
  const xDisabledAfter = async (chain) => {
    await page.evaluate((c) => window.App.History.setExprChainText(c), chain);
    await page.waitForTimeout(60);
    return page.evaluate(() => document.querySelector('.key-btn[data-key="x"]').disabled);
  };

  await start('2x+1<5');
  ok('inequality: x enabled on an empty chain', !(await xDisabledAfter('')));
  ok('inequality: x greyed after ×', await xDisabledAfter('\\times '));
  ok('inequality: x greyed after ÷(-', await xDisabledAfter('\\div(-'));
  ok('inequality: x greyed after ×-', await xDisabledAfter('+3\\times -'));
  ok('inequality: x enabled again after +', !(await xDisabledAfter('\\times 2+')));
  ok('inequality: x enabled after -', !(await xDisabledAfter('-')));

  await page.evaluate(() => { var h = window.App.History; h.setExprChainText('\\times x'); h.confirm(); });
  await page.waitForTimeout(60);
  const res = await page.evaluate(() => ({ err: window.App.History.getPending().error, n: window.App.History.getSteps().length }));
  ok('inequality: ×x is refused with an error, no step added', !!res.err && res.n === 1);

  await start('2x+1=5');
  ok('equation: x stays enabled after ×', !(await xDisabledAfter('\\times ')));

  // La touche ne reste pas grisée dans la modale "Nouvelle équation".
  await start('2x+1<5');
  await xDisabledAfter('\\times ');
  await page.click('#newEquationBtn').catch(() => {});
  await page.waitForTimeout(300);
  ok('new-equation modal: x enabled', await page.evaluate(() => !document.querySelector('.key-btn[data-key="x"]').disabled));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
