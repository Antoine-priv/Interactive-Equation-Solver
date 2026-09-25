const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  // 'x=5' est déjà résolue : la fenêtre d'action est masquée dessus (voir positionPanel
  // dans toolbar.js), donc pas de bouton "Opération" à cliquer — on entre en mode 'expr'
  // via l'API directement.
  await page.evaluate(() => { window.App.History.selectOp('expr'); });
  await page.waitForTimeout(80);

  // Le bouton "(x+_)" ne doit plus exister ; "(" et ")" du champ mathématique unifié
  // suffisent désormais (voir mathKeypad.js).
  const oldToggleGone = await page.$('.keys .key-btn:text-is("(x+_)")');
  ok('old (x+_) button is gone', oldToggleGone === null);
  const openParenBtn = await page.$('[data-key="("]');
  const closeParenBtn = await page.$('[data-key=")"]');
  ok('( key exists in the unified keypad', openParenBtn !== null);
  ok(') key exists in the unified keypad', closeParenBtn !== null);

  await page.evaluate(() => { window.App.History.setExprChainText('\\times(5+x+3)'); });
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);

  const lastStep = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×(5+x+3):', JSON.stringify(lastStep.equation));
  const leftIsProduct = lastStep.equation.left.length === 1 &&
    Array.isArray(lastStep.equation.left[0].factors) && lastStep.equation.left[0].factors.length === 2;
  ok('left side becomes a ProductGroup', leftIsProduct);
  if (leftIsProduct) {
    ok('multiplier terms parsed as [5, x, 3]', JSON.stringify(lastStep.equation.left[0].factors[1].terms) ===
      JSON.stringify([{ coeff: 5, pow: 0 }, { coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));
  }

  await page.screenshot({ path: `${SCRATCH}/paren3_after_confirm.png` });

  // Un membre réduit à un nombre négatif multiplié par une expression : le signe remonte
  // sur le produit, pour afficher "-4(x-1)" et non "(-4)(x-1)".
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseLatexEquation('\\frac{8}{x-1}=-4'));
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times(x-1)');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  const negStep = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×(x-1):', JSON.stringify(negStep.equation));
  ok('left side cancels to 8', JSON.stringify(negStep.equation.left) === JSON.stringify([{ coeff: 8, pow: 0 }]));
  ok('right side is -4(x-1): sign pulled out of the leading factor',
    JSON.stringify(negStep.equation.right) === JSON.stringify([{ sign: -1, factors: [
      { terms: [{ coeff: 4, pow: 0 }], exponent: 1 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: -1, pow: 0 }], exponent: 1 }] }]));
  const negLatex = await page.evaluate(() => window.App.Expr.nodeLatex(
    window.App.History.getSteps().slice(-1)[0].equation.right[0], true));
  ok('renders as -4(x-1), no parenthesized (-4)', /^-4\\left\(/.test(negLatex));

  // Membre "-1" : le 1 disparaît, "-(x-1)" et non "-1(x-1)".
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseLatexEquation('\\frac{8}{x-1}=-1'));
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times(x-1)');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  const m1Right = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation.right);
  console.log('membre droit apres -1×(x-1):', JSON.stringify(m1Right));
  const m1Latex = await page.evaluate((n) => window.App.Expr.nodeLatex(n, true), m1Right[0]);
  ok('-1 × (x-1) renders as -(x-1)', m1Right.length === 1 && /^-\\left\(/.test(m1Latex));
  const m1Expanded = await page.evaluate((side) => window.App.Expr.expandFactorGroup(side, 0, [0, 1]), m1Right);
  ok('-(x-1) expands to -x+1', JSON.stringify(m1Expanded) === JSON.stringify([{ coeff: -1, pow: 1 }, { coeff: 1, pow: 0 }]));
  const m1Dom = await page.evaluate(() => {
    const rows = document.querySelectorAll('.katex');
    return rows.length ? rows[rows.length - 1].textContent : '';
  });
  ok('no "1(" shown in the rendered row', m1Dom.indexOf('1(') === -1);
  await page.screenshot({ path: `${SCRATCH}/mult_paren_minus_one.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
