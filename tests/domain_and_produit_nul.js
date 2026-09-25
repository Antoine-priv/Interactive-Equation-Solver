const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Condition d'existence" et "Produit nul" sur une même équation (autrefois exclus l'un
// de l'autre) : "(x-6)√(x-8)=0" — domaine x ≥ 8, puis Produit nul, S = {8} (6 est hors
// du domaine). Et une condition posée DEPUIS une colonne "Produit nul" remonte à
// l'équation qui porte la scission.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  await page.evaluate(() => window.App.Settings.set('autoSimplify', true));
  await page.evaluate(() => {
    var e = window.App.Parser.parseLatexEquation('(x-6)\\sqrt{x-8}=0');
    window.App.History.startNewEquation({ left: e.left, right: e.right });
  });

  // Domaine : x - 8 ≥ 0.
  await page.evaluate(() => {
    var H = window.App.History;
    H.drillIntoProductBranch('left', 0, 1);
    H.existenceConditionAction();
    H.setFocusedDomain(0);
    H.selectOp('expr'); H.setExprChainText('+8'); H.confirm();
    H.focusMain();
  });
  ok('Produit nul is available with a domain condition', await page.evaluate(() => window.App.History.canProduitNul()));
  await page.evaluate(() => window.App.History.confirmProduitNul());
  await page.waitForTimeout(200);
  const st = await page.evaluate(() => ({
    branches: (window.App.History.getBranches() || []).length,
    conds: (window.App.History.getDomainConditions() || []).length,
    group: (function () { var g = document.querySelector('.domain-group'); return g && g.style.visibility !== 'hidden' ? g.getBoundingClientRect().toJSON() : null; })(),
    cols: Array.from(document.querySelectorAll('.produit-nul-split > .produit-nul-branch')).map((c) => c.getBoundingClientRect().toJSON())
  }));
  ok('two Produit nul columns and the domain column coexist', st.branches === 2 && st.conds === 1);
  ok('the domain group is shown', !!st.group);
  ok('it does not overlap the Produit nul columns', st.group && st.cols.every((c) =>
    c.right <= st.group.left || c.left >= st.group.right || c.bottom <= st.group.top || c.top >= st.group.bottom));

  // Colonnes : x - 6 = 0 et √(x-8) = 0.
  await page.evaluate(() => {
    var H = window.App.History;
    H.focusBranch(0); H.selectOp('expr'); H.setExprChainText('+6'); H.confirm();
    H.focusBranch(1); H.confirmSquareBothSides(); H.selectOp('expr'); H.setExprChainText('+8'); H.confirm();
  });
  await page.waitForTimeout(200);
  const fin = await page.evaluate(() => ({
    ranges: window.App.Render.finalSolutionRanges(),
    text: (document.querySelector('.final-solution-set') || {}).textContent
  }));
  ok('S = {8}: 6 is outside the domain', JSON.stringify(fin.ranges) === JSON.stringify([{ from: 8, to: 8, fromIncluded: true, toIncluded: true }]) &&
    /8/.test(fin.text || '') && !/6/.test(fin.text || ''));
  await page.evaluate(() => window.App.Canvas.set(0, 0));
  await page.waitForTimeout(150);
  await page.evaluate(() => { window.App.Canvas.zoomAt(0.55, 0, 0); window.App.Canvas.set(0, 0); });
  await page.waitForTimeout(250);
  await page.screenshot({ path: SCRATCH + '/domain_and_produit_nul.png' });
  await page.evaluate(() => window.App.Canvas.zoomAt(1 / 0.55, 0, 0));

  // Retour arrière depuis la colonne de domaine : n'y touche que sa propre étape.
  await page.evaluate(() => {
    var H = window.App.History;
    H.setFocusedDomain(0);
    H.undo();
  });
  const u = await page.evaluate(() => ({
    branches: (window.App.History.getBranches() || []).length,
    col: window.App.History.getDomainConditions()[0].engine.getSteps().length
  }));
  ok('undo in the domain column only undoes that column', u.branches === 2 && u.col === 1);

  // Une colonne focalisée par clic rend la main aux colonnes "Produit nul".
  await page.evaluate(() => window.App.History.focusBranch(0));
  ok('focusing a Produit nul column leaves the domain column', await page.evaluate(() => window.App.History.getFocusedDomain() === null));

  // --- Condition posée depuis une colonne "Produit nul" ---
  await page.evaluate(() => {
    var e = window.App.Parser.parseLatexEquation('(x-3)\\sqrt{x+1}=0');
    var H = window.App.History;
    H.startNewEquation({ left: e.left, right: e.right });
    H.confirmProduitNul();
    H.focusBranch(1);
    H.toggleTermSelection('left', 0); H.toggleTermSelection('left', 0); // double-clic : dans la racine
  });
  ok('from a Produit nul column, "Condition d\'existence" is offered', await page.evaluate(() => window.App.History.canExistenceCondition()));
  await page.evaluate(() => window.App.History.existenceConditionAction());
  const up = await page.evaluate(() => ({
    root: (window.App.History.getDomainConditions() || []).length,
    child: window.App.History.getBranches()[1].getDomainConditions(),
    drilled: window.App.History.getPending().drilled
  }));
  ok('the condition goes up to the equation carrying the split', up.root === 1 && !up.child && !up.drilled);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
