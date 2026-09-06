const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function makeFactoredEquation(page) {
  // Depart : "2x+6=10" -> factoriser 2x et +6 par 2 -> "2(x+3)=10" (un FactorGroup).
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '2x+6=10');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.click('[data-key="2"]');
  await page.click('.op-confirm-btn');
  await page.waitForSelector('.eq-row.current .side[data-side="left"] [data-index="0"]');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await makeFactoredEquation(page);

  const groupSel = '.eq-row.current .side[data-side="left"] [data-index="0"]';
  const siblingSel = '.eq-row.current .side[data-side="left"] [data-index="1"]';
  // Pas de data-index sur les termes du membre droit tant qu'on est "entre" dans un
  // groupe (rendu/cable saute entierement pour ce membre, voir renderSide) : on clique
  // donc sur le conteneur du membre lui-meme plutot qu'un terme precis.
  const rightTermSel = '.eq-row.current .side[data-side="right"]';
  const exitSel = '.drilled-exit';
  const innerSel = '.eq-row.current .side[data-side="left"] [data-inner-index="0"]';

  const eqCheck = await page.evaluate(() => window.App.History.getSteps().slice(-1)[0].equation);
  console.log('equation after factoring:', JSON.stringify(eqCheck));

  // Double-clic sur le groupe factorise pour entrer dedans.
  await page.waitForSelector(groupSel);
  await page.waitForTimeout(500);
  await page.dblclick(groupSel);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('dblclick drills into group (pending.drilled set)', !!pending.drilled && pending.drilled.side === 'left' && JSON.stringify(pending.drilled.path) === '[0]');

  // --- Revise : le membre "entre" reste verrouille a son premier niveau, mais l'AUTRE
  // membre redevient selectionnable pendant le drill (pour simplifier les deux a la
  // fois, voir history.js confirmSimplifySelection) -- seul le MEME membre (sibling)
  // reste bloque au premier niveau tant qu'on est dedans.
  const beforeClickOutside = await page.evaluate(() => window.App.History.getPending());
  await page.click(siblingSel).catch(() => {});
  let afterClickOutside = await page.evaluate(() => window.App.History.getPending());
  ok('click on sibling top-level term (SAME side) while drilled: still no selection change',
    JSON.stringify(afterClickOutside.selectedLeft) === JSON.stringify(beforeClickOutside.selectedLeft) && !!afterClickOutside.drilled);

  await page.click('.eq-row.current .side[data-side="right"] [data-index="0"]').catch(() => {});
  let afterClickRight = await page.evaluate(() => window.App.History.getPending());
  ok('click on right side term while drilled on the left: DOES select it now (cross-side simplify)',
    JSON.stringify(afterClickRight.selectedRight) === '[0]' && !!afterClickRight.drilled);
  // Redeselectionne pour repartir propre.
  await page.click('.eq-row.current .side[data-side="right"] [data-index="0"]').catch(() => {});

  // --- Sub-request 4 (partie 2): simple clic sur un terme interieur = toggle select (pas de drill) ---
  await page.waitForSelector(innerSel);
  await page.click(innerSel);
  let afterInnerClick = await page.evaluate(() => window.App.History.getPending());
  ok('single click on inner term selects it', afterInnerClick.selectedInner.indexOf(0) !== -1);
  await page.click(innerSel);
  let afterInnerClick2 = await page.evaluate(() => window.App.History.getPending());
  ok('single click again on same inner term deselects it (pure toggle, no drill)',
    afterInnerClick2.selectedInner.indexOf(0) === -1 && !!afterInnerClick2.drilled);

  // --- Sub-request 2 : clic droit sur la parenthese fait remonter d'un niveau, SANS
  // resélectionner le groupe qu'on vient de quitter (voir exitDrill dans history.js :
  // ressortir ne laisse plus jamais de surbrillance jaune résiduelle). ---
  await page.waitForSelector(exitSel);
  await page.click(exitSel, { button: 'right' });
  let afterRightClick = await page.evaluate(() => window.App.History.getPending());
  ok('right-click on drilled-exit exits one level (drilled becomes null)', afterRightClick.drilled === null);
  ok('after right-click exit, the group is NOT re-selected (no stale yellow highlight)', JSON.stringify(afterRightClick.selectedLeft) === '[]');

  // Deja deselectionne (voir ci-dessus) : pas besoin d'un clic de "nettoyage" avant les
  // tests de clic simple isole ci-dessous. Delai > 400ms (DOUBLE_CLICK_MS) avant CHAQUE
  // clic isole : deux clics rapproches sur le meme terme sont sinon interpretes comme un
  // double-clic (voir consumeDoubleClick dans history.js), ce qui fausserait ces tests.

  // --- Sub-request 4 (partie 1): simple clic sur le groupe (non selectionne) le selectionne, ne descend pas ---
  await page.waitForTimeout(500);
  await page.click(groupSel);
  let afterTopClick = await page.evaluate(() => window.App.History.getPending());
  ok('single click on top-level group selects it (no drill)', JSON.stringify(afterTopClick.selectedLeft) === '[0]' && afterTopClick.drilled === null);

  await page.waitForTimeout(500);
  await page.click(groupSel);
  let afterTopClick2 = await page.evaluate(() => window.App.History.getPending());
  ok('second single click (slow, separate gesture) on already-selected top-level group deselects it (toggle, not drill)',
    JSON.stringify(afterTopClick2.selectedLeft) === '[]' && afterTopClick2.drilled === null);

  await page.waitForTimeout(500);
  await page.dblclick(groupSel);
  let afterDbl = await page.evaluate(() => window.App.History.getPending());
  ok('dblclick on unselected top-level group drills in directly', !!afterDbl.drilled);

  // --- Sub-request 2 bis : clic gauche sur la zone .drilled-exit (comportement existant
  // conserve), sans resélectionner non plus ---
  await page.click(exitSel);
  let afterLeftExit = await page.evaluate(() => window.App.History.getPending());
  ok('left-click on drilled-exit still exits one level too', afterLeftExit.drilled === null);
  ok('left-click on drilled-exit also leaves no stale selection', JSON.stringify(afterLeftExit.selectedLeft) === '[]');

  // --- Sub-request 3 : fond de .drilled-exit AU REPOS (jamais de couleur de survol
  // séparée depuis que la zone n'est plus "sélectionnable" elle-même, voir style.css) :
  // AUCUN fond, ni au repos ni au survol (contrairement à un terme sélectionnable, qui
  // lui change bien de couleur au survol) — la parenthèse elle-même n'est pas un terme,
  // seuls ses termes intérieurs le sont, un fond suggérerait à tort le contraire. ---
  await page.waitForTimeout(500);
  await page.waitForSelector(groupSel + '.selectable');
  await page.hover(groupSel);
  const termHoverBg = await page.$eval(groupSel, (el) => getComputedStyle(el).backgroundColor);
  await page.dblclick(groupSel);
  await page.waitForSelector(exitSel);
  const exitRestBg = await page.$eval(exitSel, (el) => getComputedStyle(el).backgroundColor);
  await page.hover(exitSel);
  const exitHoverBg = await page.$eval(exitSel, (el) => getComputedStyle(el).backgroundColor);
  console.log('colors:', JSON.stringify({ exitRestBg, exitHoverBg, termHoverBg }));
  ok('drilled-exit has NO background at rest (transparent)', exitRestBg === 'rgba(0, 0, 0, 0)' || exitRestBg === 'transparent');
  ok('drilled-exit background does NOT change on hover', exitRestBg === exitHoverBg);
  ok('drilled-exit rest background differs from selectable-term hover color', exitRestBg !== termHoverBg);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
