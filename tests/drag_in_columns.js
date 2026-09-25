const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Glisser-déposer (réordonner dans un membre, ou traverser le "=") dans TOUTES les
// colonnes : "Produit nul", "Condition d'existence", facteurs du "Tableau de signes" —
// toujours appliqué au moteur de LA colonne où a lieu le geste (voir dragEngine/withFocus
// dans renderSide), même si une autre colonne était focalisée, et jamais à la chaîne
// principale. Vrais gestes souris uniquement.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function start(latex) {
    await page.evaluate((l) => {
      var eq = window.App.Parser.parseLatexEquation(l);
      window.App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
    }, latex);
    await page.waitForTimeout(150);
  }

  // Glisse `srcSel` jusqu'au centre du membre `toSide` de la ligne `rowSel`.
  async function dragTo(srcSel, rowSel, toSide) {
    const b = await (await page.$(srcSel)).boundingBox();
    const d = await (await page.$(rowSel + ' .side[data-side="' + toSide + '"]')).boundingBox();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    const tx = d.x + d.width / 2, ty = d.y + d.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (tx - sx) * i / 10, sy + (ty - sy) * i / 10);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  // Réordonne : glisse le terme `from` juste après le terme `after` du même membre.
  async function reorder(sideSel, from, after) {
    const a = await (await page.$(sideSel + ' .term[data-index="' + from + '"]')).boundingBox();
    const c = await (await page.$(sideSel + ' .term[data-index="' + after + '"]')).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2);
    await page.mouse.move(c.x + c.width - 2, c.y + c.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(200);
  }
  const T = (c, p) => ({ coeff: c, pow: p });
  const J = JSON.stringify;

  // --- 1. Colonnes "Produit nul" ---
  await start('(x+2)(x-3)=0');
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(200);
  ok('produit nul: 2 columns, column 0 focused', await page.evaluate(() =>
    window.App.History.getBranches().length === 2 && window.App.History.getFocusedBranch() === 0));

  const col1 = '#history .produit-nul-split > .produit-nul-branch:nth-child(2) .eq-row.current';
  ok('terms are draggable inside a column',
    await page.evaluate((s) => !!document.querySelector(s + ' .side[data-side="left"] .term.draggable-term'), col1));
  // Colonne 1 PAS focalisée : le glisser agit quand même sur elle (et la focalise).
  await dragTo(col1 + ' .side[data-side="left"] .term[data-index="1"]', col1, 'right');
  let st = await page.evaluate(() => {
    var H = window.App.History, b = H.getBranches();
    return {
      focused: H.getFocusedBranch(),
      n0: b[0].getSteps().length, n1: b[1].getSteps().length,
      eq1: b[1].lastEquation(), ops: b[1].getSteps()[1] && b[1].getSteps()[1].opLeft.ops,
      mainN: H.getOwnSteps().length
    };
  });
  ok('drag across in column 1 adds a step to column 1 only', st.n1 === 2 && st.n0 === 1 && st.mainN === 1);
  ok('op is "+3"', st.ops && st.ops[0].symbol === '+' && st.ops[0].term.coeff === 3);
  ok('column 1 = "x-3+3 = 0+3"', J(st.eq1.left) === J([T(1, 1), T(-3, 0), T(3, 0)]) && J(st.eq1.right) === J([T(0, 0), T(3, 0)]));
  ok('column 1 became focused', st.focused === 1);

  const col0 = '#history .produit-nul-split > .produit-nul-branch:nth-child(1) .eq-row.current';
  await reorder(col0 + ' .side[data-side="left"]', 0, 1);
  st = await page.evaluate(() => {
    var H = window.App.History, b = H.getBranches();
    return { focused: H.getFocusedBranch(), n0: b[0].getSteps().length, eq0: b[0].lastEquation() };
  });
  ok('in-side reorder inside column 0: no new step, order swapped',
    st.n0 === 1 && J(st.eq0.left) === J([T(2, 0), T(1, 1)]));
  ok('column 0 focused after dragging in it', st.focused === 0);

  // --- 2. Colonne "Condition d'existence" + chaîne principale pendant que la colonne est focalisée ---
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factorTerms: [T(1, 1), T(3, 0)], innerTerms: [T(5, 0)], isDivision: true }],
      right: [T(2, 0)]
    });
    function T(c, p) { return { coeff: c, pow: p }; }
  });
  await page.waitForTimeout(100);
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(200);
  const domRow = '#history .domain-branch[data-domain-index="0"] .eq-row.current';
  await dragTo(domRow + ' .side[data-side="left"] .term[data-index="1"]', domRow, 'right');
  st = await page.evaluate(() => {
    var H = window.App.History, c = H.getDomainConditions()[0].engine;
    return { dn: c.getSteps().length, deq: c.lastEquation(), mainN: H.getLeaf().getSteps().length, fd: H.getFocusedDomain() };
  });
  ok('drag across in the domain column adds a step there only', st.dn === 2 && st.mainN === 1);
  ok('domain column = "x+3-3 = 0-3"', J(st.deq.left) === J([T(1, 1), T(3, 0), T(-3, 0)]));
  ok('domain column focused', st.fd === 0);

  // La colonne de domaine est focalisée : glisser dans la chaîne principale doit agir sur
  // ELLE (pas sur la colonne, vers laquelle App.History délègue en ce moment).
  const mainRow = '#history > .eq-row.current';
  await dragTo(mainRow + ' .side[data-side="right"] .term[data-index="0"]', mainRow, 'left');
  st = await page.evaluate(() => {
    var H = window.App.History, c = H.getDomainConditions()[0].engine;
    return { dn: c.getSteps().length, mainN: H.getLeaf().getSteps().length, meq: H.getLeaf().lastEquation(), fd: H.getFocusedDomain() };
  });
  ok('drag in main chain while a domain column is focused hits the main chain', st.mainN === 2 && st.dn === 2);
  ok('main right = "2-2"', J(st.meq.right) === J([T(2, 0), T(-2, 0)]));
  ok('focus went back to the main chain', st.fd === null);

  // --- 3. Facteurs du "Tableau de signes" (moteurs en mode inégalité) ---
  await start('(x+1)(x-2)\\geq 0');
  await page.evaluate(() => window.App.History.signChartAction());
  await page.waitForTimeout(200);
  const nFactors = await page.evaluate(() => window.App.History.getSignChart().factors.length);
  ok('sign chart spawned 2 factor columns', nFactors === 2);
  const facRow = '#history [data-signchart-factor-index="1"] .eq-row.current';
  const before = await page.evaluate(() => window.App.History.getSignChart().factors[1].engine.lastEquation());
  await dragTo(facRow + ' .side[data-side="left"] .term[data-index="1"]', facRow, 'right');
  st = await page.evaluate(() => {
    var H = window.App.History, f = H.getSignChart().factors;
    return {
      n1: f[1].engine.getSteps().length, n0: f[0].engine.getSteps().length,
      eq1: f[1].engine.lastEquation(), op1: f[1].engine.getCurrentOperator(),
      mainN: H.getLeaf().getSteps().length, ff: H.getFocusedSignChartFactor()
    };
  });
  ok('drag across in a sign-chart factor adds a step there only (before: ' + J(before) + ')',
    st.n1 === 2 && st.n0 === 1 && st.mainN === 1);
  ok('factor column: constant moved to the right side', J(st.eq1.left) === J([T(1, 1), T(-2, 0), T(2, 0)]));
  ok('factor column keeps its inequality operator', !!st.op1);
  ok('factor column focused', st.ff === 1);

  ok('no leftover drag ghost', await page.evaluate(() => !document.querySelector('.drag-cross-target, .drag-ghost')));
  ok('no page errors (' + errs.join(' | ') + ')', errs.length === 0);
  await browser.close();
})();
