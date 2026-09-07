const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Multiplier les deux membres par un nombre "nu" (ex. "×5") quand un membre est DEJA un
// ProductGroup (ex. "(-4x+2+6x)(x)") doit garder ce "5" comme un nouveau facteur affiche
// en tete du produit (ex. "5(-4x+2+6x)x"), jamais le distribuer/absorber silencieusement
// dans le premier facteur existant (ce qui donnerait directement "(-20x+10+30x)x" sans
// jamais montrer d'etape de multiplication explicite — voir wrapSideInFactor dans
// expression.js, qui ne delegue plus a scaleNode pour ce cas precis).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  async function applyChain(eq, latex) {
    await page.evaluate(({ eq, latex }) => {
      window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(latex);
      window.App.History.confirm();
    }, { eq: eq, latex: latex });
    await page.waitForTimeout(150);
  }

  await page.goto(FILE);

  // --- Test 1 : membre = ProductGroup a 2 facteurs, ×5 -> 3 facteurs, "5" en tete ---
  await applyChain('(-4x+2+6x)(x)=(-8x+14+14x)(x)', '\\times5');
  let step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×5 sur un ProductGroup:', JSON.stringify(step.equation));
  function isNewLeadingFive(side) {
    return side.length === 1 && Array.isArray(side[0].factors) && side[0].factors.length === 3 &&
      JSON.stringify(side[0].factors[0]) === JSON.stringify({ terms: [{ coeff: 5, pow: 0 }], exponent: 1 });
  }
  ok('left: "5" becomes a new leading factor (3 factors total), not distributed', isNewLeadingFive(step.equation.left));
  ok('right: same for the right side', isNewLeadingFive(step.equation.right));
  ok('left: the original sum factor is untouched (-4x+2+6x, not pre-multiplied)',
    JSON.stringify(step.equation.left[0].factors[1].terms) === JSON.stringify([{ coeff: -4, pow: 1 }, { coeff: 2, pow: 0 }, { coeff: 6, pow: 1 }]));

  // --- Test 2 : ce nouveau facteur "5" reste developpable avec le facteur qui suit ---
  await page.click('.eq-row.current .side[data-side="left"] [data-branch="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-branch="1"]');
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('apres developper 5(-4x+2+6x):', JSON.stringify(step.equation.left));
  ok('"5" and "(-4x+2+6x)" develop together into "10x+10", "x" untouched',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1,
      factors: [
        { terms: [{ coeff: 10, pow: 1 }, { coeff: 10, pow: 0 }], exponent: 1 },
        { terms: [{ coeff: 1, pow: 1 }], exponent: 1 }
      ]
    }]));

  // --- Test 3 (regression) : un membre qui n'est PAS deja un ProductGroup (simple somme)
  // continue de s'envelopper normalement (comportement inchange, ex. "5(x+3)") ---
  await applyChain('x+3=0', '\\times5');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×5 sur une simple somme:', JSON.stringify(step.equation.left));
  ok('regression: a plain sum (not already a ProductGroup) still wraps as before',
    step.equation.left.length === 1 && step.equation.left[0].factor &&
    JSON.stringify(step.equation.left[0]) === JSON.stringify({
      sign: 1,
      factor: { coeff: 5, pow: 0 },
      innerTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]
    }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
