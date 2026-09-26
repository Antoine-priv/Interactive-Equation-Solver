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
  ok('step 2 after the click: "Opération"', c.index === 1 && /Opération/.test(c.text));
  const opRect = await page.evaluate(() => document.querySelector('#opButtons button[data-op="expr"]').getBoundingClientRect().toJSON());
  ok('ring around the Opération button', inside(c.ring, opRect));

  await page.click('#opButtons button[data-op="expr"]');
  c = await coach();
  ok('step 3: type −3 on the keypad', c.index === 2);
  await page.evaluate(() => window.App.History.setExprChainText('-3'));
  // Après Valider, le canevas se recentre : le contour doit rejoindre le côté gauche en un
  // glissement continu, sans s'arrêter à une position intermédiaire saisie en plein
  // recentrage pendant que la cible continue de bouger.
  await page.evaluate(() => {
    window.__track = []; var t0 = performance.now();
    (function f() {
      var t = document.querySelector('.eq-row.current .side[data-side="left"]');
      window.__track.push([performance.now() - t0, document.getElementById('coachRing').getBoundingClientRect().top,
        t ? t.getBoundingClientRect().top - 6 : NaN]);
      if (performance.now() - t0 < 800) requestAnimationFrame(f);
    })();
  });
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(900);
  ok('after Valider the ring never stalls off target and ends on it', await page.evaluate(() => {
    var tr = window.__track, t0 = tr[0][2], stall = 0, worst = 0;
    var after = tr.filter(function (s) { return Math.abs(s[2] - t0) > 1; }); // une fois la nouvelle ligne rendue
    after.forEach(function (s, i) {
      var still = i > 0 && Math.abs(s[1] - after[i - 1][1]) < 0.5;
      stall = still && Math.abs(s[1] - s[2]) > 1 ? stall + 1 : 0;
      worst = Math.max(worst, stall);
    });
    return after.length > 0 && worst < 3 && Math.abs(tr[tr.length - 1][1] - tr[tr.length - 1][2]) < 1;
  }));
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
