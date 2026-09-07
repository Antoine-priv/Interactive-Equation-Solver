const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Développer" sur plusieurs groupes à la fois en une seule étape (voir
// computeExpandTargets/applyExpandTargets dans history.js) : un top-level group
// sélectionné en entier (ici "(x-6)²") ET, indépendamment, seulement le facteur au
// carré d'un AUTRE produit du même membre (ici "(x-9)²" dans "(x+6)(x-9)²", via la
// sélection par facteur), développés ensemble d'un seul clic sur "Développer" —
// "(x+6)" reste intact.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x-6)^2-(x+6)(x-9)^2=0');
  await page.waitForTimeout(100);

  const eq0 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('parsed left side:', JSON.stringify(eq0.left));
  ok('left side has 2 top-level products', eq0.left.length === 2 && eq0.left[0].factors && eq0.left[1].factors);
  ok('first is a single squared factor', eq0.left[0].factors.length === 1 && eq0.left[0].factors[0].exponent === 2);
  ok('second has 2 factors, the 2nd one squared', eq0.left[1].factors.length === 2 &&
    eq0.left[1].factors[0].exponent === 1 && eq0.left[1].factors[1].exponent === 2);

  // Sélectionne "(x-6)²" en entier (clic classique, noeud à 1 seul facteur).
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('whole first group selected', pending.selectedLeft.length === 1 && pending.selectedLeft[0] === 0);

  // Sélectionne SEULEMENT "(x-9)²" (2e facteur du 2e produit) par sélection par facteur.
  await page.click('.eq-row.current .side[data-side="left"] [id$="-1-factor-1"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('squared factor of the second product selected', pending.selectedFactors.left &&
    pending.selectedFactors.left.index === 1 && pending.selectedFactors.left.branches.length === 1 &&
    pending.selectedFactors.left.branches[0] === 1);
  ok('both selections coexist (free selection untouched by factor selection)',
    pending.selectedLeft.length === 1 && pending.selectedLeft[0] === 0);

  ok('"Développer" enabled with the combined selection',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  await page.screenshot({ path: `${SCRATCH}/expand_multi_selected.png` });

  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const step1 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('after combined expand:', JSON.stringify(step1.equation.left));
  console.log('opLeft:', JSON.stringify(step1.opLeft));

  ok('result: x^2-12x+36 flat, then -(x+6)(x^2-18x+81) untouched-first-factor product',
    JSON.stringify(step1.equation.left) === JSON.stringify([
      { coeff: 1, pow: 2 }, { coeff: -12, pow: 1 }, { coeff: 36, pow: 0 },
      {
        sign: -1,
        factors: [
          { terms: [{ coeff: 1, pow: 1 }, { coeff: 6, pow: 0 }], exponent: 1 },
          { terms: [{ coeff: 1, pow: 2 }, { coeff: -18, pow: 1 }, { coeff: 81, pow: 0 }], exponent: 1 }
        ]
      }
    ]));

  ok('combined arrow label: expandMulti with both parts in reading order', step1.opLeft &&
    step1.opLeft.type === 'expandMulti' && step1.opLeft.parts.length === 2 &&
    JSON.stringify(step1.opLeft.parts[0]) === JSON.stringify({ type: 'expandProduct', factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -6, pow: 0 }], exponent: 2 }] }) &&
    JSON.stringify(step1.opLeft.parts[1]) === JSON.stringify({ type: 'expandProduct', factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -9, pow: 0 }], exponent: 2 }] }));

  const label = await page.evaluate((desc) => window.App.Render.formatOpLabel(desc), step1.opLeft);
  console.log('formatted label:', label);
  ok('formatted label mentions both parts joined by "et"', typeof label === 'string' && /développer/.test(label) && /et/.test(label));

  await page.screenshot({ path: `${SCRATCH}/expand_multi_result.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
