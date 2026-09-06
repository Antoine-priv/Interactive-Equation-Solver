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

  const groupSel = '.eq-row.current .side[data-side="left"] [data-index="0"]';
  const innerSel0 = '.eq-row.current .side[data-side="left"] [data-inner-index="0"]';
  const innerSel1 = '.eq-row.current .side[data-side="left"] [data-inner-index="1"]';
  const rightSel0 = '.eq-row.current .side[data-side="right"] [data-index="0"]';
  const rightSel1 = '.eq-row.current .side[data-side="right"] [data-index="1"]';

  // "2x+2x+6=3x+5x" -> factoriser "2x+2x" (indices 0,1) par 2 -> "2(x+x)+6=3x+5x".
  // L'interieur du groupe a 2 termes de meme degre (x et x, simplifiables), et le membre
  // droit garde 2 termes (3x et 5x, aussi simplifiables) : cas ideal pour tester la
  // simplification simultanee membre-droit + interieur-de-groupe-a-gauche.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+2x+6=3x+5x');
  // Factoriser "2x+2x" (indices 0,1) par 2 -> "2(x+x)+6=3x+5x"
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.click('[data-key="2"]');
  await page.click('.op-confirm-btn');
  await page.waitForSelector(groupSel);
  const eqAfterFactor = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation);
  console.log('equation apres factorisation:', JSON.stringify(eqAfterFactor));

  await page.dblclick(groupSel);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the (x+x) group', !!pending.drilled && pending.drilled.side === 'left');

  // Selectionne les 2 termes interieurs (x et x, meme degre -> simplifiable).
  await page.click(innerSel0);
  await page.click(innerSel1);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('both inner terms selected', pending.selectedInner.length === 2);

  // Selectionne AUSSI les 2 termes du membre droit (3x et 5x) -- l'AUTRE membre, pendant
  // qu'on est toujours "entre" dans le groupe a gauche.
  await page.click(rightSel0);
  await page.click(rightSel1);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('right side also selected while still drilled on the left', pending.selectedRight.length === 2 && !!pending.drilled);

  const canSimplify = await page.evaluate(() => {
    var eq = window.App.History.getSteps().slice(-1)[0].equation;
    var pending = window.App.History.getPending();
    return window.App.Toolbar.computeSelectionInfo(eq, pending).canSimplify;
  });
  ok('Simplifier becomes enabled for the combined selection', canSimplify === true);

  await page.screenshot({ path: `${SCRATCH}/cross1_both_selected.png` });

  // Simplifie : doit simplifier l'interieur du groupe (x+x -> 2x) ET le membre droit
  // (3x+5x -> 8x) dans la MEME etape.
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);
  const finalStep = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres simplification combinee:', JSON.stringify(finalStep.equation));
  console.log('opLeft/opRight:', JSON.stringify(finalStep.opLeft), JSON.stringify(finalStep.opRight));

  const leftGroupSimplified = finalStep.equation.left[0] &&
    JSON.stringify(finalStep.equation.left[0].innerTerms) === JSON.stringify([{ coeff: 2, pow: 1 }]);
  ok('left group interior simplified (x+x -> 2x)', leftGroupSimplified);
  const rightSimplified = JSON.stringify(finalStep.equation.right) === JSON.stringify([{ coeff: 8, pow: 1 }]);
  ok('right side simplified (3x+5x -> 8x) in the SAME step', rightSimplified);
  ok('both opLeft and opRight are set (single combined step)', !!finalStep.opLeft && !!finalStep.opRight);

  await page.screenshot({ path: `${SCRATCH}/cross2_after_simplify.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
