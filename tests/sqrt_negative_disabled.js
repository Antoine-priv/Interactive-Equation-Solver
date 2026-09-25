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

// Racine carrée d'un nombre négatif : l'étape 1 (envelopper les deux membres, via la
// touche "√" du pavé "Opération") réussit toujours, rien à calculer encore. C'est l'étape
// 2 (simplifier : annuler racine+carré, calculer la racine numérique) — désormais portée
// par le bouton "Simplifier" habituel, pas un second armement de la touche "√" — qui
// échoue une fois l'équation déjà enveloppée : un message rouge précis s'affiche dans le
// panneau flottant générique (comme un choix d'identité remarquable invalide), et
// "Simplifier" reste cliquable (un réessai reproduirait juste la même erreur ; la seule
// vraie issue est de revenir en arrière jusqu'à une équation différente).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=-9');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);

  const sqrtKey = await findSqrtKey(page);
  const beforeState = await sqrtKey.evaluate((el) => el.disabled);
  ok('sqrt key is clickable even for a negative-constant equation', beforeState === false);

  // Étape 1 (envelopper) : réussit sans condition, rien à calculer encore.
  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(80);
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(120);
  const afterWrap = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    isWrapped: window.App.Expr.isSqrtGroup(window.App.History.lastEquation().left[0])
  }));
  ok('stage 1 (wrap) succeeds even for a negative constant', afterWrap.branches === null && afterWrap.isWrapped === true);

  // "Opération" (et sa touche "√") ne joue plus aucun rôle à ce stade : "Simplifier" est
  // déjà l'action attendue pour l'étape 2 — mais toujours indisponible tant que rien n'est
  // sélectionné (voir squareRootSimplifyAction dans history.js).
  const simplifyBtn = await page.$('button[data-op="simplify"]');
  const simplifyBeforeSelection = await simplifyBtn.evaluate((el) => !el.disabled && !el.closest('.op-row').hidden);
  ok('"Simplifier" stays unavailable with nothing selected, even once wrapped', simplifyBeforeSelection === false);

  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('right', 0);
  });
  await page.waitForTimeout(80);
  const simplifyAvailable = await simplifyBtn.evaluate((el) => !el.disabled && !el.closest('.op-row').hidden);
  ok('"Simplifier" becomes available once both sides are selected', simplifyAvailable);

  // Étape 2 (simplifier) : la constante est négative, un carré ne l'est jamais — la
  // résolution se conclut par S = ∅ (plus d'erreur), sur une ligne "(x+3)² = −9".
  await simplifyBtn.click();
  await page.waitForTimeout(150);

  const after = await page.evaluate(() => {
    var H = window.App.History, last = H.getSteps().slice(-1)[0];
    var fin = document.querySelector('.final-solution-set');
    return {
      branches: H.getBranches(),
      eq: last.equation,
      desc: last.opLeft,
      error: H.getPending().error,
      finalText: fin ? fin.textContent : null,
      labels: Array.from(document.querySelectorAll('[class*="label"]')).map((e) => e.textContent).join(' | '),
      ranges: window.App.Render.finalSolutionRanges()
    };
  });
  ok('no error, no branches', !after.error && after.branches === null);
  ok('last line is (x+3)² = −9, marked without solution', after.eq.noSolution === true &&
    JSON.stringify(after.eq.right) === JSON.stringify([{ coeff: -9, pow: 0 }]) && !!after.eq.left[0].factors);
  ok('arrow says a square is never negative', after.desc && after.desc.noSolution && /jamais négatif/.test(after.labels));
  ok('S = ∅ is shown', /∅/.test(after.finalText || '') && JSON.stringify(after.ranges) === '[]');
  await page.screenshot({ path: `${SCRATCH}/sqrt_negative_disabled.png` });

  // Même conclusion en ne sélectionnant que le côté constant.
  await page.evaluate(() => {
    var H = window.App.History;
    H.undo();
    H.toggleTermSelection('right', 0);
    H.confirmSquareRoot();
  });
  await page.waitForTimeout(120);
  ok('selecting only the constant side also concludes S = ∅', await page.evaluate(() =>
    JSON.stringify(window.App.Render.finalSolutionRanges()) === '[]'));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
