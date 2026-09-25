const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Glisser un terme/facteur PAR-DESSUS le "=" (voir crossTargetSide/setDragCrossing/
// endTermDrag dans render.js et dragAcross dans history.js) :
// - un terme de premier niveau -> soustrait (ou ajouté, s'il est négatif) des deux membres ;
// - un facteur d'un produit seul dans son membre, ou le coefficient d'un "3x"/"3(x+2)" seul
//   dans son membre -> les deux membres sont divisés par lui.
// Toujours de VRAIS gestes souris (mousedown/mousemove/mouseup), pas des appels directs.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function start(latex) {
    await page.evaluate((l) => {
      var eq = window.App.Parser.parseLatexEquation(l);
      window.App.History.startNewEquation({ left: eq.left, right: eq.right }, eq.operator ? { operator: eq.operator } : undefined);
    }, latex);
    await page.waitForTimeout(150);
  }

  function lastRowSel() {
    return '#history .eq-row.current';
  }

  // Glisse `selector` jusqu'au centre du membre opposé `toSide` de la ligne courante.
  // `inspect` (optionnel) est évalué juste avant le relâcher, curseur au-dessus de la cible.
  async function dragTo(selector, toSide, inspect) {
    const src = await page.$(selector);
    const b = await src.boundingBox();
    const dst = await page.$(lastRowSel() + ' .side[data-side="' + toSide + '"]');
    const d = await dst.boundingBox();
    const sx = b.x + b.width / 2, sy = b.y + b.height / 2;
    const tx = d.x + d.width / 2, ty = d.y + d.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(sx + (tx - sx) * i / 10, sy + (ty - sy) * i / 10);
    }
    const seen = inspect ? await page.evaluate(inspect) : null;
    await page.mouse.up();
    await page.waitForTimeout(150);
    return seen;
  }

  const state = () => page.evaluate(() => {
    var H = window.App.History;
    var steps = H.getSteps();
    var last = steps[steps.length - 1];
    return {
      n: steps.length,
      left: last.equation.left,
      right: last.equation.right,
      ops: last.opLeft && last.opLeft.ops,
      operator: H.getCurrentOperator(),
      error: H.getPending().error
    };
  });
  const T = (c, p) => ({ coeff: c, pow: p });

  // --- 1. Terme positif, gauche -> droite : soustraction des deux côtés ---
  await start('3x+5=11');
  const seen = await dragTo(lastRowSel() + ' .side[data-side="left"] .term[data-index="1"]', 'right', () => ({
    target: !!document.querySelector('.side[data-side="right"].drag-cross-target'),
    badge: !!document.querySelector('.drag-ghost .drag-cross-badge .katex')
  }));
  ok('crossing highlights the target side', seen.target);
  ok('crossing shows the operation badge on the ghost', seen.badge);
  let s = await state();
  ok('new step pushed', s.n === 2);
  ok('op is "-5" on both sides', s.ops && s.ops.length === 1 && s.ops[0].term.coeff === -5 && s.ops[0].term.pow === 0);
  ok('left = 3x+5-5', JSON.stringify(s.left) === JSON.stringify([T(3, 1), T(5, 0), T(-5, 0)]));
  ok('right = 11-5', JSON.stringify(s.right) === JSON.stringify([T(11, 0), T(-5, 0)]));
  ok('no leftover highlight', await page.evaluate(() => !document.querySelector('.drag-cross-target, .drag-ghost')));

  // --- 2. Terme négatif, droite -> gauche : addition des deux côtés ---
  await start('-2x=6-4x');
  await dragTo(lastRowSel() + ' .side[data-side="right"] .term[data-index="1"]', 'left');
  s = await state();
  ok('negative term moved: op is "+4x"', s.n === 2 && s.ops[0].term.coeff === 4 && s.ops[0].term.pow === 1);
  ok('left = -2x+4x', JSON.stringify(s.left) === JSON.stringify([T(-2, 1), T(4, 1)]));
  ok('right = 6-4x+4x', JSON.stringify(s.right) === JSON.stringify([T(6, 0), T(-4, 1), T(4, 1)]));

  // --- 3. Réordonner SANS traverser reste purement visuel (pas de nouvelle étape) ---
  await start('3x+5=11');
  {
    const a = await (await page.$(lastRowSel() + ' .side[data-side="left"] .term[data-index="0"]')).boundingBox();
    const c = await (await page.$(lastRowSel() + ' .side[data-side="left"] .term[data-index="1"]')).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2);
    await page.mouse.move(c.x + c.width - 2, c.y + c.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  s = await state();
  ok('in-side reorder: no new step', s.n === 1);
  ok('in-side reorder: order swapped', JSON.stringify(s.left) === JSON.stringify([T(5, 0), T(3, 1)]));

  // --- 4. Coefficient de "3x" seul dans son membre : division par 3 ---
  await start('3x=12');
  ok('coefficient rendered as its own draggable slot',
    await page.evaluate(() => !!document.querySelector('#history .eq-row.current .side[data-side="left"] .coeff-slot.draggable-term')));
  await dragTo(lastRowSel() + ' .side[data-side="left"] .coeff-slot', 'right');
  s = await state();
  ok('coeff drag: op is "÷3"', s.n === 2 && s.ops[0].symbol === '÷' && s.ops[0].rawValue === 3);
  ok('coeff drag: 3x÷3 gives x, 12÷3 gives 4', JSON.stringify(s.left) === JSON.stringify([T(1, 1)]) &&
    JSON.stringify(s.right) === JSON.stringify([T(4, 0)]));

  // Le "x" de "3x" (hors coefficient) déplace le terme entier : soustraction.
  await start('3x=12');
  {
    const term = await (await page.$(lastRowSel() + ' .side[data-side="left"] .term[data-index="0"]')).boundingBox();
    const coeff = await (await page.$(lastRowSel() + ' .side[data-side="left"] .coeff-slot')).boundingBox();
    const dst = await (await page.$(lastRowSel() + ' .side[data-side="right"]')).boundingBox();
    const sx = (coeff.x + coeff.width + term.x + term.width) / 2, sy = term.y + term.height / 2;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(sx + (dst.x + dst.width / 2 - sx) * i / 10, sy);
    await page.mouse.up();
    await page.waitForTimeout(150);
  }
  s = await state();
  ok('grabbing the "x" moves the whole term: op is "-3x"', s.n === 2 && s.ops[0].term && s.ops[0].term.coeff === -3);

  // Un simple clic sur le coefficient sélectionne toujours le terme entier.
  await start('3x=12');
  await page.click(lastRowSel() + ' .side[data-side="left"] .coeff-slot');
  ok('click on coeff selects the term', await page.evaluate(() => window.App.History.getPending().selectedLeft.indexOf(0) !== -1));

  // Coefficient d'une parenthèse "-2(x+1)" seule dans son membre : division par -2.
  await start('-2(x+1)=8');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .coeff-slot', 'right');
  s = await state();
  ok('factor-group coeff drag: op is "÷-2"', s.n === 2 && s.ops[0].symbol === '÷' && s.ops[0].rawValue === -2);

  // Pas de coefficient détachable quand le membre compte plusieurs termes.
  await start('3x+1=12');
  ok('no coeff slot on a multi-term side', await page.evaluate(() => !document.querySelector('#history .eq-row.current .coeff-slot')));

  // --- 5. Facteur d'un produit seul dans son membre : division par ce facteur ---
  await start('(x+2)(x-1)=5');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .factor-slot[data-drag-id="0"]', 'right');
  s = await state();
  ok('factor drag: op is "÷(x+2)"', s.n === 2 && s.ops[0].symbol === '÷' &&
    JSON.stringify(s.ops[0].terms) === JSON.stringify([T(1, 1), T(2, 0)]));
  ok('factor drag: left simplifies to x-1', JSON.stringify(s.left) === JSON.stringify([T(1, 1), T(-1, 0)]));
  ok('factor drag: right is 5/(x+2)', s.right.length === 1 && s.right[0].isDivision && !!s.right[0].factorTerms);

  // Facteur au carré : division par la puissance entière.
  await start('(x+3)^2(x-1)=4');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .factor-slot[data-drag-id="0"]', 'right');
  s = await state();
  ok('squared factor drag: left becomes x-1', s.n === 2 && JSON.stringify(s.left) === JSON.stringify([T(1, 1), T(-1, 0)]));
  await page.waitForTimeout(300); // flèches/étiquettes dessinées en requestAnimationFrame
  const label = await page.evaluate(() => {
    var a = document.querySelector('.arrow-label annotation');
    return a ? a.textContent.replace(/\\left|\\right|\\,|\s/g, '') : '';
  });
  ok('squared factor drag: label is ÷(x+3)^2, no double parens (got ' + label + ')',
    label.indexOf('\\div(x+3)^{2}') === 0 && label.indexOf('((') === -1);

  // Produit PARMI d'autres termes : le facteur ne divise pas, le produit entier traverse
  // (échappement habituel) et est soustrait.
  await start('(x+2)(x-1)+3=5');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .factor-slot[data-drag-id="0"]', 'right');
  s = await state();
  ok('factor of a product among siblings: whole product subtracted', s.n === 2 && s.ops[0].term && s.ops[0].term.sign === -1 &&
    s.ops[0].term.factors && s.ops[0].term.factors.length === 2);

  // --- 6. Inégalités ---
  await start('-2x>4');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .coeff-slot', 'right');
  s = await state();
  ok('inequality: ÷-2 flips the relation', s.n === 2 && s.operator === '<');

  await start('(x+2)(x-1)>5');
  await dragTo(lastRowSel() + ' .side[data-side="left"] .factor-slot[data-drag-id="0"]', 'right');
  s = await state();
  ok('inequality: dividing by an expression is refused', s.n === 1 && !!s.error);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
