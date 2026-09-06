const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
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
  }

  // --- Test 1 : signe "-" devant la parenthese -> "-(2x+3)" ---
  await page.goto(FILE);
  await applyChain('x=5', '\\times-(2x+3)');
  const step1 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×-(2x+3):', JSON.stringify(step1.equation));
  ok('negated terms: [-2x, -3]', JSON.stringify(step1.equation.left[0].factors[1].terms) ===
    JSON.stringify([{ coeff: -2, pow: 1 }, { coeff: -3, pow: 0 }]));

  // --- Test 2 : erreur si on valide avec une parenthese non fermee ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('\\times(5');
    window.App.History.confirm();
  });
  let pending = await page.evaluate(() => window.App.History.getPending());
  console.log('erreur apres validation avec parenthese ouverte:', JSON.stringify(pending.error));
  ok('confirm with unclosed paren surfaces an error', !!pending.error);

  // --- Test 3 : simple facteur numerique nu reste inchange (ex "×3", sans parenthese) ---
  await applyChain('2x=6', '\\times3');
  const step3 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×3 (simple, sans parenthese, attendu direct 6x=18):', JSON.stringify(step3.equation));
  ok('bare scalar × still scales directly (no ProductGroup wrapping)', JSON.stringify(step3.equation.left) === JSON.stringify([{ coeff: 6, pow: 1 }]));

  // --- Test 4 : clavier physique pour composer "(4+x)" (arme × puis tape nativement dans le champ) ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.keyboard.press('*'); // arme × et insere "\times" dans le champ desormais focalise
  await page.waitForTimeout(60);
  await page.keyboard.type('(4+x)');
  await page.waitForTimeout(60);
  const latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex via clavier physique (attendu contenant "4" et "x"):', JSON.stringify(latex));
  ok('physical keyboard can compose (4+x) too', /\\times/.test(latex) && /4/.test(latex) && /x/.test(latex));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const step4 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres clavier physique:', JSON.stringify(step4.equation));
  ok('physical-keyboard-composed factor applies correctly', JSON.stringify(step4.equation.left[0].factors[1].terms) ===
    JSON.stringify([{ coeff: 4, pow: 0 }, { coeff: 1, pow: 1 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
