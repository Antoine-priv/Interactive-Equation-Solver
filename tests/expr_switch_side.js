const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Cliquer sur le miroir en lecture seule (le membre opposé au champ live, voir
// drawMirrorField dans arrows.js) ne doit PLUS annuler l'opération en cours (régression :
// il tombait "en dehors" de toute zone reconnue par le clic-en-dehors de toolbar.js) — il
// doit au contraire basculer le VRAI champ live vers CE membre, pour continuer à composer
// l'opération depuis n'importe quel côté (voir switchExprLiveSide).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  function pendingState() {
    return page.evaluate(() => {
      var pending = window.App.History.getPending();
      var live = document.getElementById('liveOpPill');
      var mirror = document.querySelector('.arrow-label-mirror');
      var field = live && live.querySelector('math-field');
      return {
        opType: pending.opType,
        exprLatex: pending.exprLatex,
        liveSide: live ? (live.classList.contains('arrow-label-left') ? 'left' : 'right') : null,
        mirrorSide: mirror ? (mirror.classList.contains('arrow-label-left') ? 'left' : 'right') : null,
        fieldFocused: field ? document.activeElement === field : false
      };
    });
  }

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  await page.keyboard.type('+3');
  await page.waitForTimeout(80);

  let state = await pendingState();
  console.log('avant clic sur le miroir:', JSON.stringify(state));
  ok('live field starts on the left', state.liveSide === 'left');
  ok('mirror starts on the right', state.mirrorSide === 'right');

  await page.click('.arrow-label-mirror');
  await page.waitForTimeout(80);

  state = await pendingState();
  console.log('apres clic sur le miroir (droite):', JSON.stringify(state));
  ok('clicking the mirror does NOT cancel the operation', state.opType === 'expr');
  ok('the typed content survives the switch ("+3" still there)', state.exprLatex === '+3');
  ok('the live field moved to the right side', state.liveSide === 'right');
  ok('the mirror is now on the left', state.mirrorSide === 'left');
  ok('the (now real) field on the right is focused', state.fieldFocused);

  await page.screenshot({ path: `${SCRATCH}/expr_switch_side_after_click.png` });

  // --- On doit pouvoir continuer à taper depuis ce côté, et le résultat final doit être
  // cohérent avec la frappe complète "+3" puis "+4" (rien perdu/corrompu au passage). ---
  await page.keyboard.type('+4');
  await page.waitForTimeout(80);
  state = await pendingState();
  console.log('apres avoir continue a taper a droite:', JSON.stringify(state));
  ok('typing continues correctly from the right side ("+3+4")', state.exprLatex === '+3+4');

  // --- Re-cliquer sur le miroir (maintenant à gauche) doit rebasculer, sans rien perdre. ---
  await page.click('.arrow-label-mirror');
  await page.waitForTimeout(80);
  state = await pendingState();
  console.log('apres avoir re-clique sur le miroir (gauche):', JSON.stringify(state));
  ok('switching back to the left works too', state.opType === 'expr' && state.liveSide === 'left');
  ok('content is still intact after switching back and forth', state.exprLatex === '+3+4');

  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation finale (x=5, +3+4):', JSON.stringify(step.equation));
  ok('confirms correctly to x+3+4=5+3+4', JSON.stringify(step.equation) === JSON.stringify({
    left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }, { coeff: 4, pow: 0 }],
    right: [{ coeff: 5, pow: 0 }, { coeff: 3, pow: 0 }, { coeff: 4, pow: 0 }]
  }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
