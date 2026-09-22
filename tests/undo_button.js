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
  // { left, right } only, NOT the raw parseEquation() result (which also carries an
  // `operator` key, null here) — init() stores whatever object it's given as-is (see
  // history.js), so passing the raw parse result would leak that extra key into
  // lastEquation() below (line 42) and break its exact-JSON comparison. Same convention
  // as newEquationModal.js/submitManual (operator threaded via a separate `opts` arg).
  await page.evaluate((eq) => {
    var parsed = window.App.Parser.parseEquation(eq);
    window.App.History.startNewEquation({ left: parsed.left, right: parsed.right }, parsed.operator ? { operator: parsed.operator } : undefined);
  }, 'x+2=5');
  await page.waitForTimeout(100);

  // 1) Juste apres une nouvelle equation (1 seul step) : undo doit etre desactive.
  let disabled = await page.evaluate(() => document.getElementById('undoBtn').disabled);
  ok('undo disabled right after a fresh equation (only 1 step)', disabled === true);

  // 2) Une operation -> undo doit devenir actif, et cliquer dessus doit revenir en arriere.
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('-2');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  disabled = await page.evaluate(() => document.getElementById('undoBtn').disabled);
  ok('undo enabled after a real step', disabled === false);

  const stepsBefore = await page.evaluate(() => window.App.History.getSteps().length);
  await page.click('#undoBtn');
  await page.waitForTimeout(150);
  const stepsAfter = await page.evaluate(() => window.App.History.getSteps().length);
  const eqAfterUndo = await page.evaluate(() => window.App.History.lastEquation());
  console.log('steps avant/apres undo:', stepsBefore, stepsAfter, 'equation:', JSON.stringify(eqAfterUndo));
  ok('undo removed exactly one step', stepsAfter === stepsBefore - 1);
  ok('undo restored the original equation (x+2=5)', JSON.stringify(eqAfterUndo) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], right: [{ coeff: 5, pow: 0 }] }));

  disabled = await page.evaluate(() => document.getElementById('undoBtn').disabled);
  ok('undo disabled again after returning to the initial equation', disabled === true);

  // 3) Undo d'une scission "Produit nul" : retour a l'equation avant la scission.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(300);

  const hasBranchesBefore = await page.evaluate(() => !!window.App.History.getBranches());
  ok('branches exist right after confirming produit nul', hasBranchesBefore);
  disabled = await page.evaluate(() => document.getElementById('undoBtn').disabled);
  ok('undo enabled right after a split', disabled === false);

  await page.click('#undoBtn');
  await page.waitForTimeout(300);
  const hasBranchesAfter = await page.evaluate(() => !!window.App.History.getBranches());
  const eqAfterSplitUndo = await page.evaluate(() => window.App.History.lastEquation());
  console.log('branches apres undo:', hasBranchesAfter, 'equation:', JSON.stringify(eqAfterSplitUndo));
  ok('undo dissolved the split (no more branches)', hasBranchesAfter === false);
  ok('back to the pre-split equation (x+2)(x+3)=0', JSON.stringify(eqAfterSplitUndo.right) === JSON.stringify([{ coeff: 0, pow: 0 }]));

  await page.screenshot({ path: `${SCRATCH}/undo_button.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
