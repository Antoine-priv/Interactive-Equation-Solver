const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté : en tapant une "Opération" DANS une colonne "Condition d'existence"
// (domaine de définition), le pavé "live" (le <math-field> partagé, voir
// #liveOpPill/positionLiveField dans arrows.js) apparaissait près de la chaîne
// principale plutôt qu'à côté de sa propre flèche, dans la colonne de domaine
// elle-même. Cause : positionDomainGroup (qui déplace la colonne à côté de la chaîne
// principale via `left`/`top`, voir renderAll dans render.js) était différé dans son
// PROPRE requestAnimationFrame, programmé APRÈS celui, déjà en file, qui dessine les
// flèches/le pavé live de la colonne (renderDomainSplit -> renderBranchNode -> drawAll)
// — la mesure de position du pavé (un singleton absolu, enfant de #canvasLayer, PAS de
// la colonne) survenait donc AVANT que la colonne ait été déplacée à sa position finale.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  // Même équation à dénominateur variable que existence_condition_den_spawn.js.
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, factorTerms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], innerTerms: [{ coeff: 5, pow: 0 }], isDivision: true }],
      right: [{ coeff: 2, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  const denSel = '.eq-row.current .side[data-side="left"] [data-fracpart="den"]';
  await page.click(denSel, { force: true });
  await page.click(denSel, { force: true });
  await page.click('button[data-op="existence"]');
  await page.waitForTimeout(150);

  // Focalise la colonne de domaine puis entre en mode 'expr' directement sur SON
  // propre moteur (équivalent à cliquer "Opération" une fois un terme sélectionné dedans).
  await page.evaluate(() => {
    window.App.History.setFocusedDomain(0);
    var conds = window.App.History.getDomainConditions();
    conds[0].engine.selectOp('expr');
  });
  await page.waitForTimeout(150);

  const geo = await page.evaluate(() => {
    var pill = document.getElementById('liveOpPill');
    var col = document.querySelector('.domain-branch[data-domain-index="0"]');
    var mainEq = document.querySelector('#history > .eq-row');
    return {
      pillRect: pill ? pill.getBoundingClientRect().toJSON() : null,
      pillHidden: pill ? pill.hidden : null,
      colRect: col ? col.getBoundingClientRect().toJSON() : null,
      mainEqRect: mainEq ? mainEq.getBoundingClientRect().toJSON() : null
    };
  });

  await page.screenshot({ path: `${SCRATCH}/existence_condition_live_pill_position.png` });

  ok('live pill is visible', geo.pillHidden === false);

  const distToCol = geo.pillRect && geo.colRect
    ? Math.max(0, geo.colRect.left - geo.pillRect.right, geo.pillRect.left - geo.colRect.right)
    : Infinity;
  const distToMain = geo.pillRect && geo.mainEqRect
    ? Math.max(0, geo.mainEqRect.left - geo.pillRect.right, geo.pillRect.left - geo.mainEqRect.right)
    : Infinity;

  ok('live pill sits within/next to the domain column (not far off)', distToCol < 40);
  ok('live pill is closer to the domain column than to the main equation', distToCol < distToMain);

  console.log('--- erreurs JS ---');
  console.log(errs.length ? errs.join('\n') : '(aucune)');
  if (errs.length) process.exitCode = 1;

  await browser.close();
})();
