const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// La composition d'un facteur "×" dans le champ mathématique unifié (ex. "2(3x+5") ne
// doit plus s'afficher dans un panneau à part ("facteur : …", retiré) : le texte tapé est
// visible directement dans le champ lui-même. L'aperçu en direct (ligne "pending", voir
// parseExprChain dans history.js) est TOLÉRANT : il garde le plus long préfixe d'opérandes
// valides et se tait silencieusement sur le reste tant que ce n'est pas complet (ex. une
// parenthèse pas encore refermée), plutôt que d'afficher le texte brut tel quel comme
// l'ancien système.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  // 'x=5' est déjà résolue : la fenêtre d'action est masquée dessus (voir positionPanel
  // dans toolbar.js), donc pas de bouton "Opération" à cliquer — on entre en mode 'expr'
  // via l'API directement.
  await page.evaluate(() => { window.App.History.selectOp('expr'); });
  await page.waitForTimeout(80);

  const operandDisplayGone = await page.$('.operand-display');
  ok('no "facteur : …" panel shown for the Opération keypad', operandDisplayGone === null);

  function setChain(latex) {
    return page.evaluate((l) => { window.App.History.setExprChainText(l); }, latex);
  }
  function getPendingError() {
    return page.evaluate(() => window.App.History.getPending().error);
  }

  // Tant que la parenthèse n'est pas refermée, aucun aperçu ne doit planter/produire
  // d'erreur affichée (le préfixe invalide est juste ignoré, voir parseExprChain tolerant).
  await setChain('\\times2(3x+5');
  await page.waitForTimeout(60);
  let err = await getPendingError();
  ok('no error shown while the paren is still open (tolerant preview)', !err);

  // Une fois la parenthèse refermée, le champ contient une chaîne complète et valide.
  await setChain('\\times2(3x+5)');
  await page.waitForTimeout(60);
  err = await getPendingError();
  ok('still no error once the full chain is valid (not yet confirmed)', !err);

  await page.screenshot({ path: `${SCRATCH}/multiply_live_label_mid_typing.png` });

  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('final equation:', JSON.stringify(step.equation));
  // "2(3x+5)" se déplie en 2 facteurs distincts du produit (coefficient "2" PUIS "(3x+5)",
  // voir operandFactors dans expression.js et multiply_coeff_paren.js) — jamais un
  // FactorGroup imbriqué comme facteur unique.
  ok('confirmed equation is correct (x)(2)(3x+5)=... ', step.equation.left[0].factors.length === 3 &&
    JSON.stringify(step.equation.left[0].factors[1]) === JSON.stringify({ terms: [{ coeff: 2, pow: 0 }], exponent: 1 }) &&
    JSON.stringify(step.equation.left[0].factors[2]) === JSON.stringify({ terms: [{ coeff: 3, pow: 1 }, { coeff: 5, pow: 0 }], exponent: 1 }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
