const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function findSqrtKey(page) {
  return page.$('[data-key="sqrt"]');
}

const startEq = {
  left: [{
    sign: 1,
    factors: [
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 },
      {
        terms: [
          { sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 2 }] },
          { coeff: -16, pow: 0 }
        ],
        exponent: 1
      }
    ]
  }],
  right: [{ coeff: 0, pow: 0 }]
};

// Applique "Opération" `text` sur le moteur actif (celui que délègue App.History en ce
// moment, à N'IMPORTE quelle profondeur), puis simplifie immédiatement les deux membres
// (l'app n'auto-simplifie jamais après une opération) : réduit chaque membre à un seul
// terme, condition nécessaire pour que detectSquareRoot/isSolved s'y appliquent ensuite.
function applyOpAndSimplify(page, text) {
  return page.evaluate((t) => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText(t);
    window.App.History.confirm();
    var eq = window.App.History.lastEquation();
    // Ne sélectionne que les vrais Term plats (jamais un FactorGroup/ProductGroup, ex.
    // le "(x+3)^2" du membre gauche ici) : seuls des termes "compatibles" (même pow)
    // peuvent se combiner via Simplifier.
    var isPlainTerm = function (n) { return !n.factors && !n.innerTerms; };
    var leftIdx = eq.left.map(function (n, i) { return isPlainTerm(n) ? i : -1; }).filter(function (i) { return i >= 0; });
    var rightIdx = eq.right.map(function (n, i) { return isPlainTerm(n) ? i : -1; }).filter(function (i) { return i >= 0; });
    if (leftIdx.length > 1) leftIdx.forEach(function (i) { window.App.History.toggleTermSelection('left', i); });
    if (rightIdx.length > 1) rightIdx.forEach(function (i) { window.App.History.toggleTermSelection('right', i); });
    if (leftIdx.length > 1 || rightIdx.length > 1) window.App.History.confirmSimplifySelection();
  }, text);
}

