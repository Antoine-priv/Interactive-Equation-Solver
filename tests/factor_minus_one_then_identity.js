const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Niveau g5 de la campagne (docs/gamification/plan.md) : "-49-x²+14x=0" se résout en
// factorisant par -1, puis en appliquant (a-b)² DANS la parenthèse obtenue.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const left = '.eq-row.current .side[data-side="left"]';
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '-49-x^2+14x=0');

  // --- 1. Facteur commun -1 ---
  for (const i of [0, 1, 2]) await page.click(left + ' [data-index="' + i + '"]');
  await page.click('button[data-op="factor"]');
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.evaluate(() => { window.App.History.setFactorTermLatex('-1'); });
  await page.click('.op-confirm-btn');
  await page.waitForTimeout(150);
  let eq = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation);
  const g = eq.left.length === 1 ? eq.left[0] : null;
  const inner = g && g.innerTerms;
  const innerIsTrinomial = inner && inner.length === 3 &&
    inner.some((t) => t.pow === 2 && t.coeff === 1) &&
    inner.some((t) => t.pow === 1 && t.coeff === -14) &&
    inner.some((t) => t.pow === 0 && t.coeff === 49);
  ok('factor by -1 gives -(x²-14x+49) (in any order)', !!innerIsTrinomial &&
    ((g.factor && g.factor.coeff === -1) || (g.sign === -1 && (!g.factor || g.factor.coeff === 1))));

  // --- 2. Entrer dans la parenthèse, identité (a-b)² avec a=x, b=7 ---
  await page.waitForTimeout(400);
  await page.dblclick(left + ' [data-index="0"]');
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('double-click drills into the group', !!pending.drilled);
  for (const i of [0, 1, 2]) await page.click(left + ' [data-inner-index="' + i + '"]');
  await page.click('button[data-op="factor"]');
  await page.click('.factor-choice-btn[data-factor-choice="2"]');
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('identity (a-b)² accepted on the inner trinomial', pending.factorMode === 2);
  await page.evaluate(() => { window.App.History.setIdentityFieldLatex('x'); });
  await page.evaluate(() => { window.App.History.setIdentityFocus('b'); });
  await page.waitForFunction(() => window.App.History.getPending().idFocus === 'b');
  await page.evaluate(() => { window.App.History.setIdentityFieldLatex('7'); });
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  pending = await page.evaluate(() => window.App.History.getPending());
  if (pending.error) console.log('erreur :', pending.error);
  eq = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation);
  const flat = JSON.stringify(eq.left);
  ok('result contains (x-7)²', flat.indexOf('"exponent":2') !== -1 &&
    flat.indexOf('{"coeff":1,"pow":1},{"coeff":-7,"pow":0}') !== -1);
  ok('written -(x-7)², no parentheses inside the parentheses', flat ===
    '[{"sign":-1,"factors":[{"terms":[{"coeff":1,"pow":1},{"coeff":-7,"pow":0}],"exponent":2}]}]');
  // --- 3. Produit nul directement sur -((x-7)²) ---
  await page.evaluate(() => { var p = window.App.History.getPending(); if (p.drilled) window.App.History.cancelOp(); });
  await page.click(left + ' [data-index="0"]');
  const enabled = await page.evaluate(() => Array.from(document.querySelectorAll('#opButtons button[data-op]'))
    .filter((b) => !b.disabled && b.offsetParent !== null).map((b) => b.getAttribute('data-op')));
  ok('Produit nul available on -(x-7)²', enabled.indexOf('produitnul') !== -1);
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(200);
  const branches = await page.evaluate(() => {
    var b = window.App.History.getBranches ? window.App.History.getBranches() : null;
    return b ? b.map(function (e) { return e.lastEquation(); }) : null;
  });
  ok('Produit nul directly gives x-7=0 (one branch)', branches && branches.length === 1 &&
    JSON.stringify(branches[0].left) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: -7, pow: 0 }]));
  await page.screenshot({ path: SCRATCH + '/factor_minus_one_then_identity.png' });

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
