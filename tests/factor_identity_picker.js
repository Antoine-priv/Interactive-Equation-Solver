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

  // --- Test A : x^2+6x+9 -> Identite 1 (a+b)^2 avec a=1(vide), b=3 ---
  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');

  // Etape 1 : 4 boutons doivent exister
  const choiceButtons = await page.$$('.factor-choice-btn');
  ok('4 choice buttons shown at step 1', choiceButtons.length === 4);
  // Les boutons de l'étape 1 n'ont plus de libellé texte "Identité N" (seule la formule
  // KaTeX compte, voir IDENTITY_INFO dans toolbar.js) : on les cible par
  // data-factor-choice. TOUS restent cliquables même quand la forme ne correspond pas
  // (jamais réellement "disabled", voir buildFactorChoiceStep) : "Identity 3 disabled"
  // ci-dessous vérifie donc l'absence de la classe factor-choice-failed AVANT tout clic
  // (état initial, pas encore essayée), pas un vrai attribut disabled.
  const id1Enabled = await page.evaluate(() => {
    var b = document.querySelector('.factor-choice-btn[data-factor-choice="1"]');
    return b ? !b.disabled : null;
  });
  ok('Identity 1 enabled for x^2+6x+9 selection', id1Enabled === true);
  const id3NotYetFailed = await page.evaluate(() => {
    var b = document.querySelector('.factor-choice-btn[data-factor-choice="3"]');
    return b ? !b.classList.contains('factor-choice-failed') : null;
  });
  ok('Identity 3 not yet grayed before any attempt', id3NotYetFailed === true);

  await page.screenshot({ path: `${SCRATCH}/id1_step1_choices.png` });

  // Choisit Identite 1
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('factorMode becomes 1', pending.factorMode === 1);

  const abFields = await page.$$('.identity-ab-field');
  ok('a/b fields shown at step 2', abFields.length === 2);

  await page.screenshot({ path: `${SCRATCH}/id1_step2_empty.png` });

  // Le focus par defaut doit etre "a" ; on tape "x" directement dedans (plus de
  // désignation séparée, voir parseIdentityAB dans history.js), puis on bascule sur "b"
  // pour taper "3".
  ok('default focus is a', pending.idFocus === 'a');
  await page.click('[data-key="x"]');
  await page.waitForTimeout(80);
  // Un seul champ statique existe à la fois (l'AUTRE que celui focalisé, voir
  // buildIdentityKeypad dans toolbar.js) : ici "b", puisque "a" a le focus.
  await page.click('.identity-ab-static');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking b field switches focus', pending.idFocus === 'b');
  await page.click('[data-key="3"]');
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('digit goes to idBLatex', pending.idBLatex === '3' && pending.idALatex === 'x');

  await page.screenshot({ path: `${SCRATCH}/id1_step2_b3.png` });

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepA = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres identite 1 (a=1,b=3):', JSON.stringify(stepA.equation), JSON.stringify(stepA.opLeft));
  const groupA = stepA.equation.left[0];
  ok('produces (x+3)^2', groupA && groupA.factors.length === 1 && groupA.factors[0].exponent === 2 &&
    JSON.stringify(groupA.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));
  ok('step label is factorIdentity type 1', stepA.opLeft && stepA.opLeft.type === 'factorIdentity' && stepA.opLeft.identityType === 1);

  await page.screenshot({ path: `${SCRATCH}/id1_after_confirm.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
