const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

// Numérateur drillé contenant des produits (niveau O1 après "9x²-4" → "(3x-2)(3x+2)") :
// comme au premier niveau, un clic simple marque CE facteur, un produit dont tous les
// facteurs sont marqués compte comme sélectionné en entier (pour le facteur commun), le
// double-clic continuant d'entrer dans le facteur (voir clickNestedFactor dans history.js).
// Un produit sélectionné garde son fond jaune sous la souris.

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(FILE);
  await page.evaluate(() => window.App.History.startNewEquation(window.App.Parser.parseLatexEquation(
    '\\frac{9x^2-4+(3-2x)(3x-2)}{x^2+2x+1-(2x-3)^2}=0', { keepFractions: true })));
  await page.waitForTimeout(100);

  // Double-clic sur le numérateur, puis 9x²-4 = (3x-2)(3x+2) (a² − b²).
  await page.evaluate(() => {
    const h = window.App.History;
    h.toggleTermSelection('left', 0); h.toggleTermSelection('left', 0);
    h.toggleInnerSelection(0); h.toggleInnerSelection(1);
    h.enterFactorWithSelection(); h.chooseFactorMode(3);
    h.setIdentityFieldLatex('3x'); h.setIdentityFocus('b'); h.setIdentityFieldLatex('2'); h.confirm();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => { const h = window.App.History; h.toggleTermSelection('left', 0); h.toggleTermSelection('left', 0); });
  await page.waitForTimeout(700);

  const factor = (i, j) => page.$(`.eq-row.current [id$="-0-inner-${i}-factor-${j}"]`);
  const clickFactor = async (i, j) => {
    const box = await (await factor(i, j)).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  ok('both nested products render their factors', !!(await factor(0, 0)) && !!(await factor(1, 1)));

  const state = () => page.evaluate(() => {
    const p = window.App.History.getPending();
    const sel = [...document.querySelectorAll('.eq-row.current .factor-slot.selected')].map(e => e.id.replace(/.*-inner-/, ''));
    return { inner: p.selectedInner.slice().sort(), sel: sel.sort() };
  });
  await clickFactor(0, 1);
  await page.waitForTimeout(400);
  let st = await state();
  ok('a click on a factor selects only that factor', st.inner.length === 0 && st.sel.join() === '0-factor-1');

  await clickFactor(0, 0);
  await page.waitForTimeout(400);
  st = await state();
  ok('marking every factor selects the whole product', st.inner.join() === '0' && st.sel.join() === '0-factor-0,0-factor-1');

  await clickFactor(0, 0);
  await page.waitForTimeout(400);
  st = await state();
  ok('unmarking one factor deselects the product', st.inner.length === 0 && st.sel.join() === '0-factor-1');

  await clickFactor(0, 0);
  await page.waitForTimeout(400);
  await clickFactor(1, 0);
  await page.waitForTimeout(400);
  await clickFactor(1, 1);
  await page.waitForTimeout(400);
  st = await state();
  ok('two whole products selected factor by factor', st.inner.join() === '0,1');

  // La souris est restée sur le dernier facteur cliqué : le produit reste jaune.
  const bg = await page.evaluate(() => {
    const el = document.querySelector('.eq-row.current [data-inner-index="1"]');
    return [el.matches(':hover'), getComputedStyle(el).backgroundColor];
  });
  await page.screenshot({ path: __dirname + '/screenshots/nested_product_select.png', clip: { x: 0, y: 150, width: 1400, height: 450 } });
  ok('a selected product stays yellow under the mouse', bg[0] && bg[1] === 'rgb(253, 230, 138)');

  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(100);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(150);
  await page.keyboard.type('3x-2');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(300);
  const eq = await page.evaluate(() => window.App.History.lastEquation());
  const num = eq.left[0].innerTerms;
  ok('common factor (3x-2) applied to the numerator', num.length === 1 && num[0].factors && num[0].factors.length === 2);

  // Double-clic sur un facteur : on entre toujours dedans.
  await page.evaluate(() => { const h = window.App.History; h.toggleTermSelection('left', 0); h.toggleTermSelection('left', 0); });
  await page.waitForTimeout(700);
  const box = await (await factor(0, 1)).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  p = await page.evaluate(() => window.App.History.getPending());
  ok('double-click still drills into the factor', p.drilled && p.drilled.branch === 1 && p.selectedInner.length === 0);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs);
  await browser.close();
})();
