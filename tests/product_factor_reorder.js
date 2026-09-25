const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function dragFactor(page, fromSelector, toX, toY) {
  const from = await page.$(fromSelector);
  const b = await from.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  // Dépasse le seuil de quelques pixels avant que beginTermDrag ne se déclenche.
  await page.mouse.move(b.x + b.width / 2 + 8, b.y + b.height / 2 + 2);
  await page.mouse.move(toX, toY, { steps: 12 });
  await page.waitForTimeout(50);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // --- 1) Glisser un facteur PAST un autre, à l'INTÉRIEUR des bornes du produit : ne
  // réordonne QUE les facteurs entre eux, le produit reste un seul noeud de premier niveau.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+2)(x+5)(x+9)=0');
  await page.waitForTimeout(80);

  const beforeFactors = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.left[0].factors.map((f) => f.terms.map((t) => t.coeff + '/' + t.pow).join(','));
  });
  console.log('ordre facteurs avant glisser interne:', JSON.stringify(beforeFactors));
  ok('starts as one product with 3 factors', beforeFactors.length === 3);

  const f0 = await page.$('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  const f1 = await page.$('.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]');
  const b1 = await f1.boundingBox();
  await dragFactor(page, '.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]', b1.x + b1.width + 5, b1.y + b1.height / 2);

  const midDragText = await page.evaluate(() => document.querySelector('.eq-row.current .side[data-side="left"]').textContent);
  console.log('texte PENDANT le glisser interne:', JSON.stringify(midDragText));
  ok('third factor ("x+9") stays visible during the drag', /9/.test(midDragText));

  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterEq1 = await page.evaluate(() => window.App.History.lastEquation());
  ok('still ONE top-level product (no escalation happened)', afterEq1.left.length === 1 && afterEq1.left[0].factors);
  const afterFactors = afterEq1.left[0].factors.map((f) => f.terms.map((t) => t.coeff + '/' + t.pow).join(','));
  console.log('ordre facteurs apres glisser interne:', JSON.stringify(afterFactors));
  ok('factor order actually changed (factor 0 moved past factor 1)', JSON.stringify(afterFactors) !== JSON.stringify(beforeFactors));
  ok('all 3 factors preserved (none lost/duplicated), just reordered',
    afterFactors.length === 3 && afterFactors.slice().sort().join('|') === beforeFactors.slice().sort().join('|'));

  await page.screenshot({ path: `${SCRATCH}/product_factor_reorder_internal.png` });

  // --- 2) Glisser un facteur en dehors des bornes du produit (loin à droite, au-delà du
  // terme voisin) : bascule sur un glisser de PREMIER NIVEAU du produit ENTIER, qui échange
  // sa place avec ce terme voisin — ex. "(x+7)^2(x+5)+5=0" -> "5+(x+7)^2(x+5)".
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+7)^2(x+5)+5=0');
  await page.waitForTimeout(80);

  const eqBefore2 = await page.evaluate(() => window.App.History.lastEquation());
  ok('starts as [product, +5] at top level', eqBefore2.left.length === 2 &&
    eqBefore2.left[0].factors && eqBefore2.left[1].pow === 0 && eqBefore2.left[1].coeff === 5);

  const sibling = await page.$('.eq-row.current .side[data-side="left"] [data-index="1"]');
  const sb = await sibling.boundingBox();
  // +20 (pas plus) : juste après le "+5" mais AVANT le milieu du "=" — au-delà, le lâcher
  // ferait traverser le produit dans l'autre membre (voir drag_across_equal.js).
  await dragFactor(page, '.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]', sb.x + sb.width + 20, sb.y + sb.height / 2);
  await page.waitForTimeout(50);

  const midEscalateText = await page.evaluate(() => document.querySelector('.eq-row.current .side[data-side="left"]').textContent);
  console.log('texte PENDANT le glisser echappe:', JSON.stringify(midEscalateText));
  ok('the "5" sibling term stays visible during the escalated drag', /5/.test(midEscalateText));

  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterEq2 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres glisser echappe:', JSON.stringify(afterEq2.left));
  ok('escalated: the WHOLE product swapped places with the "+5" sibling (2 top-level nodes, same 2 nodes, different order)',
    afterEq2.left.length === 2 && afterEq2.left[0].pow === 0 && afterEq2.left[0].coeff === 5 && !!afterEq2.left[1].factors);
  ok('the product\'s OWN factor order is untouched by the escalation (still (x+7)^2 then (x+5))',
    afterEq2.left[1].factors.length === 2 &&
    afterEq2.left[1].factors[0].exponent === 2 &&
    JSON.stringify(afterEq2.left[1].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 7, pow: 0 }]) &&
    afterEq2.left[1].factors[1].exponent === 1 &&
    JSON.stringify(afterEq2.left[1].factors[1].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }]));

  await page.screenshot({ path: `${SCRATCH}/product_factor_reorder_escalated.png` });

  // --- 3) Glisser un facteur juste avant l'autre (sans sortir des bornes) : réordonne les
  // facteurs, le terme voisin de premier niveau ("+5") n'est lui jamais touché.
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '(x+7)^2(x+5)+5=0');
  await page.waitForTimeout(80);

  const g0 = await page.$('.eq-row.current .side[data-side="left"] [id$="-0-factor-0"]');
  const gb0 = await g0.boundingBox();
  // Juste À L'INTÉRIEUR du premier facteur (avant son milieu, voir computeTargetOrder), pas
  // au-delà de sa bordure GAUCHE — qui coïncide avec celle du produit lui-même puisque
  // c'est le tout premier facteur : sortir par là échapperait à tort le glisser au lieu de
  // simplement réordonner les facteurs entre eux.
  await dragFactor(page, '.eq-row.current .side[data-side="left"] [id$="-0-factor-1"]', gb0.x + 2, gb0.y + gb0.height / 2);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterEq3 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres glisser interne (2):', JSON.stringify(afterEq3.left));
  ok('no escalation: still [product, +5] at top level, in that order', afterEq3.left.length === 2 &&
    !!afterEq3.left[0].factors && afterEq3.left[1].pow === 0 && afterEq3.left[1].coeff === 5);
  ok('"(x+5)" now comes FIRST inside the product', afterEq3.left[0].factors.length === 2 &&
    afterEq3.left[0].factors[0].exponent === 1 &&
    JSON.stringify(afterEq3.left[0].factors[0].terms) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 5, pow: 0 }]) &&
    afterEq3.left[0].factors[1].exponent === 2);

  await page.screenshot({ path: `${SCRATCH}/product_factor_reorder_internal2.png` });

  // --- 4) Bug fix : le fantôme du produit ENTIER (après bascule d'échappement, voir
  // escalateFactorDragToTopLevel) ne doit JAMAIS retourner à la ligne (voir .drag-ghost dans
  // style.css, qui manquait "white-space:nowrap" — KaTeX ne le force pas lui-même sur
  // l'ensemble de son rendu, voir le commentaire de .eq-line). Reproduit tel quel le rapport
  // : "7+(x-8)^2(x+5)=121(x+5)", glisser "(x-8)" vers la gauche par-dessus le "7".
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '7+(x-8)^2(x+5)=121(x+5)');
  await page.waitForTimeout(80);

  const refLine = await page.$('.eq-row.current .eq-line');
  const refHeight = (await refLine.boundingBox()).height;

  const seven = await page.$('.eq-row.current .side[data-side="left"] [data-index="0"]');
  const sevenBox = await seven.boundingBox();
  await dragFactor(page, '.eq-row.current .side[data-side="left"] [id$="-1-factor-0"]', sevenBox.x + sevenBox.width / 2, sevenBox.y + sevenBox.height / 2);
  await page.waitForTimeout(50);

  const ghostBox = await page.evaluate(() => {
    var g = document.querySelector('.drag-ghost');
    if (!g) return null;
    var r = g.getBoundingClientRect();
    return { width: r.width, height: r.height, whiteSpace: getComputedStyle(g).whiteSpace };
  });
  console.log('fantome pendant le glisser echappe (rapport de bug):', JSON.stringify(ghostBox), 'refHeight:', refHeight);
  ok('drag ghost has white-space:nowrap set', ghostBox && ghostBox.whiteSpace === 'nowrap');
  ok('drag ghost stays single-line tall (not ~2x from wrapping)', ghostBox && ghostBox.height < refHeight * 1.5);

  await page.mouse.up();
  await page.waitForTimeout(150);
  const afterEq4 = await page.evaluate(() => window.App.History.lastEquation());
  console.log('equation apres glisser echappe (rapport de bug):', JSON.stringify(afterEq4.left));
  ok('escalated correctly: whole product now comes before "7"', afterEq4.left.length === 2 &&
    !!afterEq4.left[0].factors && afterEq4.left[1].pow === 0 && afterEq4.left[1].coeff === 7);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
