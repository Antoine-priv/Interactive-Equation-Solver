const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Défi du jour (la même équation pour tout le monde à une date donnée) et animation de
// la carte quand une région s'ouvre (voir js/campaign.js, js/map.js).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  const d = await page.evaluate(() => {
    var C = window.App.Campaign;
    var r = Math.random;
    var a = JSON.stringify(C.dailyEquation('2026-09-25'));
    var b = JSON.stringify(C.dailyEquation('2026-09-25'));
    var others = ['2026-09-26', '2026-09-27', '2026-09-28'].map(function (x) { return JSON.stringify(C.dailyEquation(x)); });
    return { same: a === b, differs: others.some(function (o) { return o !== a; }), restored: Math.random === r };
  });
  ok('same date, same daily equation', d.same);
  ok('another date gives another equation', d.differs);
  ok('Math.random is restored afterwards', d.restored);

  // Sommet : fermé tant que l'épreuve de l'Observatoire n'est pas faite ou sans 110 ★.
  const gate = await page.evaluate(() => {
    var P = window.App.Progress, L = window.App.Levels;
    var levels = {};
    L.LEVELS.forEach(function (l) { if (!l.daily) levels[l.id] = { stars: 1 }; });
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: levels }));
    P.load();
    var fewStars = P.isAvailable(L.get('top'));
    Object.keys(levels).forEach(function (id) { levels[id].stars = 2; });
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: levels }));
    P.load();
    return { fewStars: fewStars, enough: P.isAvailable(L.get('top')) };
  });
  ok('Sommet locked with fewer than 110 ★', !gate.fewStars);
  ok('Sommet open with enough ★', gate.enough);

  await page.evaluate(() => window.App.Campaign.startLevel('top'));
  const started = await page.evaluate(() => ({
    cur: window.App.Campaign.current(),
    eq: JSON.stringify({ left: window.App.History.lastEquation().left, right: window.App.History.lastEquation().right }),
    expected: (function () { var e = window.App.Campaign.dailyEquation(); return JSON.stringify({ left: e.left, right: e.right }); })(),
    title: document.querySelector('[data-level-title]').textContent
  }));
  ok('playing the Sommet loads today\'s equation', started.cur && started.cur.id === 'top' && started.eq === started.expected);
  ok('level bar says "Défi du jour"', started.title === 'Défi du jour');

  // --- Nouvelle région : le brouillard se lève et une bannière s'affiche ---
  await page.evaluate(() => {
    var levels = {};
    ['t1', 't3', 't4', 't5', 't6', 't7'].forEach(function (id) { levels[id] = { stars: 3 }; });
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: levels }));
    window.App.Progress.load();
    window.App.Map.open({ from: 't7', unlocked: ['l1'] });
  });
  const before = await page.evaluate(() => document.querySelector('[data-zone="plaine"]').getAttribute('class'));
  ok('the new region starts in the fog', /fogged/.test(before));
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => ({
    zone: document.querySelector('[data-zone="plaine"]').getAttribute('class'),
    banner: document.querySelector('.map-banner').classList.contains('show'),
    text: document.querySelector('.map-banner').textContent,
    l1: document.querySelector('[data-level="l1"]').getAttribute('class')
  }));
  ok('the fog lifts', !/fogged/.test(after.zone));
  ok('banner "Nouvelle région · La Plaine"', after.banner && /La Plaine/.test(after.text));
  ok('L1 is now open', /open/.test(after.l1) && !/locked/.test(after.l1));
  await page.screenshot({ path: SCRATCH + '/campaign_new_region.png' });

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
