const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Ligne "S=..." finale (voir App.Ineq.solutionRanges/rangesLatex et createSolutionSetEl
// dans render.js) : sous la chaîne principale une fois arrivée au bout — une solution,
// aucune ("3=5"), une infinité ("0=0"), équation comme inéquation — et sous les colonnes
// "Produit nul" (réunion, y compris une colonne sans solution), restreinte au domaine de
// définition quand il y en a un.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function start(latex) {
    await page.evaluate((l) => {
      var eq = window.App.Parser.parseLatexEquation(l);
      window.App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
    }, latex);
    await page.waitForTimeout(120);
  }
  // LaTeX brut du "S=..." final (annotation KaTeX), ou null s'il n'est pas affiché.
  const setLatex = () => page.evaluate(() => {
    var els = document.querySelectorAll('#history .final-solution-set');
    if (els.length !== 1) return els.length ? 'DUPLICATE' : null;
    var a = els[0].querySelector('annotation');
    return a ? a.textContent : null;
  });

  const cases = [
    ['x=2', 'S=\\left\\{2\\right\\}'],
    ['-3=x', 'S=\\left\\{-3\\right\\}'],
    ['3=5', 'S=\\emptyset'],
    ['0=0', 'S=\\mathbb{R}'],
    ['x<3', 'S=\\left]-\\infty;3\\right['],
    ['3\\leq x', 'S=\\left[3;+\\infty\\right['],
    ['0<5', 'S=\\mathbb{R}'],
    ['0\\geq 5', 'S=\\emptyset']
  ];
  for (const [input, expected] of cases) {
    await start(input);
    const got = await setLatex();
    ok('"' + input + '" shows ' + expected + ' (got ' + got + ')', got === expected);
  }

  await start('3=5');
  ok('"3=5" is framed as finished (no action window)',
    await page.evaluate(() => !!document.querySelector('#history .eq-row.solved')));

  // Pas encore au bout : aucune ligne "S=".
  await start('2x+1=5');
  ok('no S line while unsolved', (await setLatex()) === null);

  // Parcours réel : glisser le coefficient de "3x" de l'autre côté du "=" -> "x=4".
  await start('3x=12');
  {
    const b = await (await page.$('#history .eq-row.current .side[data-side="left"] .coeff-slot')).boundingBox();
    const d = await (await page.$('#history .eq-row.current .side[data-side="right"]')).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + (d.x + d.width / 2 - b.x) * i / 10, b.y + b.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  ok('after solving 3x=12 by drag: S={4}', (await setLatex()) === 'S=\\left\\{4\\right\\}');

  // Inéquation : "-2x<6", ÷(-2) inverse le sens -> "x>-3".
  await start('-2x<6');
  await page.evaluate(() => window.App.History.dragAcross('left', { kind: 'coeff', index: 0 }));
  await page.waitForTimeout(120);
  ok('-2x<6 solved: S=]-3;+∞[', (await setLatex()) === 'S=\\left]-3;+\\infty\\right[');

  // Produit nul : S n'apparaît qu'une fois TOUTES les colonnes au bout.
  await start('(x+2)(x-3)=0');
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(150);
  async function solveBranch(idx) {
    await page.evaluate((i) => {
      var H = window.App.History;
      H.focusBranch(i);
      H.dragAcross('left', { kind: 'term', index: 1 });
      H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
      H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
    }, idx);
    await page.waitForTimeout(150);
  }
  await solveBranch(0);
  ok('produit nul: no S while one column is unsolved', (await setLatex()) === null);
  await solveBranch(1);
  ok('produit nul: S={-2;3}', (await setLatex()) === 'S=\\left\\{-2\\,;\\,3\\right\\}');

  // Domaine de définition : S est restreint à Df (ici la chaîne principale est forcée sur
  // "x=-3", justement la valeur interdite par le dénominateur x+3).
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);
  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);
  // Force la chaîne principale sur "x=-3" (la valeur interdite) sans passer par l'UI.
  await page.evaluate(() => {
    var leaf = window.App.History.getLeaf();
    leaf.pushStep({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: -3, pow: 0 }] }, null);
  });
  await page.waitForTimeout(120);
  ok('domain unresolved: S waits', (await setLatex()) === null);
  await page.evaluate(() => {
    var cond = window.App.History.getDomainConditions()[0].engine;
    cond.dragAcross('left', { kind: 'term', index: 1 });
  });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    var cond = window.App.History.getDomainConditions()[0].engine;
    cond.toggleTermSelection('left', 1); cond.toggleTermSelection('left', 2); cond.confirmSimplifySelection();
    cond.toggleTermSelection('right', 0); cond.toggleTermSelection('right', 1); cond.confirmSimplifySelection();
  });
  await page.waitForTimeout(120);
  ok('forbidden value excluded: S=∅', (await setLatex()) === 'S=\\emptyset');

  ok('no page errors (' + errs.join(' | ') + ')', errs.length === 0);
  await browser.close();
})();
