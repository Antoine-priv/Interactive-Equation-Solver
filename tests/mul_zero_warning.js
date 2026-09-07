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
    await page.waitForTimeout(150);
  }

  function lastLabels() {
    return page.evaluate(() => {
      var labels = Array.from(document.querySelectorAll('.arrow-label'));
      return labels.map((el) => {
        var ann = el.querySelector('.katex-mathml annotation');
        return { text: el.textContent, warn: el.classList.contains('arrow-label-warning'), source: ann ? ann.textContent : null };
      });
    });
  }

  await page.goto(FILE);

  // --- Test 1 : ×(x+5), le multiplicateur depend de x -> etiquette "valide si" + classe d'alerte ---
  await applyChain('x=5', '\\times\\left(x+5\\right)');
  let labels = await lastLabels();
  console.log('etiquettes apres ×(x+5):', JSON.stringify(labels));
  ok('×(x+5) shows the "valide si ... != 0" caveat', labels.some((l) => /valide/.test(l.text) && /≠/.test(l.text)));
  ok('×(x+5) marks both arrow labels as warning', labels.length === 2 && labels.every((l) => l.warn));
  await page.screenshot({ path: `${SCRATCH}/mul_zero_warning_expr.png` });

  // --- Test 2 : ×5 (multiplicateur numerique pur) -> pas d'avertissement ---
  await applyChain('x=5', '\\times5');
  labels = await lastLabels();
  console.log('etiquettes apres ×5:', JSON.stringify(labels));
  ok('×5 (plain number) has no zero-risk caveat', labels.length === 2 && labels.every((l) => !l.warn && !/valide/.test(l.text)));

  // --- Test 3 : ×x nu (bare, depend de x) -> avertissement ---
  await applyChain('x=5', '\\times x');
  labels = await lastLabels();
  console.log('etiquettes apres ×x:', JSON.stringify(labels));
  ok('×x (bare, depends on x) still gets the caveat', labels.length === 2 && labels.every((l) => l.warn));

  // --- Test 3b (regression) : ×x+2, une chaine avec une op a risque PUIS une op sans
  // risque -> la reserve doit venir a la toute fin de la chaine ("×(x)+2 valide si..."),
  // jamais collee juste apres l'operation a risque (ce qui donnerait a tort l'impression
  // que le "+2" fait partie de la condition, ex. "...≠0+2").
  await applyChain('x=5', '\\times x+2');
  labels = await lastLabels();
  console.log('etiquettes apres ×x+2:', JSON.stringify(labels));
  ok('×x+2 keeps the caveat at the end of the whole chain, after "+2"', labels.length === 2 &&
    labels.every((l) => l.text.indexOf('+2') !== -1 && l.text.indexOf('valide') > l.text.indexOf('+2')));

  // --- Test 3c : ×5x^2 (multiplicateur reduit a un seul terme "plat", avec coefficient
  // ET exposant) -> ni la chaine ni la reserve ne doivent parenthèser ce terme (ex.
  // "×5x^2 valide si 5x^2≠0", pas "×(5x^2) valide si (5x^2)≠0") : contrairement a une
  // somme, un monome seul n'a aucune ambiguite a lever.
  await applyChain('x=5', '\\times5x^2');
  labels = await lastLabels();
  console.log('etiquettes apres ×5x^2:', JSON.stringify(labels));
  ok('×5x^2 (bare monomial) drops the parens around the multiplier and the condition',
    labels.length === 2 && labels.every((l) => l.source && l.source.indexOf('\\left(') === -1 &&
      /valide si\s*\}\s*5x\^2\\neq0/.test(l.source)));

  // --- Test 3d (regression) : ×(x+5) (une VRAIE somme) garde ses parentheses, dans la
  // chaine ET dans la reserve — seule une somme risque de se confondre avec l'operation
  // suivante de la chaine.
  await applyChain('x=5', '\\times\\left(x+5\\right)');
  labels = await lastLabels();
  ok('×(x+5) (a real sum) keeps its parens in both the chain and the condition',
    labels.length === 2 && labels.every((l) => l.source && /\\left\(x\s*\+\s*5\\right\)/.test(l.source) &&
      /valide si\s*\}\s*\\left\(x\s*\+\s*5\\right\)\\neq0/.test(l.source)));

  // --- Test 4 : +5 (pas une multiplication) -> pas d'avertissement ---
  await applyChain('x=5', '+5');
  labels = await lastLabels();
  console.log('etiquettes apres +5:', JSON.stringify(labels));
  ok('+5 (addition, not multiplication) has no caveat', labels.length === 2 && labels.every((l) => !l.warn));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
