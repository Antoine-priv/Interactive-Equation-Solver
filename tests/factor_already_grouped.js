const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2(5x-7)-10(9+3x)=0');
  await page.waitForTimeout(100);

  const eq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('parsed:', JSON.stringify(eq));
  ok('parsed as two FactorGroup nodes', eq.left.length === 2 && eq.left.every(n => 'innerTerms' in n));

  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.waitForTimeout(80);

  const factorBtnEnabled = await page.evaluate(() => !document.querySelector('button[data-op="factor"]').closest('.op-row').hidden);
  ok('"Factoriser" button enabled', factorBtnEnabled);

  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="2"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const resultEq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres factorisation par 2:', JSON.stringify(resultEq));
  const g = resultEq.left[0];
  ok('outer factor is 2', g.factor && g.factor.coeff === 2 && g.sign === 1);
  ok('outer has 3 innerTerms: 5x, -7, and nested -5(9+3x)', g.innerTerms.length === 3);
  ok('first inner term is 5x (absorbed, no redundant 1(...) wrapper)', g.innerTerms[0].coeff === 5 && g.innerTerms[0].pow === 1);
  ok('second inner term is -7', g.innerTerms[1].coeff === -7 && g.innerTerms[1].pow === 0);
  const nested = g.innerTerms[2];
  ok('third inner term is a nested FactorGroup with factor -5', nested.factor && nested.factor.coeff === 5 && nested.sign === -1);
  ok('nested innerTerms are 9, 3x (unchanged)', JSON.stringify(nested.innerTerms) === JSON.stringify([{coeff:9,pow:0},{coeff:3,pow:1}]));

  await page.screenshot({ path: `${SCRATCH}/factor_already_grouped_result.png` });

  // Regression: plain-term common-factor still works.
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
  const plainResult = await page.evaluate(() => window.App.History.lastEquation());
  console.log('regression plain factor:', JSON.stringify(plainResult));
  ok('regression: plain-term common factor still gives 3(x+7)', plainResult.left[0].factor.coeff === 3 &&
    JSON.stringify(plainResult.left[0].innerTerms) === JSON.stringify([{coeff:1,pow:1},{coeff:7,pow:0}]));

  // Mixed selection (one plain term, one already-grouped) should NOT enable Factoriser.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2(5x-7)+3=0');
  await page.waitForTimeout(80);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.waitForTimeout(80);
  const mixedFactorEnabled = await page.evaluate(() => !document.querySelector('button[data-op="factor"]').closest('.op-row').hidden);
  ok('mixed selection (grouped + plain) does NOT enable Factoriser', mixedFactorEnabled === false);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
