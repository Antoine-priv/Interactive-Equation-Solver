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

  // --- Test 3b : annulation — "x÷x" et ses formes dérivées (le membre ENTIER, pas
  // seulement un facteur/une fraction déjà en place, vaut structurellement le diviseur,
  // au signe près) — voir le cas ajouté en tête de wrapSideInQuotient (expression.js).
  await applyChain('x=5', '\\div x');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('x÷x cancels to 1 (not a "x/x" fraction)',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 1, pow: 0 }]));

  await applyChain('-x=5', '\\div x');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('-x÷x cancels to -1',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: -1, pow: 0 }]));

  await applyChain('3x=5', '\\div3x');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('3x÷3x cancels to 1',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 1, pow: 0 }]));

  await applyChain('x-3=5', '\\div(x-3)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('(x-3)÷(x-3) cancels to 1 (multi-term side, not just a single Term)',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 1, pow: 0 }]));

  await applyChain('x-3=5', '\\div(3-x)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('(x-3)÷(3-x) cancels to -1 (opposite expression)',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: -1, pow: 0 }]));

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

  // --- Test 5b (régression, bug rapporté par l'utilisateur) : double-cliquer le
  // NUMÉRATEUR d'un "÷x" (ou toute expression) ne doit jamais faire disparaître
  // l'équation — drilledGroupLatex/drilledGroupLatexForOrder appelaient
  // Expr.termLatexBody(node.factor) sans condition, qui plantait sur un dénominateur-
  // expression (factorTerms, pas de `factor` numérique).
  await applyChain('x+3=8', '\\div x');
  const errsBeforeNumClick = errs.length;
  let box = await page.locator('.eq-row.current .side[data-side="left"] .term').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.waitForTimeout(100);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('double-clicking the numerator of ÷x drills into it (not the denominator)',
    pending.drilled && pending.drilled.side === 'left' && !pending.drilled.part);
  const bodyLen = await page.evaluate(() => document.body.innerHTML.length);
  ok('equation did not disappear (page still has real content)', bodyLen > 5000);
  ok('no JS error was thrown while drilling into the numerator', errs.length === errsBeforeNumClick);

  // --- Test 5c : dénominateur imbriqué (÷(x+1) puis ÷(x+9), qui ne s'annulent pas) —
  // ne doit ni planter au rendu, ni proposer "Développer" sur ce noeud imbriqué.
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseEquation('x=5'));
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\div(x+1)');
    window.App.History.confirm();
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\div(x+9)');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('nested quotient:', JSON.stringify(step.equation.left));
  ok('÷(x+1) then ÷(x+9) nests a quotient inside a quotient\'s numerator',
    step.equation.left[0].innerTerms[0].isDivision === true);
  box = await page.locator('.eq-row.current .side[data-side="left"] .term').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.waitForTimeout(100);
  ok('drilling into the outer numerator (itself a nested quotient) does not throw',
    await page.evaluate(() => document.body.innerHTML.length) > 5000);
  ok('"Développer" stays disabled on the nested quotient node',
    !(await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExpand)));

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
  pending = await page.evaluate(() => window.App.History.getPending());
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

  // --- Test 9 (bug rapporté) : "(x-2)^2 ÷ (x-2)" doit annuler UNE puissance du facteur
  // et donner "(x-2)", pas rester une fraction — la cancellation ne se limitait avant
  // qu'à un facteur d'exposant EXACTEMENT 1.
  await applyChain('(x-2)^2=0', '\\div(x-2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('(x-2)^2 ÷ (x-2) cancels one power, giving the flat side (x-2)',
    JSON.stringify(step.equation.left) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }]));

  await applyChain('(x-2)^3=0', '\\div(x-2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('(x-2)^3 ÷ (x-2) reduces the exponent to 2, not a full removal',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 2 }]
    }]));

  await applyChain('(x+1)(x-2)^2=0', '\\div(x-2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('(x+1)(x-2)^2 ÷ (x-2) keeps both factors, just drops one power of (x-2)',
    JSON.stringify(step.equation.left) === JSON.stringify([{
      sign: 1,
      factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }], exponent: 1 }, { terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }]
    }]));

  // --- Test 10 (bug rapporté) : un ProductGroup trouvé dans le numérateur d'une fraction
  // (ex. "(x+5)²(x-1)" dans "((x+5)²(x-1))/x") doit pouvoir glisser SES facteurs
  // individuellement, pas seulement le bloc entier — voir le marquage ajouté dans
  // drilledGroupLatex et son câblage dans renderSide (render.js).
  await applyChain('(x+5)^2(x-1)=0', '\\div x');
  box = await page.locator('.eq-row.current .side[data-side="left"] .term').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.waitForTimeout(100);
  const factorSlots = page.locator('.eq-row.current .side[data-side="left"] .factor-slot');
  ok('a ProductGroup nested in a drilled numerator gets individually draggable factor-slots',
    await factorSlots.count() === 2);
  const fBox0 = await factorSlots.nth(0).boundingBox();
  const fBox1 = await factorSlots.nth(1).boundingBox();
  await page.mouse.move(fBox0.x + fBox0.width / 2, fBox0.y + fBox0.height / 2);
  await page.mouse.down();
  await page.mouse.move(fBox1.x + fBox1.width + 10, fBox1.y + fBox1.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('dragging the first factor past the second reorders them in the numerator',
    JSON.stringify(step.equation.left[0].innerTerms[0].factors.map((f) => f.terms)) ===
    JSON.stringify([[{ coeff: 1, pow: 1 }, { coeff: -1, pow: 0 }], [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }]]));

  // --- Test 11 (bug rapporté) : "(x+9)²(x-8)/x" — après avoir drillé la fraction PUIS le
  // numérateur (ProductGroup), double-cliquer un facteur nommé (ex. "(x+9)²") doit à son
  // tour drill DEDANS pour réordonner SES propres termes ("x" et "+9") — pas juste rester
  // bloqué sur "sélectionner/glisser le facteur entier" comme avant ce correctif (voir
  // drillIntoNestedProductBranch/clickNestedFactor dans history.js, et la généralisation
  // de Expr.withProductBranchAtPath à un chemin niché de longueur > 1).
  await applyChain('(x+9)^2(x-8)=0', '\\div x');
  box = await page.locator('.eq-row.current .side[data-side="left"] .term').first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.3);
  await page.waitForTimeout(80);
  const nestedSlots = page.locator('.eq-row.current .side[data-side="left"] .factor-slot');
  const nSlot0 = await nestedSlots.nth(0).boundingBox();
  await page.mouse.click(nSlot0.x + nSlot0.width / 2, nSlot0.y + nSlot0.height / 2);
  await page.mouse.click(nSlot0.x + nSlot0.width / 2, nSlot0.y + nSlot0.height / 2);
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('double-clicking a named factor of the nested product drills into IT (path grows, branch set)',
    pending.drilled && JSON.stringify(pending.drilled.path) === '[0,0]' && pending.drilled.branch === 0);

  const nestedTerms = page.locator('.eq-row.current .side[data-side="left"] [data-inner-index]');
  ok('the factor\'s own terms ("x" and "+9") are now individually tagged', await nestedTerms.count() === 2);
  const nt0 = await nestedTerms.nth(0).boundingBox();
  const nt1 = await nestedTerms.nth(1).boundingBox();
  await page.mouse.move(nt0.x + nt0.width / 2, nt0.y + nt0.height / 2);
  await page.mouse.down();
  await page.mouse.move(nt1.x + nt1.width + 5, nt1.y + nt1.height / 2, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('swapping "x" and "+9" gives "(9+x)^2", the other factor and exponent untouched',
    JSON.stringify(step.equation.left[0].innerTerms[0].factors) === JSON.stringify([
      { terms: [{ coeff: 9, pow: 0 }, { coeff: 1, pow: 1 }], exponent: 2 },
      { terms: [{ coeff: 1, pow: 1 }, { coeff: -8, pow: 0 }], exponent: 1 }
    ]));

  ok('still drilled 2 levels deep before exiting', pending.drilled && pending.drilled.path.length === 2);
  await page.evaluate(() => window.App.History.exitDrill());
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('exiting once pops back to the numerator view (path shrinks, branch dropped)',
    pending.drilled && JSON.stringify(pending.drilled.path) === '[0]' && typeof pending.drilled.branch !== 'number');

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
