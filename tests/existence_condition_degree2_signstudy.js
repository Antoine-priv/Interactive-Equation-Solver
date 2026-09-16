const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Étude de signe" (Phase 3 du plan "Condition d'existence") : une fois un radicand
// degré 2 ramené par "Factoriser" à "(x-3)(x+3)≥0" (voir generateVariableRadicandQuadraticEquation
// dans generator.js), l'élève doit d'abord donner le signe du coefficient dominant du
// produit, PUIS choisir le bon ensemble solution parmi 2 intervalles — voir
// detectSignStudyProduct/chooseSignStudySign/chooseSignStudyInterval dans history.js et
// App.Ineq.signStudyChoice/intervalLatex dans inequality.js.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 2 }, { coeff: -9, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the degree-2 radicand', pending.drilled && pending.drilled.part === 'sqrt');

  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(120);
  const conditionsCount = await page.evaluate(() => window.App.History.getDomainConditions().length);
  const firstStepLeft = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSteps()[0].equation.left);
  ok('domain column spawned on "x²-9 \\geq 0"', conditionsCount === 1 &&
    JSON.stringify(firstStepLeft) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: -9, pow: 0 }]));

  // Focus the column, then factor "x²-9" via the standard identity-3 flow (a=x, b=3 —
  // same order as tests/identity_order.js's regression case, giving a clean sign=+1).
  await page.evaluate(() => {
    window.App.History.setFocusedDomain(0);
    var H = window.App.History;
    H.toggleTermSelection('left', 0);
    H.toggleTermSelection('left', 1);
    H.enterFactorWithSelection();
    H.chooseFactorMode(3);
    H.setIdentityFieldLatex('x');
    H.setIdentityFocus('b');
    H.setIdentityFieldLatex('3');
    H.confirm();
  });
  await page.waitForTimeout(120);
  const factoredEq = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.lastEquation());
  console.log('factored:', JSON.stringify(factoredEq));
  ok('column reached "(x-3)(x+3) \\geq 0"', JSON.stringify(factoredEq.left[0]) === JSON.stringify({
    sign: 1,
    factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }], exponent: 1 }, { terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 1 }]
  }));

  ok('"Étude de signe" is now enabled', await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canSignStudy));
  const info = await page.evaluate(() => window.App.History.signStudyInfo());
  console.log('signStudyInfo:', JSON.stringify(info));
  ok('roots/leading sign correctly detected (-3, 3, "+")',
    info.root1 === -3 && info.root2 === 3 && info.leadingSign === '+');

  // Engage the mode through the real button, then answer via the API (same convention
  // as other tests here) — wrong sign first (must NOT advance), then the right one.
  await page.click('button[data-op="signstudy"]');
  await page.waitForTimeout(100);
  ok('"signstudy" mode is engaged', (await page.evaluate(() => window.App.History.getPending().opType)) === 'signstudy');

  await page.evaluate(() => window.App.History.chooseSignStudySign('-'));
  await page.waitForTimeout(60);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('a wrong sign choice sets an error and does NOT advance', !!pending.error && pending.signStudySignConfirmed === false);

  await page.evaluate(() => window.App.History.chooseSignStudySign('+'));
  await page.waitForTimeout(60);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('the correct sign choice advances to the interval step', pending.signStudySignConfirmed === true && pending.error === null);

  // Wrong interval choice first ("between" — the correct one for "\geq" + opens-up is
  // "outside") must NOT resolve anything.
  await page.evaluate(() => window.App.History.chooseSignStudyInterval('between'));
  await page.waitForTimeout(60);
  pending = await page.evaluate(() => window.App.History.getPending());
  const resultAfterWrong = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSignStudyResult());
  ok('a wrong interval choice sets an error and resolves nothing', !!pending.error && resultAfterWrong === null);

  await page.evaluate(() => window.App.History.chooseSignStudyInterval('outside'));
  await page.waitForTimeout(120);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('the correct interval choice exits the mode (opType back to null)', pending.opType === null);

  const finalResult = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.getSignStudyResult());
  console.log('signStudyResult:', finalResult);
  ok('the stored result is "]-\\infty;-3]\\cup[3;+\\infty[" (outside, inclusive brackets)',
    finalResult === '\\left]-\\infty;-3\\right]\\cup\\left[3;+\\infty\\right[');

  await page.waitForTimeout(150);
  const resultElHtml = await page.evaluate(() => {
    var el = document.querySelector('.domain-branch[data-domain-index="0"] .domain-signstudy-result');
    return el ? el.innerHTML : null;
  });
  ok('the interval result is actually rendered in the domain column', !!resultElHtml);
  await page.screenshot({ path: `${SCRATCH}/existence_condition_degree2_signstudy.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
