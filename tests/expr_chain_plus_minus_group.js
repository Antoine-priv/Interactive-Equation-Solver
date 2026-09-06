const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Opération" : un "+"/"-" suivi d'un groupe entre parenthèses (avec coefficient et/ou
// exposant, ex. "+3-5(8x-2)") ajoute ce groupe TEL QUEL comme nouveau terme du membre —
// jamais distribué/combiné avec l'existant, contrairement à "×" qui multiplie tout le
// membre (voir classifyPlusMinusOperand dans history.js).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function applyChain(eq, latex) {
    await page.evaluate(({ eq, latex }) => {
      window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(latex);
      window.App.History.confirm();
    }, { eq: eq, latex: latex });
  }

  // --- 1) L'exemple exact demandé : "+3-5(8x-2)" ---
  await applyChain('x=0', '+3-5(8x-2)');
  let step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres +3-5(8x-2):', JSON.stringify(step.equation));
  ok('adds "+3" then "-5(8x-2)" as two separate terms (not distributed)',
    JSON.stringify(step.equation.left) === JSON.stringify([
      { coeff: 1, pow: 1 },
      { coeff: 3, pow: 0 },
      { sign: -1, factor: { coeff: 5, pow: 0 }, innerTerms: [{ coeff: 8, pow: 1 }, { coeff: -2, pow: 0 }] }
    ]));
  const latexSource = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.current .side[data-side="left"] .katex-mathml annotation');
    return el ? el.textContent : null;
  });
  const normalized = (latexSource || '').replace(/\\htmlId\{[^}]*\}/g, '').replace(/\\htmlData\{[^}]*\}/g, '')
    .replace(/\\left|\\right/g, '').replace(/[{}]/g, '').replace(/\s+/g, '');
  console.log('rendu normalise:', JSON.stringify(normalized));
  ok('renders as "x+3-5(8x-2)"', normalized === 'x+3-5(8x-2)');

  // --- 2) Un groupe au carré ("+2(x+3)^2") fonctionne aussi : le parseur (App.Parser.
  // parseSide, partagé avec "×") lit "2(x+3)^2" comme un ProductGroup a 2 facteurs
  // ("2" exposant 1, "(x+3)" exposant 2) plutot qu'un FactorGroup{factor,innerTerms} -
  // c'est le meme comportement deja utilise par "×" pour ce genre d'expression, pas
  // quelque chose d'introduit ici ; addTermToSide (via cloneNode) l'ajoute tel quel. ---
  await applyChain('x=0', '+2(x+3)^2');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres +2(x+3)^2:', JSON.stringify(step.equation));
  const squaredTerm = step.equation.left[1];
  ok('adds a squared group term correctly', squaredTerm && squaredTerm.factors &&
    squaredTerm.factors.length === 2 && squaredTerm.factors[0].exponent === 1 &&
    JSON.stringify(squaredTerm.factors[0].terms) === JSON.stringify([{ coeff: 2, pow: 0 }]) &&
    squaredTerm.factors[1].exponent === 2 &&
    JSON.stringify(squaredTerm.factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));

  // --- 3) Signe embarque ("+-5(8x-2)" -> equivaut a "-5(8x-2)") ---
  await applyChain('x=0', '+-5(8x-2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  const embeddedTerm = step.equation.left[1];
  console.log('equation apres +-5(8x-2):', JSON.stringify(step.equation));
  ok('embedded "-" sign combines correctly with the "+" operator', embeddedTerm && embeddedTerm.sign === -1 && embeddedTerm.factor.coeff === 5);

  // --- 4) Regression : "×5(8x-2)" (deja existant) continue de MULTIPLIER tout le membre,
  // comportement totalement different de "+5(8x-2)"/"-5(8x-2)" ---
  await applyChain('x=3', '\\times5(8x-2)');
  step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres ×5(8x-2) (regression):', JSON.stringify(step.equation));
  ok('"×" still multiplies the whole member (unchanged regression)',
    step.equation.left[0].factors && step.equation.left[0].factors.length === 2);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
