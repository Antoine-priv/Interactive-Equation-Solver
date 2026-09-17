const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Touche "(‥)²" du pavé "Opération", à droite de "√" (voir KEY_ROWS dans mathKeypad.js) :
// élève les DEUX membres au carré en une seule étape (armée puis validée, comme "√" —
// voir confirmSquareBothSides dans history.js), l'inverse de "√" — pour résoudre une
// équation qui contient déjà une racine carrée sans jamais toucher aux touches "x²"/"xⁿ"
// (qui restent, elles, de simples touches de SAISIE d'exposant, inchangées). N'est
// disponible que quand les DEUX membres sont prouvablement non négatifs (voir
// Expr.sideIsNonNegative/canSquareBothSides) : sinon élever au carré ne préserverait pas
// l'équivalence (juste une implication, risque de solution parasite).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);

  // --- 1) "\sqrt{x-7}=4" (saisie manuelle, round-trip désormais supporté — voir
  // parseWholeSqrtSide dans parser.js) : "(‥)²" résout l'équation en un clic. ---
  await page.evaluate(() => {
    window.App.History.startNewEquation(window.App.Parser.parseLatexEquation('\\sqrt{x-7}=4'));
  });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(150);

  const disabledBeforeArm = await page.evaluate(() => document.querySelector('[data-key="square"]').disabled);
  ok('"(‥)²" key is enabled (√ on one side, positive constant on the other: equivalence-preserving)', !disabledBeforeArm);

  // --- Preview étiquette (aperçu, AVANT même de confirmer) : armer doit déjà montrer
  // l'équation élevée au carré, avec son étiquette "(‥)²" sur les flèches — pas une ligne
  // muette (bug rapporté), même principe que "√" (previewSquareRoot). ---
  await page.click('[data-key="square"]');
  await page.waitForTimeout(150);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking "(‥)²" only arms it (no equation CONFIRMED yet)', pending.squareArmed === true);
  ok('equation itself untouched while just armed (only the PREVIEW row changes)',
    JSON.stringify(await page.evaluate(() => window.App.History.lastEquation())) ===
    JSON.stringify({ left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -7, pow: 0 }] }], right: [{ coeff: 4, pow: 0 }] }));
  const previewRowEq = await page.evaluate(() => {
    var row = document.querySelector('.eq-row.pending');
    return row ? row.textContent : null;
  });
  ok('a pending preview row is shown while armed', previewRowEq !== null);
  const previewLabelSources = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.arrow-label annotation')).map((el) => el.textContent));
  ok('the preview arrows already read "(‥)²" while just armed (not confirmed yet)',
    previewLabelSources.length === 2 && previewLabelSources.every((l) => l === '\\left(\\phantom{x}\\right)^2'));

  const sqrtDisabledWhileArmed = await page.evaluate(() => document.querySelector('[data-key="sqrt"]').disabled);
  ok('"√" is disabled while "(‥)²" is armed (mutually exclusive, like +/-/×/÷)', sqrtDisabledWhileArmed);

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
  ok('confirmed arrow label also reads "(‥)²", not the sqrt symbol', labelSources.length === 2 &&
    labelSources.every((l) => l === '\\left(\\phantom{x}\\right)^2'));

  await page.screenshot({ path: `${SCRATCH}/square_both_sides.png` });

  // --- 2) Equivalence guard: squaring must stay DISABLED whenever a side isn't
  // provably non-negative — a variable expression ("x+3"), or an explicitly negative
  // constant ("-4") — since it would then only be an implication (extraneous roots). ---
  const signCases = await page.evaluate(() => {
    var Expr = window.App.Expr, Parser = window.App.Parser, Hist = window.App.History;
    function canSquare(eqLatex) {
      Hist.startNewEquation(Parser.parseLatexEquation(eqLatex));
      return Hist.canSquareBothSides();
    }
    return {
      variableSide: canSquare('x+3=5'),                 // left: unknown sign -> false
      negativeConstant: canSquare('\\sqrt{x-7}=-4'),     // right: -4 < 0 -> false
      negatedSqrt: canSquare('-\\sqrt{x-7}=4'),          // left: "-√(...)" (sign -1) -> false
      bothPositiveSqrtAndConstant: canSquare('\\sqrt{x-7}=4'), // baseline -> true
      bothBareConstants: canSquare('4=9')                // two non-negative constants -> true
    };
  });
  console.log('canSquareBothSides per shape:', JSON.stringify(signCases));
  ok('disabled: a variable side ("x+3=5", sign unknown)', signCases.variableSide === false);
  ok('disabled: a negative constant side ("\\sqrt{x-7}=-4")', signCases.negativeConstant === false);
  ok('disabled: a negated √ side ("-\\sqrt{x-7}=4", sign -1, not provably ≥0)', signCases.negatedSqrt === false);
  ok('enabled: √(...) on one side, a positive constant on the other', signCases.bothPositiveSqrtAndConstant === true);
  ok('enabled: two bare non-negative constants', signCases.bothBareConstants === true);

  // The button itself must reflect this: start fresh on a non-equivalence-preserving
  // equation and check the real UI key is disabled (not just the underlying API).
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+3=5')); });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(100);
  const squareDisabledInUi = await page.evaluate(() => document.querySelector('[data-key="square"]').disabled);
  ok('the "(‥)²" key itself is disabled in the real UI for "x+3=5"', squareDisabledInUi);

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

  // --- 4) Layout: "↵" occupies a SINGLE grid cell (never span:2) so it doesn't stick out
  // past the other 3 rows' real content (each row has exactly 7 real keys, no filler). ---
  const enterSpan = await page.evaluate(() => document.querySelector('[data-key="enter"]').style.gridColumn);
  ok('"↵" no longer spans 2 columns', enterSpan === '');
  const totalKeyCount = await page.evaluate(() => document.querySelector('.math-keypad-keys').children.length);
  ok('4 rows of exactly 7 real keys each, no filler cells', totalKeyCount === 28);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
