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

// "Racine carrée" est maintenant en 2 étapes : armer+valider enveloppe D'ABORD les deux
// membres entiers dans "√(...)" (aucune branche, un pas normal de la chaîne) ; il faut
// ENSUITE re-armer+re-valider (la touche redevient disponible, cette fois pour "simplifier")
// pour annuler racine+carré et scinder en ± — voir squareRootStage/confirmSquareRoot dans
// history.js.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+3)^2=9');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(150);

  // 1) Juste apres avoir ouvert "Operation" : PAS de branches, PAS de preview colonnes.
  let state = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    previewCount: document.querySelectorAll('.produit-nul-preview').length,
    pendingRowCount: document.querySelectorAll('.eq-row.pending').length
  }));
  console.log('juste apres Operation:', JSON.stringify(state));
  ok('no branches yet', state.branches === null);
  ok('no sqrt preview columns before arming', state.previewCount === 0);
  ok('generic pending echo row still shows normally (nothing armed yet)', state.pendingRowCount === 1);

  // 2) Clique sur "√" (arme la racine carree, étape 1 = envelopper) : PAS de preview
  // colonnes (une seule équation enveloppée, pas de scission), PAS de ligne pending
  // générique en double.
  const sqrtKey = await findSqrtKey(page);
  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(150);
  state = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    previewColumnCount: document.querySelectorAll('.produit-nul-preview .produit-nul-branch').length,
    pendingRowCount: document.querySelectorAll('.eq-row.pending').length,
    sqrtArmed: window.App.History.getPending().sqrtArmed
  }));
  console.log('apres avoir clique sur la touche racine carree (armee, etape 1):', JSON.stringify(state));
  ok('sqrtArmed is true', state.sqrtArmed === true);
  ok('still no real branches (armed, not confirmed)', state.branches === null);
  ok('stage 1 preview is a single wrapped equation, no fork columns', state.previewColumnCount === 0);
  ok('no duplicate generic pending echo row while armed (no "preview of a preview")', state.pendingRowCount === 1);

  await page.screenshot({ path: `${SCRATCH}/sqrt_armed.png` });

  // 3) Les autres touches du pave sont desactivees pendant que "racine" est armee.
  const digitDisabled = await page.evaluate(() => {
    var sevenBtn = document.querySelector('[data-key="7"]');
    return sevenBtn ? sevenBtn.disabled : null;
  });
  ok('other keys (e.g. digit 7) disabled while sqrt is armed', digitDisabled === true);

  // 4) Clique sur "Valider" : l'enveloppement (étape 1) se produit REELLEMENT maintenant —
  // toujours pas de branches, juste un pas normal de plus dans la chaîne.
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(300);
  state = await page.evaluate(() => ({
    branches: window.App.History.getBranches(),
    lastEquation: window.App.History.lastEquation()
  }));
  console.log('apres avoir clique sur Valider (etape 1):', JSON.stringify(state));
  ok('stage 1 confirm does NOT create branches yet', state.branches === null);
  ok('both sides are now wrapped in a SqrtGroup', JSON.stringify(state.lastEquation) ===
    JSON.stringify({ left: [{ sign: 1, radicand: [{ sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 2 }] }] }], right: [{ sign: 1, radicand: [{ coeff: 9, pow: 0 }] }] }));

  await page.screenshot({ path: `${SCRATCH}/sqrt_wrapped.png` });

  // 5) L'étape 2 (simplifier) n'utilise plus la touche "√" (ré-armer une seconde fois pour
  // un effet complètement différent n'était pas clair) : c'est désormais le bouton
  // "Simplifier" habituel qui la porte — MAIS seulement une fois au moins un membre
  // sélectionné (voir squareRootSimplifyAction dans history.js) : rien sélectionné, le
  // bouton reste indisponible comme n'importe quel autre "Simplifier" sans sélection.
  const simplifyBtn = await page.$('button[data-op="simplify"]');
  const simplifyDisabledNoSelection = await simplifyBtn.evaluate((el) => el.disabled || el.closest('.op-row').hidden);
  ok('"Simplifier" stays unavailable with nothing selected, even once wrapped', simplifyDisabledNoSelection === true);

  // Sélectionne les DEUX membres (mode 'both', même résultat qu'avant) : clique chaque
  // "√(...)" de l'équation encadrée.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('right', 0);
  });
  await page.waitForTimeout(80);
  const simplifyDisabledAfter = await simplifyBtn.evaluate((el) => el.disabled || el.closest('.op-row').hidden);
  ok('"Simplifier" becomes available once both sides are selected', simplifyDisabledAfter === false);

  await simplifyBtn.hover();
  await page.waitForTimeout(150);
  const stage2HoverState = await page.evaluate(() => ({
    previewColumnCount: document.querySelectorAll('.produit-nul-preview .produit-nul-branch').length
  }));
  ok('hovering "Simplifier" shows the real ± fork preview (2 columns)', stage2HoverState.previewColumnCount === 2);

  await simplifyBtn.click();
  await page.waitForTimeout(300);
  state = await page.evaluate(() => ({
    branches: window.App.History.getBranches() ? window.App.History.getBranches().map((b) => b.lastEquation()) : null
  }));
  console.log('apres avoir clique sur Valider (etape 2):', JSON.stringify(state));
  ok('stage 2 confirm actually creates the ± branches', state.branches && state.branches.length === 2);
  ok('branch 0 is x+3=3', state.branches && JSON.stringify(state.branches[0]) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 3, pow: 0 }] }));
  ok('branch 1 is x+3=-3', state.branches && JSON.stringify(state.branches[1]) ===
    JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -3, pow: 0 }] }));

  await page.screenshot({ path: `${SCRATCH}/sqrt_confirmed.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
