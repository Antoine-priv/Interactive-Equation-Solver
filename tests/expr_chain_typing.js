const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Le pavé "Opération" (voir js/mathKeypad.js + toolbar.js) permet désormais de taper toute
// une chaîne d'opérations ("+3-2×(5+2x)÷4") en un seul champ, confirmée en une fois — ce
// test la compose via de VRAIS clics sur les touches du pavé ancré (pas juste l'API
// App.History), pour couvrir le chemin UI complet, et vérifie qu'elle produit exactement
// le même résultat que la même chaîne appliquée directement via setExprChainText.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const START_EQ = 'x=5';
  const EXPECTED_LATEX = '+3-2\\times(5+2x)\\div4';

  // --- Chemin de référence : la même chaîne appliquée directement via l'API. ---
  const referenceEq = await page.evaluate(({ eq, latex }) => {
    window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText(latex);
    window.App.History.confirm();
    return window.App.History.lastEquation();
  }, { eq: START_EQ, latex: EXPECTED_LATEX });

  // --- Chemin testé : composée touche par touche sur le pavé ancré. ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, START_EQ);
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);

  async function clickKey(key) { await page.click('[data-key="' + key + '"]'); }

  // Compose "+3-2×(5+2x)÷4" : plus, 3, minus, 2, times, (, 5, plus, 2, x, ), div, 4.
  await clickKey('plus');
  await clickKey('3');
  await clickKey('minus');
  await clickKey('2');
  await clickKey('times');
  await clickKey('(');
  await clickKey('5');
  await clickKey('plus');
  await clickKey('2');
  await clickKey('x');
  await clickKey(')');
  await clickKey('div');
  await clickKey('4');
  await page.waitForTimeout(80);

  const midLatex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex compose via les touches du pave:', JSON.stringify(midLatex));
  ok('no error while the chain is being typed (tolerant live preview)', !(await page.evaluate(() => window.App.History.getPending().error)));

  await page.screenshot({ path: `${SCRATCH}/expr_chain_typing_mid.png` });

  await clickKey('enter');
  await page.waitForTimeout(150);

  const typedEq = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation via clics reels:', JSON.stringify(typedEq));
  console.log('equation via API directe:', JSON.stringify(referenceEq));
  ok('typing the chain via the docked keypad produces the same equation as the API path',
    JSON.stringify(typedEq) === JSON.stringify(referenceEq));

  await page.screenshot({ path: `${SCRATCH}/expr_chain_typing_done.png` });

  // --- Édition au clavier physique une fois le champ focalisé (retour arrière natif). ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  await page.keyboard.type('+8');
  await page.keyboard.press('Backspace');
  await page.keyboard.type('5');
  await page.waitForTimeout(60);
  const editedLatex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex apres frappe + retour arriere natif:', JSON.stringify(editedLatex));
  ok('native backspace in the focused field edits the chain correctly ("+8"->backspace->"+5")', editedLatex === '+5');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const editedStep = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  ok('edited chain confirms correctly (x+5=10)', JSON.stringify(editedStep.equation) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }], right: [{ coeff: 5, pow: 0 }, { coeff: 5, pow: 0 }] }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
