const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Génère un grand nombre d'équations aléatoires, en forçant chaque forme individuellement
// (via les fonctions exportées, pas seulement generateEquation() qui mélange au hasard) :
// vérifie qu'elle survit le round-trip texte (equationToPlainText -> parseEquation, le
// chemin réellement emprunté par le bouton "Générer aléatoirement") ET qu'elle reste
// factorisable/résoluble par les outils de l'appli (pas de garantie mathématique manquante
// : coefficients entiers, formes reconnues par detectSquareRoot/detectProduitNul/
// getFactorTargetShape selon le cas).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const generators = [
    'generateLinearEquation', 'generateSimplifyFirstLinear', 'generateFactorableQuadratic',
    'generateSquareRootEquation', 'generateProductEquation', 'generateGroupedCommonFactor',
    'generateSquareMinusConstant', 'generateDiffOfTwoSquaredExpr',
    'generateFractionEquation', 'generateIdentityPlusProduct', 'generateTrinomialMinusSquareGroup'
  ];

  for (const name of generators) {
    const N = 300;
    const result = await page.evaluate(([name, N]) => {
      function hasNaN(node) {
        if (Array.isArray(node)) return node.some(hasNaN);
        if (node && typeof node === 'object') {
          return Object.keys(node).some(function (k) {
            return typeof node[k] === 'number' ? isNaN(node[k]) : hasNaN(node[k]);
          });
        }
        return false;
      }
      var fails = [];
      for (var i = 0; i < N; i++) {
        var eq = window.App.Generator[name]();
        try {
          window.App.History.startNewEquation(eq);
        } catch (e) {
          fails.push({ i: i, stage: 'load', error: e.message, eq: JSON.stringify(eq) });
          continue;
        }
        if (hasNaN(eq)) fails.push({ i: i, stage: 'NaN', eq: JSON.stringify(eq) });
      }
      return fails;
    }, [name, N]);
    ok(name + ': ' + N + ' generated equations all load without throwing or NaN', result.length === 0);
    if (result.length) console.log(JSON.stringify(result.slice(0, 3), null, 2));
  }

  // Vérifie que chaque forme est bien reconnue par le mécanisme de résolution CIBLÉ (pas
  // juste "l'équation se charge") : ex. generateSquareRootEquation doit vraiment activer
  // canSquareRoot(), pas juste être une équation valide par ailleurs.
  const targeted = await page.evaluate(() => {
    var fails = [];
    for (var i = 0; i < 100; i++) {
      var eq1 = window.App.Generator.generateSquareRootEquation();
      window.App.History.startNewEquation(eq1);
      if (!window.App.History.canSquareRoot()) fails.push({ gen: 'sqrt', eq: JSON.stringify(eq1) });

      var eq2 = window.App.Generator.generateSimplifyFirstLinear();
      window.App.History.startNewEquation(eq2);
      // Le second terme en x est au dernier index (2 s'il y a une constante entre les
      // deux, sinon 1 juste après le premier) : voir generateSimplifyFirstLinear.
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.toggleTermSelection('left', eq2.left.length - 1);
      var infoLeft = window.App.Toolbar.computeSelectionInfo();
      if (!infoLeft.canSimplify) fails.push({ gen: 'simplify-first (left)', eq: JSON.stringify(eq2) });

      var eq3 = window.App.Generator.generateGroupedCommonFactor();
      window.App.History.startNewEquation(eq3);
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.toggleTermSelection('left', 1);
      // Le facteur commun d'expressions déjà groupées passe par
      // computeSelectionInfo().canFactor (allNumericFactorGroups dans toolbar.js), PAS par
      // getFactorTargetShape (réservé au sélecteur d'identité remarquable 1/2/3).
      var info3 = window.App.Toolbar.computeSelectionInfo();
      if (!info3.canFactor) fails.push({ gen: 'grouped-common-factor (canFactor false)', eq: JSON.stringify(eq3) });
      function gcdAbs(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { var t = b; b = a % b; a = t; } return a; }
      var g3 = gcdAbs(eq3.left[0].factor.coeff, eq3.left[1].factor.coeff);
      try {
        window.App.Expr.factorNodes(eq3.left, [0, 1], { coeff: g3, pow: 0 });
      } catch (e) {
        fails.push({ gen: 'grouped-common-factor (factoring by its own gcd throws)', eq: JSON.stringify(eq3), g: g3, error: e.message });
      }

      var eq4 = window.App.Generator.generateSquareMinusConstant();
      window.App.History.startNewEquation(eq4);
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.toggleTermSelection('left', 1);
      var shape4 = window.App.History.getFactorTargetShape();
      if (!shape4 || !shape4.groupBase) fails.push({ gen: 'square-minus-constant', eq: JSON.stringify(eq4), shape: JSON.stringify(shape4) });

      var eq5 = window.App.Generator.generateDiffOfTwoSquaredExpr();
      window.App.History.startNewEquation(eq5);
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.toggleTermSelection('left', 1);
      var shape5 = window.App.History.getFactorTargetShape();
      if (!shape5 || !shape5.groupBaseA || !shape5.groupBaseB) fails.push({ gen: 'diff-of-two-squares', eq: JSON.stringify(eq5), shape: JSON.stringify(shape5) });

      // La fraction s'annule proprement en tapant "×d" (l'Opération unique), voir le cas
      // ajouté à Expr.wrapSideInFactor : le membre gauche redevient de simples termes.
      var eq6 = window.App.Generator.generateFractionEquation();
      window.App.History.startNewEquation(eq6);
      var d6 = eq6.left[0].factor.coeff;
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText('\\times' + d6);
      window.App.History.confirm();
      var afterEq6 = window.App.History.lastEquation();
      if (afterEq6.left.some(function (n) { return n.isDivision; })) {
        fails.push({ gen: 'fraction-equation (still a fraction after ×d)', eq: JSON.stringify(eq6), after: JSON.stringify(afterEq6) });
      }

      // Forme "identité + produit" : un ProductGroup à 2 facteurs vient s'ajouter à une
      // différence de carrés non factorisée.
      var eq7 = window.App.Generator.generateIdentityPlusProduct();
      window.App.History.startNewEquation(eq7);
      var last7 = eq7.left[eq7.left.length - 1];
      if (!window.App.Expr.isProductGroup(last7) || last7.factors.length !== 2) {
        fails.push({ gen: 'identity-plus-product (no trailing 2-factor ProductGroup)', eq: JSON.stringify(eq7) });
      }

      // Forme "trinôme - carré" : Factoriser le trinôme (identité 1 ou 2) doit redonner un
      // carré de signe +, prêt pour Expr.factorDifferenceOfTwoSquareGroups avec le carré de
      // signe - déjà présent (voir generateTrinomialMinusSquareGroup).
      var eq8 = window.App.Generator.generateTrinomialMinusSquareGroup();
      window.App.History.startNewEquation(eq8);
      window.App.History.toggleTermSelection('left', 0);
      window.App.History.toggleTermSelection('left', 1);
      window.App.History.toggleTermSelection('left', 2);
      var shape8 = window.App.History.getFactorTargetShape();
      if (!shape8) {
        fails.push({ gen: 'trinomial-minus-square (trinomial not recognized as identity)', eq: JSON.stringify(eq8), shape: JSON.stringify(shape8) });
      }
    }
    return fails;
  });
  ok('100x each: every generated shape is recognized by its intended solving mechanism', targeted.length === 0);
  if (targeted.length) console.log(JSON.stringify(targeted.slice(0, 5), null, 2));

  // Round-trip via le VRAI bouton "Générer aléatoirement" (LaTeX -> pont MathLive -> AST),
  // plusieurs fois, pour attraper un problème de sérialisation (ex. un type de noeud non
  // géré par App.Expr.sideLatex, ou par le pont parseLatexEquation dans parser.js) qui ne
  // se verrait pas en passant l'objet directement à startNewEquation.
  let roundTripFails = 0;
  for (let i = 0; i < 60; i++) {
    await page.click('#newEquationBtn');
    await page.click('#randomGenerate');
    const raw = await page.evaluate(() => window.App.MathKeypad.getLatex());
    await page.click('.math-keypad-keys .panel-confirm-cell');
    // Le modal se ferme désormais avec un fondu (voir VANISH_MS dans newEquationModal.js) :
    // laisser le temps à la transition avant de vérifier `hidden` plus bas.
    await page.waitForTimeout(220);
    const errorAfter = await page.$eval('#manualError', (el) => el.textContent);
    const modalStillOpen = await page.evaluate(() => !document.getElementById('modalOverlay').hidden);
    if (errorAfter || modalStillOpen) {
      roundTripFails++;
      console.log('FAIL round-trip on:', JSON.stringify(raw), 'error:', JSON.stringify(errorAfter));
    }
    if (modalStillOpen) await page.click('#modalClose');
  }
  ok('60 random-generate + confirm round-trips: none left an error or open modal', roundTripFails === 0);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
