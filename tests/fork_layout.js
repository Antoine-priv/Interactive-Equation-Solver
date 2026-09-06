const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  // Volontairement etroit : force le mode "large" (.produit-nul-split-wide, voir
  // renderAll dans render.js) puisque 3 colonnes (min-width 320px chacune + gap 90px)
  // depassent alors la largeur disponible -- necessaire pour tester le defilement
  // horizontal ample, qui ne s'active plus QUE dans ce cas desormais.
  const page = await browser.newPage({ viewport: { width: 900, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);

  // 3 facteurs DISTINCTS, tapés directement (le parseur N-ary sait désormais chaîner
  // plus de deux parenthèses, plus besoin d'injecter un ProductGroup imbriqué à la main) :
  // (x+1)(x+2)(x+3) = 0 -> 3 colonnes (nombre impair).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+1)(x+2)(x+3)=0');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(150);

  // --- 1) 3 colonnes, flèche du milieu verticale ---
  const cols = await page.$$('.produit-nul-branch');
  ok('3 columns rendered (odd N)', cols.length === 3);

  const forkPaths = await page.evaluate(() => {
    var svg = document.querySelector('#history > svg.arrows-overlay');
    var paths = Array.from(svg.querySelectorAll('path.arrow-path'));
    return paths.map((p) => p.getAttribute('d'));
  });
  console.log('chemins des 3 branches de la fleche fourchue:', JSON.stringify(forkPaths, null, 2));
  ok('exactly 3 fork branch paths', forkPaths.length === 3);

  function isVertical(d) {
    // "M x1 y1 C x1 y2, x1 y3, x1 y4" -- extrait tous les nombres, indices pairs = X.
    var nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    var xs = [nums[0], nums[2], nums[4], nums[6]];
    return xs.every((x) => Math.abs(x - xs[0]) < 0.5);
  }
  const verticals = forkPaths.map(isVertical);
  console.log('verticalite de chaque branche (attendu: seule la branche du milieu, index 1, est verticale):', JSON.stringify(verticals));
  ok('middle branch (index 1) is vertical', verticals[1] === true);
  ok('side branches (0 and 2) are NOT vertical (still curved/pulled)', verticals[0] === false && verticals[2] === false);

  await page.screenshot({ path: `${SCRATCH}/fork_odd_columns.png` });

  // --- 2) Largeur des colonnes / espacement ---
  const layout = await page.evaluate(() => {
    var split = document.querySelector('.produit-nul-split');
    var branch = document.querySelector('.produit-nul-branch');
    var cs1 = getComputedStyle(split);
    var cs2 = getComputedStyle(branch);
    return { gap: cs1.columnGap || cs1.gap, paddingLeft: cs2.paddingLeft, paddingRight: cs2.paddingRight };
  });
  console.log('mise en page colonnes:', JSON.stringify(layout));
  ok('column horizontal padding widened to 46px', layout.paddingLeft === '46px' && layout.paddingRight === '46px');
  ok('inter-column gap reduced to 90px (compensates the +20px/side padding)', layout.gap === '90px');

  const isWide = await page.evaluate(() => document.querySelector('.produit-nul-split').classList.contains('produit-nul-split-wide'));
  console.log('mode "large" active (colonnes trop larges pour 900px):', isWide);
  ok('wide layout correctly activated (3 columns do not fit in 900px)', isWide === true);

  // --- 3) Marge de scroll horizontal ample (produit-nul-active) ---
  const scrollInfo = await page.evaluate(() => {
    var history = document.getElementById('history');
    var split = document.querySelector('.produit-nul-split');
    var cs = getComputedStyle(split);
    return {
      isActive: history.classList.contains('produit-nul-active'),
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      viewportWidth: window.innerWidth
    };
  });
  console.log('marge de scroll horizontal:', JSON.stringify(scrollInfo));
  ok('produit-nul-active class applied', scrollInfo.isActive);
  ok('.produit-nul-split padding-left is ~50vw', Math.abs(parseFloat(scrollInfo.paddingLeft) - scrollInfo.viewportWidth * 0.5) < 2);
  ok('.produit-nul-split padding-right is ~50vw', Math.abs(parseFloat(scrollInfo.paddingRight) - scrollInfo.viewportWidth * 0.5) < 2);

  // Peut-on effectivement centrer la colonne la plus a gauche a l'ecran en scrollant ?
  const canCenterLeftCol = await page.evaluate(() => {
    var scroller = document.getElementById('historyScroll');
    var cols = document.querySelectorAll('.produit-nul-branch');
    var leftCol = cols[0];
    var rect = leftCol.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    var colCenterAbs = (rect.left - scrollerRect.left) + scroller.scrollLeft + rect.width / 2;
    var desiredScrollLeft = colCenterAbs - scroller.clientWidth / 2;
    var maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    return { desiredScrollLeft, maxScrollLeft, reachable: desiredScrollLeft >= 0 && desiredScrollLeft <= maxScrollLeft };
  });
  console.log('centrage possible de la colonne la plus a gauche:', JSON.stringify(canCenterLeftCol));
  ok('leftmost column can be scrolled to screen center', canCenterLeftCol.reachable);

  const canCenterRightCol = await page.evaluate(() => {
    var scroller = document.getElementById('historyScroll');
    var cols = document.querySelectorAll('.produit-nul-branch');
    var rightCol = cols[cols.length - 1];
    var rect = rightCol.getBoundingClientRect();
    var scrollerRect = scroller.getBoundingClientRect();
    var colCenterAbs = (rect.left - scrollerRect.left) + scroller.scrollLeft + rect.width / 2;
    var desiredScrollLeft = colCenterAbs - scroller.clientWidth / 2;
    var maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    return { desiredScrollLeft, maxScrollLeft, reachable: desiredScrollLeft >= 0 && desiredScrollLeft <= maxScrollLeft };
  });
  console.log('centrage possible de la colonne la plus a droite:', JSON.stringify(canCenterRightCol));
  ok('rightmost column can be scrolled to screen center', canCenterRightCol.reachable);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
