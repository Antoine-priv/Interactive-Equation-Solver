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

  // --- Test B : x^2-16 -> Identite 3 avec a=x, b=4 ---
  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2-16=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  // Les boutons de l'étape 1 n'ont plus de libellé texte "Identité N" (seule la formule
  // KaTeX compte, voir IDENTITY_INFO dans toolbar.js) : ciblés par data-factor-choice.
  const id3Enabled = await page.evaluate(() => {
    var b = document.querySelector('.factor-choice-btn[data-factor-choice="3"]');
    return b ? !b.disabled : null;
  });
  ok('Identity 3 enabled for x^2-16', id3Enabled === true);
  await page.click('.factor-choice-btn[data-factor-choice="3"]');
  // "a" (focalisé par défaut) reçoit directement "x" tapé ; puis on bascule sur "b" pour
  // taper "4" — plus de désignation séparée, l'app déduit qui porte le x du LaTeX tapé.
  await page.evaluate(() => { window.App.History.setIdentityFieldLatex('x'); });
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.evaluate(() => { window.App.History.setIdentityFieldLatex('4'); });
  let pending = await page.evaluate(() => window.App.History.getPending());
  console.log('apres a=x, b=4:', JSON.stringify({ idALatex: pending.idALatex, idBLatex: pending.idBLatex }));
  ok('a=x, b=4', pending.idALatex === 'x' && pending.idBLatex === '4');

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepB = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres identite 3 (a=x,b=4):', JSON.stringify(stepB.equation));
  const groupB = stepB.equation.left[0];
  ok('produces (x-4)(x+4)', groupB && groupB.factors.length === 2 &&
    JSON.stringify(groupB.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -4, pow: 0 }]) &&
    JSON.stringify(groupB.factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 4, pow: 0 }]));

  // --- Test C : facteur commun (chemin classique inchange) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.evaluate(() => {
    var btns = Array.from(document.querySelectorAll('.factor-choice-btn'));
    btns.find((el) => el.textContent.includes('Facteur commun')).click();
  });
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('factorMode becomes "common"', pending.factorMode === 'common');
  await page.click('[data-key="6"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepC = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres facteur commun 6:', JSON.stringify(stepC.equation));
  const groupC = stepC.equation.left[0];
  ok('common factor path unchanged: 6(x-2)', groupC && groupC.factor && groupC.factor.coeff === 6 &&
    JSON.stringify(groupC.innerTerms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }]));

  // --- Test D : identite choisie mais la selection ne correspond pas -> erreur claire ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="2"]'); // faux choix : c'est identite 1
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  // setIdentityFocus re-parente/refocus le <math-field> partagé (voir bindFactorKeypad
  // dans toolbar.js) : un waitForTimeout fixe s'est révélé flaky sous charge (suite
  // complète), on attend donc le signal DOM réel plutôt qu'une durée devinée (voir
  // tests/README.md).
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="3"]');
  await page.click('[data-key="enter"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('erreur si mauvaise identite choisie:', JSON.stringify(pending.error));
  ok('wrong identity choice surfaces a clear error on confirm', !!pending.error);

  // --- Test E : le bouton "retour" revient a l'etape 1 sans rien perdre de la selection ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  await page.click('.factor-back-btn');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('back button returns to step 1 (factorMode null)', pending.factorMode === null);
  ok('selection preserved after going back', pending.selectedLeft.length === 3);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
