const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Double-cliquer UNE parenthèse précise d'un ProductGroup non factorisé par l'action
// "Produit nul" (ex. "(x+2-3)" dans "(x+2-3)(x+2+3)") doit entrer ("driller") dans CETTE
// branche pour en sélectionner/simplifier les termes intérieurs, sans toucher à l'autre
// parenthèse — voir drillIntoProductBranch/pending.drilled.branch dans history.js.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2-3)(x+2+3)=0');
  await page.waitForTimeout(80);

  const leftBranchHandle = await page.$('.eq-row.current .side[data-side="left"] .term[data-index="0"] [data-branch="0"]');
  ok('left branch span found (data-branch attribute present)', !!leftBranchHandle);
  const box = await leftBranchHandle.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);

  const drilled = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('drilled into the LEFT branch specifically', drilled && drilled.branch === 0 && drilled.side === 'left');

  await page.screenshot({ path: `${SCRATCH}/product_branch_drilled.png` });

  // Select the two constant-like terms (2 and -3) inside this branch and simplify.
  await (await page.$('.eq-row.current .side[data-side="left"] [data-inner-index="1"]')).click();
  await page.waitForTimeout(50);
  await (await page.$('.eq-row.current .side[data-side="left"] [data-inner-index="2"]')).click();
  await page.waitForTimeout(50);

  const canSimplifyBtn = await page.evaluate(() => !document.querySelector('button[data-op="simplify"]').closest('.op-row').hidden);
  ok('"Simplifier" button enabled with 2 inner terms selected', canSimplifyBtn);

  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(120);

  const resultEq = await page.evaluate(() => window.App.History.lastEquation());
  const leftGroup = resultEq.left[0];
  ok('left branch simplified to x + (-1) (2 + (-3))', leftGroup.factors[0].terms.length === 2 && leftGroup.factors[0].terms[1].coeff === -1);
  ok('right branch untouched (still x+2+3)', leftGroup.factors[1].terms.length === 3);
  ok('drilled mode exited after confirming', (await page.evaluate(() => window.App.History.getPending().drilled)) === null);

  await page.screenshot({ path: `${SCRATCH}/product_branch_simplified.png` });

  // Regression: classic FactorGroup drilling (e.g. "3(x+7)") still works unaffected.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '3x+21=0');
  await page.waitForTimeout(80);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="3"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(120);
  const termHandle = await page.$('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  const tbox = await termHandle.boundingBox();
  await page.mouse.click(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
  await page.waitForTimeout(50);
  await page.mouse.click(tbox.x + tbox.width / 2, tbox.y + tbox.height / 2);
  await page.waitForTimeout(100);
  const factorDrilled = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('regression: classic FactorGroup drilling still works (no branch field)', factorDrilled && !factorDrilled.branch);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
