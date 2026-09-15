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
  // déjà l'action attendue pour l'étape 2.
  const simplifyBtn = await page.$('button[data-op="simplify"]');
  const simplifyAvailable = await simplifyBtn.evaluate((el) => !el.disabled && !el.closest('.op-row').hidden);
  ok('"Simplifier" is available on the wrapped (still unresolved) equation', simplifyAvailable);

  // Étape 2 (simplifier) : échoue, l'équation est déjà enveloppée et son radicand est
  // reconnaissable (carré parfait / constante nue), mais la constante est négative.
  await simplifyBtn.click();
  await page.waitForTimeout(120);

  const afterFail = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    panelErrorText: (document.querySelector('#controlPanel .panel-error') || {}).textContent || null
  }));
  ok('exact red error message shown in the floating panel', afterFail.panelErrorText === 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.');
  ok('no branches created (confirm rejected)', afterFail.branches === null);

  await page.screenshot({ path: `${SCRATCH}/sqrt_negative_disabled.png` });

  // "Simplifier" stays clickable (no permanent disabling à la sqrtFailed) : a retry just
  // reproduces the same error rather than getting silently stuck.
  const stillAvailable = await simplifyBtn.evaluate((el) => !el.disabled && !el.closest('.op-row').hidden);
  ok('"Simplifier" remains clickable after failing (no permanent lock)', stillAvailable);
  await simplifyBtn.click();
  await page.waitForTimeout(120);
  const afterRetry = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    panelErrorText: (document.querySelector('#controlPanel .panel-error') || {}).textContent || null
  }));
  ok('retrying reproduces the same error, still no branches', afterRetry.branches === null &&
    afterRetry.panelErrorText === 'Impossible d\'appliquer la racine carrée d\'un nombre négatif.');

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
