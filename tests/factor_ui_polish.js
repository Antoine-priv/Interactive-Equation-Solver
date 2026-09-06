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

  // --- Test 1+2 : bouton Valider ("↵") du pave mathematique unifie (Operation) ---
  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('+3');
  });
  const exprValiderBtn = await page.$('#mathKeypadPanel .panel-confirm-cell');
  ok('Valider button exists in Operation keypad', exprValiderBtn !== null);
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);
  const step1 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('clicking panel Valider actually confirms the operation (+3 applied symmetrically)',
    JSON.stringify(step1.equation) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 5, pow: 0 }, { coeff: 3, pow: 0 }] }));

  // --- Test : bouton Valider dans le pave Factoriser (facteur commun) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x-12=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="common"]');
  const commonValiderBtn = await page.$('[data-key="enter"]');
  ok('Valider button exists in common-factor keypad', commonValiderBtn !== null);
  await page.click('[data-key="6"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepFactor = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('panel Valider confirms common-factor step (6(x-2))', stepFactor.equation.left[0].factor.coeff === 6);

  // --- Test : bouton Valider dans le pave identite remarquable ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  const idValiderBtn = await page.$('[data-key="enter"]');
  ok('Valider button exists in identity keypad', idValiderBtn !== null);

  // --- Test 2 : la touche x ne devient plus bleue apres clic ---
  // "a" est focalisée par défaut (le champ y vit déjà) : on y tape "x" directement, plus
  // besoin de cliquer dessus au préalable pour la focaliser.
  await page.click('[data-key="x"]');
  await page.waitForTimeout(80);
  const xKeyPressedClass = await page.evaluate(() => {
    var xBtn = document.querySelector('[data-key="x"]');
    return xBtn.classList.contains('key-pressed');
  });
  ok('x key does NOT turn blue/pressed after clicking it', xKeyPressedClass === false);

  // Un seul champ statique existe à la fois (l'AUTRE que celui focalisé, voir
  // buildIdentityKeypad dans toolbar.js) : ici "b", puisque "a" a le focus.
  await page.click('.identity-ab-static');
  await page.click('[data-key="3"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const stepId = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('panel Valider confirms identity step ((x+3)^2)', stepId.equation.left[0].factors.length === 1 && stepId.equation.left[0].factors[0].exponent === 2);

  // --- Test 3 : fleche du bouton retour centree (SVG, plus le caractere '<-') ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="2"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  const backBtnInfo = await page.evaluate(() => {
    var btn = document.querySelector('.factor-back-btn');
    var svg = btn.querySelector('svg');
    return { hasSvg: !!svg, isTextArrow: btn.textContent.trim() === '←' };
  });
  ok('back button now uses an SVG icon instead of the "<-" character', backBtnInfo.hasSvg === true && backBtnInfo.isTextArrow === false);
  await page.screenshot({ path: `${SCRATCH}/backbtn_svg.png`, clip: { x: 760, y: 555, width: 80, height: 60 } });

  // --- Test 4 : erreur + grisage persistent meme apres avoir clique ailleurs ---
  await page.click('.factor-back-btn');
  // x^2+6x+9 a 3 termes (x^2, x, constante) : l'Identite 3 (a^2-b^2) exige exactement 2
  // termes (x^2 + constante, sans terme en x) -> incompatibilite STRUCTURELLE, detectee
  // des le clic (avant meme de savoir quelles valeurs a/b conviendraient).
  await page.click('.factor-choice-btn[data-factor-choice="3"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('wrong-shape identity click sets error + factorChoiceFailed', !!pending.error && pending.factorChoiceFailed.indexOf(3) !== -1);
  const grayedBefore = await page.evaluate(() => document.querySelector('.factor-choice-btn[data-factor-choice="3"]').classList.contains('factor-choice-failed'));
  ok('button 3 is visually grayed', grayedBefore === true);

  // Clique ailleurs : (de)selectionne un terme du meme membre (toujours selectionnable en etape 1).
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]'); // reselectionne pour revenir a l'etat initial
  pending = await page.evaluate(() => window.App.History.getPending());
  const errorVisible = await page.evaluate(() => !!document.querySelector('#controlPanel .panel-error'));
  const grayedAfter = await page.evaluate(() => document.querySelector('.factor-choice-btn[data-factor-choice="3"]').classList.contains('factor-choice-failed'));
  console.log('apres avoir clique ailleurs:', JSON.stringify({ factorChoiceFailed: pending.factorChoiceFailed, errorVisible, grayedAfter }));
  ok('red error message STAYS visible after clicking elsewhere', errorVisible === true);
  ok('button 3 STAYS grayed after clicking elsewhere', grayedAfter === true);

  await page.screenshot({ path: `${SCRATCH}/error_persists.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
