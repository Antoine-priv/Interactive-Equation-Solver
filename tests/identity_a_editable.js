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
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)^2-25=0');
  await page.waitForTimeout(100);

  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.waitForTimeout(80);
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button[data-factor-choice="3"]');
  await page.waitForTimeout(80);

  let pend = await page.evaluate(() => window.App.History.getPending());
  console.log('idFocus initial:', pend.idFocus, 'idGroupBase:', JSON.stringify(pend.idGroupBase));
  ok('focus starts on "a" (must type it)', pend.idFocus === 'a');
  ok('"a" is empty before typing', pend.idALatex === '');

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
  ok('"b" (non-focused) field shows placeholder "b=…" before typing', !!bFieldText0 && bFieldText0.indexOf('b=') !== -1 && bFieldText0.indexOf('…') !== -1);

  // Type "x" then "+" then "2" for a (deja focalisee, pas besoin de cliquer dessus).
  await page.click('[data-key="x"]');
  await page.waitForTimeout(60);
  pend = await page.evaluate(() => window.App.History.getPending());
  console.log('idALatex after "x":', JSON.stringify(pend.idALatex));
  ok('typing x appends to idALatex', pend.idALatex === 'x');

  await page.click('[data-key="plus"]');
  await page.waitForTimeout(60);
  await page.click('[data-key="2"]');
  await page.waitForTimeout(60);
  pend = await page.evaluate(() => window.App.History.getPending());
  console.log('idALatex after "x+2":', JSON.stringify(pend.idALatex));
  ok('idALatex is now "x+2"', pend.idALatex === 'x+2');

  // Switch focus to "b" and type 5.
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  // Un waitForTimeout fixe est flaky sous charge (suite complète) : on attend le signal
  // DOM réel (math-field re-parenté dans la boîte "b" + focus effectif) au lieu d'une
  // durée devinée (voir tests/README.md).
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="5"]');
  await page.waitForTimeout(80);

  const confirmBtnEnabled = await page.evaluate(() => !document.querySelector('[data-key="enter"]').disabled);
  console.log('confirm enabled with a=x+2,b=5:', confirmBtnEnabled);

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const resultEq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres factorisation (a=x+2 tape, b=5):', JSON.stringify(resultEq));
  ok('result is (x+2-5)(x+2+5)=0', resultEq.left[0].factors[0].terms.length === 3 && resultEq.left[0].factors[0].terms[2].coeff === -5 &&
    resultEq.left[0].factors[1].terms[2].coeff === 5);

  await page.screenshot({ path: `${SCRATCH}/identity_a_editable.png` });

  // Test wrong "a" gets rejected with an error.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)^2-25=0');
  await page.waitForTimeout(100);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.waitForTimeout(80);
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button[data-factor-choice="3"]');
  await page.waitForTimeout(80);
  // Type wrong "a" = "x+3"
  await page.click('[data-key="x"]');
  await page.click('[data-key="plus"]');
  await page.click('[data-key="3"]');
  // Attendre que idALatex ait bien reçu "x+3" avant de basculer le focus : l'évènement
  // "input" de MathLive est asynchrone, et un rebuild trop tôt reparente le champ vers
  // "b" avec un idALatex encore périmé (source de flakiness sous charge).
  await page.waitForFunction(() => window.App.History.getPending().idALatex === 'x+3');
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="5"]');
  await page.waitForTimeout(60);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const afterWrongA = await page.evaluate(() => ({
    error: window.App.History.getPending().error,
    stepsCount: window.App.History.getSteps().length
  }));
  console.log('etat apres a errone (x+3 au lieu de x+2):', JSON.stringify(afterWrongA));
  ok('wrong "a" is rejected with an error, no step added', afterWrongA.error && afterWrongA.stepsCount === 1);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
