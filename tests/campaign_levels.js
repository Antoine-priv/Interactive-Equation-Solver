const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Déroulé d'un niveau de campagne (voir js/campaign.js) : mauvaise réponse, condition
// d'existence exigée, niveau en deux parties, niveau "Df seul", indice (limite à ★),
// halo sur l'action présentée par le niveau.
(async () => {
  const browser = await chromium.launch();
  const errs = [];

  async function freshPage(allSolved) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
    if (allSolved) {
      await page.addInitScript(() => {
        // Tous les niveaux ouverts, sauf ceux qu'on veut jouer "pour la première fois".
        var levels = {};
        ['t1', 't3', 't4', 't5', 't6', 't7', 'l1', 'l2', 'l3', 'l4', 'l5', 'lB', 'f1', 'f2', 'f3',
          'p1', 'p2', 'p3', 'p4', 'p5', 'pB', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'i1', 'i2', 'i3', 'iB']
          .forEach(function (id) { levels[id] = { stars: 1, bestSteps: 9, solvedAt: '2026-09-25' }; });
        if (!sessionStorage.getItem('seeded')) {
          localStorage.setItem('equations-progress', JSON.stringify({ version: 1, levels: levels, badges: [] }));
          sessionStorage.setItem('seeded', '1');
        }
      });
    }
    await page.goto(FILE);
    return page;
  }
  const H = (page, fn, arg) => page.evaluate(fn, arg);
  const cur = (page) => page.evaluate(() => window.App.Campaign.current());

  // --- Halo sur l'action présentée (T1 : Simplifier) ---
  let page = await freshPage(false);
  await H(page, () => window.App.Campaign.startLevel('t1'));
  await H(page, () => window.App.History.toggleTermSelection('left', 1));
  await page.waitForTimeout(150);
  ok('T1: Simplifier is highlighted as new', await H(page, () =>
    document.querySelector('#opButtons button[data-op="simplify"]').classList.contains('campaign-new')));
  ok('T1: the √ key is locked', await H(page, () => document.body.classList.contains('campaign-lock-key-sqrt')));

  // --- Indice : le niveau est limité à ★ ---
  await H(page, () => window.App.History.cancelOp());
  const hintShown = () => H(page, () => !document.getElementById('levelHint').hidden);
  const hintText = () => H(page, () => document.querySelector('[data-hint-text]').textContent);
  const ctrlOpacity = () => H(page, () => getComputedStyle(document.querySelector('.level-hint-ctrl')).opacity);
  await page.click('[data-level-hint]');
  await page.waitForTimeout(300);
  ok('hint bubble shows the first hint', await hintShown() && (await hintText()).indexOf('+3') !== -1);
  ok('the hint bubble sits under the Indice button, its arrow on the button center', await H(page, () => {
    var b = document.querySelector('[data-level-hint]').getBoundingClientRect(), h = document.getElementById('levelHint');
    var r = h.getBoundingClientRect(), ax = parseFloat(h.style.getPropertyValue('--hint-arrow-x'));
    return r.top > b.bottom && r.top - b.bottom < 20 && Math.abs(r.left + ax - (b.left + b.width / 2)) < 1;
  }));
  await page.mouse.move(200, 700);
  await page.waitForTimeout(200);
  ok('‹ › ✕ hidden while the mouse is outside the bubble', await ctrlOpacity() === '0');
  await page.hover('[data-hint-text]');
  await page.waitForTimeout(200);
  ok('‹ › ✕ shown while the mouse is inside the bubble', await ctrlOpacity() === '1');
  ok('‹ disabled on the first hint', await H(page, () => document.querySelector('[data-hint-prev]').disabled));
  await page.click('[data-hint-next]');
  ok('› shows the next hint', (await hintText()).indexOf('Opération') !== -1 &&
    await H(page, () => document.querySelector('[data-hint-next]').disabled));
  await page.click('[data-hint-prev]');
  ok('‹ goes back', (await hintText()).indexOf('+3') !== -1);
  await page.click('[data-hint-text]');
  ok('clicking inside the hint bubble keeps it open', await hintShown());
  await page.click('[data-level-hint]');
  ok('clicking Indice while open pops the bubble out', await H(page, () => document.getElementById('levelHint').classList.contains('hint-out')));
  await page.waitForTimeout(300);
  ok('then it is closed', !(await hintShown()));
  await page.click('[data-level-hint]');
  await page.waitForTimeout(300);
  ok('reopening shows the last hint seen, with a pop-in', await hintShown() && (await hintText()).indexOf('+3') !== -1);
  await page.mouse.click(200, 700);
  await page.waitForTimeout(300);
  ok('clicking outside the hint bubble closes it', !(await hintShown()));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.selectOp('expr'); Hs.setExprChainText('-3'); Hs.confirm();
    Hs.toggleTermSelection('left', 1); Hs.toggleTermSelection('left', 2); Hs.confirmSimplifySelection();
    Hs.toggleTermSelection('right', 0); Hs.toggleTermSelection('right', 1); Hs.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);
  ok('tutorial level: no stars at the end, even with a hint', await H(page, () => document.querySelector('#levelWin .win-stars').hidden));
  await page.close();

  page = await freshPage(true);
  let c;

  // --- M5 : la bonne solution sans condition d'existence ne suffit pas ---
  await H(page, () => window.App.Campaign.startLevel('m5'));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.toggleTermSelection('left', 0); Hs.confirmSimplifySelection(); // (x+3)(x+1)/(x+3) -> x+1 (si x+3≠0)
    Hs.selectOp('expr'); Hs.setExprChainText('-1'); Hs.confirm();
    Hs.toggleTermSelection('left', 1); Hs.toggleTermSelection('left', 2); Hs.confirmSimplifySelection();
    Hs.toggleTermSelection('right', 0); Hs.toggleTermSelection('right', 1); Hs.confirmSimplifySelection();
  });
  await page.waitForTimeout(150);
  c = await cur(page);
  console.log('  M5 state:', JSON.stringify(await H(page, () => window.App.History.lastEquation())));
  ok('M5: S = {-1} without the domain asks for the existence condition', c && !c.won && /condition d'existence/.test(c.message || ''));
  // Condition d'existence posée depuis l'équation de départ : on revient au début.
  await H(page, () => { var Hs = window.App.History; while (Hs.canUndo()) Hs.undo(); });
  await H(page, () => {
    var Hs = window.App.History;
    Hs.toggleTermSelection('left', 0, null, true); Hs.toggleTermSelection('left', 0, null, true);
  });
  ok('M5: drilled into the denominator', await H(page, () => window.App.History.canExistenceCondition()));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.existenceConditionAction();
    Hs.setFocusedDomain(0);
    Hs.selectOp('expr'); Hs.setExprChainText('-3'); Hs.confirm();
    Hs.toggleTermSelection('left', 1); Hs.toggleTermSelection('left', 2); Hs.confirmSimplifySelection();
    Hs.toggleTermSelection('right', 0); Hs.toggleTermSelection('right', 1); Hs.confirmSimplifySelection();
    Hs.focusMain();
    Hs.toggleTermSelection('left', 0); Hs.confirmSimplifySelection();
    Hs.selectOp('expr'); Hs.setExprChainText('-1'); Hs.confirm();
    Hs.toggleTermSelection('left', 1); Hs.toggleTermSelection('left', 2); Hs.confirmSimplifySelection();
    Hs.toggleTermSelection('right', 0); Hs.toggleTermSelection('right', 1); Hs.confirmSimplifySelection();
  });
  await page.waitForTimeout(200);
  c = await cur(page);
  ok('M5: with the existence condition, the level is won', c && c.won);
  ok('M5: badge "Chasseur d\'interdits" earned', await H(page, () =>
    JSON.parse(localStorage.getItem('equations-progress')).badges.indexOf('chasseur-interdits') !== -1));
  ok('M5: domain determined, not capped', !c.noDomain && await H(page, () =>
    document.querySelector('[data-win-criteria]').textContent.indexOf('Ensemble de définition déterminé') !== -1));

  // --- M3 : la bonne solution sans condition d'existence ne vaut qu'une étoile ---
  await H(page, () => window.App.Campaign.startLevel('m3'));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.selectOp('expr'); Hs.setExprChainText('\\times(x-2)'); Hs.confirm();
    Hs.selectOp('expr'); Hs.setExprChainText('+2'); Hs.confirm();
    var eq = Hs.lastEquation();
    if (eq.left.length > 1) { Hs.toggleTermSelection('left', 0); Hs.toggleTermSelection('left', 1); Hs.confirmSimplifySelection(); }
    eq = Hs.lastEquation();
    if (eq.right.length > 1) { Hs.toggleTermSelection('right', 1); Hs.toggleTermSelection('right', 2); Hs.confirmSimplifySelection(); }
  });
  await page.waitForTimeout(200);
  c = await cur(page);
  console.log('  M3 state:', JSON.stringify(await H(page, () => window.App.History.lastEquation())));
  ok('M3: S = {5} without the domain still wins', c && c.won);
  ok('M3: ... but is capped at one star', c && c.noDomain && await H(page, () =>
    document.querySelectorAll('[data-win-star].on').length === 1 &&
    document.querySelector('[data-win-criteria]').textContent.indexOf('limité à ★') !== -1));

  // --- M1 : niveau "Df seul" ---
  await H(page, () => window.App.Campaign.startLevel('m1'));
  ok('M1 shows its statement', await H(page, () => !document.querySelector('[data-level-statement]').hidden));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.toggleTermSelection('left', 0, null, true); Hs.toggleTermSelection('left', 0, null, true);
    Hs.existenceConditionAction();
    Hs.setFocusedDomain(0);
    Hs.selectOp('expr'); Hs.setExprChainText('-1'); Hs.confirm();
    Hs.toggleTermSelection('left', 0); Hs.toggleTermSelection('left', 2); Hs.confirmSimplifySelection();
    Hs.toggleTermSelection('right', 0); Hs.toggleTermSelection('right', 1); Hs.confirmSimplifySelection();
    Hs.focusMain();
  });
  await page.waitForTimeout(200);
  c = await cur(page);
  console.log('  M1 domain column:', JSON.stringify(await H(page, () => window.App.History.getDomainConditions()[0].engine.lastEquation())));
  ok('M1: finding Df = R\\{-1} wins the level', c && c.won);

  // --- M8 : deux parties ---
  await H(page, () => window.App.Campaign.startLevel('m8'));
  ok('M8 starts with part 1 (√x = 0)', await H(page, () =>
    JSON.stringify(window.App.History.lastEquation().left) === '[{"sign":1,"radicand":[{"coeff":1,"pow":1}]}]'));
  await H(page, () => window.App.History.confirmSquareBothSides());
  await page.waitForTimeout(1300);
  c = await cur(page);
  ok('M8: part 1 solved, part 2 loaded', c && c.part === 1 && !c.won && await H(page, () =>
    window.App.History.lastEquation().left[0].isDivision === true));
  await H(page, () => {
    var Hs = window.App.History;
    Hs.toggleTermSelection('left', 0, null, true); Hs.toggleTermSelection('left', 0, null, true);
    Hs.existenceConditionAction(); // √x ≠ 0
    Hs.setFocusedDomain(0); Hs.confirmSquareBothSides();
    Hs.focusMain();
    Hs.toggleTermSelection('left', 0); Hs.confirmSimplifySelection();
    Hs.confirmSquareBothSides();
  });
  await page.waitForTimeout(200);
  c = await cur(page);
  ok('M8: part 2 (S = ∅) wins the level', c && c.won);
  ok('M8: steps from both parts are counted', await H(page, () => window.App.Campaign.stepCount()) >= 3);
  await page.screenshot({ path: SCRATCH + '/campaign_levels_m8.png' });

  // --- P5 : identités pas encore abordées -> Factoriser va droit au facteur commun, sans
  // fenêtre ; le piège ÷x puis Simplifier (x²/x, 5x/x, "valide si x≠0") perd la solution 0 ---
  page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.addInitScript(() => {
    var levels = {};
    ['t1', 't3', 't4', 't5', 't7', 'l1', 'l2', 'l3', 'l4', 'l5', 'lB', 'p1', 'p2', 'p3', 'p4']
      .forEach(function (id) { levels[id] = { stars: 1, bestSteps: 9, solvedAt: '2026-09-25' }; });
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('equations-progress', JSON.stringify({ version: 1, levels: levels, badges: [] }));
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto(FILE);
  await H(page, () => window.App.Campaign.startLevel('p5'));
  await H(page, () => { var h = window.App.History; h.selectOp('expr'); h.setExprChainText('-5x'); h.confirm(); });
  await page.waitForTimeout(150);
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(150);
  ok('P5: Factoriser goes straight to the common factor (identities not met yet)', await H(page, () =>
    window.App.History.getPending().factorMode === 'common'));
  ok('P5: no empty window with only a back arrow', await H(page, () =>
    document.getElementById('controlPanel').hidden && !document.querySelector('.factor-back-btn')));
  await H(page, () => { window.App.History.cancelOp(); window.App.History.undo(); });
  await H(page, () => {
    var h = window.App.History;
    h.selectOp('expr'); h.setExprChainText('\\div x'); h.confirm();
    h.toggleTermSelection('left', 0); h.toggleTermSelection('right', 0);
  });
  ok('P5: Simplifier is offered on x²/x and 5x/x', await H(page, () => window.App.Toolbar.computeSelectionInfo().canSimplify));
  await H(page, () => window.App.History.confirmSimplifySelection());
  await page.waitForTimeout(200);
  const trap = await H(page, () => { var s = window.App.History.getSteps().slice(-1)[0]; return { eq: s.equation, nz: s.opLeft.nonZero }; });
  ok('P5: x²/x = 5x/x simplifies to x = 5, "valide si x≠0"', JSON.stringify(trap.eq) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 5, pow: 0 }] }) &&
    JSON.stringify(trap.nz) === JSON.stringify([[{ coeff: 1, pow: 1 }]]));
  ok('P5: that loses the solution 0, the level is not won', !(await cur(page)).won);

  // Identités abordées (G3 réussi) : les trois formules sont proposées.
  await H(page, () => {
    var p = JSON.parse(localStorage.getItem('equations-progress'));
    p.levels.g3 = { stars: 1, bestSteps: 9, solvedAt: '2026-09-25' };
    localStorage.setItem('equations-progress', JSON.stringify(p));
  });
  await page.goto(FILE);
  await H(page, () => window.App.Campaign.startLevel('p5'));
  await H(page, () => { var h = window.App.History; h.selectOp('expr'); h.setExprChainText('-5x'); h.confirm(); });
  await page.waitForTimeout(150);
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(150);
  ok('identities met: the choice lists the 3 identities', await H(page, () =>
    document.querySelectorAll('.factor-choice-btn').length === 4));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
