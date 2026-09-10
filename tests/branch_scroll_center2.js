const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function waitScrollSettled(page) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const cur = await page.evaluate(() => document.getElementById('historyScroll').scrollTop);
    if (cur === last) return cur;
    last = cur;
    await page.waitForTimeout(100);
  }
  return last;
}

async function centeringInfo(page, rowSelector) {
  return page.evaluate((sel) => {
    var scroller = document.getElementById('historyScroll');
    var row = document.querySelector(sel);
    if (!row) return null;
    var sRect = scroller.getBoundingClientRect();
    var rRect = row.getBoundingClientRect();
    var scrollerCenter = (sRect.top + sRect.bottom) / 2;
    var rowCenter = (rRect.top + rRect.bottom) / 2;
    return { diff: Math.abs(scrollerCenter - rowCenter) };
  }, rowSelector);
}

async function addOp(page, sign, num) {
  await page.evaluate(({ sign, num }) => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText(sign + num);
    window.App.History.confirm();
  }, { sign, num });
  await waitScrollSettled(page);
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+3)=0');

  // Allonge la chaine PRINCIPALE avant de scinder (plusieurs etapes "+1"/"-1" sans
  // consequence mathematique autre que pousser la scission loin sous le haut de la page,
  // pour que le decalage constant introduit par le bug (offsetTop relatif a
  // .produit-nul-chain au lieu de la page) devienne mesurable).
  await addOp(page, '+', '1');
  await addOp(page, '-', '1');
  await addOp(page, '+', '1');
  await addOp(page, '-', '1');
  await addOp(page, '+', '1');
  await addOp(page, '-', '1');

  // Les 6 constantes ajoutees (+1-1+1-1+1-1) restent des termes SEPARES tant qu'on ne les
  // combine pas : les selectionner et Simplifier les fusionne en 0, qui disparait alors
  // (le ProductGroup reste, "il reste autre chose"), retrouvant exactement "(x+2)(x+3)=0"
  // pour que "Produit nul" redevienne disponible -- avec une chaine principale longue
  // au-dessus de la scission cette fois.
  await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    eq.left.forEach(function (t, i) { if (i > 0) window.App.History.toggleTermSelection('left', i); });
    eq.right.forEach(function (t, i) { window.App.History.toggleTermSelection('right', i); });
  });
  await page.click('button[data-op="simplify"]');
  await waitScrollSettled(page);
  await page.waitForTimeout(300);

  const eqBeforeSplit = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation avant produit nul (attendu juste le ProductGroup a gauche):', JSON.stringify(eqBeforeSplit));

  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  // Clic DOM direct (pas page.click) : le pave d'actions suit desormais l'equation active
  // (voir App.Toolbar.positionPanel dans toolbar.js) au lieu de rester fixe en bas a
  // gauche, donc sa position est recalculee a chaque rendu -- y compris pendant l'apercu
  // au survol de ce meme bouton (hoveredOp dans toolbar.js), qui redeclenche un rendu.
  // Le mouvement de souris REEL simule par Playwright pour atteindre ce bouton desormais
  // mobile finit par franchir cet apercu une frame de trop tard par rapport a l'ancien
  // bouton fixe, decalant le clic reel d'une frame par rapport au rendu qu'il doit
  // declencher (sans consequence pour un vrai utilisateur, qui n'a pas cette simulation
  // de trajectoire) -- sans effet ici sur ce que ce test verifie (le recentrage vertical
  // une fois la scission produite), un clic DOM direct l'evite proprement.
  await page.evaluate(() => document.querySelector('button[data-op="produitnul"]').click());
  await waitScrollSettled(page);
  await page.waitForTimeout(500);

  const infoAInit = await centeringInfo(page, '.produit-nul-branch:nth-child(1) .eq-row.current');
  console.log('centrage initial branche A, chaine principale allongee (diff px):', JSON.stringify(infoAInit));
  ok('branch A centered after split with a long primary chain above it', infoAInit && infoAInit.diff < 60);

  await page.screenshot({ path: `${SCRATCH}/branchcenter2_init.png` });

  const branchB = '.produit-nul-branch:nth-child(2)';
  await page.click(`${branchB} .side[data-side="left"] .term[data-index="0"]`);
  await page.click(`${branchB} .side[data-side="left"] .term[data-index="0"]`);
  await waitScrollSettled(page);
  await page.waitForTimeout(500);

  const infoBAfter = await centeringInfo(page, `${branchB} .eq-row.current`);
  console.log('centrage apres clic colonne B (diff px, chaine principale longue):', JSON.stringify(infoBAfter));
  ok('branch B vertically centered after clicking to select it (long primary chain above)', infoBAfter && infoBAfter.diff < 60);

  await page.screenshot({ path: `${SCRATCH}/branchcenter2_after_click_b.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})().catch(e => { console.error('ERREUR SCRIPT:', e); process.exit(1); });
