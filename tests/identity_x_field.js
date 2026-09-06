const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function selectTerms(page, side, indices) {
  for (const i of indices) {
    await page.click(`.eq-row.current .side[data-side="${side}"] .term[data-index="${i}"]`);
  }
}

// Lit le texte affiché du champ NON focalisé — le label "a ="/"b =" (toujours visible) et
// la valeur (bouton statique) sont désormais deux éléments séparés (voir
// buildIdentityKeypad dans toolbar.js), donc on lit la boîte .identity-ab-field entière.
async function staticFieldText(page) {
  return page.evaluate(() => {
    var el = document.querySelector('.identity-ab-static');
    return el ? el.closest('.identity-ab-field').textContent.trim() : null;
  });
}

// Depuis le passage au clavier mathématique unifié (voir project_mathlive_keypad_overhaul
// memory / plan Phase C), il n'y a plus de désignation séparée "ce champ porte le x" : on
// tape directement la valeur voulue ("x", "2x", "5", ...) dans le champ focalisé, et l'app
// déduit automatiquement lequel de a/b est le terme en x (voir parseIdentityAB dans
// history.js). Ce fichier vérifie cette inférence automatique dans les deux sens (x dans
// "a" ou dans "b"), et qu'un coefficient explicite ("2x") est lui aussi bien reconnu.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  // --- Test 1 : taper "1" pour a reste un simple nombre (pas de x automatique) ---
  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await selectTerms(page, 'left', [0, 1, 2]);
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  await page.click('[data-key="1"]'); // focus par defaut = a
  await page.waitForTimeout(60);
  let pending = await page.evaluate(() => window.App.History.getPending());
  console.log('idALatex apres avoir tape 1:', JSON.stringify(pending.idALatex));
  ok('typing "1" for a stays a plain number (no auto x)', pending.idALatex === '1');

  await page.screenshot({ path: `${SCRATCH}/xfield1_no_auto_x.png` });

  // --- Test 2 : taper "x" directement dans "a" (au lieu d'un chiffre) est reconnu comme
  // le terme en x, sans aucune designation separee. ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await selectTerms(page, 'left', [0, 1, 2]);
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  await page.click('[data-key="x"]');
  await page.waitForTimeout(60);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('typing "x" directly in "a" sets idALatex to "x"', pending.idALatex === 'x');

  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="3"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const step1 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation (x tape dans a):', JSON.stringify(step1.equation), JSON.stringify(step1.opLeft));
  ok('x-in-a is inferred correctly, produces (x+3)^2', step1.equation.left[0].factors.length === 1 && step1.equation.left[0].factors[0].exponent === 2 &&
    JSON.stringify(step1.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));

  // --- Test 3 : le meme resultat en tapant "x" dans "b" (au lieu de "a") ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2+6x+9=0');
  await selectTerms(page, 'left', [0, 1, 2]);
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="1"]');
  // a = 3 (le nombre, sans x)
  await page.click('[data-key="3"]');
  // Attendre que idALatex ait bien reçu "3" avant de basculer le focus : l'évènement
  // "input" de MathLive est asynchrone, et un rebuild trop tôt reparente le champ vers
  // "b" avec un idALatex encore périmé (source de flakiness sous charge).
  await page.waitForFunction(() => window.App.History.getPending().idALatex === '3');
  // b = x
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  await page.click('[data-key="x"]');
  await page.waitForTimeout(60);
  pending = await page.evaluate(() => window.App.History.getPending());
  console.log('x tape dans b:', JSON.stringify({ idALatex: pending.idALatex, idBLatex: pending.idBLatex }));
  ok('x typed directly in "b" is inferred as the x-term', pending.idBLatex === 'x');
  const aFieldPlain = await staticFieldText(page);
  console.log('texte du champ "a" (label + valeur KaTeX, dupliquee en plusieurs copies internes) :', JSON.stringify(aFieldPlain));
  ok('"a" (non-focused) still shows plain "a=" with value "3"', !!aFieldPlain && aFieldPlain.indexOf('a=') !== -1 && aFieldPlain.indexOf('3') !== -1);

  await page.screenshot({ path: `${SCRATCH}/xfield2_b_is_x.png` });

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const step2 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation (b=x, a=3):', JSON.stringify(step2.equation), JSON.stringify(step2.opLeft));
  // (3+x)^2, PAS (x+3)^2 : l'ordre d'affichage suit a/b tel que tapé (voir
  // factorRemarkableIdentityChoice dans expression.js) — mathématiquement identique.
  ok('b-is-x path produces the mathematically equivalent (3+x)^2, order following a/b as typed',
    step2.equation.left[0].factors.length === 1 && step2.equation.left[0].factors[0].exponent === 2 &&
    JSON.stringify(step2.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 3, pow: 0 }, { coeff: 1, pow: 1 }]));

  await page.screenshot({ path: `${SCRATCH}/xfield3_after_confirm.png` });

  // --- Test 4 : un coefficient explicite ("2x") est aussi bien reconnu comme le terme en
  // x, pas seulement un "x" nu. ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x^2-6x+9=0');
  await selectTerms(page, 'left', [0, 1, 2]);
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="2"]'); // (a-b)^2
  await page.click('[data-key="x"]');
  await page.waitForFunction(() => window.App.History.getPending().idALatex === 'x');
  // "↵" depuis "a" bascule vers "b" (comme Tab) plutôt que de tenter une validation
  // forcément incomplète — voir bindFactorKeypad dans toolbar.js.
  await page.click('[data-key="enter"]');
  await page.waitForFunction(() => {
    var box = document.querySelector('.identity-ab-field.identity-ab-live');
    var field = box && box.querySelector('math-field');
    return !!field && document.activeElement === field;
  });
  let pendAfterEnterOnA = await page.evaluate(() => window.App.History.getPending());
  ok('"↵" on "a" switches focus to "b" without erroring', pendAfterEnterOnA.idFocus === 'b' && !pendAfterEnterOnA.error);
  await page.click('[data-key="enter"]'); // b toujours vide -> confirm doit maintenant echouer
  let pendAfterEmptyB = await page.evaluate(() => window.App.History.getPending());
  ok('confirming with b empty surfaces an error (no step added yet)', !!pendAfterEmptyB.error);
  await page.click('[data-key="3"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const step3 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation (identite 2, a=x, b=3):', JSON.stringify(step3.equation));
  ok('identity 2 with bare "x" in a produces (x-3)^2', step3.equation.left[0].factors.length === 1 && step3.equation.left[0].factors[0].exponent === 2 &&
    JSON.stringify(step3.equation.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -3, pow: 0 }]));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
