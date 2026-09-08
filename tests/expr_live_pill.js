const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Pendant la composition d'une "Opération" (+/-/×/÷), le pill de la ligne "pending" (côté
// gauche, par convention, voir computeLiveOpInfo dans render.js) est désormais le
// <math-field> partagé lui-même (curseur inclus) plutôt qu'un texte KaTeX statique
// dupliquant ce qu'un champ séparé montrait ailleurs à l'écran (voir mathKeypad.js). Le
// côté droit garde son pill statique habituel (même contenu, recalculé à chaque frappe).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  function livePillInfo() {
    return page.evaluate(() => {
      var pill = document.getElementById('liveOpPill');
      var field = pill && pill.querySelector('math-field');
      var warn = pill && pill.querySelector('.arrow-label-live-warn');
      return {
        visible: !!pill && !pill.hidden,
        onLeft: !!pill && pill.classList.contains('arrow-label-left'),
        isWarning: !!pill && pill.classList.contains('arrow-label-warning'),
        warnHidden: !warn || warn.hidden,
        warnText: warn ? warn.textContent : null,
        fieldFocused: field ? document.activeElement === field : false
      };
    });
  }
  function staticLabels() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll('.arrow-label')).map((el) => el.textContent));
  }

  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);

  // --- Dès l'entrée en mode 'expr', le pavé live est visible + focalisé, à gauche. ---
  let info = await livePillInfo();
  console.log('pavé live juste apres entree en mode expr:', JSON.stringify(info));
  ok('live pill visible immediately on entering "expr" mode', info.visible);
  ok('live pill anchored on the left side', info.onLeft);
  ok('field is focused, ready to type', info.fieldFocused);
  ok('no warning styling yet (nothing typed)', !info.isWarning && info.warnHidden);

  // --- Frappe d'une chaîne sans risque : pill live à gauche, pill statique à droite. ---
  await page.keyboard.type('+3');
  await page.waitForTimeout(80);
  info = await livePillInfo();
  const latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex tape:', JSON.stringify(latex), '- pavé live:', JSON.stringify(info));
  ok('typed latex is "+3"', latex === '+3');
  ok('still no warning styling for a plain "+3"', !info.isWarning && info.warnHidden);
  let labels = await staticLabels();
  console.log('pills statiques (cote droit) apres +3:', JSON.stringify(labels));
  ok('exactly one static pill remains (the right side)', labels.length === 1 && /\+3/.test(labels[0]));

  await page.screenshot({ path: `${SCRATCH}/expr_live_pill_plus3.png` });

  // --- Frappe d'une opération à risque (×(x+5)) : réserve "valide si..." + couleur alerte. ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  await page.evaluate((l) => { window.App.History.setExprChainText(l); }, '\\times\\left(x+5\\right)');
  await page.waitForTimeout(80);
  info = await livePillInfo();
  console.log('pavé live apres ×(x+5):', JSON.stringify(info));
  ok('warning styling applied on the live pill for a zero-risk multiplier', info.isWarning);
  ok('the "valide si..." caption is shown (not baked into the editable field)', !info.warnHidden && /valide/.test(info.warnText) && /≠/.test(info.warnText));
  labels = await staticLabels();
  ok('the static (right) pill still carries the full caveat text too', labels.length === 1 && /valide/.test(labels[0]));

  await page.screenshot({ path: `${SCRATCH}/expr_live_pill_warning.png` });

  // --- Confirmer : le pavé live disparaît, l'étape confirmée garde ses 2 pills statiques. ---
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);
  info = await livePillInfo();
  ok('live pill hidden again once confirmed', !info.visible);
  labels = await staticLabels();
  console.log('pills apres confirmation:', JSON.stringify(labels));
  ok('confirmed step shows both static pills again (left + right)', labels.length === 2);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation confirmee (x=5, ×(x+5)):', JSON.stringify(step.equation));
  ok('confirmed equation multiplied both sides by (x+5) (ProductGroup on both sides)',
    step.equation.left[0].factors && step.equation.right[0].factors);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
