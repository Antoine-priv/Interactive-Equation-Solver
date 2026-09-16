const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Touche "(⋯)²" du pavé "Opération", à droite de "√" (voir KEY_ROWS dans mathKeypad.js) :
// élève les DEUX membres au carré en une seule étape (armée puis validée, comme "√" —
// voir confirmSquareBothSides dans history.js), l'inverse de "√" — pour résoudre une
// équation qui contient déjà une racine carrée sans jamais toucher aux touches "x²"/"xⁿ"
// (qui restent, elles, de simples touches de SAISIE d'exposant, inchangées).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);

  // --- 1) "\sqrt{x-7}=4" (saisie manuelle, round-trip désormais supporté — voir
  // parseWholeSqrtSide dans parser.js) : "(⋯)²" résout l'équation en un clic. ---
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseLatexEquation('\\sqrt{x-7}=4'));
  });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(150);

  const disabledBeforeArm = await page.evaluate(() => document.querySelector('[data-key="square"]').disabled);
  ok('"(⋯)²" key is enabled (no prior selection needed, unlike "√")', !disabledBeforeArm);

  await page.click('[data-key="square"]');
  await page.waitForTimeout(100);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking "(⋯)²" only arms it (no equation change yet)', pending.squareArmed === true);
  ok('equation itself untouched while just armed',
    JSON.stringify(await page.evaluate(() => window.App.History.lastEquation())) ===
    JSON.stringify({ left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -7, pow: 0 }] }], right: [{ coeff: 4, pow: 0 }] }));

  const sqrtDisabledWhileArmed = await page.evaluate(() => document.querySelector('[data-key="sqrt"]').disabled);
  ok('"√" is disabled while "(⋯)²" is armed (mutually exclusive, like +/-/×/÷)', sqrtDisabledWhileArmed);

  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const solved = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation after squaring both sides of \\sqrt{x-7}=4:', JSON.stringify(solved));
  ok('squaring cancels the √ directly: "x-7=16" in ONE step, no ± split',
    JSON.stringify(solved) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: -7, pow: 0 }], right: [{ coeff: 16, pow: 0 }] }));
  ok('no branches were created (deterministic, unlike "√"\'s own step 2)',
    (await page.evaluate(() => window.App.History.getBranches())) === null);

  const labelSources = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label annotation')).map((el) => el.textContent));
  ok('arrow label reads "(⋯)²", not the sqrt symbol', labelSources.length === 2 &&
    labelSources.every((l) => l === '\\left(\\phantom{x}\\right)^2'));

  await page.screenshot({ path: `${SCRATCH}/square_both_sides.png` });

  // --- 2) A generic equation (no sqrt involved) still squares validly, wrapping as
  // "(expr)²" rather than folding — a legitimate, always-available operation. ---
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+3=5')); });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(100);
  await page.click('[data-key="square"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const genericEq = await page.evaluate(() => window.App.History.lastEquation());
  ok('"x+3=5" squared: left becomes (x+3)^2 (ProductGroup), right folds to 25',
    JSON.stringify(genericEq) === JSON.stringify({
      left: [{ sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 2 }] }],
      right: [{ coeff: 25, pow: 0 }]
    }));

  // --- 3) "x²"/"xⁿ" keys are untouched: still plain exponent-insertion keys while typing
  // an Opération operand, never a "square both sides" action. "x+2=5" (not "x=5": an
  // already-solved equation hides the Opération panel entirely, see hidePanel/
  // scrollTargetSolved in render.js — unrelated to this feature). ---
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+2=5')); });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(100);
  await page.click('[data-key="times"]');
  await page.click('[data-key="x"]');
  await page.click('[data-key="sq"]');
  await page.waitForTimeout(80);
  ok('"x²" key still just inserts "^2" into the typed operand (unchanged)',
    (await page.evaluate(() => window.App.MathKeypad.getLatex())) === '\\times x^2');
  await page.click('[data-key="backspace"]');
  await page.click('[data-key="backspace"]');
  await page.click('[data-key="pow"]');
  await page.waitForTimeout(80);
  const latexAfterPow = await page.evaluate(() => window.App.MathKeypad.getLatex());
  ok('"xⁿ" key still just inserts "^{}" into the typed operand (unchanged)',
    latexAfterPow.indexOf('^{') !== -1);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
