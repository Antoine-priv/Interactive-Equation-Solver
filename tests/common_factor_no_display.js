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

  // Type "2" and check the live pill (the shared <math-field> itself, moved next to the
  // arrow, see bindLiveOpField in mathKeypad.js) already shows it, cursor included — no
  // more separate field elsewhere on screen duplicating the same value.
  await page.click('[data-key="2"]');
  await page.waitForTimeout(80);

  const displayStillGone = await page.$('.operand-display');
  ok('still no operand-display panel after typing a digit', displayStillGone === null);

  const pillInfo = await page.evaluate(() => {
    var pill = document.getElementById('liveOpPill');
    var field = pill && pill.querySelector('math-field');
    var prefix = pill && pill.querySelector('.arrow-label-live-prefix');
    return {
      visible: !!pill && !pill.hidden,
      onLeftOrRight: !!pill && (pill.classList.contains('arrow-label-left') || pill.classList.contains('arrow-label-right')),
      latex: window.App.MathKeypad.getLatex(),
      fieldIsFocused: field ? document.activeElement === field : false,
      prefixHidden: !prefix || prefix.hidden,
      prefixText: prefix ? prefix.textContent : null
    };
  });
  console.log('live pill while typing common factor "2":', JSON.stringify(pillInfo));
  ok('the live pill (shared math-field) is shown next to the arrow', pillInfo.visible && pillInfo.onLeftOrRight);
  ok('it shows exactly what was typed ("2")', pillInfo.latex === '2');
  ok('the field stays focused (real input, not a separate echo)', pillInfo.fieldIsFocused);
  ok('the "factoriser par" legend is shown BEFORE the live field, inside the same pill',
    !pillInfo.prefixHidden && /factoriser par/.test(pillInfo.prefixText));
  ok('no old-style "factoriser par 2" static pill duplicates it', !(await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label:not(#liveOpPill)')).some((el) => /factoriser/.test(el.textContent)))));

  await page.screenshot({ path: `${SCRATCH}/common_factor_no_display.png` });

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after facteur commun 2:', JSON.stringify(step.equation));
  ok('confirming still produces 2(x+3)=0', step.equation.left[0].factor.coeff === 2 &&
    JSON.stringify(step.equation.left[0].innerTerms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
