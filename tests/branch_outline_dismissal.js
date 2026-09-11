const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');

  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.evaluate(() => document.querySelector('button[data-op="produitnul"]').click());
  await page.waitForTimeout(300);

  const focusedCountInit = await page.$$eval('.produit-nul-branch.branch-focused', (els) => els.length);
  ok('exactly one column carries the focus outline right after the split', focusedCountInit === 1);

  // Bouton de zoom (chrome flottant, PAS une colonne) : ne doit jamais masquer le liseré
  // (voir BRANCH_OUTLINE_KEEP_SELECTOR dans render.js) -- interagir avec l'UI flottante de
  // la colonne active n'est pas un clic "en dehors" au sens de l'utilisateur.
  await page.click('#zoomInBtn');
  await page.waitForTimeout(150);
  const focusedAfterZoom = await page.$$eval('.produit-nul-branch.branch-focused', (els) => els.length);
  ok('clicking the zoom button does not clear the outline', focusedAfterZoom === 1);

  // Clic sur le fond de la toile, loin de toute colonne ET des boutons flottants (coin
  // bas-gauche, vide -- #newEquationBtn/#undoBtn sont en haut-gauche, #zoomInBtn/
  // #zoomOutBtn en bas-DROITE, voir style.css) : masque le liseré partout.
  await page.mouse.click(30, 780);
  await page.waitForTimeout(150);
  const focusedAfterOutsideClick = await page.$$eval('.produit-nul-branch.branch-focused', (els) => els.length);
  ok('clicking outside every column clears the outline everywhere', focusedAfterOutsideClick === 0);

  await page.screenshot({ path: `${SCRATCH}/branch_outline_dismissal_hidden.png` });

  // Re-cliquer une colonne (la seconde, pas encore focalisee) la fait reapparaitre, sur LA
  // BONNE colonne, sans changer le focus logique en arriere-plan (App.History.getFocusedBranch()).
  const branchB = '.produit-nul-branch:nth-child(2)';
  await page.click(`${branchB} .side[data-side="left"] .term[data-index="0"]`);
  await page.waitForTimeout(150);

  const focusedAfterClickB = await page.$$eval('.produit-nul-branch.branch-focused', (els) => els.length);
  ok('clicking a column brings the outline back on exactly one column', focusedAfterClickB === 1);

  const bHasOutline = await page.evaluate((sel) => document.querySelector(sel).classList.contains('branch-focused'), branchB);
  ok('the outline reappears on the column that was actually clicked', bHasOutline === true);

  const focusedBranchIdx = await page.evaluate(() => window.App.History.getFocusedBranch());
  ok('the logical focused branch really moved to column B (routing unaffected)', focusedBranchIdx === 1);

  console.log('--- erreurs JS ---');
  if (errs.length === 0) console.log('(aucune)');
  errs.forEach((e) => console.log(e));
  ok('no JS errors during the whole scenario', errs.length === 0);

  await browser.close();
})();
