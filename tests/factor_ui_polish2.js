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

  // --- Test 1 : Factoriser cliquable des 2 termes (pas 1) ---
  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12+3=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  const disabledWith1 = await page.evaluate(() => document.querySelector('#opButtons button[data-op="factor"]').closest('.op-row').hidden);
  ok('Factoriser disabled with only 1 term selected', disabledWith1 === true);
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  const disabledWith2 = await page.evaluate(() => document.querySelector('#opButtons button[data-op="factor"]').closest('.op-row').hidden);
  ok('Factoriser enabled with 2 terms selected', disabledWith2 === false);

  // --- Test 2 : plusieurs boutons d'identite restent grises independamment ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  // 6x-12 = 2 termes, x^2/x/const shape ne correspond a AUCUNE identite (pas de terme en x^2) -> 1,2,3 echouent tous.
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  let failed = await page.evaluate(() => window.App.History.getPending().factorChoiceFailed);
  console.log('apres clic identite 1:', JSON.stringify(failed));
  ok('identity 1 fails and is recorded', failed.indexOf(1) !== -1);

  await page.click('.factor-choice-btn[data-factor-choice="2"]');
  failed = await page.evaluate(() => window.App.History.getPending().factorChoiceFailed);
  console.log('apres clic identite 2:', JSON.stringify(failed));
  ok('identity 2 ALSO fails and is recorded, without removing identity 1', failed.indexOf(1) !== -1 && failed.indexOf(2) !== -1);

  const grayed1 = await page.evaluate(() => document.querySelector('.factor-choice-btn[data-factor-choice="1"]').classList.contains('factor-choice-failed'));
  const grayed2 = await page.evaluate(() => document.querySelector('.factor-choice-btn[data-factor-choice="2"]').classList.contains('factor-choice-failed'));
  ok('button 1 STILL grayed after clicking button 2', grayed1 === true);
  ok('button 2 is grayed too', grayed2 === true);
  await page.screenshot({ path: `${SCRATCH}/multi_grayed.png` });

  // --- Test 3 : boutons Valider integres a la grille (pas de rangee separee) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  const exprConfirmInGrid = await page.evaluate(() => {
    var cell = document.querySelector('#mathKeypadPanel .panel-confirm-cell');
    return cell ? cell.closest('.math-keypad-keys') !== null : false;
  });
  ok('Operation Valider is a grid cell (not a separate row below)', exprConfirmInGrid === true);
  // Le pavé "Opération" utilise désormais la touche "↵" (icône) du clavier mathématique
  // unifié, pas le mot "Valider"/une coche texte — voir mathKeypad.js.
  const exprConfirmHasIcon = await page.evaluate(() => !!document.querySelector('#mathKeypadPanel .panel-confirm-cell svg'));
  ok('Operation Valider is the "↵" icon key, not a text button', exprConfirmHasIcon === true);

  // Depuis le passage au clavier mathématique unifié (voir mathKeypad.js), le pavé
  // "Factoriser" (facteur commun ET identité) n'a plus SON PROPRE bouton "Valider" dans
  // #controlPanel : il n'y a plus qu'UNE seule touche de validation dans toute l'appli, la
  // "↵" du pavé ancré (déjà vérifiée pour "Opération" ci-dessus) — voir bindFactorKeypad
  // dans toolbar.js.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="common"]');
  const commonPanelHasNoOwnConfirm = await page.evaluate(() => !document.querySelector('#controlPanel .panel-confirm-cell'));
  ok('common-factor panel has no own Valider cell anymore', commonPanelHasNoOwnConfirm === true);
  await page.click('[data-key="6"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepFactor = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('docked "↵" key confirms the common-factor step correctly', stepFactor.equation.left[0].factor.coeff === 6);
  await page.screenshot({ path: `${SCRATCH}/common_confirm_cell.png` });

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  const idPanelHasNoOwnConfirm = await page.evaluate(() => !document.querySelector('#controlPanel .panel-confirm-cell'));
  ok('identity panel has no own Valider cell anymore', idPanelHasNoOwnConfirm === true);
  await page.click('[data-key="x"]');
  // MathLive traite la frappe et remonte l'évènement "input" (-> setIdentityFieldLatex)
  // de façon asynchrone : si on bascule le focus vers "b" avant que idALatex n'ait
  // effectivement reçu "x", le rebuild de #controlPanel re-parente le champ avec un
  // idALatex encore vide et le "x" tapé est perdu (source de flakiness sous charge).
  await page.waitForFunction(() => window.App.History.getPending().idALatex === 'x');
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  // setIdentityFocus déclenche un rebuild de #controlPanel + un re-parentage/refocus du
  // <math-field> partagé (voir bindFactorKeypad dans toolbar.js). Un simple
  // waitForTimeout fixe s'est révélé flaky sous charge (suite complète) : on attend donc
  // le signal DOM réel (le math-field vit désormais dans la boîte "b" et a le focus)
  // plutôt qu'une durée devinée (voir tests/README.md).
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="3"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepId2 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('docked "↵" key confirms the identity step correctly ((x+3)^2)',
    stepId2.equation.left[0].factors.length === 1 && stepId2.equation.left[0].factors[0].exponent === 2);
  await page.screenshot({ path: `${SCRATCH}/identity_confirm_cell.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
