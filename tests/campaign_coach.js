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
  const opRect = await page.evaluate(() => document.querySelector('#opButtons button[data-op="expr"]').getBoundingClientRect().toJSON());
  ok('step 1: "Opération" right away, no need to select the 3', c.visible && c.index === 0 && /Opération/.test(c.text) && inside(c.ring, opRect));
  await page.screenshot({ path: SCRATCH + '/campaign_coach_step1.png' });

  // Glisser le fond du canevas, s'arrêter plus d'une seconde bouton enfoncé, puis reprendre :
  // le contour suit toujours sa cible (le suivi n'expire pas pendant le glisser).
  const ringOff = () => page.evaluate(() => {
    var r = document.getElementById('coachRing').getBoundingClientRect();
    var t = document.querySelector('#opButtons button[data-op="expr"]').getBoundingClientRect();
    return Math.max(Math.abs(r.left + 6 - t.left), Math.abs(r.top + 6 - t.top));
  });
  await page.mouse.move(300, 750);
  await page.mouse.down();
  await page.mouse.move(340, 720, { steps: 5 });
  await page.waitForTimeout(1500);
  await page.mouse.move(420, 660, { steps: 8 });
  await page.waitForTimeout(100);
  ok('the ring keeps following its target after a pause mid-drag', await ringOff() < 1);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Une fenêtre modale (ici les paramètres) masque le coach au lieu de le laisser par-dessus.
  const coachShown = () => page.evaluate(() =>
    getComputedStyle(document.getElementById('coachBubble')).display !== 'none' &&
    getComputedStyle(document.getElementById('coachRing')).display !== 'none');
  await page.click('#settingsBtn');
  await page.waitForTimeout(400);
  ok('coach hidden while the settings window is open', !(await coachShown()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  ok('coach back once the settings window is closed', await coachShown());

  // Le contour pulse en continu : sélectionner un terme (qui recale le coach) ne doit pas
  // relancer l'animation, dont l'horloge ne recule donc jamais.
  await page.evaluate(() => {
    window.__pulse = []; var t0 = performance.now();
    (function f() {
      var a = document.getElementById('coachRing').getAnimations({ subtree: true })[0];
      window.__pulse.push(a ? a.currentTime : -1);
      if (performance.now() - t0 < 1200) requestAnimationFrame(f);
    })();
  });
  await page.click('.eq-row.current .side[data-side="left"] [data-index="1"]');
  await page.waitForTimeout(1300);
  ok('selecting a term does not restart the ring pulse', await page.evaluate(() =>
    window.__pulse.every(function (v, i) { return v >= 0 && (i === 0 || v >= window.__pulse[i - 1]); })));
  c = await coach();
  ok('selecting a term does not skip the "Opération" step', c.index === 0);

  await page.click('#opButtons button[data-op="expr"]');
  c = await coach();
  ok('step 2: type −3 on the keypad', c.index === 1);
  await page.evaluate(() => window.App.History.setExprChainText('-3'));
  // Après Valider : la bulle se referme (ancien texte) puis se rouvre avec le nouveau ; le
  // contour ne glisse pas : dès que la nouvelle ligne est rendue il est posé sur sa cible,
  // et la suit pendant le recentrage du canevas.
  await page.evaluate(() => {
    window.__track = []; var t0 = performance.now();
    (function f() {
      var ring = document.getElementById('coachRing'), b = document.getElementById('coachBubble');
      var t = document.querySelector('.eq-row.current .side[data-side="left"]');
      window.__track.push({ ring: ring.hidden ? null : ring.getBoundingClientRect().top, target: t ? t.getBoundingClientRect().top - 6 : NaN,
        out: b.classList.contains('coach-out'), inn: b.classList.contains('coach-in'), text: b.textContent });
      if (performance.now() - t0 < 800) requestAnimationFrame(f);
    })();
  });
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(900);
  const tr = await page.evaluate(() => window.__track);
  const firstOut = tr.findIndex((s) => s.out);
  const firstNew = tr.findIndex((s) => /Simplifier/.test(s.text));
  ok('the bubble pops out with the old text, then pops in with the new one',
    firstOut !== -1 && firstNew > firstOut && !/Simplifier/.test(tr[firstOut].text) && tr[firstNew].inn && !tr[firstNew].out);
  const t0 = tr[0].target;
  const moved = tr.filter((s) => Math.abs(s.target - t0) > 1); // une fois la nouvelle ligne rendue
  ok('after Valider the ring jumps directly onto its target, never gliding',
    moved.length > 0 && moved.every((s) => s.ring !== null && Math.abs(s.ring - s.target) < 1));
  c = await coach();
  ok('step 3 once the operation is applied: simplify the left side', c.index === 2);
  await page.screenshot({ path: SCRATCH + '/campaign_coach_step4.png' });

  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('step 4: same on the right', c.index === 3);
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('coach disappears once the level is won', !c.visible && await page.evaluate(() => window.App.Campaign.current().won));

  // --- T3 (t4) : le coach 2/2 part dès 8−8 simplifié ; à la fin, la simplification
  // automatique est activée et le coach le signale sur le bouton des réglages ---
  await page.evaluate(() => {
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: { t1: { stars: 3 }, t3: { stars: 3 } } }));
    window.App.Progress.load();
    window.App.Settings.set('autoSimplify', false);
    window.App.Campaign.startLevel('t4');
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('-8'); H.confirm();
  });
  c = await coach();
  ok('T3: step 2/2 after the drag', c.visible && c.index === 1 && /2 \/ 2/.test(c.text));
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('T3: the coach leaves once 8−8 is simplified', !c.visible);
  await page.evaluate(() => {
    var H = window.App.History;
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  c = await coach();
  const gearRect = await page.evaluate(() => document.getElementById('settingsBtn').getBoundingClientRect().toJSON());
  ok('T3 won: auto-simplify is turned on', await page.evaluate(() => window.App.Campaign.current().won && window.App.Settings.get('autoSimplify')));
  ok('and the coach says so, pointing at the settings', c.visible && /simplification automatique/.test(c.text) && /réglages/.test(c.text) &&
    inside(c.ring, gearRect));
  await page.screenshot({ path: SCRATCH + '/campaign_coach_autosimplify.png' });
  ok('no "Compris" button on it', await page.evaluate(() => document.querySelector('[data-coach-ok]').hidden));
  await page.evaluate(() => {
    window.App.Settings.set('autoSimplify', false);
    window.App.Campaign.startLevel('t4');
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('-8'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  c = await coach();
  ok('replaying T3 does not turn it back on', !c.visible && await page.evaluate(() =>
    window.App.Campaign.current().won && !window.App.Settings.get('autoSimplify')));

  // --- T7 : étape "Compris" ---
  await page.evaluate(() => {
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: {
      t1: { stars: 3 }, t3: { stars: 3 }, t4: { stars: 3 }, t5: { stars: 3 } } }));
    window.App.Progress.load();
    window.App.Campaign.startLevel('t7');
  });
  c = await coach();
  ok('T7 opens with a manual step', c.visible && c.index === 0 && await page.evaluate(() => !document.querySelector('[data-coach-ok]').hidden));
  await page.click('#zoomOutBtn');
  c = await coach();
  ok('zooming out moves to the next step', c.index === 1);
  const both = await page.evaluate(() => ['0', '1'].map((i) =>
    document.querySelector('.eq-row.current .side[data-side="left"] [data-index="' + i + '"]').getBoundingClientRect().toJSON()));
  ok('the ring frames both 3x and 2x', inside(c.ring, both[0]) && inside(c.ring, both[1]));
  await page.screenshot({ path: SCRATCH + '/campaign_coach_t7_select.png' });

  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+1=2')); });
  c = await coach();
  ok('leaving the level hides the coach', !c.visible);

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
