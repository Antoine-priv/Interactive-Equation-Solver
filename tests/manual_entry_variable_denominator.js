const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté : impossible de saisir directement (modale "Nouvelle équation") une
// fraction dont le dénominateur contient x (ex. "5/(x+3)") — parser.js exigeait
// jusqu'ici un dénominateur toujours numérique pour "\frac{...}{...}" (voir
// GENERAL_FRAC_DEN_RE, désormais retiré). Ce test couvre le nouveau chemin
// (dénominateur QUELCONQUE -> FactorGroup.factorTerms, jamais replié en coefficient) ET
// vérifie que les 2 chemins existants (numérateur général + dénominateur numérique ;
// numérateur/dénominateur simples -> coefficient décimal replié) restent inchangés.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function parse(eq) {
    return page.evaluate((e) => {
      try { return { ok: true, eq: window.App.Parser.parseEquation(e) }; }
      catch (err) { return { ok: false, error: err.message }; }
    }, eq);
  }

  // --- Nouveau : dénominateur contenant x ---
  let r = await parse('\\frac{5}{x+3}=2');
  ok('"\\frac{5}{x+3}=2" parses to a FactorGroup with factorTerms (never folded)',
    r.ok && JSON.stringify(r.eq) === JSON.stringify({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    }));

  r = await parse('\\frac{7x-3}{x+5}=0');
  ok('a GENERAL numerator with a variable denominator works too ("\\frac{7x-3}{x+5}=0")',
    r.ok && JSON.stringify(r.eq.left[0]) === JSON.stringify({
      sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }], innerTerms: [{ coeff: 7, pow: 1 }, { coeff: -3, pow: 0 }], isDivision: true
    }));

  r = await parse('\\frac{5}{x-5+5}=2'); // denominator content that is NOT trivially "0" textually but IS zero-valued after folding constants: x-5+5 -> just "x" (not zero) -- sanity: should NOT throw
  ok('a denominator that folds to a non-zero variable expression does not throw', r.ok);

  // --- Régression : les 2 chemins numériques existants restent inchangés ---
  r = await parse('\\frac{1}{2}x+3=58-6x');
  ok('regression: "\\frac{1}{2}x" still folds to a 0.5 coefficient (never a displayed fraction)',
    r.ok && JSON.stringify(r.eq.left[0]) === JSON.stringify({ coeff: 0.5, pow: 1 }));

  r = await parse('\\frac{7x-3}{5}=0');
  ok('regression: general numerator + NUMERIC denominator still uses `factor` (not factorTerms)',
    r.ok && JSON.stringify(r.eq.left[0]) === JSON.stringify({
      sign: 1, factor: { coeff: 5, pow: 0 }, innerTerms: [{ coeff: 7, pow: 1 }, { coeff: -3, pow: 0 }], isDivision: true
    }));

  r = await parse('\\frac{5}{0}=2');
  ok('division by a literal zero denominator still throws', !r.ok && /zéro/.test(r.error));

  // --- End-to-end via la vraie modale "Nouvelle équation" (saisie MathLive réelle) ---
  await page.click('#newEquationBtn');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.App.MathKeypad.setLatex('\\frac{5}{x+3}=2'));
  await page.waitForTimeout(80);
  await page.click('.math-keypad-keys .panel-confirm-cell');
  await page.waitForTimeout(200);
  const errText = await page.$eval('#manualError', (el) => el.textContent);
  const modalOpen = await page.evaluate(() => !document.getElementById('modalOverlay').hidden);
  const finalEq = await page.evaluate(() => window.App.History.lastEquation());
  ok('the real "Nouvelle équation" modal accepts a variable denominator (no error, modal closes)',
    errText === '' && !modalOpen);
  ok('the resulting equation matches (via the real MathLive round-trip)',
    JSON.stringify(finalEq) === JSON.stringify({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
