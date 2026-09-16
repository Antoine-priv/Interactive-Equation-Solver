const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Condition d'existence" (domaine de définition) : drill into a variable-denominator
// fraction's denominator (5/(x+3)=2, injected directly as an AST since the manual
// parser still requires a numeric \frac denominator — see
// generateVariableDenominatorEquation in generator.js), click the new button, and check
// it spawns an independent "denominator=0" column — clicking it again for the SAME
// denominator must pan instead of spawning a duplicate.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  ok('"Condition d\'existence" starts disabled (nothing drilled yet)',
    !(await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition)));

  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('double-click on the denominator drills into it (pending.drilled.part === "den")',
    pending.drilled && pending.drilled.part === 'den');

  ok('"Condition d\'existence" becomes enabled once drilled into the denominator',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition));
  ok('the button itself is visible (row not hidden)',
    !(await page.evaluate(() => document.querySelector('button[data-op="existence"]').closest('.op-row').hidden)));

  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${SCRATCH}/existence_condition_den_spawn.png` });

  let conditions = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('exactly one domain condition was created', conditions && conditions.length === 1);
  ok('its captured denominator is x+3', JSON.stringify(conditions[0].capturedArray) ===
    JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));
  ok('its operator is "\\neq" (denominator case)', conditions[0].operator === '\\neq');

  const domainEq = await page.evaluate(() => {
    var conds = window.App.History.getDomainConditions();
    return conds[0].engine.lastEquation();
  });
  ok('the spawned column solves "x+3 = 0" (denominator = 0)', JSON.stringify(domainEq) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));

  const domainCol = await page.$('.domain-branch[data-domain-index="0"]');
  ok('a real DOM column was rendered for this condition', !!domainCol);
  ok('the "Domaine de définition" header is shown',
    (await page.evaluate(() => document.querySelector('.domain-split-header').textContent)) === 'Domaine de définition');

  // The main equation must stay fully interactive (not frozen) alongside the new column.
  const mainStillEditable = await page.evaluate(() => window.App.History.lastEquation());
  ok('the main equation is untouched and still the active target',
    JSON.stringify(mainStillEditable.right) === JSON.stringify([{ coeff: 2, pow: 0 }]));

  // --- Dedup: exit the drill, re-drill the SAME denominator, click again -> pan, no dup ---
  // Re-center first: spawning the column above already auto-panned the viewport onto it
  // (bug fix — the view now also pans on a fresh spawn, not just a dedup click), which
  // can leave the main equation outside the viewport (especially with the wider gap
  // between the two areas — user feedback).
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.evaluate(() => window.App.History.exitDrill());
  await page.waitForTimeout(80);
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(80);
  // Through the REAL toolbar button this time (exercises App.Render.panToDomainColumn,
  // wired from toolbar.js's click handler) rather than calling the API directly.
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(400);
  conditions = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('still exactly one domain condition after the second click', conditions.length === 1);

  // --- Focus routing: working inside the domain column must not touch the main chain,
  // and clicking back on the main chain must hand focus back to it. ---
  await page.evaluate(() => window.App.History.exitDrill());
  await page.waitForTimeout(80);
  ok('focusedDomain starts at null (main chain active)',
    (await page.evaluate(() => window.App.History.getFocusedDomain())) === null);

  // First click on a not-yet-focused column only focuses it (same convention as a
  // "Produit nul" branch) — a second click is needed to actually select the term.
  const domainTermLocator = page.locator('.domain-branch[data-domain-index="0"] .side[data-side="left"] .term[data-index="0"]');
  await domainTermLocator.click();
  await page.waitForTimeout(60);
  ok('clicking a term inside the domain column focuses it',
    (await page.evaluate(() => window.App.History.getFocusedDomain())) === 0);
  await domainTermLocator.click();
  await page.waitForTimeout(60);
  ok('the domain column\'s own term got selected (delegation reached IT, not the main leaf)',
    JSON.stringify(await page.evaluate(() => window.App.History.getPending().selectedLeft)) === '[0]');

  // --- The floating action window (#opButtons) must follow the focused domain column,
  // not stay glued to the main equation (bug rapporté) ---
  await page.waitForTimeout(150);
  const panelHidden = await page.evaluate(() => document.getElementById('opButtons').hidden);
  ok('the action window is visible once a domain column is focused with a selection', !panelHidden);
  const [panelBox, colBox] = await Promise.all([
    page.locator('#opButtons').boundingBox(),
    page.locator('.domain-branch[data-domain-index="0"]').boundingBox()
  ]);
  ok('the action window is vertically near the focused domain column (not the main equation)',
    panelBox && colBox && Math.abs((panelBox.y + panelBox.height / 2) - (colBox.y + colBox.height / 2)) < colBox.height);

  // --- Solve this focused domain column ("x+3=0" -> "x=-3") through the SHARED
  // "Opération" flow (App.History, still delegating to the focused domain engine) and
  // check the final row is relabeled "≠" (this value is EXCLUDED, not a solution). ---
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText('-3');
    window.App.History.confirm();
  });
  await page.waitForTimeout(150);
  // Bug rapporté : "≠" doit s'afficher sur TOUTE ligne de la colonne (pas seulement la
  // toute dernière une fois résolue) — dès cette étape intermédiaire, pas encore résolue
  // ("x+3-3 = 0-3"), le sens est déjà "≠", jamais "=".
  const intermediateGlyphs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.domain-branch[data-domain-index="0"] .eq-sign')).map((el) => el.innerHTML));
  ok('an intermediate (not-yet-solved) row already shows "≠", not "="',
    intermediateGlyphs.length > 0 && intermediateGlyphs.every((h) => /2260|\\neq/.test(h)));

  await page.evaluate(() => {
    // "-3" only pushes "x+3-3=0-3" (a normal, unsimplified chain step) — merge each side
    // via the usual "Simplifier" flow to actually reach "x=-3".
    window.App.History.toggleTermSelection('left', 1);
    window.App.History.toggleTermSelection('left', 2);
    window.App.History.confirmSimplifySelection();
    window.App.History.toggleTermSelection('right', 0);
    window.App.History.toggleTermSelection('right', 1);
    window.App.History.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);
  const domainSolvedEq = await page.evaluate(() => window.App.History.getDomainConditions()[0].engine.lastEquation());
  ok('the domain column\'s own equation solved to x=-3',
    JSON.stringify(domainSolvedEq) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: -3, pow: 0 }] }));
  const domainEqSignHtml = await page.evaluate(() =>
    document.querySelector('.domain-branch[data-domain-index="0"] .eq-row.solved .eq-sign').innerHTML);
  ok('the solved row displays "≠" instead of "=" (excluded value, not a solution)',
    /\\neq|&#8800;|≠/.test(domainEqSignHtml) || domainEqSignHtml.indexOf('2260') !== -1);
  ok('the MAIN equation is still completely untouched by solving the domain column',
    JSON.stringify(await page.evaluate(() => window.App.History.getLeaf().lastEquation())) ===
    JSON.stringify({ left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }], right: [{ coeff: 2, pow: 0 }] }));

  // Re-center on the main equation first: the dedup click above panned the viewport onto
  // the domain column (see App.Render.panToDomainColumn), which — now that domain columns
  // sit BESIDE rather than below the main chain (Phase 4 layout) — can genuinely leave the
  // main equation outside the viewport, same as panning to a wide "Produit nul" split does.
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(60);
  const mainTerm = await page.$('.eq-row.current .side[data-side="left"] .term');
  await mainTerm.click({ force: true });
  await page.waitForTimeout(60);
  ok('a first click back on the (not-yet-focused) main chain only refocuses it (no selection yet)',
    (await page.evaluate(() => window.App.History.getFocusedDomain())) === null);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
