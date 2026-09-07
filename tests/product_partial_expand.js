const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Sélection PAR FACTEUR d'un ProductGroup à ≥2 facteurs (voir toggleFactorSelection dans
// history.js) : par défaut, chaque parenthèse d'un produit est individuellement
// sélectionnable (clic simple visant précisément une parenthèse, jamais un clic ailleurs
// sur le produit) ; sélectionner au moins 2 parenthèses active "Développer", qui ne
// développe alors QUE celles-ci entre elles, les autres facteurs restant intacts — ex.
// "(x²-10x+25)(x-5)(x+2)" -> sélectionner "(x-5)" et "(x+2)" -> "(x²-10x+25)(x²-3x-10)".
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // --- 1) L'exemple motivant la fonctionnalité : développer 2 facteurs sur 3 ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x^2-10x+25)(x-5)(x+2)=0');
  await page.waitForTimeout(100);

  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  console.log('after selecting factor 1:', JSON.stringify(pending.selectedFactors));
  ok('selecting one factor is not enough to expand', !(await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand)));

  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-2"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('two factors of the same product selected', pending.selectedFactors &&
    pending.selectedFactors.branches.length === 2 && pending.selectedFactors.branches.indexOf(1) !== -1 && pending.selectedFactors.branches.indexOf(2) !== -1);
  ok('"Développer" enabled with 2 factors selected', await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  await page.screenshot({ path: `${SCRATCH}/product_partial_expand_selected.png` });

  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const step1 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('after partial expand:', JSON.stringify(step1.equation.left));
  ok('first factor untouched, (x-5)(x+2) merged into x^2-3x-10',
    step1.equation.left[0].factors.length === 2 &&
    JSON.stringify(step1.equation.left[0].factors[0]) === JSON.stringify({ terms: [{ coeff: 1, pow: 2 }, { coeff: -10, pow: 1 }, { coeff: 25, pow: 0 }], exponent: 1 }) &&
    JSON.stringify(step1.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 1, pow: 2 }, { coeff: -3, pow: 1 }, { coeff: -10, pow: 0 }], exponent: 1 }));
  ok('arrow label names exactly the developed factors', JSON.stringify(step1.opLeft) === JSON.stringify({
    type: 'expandProduct',
    factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -5, pow: 0 }], exponent: 1 }, { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 }]
  }));

  // --- 2) Cliquer un facteur DÉJÀ sélectionné le retire (toggle normal) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking the same factor twice deselects it entirely', pending.selectedFactors === null);

  // --- 3) Clicking a factor of a DIFFERENT product resets the selection to the new one ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)+(x+3)(x+4)=0');
  const eqTwo = await page.evaluate(() => window.App.History.lastEquation());
  ok('equation has two distinct top-level products', eqTwo.left.length === 2 &&
    eqTwo.left[0].factors && eqTwo.left[1].factors);
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-1-factor-0"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('after switching product:', JSON.stringify(pending.selectedFactors));
  ok('selecting a factor of another product replaces the previous selection (not accumulated)',
    pending.selectedFactors && pending.selectedFactors.index === 1 && pending.selectedFactors.branches.length === 1);

  // --- 4) Selecting ALL factors degenerates into the same result as full "Développer" ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const stepFull = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('all-factors selected -> full expand:', JSON.stringify(stepFull.equation.left));
  ok('selecting all factors fully expands (flat terms, not a degenerate 1-factor product)',
    JSON.stringify(stepFull.equation.left) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: 5, pow: 1 }, { coeff: 6, pow: 0 }]));

  // --- 5) "Produit nul" needs no selection at all anymore (see canProduitNul) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x-5)(x+2)=0');
  const canPN = await page.evaluate(() => window.App.History.canProduitNul());
  ok('"Produit nul" available immediately, no click/selection needed', canPN === true);
  const produitNulBtnEnabled = await page.evaluate(() => !document.querySelector('button[data-op="produitnul"]').disabled);
  ok('"Produit nul" button already enabled with no selection', produitNulBtnEnabled === true);

  // --- 6) A squared single-factor product ((x+3)^2) keeps the OLD whole-node behavior:
  // no per-factor selection (nothing to combine with itself), still selectable as a whole
  // for a full "Développer".
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2-4=0');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('squared single-factor product click:', JSON.stringify({ selectedLeft: pending.selectedLeft, selectedFactors: pending.selectedFactors }));
  ok('squared single-factor product uses classic whole-node selection', pending.selectedLeft.length === 1 && pending.selectedFactors === null);
  ok('"Développer" enabled on the squared factor as a whole', await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  // --- 7) A single factor CAN be expanded alone when it has an exponent>1 of its own
  // (ex. "(x-6)²" inside "(x-1)(x-6)²") : self-multiplied against itself, the other
  // factor(s) left untouched — no need to combine it with a second factor.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x-1)(x-6)^2=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('after selecting the squared factor alone:', JSON.stringify(pending.selectedFactors));
  ok('single squared factor selected', pending.selectedFactors &&
    pending.selectedFactors.branches.length === 1 && pending.selectedFactors.branches[0] === 1);
  ok('"Développer" enabled with only the squared factor selected',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand));

  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const step7 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('after single squared-factor expand:', JSON.stringify(step7.equation.left));
  ok('other factor untouched, (x-6)^2 expanded into x^2-12x+36',
    step7.equation.left[0].factors.length === 2 &&
    JSON.stringify(step7.equation.left[0].factors[0]) === JSON.stringify({ terms: [{ coeff: 1, pow: 1 }, { coeff: -1, pow: 0 }], exponent: 1 }) &&
    JSON.stringify(step7.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 1, pow: 2 }, { coeff: -12, pow: 1 }, { coeff: 36, pow: 0 }], exponent: 1 }));
  ok('arrow label names exactly the developed (squared) factor', JSON.stringify(step7.opLeft) === JSON.stringify({
    type: 'expandProduct',
    factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -6, pow: 0 }], exponent: 2 }]
  }));

  // --- 8) Bug fix: a lone selected factor (like a classic term selection) must be
  // deselectable both via Échap and via a left-click outside the equation.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+7)(x+5)+4=4');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('single factor selected before testing deselection', pending.selectedFactors &&
    pending.selectedFactors.branches.length === 1);

  await page.keyboard.press('Escape');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('Échap deselects a lone selected factor', pending.selectedFactors === null);

  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('single factor re-selected', pending.selectedFactors &&
    pending.selectedFactors.branches.length === 1);

  await page.mouse.click(20, 20);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('left-click outside the equation deselects a lone selected factor', pending.selectedFactors === null);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
