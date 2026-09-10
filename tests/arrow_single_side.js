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
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+6=10');

  // Factoriser 2x+6 par 2, membre gauche uniquement -> "2(x+3)=10". Seul opLeft est
  // renseigne pour cette etape (opRight reste null, rien n'a change a droite).
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.click('[data-key="2"]');

  // Avant meme de valider : l'apercu (ligne "pending") ne doit deja montrer qu'une seule
  // fleche, sur le membre gauche (celui reellement factorise) -- pas une deuxieme fleche
  // fantome a droite (voir pendingForceLeft/pendingForceRight dans render.js).
  await page.waitForTimeout(200);
  const arrowCountDuringPreview = await page.evaluate(() => document.querySelectorAll('svg.arrows-overlay path.arrow-path').length);
  console.log('arrow-path count pendant l\'apercu de factorisation (attendu 1, pas 2):', arrowCountDuringPreview);
  ok('exactly one arrow shown in the factor preview row (no phantom arrow on the untouched side)', arrowCountDuringPreview === 1);

  await page.click('.op-confirm-btn');

  // Laisse le temps au requestAnimationFrame de arrows.js de dessiner.
  await page.waitForTimeout(200);

  const arrowCountAfterFactor = await page.evaluate(() => document.querySelectorAll('svg.arrows-overlay path.arrow-path').length);
  console.log('arrow-path count right after single-side factor (attendu 1, pas 2):', arrowCountAfterFactor);
  ok('exactly one arrow drawn after a single-side factor (no phantom arrow on untouched side)', arrowCountAfterFactor === 1);

  await page.screenshot({ path: `${SCRATCH}/arrow1_after_factor.png` });

  // Meme test avec Developper (l'inverse), toujours un seul cote touche.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+6=10');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.click('[data-key="2"]');
  await page.click('.op-confirm-btn');
  await page.waitForTimeout(150);
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]'); // le groupe 2(x+3)
  await page.click('button[data-op="expand"]');
  await page.waitForTimeout(200);
  const arrowCountAfterExpand = await page.evaluate(() => document.querySelectorAll('svg.arrows-overlay path.arrow-path').length);
  // A ce stade : 2 transitions confirmees (initial->factor, factor->expand), chacune
  // touchant seulement le membre gauche => 2 fleches au total (pas 4).
  console.log('arrow-path count apres factor PUIS expand, tout sur le membre gauche (attendu 2, pas 4):', arrowCountAfterExpand);
  ok('exactly two arrows total after two single-side steps (no phantom arrows accumulating)', arrowCountAfterExpand === 2);
  await page.screenshot({ path: `${SCRATCH}/arrow2_after_expand.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
