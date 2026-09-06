const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function freshPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  return { page, errs };
}

async function typeEquation(page, raw) {
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, raw);
}

(async () => {
  const browser = await chromium.launch();
  let anyErr = [];

  // --- 1) Racine carrée : (x+3)^2 = 9 -> 2 branches x+3=3 / x+3=-3 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, '(x+3)^2=9');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmSquareRoot();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => {
      var bs = window.App.History.getBranches();
      return bs ? bs.map((b) => b.lastEquation()) : null;
    });
    console.log('1) branches (x+3)^2=9:', JSON.stringify(branches));
    ok('1) sqrt with c=9 gives exactly 2 branches', branches && branches.length === 2);
    ok('1) branch 0 is x+3=3', branches && JSON.stringify(branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 3, pow: 0 }] }));
    ok('1) branch 1 is x+3=-3', branches && JSON.stringify(branches[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -3, pow: 0 }] }));
    await page.screenshot({ path: `${SCRATCH}/sqrt_c9.png` });
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 2) Racine carrée : (x+3)^2 = 0 -> UN SEUL résultat, donc jamais une "fourche" à
  // une seule branche (voir pushStep dans history.js) : reste une étape normale de la
  // chaîne principale (branches === null), pas les colonnes "Produit nul"/"Racine carrée".
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, '(x+3)^2=0');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmSquareRoot();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => window.App.History.getBranches());
    const lastEq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('2) branches (x+3)^2=0 (attendu null):', JSON.stringify(branches), 'lastEquation:', JSON.stringify(lastEq));
    ok('2) sqrt with c=0 creates NO branches (single normal step instead)', branches === null);
    ok('2) primary chain\'s last equation is x+3=0', JSON.stringify(lastEq) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
    await page.screenshot({ path: `${SCRATCH}/sqrt_c0.png` });
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 3) Racine carrée : (x+3)^2 = -4 -> pas de scission, erreur ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, '(x+3)^2=-4');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmSquareRoot();
    });
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => ({
      branches: window.App.History.getBranches(),
      error: window.App.History.getPending().error
    }));
    console.log('3) etat (x+3)^2=-4:', JSON.stringify(state));
    ok('3) negative constant: no branches created', !state.branches);
    ok('3) negative constant: error message set', !!state.error);
    const errPanelText = await page.evaluate(() => {
      var el = document.querySelector('.panel-error');
      return el ? el.textContent : null;
    });
    ok('3) error message shown in panel', !!errPanelText);
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 4) Racine carrée sur x^2 nu : x^2 = 16 -> x=4 / x=-4 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2=16');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmSquareRoot();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => {
      var bs = window.App.History.getBranches();
      return bs ? bs.map((b) => b.lastEquation()) : null;
    });
    console.log('4) branches x^2=16:', JSON.stringify(branches));
    ok('4) bare x^2=16 gives 2 branches', branches && branches.length === 2);
    ok('4) branch 0 is x=4', branches && JSON.stringify(branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 4, pow: 0 }] }));
    ok('4) branch 1 is x=-4', branches && JSON.stringify(branches[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: -4, pow: 0 }] }));
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 5) Produit nul sur (x+3)^2=0 -> une seule colonne (dedup des facteurs identiques) ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, '(x+3)^2=0');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmProduitNul();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => {
      var bs = window.App.History.getBranches();
      return bs ? bs.map((b) => b.lastEquation()) : null;
    });
    console.log('5) branches produit nul (x+3)^2=0:', JSON.stringify(branches));
    ok('5) produit nul on (x+3)^2=0 gives exactly 1 column', branches && branches.length === 1);
    ok('5) that column is x+3=0', branches && JSON.stringify(branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
    await page.screenshot({ path: `${SCRATCH}/produitnul_square_dedup.png` });
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 6) Produit nul regression : facteurs distincts (x+2)(x+3)=0 -> toujours 2 colonnes ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, '(x+2)(x+3)=0');
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmProduitNul();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => {
      var bs = window.App.History.getBranches();
      return bs ? bs.map((b) => b.lastEquation()) : null;
    });
    console.log('6) branches (x+2)(x+3)=0:', JSON.stringify(branches));
    ok('6) distinct factors: still exactly 2 columns (no regression)', branches && branches.length === 2);
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  // --- 7) Généralisation N facteurs : (x+2)(x+3)(x+3)=0, tapé directement (le parseur
  // N-ary sait chaîner plus de deux parenthèses ET fusionne automatiquement un facteur
  // adjacent structurellement identique en un seul d'exposant 2, voir canonicalizeFactors
  // dans expression.js) -> 2 colonnes distinctes (x+2)=0 et (x+3)=0. ---
  {
    const { page, errs } = await freshPage(browser);
    await page.goto(FILE);
    await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)(x+3)=0');
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.confirmProduitNul();
    });
    await page.waitForTimeout(100);
    const branches = await page.evaluate(() => {
      var bs = window.App.History.getBranches();
      return bs ? bs.map((b) => b.lastEquation()) : null;
    });
    console.log('7) branches (x+2)(x+3)(x+3)=0 (imbrique):', JSON.stringify(branches));
    ok('7) 3 facteurs dont 2 identiques -> exactement 2 colonnes distinctes', branches && branches.length === 2);
    ok('7) colonne 0 est x+2=0', branches && JSON.stringify(branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
    ok('7) colonne 1 est x+3=0', branches && JSON.stringify(branches[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
    await page.screenshot({ path: `${SCRATCH}/produitnul_nfactor.png` });
    anyErr = anyErr.concat(errs);
    await page.close();
  }

  console.log('--- erreurs JS (toutes pages confondues) ---');
  console.log(anyErr.join('\n') || '(aucune)');
  if (anyErr.length) process.exitCode = 1;
  await browser.close();
})();
