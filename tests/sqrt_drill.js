const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function findSqrtKey(page) {
  return page.$('[data-key="sqrt"]');
}

// "Drill inside a square root" : une fois l'équation enveloppée dans "√(...)" (étape 1 de
// "Racine carrée", voir sqrt_arm_confirm.js), l'élève doit pouvoir "entrer" dans chaque
// racine (comme dans une parenthèse factorisée classique) pour développer/simplifier/
// factoriser SON contenu, avant de revenir "sortir" pour poursuivre — voir
// drillIntoSqrt/pending.drilled.part==='sqrt' dans history.js.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=9');

  // Étape 1 : enveloppe les deux membres dans "√(...)" (voir sqrt_arm_confirm.js).
  await page.evaluate(() => {
    window.App.History.selectOp('expr');
    window.App.History.toggleSquareRootArmed();
    window.App.History.confirmSquareRoot();
  });
  await page.waitForTimeout(100);

  const wrapped = await page.evaluate(() => window.App.History.lastEquation());
  ok('left side is now a lone SqrtGroup wrapping "(x+3)²"', wrapped.left.length === 1 && !!wrapped.left[0].radicand);
  ok('right side is now a lone SqrtGroup wrapping "9"', wrapped.right.length === 1 && !!wrapped.right[0].radicand);

  // Double-clic (2 clics rapides) sur la racine de gauche : entre dedans.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(100);

  let drilled = await page.evaluate(() => window.App.History.getPending().drilled);
  console.log('pending.drilled apres double-clic:', JSON.stringify(drilled));
  ok('drilled into the sqrt (part==="sqrt", path=[0])', drilled && drilled.side === 'left' && drilled.part === 'sqrt' && JSON.stringify(drilled.path) === '[0]');

  // Le rendu "drillé" doit produire des termes intérieurs sélectionnables individuellement
  // (ids "-inner-j"), sans planter KaTeX (contrôlé via les erreurs console/page ci-dessous).
  const innerSelectableCount = await page.evaluate(() => document.querySelectorAll('[data-inner-index]').length);
  ok('drilled radicand renders its single inner node as selectable', innerSelectableCount === 1);

  await page.screenshot({ path: `${SCRATCH}/sqrt_drilled.png` });

  // Sélectionne ce seul terme intérieur (le carré "(x+3)²") et le développe : doit
  // fonctionner exactement comme développer un FactorGroup/ProductGroup classique, mais en
  // restant À L'INTÉRIEUR de la racine.
  await page.evaluate(() => {
    window.App.History.toggleInnerSelection(0);
    window.App.History.confirmExpandFullSelection();
  });
  await page.waitForTimeout(100);

  const afterExpand = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres avoir developpe a l\'interieur de la racine:', JSON.stringify(afterExpand));
  ok('left side is still a lone SqrtGroup (still wrapped)', afterExpand.left.length === 1 && !!afterExpand.left[0].radicand);
  ok('radicand now has 3 expanded terms (x²+6x+9)', afterExpand.left[0].radicand.length === 3);
  const radStr = JSON.stringify(afterExpand.left[0].radicand);
  ok('radicand contains x² (pow 2)', /"pow":2/.test(radStr));
  ok('radicand contains 6x (pow 1)', afterExpand.left[0].radicand.some((t) => t.pow === 1 && t.coeff === 6));
  ok('radicand contains +9 (pow 0)', afterExpand.left[0].radicand.some((t) => t.pow === 0 && t.coeff === 9));
  ok('right side untouched (still √9)', JSON.stringify(afterExpand.right) === JSON.stringify(wrapped.right));

  // Développer ressort automatiquement du groupe (resetPending, même comportement qu'un
  // FactorGroup classique) : re-double-clique pour re-entrer dans la racine, puis
  // sélectionne 2 des 3 termes intérieurs qui partagent un facteur commun (6x et 9, par 3)
  // et factorise — doit fonctionner exactement comme pour un membre classique, toujours À
  // L'INTÉRIEUR de la racine.
  drilled = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('Développer exits the drill (resetPending, same as a classic FactorGroup)', drilled === null);

  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(100);
  drilled = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('re-entered the sqrt for a second round', drilled && drilled.part === 'sqrt');

  const sixAndNineIdx = afterExpand.left[0].radicand
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => (t.pow === 1 && t.coeff === 6) || (t.pow === 0 && t.coeff === 9))
    .map(({ i }) => i);
  await page.evaluate((idx) => {
    idx.forEach((i) => window.App.History.toggleInnerSelection(i));
    window.App.History.enterFactorWithSelection();
    window.App.History.chooseFactorMode('common');
    window.App.History.setFactorTermLatex('3');
    window.App.History.confirm();
  }, sixAndNineIdx);
  await page.waitForTimeout(100);

  const afterFactor = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres avoir factorise a l\'interieur de la racine:', JSON.stringify(afterFactor));
  ok('radicand now has 2 nodes (x² and 3(2x+3))', afterFactor.left[0].radicand.length === 2);
  ok('one of them is a FactorGroup (3(...))', afterFactor.left[0].radicand.some((n) => !!n.innerTerms && n.factor && n.factor.coeff === 3));

  // Ressort de la racine (exitDrill) : la sélection se vide, mais l'équation (déjà
  // développée/factorisée à l'intérieur) reste intacte.
  await page.evaluate(() => { window.App.History.exitDrill(); });
  await page.waitForTimeout(100);
  const afterExit = await page.evaluate(() => ({
    drilled: window.App.History.getPending().drilled,
    lastEquation: window.App.History.lastEquation()
  }));
  ok('exitDrill clears pending.drilled', afterExit.drilled === null);
  ok('equation unchanged by exitDrill itself', JSON.stringify(afterExit.lastEquation) === JSON.stringify(afterFactor));

  await page.screenshot({ path: `${SCRATCH}/sqrt_drill_exited.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
