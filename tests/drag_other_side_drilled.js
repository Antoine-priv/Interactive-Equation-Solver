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

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '6x+2+10x=8x+3+2x');

  // Factorise le membre GAUCHE par 2, puis "entre" dedans (drill) : le membre DROIT
  // n'est ni sélectionné ni concerné par ce drill.
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 0);
    H.toggleTermSelection('left', 1);
    H.toggleTermSelection('left', 2);
    H.enterFactorWithSelection();
    H.chooseFactorMode('common');
    H.setFactorTermLatex('2');
    H.confirm();
    H.drillIntoGroup('left', 0);
  });
  await page.waitForTimeout(100);

  const drilled = await page.evaluate(() => window.App.History.getPending().drilled);
  console.log('drilled:', JSON.stringify(drilled));
  ok('drilled into left side', drilled && drilled.side === 'left');

  // Le membre droit (non drille) a-t-il toujours ses termes glissables au premier niveau ?
  const rightTermsInfo = await page.evaluate(() => {
    var els = Array.from(document.querySelectorAll('.side[data-side="right"] .term[data-index]'));
    return els.map((e) => ({ idx: e.getAttribute('data-index'), draggable: e.classList.contains('draggable-term') }));
  });
  console.log('termes du membre droit:', JSON.stringify(rightTermsInfo));
  ok('right-side (non-drilled) top-level terms are draggable', rightTermsInfo.length === 3 && rightTermsInfo.every((t) => t.draggable));

  // Glisse réellement le 1er terme du membre droit après le 2e.
  const beforeOrder = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.right.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre membre droit avant glisser:', JSON.stringify(beforeOrder));

  const t0 = await page.$('.side[data-side="right"] .term[data-index="0"]');
  const t1 = await page.$('.side[data-side="right"] .term[data-index="1"]');
  const b0 = await t0.boundingBox();
  const b1 = await t1.boundingBox();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 8, b0.y + b0.height / 2 + 2);
  await page.mouse.move(b1.x + b1.width + 5, b1.y + b1.height / 2, { steps: 10 });
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterOrder = await page.evaluate(() => {
    var eq = window.App.History.lastEquation();
    return eq.right.map((t) => t.coeff + '/' + t.pow);
  });
  console.log('ordre membre droit apres glisser:', JSON.stringify(afterOrder));
  ok('right-side order actually changed via drag', JSON.stringify(afterOrder) !== JSON.stringify(beforeOrder));

  // On doit toujours etre "entre" dans le groupe a gauche (le glisser a droite ne doit
  // pas avoir perturbe l'etat de drill).
  const stillDrilled = await page.evaluate(() => window.App.History.getPending().drilled);
  ok('still drilled into left side after dragging the right side', stillDrilled && stillDrilled.side === 'left');

  await page.screenshot({ path: `${SCRATCH}/drag_other_side_drilled.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  await browser.close();
})();
