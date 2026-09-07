const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "÷" accepte maintenant une EXPRESSION (pas seulement un nombre), avec le même
// avertissement "valide si ...≠0" que "×" (voir isZeroRiskOp dans render.js) — voir
// wrapSideInQuotient dans expression.js pour les 3 cas d'annulation avant de vraiment
// envelopper en fraction, et pending.drilled.part==='den' pour l'interactivité du
// dénominateur (Simplifier/Factoriser/Développer/glisser-déposer, comme le numérateur).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
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

  // --- Test 1 : ÷(x+5) sur une simple somme -> enveloppe en fraction, avec le warning ---
  await applyChain('x+3=8', '\\div(x+5)');
  let step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('T1 equation:', JSON.stringify(step.equation));
  ok('÷(x+5) wraps the side as a quotient (factorTerms present, isDivision)',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1,
      factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }],
      innerTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }],
      isDivision: true
    }]));
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label')).map((el) => ({
      text: el.textContent, warn: el.classList.contains('arrow-label-warning')
    })));
  ok('shows the "valide si (x+5)≠0" caveat with the warning class',
    labels.length === 2 && labels.every((l) => l.warn && /valide/.test(l.text) && /≠/.test(l.text)));
  await page.screenshot({ path: `${SCRATCH}/divide_by_expression_basic.png` });

  // --- Test 2 : ÷5 (nombre nu) reste inchangé (régression) ---
  await applyChain('9x-6=0', '\\div2');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('regression: ÷ by a plain number still uses the old numeric fraction path',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1, factor: { coeff: 2, pow: 0 }, innerTerms: [{ coeff: 9, pow: 1 }, { coeff: -6, pow: 0 }], isDivision: true
    }]));

  // --- Test 3 : annulation — produit contenant déjà ce facteur ---
  await applyChain('(x+1)(x+9)=0', '\\div(x+9)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('÷(x+9) cancels the matching factor of (x+1)(x+9), collapsing to a plain side',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }]));

  await applyChain('(x+1)(x+2)(x+3)=0', '\\div(x+2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('÷(x+2) on a 3-factor product removes just that factor, keeping a ProductGroup',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1,
      factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 }, { terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 1 }]
    }]));

  // --- Test 4 : annulation — "k(...)" (multiplication) dont l'intérieur vaut le diviseur ---
  await applyChain('5(x+7)=0', '\\div(x+7)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('÷(x+7) on 5(x+7) reduces to the bare coefficient 5',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 5, pow: 0 }]));

  // --- Test 5 : aller-retour ÷(x+5) puis ×(x+5) redonne exactement le membre de départ ---
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseEquation('2x+3=9'));
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\div(x+5)');
    window.App.History.confirm();
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times(x+5)');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('round-trip ÷(x+5) then ×(x+5) returns exactly the original equation',
    JSON.stringify(step.equation) === JSON.stringify({ left: [{ coeff: 2, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 9, pow: 0 }] }));

  // --- Test 6 : régression — "Développer" reste désactivé pour le quotient EN ENTIER,
  // et sélectionner le noeud entier ne fait rien planter ---
  await applyChain('(x+1)(x+9)=0', '\\div(x+2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('T6 (no cancellation, wraps as quotient):', JSON.stringify(step.equation.left));
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]', { force: true });
  await page.waitForTimeout(50);
  const info = await page.evaluate(() => window.App.Toolbar.computeSelectionInfo());
  ok('selecting the whole quotient node never enables Développer/Simplifier/Factoriser',
    info.canExpand === false && info.canSimplify === false && info.canFactor === false);

  // --- Test 7 : interactivité du dénominateur — double-clic entre dedans, Simplifier
  // fonctionne à l'intérieur exactement comme dans le numérateur ---
  await applyChain('x=8', '\\div(x+2+3)');
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('double-click on the denominator drills into it (pending.drilled.part === "den")',
    pending.drilled && pending.drilled.part === 'den');
  await page.screenshot({ path: `${SCRATCH}/divide_by_expression_denominator_drilled.png` });

  await page.click('.eq-row.current .side[data-side="left"] [data-inner-index="1"]', { force: true });
  await page.click('.eq-row.current .side[data-side="left"] [data-inner-index="2"]', { force: true });
  await page.waitForTimeout(50);
  ok('"Simplifier" enabled with 2 denominator terms selected',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canSimplify));
  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(100);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('denominator "x+2+3" simplifies to "x+5", numerator untouched',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }], innerTerms: [{ coeff: 1, pow: 1 }], isDivision: true
    }]));

  // --- Test 8 : régression — Échap ressort proprement du dénominateur ---
  // (confirmer Simplifier ci-dessus a déjà appelé resetPending — on rentre à nouveau dans
  // le dénominateur du nouveau résultat pour tester Échap sur un drill non confirmé.)
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('sanity: still drilled before Échap', pending.drilled && pending.drilled.part === 'den');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(50);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('Échap exits the denominator cleanly (drilled back to null)', pending.drilled === null);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
