const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Campagne (voir js/levels.js, progress.js, map.js, campaign.js) : la carte s'ouvre au
// premier lancement, un niveau se lance depuis la carte, se réussit, s'enregistre, et le
// suivant s'ouvre.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // Le catalogue se lit sans erreur et chaque équation se parse.
  const parseErrors = await page.evaluate(() => {
    var bad = [];
    window.App.Levels.LEVELS.forEach(function (l) {
      window.App.Levels.partsOf(l).forEach(function (p) {
        try { window.App.Parser.parseLatexEquation(p.latex); } catch (e) { bad.push(l.id + ': ' + e.message); }
      });
      l.req.forEach(function (r) { if (!window.App.Levels.get(r)) bad.push(l.id + ': prérequis inconnu ' + r); });
    });
    return bad;
  });
  ok('every level equation parses and every prerequisite exists', parseErrors.length === 0);
  if (parseErrors.length) console.log(parseErrors.join('\n'));

  ok('no auto-open under automation', await page.evaluate(() => document.getElementById('mapOverlay').hidden));
  await page.evaluate(() => window.App.Campaign.boot({ force: true }));
  ok('first launch opens the map', await page.evaluate(() => !document.getElementById('mapOverlay').hidden));
  const nodes = await page.evaluate(() => ({
    total: document.querySelectorAll('.map-node').length,
    open: Array.from(document.querySelectorAll('.map-node.open')).map((n) => n.getAttribute('data-level'))
  }));
  ok('one node per level', nodes.total === await page.evaluate(() => window.App.Levels.LEVELS.length));
  ok('only T1 is open at the start', JSON.stringify(nodes.open) === '["t1"]');
  ok('card of the current level is shown', await page.evaluate(() => !document.querySelector('.map-card').hidden &&
    !!document.querySelector('[data-map-play="t1"]')));
  await page.waitForTimeout(300);
  await page.screenshot({ path: SCRATCH + '/campaign_map_start.png' });

  // Un nœud verrouillé explique ce qui manque.
  await page.evaluate(() => window.App.Map.select('l1'));
  ok('locked level lists its missing prerequisite', await page.evaluate(() =>
    document.querySelector('.map-card-locked').textContent.indexOf('Grand large') !== -1));

  // --- Jouer T1 ---
  await page.evaluate(() => window.App.Map.select('t1'));
  await page.click('[data-map-play="t1"]');
  await page.waitForTimeout(200);
  const lv = await page.evaluate(() => ({
    mapHidden: document.getElementById('mapOverlay').hidden,
    bar: !document.getElementById('levelBar').hidden,
    eq: window.App.History.lastEquation(),
    cur: window.App.Campaign.current()
  }));
  ok('playing closes the map and shows the level bar', lv.mapHidden && lv.bar && lv.cur && lv.cur.id === 't1');
  ok('the level equation is loaded', JSON.stringify(lv.eq.left) === JSON.stringify([{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }]));
  ok('actions not yet introduced are locked', await page.evaluate(() =>
    window.App.Campaign.isOpLocked('factor') && !window.App.Campaign.isOpLocked('simplify') && !window.App.Campaign.isOpLocked('expr')));

  await page.evaluate(() => {
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('-3'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  await page.waitForTimeout(300);
  const won = await page.evaluate(() => ({
    cur: window.App.Campaign.current(),
    win: !document.getElementById('levelWin').hidden,
    stars: document.querySelectorAll('#levelWin [data-win-star].on').length,
    steps: window.App.Campaign.stepCount(),
    saved: JSON.parse(localStorage.getItem('equations-progress'))
  }));
  ok('solving x = 4 wins the level', won.cur && won.cur.won && won.win);
  ok('Simplifier does not count: 1 step', won.steps === 1);
  ok('3 stars', won.stars === 3);
  ok('progress saved in localStorage', won.saved && won.saved.levels.t1 && won.saved.levels.t1.stars === 3);
  await page.screenshot({ path: SCRATCH + '/campaign_level_won.png' });

  // --- Retour à la carte par le bouton carte (pas celui de la fenêtre) : l'animation joue ---
  await page.click('#mapBtn');
  await page.waitForTimeout(100);
  ok('opening the map with the map button plays the unlock animation', await page.evaluate(() =>
    !!document.querySelector('.map-edge.draw-in[data-edge="t1-t2"]')));
  await page.waitForTimeout(1600);
  await page.screenshot({ path: SCRATCH + '/campaign_map_after.png' });
  const after = await page.evaluate(() => ({
    t1: document.querySelector('[data-level="t1"]').getAttribute('class'),
    t2: document.querySelector('[data-level="t2"]').getAttribute('class'),
    stars: document.querySelector('[data-map-stars]').textContent
  }));
  ok('T1 shown as done, T2 now open', /done/.test(after.t1) && /open/.test(after.t2) && !/locked/.test(after.t2));
  ok('star total updated', after.stars === '3');
  const pos = await page.evaluate(() => {
    var n = document.querySelector('[data-level="t2"] .map-node-body').getBoundingClientRect();
    var c = document.querySelector('.map-card').getBoundingClientRect();
    return { n: n.toJSON(), c: c.toJSON() };
  });
  const cx = pos.n.x + pos.n.width / 2, cy = pos.n.y + pos.n.height / 2;
  ok('level card floats next to its node', (pos.c.left > cx && pos.c.left - cx < 80 || cx > pos.c.right && cx - pos.c.right < 80) &&
    cy > pos.c.top && cy < pos.c.bottom);
  await page.evaluate(() => window.App.Map.close());
  await page.click('#mapBtn');
  await page.waitForTimeout(100);
  ok('the animation plays only once', await page.evaluate(() => !document.querySelector('.map-edge.draw-in')));
  ok('reopening after a win focuses the next level to play', await page.evaluate(() =>
    document.querySelector('.map-card-title').textContent === 'Ajouter'));

  // --- Un "Annuler" enlève la 2e étoile ; "Mode libre" quitte la campagne ---
  await page.evaluate(() => window.App.Campaign.startLevel('t2'));
  await page.evaluate(() => {
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('+1'); H.confirm();
    H.undo();
    H.selectOp('expr'); H.setExprChainText('+5'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  await page.waitForTimeout(200);
  ok('undo used: 2 stars', await page.evaluate(() => document.querySelectorAll('#levelWin [data-win-star].on').length) === 2);

  await page.evaluate(() => window.App.Campaign.startLevel('t3'));
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+1=2')); });
  ok('a free equation leaves the level', await page.evaluate(() => window.App.Campaign.current() === null &&
    document.getElementById('levelBar').hidden && !window.App.Campaign.isOpLocked('factor')));

  // --- Export / import de la progression (réglages) ---
  await page.evaluate(() => { document.getElementById('settingsBtn').click(); });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#progressExport')]);
  const exported = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  ok('export downloads a JSON file with the progress', /^progression-equations-.*\.json$/.test(download.suggestedFilename()) &&
    exported.progress && exported.progress.levels.t1.stars === 3);
  await page.evaluate(() => { localStorage.removeItem('equations-progress'); window.App.Progress.load(); });
  ok('progress cleared', await page.evaluate(() => window.App.Progress.totalStars()) === 0);
  await page.setInputFiles('#progressImportFile', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForTimeout(200);
  ok('import restores the progress', await page.evaluate(() => window.App.Progress.stars('t1')) === 3 &&
    /importée/.test(await page.textContent('#progressNote')));
  await page.setInputFiles('#progressImportFile', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"foo":1}') });
  await page.waitForTimeout(200);
  ok('a foreign file is refused', /n'est pas/.test(await page.textContent('#progressNote')) &&
    await page.evaluate(() => window.App.Progress.stars('t1')) === 3);

  // --- Réinitialisation (réglages, second clic pour confirmer) ---
  await page.click('#progressReset');
  ok('first click only asks for confirmation', await page.evaluate(() => window.App.Progress.stars('t1')) === 3 &&
    /Confirmer/.test(await page.textContent('#progressReset')));
  await page.click('#progressReset');
  ok('second click resets the progress', await page.evaluate(() => window.App.Progress.totalStars() === 0 &&
    !JSON.parse(localStorage.getItem('equations-progress')).levels.t1));

  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
