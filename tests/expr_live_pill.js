const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Pendant la composition d'une "Opération" (+/-/×/÷), les DEUX membres de la ligne
// "pending" affichent désormais un <math-field> (voir computeLiveOpInfo dans render.js) :
// le gauche est le vrai champ partagé (curseur inclus, voir bindLiveOpField dans
// mathKeypad.js), le droit un second champ "miroir" en lecture seule qui recopie le même
// texte tapé (voir drawMirrorField dans arrows.js) — plus de simple texte KaTeX statique
// d'un côté et un champ interactif de l'autre.
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
        warnColor: warn ? getComputedStyle(warn).color : null,
        pillBg: pill ? getComputedStyle(pill).backgroundColor : null,
        caretColor: field ? getComputedStyle(field).getPropertyValue('--caret-color').trim() : null,
        fieldFocused: field ? document.activeElement === field : false
      };
    });
  }
  function mirrorInfo() {
    return page.evaluate(() => {
      var el = document.querySelector('.arrow-label-mirror');
      var field = el && el.querySelector('math-field');
      var warn = el && el.querySelector('.arrow-label-live-warn');
      return {
        present: !!el,
        onRight: !!el && el.classList.contains('arrow-label-right'),
        isWarning: !!el && el.classList.contains('arrow-label-warning'),
        readOnly: field ? field.hasAttribute('read-only') : null,
        value: field ? field.getValue() : null,
        warnText: warn ? warn.textContent : null,
        bg: el ? getComputedStyle(el).backgroundColor : null,
        focused: field ? document.activeElement === field : false
      };
    });
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

  // --- Frappe d'une chaîne sans risque : les deux côtés sont des math-field, en phase. ---
  await page.keyboard.type('+3');
  await page.waitForTimeout(80);
  info = await livePillInfo();
  const latex = await page.evaluate(() => window.App.MathKeypad.getLatex());
  console.log('latex tape:', JSON.stringify(latex), '- pavé live:', JSON.stringify(info));
  ok('typed latex is "+3"', latex === '+3');
  ok('still no warning styling for a plain "+3"', !info.isWarning && info.warnHidden);

  let mirror = await mirrorInfo();
  console.log('miroir (cote droit) apres +3:', JSON.stringify(mirror));
  ok('a mirror math-field is shown on the right side', mirror.present && mirror.onRight);
  ok('the mirror is read-only (no second real cursor)', mirror.readOnly);
  ok('the mirror shows exactly the same latex as the live field ("+3")', mirror.value === '+3');
  ok('the mirror never steals focus', !mirror.focused);
  ok('no warning on the mirror either for a plain "+3"', !mirror.isWarning);

  await page.screenshot({ path: `${SCRATCH}/expr_live_pill_plus3.png` });

  // --- Frappe d'une opération à risque (×(x+5)) : réserve "valide si..." + couleur alerte
  // sur les DEUX côtés (curseur du champ live, texte/fond du pill live ET du miroir). ---
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, 'x=5');
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(80);
  await page.evaluate((l) => { window.App.History.setExprChainText(l); }, '\\times\\left(x+5\\right)');
  await page.waitForTimeout(80);
  info = await livePillInfo();
  console.log('pavé live apres ×(x+5):', JSON.stringify(info));
  ok('warning styling applied on the live pill for a zero-risk multiplier', info.isWarning);
  ok('the "valide si..." caption is shown (not baked into the editable field)', !info.warnHidden && /valide/.test(info.warnText) && /≠/.test(info.warnText));

  const themeColors = await page.evaluate(() => {
    var root = getComputedStyle(document.documentElement);
    var probe = document.createElement('div');
    document.body.appendChild(probe);
    probe.style.background = 'var(--warning-soft)';
    var warningSoftBg = getComputedStyle(probe).backgroundColor;
    probe.style.background = 'var(--accent-soft)';
    var accentSoftBg = getComputedStyle(probe).backgroundColor;
    probe.remove();
    // --warning elle-même (custom property brute, ex. "#b45309") : comparée telle quelle
    // à --caret-color (posée via `--caret-color: var(--warning)`, voir style.css), pas
    // via la propriété standard `color` (dont le format normalisé par le navigateur, ex.
    // "rgb(...)", ne correspond pas forcément à celui, brut, d'une custom property).
    return { warningRaw: root.getPropertyValue('--warning').trim(), warningSoftBg: warningSoftBg, accentSoftBg: accentSoftBg };
  });
  ok('the live pill background actually turns to the same yellow/orange as before (--warning-soft)',
    info.pillBg === themeColors.warningSoftBg);
  ok('the live pill background is no longer the default accent-soft once warned',
    info.pillBg !== themeColors.accentSoftBg);
  ok('the live field caret color switches to the warning color (--warning), not blue', info.caretColor === themeColors.warningRaw);

  mirror = await mirrorInfo();
  console.log('miroir apres ×(x+5):', JSON.stringify(mirror));
  ok('the mirror also gets the warning styling', mirror.isWarning);
  ok('the mirror shows its own "valide si..." caption too', mirror.warnText && /valide/.test(mirror.warnText));
  ok('the live pill and the mirror share the exact same warning background color', mirror.bg === info.pillBg);

  await page.screenshot({ path: `${SCRATCH}/expr_live_pill_warning.png` });

  // --- Confirmer : le pavé live ET le miroir disparaissent, l'étape confirmée reprend ses
  // 2 pills statiques KaTeX habituels (pas des math-field). ---
  await page.click('#mathKeypadPanel .panel-confirm-cell');
  await page.waitForTimeout(150);
  info = await livePillInfo();
  ok('live pill hidden again once confirmed', !info.visible);
  mirror = await mirrorInfo();
  ok('mirror field gone once confirmed', !mirror.present);
  const confirmedLabels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label:not(.arrow-label-mirror)')).map((el) => el.textContent));
  console.log('pills apres confirmation:', JSON.stringify(confirmedLabels));
  ok('confirmed step shows both static (KaTeX) pills again', confirmedLabels.length === 2);
  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation confirmee (x=5, ×(x+5)):', JSON.stringify(step.equation));
  ok('confirmed equation multiplied both sides by (x+5) (ProductGroup on both sides)',
    step.equation.left[0].factors && step.equation.right[0].factors);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
