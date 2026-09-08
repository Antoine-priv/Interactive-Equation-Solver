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

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+6=0');

  // Select both terms on the left, then Factoriser -> Facteur commun.
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(80);

  const displayGone = await page.$('.operand-display');
  ok('no "facteur commun : ..." panel is rendered in the common-factor keypad', displayGone === null);

  // Type "2" and check the live arrow label already shows "factoriser par 2".
  await page.click('[data-key="2"]');
  await page.waitForTimeout(80);

  const displayStillGone = await page.$('.operand-display');
  ok('still no operand-display panel after typing a digit', displayStillGone === null);

  // Le pavé (voir js/mathKeypad.js) affiche déjà "2" EN DIRECT avec le curseur : pas
  // besoin d'une étiquette statique redondante à côté de la flèche pendant la saisie
  // (voir renderChain/liveFieldActive dans render.js) — elle ne réapparaît qu'une fois
  // confirmé, ci-dessous.
  const label = await page.evaluate(() => {
    var el = document.querySelector('.arrow-label annotation');
    return el ? el.textContent : null;
  });
  console.log('live label while typing common factor "2":', JSON.stringify(label));
  ok('no redundant live arrow label while typing (already shown in the keypad field)', label === null);

  await page.screenshot({ path: `${SCRATCH}/common_factor_no_display.png` });

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after facteur commun 2:', JSON.stringify(step.equation));
  ok('confirming still produces 2(x+3)=0', step.equation.left[0].factor.coeff === 2 &&
    JSON.stringify(step.equation.left[0].innerTerms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));

  const confirmedLabel = await page.evaluate(() => {
    var el = document.querySelector('.arrow-label annotation');
    return el ? el.textContent : null;
  });
  console.log('label once confirmed:', JSON.stringify(confirmedLabel));
  ok('confirmed step still shows "factoriser par 2" on its arrow',
    confirmedLabel && /factoriser/.test(confirmedLabel) && /2/.test(confirmedLabel));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
