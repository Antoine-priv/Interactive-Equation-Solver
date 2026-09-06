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

  async function applyChain(eq, latex) {
    await page.evaluate(({ eq, latex }) => {
      window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
      window.App.History.selectOp('expr');
      window.App.History.setExprChainText(latex);
      window.App.History.confirm();
    }, { eq: eq, latex: latex });
  }

  await page.goto(FILE);
  await applyChain('(x+2)(x-2)=0', '\\times x');

  const step = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres (x+2)(x-2) x x:', JSON.stringify(step.equation));

  // Structure attendue : PAS de ProductGroup imbrique dans .left (juste le meme
  // ProductGroup d'origine, avec .right = [x]) -- au niveau DONNEES, ca reste imbrique
  // (c'est le RENDU qui doit eviter les doubles parentheses), donc on verifie plutot le
  // KaTeX/texte affiche.
  const latexSource = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.current .side[data-side="left"] .katex-mathml annotation');
    return el ? el.textContent : null;
  });
  console.log('source LaTeX du membre gauche:', JSON.stringify(latexSource));
  ok('no double parens: does NOT contain "))(" pattern (nested outer wrap)', !/\)\)\(/.test(latexSource || ''));
  const normalized = (latexSource || '')
    .replace(/\\htmlId\{[^}]*\}/g, '').replace(/\\htmlData\{[^}]*\}/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '');
  console.log('normalise (sans htmlId/left/right/accolades/espaces):', JSON.stringify(normalized));
  ok('renders as (x+2)(x-2)x form (three factors, no extra wrap)', normalized === '(x+2)(x-2)x');

  await page.screenshot({ path: `${SCRATCH}/no_double_parens.png` });

  // Cas limite : multiplier un membre deja factorise par un "x" NEGATIF ("-x", bare, donc
  // via wrapSideInProduct/groupSlotLatex - contrairement a un nombre negatif "-3" qui suit
  // un tout autre chemin (wrapSideInFactor/scaleNode, distribue dans un facteur existant,
  // voir plus haut). Le signe "-" colle a la parenthese fermante precedente serait lu comme
  // une SOUSTRACTION -> l'enveloppe \left(...\right) doit etre CONSERVEE dans ce cas.
  await applyChain('(x+2)(x-2)=0', '\\times-x');

  const step2 = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0]);
  console.log('equation apres (x+2)(x-2) x -x:', JSON.stringify(step2.equation));

  const latexSource2 = await page.evaluate(() => {
    var el = document.querySelector('.eq-row.current .side[data-side="left"] .katex-mathml annotation');
    return el ? el.textContent : null;
  });
  console.log('source LaTeX du membre gauche (x -x):', JSON.stringify(latexSource2));
  const normalized2 = (latexSource2 || '')
    .replace(/\\htmlId\{[^}]*\}/g, '').replace(/\\htmlData\{[^}]*\}/g, '')
    .replace(/\\left|\\right/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, '');
  console.log('normalise (x -x):', JSON.stringify(normalized2));
  ok('negative multiplier keeps wrapping parens: (x+2)(x-2)(-x)', normalized2 === '(x+2)(x-2)(-x)');
  ok('negative multiplier: no "-" glued directly after ")" (would read as subtraction)', !/\)-[^(]/.test(normalized2));

  await page.screenshot({ path: `${SCRATCH}/no_double_parens_negative.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
