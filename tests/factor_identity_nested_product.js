const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté : factoriser UN facteur d'un produit déjà existant (ex. "(x²-36)" dans
// "(x²-36)(x+2)=0", via l'identité a²-b²) imbriquait le résultat ("(x-6)(x+6)") comme
// facteur UNIQUE à la place de l'ancien, au lieu de le fusionner dans la liste plate du
// produit englobant -- côté rendu (productGroupBranchesLatex, render.js), seul le NIVEAU
// SUPÉRIEUR d'un ProductGroup reçoit un \htmlId/data-branch propre par facteur ; niché,
// "(x-6)(x+6)" redevenait un unique bloc opaque, indivisible au clic ("sélectionner l'un
// sélectionne les deux ensemble") -- et côté "tableau de signes",
// Expr.extractSignChartFactors (qui exige des facteurs LINÉAIRES au premier niveau)
// rejetait carrément le tout, rendant le bouton indisponible ("impossible de faire un
// tableau de signes pour cette équation"). Fixé dans withProductBranchAtPath
// (expression.js) : un ProductGroup produit par la factorisation d'UN facteur est
// maintenant aplati dans la liste plate du produit englobant plutôt qu'imbriqué.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // (x²-36)(x+2) = 0 : drille dans le premier facteur (x²-36), sélectionne ses deux
  // termes, factorise via l'identité 3 (a²-b²) avec a=x, b=6 -> doit donner
  // (x-6)(x+6)(x+2), un produit PLAT à 3 facteurs, jamais 2 avec le premier niché.
  await page.evaluate(() => {
    var Hist = window.App.History;
    Hist.startNewEquation({
      left: [{ sign: 1, factors: [
        { terms: [{ coeff: 1, pow: 2 }, { coeff: -36, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 }
      ] }],
      right: [{ coeff: 0, pow: 0 }]
    }, { operator: '\\geq' }); // an inequality: sign chart is now inequality-only (retour utilisateur, later round)
    Hist.drillIntoProductBranch('left', 0, 0);
    Hist.toggleInnerSelection(0);
    Hist.toggleInnerSelection(1);
  });
  await page.waitForTimeout(80);
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('.factor-choice-btn[data-factor-choice="3"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="x"]');
  await page.waitForTimeout(60);
  await page.click('.identity-ab-static');
  await page.waitForTimeout(60);
  await page.click('[data-key="6"]');
  await page.waitForTimeout(60);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const eqLeft = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation.left);
  console.log('resulting left side:', JSON.stringify(eqLeft));
  ok('produces a SINGLE ProductGroup (still one top-level node on the left)', eqLeft.length === 1);
  const product = eqLeft[0];
  ok('that product is now FLAT with 3 factors (x-6, x+6, x+2), none nested', product.factors && product.factors.length === 3);
  ok('none of the 3 factors is itself a nested ProductGroup',
    product.factors.every(function (f) { return f.terms.every(function (n) { return !n.factors; }); }));
  ok('factor 0 is (x-6)', JSON.stringify(product.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -6, pow: 0 }]));
  ok('factor 1 is (x+6)', JSON.stringify(product.factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 6, pow: 0 }]));
  ok('factor 2 is (x+2), untouched', JSON.stringify(product.factors[2].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }]));
  ok('overall sign stays positive', product.sign === 1);

  // --- Each of the 3 factors is now independently clickable/selectable (the actual
  // symptom reported: "selecting one selects both of them together") ---
  async function currentFactorIds() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('.eq-row.current .side[data-side="left"] [id*="-factor-"]')).map(function (e) { return e.id; }));
  }
  let ids = await currentFactorIds();
  ok('3 distinct clickable factor elements in the DOM', ids.length === 3 && new Set(ids).size === 3);

  await page.click('#' + ids[0]);
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking factor 0 (x-6) selects ONLY branch 0',
    JSON.stringify(pending.selectedFactors.left) === JSON.stringify({ index: 0, branches: [0] }));

  ids = await currentFactorIds();
  await page.click('#' + ids[1]);
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('separately clicking factor 1 (x+6) ADDS branch 1, not a duplicate/merged toggle of branch 0',
    JSON.stringify(pending.selectedFactors.left) === JSON.stringify({ index: 0, branches: [0, 1] }));

  // --- The actual motivating bug report: this equation is now eligible for a sign chart ---
  await page.evaluate(() => window.App.History.cancelOp());
  await page.waitForTimeout(60);
  const canSC = await page.evaluate(() => window.App.History.canSignChart());
  ok('canSignChart() is now true for (x-6)(x+6)(x+2)=0 (previously blocked entirely)', canSC === true);

  const spawned = await page.evaluate(() => {
    window.App.History.signChartAction();
    var sc = window.App.History.getSignChart();
    return sc && sc.factors.map(function (f) { return f.kind; });
  });
  ok('sign chart spawns exactly 3 independent factors', JSON.stringify(spawned) === JSON.stringify(['num', 'num', 'num']));

  // --- Exponent distribution: factoring the interior of an ALREADY-SQUARED product
  // branch (e.g. "(x²-36)²(x+2)") must distribute that outer exponent onto each new
  // factor -- (x-6)²(x+6)²(x+2), never just (x-6)(x+6)(x+2) (which would silently drop
  // the square) nor a leftover nested "((x-6)(x+6))²". Exercised directly via Expr, a
  // pure data-model check (no interactive drill path exists for this combination). ---
  const squaredResult = await page.evaluate(() => {
    var side = [{
      sign: 1,
      factors: [
        { terms: [{ coeff: 1, pow: 2 }, { coeff: -36, pow: 0 }], exponent: 2 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 }
      ]
    }];
    var newBranchTerms = [{
      sign: 1,
      factors: [
        { terms: [{ coeff: 1, pow: 1 }, { coeff: -6, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }, { coeff: 6, pow: 0 }], exponent: 1 }
      ]
    }];
    return window.App.Expr.withProductBranchAtPath(side, [0], 0, newBranchTerms);
  });
  console.log('squared-branch flattening result:', JSON.stringify(squaredResult));
  const sqProduct = squaredResult[0];
  ok('squared branch also flattens (3 factors, not nested)', sqProduct.factors.length === 3);
  ok('exponent 2 distributes onto (x-6)', sqProduct.factors[0].exponent === 2);
  ok('exponent 2 distributes onto (x+6)', sqProduct.factors[1].exponent === 2);
  ok('untouched (x+2) keeps its own exponent 1', sqProduct.factors[2].exponent === 1);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
