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
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');

  const noPreviewYet = await page.$('.produit-nul-preview');
  ok('no preview before hovering the button', noPreviewYet === null);

  await page.hover('button[data-op="produitnul"]');
  await page.waitForTimeout(150);

  const previewCols = await page.$$('.produit-nul-preview .produit-nul-branch');
  ok('hovering shows 2 preview columns', previewCols.length === 2);

  const noRealBranchesYet = await page.evaluate(() => window.App.History.getBranches());
  ok('no real branches created by just hovering', noRealBranchesYet === null);

  const previewEqs = await page.evaluate(() => {
    var chains = document.querySelectorAll('.produit-nul-preview .produit-nul-chain .eq-line');
    return Array.from(chains).map((el) => el.closest('.eq-row').textContent);
  });
  console.log('contenu des colonnes d apercu:', JSON.stringify(previewEqs));

  const forkPresent = await page.evaluate(() => {
    var svg = document.querySelector('#history > svg.arrows-overlay');
    return svg ? svg.querySelectorAll('path.arrow-path').length : 0;
  });
  console.log('nombre de fleches (dont la fourchue) dans l apercu:', forkPresent);
  ok('fork arrow(s) drawn toward the preview columns', forkPresent >= 2);

  const notInteractive = await page.evaluate(() => getComputedStyle(document.querySelector('.produit-nul-preview')).pointerEvents);
  ok('preview is non-interactive (pointer-events:none)', notInteractive === 'none');

  await page.screenshot({ path: `${SCRATCH}/produitnul_hover_preview.png` });

  await page.hover('#newEquationBtn');
  await page.waitForTimeout(150);
  const goneAfterLeave = await page.$('.produit-nul-preview');
  ok('preview disappears once the mouse leaves the button', goneAfterLeave === null);

  const stillNoRealBranches = await page.evaluate(() => window.App.History.getBranches());
  ok('still no real branches after hover ended', stillNoRealBranches === null);

  // --- Produit nul DANS une colonne (G6) : l'aperçu est à la même place (par rapport à la
  // ligne scindée) que les sous-colonnes une fois validées ---
  await page.evaluate(() => {
    var h = window.App.History;
    h.startNewEquation(window.App.Parser.parseLatexEquation('x^4-8x^2+16=0'));
    [0, 1, 2].forEach((i) => h.toggleTermSelection('left', i)); h.enterFactorWithSelection(); h.chooseFactorMode(2);
    h.setIdentityFieldLatex('x^2'); h.setIdentityFocus('b'); h.setIdentityFieldLatex('4'); h.confirm();
    h.toggleTermSelection('left', 0); h.confirmProduitNul();
    var br = h.getBranches()[0]; h.focusBranch(0);
    br.toggleTermSelection('left', 0); br.toggleTermSelection('left', 1); br.enterFactorWithSelection(); br.chooseFactorMode(3);
    br.setIdentityFieldLatex('x'); br.setIdentityFocus('b'); br.setIdentityFieldLatex('2'); br.confirm();
  });
  await page.waitForTimeout(500);
  await page.click('.produit-nul-branch .eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.waitForTimeout(200);
  await page.hover('button[data-op="produitnul"]');
  await page.waitForTimeout(600);
  const offsets = () => page.evaluate(() => {
    var rows = Array.from(document.querySelectorAll('.produit-nul-branch .eq-row')).filter((r) =>
      !r.closest('.produit-nul-split-nested') && !r.closest('.produit-nul-preview'));
    var base = rows[rows.length - 1].getBoundingClientRect();
    return Array.from(document.querySelectorAll('.produit-nul-preview .eq-line, .produit-nul-split-nested .eq-line'))
      .map((e) => { var r = e.getBoundingClientRect(); return [Math.round(r.left - base.left), Math.round(r.top - base.top)]; });
  });
  const before = await offsets();
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(1000);
  const after = await offsets();
  console.log('aperçu', JSON.stringify(before), 'validé', JSON.stringify(after));
  ok('nested Produit nul: confirmed columns land where the preview was', before.length === 2 &&
    JSON.stringify(before) === JSON.stringify(after));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
