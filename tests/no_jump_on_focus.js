const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(500);

  const scrollTopBefore = await page.evaluate(() => document.getElementById('historyScroll').scrollTop);
  console.log('scrollTop avant de cliquer sur la 2e colonne:', scrollTopBefore);

  // Clique pour focaliser la 2e colonne (jamais visitee avant) -- ne doit PAS "sauter".
  await page.click('.produit-nul-branch:nth-child(2) .side[data-side="left"] .term[data-index="0"]');
  await page.waitForTimeout(400);

  const scrollTopAfter = await page.evaluate(() => document.getElementById('historyScroll').scrollTop);
  console.log('scrollTop apres avoir clique sur la 2e colonne (jamais visitee):', scrollTopAfter);
  ok('no vertical jump when focusing a never-visited column for the first time', Math.abs(scrollTopAfter - scrollTopBefore) < 2);

  // Reclique sur la 1ere colonne (deja visitee) -- ne doit toujours pas "sauter".
  await page.click('.produit-nul-branch:nth-child(1) .side[data-side="left"] .term[data-index="0"]');
  await page.waitForTimeout(400);
  const scrollTopAfter2 = await page.evaluate(() => document.getElementById('historyScroll').scrollTop);
  console.log('scrollTop apres reclique sur la 1ere colonne:', scrollTopAfter2);
  ok('no vertical jump when refocusing a previously-visited column', Math.abs(scrollTopAfter2 - scrollTopBefore) < 2);

  // Une VRAIE nouvelle etape sur la branche focalisee doit TOUJOURS recentrer.
  await page.evaluate(() => {
    var H = window.App.History;
    // Toujours focalisee sur la colonne 1 (x+2=0) suite au clic precedent.
    H.toggleTermSelection('left', 0);
    H.toggleTermSelection('right', 0);
    H.confirmSimplifySelection();
  });
  await page.waitForTimeout(500);
  const scrollTopAfterStep = await page.evaluate(() => document.getElementById('historyScroll').scrollTop);
  console.log('scrollTop apres une VRAIE nouvelle etape:', scrollTopAfterStep);
  // Pas d'assertion stricte sur la valeur (depend du layout), juste veiller a ce que ca
  // ne plante pas -- l'essentiel a verifier ici est l'absence d'erreur JS et le bon
  // fonctionnement de confirmSimplifySelection malgre le nouveau suivi par moteur.
  const eq = await page.evaluate(() => window.App.History.getBranches()[0].lastEquation());
  console.log('equation apres simplification:', JSON.stringify(eq));

  await page.screenshot({ path: `${SCRATCH}/no_jump_on_focus.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
