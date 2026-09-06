const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Couvre les derniers points de vérification manuelle de la migration Phase C
// (js/toolbar.js/bindFactorKeypad, js/mathKeypad.js/opts.onTab) : factoriser par "x" nu,
// Tab physique pour basculer entre "a"/"b", et édition native (retour arrière/flèches)
// dans les deux champs — aucun de ces trois points n'était couvert par les autres tests
// migrés de cette phase.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // --- 1) Facteur commun "x" nu (pas juste un nombre) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '3x^2+6x=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="common"]');
  await page.click('[data-key="x"]');
  await page.waitForTimeout(60);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepX = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres facteur commun "x":', JSON.stringify(stepX.equation));
  ok('factoring by bare "x" gives x(3x+6)=0', stepX.equation.left[0].factor.coeff === 1 && stepX.equation.left[0].factor.pow === 1 &&
    JSON.stringify(stepX.equation.left[0].innerTerms) === JSON.stringify([{ coeff: 3, pow: 1 }, { coeff: 6, pow: 0 }]));

  // --- 2) Retour arrière natif dans le facteur commun (édité par le clavier physique) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('26');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(60);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('native backspace edits the common-factor field ("26"->backspace->"2")', pending.factorLatex === '2');

  // --- 3) Tab physique bascule le focus a<->b dans le pave identite ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  await page.waitForTimeout(150);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('focus starts on "a"', pending.idFocus === 'a');
  await page.keyboard.type('x');
  await page.waitForTimeout(150);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(150);
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('apres Tab:', JSON.stringify({ idFocus: pending.idFocus, idALatex: pending.idALatex }));
  ok('physical Tab switches focus from "a" to "b"', pending.idFocus === 'b');
  ok('"a" kept its typed value ("x") across the Tab switch', pending.idALatex === 'x');

  // --- 4) Edition native (fleches + retour arriere) dans le champ "b" maintenant focalise ---
  // Cible : b=3 (pour (x+3)^2, x^2+6x+9) — tape "13", place le curseur entre "1" et "3",
  // puis efface le "1" pour ne garder que "3".
  await page.keyboard.type('13');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Backspace'); // efface le "1", laisse "3"
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('apres edition native de b:', JSON.stringify(pending.idBLatex));
  ok('native arrow+backspace editing works in "b" ("13"->left,backspace->"3")', pending.idBLatex === '3');

  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const stepTab = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres Tab + edition native (a=x,b=3):', JSON.stringify(stepTab.equation));
  ok('confirms correctly to (x+3)^2', stepTab.equation.left[0].factors.length === 1 && stepTab.equation.left[0].factors[0].exponent === 2 &&
    JSON.stringify(stepTab.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
