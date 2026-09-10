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
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x-2)^2-(x+6)^2=0');
  await page.waitForTimeout(100);

  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.waitForTimeout(80);

  const shape = await page.evaluate(() => window.App.History.getFactorTargetShape());
  console.log('shape:', JSON.stringify(shape));
  ok('shape detects two opposite-sign squares', shape && !!shape.groupBaseA && !!shape.groupBaseB);

  const factorBtnEnabled = await page.evaluate(() => !document.querySelector('button[data-op="factor"]').closest('.op-row').hidden);
  ok('"Factoriser" button enabled', factorBtnEnabled);

  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button[data-factor-choice="3"]');
  await page.waitForTimeout(80);

  let pend = await page.evaluate(() => window.App.History.getPending());
  console.log('pending after choosing identity 3:', JSON.stringify({ idGroupBase: pend.idGroupBase, idGroupBaseB: pend.idGroupBaseB, idFocus: pend.idFocus }));
  ok('idGroupBase (a) set to x-2', Array.isArray(pend.idGroupBase));
  ok('idGroupBaseB (b) set to x+6', Array.isArray(pend.idGroupBaseB));
  ok('focus starts on a', pend.idFocus === 'a');
  ok('"a" (focused/live) starts empty', pend.idALatex === '');

  // Le label "b =" et la valeur sont désormais deux éléments séparés (voir
  // buildIdentityKeypad dans toolbar.js — le label reste visible même une fois le champ
  // "a" focalisé/live) : on lit la boîte entière plutôt que juste .identity-ab-static.
  const bFieldText0 = await page.evaluate(() => {
    var el = document.querySelector('.identity-ab-static');
    return el ? el.closest('.identity-ab-field').textContent.trim() : null;
  });
  // Le label "b=" est désormais rendu via KaTeX (voir buildIdentityKeypad dans
  // toolbar.js) : sa police interne le duplique en plusieurs copies internes (accessibilité
  // + rendu visuel), d'où un indexOf tolérant plutôt qu'une égalité exacte.
  ok('"b" (non-focused) field placeholder', !!bFieldText0 && bFieldText0.indexOf('b=') !== -1 && bFieldText0.indexOf('…') !== -1);

  // Type a = x-2
  await page.click('[data-key="x"]');
  await page.click('[data-key="minus"]');
  await page.click('[data-key="2"]');
  await page.waitForTimeout(60);
  pend = await page.evaluate(() => window.App.History.getPending());
  ok('idALatex is "x-2"', pend.idALatex === 'x-2');

  // Switch to b, type x+6
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="x"]');
  await page.click('[data-key="plus"]');
  await page.click('[data-key="6"]');
  await page.waitForTimeout(60);
  pend = await page.evaluate(() => window.App.History.getPending());
  ok('idBLatex is "x+6"', pend.idBLatex === 'x+6');

  await page.screenshot({ path: `${SCRATCH}/diff_two_squares_typed.png` });

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const resultEq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres factorisation:', JSON.stringify(resultEq));
  // Expect (x-2-(x+6))(x-2+(x+6)) = 0, i.e. left = [x,-2,-x,-6], right = [x,-2,x,6]
  const g = resultEq.left[0];
  ok('left side is x-2 then -(x+6) terms', JSON.stringify(g.factors[0].terms) === JSON.stringify([{coeff:1,pow:1},{coeff:-2,pow:0},{coeff:-1,pow:1},{coeff:-6,pow:0}]));
  ok('right side is x-2 then (x+6) terms', JSON.stringify(g.factors[1].terms) === JSON.stringify([{coeff:1,pow:1},{coeff:-2,pow:0},{coeff:1,pow:1},{coeff:6,pow:0}]));

  await page.screenshot({ path: `${SCRATCH}/diff_two_squares_result.png` });

  // Wrong "a"/"b" rejected
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x-2)^2-(x+6)^2=0');
  await page.waitForTimeout(80);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button[data-factor-choice="3"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="x"]');
  await page.click('[data-key="minus"]');
  await page.click('[data-key="2"]');
  // Attendre que idALatex ait bien reçu "x-2" avant de basculer le focus : l'évènement
  // "input" de MathLive est asynchrone, et un rebuild trop tôt reparente le champ vers
  // "b" avec un idALatex encore périmé (source de flakiness sous charge).
  await page.waitForFunction(() => window.App.History.getPending().idALatex === 'x-2');
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="x"]');
  await page.click('[data-key="plus"]');
  await page.click('[data-key="9"]'); // wrong: 9 instead of 6
  await page.waitForTimeout(60);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(120);
  const afterWrong = await page.evaluate(() => ({ error: window.App.History.getPending().error, steps: window.App.History.getSteps().length }));
  console.log('apres b errone:', JSON.stringify(afterWrong));
  ok('wrong b rejected, no step added', afterWrong.error && afterWrong.steps === 1);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
