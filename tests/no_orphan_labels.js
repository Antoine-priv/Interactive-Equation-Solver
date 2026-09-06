const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+8)(x-9)=0');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');

  // Simule la course : hover (declenche le rAF de l'apercu) IMMEDIATEMENT suivi d'un
  // clic de confirmation (rendu synchrone + son propre rAF), sans attendre entre les
  // deux -- exactement le scenario qui laissait des etiquettes fantomes bloquees en
  // (0,0) avant le correctif dans arrows.js (nettoyage des .arrow-label, pas seulement
  // du svg, a chaque appel de drawAll).
  for (let i = 0; i < 5; i++) {
    await page.hover('button[data-op="produitnul"]');
    await page.click('button[data-op="produitnul"]', { force: true }).catch(() => {});
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(400);

  const labelInfo = await page.evaluate(() => {
    var labels = Array.from(document.querySelectorAll('.arrow-label'));
    return labels.map((el) => {
      var r = el.getBoundingClientRect();
      return { text: el.textContent, top: r.top, left: r.left };
    });
  });
  console.log('etiquettes presentes:', JSON.stringify(labelInfo));

  const orphaned = labelInfo.filter((l) => l.top <= 1 && l.left <= 1);
  ok('no orphaned labels stuck at (0,0)', orphaned.length === 0);
  ok('exactly one fork label (produit nul)', labelInfo.length === 1 && /produit/.test(labelInfo[0].text));

  await page.screenshot({ path: `${SCRATCH}/no_orphan_labels.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
