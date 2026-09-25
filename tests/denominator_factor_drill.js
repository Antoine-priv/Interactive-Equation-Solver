const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Entrer dans UN facteur d'un dénominateur-produit pour le factoriser (exercice 23 q3 :
// "(x²-4)√(-x+6)" au dénominateur) : double-clic sur le dénominateur, puis double-clic sur
// le facteur "(x²-4)", identité a²-b² — le produit du dénominateur devient
// "(x-2)(x+2)√(-x+6)".
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  await page.evaluate(() => {
    var e = window.App.Parser.parseLatexEquation('\\frac{x+1}{(x^2-4)\\sqrt{-x+6}}\\geq0');
    window.App.History.startNewEquation({ left: e.left, right: e.right }, { operator: e.operator });
  });
  await page.waitForTimeout(200);

  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.waitForTimeout(150);
  let d = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('double-click enters the denominator', d && d.part === 'den' && d.branch === undefined);

  const factorSel = '.eq-row.current [id$="-inner-0-factor-0"]';
  ok('each factor of the denominator product is marked', await page.$(factorSel) !== null);
  await page.click(factorSel);
  await page.click(factorSel);
  await page.waitForTimeout(150);
  d = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('double-click on (x²-4) enters that factor', d && d.part === 'den' && d.branch === 0);
  const innerCount = await page.$$eval('.eq-row.current [data-inner-index]', (els) => els.length);
  ok('its two terms are selectable', innerCount === 2);
  await page.screenshot({ path: SCRATCH + '/denominator_factor_drill.png' });

  await page.click('.eq-row.current [data-inner-index="0"]');
  await page.click('.eq-row.current [data-inner-index="1"]');
  await page.evaluate(() => {
    var H = window.App.History;
    H.enterFactorWithSelection(); H.chooseFactorMode(3);
    H.setIdentityFieldLatex('x'); H.setIdentityFocus('b'); H.setIdentityFieldLatex('2'); H.confirm();
  });
  await page.waitForTimeout(150);
  const den = await page.evaluate(() => window.App.History.lastEquation().left[0].factorTerms);
  const f = den[0].factors;
  ok('the denominator becomes (x-2)(x+2)√(-x+6)', den.length === 1 && f.length === 3 &&
    JSON.stringify(f[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }]) &&
    JSON.stringify(f[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }]) &&
    !!f[2].terms[0].radicand);
  ok('the numerator is untouched', JSON.stringify(await page.evaluate(() => window.App.History.lastEquation().left[0].innerTerms)) ===
    JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 1, pow: 0 }]));

  // Remonter d'un cran : du facteur au dénominateur entier.
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 0, null, true); H.toggleTermSelection('left', 0, null, true);
    H.clickNestedFactor(0, 1); H.clickNestedFactor(0, 1);
  });
  d = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('can enter another factor', d && d.part === 'den' && d.branch === 1);
  await page.evaluate(() => window.App.History.exitDrill());
  d = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('exit goes back to the whole denominator', d && d.part === 'den' && d.branch === undefined);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
