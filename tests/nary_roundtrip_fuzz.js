const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Fuzz de round-trip pour la généralisation N-aire de ProductGroup : génère des milliers
// d'équations (y compris la nouvelle generateTripleProductEquation, voir generator.js),
// les sérialise en LaTeX via App.Expr.sideLatex (déjà utilisé pour "Générer aléatoirement"
// dans la modale), puis les ré-analyse via le pont MathLive (parseLatexEquation, voir
// parser.js) — même principe que le fuzz déjà utilisé pour la Phase A du clavier unifié,
// étendu ici pour couvrir le nouveau modèle de données {sign, factors:[{terms,exponent}]}.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const result = await page.evaluate(() => {
    var App = window.App;
    function roundNode(n) {
      if (App.Expr.isSqrtGroup(n)) {
        return { sign: n.sign, radicand: n.radicand.map(roundNode) };
      }
      if (App.Expr.isProductGroup(n)) {
        return { sign: n.sign, factors: n.factors.map(function (f) { return { terms: f.terms.map(roundNode), exponent: f.exponent }; }) };
      }
      if (App.Expr.isFactorGroup(n)) {
        // isExpressionQuotient (voir expression.js) : `factorTerms` (un Side) remplace
        // `factor` entièrement — round-trippe désormais aussi (voir stripHtmlWrappers/
        // splitTopLevelEquals dans parser.js), donc plus jamais exclu de ce fuzz (voir
        // plus haut) : sans ce cas, roundNode(undefined) plantait ici.
        if (n.factorTerms) {
          return { sign: n.sign, factorTerms: n.factorTerms.map(roundNode), innerTerms: n.innerTerms.map(roundNode) };
        }
        // "\frac{x}{d}"/"\frac{-x}{d}" (numérateur "simple" — x/-x nu, jamais suivi d'un
        // coefficient — voir SIMPLE_FRAC_NUMER_RE/parser.js) avec un dénominateur
        // NUMÉRIQUE : le parseur replie TOUJOURS cette forme précise en un coefficient
        // décimal, quelle que soit la forme d'origine — generateFractionEquation, lui,
        // construit TOUJOURS une fraction AFFICHÉE (jamais repliée), y compris quand son
        // numérateur se trouve être ce cas "simple" (ex. a=±1, b=0 -> juste "x"/"-x").
        // Les deux round-trippent donc bien vers LA MÊME valeur mathématique, jamais
        // comptées différentes ici (pré-existant, repéré via `git stash` avant cette
        // fonctionnalité — pas un problème introduit par elle).
        if (n.isDivision && n.innerTerms.length === 1 && !App.Expr.isGroup(n.innerTerms[0])) {
          var only = n.innerTerms[0];
          var isSimpleNumer = (only.pow === 1 && Math.abs(only.coeff) === 1) || only.pow === 0;
          if (isSimpleNumer) {
            return roundNode({ coeff: n.sign * only.coeff / n.factor.coeff, pow: only.pow });
          }
        }
        return { sign: n.sign, factor: roundNode(n.factor), innerTerms: n.innerTerms.map(roundNode) };
      }
      return { coeff: Math.round(n.coeff * 1e6) / 1e6, pow: n.pow };
    }
    function sideEq(a, b) { return JSON.stringify(a.map(roundNode)) === JSON.stringify(b.map(roundNode)); }

    // Un dénominateur-expression (isExpressionQuotient, generateVariableDenominatorEquation)
    // ET un radicand-expression au premier niveau (isSqrtGroup,
    // generateVariableRadicandEquation/generateVariableRadicandQuadraticEquation)
    // round-trippent tous deux désormais (voir stripHtmlWrappers/splitTopLevelEquals et
    // parseWholeSqrtSide dans parser.js) — plus rien à exclure de ce fuzz.
    var mismatches = 0, parseFails = 0, tripleCount = 0, total = 4000;
    var firstFails = [];
    for (var i = 0; i < total; i++) {
      var eq = App.Generator.generateEquation();
      var latex = App.Expr.sideLatex(eq.left) + '=' + App.Expr.sideLatex(eq.right);
      if (eq.left.length === 1 && App.Expr.isProductGroup(eq.left[0]) && eq.left[0].factors.length === 3) tripleCount++;
      try {
        var back = App.Parser.parseLatexEquation(latex);
        if (!sideEq(eq.left, back.left) || !sideEq(eq.right, back.right)) {
          mismatches++;
          if (firstFails.length < 5) firstFails.push({ type: 'mismatch', latex: latex, orig: JSON.stringify(eq), back: JSON.stringify(back) });
        }
      } catch (e) {
        parseFails++;
        if (firstFails.length < 5) firstFails.push({ type: 'parse', latex: latex, error: e.message });
      }
    }
    return { mismatches: mismatches, parseFails: parseFails, tripleCount: tripleCount, total: total, firstFails: firstFails };
  });

  console.log('round-trip fuzz result:', JSON.stringify({ mismatches: result.mismatches, parseFails: result.parseFails, tripleCount: result.tripleCount, total: result.total }));
  if (result.firstFails.length) console.log('first failures:', JSON.stringify(result.firstFails, null, 2));
  ok('zero structural mismatches across ' + result.total + ' generated equations', result.mismatches === 0);
  ok('zero parse failures across ' + result.total + ' generated equations', result.parseFails === 0);
  ok('the new 3-factor generator was actually exercised (non-zero count)', result.tripleCount > 0);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
