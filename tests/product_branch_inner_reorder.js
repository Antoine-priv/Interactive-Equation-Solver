const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function dragInner0PastInner1(page) {
  const inner0 = await page.$('[data-inner-index="0"]');
  const inner1 = await page.$('[data-inner-index="1"]');
  const b0 = await inner0.boundingBox();
  const b1 = await inner1.boundingBox();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 8, b0.y + b0.height / 2 + 2);
  await page.mouse.move(b1.x + b1.width + 5, b1.y + b1.height / 2, { steps: 10 });
  await page.waitForTimeout(50);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // --- 1) Facteur d'INDICE 0 d'un ProductGroup à 2 facteurs : "(x+2-3)(x+2+3)=0" ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2-3)(x+2+3)=0');
  await page.waitForTimeout(80);
  await page.evaluate(() => window.App.History.drillIntoProductBranch('left', 0, 0));
  await page.waitForTimeout(80);

  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into factor 0', pending.drilled && pending.drilled.branch === 0);

  const beforeOrder = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left[0].factors[0].terms.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre avant glisser (facteur non carre):', JSON.stringify(beforeOrder));

  await dragInner0PastInner1(page);
  const midDragText = await page.evaluate(() => document.querySelector('.eq-row.current .side[data-side="left"]').textContent);
  console.log('texte PENDANT le glisser:', JSON.stringify(midDragText));
  ok('the OTHER factor ("x+2+3") stays visible during the drag', /3/.test(midDragText) && midDragText.length > 3);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterEq = await page.evaluate(() => window.App.History.lastEquation());
  const afterOrder = afterEq.left[0].factors[0].terms.map((t) => t.coeff + '/' + t.pow);
  console.log('ordre apres glisser (facteur non carre):', JSON.stringify(afterOrder));
  ok('factor 0 order actually changed via drag', JSON.stringify(afterOrder) !== JSON.stringify(beforeOrder));
  ok('factor 1 ("x+2+3") untouched', afterEq.left[0].factors[1].terms.length === 3 &&
    JSON.stringify(afterEq.left[0].factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }, { coeff: 3, pow: 0 }]));

  await page.screenshot({ path: `${SCRATCH}/product_branch_reorder_nonsquare.png` });

  // --- 2) Facteur CARRÉ isolé : "(x+3)^2=0" (le fameux cas signalé) — un seul facteur,
  // une seule copie de ses termes (voir modèle de données dans expression.js) : plus de
  // "branche miroir" à vérifier, la réorganisation modifie directement l'unique copie.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=0');
  await page.waitForTimeout(80);
  await page.evaluate(() => window.App.History.drillIntoProductBranch('left', 0, 0));
  await page.waitForTimeout(80);

  pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the squared factor', pending.drilled && pending.drilled.branch === 0);

  const beforeSq = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left[0].factors[0].terms.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre avant glisser (carre):', JSON.stringify(beforeSq));

  await dragInner0PastInner1(page);
  await page.screenshot({ path: `${SCRATCH}/product_branch_reorder_square_mid_drag.png` });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterSqEq = await page.evaluate(() => window.App.History.lastEquation());
  const afterSqTerms = afterSqEq.left[0].factors[0].terms.map((t) => t.coeff + '/' + t.pow);
  console.log('ordre apres glisser (carre):', JSON.stringify(afterSqTerms));
  ok('squared factor order actually changed via drag', JSON.stringify(afterSqTerms) !== JSON.stringify(beforeSq));
  ok('exponent 2 preserved after reordering', afterSqEq.left[0].factors.length === 1 && afterSqEq.left[0].factors[0].exponent === 2);

  await page.screenshot({ path: `${SCRATCH}/product_branch_reorder_square_final.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
