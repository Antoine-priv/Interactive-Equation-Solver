const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Identités remarquables au-delà du degré 2 : "a" peut être une puissance de x
// (x⁴-25 = (x²-5)(x²+5), a = x²).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function factorWithIdentity(eq, indices, mode, a, b) {
    await page.evaluate((e) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(e)); }, eq);
    for (const i of indices) {
      await page.click('.eq-row.current .side[data-side="left"] [data-index="' + i + '"]');
    }
    await page.click('button[data-op="factor"]');
    await page.click('.factor-choice-btn[data-factor-choice="' + mode + '"]');
    const pending = await page.evaluate(() => window.App.History.getPending());
    if (pending.factorMode !== mode) return { pending: pending };
    await page.evaluate((v) => { window.App.History.setIdentityFieldLatex(v); }, a);
    await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
    await page.waitForFunction(() => window.App.History.getPending().idFocus === 'b');
    await page.evaluate((v) => { window.App.History.setIdentityFieldLatex(v); }, b);
    await page.click('[data-key="enter"]');
    await page.waitForTimeout(150);
    return {
      pending: await page.evaluate(() => window.App.History.getPending()),
      step: await page.evaluate(() => window.App.History.getSteps().slice(-1)[0])
    };
  }

  // --- a²-b² : x⁴-25 avec a = x², b = 5 ---
  let r = await factorWithIdentity('x^4-25=0', [0, 1], 3, 'x^2', '5');
  let g = r.step && r.step.equation.left[0];
  ok('x^4-25 -> (x^2-5)(x^2+5)', g && g.factors && g.factors.length === 2 &&
    JSON.stringify(g.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: -5, pow: 0 }]) &&
    JSON.stringify(g.factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: 5, pow: 0 }]));
  ok('step desc keeps xPow for the arrow label', r.step && r.step.opLeft && r.step.opLeft.xPow === 2);
  await page.screenshot({ path: SCRATCH + '/factor_identity_higher_degree.png' });

  // --- (a+b)² : x⁴+6x²+9 avec a = x², b = 3 ---
  r = await factorWithIdentity('x^4+6x^2+9=0', [0, 1, 2], 1, 'x^2', '3');
  g = r.step && r.step.equation.left[0];
  ok('x^4+6x^2+9 -> (x^2+3)^2', g && g.factors && g.factors.length === 1 && g.factors[0].exponent === 2 &&
    JSON.stringify(g.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: 3, pow: 0 }]));

  // --- Degré impair : x³-8 ne peut pas être un a²-b² ---
  r = await factorWithIdentity('x^3-8=0', [0, 1], 3, 'x', '2');
  ok('x^3-8 rejected for a^2-b^2', r.pending.factorMode !== 3 && !!r.pending.error);

  // --- Cas degré 2 inchangé : x²-16 avec a = x, b = 4 ---
  r = await factorWithIdentity('x^2-16=0', [0, 1], 3, 'x', '4');
  g = r.step && r.step.equation.left[0];
  ok('x^2-16 still -> (x-4)(x+4)', g && g.factors && g.factors.length === 2 &&
    JSON.stringify(g.factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -4, pow: 0 }]));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
