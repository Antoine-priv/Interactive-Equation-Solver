const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Développer" doit pouvoir combiner une sélection par facteur sur le membre GAUCHE ET
// une autre sur le membre DROIT en une seule étape (jusqu'ici, pending.selectedFactors
// n'était qu'un seul objet global : sélectionner un facteur à droite écrasait toute
// sélection déjà faite à gauche). Ex. "(5x-7)(-5x^15)=(-x-17)(-5x^15)" : sélectionner les
// 2 facteurs de CHAQUE membre developpe tout en une seule fois, comme "Simplifier" le
// fait déjà pour une sélection à cheval sur les deux membres.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); },
    '(5x-7)(-5x^15)=(-x-17)(-5x^15)');

  await page.click('.eq-row.current .side[data-side="left"] [data-branch="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-branch="1"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('left factor selection recorded', pending.selectedFactors.left &&
    JSON.stringify(pending.selectedFactors.left.branches.slice().sort()) === '[0,1]');

  await page.click('.eq-row.current .side[data-side="right"] [data-branch="0"]');
  await page.click('.eq-row.current .side[data-side="right"] [data-branch="1"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('right factor selection recorded WITHOUT wiping the left one', pending.selectedFactors.left &&
    JSON.stringify(pending.selectedFactors.left.branches.slice().sort()) === '[0,1]' &&
    pending.selectedFactors.right &&
    JSON.stringify(pending.selectedFactors.right.branches.slice().sort()) === '[0,1]');

  ok('"Développer" enabled with both sides selected',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  await page.screenshot({ path: `${SCRATCH}/expand_cross_side_selected.png` });

  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation after combined cross-side expand:', JSON.stringify(step.equation));
  ok('both sides expand in ONE step: left = -25x^16+35x^15, right = 5x^16+85x^15',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: -25, pow: 16 }, { coeff: 35, pow: 15 }]) &&
    JSON.stringify(step.equation.right) === JSON.stringify([{ coeff: 5, pow: 16 }, { coeff: 85, pow: 15 }]));
  ok('opLeft and opRight both set (single combined step, not two)', !!step.opLeft && !!step.opRight);

  const stepsCount = await page.evaluate(() => window.App.History.getSteps().length);
  ok('exactly 2 steps total (initial equation + the one combined expand)', stepsCount === 2);

  // Régression : sur un membre qui a DEUX produits distincts, cliquer un facteur du
  // SECOND produit repart d'une sélection neuve pour CE membre seulement (comme avant ce
  // correctif), sans toucher la sélection déjà en cours sur l'AUTRE membre.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); },
    '(x+1)(x+2)+(x+3)(x+4)=(-x-17)(-5x^15)');
  await page.click('.eq-row.current .side[data-side="right"] [data-branch="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-1-factor-0"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('regression: switching to a different product on the left resets ONLY the left side',
    pending.selectedFactors.left && pending.selectedFactors.left.index === 1 &&
    JSON.stringify(pending.selectedFactors.left.branches) === '[0]' &&
    pending.selectedFactors.right && JSON.stringify(pending.selectedFactors.right.branches) === '[0]');

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
