const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Simplifier" directement sur un groupe sélectionné (voir Expr.simplifySelection) : les
// termes semblables À L'INTÉRIEUR des parenthèses se simplifient sans avoir à y "entrer"
// (drill) puis sélectionner chaque terme — la simplification par drill reste disponible.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function start(eq) {
    await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, eq);
    await page.waitForTimeout(100);
  }
  const canSimplify = () => page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canSimplify);
  const lastLeft = () => page.evaluate(() => JSON.stringify(window.App.History.lastEquation().left));
  const steps = () => page.evaluate(() => window.App.History.getSteps().length);
  async function select(side, index) {
    await page.evaluate(([s, i]) => window.App.History.toggleTermSelection(s, i), [side, index]);
    await page.waitForTimeout(400); // au-delà de la fenêtre du double-clic
  }

  // 1) FactorGroup : 3(x+2-5+4x) -> 3(5x-3), en une étape.
  await start('3(x+2-5+4x)=12');
  await select('left', 0);
  ok('FactorGroup with like terms: Simplifier enabled', await canSimplify());
  await page.hover('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  const prev = await page.evaluate(() => JSON.stringify(window.App.History.computePreview('simplify').equation.left));
  await page.screenshot({ path: SCRATCH + '/simplify_inside_group_hover.png' });
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  const expected1 = JSON.stringify([{ sign: 1, factor: { coeff: 3, pow: 0 }, innerTerms: [{ coeff: 5, pow: 1 }, { coeff: -3, pow: 0 }] }]);
  ok('FactorGroup inside simplified', await lastLeft() === expected1);
  ok('hover preview matched the result', prev === expected1);
  ok('one step added', await steps() === 2);
  const desc = await page.evaluate(() => window.App.History.getSteps()[1].opLeft);
  ok('step labelled as simplify', desc && desc.type === 'simplify');

  // 2) Déjà simplifié : Simplifier reste indisponible, Développer toujours disponible.
  await start('3(x+2)=12');
  await select('left', 0);
  ok('already simplified group: Simplifier disabled', !(await canSimplify()));
  ok('Développer still available', await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  // 3) ProductGroup entier : chaque facteur simplifié.
  await start('(x+2-5)(2x+x+1)=0');
  await select('left', 0);
  ok('ProductGroup: Simplifier enabled', await canSimplify());
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('every factor simplified', await lastLeft() === JSON.stringify([{ sign: 1, factors: [
    { terms: [{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }], exponent: 1 },
    { terms: [{ coeff: 3, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 }] }]));

  // 4) Un seul facteur d'un produit sélectionné : seul celui-là est simplifié.
  await start('(x+2-5)(2x+x+1)=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  await page.waitForTimeout(400);
  ok('single factor: Simplifier enabled', await canSimplify());
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('only the selected factor simplified', await lastLeft() === JSON.stringify([{ sign: 1, factors: [
    { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }, { coeff: -5, pow: 0 }], exponent: 1 },
    { terms: [{ coeff: 3, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 }] }]));

  // 5) Mélange groupe + termes simples, et l'autre membre, en une seule étape.
  await start('2x+3(x+1+1)+4x=5+2');
  await select('left', 0);
  await select('left', 1);
  await select('left', 2);
  await select('right', 0);
  await select('right', 1);
  ok('mixed selection: Simplifier enabled', await canSimplify());
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  const eq5 = await page.evaluate(() => JSON.stringify(window.App.History.lastEquation()));
  ok('flat terms merged, group simplified inside, right side merged', eq5 === JSON.stringify({
    left: [{ coeff: 6, pow: 1 }, { sign: 1, factor: { coeff: 3, pow: 0 }, innerTerms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }] }],
    right: [{ coeff: 7, pow: 0 }] }));

  // 6) La simplification par drill fonctionne toujours.
  await start('3(x+2-5)=12');
  await page.evaluate(() => { window.App.History.drillIntoGroup('left', 0); });
  await page.evaluate(() => { window.App.History.toggleInnerSelection(1); window.App.History.toggleInnerSelection(2); });
  ok('drilled selection: Simplifier enabled', await canSimplify());
  await page.evaluate(() => window.App.History.confirmSimplifySelection());
  await page.waitForTimeout(150);
  ok('drilled simplify still works', await lastLeft() === JSON.stringify([{ sign: 1, factor: { coeff: 3, pow: 0 }, innerTerms: [{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }] }]));

  // 7) Deux groupes opposés sélectionnés s'annulent.
  await start('2(x+1)-2(x+1)=3');
  await select('left', 0);
  await select('left', 1);
  ok('opposite groups: Simplifier enabled', await canSimplify());
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('opposite groups cancel to 0', await lastLeft() === JSON.stringify([{ coeff: 0, pow: 0 }]));

  // 8) Un seul terme entre les parenthèses d'un facteur numérique : Simplifier fait le calcul
  // jusqu'au bout (T6 : "(11+4)/5" donnait "15/5", qui restait bloqué sans Développer).
  await start('5x=11+4');
  await page.evaluate(() => { var H = window.App.History; H.selectOp('expr'); H.setExprChainText('\\div5'); H.confirm(); });
  ok('(11+4)/5 is a quotient group', await page.evaluate(() => window.App.Expr.isFactorGroup(window.App.History.lastEquation().right[0])));
  await select('right', 0);
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('(11+4)/5 simplifies to 3', await page.evaluate(() => JSON.stringify(window.App.History.lastEquation().right)) ===
    JSON.stringify([{ coeff: 3, pow: 0 }]));
  await start('3(11+4)=x');
  await select('left', 0);
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('3(11+4) simplifies to 45', await lastLeft() === JSON.stringify([{ coeff: 45, pow: 0 }]));
  await start('2(3x)=x+1');
  await select('left', 0);
  ok('2(3x): Simplifier enabled', await canSimplify());
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  ok('2(3x) simplifies to 6x', await lastLeft() === JSON.stringify([{ coeff: 6, pow: 1 }]));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
