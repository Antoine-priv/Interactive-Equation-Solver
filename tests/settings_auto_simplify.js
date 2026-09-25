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

  async function start(eq) {
    await page.evaluate((eq) => {
      var parsed = window.App.Parser.parseEquation(eq);
      window.App.History.startNewEquation({ left: parsed.left, right: parsed.right });
    }, eq);
    await page.waitForTimeout(100);
  }
  async function op(text) {
    await page.evaluate((text) => {
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(text);
      window.App.History.confirm();
    }, text);
    await page.waitForTimeout(150);
  }
  const steps = () => page.evaluate(() => window.App.History.getSteps().length);
  const last = () => page.evaluate(() => JSON.stringify(window.App.History.lastEquation()));

  // 1) Bouton engrenage : à droite du bouton thème, même ligne.
  const pos = await page.evaluate(() => {
    var t = document.getElementById('themeToggleBtn').getBoundingClientRect();
    var s = document.getElementById('settingsBtn').getBoundingClientRect();
    return { t: { l: t.left, r: t.right, top: t.top }, s: { l: s.left, top: s.top }, svg: !!document.querySelector('#settingsBtn svg') };
  });
  ok('settings button right of theme toggle, same row', pos.s.l > pos.t.r && pos.s.top === pos.t.top);
  ok('settings button shows an icon', pos.svg);

  // 2) Par défaut désactivé : une opération ne simplifie pas.
  ok('autoSimplify off by default', await page.evaluate(() => window.App.Settings.get('autoSimplify')) === false);
  await start('2x+3=7');
  await op('-3');
  ok('without setting: one step added', await steps() === 2);

  // 3) Ouvrir la fenêtre, activer l'interrupteur.
  await page.click('#settingsBtn');
  await page.waitForTimeout(250);
  ok('settings modal opens', await page.evaluate(() => !document.getElementById('settingsOverlay').hidden));
  const unchecked = await page.evaluate(() => document.querySelector('input[data-setting="autoSimplify"]').checked);
  ok('switch initially unchecked', unchecked === false);
  await page.click('#settingsOverlay .ios-switch');
  ok('switch toggles the setting on', await page.evaluate(() => window.App.Settings.get('autoSimplify')) === true);
  await page.screenshot({ path: SCRATCH + '/settings_modal.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('Escape closes settings modal', await page.evaluate(() => document.getElementById('settingsOverlay').hidden));

  // 4) Activé : "-3" donne directement 2x=4, en UNE seule étape étiquetée "-3".
  await start('2x+3=7');
  await op('-3');
  ok('with setting: a single step added', await steps() === 2);
  ok('with setting: equation is directly 2x=4', await last() === JSON.stringify({ left: [{ coeff: 2, pow: 1 }], right: [{ coeff: 4, pow: 0 }] }));
  const lastStep = await page.evaluate(() => { var s = window.App.History.getSteps(); var l = s[s.length - 1]; return { l: l.opLeft && l.opLeft.type, r: l.opRight && l.opRight.type }; });
  ok('the step keeps the operation label on both sides', lastStep.l === 'expr' && lastStep.r === 'expr');
  await page.screenshot({ path: SCRATCH + '/settings_auto_simplify_step.png' });

  // 5) Undo revient à l'équation de départ.
  await page.click('#undoBtn');
  await page.waitForTimeout(150);
  ok('undo returns to the initial equation', await steps() === 1);

  // 6) Rien à simplifier (÷2 sur un terme seul) : pas d'étape en plus.
  await start('2x=4');
  await op('\\div 2');
  ok('nothing to simplify: single step, x=2', await steps() === 2 && await last() === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 2, pow: 0 }] }));

  // 7) Persistance après rechargement.
  await page.reload();
  await page.waitForTimeout(200);
  ok('setting persisted across reload', await page.evaluate(() => window.App.Settings.get('autoSimplify')) === true);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
