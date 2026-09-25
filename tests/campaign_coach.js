const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Coach du Port (voir js/coach.js) : la bulle suit les vraies actions de l'élève sur T1,
// entoure l'élément attendu, puis disparaît une fois le niveau réussi.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  async function coach() {
    await page.waitForTimeout(1000);
    return page.evaluate(() => {
      var b = document.getElementById('coachBubble'), r = document.getElementById('coachRing');
      return { visible: !b.hidden, index: window.App.Coach.currentIndex(), text: b.textContent,
        ring: r.hidden ? null : r.getBoundingClientRect().toJSON() };
    });
  }
  function inside(ring, rect) {
    return ring && rect && ring.left <= rect.left + 1 && ring.top <= rect.top + 1 &&
      ring.right >= rect.right - 1 && ring.bottom >= rect.bottom - 1;
  }

  await page.evaluate(() => window.App.Campaign.startLevel('t1'));
  let c = await coach();
  const termRect = await page.evaluate(() => document.querySelector('.eq-row.current .side[data-side="left"] [data-index="1"]').getBoundingClientRect().toJSON());
  ok('step 1: select the 3, ring around it', c.visible && c.index === 0 && inside(c.ring, termRect));
  await page.screenshot({ path: SCRATCH + '/campaign_coach_step1.png' });

  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  c = await coach();
  ok('step 2 after the click: "Opération"', c.index === 1 && /Opération/.test(c.text));
  const opRect = await page.evaluate(() => document.querySelector('#opButtons button[data-op="expr"]').getBoundingClientRect().toJSON());
  ok('ring around the Opération button', inside(c.ring, opRect));

  await page.click('#opButtons button[data-op="expr"]');
  c = await coach();
  ok('step 3: type −3 on the keypad', c.index === 2);
  await page.evaluate(() => window.App.History.setExprChainText('-3'));
  await page.click('[data-key="enter"]');
  c = await coach();
  ok('step 4 once the operation is applied: simplify the left side', c.index === 3);
  await page.screenshot({ path: SCRATCH + '/campaign_coach_step4.png' });

  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('step 5: same on the right', c.index === 4);
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('coach disappears once the level is won', !c.visible && await page.evaluate(() => window.App.Campaign.current().won));

  // --- T7 : étape "Compris" ---
  await page.evaluate(() => {
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: {
      t1: { stars: 3 }, t2: { stars: 3 }, t3: { stars: 3 }, t4: { stars: 3 }, t5: { stars: 3 }, t6: { stars: 3 } } }));
    window.App.Progress.load();
    window.App.Campaign.startLevel('t7');
  });
  c = await coach();
  ok('T7 opens with a manual step', c.visible && c.index === 0 && await page.evaluate(() => !document.querySelector('[data-coach-ok]').hidden));
  await page.click('[data-coach-ok]');
  c = await coach();
  ok('"Compris" moves to the next step', c.index === 1);

  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+1=2')); });
  c = await coach();
  ok('leaving the level hides the coach', !c.visible);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
