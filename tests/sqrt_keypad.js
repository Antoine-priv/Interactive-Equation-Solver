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

  // Le bouton standalone "Racine carrée" ne doit plus exister.
  const standaloneBtn = await page.$('button[data-op="sqrt"]');
  ok('standalone "Racine carrée" button removed', standaloneBtn === null);

  // (x+3)^2 = 9 : ouvrir "Operation", la touche "root" doit etre cliquable directement,
  // sans aucune selection prealable.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=9');

  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(50);

  const rootKeyInfo = await page.evaluate(() => {
    var rootBtn = document.querySelector('[data-key="sqrt"]');
    return rootBtn ? { found: true, disabled: rootBtn.disabled } : { found: false };
  });
  console.log('touche racine carree dans le pave Operation:', JSON.stringify(rootKeyInfo));
  ok('sqrt key present in Opération keypad', rootKeyInfo.found);
  ok('sqrt key enabled without any prior selection', rootKeyInfo.found && !rootKeyInfo.disabled);

  await page.screenshot({ path: `${SCRATCH}/sqrt_keypad_before.png` });

  // Cliquer sur la touche "√" ARME seulement la racine carrée (ne confirme plus rien
  // elle-même, voir toggleSquareRootArmed dans history.js) : il faut ensuite cliquer
  // "Valider", comme pour toute autre opération de ce pavé. Étape 1 : enveloppe les deux
  // membres, aucune branche encore.
  await page.click('[data-key="sqrt"]');
  await page.waitForTimeout(150);

  const armedState = await page.evaluate(() => ({
    sqrtArmed: window.App.History.getPending().sqrtArmed,
    branches: window.App.History.getBranches()
  }));
  console.log('etat apres clic sur la touche racine carree (armement seul, etape 1):', JSON.stringify(armedState));
  ok('clicking the sqrt key only arms it (no branches yet)', armedState.sqrtArmed === true && armedState.branches === null);

  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);

  const wrappedState = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    isWrapped: window.App.Expr.isSqrtGroup(window.App.History.lastEquation().left[0])
  }));
  console.log('etat apres Valider (etape 1):', JSON.stringify(wrappedState));
  ok('stage 1 confirm wraps both sides without creating branches yet', wrappedState.branches === null && wrappedState.isWrapped === true);

  // Étape 2 : le bouton "Simplifier" habituel (pas un second armement de la touche "√",
  // voir toolbar.js) simplifie réellement et scinde en 2 — re-ouvrir "Opération" montre que
  // la touche "√" elle-même reste désactivée (stage 1 déjà fait, plus rien à envelopper).
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  const sqrtKeyStillDisabled = await page.evaluate(() => {
    var rootBtn = document.querySelector('[data-key="sqrt"]');
    return rootBtn ? rootBtn.disabled : null;
  });
  ok('sqrt key stays disabled once wrapped (stage 2 only reachable via Simplifier)', sqrtKeyStillDisabled === true);
  await page.click('button[data-op="expr"]'); // referme "Opération", inutile pour Simplifier
  await page.waitForTimeout(80);

  await page.click('button[data-op="simplify"]');
  await page.waitForTimeout(150);

  const branches = await page.evaluate(() => {
    var bs = window.App.History.getBranches();
    return bs ? bs.map((b) => b.lastEquation()) : null;
  });
  console.log('branches apres avoir clique sur Simplifier (etape 2):', JSON.stringify(branches));
  ok('stage 2 confirm splits into 2 real branches', branches && branches.length === 2);

  // Etiquette de la fleche : le mot "simplifier" (l'action réellement déclenchée), pas le
  // symbole racine carrée ni le mot "racine".
  const labelLatexSource = await page.evaluate(() => {
    var el = document.querySelector('.arrow-label-fork annotation');
    return el ? el.textContent : null;
  });
  console.log('source LaTeX de l etiquette:', JSON.stringify(labelLatexSource));
  ok('fork label reads "simplifier", not the sqrt symbol or the word "racine"',
    /simplifier/.test(labelLatexSource || '') && !/\\sqrt/.test(labelLatexSource || '') && !/racine/i.test(labelLatexSource || ''));

  await page.screenshot({ path: `${SCRATCH}/sqrt_keypad_after.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