// Une colonne "Produit nul" (ou "Racine carrée") peut elle-même atteindre une forme qui
// se prête à une NOUVELLE "Produit nul"/"Racine carrée" (ex. une identité remarquable
// produisant un carré parfait à l'intérieur d'une colonne) : ce test construit
// directement (via l'objet Equation, pour éviter de dépendre du parseur pour des
// parenthèses imbriquées) "(x+2)((x+3)^2-16)=0", scinde par "Produit nul", amène la
// colonne droite à "(x+3)^2=16" par une opération ordinaire, puis vérifie que "Racine
// carrée" y est bien PROPOSÉE (plus le bug d'origine : la touche restait grisée dès
// qu'une scission avait déjà eu lieu, voir history.js/canSquareRoot) et scinde bien
// CETTE colonne en 2 sous-colonnes, rendues imbriquées (voir renderBranchNode dans
// render.js), indépendamment résolubles, jusqu'à un résumé final correct.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(eq); }, startEq);
  await page.waitForTimeout(80);

  // 1) Produit nul sur (x+2)((x+3)^2-16)=0 -> 2 colonnes de premier niveau.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(150);

  const topBranches = await page.evaluate(() => window.App.History.getBranches().map((b) => b.lastEquation()));
  console.log('branches de premier niveau:', JSON.stringify(topBranches));
  ok('produit nul gives exactly 2 top-level columns', topBranches.length === 2);
  const squareIdx = topBranches.findIndex((eq) => eq.left.some((n) => n.factors));
  ok('found the "(x+3)^2-16=0" column', squareIdx !== -1);

  // 2) Focalise cette colonne, l'amène à "(x+3)^2=16" par une opération ordinaire (+16)
  // puis une simplification explicite des deux membres.
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, squareIdx);
  await applyOpAndSimplify(page, '+16');
  await page.waitForTimeout(150);

  const afterOp = await page.evaluate(() => window.App.History.lastEquation());
  console.log('colonne apres +16 puis simplification:', JSON.stringify(afterOp));
  ok('column reaches (x+3)^2=16', JSON.stringify(afterOp.right) === JSON.stringify([{ coeff: 16, pow: 0 }]));

  // 3) LE BUG D'ORIGINE : la touche "Racine carrée" du pavé "Opération" doit être
  // UTILISABLE ici, alors qu'une scission ("Produit nul") a déjà eu lieu plus haut dans
  // l'arbre — canSquareRoot()/canProduitNul() ne doivent plus se limiter à l'équation de
  // tout premier niveau (voir history.js).
  const canSquareRootNow = await page.evaluate(() => window.App.History.canSquareRoot());
  ok('canSquareRoot() is true for a focused branch already inside a split', canSquareRootNow === true);

  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(120);
  const sqrtKey = await findSqrtKey(page);
  const sqrtDisabled = await sqrtKey.evaluate((el) => el.disabled);
  ok('the sqrt key in the Opération keypad is NOT greyed out inside this branch', sqrtDisabled === false);

  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(120);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(200);

  // 4) La colonne s'est scindée À SON TOUR (imbriqué) en 2 sous-colonnes.
  const nested = await page.evaluate((idx) => {
    var col = window.App.History.getBranches()[idx];
    var sub = col.getBranches();
    return sub ? sub.map((s) => s.lastEquation()) : null;
  }, squareIdx);
  console.log('sous-branches imbriquees:', JSON.stringify(nested));
  ok('the branch itself split into exactly 2 nested columns', nested && nested.length === 2);
  ok('nested branch 0 is x+3=4', nested && JSON.stringify(nested[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 4, pow: 0 }] }));
  ok('nested branch 1 is x+3=-4', nested && JSON.stringify(nested[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -4, pow: 0 }] }));

  // 5) Rendu DOM : colonnes imbriquées effectivement présentes, sans erreur JS.
  const domNested = await page.evaluate(() => document.querySelectorAll('.produit-nul-split-nested .produit-nul-branch').length);
  ok('2 nested column elements actually rendered in the DOM', domNested === 2);
  await page.screenshot({ path: `${SCRATCH}/nested_branch_split.png` });

  // 6) Termine de résoudre TOUT l'arbre (les 2 sous-branches + l'autre colonne de
  // premier niveau) et vérifie le résumé final agrégé (pas seulement le premier niveau).
  await page.evaluate((idx) => {
    window.App.History.setFocusedBranch(idx);
    window.App.History.getBranches()[idx].setFocusedBranch(0);
  }, squareIdx);
  await applyOpAndSimplify(page, '-3'); // "x+3=4" -> "x=1"
  await page.waitForTimeout(100);

  await page.evaluate((idx) => { window.App.History.getBranches()[idx].setFocusedBranch(1); }, squareIdx);
  await applyOpAndSimplify(page, '-3'); // "x+3=-4" -> "x=-7"
  await page.waitForTimeout(100);

  const otherIdx = squareIdx === 0 ? 1 : 0;
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, otherIdx);
  await applyOpAndSimplify(page, '-2'); // "x+2=0" -> "x=-2"
  await page.waitForTimeout(200);

  const summaryLatexExists = await page.evaluate(() => !!document.querySelector('.solution-set'));
  ok('final aggregated solution-set summary appears once EVERY leaf (nested included) is solved', summaryLatexExists);
  const summaryText = await page.evaluate(() => document.querySelector('.solution-set').textContent);
  console.log('resume final:', summaryText);
  ok('summary contains all 3 distinct roots (-7, -2, 1)', /-7/.test(summaryText) && /-2/.test(summaryText) && /1/.test(summaryText));

  await page.screenshot({ path: `${SCRATCH}/nested_branch_split_solved.png` });

  // 7) Undo : d'abord la scission imbriquée seule (retour à "(x+3)^2=16" DANS la
  // colonne), sans toucher à la scission de premier niveau ni à l'autre colonne.
  // (Redémarre depuis zéro un scénario plus court pour ce point précis, plus lisible.)
  await page.evaluate((eq) => { window.App.History.startNewEquation(eq); }, startEq);
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(80);
  const sqIdx2 = (await page.evaluate(() => window.App.History.getBranches().map((b) => b.lastEquation())))
    .findIndex((eq) => eq.left.some((n) => n.factors));
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, sqIdx2);
  await applyOpAndSimplify(page, '+16');
  await page.evaluate(() => window.App.History.confirmSquareRoot());
  await page.waitForTimeout(80);

  const hasNestedBefore = await page.evaluate((idx) => !!window.App.History.getBranches()[idx].getBranches(), sqIdx2);
  ok('nested split exists before undo', hasNestedBefore);

  await page.evaluate(() => window.App.History.undo());
  await page.waitForTimeout(80);
  const stateAfterFirstUndo = await page.evaluate((idx) => ({
    hasNested: !!window.App.History.getBranches()[idx].getBranches(),
    hasTop: !!window.App.History.getBranches(),
    eq: window.App.History.getBranches()[idx].lastEquation()
  }), sqIdx2);
  console.log('etat apres 1er undo:', JSON.stringify(stateAfterFirstUndo));
  ok('first undo dissolves ONLY the nested split (back to (x+3)^2=16)', !stateAfterFirstUndo.hasNested);
  ok('the outer split (top-level columns) is untouched by that undo', stateAfterFirstUndo.hasTop);
  ok('column equation is back to (x+3)^2=16', JSON.stringify(stateAfterFirstUndo.eq.right) === JSON.stringify([{ coeff: 16, pow: 0 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
