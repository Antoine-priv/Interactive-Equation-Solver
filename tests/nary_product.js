const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Couverture de la généralisation N-aire de ProductGroup (voir modèle de données dans
// expression.js : { sign, factors: [{ terms, exponent }] }) : parsing d'un produit à 3
// facteurs tapé directement, "Produit nul" via saisie réelle (pas seulement injecté),
// drilling/réorganisation dans un facteur au-delà des deux premiers, et le nouveau
// plafond de degré au moment de "Développer".
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // --- 1) Parser un produit à 3 facteurs distincts, tapé directement ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)(x+4)=0');
  let eq0 = await page.evaluate(() => window.App.History.lastEquation());
  ok('3-factor product parses to one ProductGroup with 3 factors', eq0.left.length === 1 && eq0.left[0].factors.length === 3);
  ok('each factor has exponent 1', eq0.left[0].factors.every((f) => f.exponent === 1));

  // --- 2) "Produit nul" sur ce produit réellement tapé (pas injecté) -> 3 branches ---
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.waitForTimeout(60);
  const canProduitNul = await page.evaluate(() => window.App.History.canProduitNul());
  ok('"Produit nul" available on a real typed 3-factor product', canProduitNul);
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(150);
  const branches = await page.evaluate(() => {
    var bs = window.App.History.getBranches();
    return bs ? bs.map((b) => b.lastEquation()) : null;
  });
  console.log('branches after Produit nul on 3 real factors:', JSON.stringify(branches));
  ok('exactly 3 branches spawned', branches && branches.length === 3);
  ok('branch 0 is x+2=0', branches && JSON.stringify(branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
  ok('branch 2 is x+4=0', branches && JSON.stringify(branches[2]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 4, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));

  await page.screenshot({ path: `${SCRATCH}/nary_produit_nul.png` });

  // --- 3) Drilling dans le 3e facteur (indice 2) et réorganisation de ses termes ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)(x-4)=0');
  await page.waitForTimeout(60);
  await page.evaluate(() => window.App.History.drillIntoProductBranch('left', 0, 2));
  await page.waitForTimeout(60);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into factor index 2 (third factor)', pending.drilled && pending.drilled.branch === 2 && pending.drilled.side === 'left');
  const drilledExit = await page.$('.drilled-exit');
  ok('.drilled-exit element present for the drilled factor', !!drilledExit);
  await page.evaluate(() => window.App.History.setInnerOrder([1, 0]));
  await page.waitForTimeout(60);
  const eqAfterReorder = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation after reordering factor 2:', JSON.stringify(eqAfterReorder));
  ok('factor 2 terms reordered', JSON.stringify(eqAfterReorder.left[0].factors[2].terms) === JSON.stringify([{ coeff: -4, pow: 0 }, { coeff: 1, pow: 1 }]));
  ok('other factors untouched', JSON.stringify(eqAfterReorder.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }]));
  await page.evaluate(() => window.App.History.exitDrill());

  // --- 4) "Développer" : Term.pow n'est plus plafonné (voir CLAUDE.md), donc un produit
  // de N facteurs se développe normalement quel que soit le degré résultant. Depuis
  // l'introduction de la sélection PAR FACTEUR (voir toggleFactorSelection dans
  // history.js), un clic sur UNE parenthèse d'un produit à ≥2 facteurs ne sélectionne plus
  // le noeud entier : il faut cliquer CHAQUE parenthèse individuellement (ici, toutes,
  // pour un développement complet équivalent à l'ancien comportement).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  await page.waitForTimeout(60);
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  const eqExpanded = await page.evaluate(() => window.App.History.lastEquation());
  ok('2-factor product expands to x^2+5x+6', JSON.stringify(eqExpanded.left) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: 5, pow: 1 }, { coeff: 6, pow: 0 }]));

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)(x+4)=0');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  await page.click('.eq-row.current .side[data-side="left"] [id$="-0-factor-2"]');
  await page.waitForTimeout(60);
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(120);
  const eqExpanded3 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('3-factor product expanded:', JSON.stringify(eqExpanded3.left));
  ok('3-factor product expands to x^3+9x^2+26x+24 (no degree cap)',
    JSON.stringify(eqExpanded3.left) === JSON.stringify([{ coeff: 1, pow: 3 }, { coeff: 9, pow: 2 }, { coeff: 26, pow: 1 }, { coeff: 24, pow: 0 }]));
  const pendingAfterExpand3 = await page.evaluate(() => window.App.History.getPending());
  ok('no error surfaced', !pendingAfterExpand3.error);

  await page.screenshot({ path: `${SCRATCH}/nary_expand_no_degree_cap.png` });

  // --- 5) Chaîne coefficient + facteur + facteur au carré, ex. le cas motivant l'origine
  // de cette généralisation : "5(8-6x+4)(5x+2)^2" (respecte le plafond Term.pow=2 sur
  // chaque terme individuel — la contrainte porte sur le développement, pas la saisie).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '5(8-6x+4)(5x+2)^2=0');
  const eqTriple = await page.evaluate(() => window.App.History.lastEquation());
  console.log('5(8-6x+4)(5x+2)^2 parsed as:', JSON.stringify(eqTriple));
  ok('coefficient + factor + squared-factor chain parses to 3 factors', eqTriple.left[0].factors.length === 3);
  ok('first factor is the scalar 5', JSON.stringify(eqTriple.left[0].factors[0]) === JSON.stringify({ terms: [{ coeff: 5, pow: 0 }], exponent: 1 }));
  ok('third factor is (5x+2) with exponent 2', eqTriple.left[0].factors[2].exponent === 2 &&
    JSON.stringify(eqTriple.left[0].factors[2].terms) === JSON.stringify([{ coeff: 5, pow: 1 }, { coeff: 2, pow: 0 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
