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

  // Loupes du canevas, zoom animé, fiche fermée par un clic à côté, bouton carte au-dessus.
  ok('map zoom buttons use the canvas magnifier icons', await page.evaluate(() =>
    document.querySelector('[data-map-zoom="in"]').innerHTML === document.getElementById('zoomInBtn').innerHTML &&
    document.querySelector('[data-map-zoom="out"]').innerHTML === document.getElementById('zoomOutBtn').innerHTML));
  const s0 = await page.evaluate(() => window.App.Map.view().s);
  await page.click('[data-map-zoom="in"]');
  ok('zooming in is animated', await page.evaluate(() => document.querySelector('.map-world').classList.contains('map-world-animated')) &&
    await page.evaluate(() => window.App.Map.view().s) > s0);
  await page.waitForTimeout(400);
  await page.click('[data-map-zoom="out"]');
  await page.waitForTimeout(400);
  await page.mouse.click(200, 820);
  ok('the card closes with an animation', await page.evaluate(() => document.querySelector('.map-card').classList.contains('map-card-out')));
  await page.waitForTimeout(250);
  ok('a click beside the card closes it', await page.evaluate(() => document.querySelector('.map-card').hidden));
  await page.evaluate(() => window.App.Map.select('t1'));
  ok('selecting a node opens its card with an animation', await page.evaluate(() =>
    !document.querySelector('.map-card').hidden && document.querySelector('.map-card').classList.contains('map-card-in')));
  await page.mouse.click(200, 820);
  await page.waitForTimeout(250);

  // Survol d'un nœud : aperçu de la fiche ; clic : fiche fixée ; re-clic : fermée.
  const t1c = await page.evaluate(() => {
    var b = document.querySelector('.map-node[data-level="t1"] .map-node-body').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  await page.mouse.move(t1c.x, t1c.y);
  ok('hovering a node previews its card', await page.evaluate(() => !document.querySelector('.map-card').hidden &&
    !!document.querySelector('[data-map-play="t1"]')));
  await page.mouse.move(200, 820);
  await page.waitForTimeout(400);
  ok('leaving the node hides the preview', await page.evaluate(() => document.querySelector('.map-card').hidden));
  await page.mouse.click(t1c.x, t1c.y);
  await page.mouse.move(200, 820);
  await page.waitForTimeout(400);
  ok('clicking a node pins its card', await page.evaluate(() => !document.querySelector('.map-card').hidden));
  await page.mouse.click(t1c.x, t1c.y);
  await page.waitForTimeout(250);
  ok('clicking the pinned node again closes its card', await page.evaluate(() => document.querySelector('.map-card').hidden));
  await page.mouse.move(200, 820);
  ok('the map button is hidden on the map', await page.evaluate(() =>
    document.getElementById('mapBtn').getBoundingClientRect().width === 0));
  await page.keyboard.press('Escape');
  ok('closing the map (Escape) is animated', await page.evaluate(() => document.getElementById('mapOverlay').classList.contains('map-closing') &&
    !window.App.Map.isOpen()));
  await page.waitForTimeout(350);
  ok('the map is closed, the map button is back', await page.evaluate(() => document.getElementById('mapOverlay').hidden &&
    document.getElementById('mapBtn').getBoundingClientRect().width > 0));
  await page.click('#mapBtn');
  ok('and reopens the map, with the opening animation', await page.evaluate(() =>
    !document.getElementById('mapOverlay').hidden && document.getElementById('mapOverlay').classList.contains('map-opening')));

  await page.screenshot({ path: SCRATCH + '/campaign_map_buttons.png' });
  // Un nœud verrouillé n'ouvre pas de fiche : son cadenas tremble, la fiche ouverte se ferme.
  await page.evaluate(() => window.App.Map.select('t1'));
  await page.waitForTimeout(250);
  const l1 = await page.evaluate(() => {
    var b = document.querySelector('.map-node[data-level="l1"] .map-node-body').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const lockAt = () => page.evaluate(() => {
    var r = document.querySelector('.map-node[data-level="l1"] .map-node-lock-bg').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  const lockBefore = await lockAt();
  await page.mouse.click(l1.x, l1.y);
  ok('clicking a locked level shakes its lock', await page.evaluate(() =>
    document.querySelector('.map-node[data-level="l1"]').classList.contains('unlocking')));
  await page.waitForTimeout(90);
  const lockDuring = await lockAt();
  ok('the lock shakes where it is, not at the center of the node',
    Math.abs(lockDuring.x - lockBefore.x) < 3 && Math.abs(lockDuring.y - lockBefore.y) < 3);
  await page.waitForTimeout(250);
  ok('and shows no card', await page.evaluate(() => document.querySelector('.map-card').hidden &&
    !document.querySelector('.map-node.selected')));

  // --- Glisser la carte ferme la fiche fixée ---
  await page.evaluate(() => window.App.Map.select('t1'));
  await page.waitForTimeout(300);
  await page.mouse.move(300, 750);
  await page.mouse.down();
  await page.mouse.move(360, 700, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  ok('dragging the map closes the pinned card', await page.evaluate(() => document.querySelector('.map-card').hidden &&
    !document.querySelector('.map-node.selected')));

  // --- « Jouer » n'apparaît qu'au survol de la fiche, qui s'allonge vers le bas ---
  await page.mouse.move(700, 880);
  await page.evaluate(() => window.App.Map.select('t1'));
  await page.waitForTimeout(300);
  const playShown = () => page.evaluate(() => {
    var a = document.querySelector('.map-card-actions');
    return getComputedStyle(a).opacity === '1' && a.getBoundingClientRect().height > 20;
  });
  const cardBox = () => page.evaluate(() => document.querySelector('.map-card').getBoundingClientRect().toJSON());
  const c0 = await cardBox();
  ok('the play button is hidden while the mouse is off the card', !(await playShown()));
  await page.mouse.move(c0.x + c0.width / 2, c0.y + 20);
  await page.waitForTimeout(300);
  const c1 = await cardBox();
  ok('hovering the card reveals the play button', await playShown());
  ok('the card grows downward only', Math.abs(c1.top - c0.top) < 1 && c1.bottom > c0.bottom + 20);

  // --- Jouer T1 ---
  await page.click('[data-map-play="t1"]');
  await page.waitForTimeout(350);
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
    !!document.querySelector('.map-edge.draw-in[data-edge="t1-t3"]')));
  ok('the new level card waits for the end of the animation', await page.evaluate(() => document.querySelector('.map-card').hidden));
  await page.waitForTimeout(1600);
  ok('still no card while the token travels', await page.evaluate(() => document.querySelector('.map-card').hidden));
  await page.waitForTimeout(800);
  ok('the card of the unlocked level pops once the animation is over', await page.evaluate(() =>
    !document.querySelector('.map-card').hidden && document.querySelector('.map-card-title').textContent === 'Diviser'));
  await page.screenshot({ path: SCRATCH + '/campaign_map_after.png' });
  const after = await page.evaluate(() => ({
    t1: document.querySelector('[data-level="t1"]').getAttribute('class'),
    t3: document.querySelector('[data-level="t3"]').getAttribute('class'),
    stars: document.querySelector('[data-map-stars]').textContent
  }));
  ok('T1 shown as done, T3 now open', /done/.test(after.t1) && /open/.test(after.t3) && !/locked/.test(after.t3));
  ok('star total updated', after.stars === '3');
  const pos = await page.evaluate(() => {
    var n = document.querySelector('[data-level="t3"] .map-node-body').getBoundingClientRect();
    var c = document.querySelector('.map-card').getBoundingClientRect();
    return { n: n.toJSON(), c: c.toJSON() };
  });
  const cx = pos.n.x + pos.n.width / 2, cy = pos.n.y + pos.n.height / 2;
  ok('level card floats next to its node', (pos.c.left > cx && pos.c.left - cx < 80 || cx > pos.c.right && cx - pos.c.right < 80) &&
    cy > pos.c.top && cy < pos.c.bottom);
  await page.evaluate(() => window.App.Map.select('t1'));
  ok('the card of a solved level does not repeat its stars', await page.evaluate(() =>
    document.querySelector('.map-card-title').textContent === 'Premier pas' &&
    !document.querySelector('.map-card-meta')));
  await page.evaluate(() => window.App.Map.close());
  await page.click('#mapBtn');
  await page.waitForTimeout(100);
  ok('the animation plays only once', await page.evaluate(() => !document.querySelector('.map-edge.draw-in')));
  ok('reopening after a win focuses the next level to play', await page.evaluate(() =>
    document.querySelector('.map-card-title').textContent === 'Diviser'));

  // --- Plus de « Rejouer » à la fin ; un niveau rejoué ne propose pas « Suivant » ---
  await page.evaluate(() => window.App.Campaign.startLevel('t1'));
  await page.evaluate(() => {
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('-3'); H.confirm();
    H.toggleTermSelection('left', 1); H.toggleTermSelection('left', 2); H.confirmSimplifySelection();
    H.toggleTermSelection('right', 0); H.toggleTermSelection('right', 1); H.confirmSimplifySelection();
  });
  await page.waitForTimeout(200);
  ok('replaying a solved level: no Suivant, no Rejouer', await page.evaluate(() => window.App.Campaign.current().won &&
    !document.getElementById('levelWin').hidden && document.querySelector('[data-win-next]').hidden &&
    !document.querySelector('[data-win-replay]')));

  // --- Un "Annuler" enlève la 2e étoile ; "Mode libre" quitte la campagne ---
  await page.evaluate(() => window.App.Campaign.startLevel('t3'));
  await page.evaluate(() => {
    var H = window.App.History;
    H.selectOp('expr'); H.setExprChainText('+1'); H.confirm();
    H.undo();
    H.selectOp('expr'); H.setExprChainText('\\div3'); H.confirm();
  });
  await page.waitForTimeout(200);
  ok('undo used: 2 stars', await page.evaluate(() => document.querySelectorAll('#levelWin [data-win-star].on').length) === 2);

  // --- "Suivant" : la carte s'ouvre, l'animation de déblocage joue, puis le niveau suivant démarre ---
  await page.click('[data-win-next]');
  await page.waitForTimeout(150);
  ok('Suivant opens the map with the unlock animation', await page.evaluate(() =>
    window.App.Map.isOpen() && !!document.querySelector('.map-edge.draw-in[data-edge="t3-t4"]') &&
    window.App.Campaign.current().id === 't3' && document.getElementById('levelWin').hidden));
  await page.waitForTimeout(2600);
  ok('the map stays a moment once the unlock is over', await page.evaluate(() =>
    window.App.Map.isOpen() && window.App.Campaign.current().id === 't3'));
  await page.waitForTimeout(1000);
  ok('then the map closes on the next level', await page.evaluate(() =>
    document.getElementById('mapOverlay').hidden && window.App.Campaign.current().id === 't4' && !window.App.Campaign.current().won));

  await page.evaluate(() => window.App.Campaign.startLevel('t4'));
  await page.evaluate(() => { window.App.History.startNewEquation(window.App.Parser.parseEquation('x+1=2')); });
  ok('a free equation leaves the level', await page.evaluate(() => window.App.Campaign.current() === null &&
    document.getElementById('levelBar').hidden && !window.App.Campaign.isOpLocked('factor')));

  // --- Export / import de la progression (réglages) ---
  await page.evaluate(() => { document.getElementById('settingsBtn').click(); });
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#progressExport')]);
  const exported = JSON.parse(require('fs').readFileSync(await download.path(), 'utf8'));
  ok('export downloads a JSON file with the progress', /^progression-equations-.*\.json$/.test(download.suggestedFilename()) &&
    exported.progress && exported.progress.levels.t1.stars === 3);
  ok('export shows no "saved" note (the browser does not tell if the file was kept)', await page.evaluate(() =>
    document.getElementById('progressNote').textContent === ''));
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

  ok('settings: no explanatory sentence, import styled like export, red reset button', await page.evaluate(() => {
    var imp = document.getElementById('progressImport'), exp = document.getElementById('progressExport'), rst = document.getElementById('progressReset');
    return imp.className === exp.className && rst.textContent === 'Réinitialiser ma progression' &&
      getComputedStyle(rst).backgroundColor === 'rgb(220, 38, 38)';
  }));
  await page.screenshot({ path: SCRATCH + '/campaign_settings.png' });
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
