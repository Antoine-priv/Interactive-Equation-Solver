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

  await page.goto(FILE);

  // --- 1) Tooltips : plus de "cliquez ici" ---
  const factorTip = await page.getAttribute('button[data-op="factor"]', 'data-tooltip');
  const expandTip = await page.getAttribute('button[data-op="expand"]', 'data-tooltip');
  const pnTip = await page.getAttribute('button[data-op="produitnul"]', 'data-tooltip');
  console.log('factor tooltip:', JSON.stringify(factorTip));
  console.log('expand tooltip:', JSON.stringify(expandTip));
  console.log('produitnul tooltip:', JSON.stringify(pnTip));
  ok('factor tooltip has no "cliquez ici"', !/cliquez ici/.test(factorTip || ''));
  ok('expand tooltip has no "cliquez ici"', !/cliquez ici/.test(expandTip || ''));
  ok('produitnul tooltip has no "cliquez ici"', !/cliquez ici/.test(pnTip || ''));

  // --- 2) Réordonnancement des termes à l'intérieur d'une parenthèse ---
  // La saisie manuelle ne sait pas créer directement un FactorGroup (coefficient x
  // parenthèse) : on construit "6x+2+10x=0", puis on factorise réellement par 2 via les
  // actions normales de l'appli (Factoriser -> Facteur commun -> "2" -> Valider) pour
  // obtenir "2(3x+1+5x)=0", 3 termes intérieurs, avant d'y "entrer".
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x+2+10x=0');

  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 0);
    H.toggleTermSelection('left', 1);
    H.toggleTermSelection('left', 2);
    H.enterFactorWithSelection();
    H.chooseFactorMode('common');
    H.setFactorTermLatex('2');
    H.confirm();
  });
  await page.waitForTimeout(100);

  const factored = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation factorisee:', JSON.stringify(factored));
  ok('factoring produced a FactorGroup with 3 inner terms', factored.left[0] && factored.left[0].innerTerms && factored.left[0].innerTerms.length === 3);

  // "Entre" dans le groupe factorisé (équivalent au double-clic UI, voir drillIntoGroup
  // dans history.js) directement via l'API plutôt que de simuler un double-clic fragile.
  await page.evaluate(() => window.App.History.drillIntoGroup('left', 0));
  await page.waitForTimeout(100);

  const beforeOrder = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left[0].innerTerms.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre interieur avant glisser:', JSON.stringify(beforeOrder));
  ok('drilled into the group (3 inner terms)', beforeOrder.length === 3);

  // Glisser le 1er terme intérieur (x, index 0) après le 2e (2, index 1).
  const inner0 = await page.$('[data-inner-index="0"]');
  const inner1 = await page.$('[data-inner-index="1"]');
  const b0 = await inner0.boundingBox();
  const b1 = await inner1.boundingBox();

  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 8, b0.y + b0.height / 2 + 2);
  await page.mouse.move(b1.x + b1.width + 5, b1.y + b1.height / 2, { steps: 10 });
  await page.waitForTimeout(50);

  // Capture d'écran PENDANT le glisser (avant le mouseup) : le "2" (coefficient devant
  // la parenthèse) et le "= 0" doivent rester visibles.
  await page.screenshot({ path: `${SCRATCH}/inner_reorder_mid_drag.png` });
  const midDragText = await page.evaluate(() => document.querySelector('.eq-row.current .side[data-side="left"]').textContent);
  console.log('texte du membre gauche PENDANT le glisser:', JSON.stringify(midDragText));
  ok('coefficient "2" still visible outside the parens during drag', /2/.test(midDragText));

  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterOrder = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left[0].innerTerms.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre interieur apres glisser:', JSON.stringify(afterOrder));
  ok('inner order actually changed via drag', JSON.stringify(afterOrder) !== JSON.stringify(beforeOrder));
  ok('same set of terms, no data loss', afterOrder.slice().sort().join(',') === beforeOrder.slice().sort().join(','));

  // Toujours "entré" dans le groupe après le glisser (pas ressorti par erreur).
  const stillDrilled = await page.evaluate(() => !!window.App.History.getPending().drilled);
  ok('still drilled into the group after drag (did not exit)', stillDrilled);

  await page.screenshot({ path: `${SCRATCH}/inner_reorder.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
