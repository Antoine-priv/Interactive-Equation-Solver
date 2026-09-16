const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function findSqrtKey(page) {
  return page.$('[data-key="sqrt"]');
}

async function wrapEquation(page, raw) {
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, raw);
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.toggleSquareRootArmed();
    window.App.History.confirmSquareRoot();
  });
}

// "Simplifier" (étape 2 de "Racine carrée") dépend maintenant de QUEL membre est
// sélectionné (voir squareRootSimplifyAction dans history.js) : seule la constante
// sélectionnée -> la calcule seule ('calc', pas de scission) ; seul le carré sélectionné ->
// annule racine+carré et scinde en ± SANS toucher l'autre membre ('split') ; les DEUX ->
// les deux à la fois, comme avant ('both').
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);

  // --- 1) 'calc' : ne sélectionner QUE le membre "constante" (droite, √9) calcule
  // uniquement CE membre, sans scinder ni toucher le membre "carré" (gauche). ---
  await wrapEquation(page, '(x+3)^2=9');
  const calcOnly = await page.evaluate(() => {
    window.App.History.toggleTermSelection('right', 0);
    var action = window.App.History.squareRootAction();
    var previewBefore = window.App.History.previewSquareRoot();
    var ok = window.App.History.confirmSquareRoot();
    return { action, previewBefore, ok, eq: window.App.History.lastEquation(), branches: window.App.History.getBranches() };
  });
  console.log('1) calc-only:', JSON.stringify(calcOnly));
  ok('1) detected mode is "calc" on the right side', calcOnly.action && calcOnly.action.mode === 'calc' && calcOnly.action.side === 'right');
  ok('1) preview is a single (non-forked) equation', calcOnly.previewBefore && calcOnly.previewBefore.length === 1);
  ok('1) confirm succeeds, no branches created', calcOnly.ok === true && calcOnly.branches === null);
  ok('1) left side untouched (still √((x+3)²))', calcOnly.eq &&
    JSON.stringify(calcOnly.eq.left) === JSON.stringify([{ sign: 1, radicand: [{ sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 2 }] }] }]));
  ok('1) right side computed to plain 3', JSON.stringify(calcOnly.eq.right) === JSON.stringify([{ coeff: 3, pow: 0 }]));

  await page.screenshot({ path: `${SCRATCH}/sqrt_calc_only.png` });

  // --- 2) From there, 'split' : selecting ONLY the square side (left) now cancels
  // √+square and forks ±, using the ALREADY-resolved right side (3) as-is for each branch
  // — same end result as doing 'both' in one shot. ---
  const splitAfterCalc = await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    var action = window.App.History.squareRootAction();
    var previewBefore = window.App.History.previewSquareRoot();
    var ok = window.App.History.confirmSquareRoot();
    var branches = window.App.History.getBranches();
    return { action, previewBefore, ok, branches: branches ? branches.map((b) => b.lastEquation()) : null };
  });
  console.log('2) split-after-calc:', JSON.stringify(splitAfterCalc));
  ok('2) detected mode is "split" on the left side', splitAfterCalc.action && splitAfterCalc.action.mode === 'split' && splitAfterCalc.action.side === 'left');
  ok('2) preview already shows the ± fork (2 equations)', splitAfterCalc.previewBefore && splitAfterCalc.previewBefore.length === 2);
  ok('2) confirm forks into exactly 2 branches', splitAfterCalc.ok === true && splitAfterCalc.branches && splitAfterCalc.branches.length === 2);
  ok('2) branch 0 is x+3=3', splitAfterCalc.branches && JSON.stringify(splitAfterCalc.branches[0]) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 3, pow: 0 }] }));
  ok('2) branch 1 is x+3=-3', splitAfterCalc.branches && JSON.stringify(splitAfterCalc.branches[1]) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -3, pow: 0 }] }));

  // --- 3) 'split' FIRST (before ever computing the constant side) : forks into ± with the
  // OTHER side left exactly as-is ("√9" / "-√9"), each branch independently simplifiable
  // afterward — the two orders (calc-then-split, split-then-calc) must reach the same
  // final numbers. ---
  await wrapEquation(page, '(x+3)^2=9');
  const splitFirst = await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    var action = window.App.History.squareRootAction();
    var ok = window.App.History.confirmSquareRoot();
    var branches = window.App.History.getBranches();
    return { action, ok, branches: branches ? branches.map((b) => b.lastEquation()) : null };
  });
  console.log('3) split-first:', JSON.stringify(splitFirst));
  ok('3) detected mode is "split" on the left side', splitFirst.action && splitFirst.action.mode === 'split' && splitFirst.action.side === 'left');
  ok('3) forks into 2 branches, right side left as √9 / -√9',
    splitFirst.branches && splitFirst.branches.length === 2 &&
    JSON.stringify(splitFirst.branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ sign: 1, radicand: [{ coeff: 9, pow: 0 }] }] }) &&
    JSON.stringify(splitFirst.branches[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ sign: -1, radicand: [{ coeff: 9, pow: 0 }] }] }));

  // Simplify branch 0's remaining "√9" independently (mode 'calc' again, now on a plain
  // Side rather than a fresh wrap): should reach x+3=3, same as before.
  const branch0Calc = await page.evaluate(() => {
    window.App.History.focusBranch(0);
    var b0 = window.App.History.getBranches()[0];
    b0.toggleTermSelection('right', 0);
    var ok = b0.confirmSquareRoot();
    return { ok, eq: b0.lastEquation() };
  });
  ok('3a) branch 0 independently simplifies "√9" to 3', branch0Calc.ok === true &&
    JSON.stringify(branch0Calc.eq) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 3, pow: 0 }] }));

  // Simplify branch 1's remaining "-√9" independently: should reach x+3=-3 (the sign is
  // carried through correctly, not an error — see detectSquareRootSide/resultSign).
  const branch1Calc = await page.evaluate(() => {
    var b1 = window.App.History.getBranches()[1];
    b1.toggleTermSelection('right', 0);
    var ok = b1.confirmSquareRoot();
    return { ok, eq: b1.lastEquation() };
  });
  ok('3b) branch 1 independently simplifies "-√9" to -3 (not an error)', branch1Calc.ok === true &&
    JSON.stringify(branch1Calc.eq) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -3, pow: 0 }] }));

  // --- 4) 'both' : selecting the two sides together still does exactly what the single
  // button used to do with no selection at all (regression, see sqrt_and_nfactor.js too). ---
  await wrapEquation(page, '(x+3)^2=9');
  const both = await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('right', 0);
    var action = window.App.History.squareRootAction();
    var ok = window.App.History.confirmSquareRoot();
    var branches = window.App.History.getBranches();
    return { action, ok, branches: branches ? branches.map((b) => b.lastEquation()) : null };
  });
  ok('4) detected mode is "both"', both.action && both.action.mode === 'both');
  ok('4) forks into the same 2 fully-computed branches', both.ok === true && both.branches && both.branches.length === 2 &&
    JSON.stringify(both.branches[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 3, pow: 0 }] }) &&
    JSON.stringify(both.branches[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -3, pow: 0 }] }));

  // --- 5) UI-level: the "Simplifier" button/preview really do react to a real selection,
  // not just the direct API — click the actual button. Page fraîche (pas celle des cas
  // 1-4 ci-dessus) : la transition CSS de visibilité du bouton (voir setRowVisibility dans
  // toolbar.js) peut rester "en vol" après une longue rafale d'actions synchrones sans
  // vraie image peinte entre chacune, un artefact de test plutôt qu'un vrai bug (voir
  // App.Toolbar.computeSelectionInfo(), correcte, dans les cas 1-4 ci-dessus).
  const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page2.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page2.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page2.goto(FILE);
  await wrapEquation(page2, '(x+3)^2=9');
  await page2.waitForTimeout(150);
  const simplifyBtn = await page2.$('button[data-op="simplify"]');
  const disabledNoSel = await simplifyBtn.evaluate((el) => el.disabled || el.closest('.op-row').hidden);
  ok('5) "Simplifier" disabled with nothing selected', disabledNoSel === true);
  await page2.evaluate(() => { window.App.History.toggleTermSelection('right', 0); });
  await page2.waitForTimeout(80);
  const enabledCalcSel = await simplifyBtn.evaluate((el) => !el.disabled && !el.closest('.op-row').hidden);
  ok('5) "Simplifier" enabled once the constant side alone is selected', enabledCalcSel);
  await simplifyBtn.hover();
  await page2.waitForTimeout(120);
  const calcPreviewCols = await page2.evaluate(() => document.querySelectorAll('.produit-nul-preview .produit-nul-branch').length);
  ok('5) hovering with only the constant side selected shows NO fork columns (calc, not split)', calcPreviewCols === 0);
  await simplifyBtn.click();
  await page2.waitForTimeout(120);
  const afterUiCalc = await page2.evaluate(() => window.App.History.lastEquation());
  ok('5) clicking computed only the right side via the real button', JSON.stringify(afterUiCalc.right) === JSON.stringify([{ coeff: 3, pow: 0 }]));

  await page2.evaluate(() => { window.App.History.toggleTermSelection('left', 0); });
  await page2.waitForTimeout(80);
  await simplifyBtn.hover();
  await page2.waitForTimeout(120);
  const splitPreviewCols = await page2.evaluate(() => document.querySelectorAll('.produit-nul-preview .produit-nul-branch').length);
  ok('5) hovering with only the square side selected shows the ± fork (2 columns)', splitPreviewCols === 2);

  await page2.screenshot({ path: `${SCRATCH}/sqrt_split_only_preview.png` });
  await page2.close();

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
