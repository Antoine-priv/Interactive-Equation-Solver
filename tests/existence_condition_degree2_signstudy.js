const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Étude de signe" (l'ancienne Phase 3 du plan "Condition d'existence") a été retirée :
// un radicand degré 2 (ex. "√(x²-9)") n'a désormais plus AUCUN chemin pour résoudre sa
// condition de domaine ("x²-9≥0" factorisée n'admettrait plus de conclusion) — donc
// "Condition d'existence" ne doit plus jamais s'y proposer, contrairement au cas linéaire
// (toujours pris en charge normalement, voir isLinearRadicand dans history.js). Cette
// équation reste par ailleurs parfaitement résolvable comme équation NORMALE, en élevant
// les deux membres au carré (touche "(‥)²" du pavé "Opération").
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 2 }, { coeff: -9, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
  });
  await page.waitForTimeout(80);

  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  const pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the degree-2 radicand', pending.drilled && pending.drilled.part === 'sqrt');

  ok('"Condition d\'existence" stays DISABLED for a degree-2 radicand (no signstudy left to solve it)',
    !(await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition)));

  const existenceRow = await page.evaluate(() => document.querySelector('button[data-op="existence"]').closest('.op-row'));
  ok('the "Condition d\'existence" row itself is still present in the DOM (not the whole button removed)',
    existenceRow !== null);

  // Clicking it anyway (e.g. a stale/forced click) must be a strict no-op: no column
  // spawned, nothing thrown.
  await page.evaluate(() => window.App.History.existenceConditionAction());
  await page.waitForTimeout(80);
  const conditions = await page.evaluate(() => window.App.History.getDomainConditions());
  ok('existenceConditionAction() is a no-op for a degree-2 radicand (no column spawned)', conditions === null);

  // The old "signstudy" op/UI no longer exists at all.
  const signstudyBtn = await page.$('button[data-op="signstudy"]');
  ok('the "Étude de signe" button no longer exists in the DOM', signstudyBtn === null);
  const apiGone = await page.evaluate(() => ({
    canSignStudy: typeof window.App.History.canSignStudy,
    chooseSignStudySign: typeof window.App.History.chooseSignStudySign,
    chooseSignStudyInterval: typeof window.App.History.chooseSignStudyInterval,
    getSignStudyResult: typeof window.App.History.getSignStudyResult,
    ineqSignStudyChoice: typeof window.App.Ineq.signStudyChoice,
    ineqIntervalLatex: typeof window.App.Ineq.intervalLatex
  }));
  console.log('removed API surface (all should be "undefined"):', JSON.stringify(apiGone));
  ok('the whole signstudy API surface is gone', Object.keys(apiGone).every((k) => apiGone[k] === 'undefined'));

  // Regression: a LINEAR radicand must still work exactly as before (only degree >= 2 is
  // excluded).
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.toggleTermSelection('left', 0);
  });
  await page.waitForTimeout(80);
  ok('regression: "Condition d\'existence" is still available for a LINEAR radicand',
    await page.evaluate(() => window.App.Toolbar.computeSelectionInfo().canExistenceCondition));

  // Regression: the degree-2 equation is still solvable directly by squaring both sides.
  await page.evaluate(() => {
    window.App.History.startNewEquation({
      left: [{ sign: 1, radicand: [{ coeff: 1, pow: 2 }, { coeff: -9, pow: 0 }] }],
      right: [{ coeff: 3, pow: 0 }]
    });
  });
  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(100);
  await page.click('[data-key="square"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const squared = await page.evaluate(() => window.App.History.lastEquation());
  console.log('degree-2 sqrt equation squared directly:', JSON.stringify(squared));
  ok('regression: "√(x²-9)=3" still solves normally via "(‥)²" (x²-9=9)',
    JSON.stringify(squared) === JSON.stringify({ left: [{ coeff: 1, pow: 2 }, { coeff: -9, pow: 0 }], right: [{ coeff: 9, pow: 0 }] }));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
