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
      if (App.Expr.isProductGroup(n)) {
        return { sign: n.sign, factors: n.factors.map(function (f) { return { terms: f.terms.map(roundNode), exponent: f.exponent }; }) };
      }
      if (App.Expr.isFactorGroup(n)) {
        return { sign: n.sign, factor: roundNode(n.factor), innerTerms: n.innerTerms.map(roundNode) };
      }
      return { coeff: Math.round(n.coeff * 1e6) / 1e6, pow: n.pow };
    }
    function sideEq(a, b) { return JSON.stringify(a.map(roundNode)) === JSON.stringify(b.map(roundNode)); }

    // generateVariableDenominatorEquation (voir generator.js/CLAUDE.md) construit
    // délibérément un FactorGroup.isExpressionQuotient DIRECTEMENT en AST — la seule
    // forme que generateEquation() puisse produire que parser.js ne sait PAS relire
    // (\frac exige toujours un dénominateur numérique) : hors-sujet pour ce fuzz du
    // round-trip texte, skippée ici plutôt que comptée en échec (voir aussi
    // generateRoundTrippableEquation dans newEquationModal.js, qui applique la même
    // exclusion côté "Générer aléatoirement" réel).
    var mismatches = 0, parseFails = 0, tripleCount = 0, skipped = 0, total = 4000;
    var firstFails = [];
    for (var i = 0; i < total; i++) {
      var eq = App.Generator.generateEquation();
      if (eq.left.concat(eq.right).some(function (n) { return App.Expr.isExpressionQuotient(n); })) {
        skipped++;
        continue;
      }
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
    return { mismatches: mismatches, parseFails: parseFails, tripleCount: tripleCount, skipped: skipped, total: total, firstFails: firstFails };
  });

  console.log('round-trip fuzz result:', JSON.stringify({ mismatches: result.mismatches, parseFails: result.parseFails, tripleCount: result.tripleCount, skipped: result.skipped, total: result.total }));
  if (result.firstFails.length) console.log('first failures:', JSON.stringify(result.firstFails, null, 2));
  ok('zero structural mismatches across ' + result.total + ' generated equations', result.mismatches === 0);
  ok('zero parse failures across ' + result.total + ' generated equations', result.parseFails === 0);
  ok('the new 3-factor generator was actually exercised (non-zero count)', result.tripleCount > 0);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
