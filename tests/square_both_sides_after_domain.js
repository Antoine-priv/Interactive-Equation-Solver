const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté : pour "\sqrt{x-3}=3", cliquer "Condition d'existence" (domaine de
// définition du radicand) rendait ENSUITE la touche "(‥)²" (canSquareBothSides/
// confirmSquareBothSides, seule façon de vraiment résoudre cette équation) définitivement
// indisponible sur la chaîne principale — la restriction v1 "un même noeud n'a jamais
// `branches` ET `domainConditions` à la fois" (voir createBranchable dans history.js),
// écrite pour Produit nul/Racine carrée (qui PEUVENT scinder `leaf` en `branches`), avait
// été copiée à tort sur "(‥)²", qui ne scinde jamais rien (toujours un pushStep normal,
// un seul résultat) et ne devrait donc jamais être bloquée par `domainConditions`
// (lesquelles COEXISTENT avec `leaf`, sans conflit structurel).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  // "\sqrt{x-3}=3" (dénominateur/radicand variable : injecté en AST, voir
  // existence_condition_sqrt_linear_signflip.js pour la même convention).
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  ok('canSquareBothSides true before any "Condition d\'existence"',
    await page.evaluate(() => window.App.History.canSquareBothSides()));

  // Double-clic (deux toggleTermSelection, même convention que les autres tests
  // "Condition d'existence") sur l'unique SqrtGroup du membre gauche, pour drill dedans.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  ok('"Condition d\'existence" enabled once drilled into the radicand',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition));

  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);

  const conditions = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('exactly one domain condition was created', conditions && conditions.length === 1);

  // --- Coeur du bug : la chaîne principale (jamais focalisée, focusedDomain reste null)
  // doit rester capable d'appliquer "(‥)²" pour continuer la résolution. ---
  ok('canSquareBothSides STILL true once a domain condition exists',
    await page.evaluate(() => window.App.History.canSquareBothSides()));
  ok('the "(‥)²" key itself is NOT disabled in the real UI',
    !(await page.evaluate(() => document.querySelector('[data-key="square"]').disabled)));

  const confirmed = await page.evaluate(() => window.App.History.confirmSquareBothSides());
  ok('confirmSquareBothSides() succeeds', confirmed === true);
  await page.waitForTimeout(80);

  const eq = await page.evaluate(() => window.App.History.lastEquation());
  ok('main equation correctly squared to "x-3=9"', JSON.stringify(eq) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }], right: [{ coeff: 9, pow: 0 }] }));

  const conditionsAfter = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('the domain condition column still coexists, untouched', conditionsAfter && conditionsAfter.length === 1);

  await page.screenshot({ path: `${SCRATCH}/square_both_sides_after_domain.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.length ? errs.join('\n') : '(aucune)');
  if (errs.length) process.exitCode = 1;

  await browser.close();
})();
