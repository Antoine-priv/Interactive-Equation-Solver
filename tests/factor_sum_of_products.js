const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function isOpRowEnabled(page, op) {
  return page.evaluate((op) => {
    const row = document.querySelector('button[data-op="' + op + '"]').closest('.op-row');
    return !row.hidden && !row.classList.contains('row-hidden');
  }, op);
}

// Sélectionne un ProductGroup à ≥2 facteurs EN ENTIER (pas un de ses facteurs) : un clic au
// centre de son data-index atterrit forcément dans le data-branch d'un de ses facteurs (voir
// toggleTermSelection dans history.js) — il faut viser le signe/l'espacement au tout début
// du noeud (hors des spans "factor-slot") pour obtenir le clic classique "noeud entier".
async function clickWholeProductNode(page, side, index) {
  const el = await page.$(`.eq-row.current .side[data-side="${side}"] [data-index="${index}"]`);
  const box = await el.boundingBox();
  await page.mouse.click(box.x + 1, box.y + box.height / 2);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)+(x+1)(x+5)=0');
  await page.waitForTimeout(100);

  const eq0 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('parsed:', JSON.stringify(eq0));
  ok('parsed as two ProductGroup nodes', eq0.left.length === 2 && eq0.left.every(n => Array.isArray(n.factors)));

  await clickWholeProductNode(page, 'left', 0);
  await clickWholeProductNode(page, 'left', 1);
  await page.waitForTimeout(80);

  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('both whole products selected (not per-factor)', pending.selectedLeft.length === 2 &&
    pending.selectedLeft.includes(0) && pending.selectedLeft.includes(1) && !pending.selectedFactors.left);

  ok('"Factoriser" button enabled for a sum of ProductGroup', await isOpRowEnabled(page, 'factor'));

  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('x+1');
  await page.waitForTimeout(80);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const resultEq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres factorisation par (x+1):', JSON.stringify(resultEq));
  const g = resultEq.left[0];
  ok('result is a single ProductGroup with 2 factors', g.factors && g.factors.length === 2 && g.sign === 1);
  ok('first factor is (x+1)', JSON.stringify(g.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }]));
  ok('second factor is the remaining sum (x+2 and x+5 spliced flat)', JSON.stringify(g.factors[1].terms) ===
    JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }, { coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }]));

  await page.screenshot({ path: `${SCRATCH}/factor_sum_of_products_result.png` });

  // Signe négatif sur le second produit : "(x+1)(x+2)-(x+1)(x+5)" -> "(x+1)(x+2-x-5)",
  // le signe du ProductGroup retiré doit se répercuter terme à terme (scaleNode).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)-(x+1)(x+5)=0');
  await page.waitForTimeout(80);
  await clickWholeProductNode(page, 'left', 0);
  await clickWholeProductNode(page, 'left', 1);
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('x+1');
  await page.waitForTimeout(80);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const negResult = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation avec signe negatif:', JSON.stringify(negResult.left[0]));
  ok('negative product sign distributes onto the remaining sum', JSON.stringify(negResult.left[0].factors[1].terms) ===
    JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }, { coeff: -1, pow: 1 }, { coeff: -5, pow: 0 }]));

  // Facteur tapé qui ne correspond à aucun facteur commun réel : erreur explicite, pas de
  // nouvelle étape poussée.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)+(x+1)(x+5)=0');
  await page.waitForTimeout(80);
  await clickWholeProductNode(page, 'left', 0);
  await clickWholeProductNode(page, 'left', 1);
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('x+9');
  await page.waitForTimeout(80);
  const stepsBefore = await page.evaluate(() => window.App.History.getSteps().length);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  pending = await page.evaluate(() => window.App.History.getPending());
  const stepsAfter = await page.evaluate(() => window.App.History.getSteps().length);
  ok('mismatched common factor: explicit error, no step pushed', !!pending.error && stepsAfter === stepsBefore);

  // Sélection mixte (un seul ProductGroup + un terme plat) : ne doit PAS activer Factoriser.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)+3=0');
  await page.waitForTimeout(80);
  await clickWholeProductNode(page, 'left', 0);
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.waitForTimeout(80);
  ok('mixed selection (one product + one plain term) does NOT enable Factoriser', await isOpRowEnabled(page, 'factor') === false);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
