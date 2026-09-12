const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Confirmer une action qui valide une nouvelle étape doit faire glisser l'encadré bleu
// "current" (voir .eq-row.current .eq-line dans style.css) de l'ancienne ligne vers la
// nouvelle avec un fondu (voir fadeNewStep dans renderChain, js/render.js), pas par un saut
// instantané — #history est entièrement reconstruit à chaque rendu (voir renderAll), donc
// sans ce correctif la classe "current" est posée/retirée directement dans son état final,
// dès la création des lignes, sans jamais déclencher la transition CSS déjà déclarée sur
// .eq-line.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // Première étape : rien à faire glisser (pas de ligne "current" précédente), juste un
  // fondu d'apparition sur la toute première ligne encadrée.
  await page.evaluate(() => {
    var H = window.App.History;
    H.startNewEquation(window.App.Parser.parseEquation('2x+3=11'));
  });
  await page.waitForTimeout(100);

  const afterFirst = await page.evaluate(() => {
    var row = document.querySelector('#history > .eq-row.current');
    return { hasCurrent: !!row };
  });
  ok('the sole confirmed equation is framed as "current"', afterFirst.hasCurrent);

  // Deuxième étape (réellement validée, pas juste une sélection/un survol) : maintenant une
  // vraie ancienne ligne "current" existe et doit céder sa place à la nouvelle avec un fondu.
  // Échantillonne le background-color RÉEL (calculé) des deux lignes concernées à deux
  // instants rapprochés après la confirmation : si le fondu se joue vraiment (transition de
  // 0.2s déclarée sur .eq-line), les deux échantillons diffèrent (encore en cours de
  // transition au premier, presque arrivé au second) ; un simple saut instantané donnerait
  // au contraire deux échantillons IDENTIQUES (déjà à l'état final dès le premier).
  const samples = await page.evaluate(() => {
    return new Promise((resolve) => {
      var H = window.App.History;
      H.selectOp('expr');
      H.setExprChainText('-3');
      H.confirm();

      function bg(row) { return getComputedStyle(row.querySelector('.eq-line')).backgroundColor; }

      var rows0 = Array.from(document.querySelectorAll('#history > .eq-row'));
      var newCurrent = rows0.find((r) => r.classList.contains('current'));
      var prevRow = rows0[rows0.length - 2];
      var early = { newBg: bg(newCurrent), prevBg: bg(prevRow), prevHasCurrent: prevRow.classList.contains('current') };

      setTimeout(() => {
        var late = { newBg: bg(newCurrent), prevBg: bg(prevRow) };
        setTimeout(() => {
          var final = { newBg: bg(newCurrent), prevBg: bg(prevRow) };
          resolve({ early, late, final });
        }, 300);
      }, 260);
    });
  });
  console.log(JSON.stringify(samples));
  ok('the old row\'s final class state is already correct (no "current") despite the transient flip', samples.early.prevHasCurrent === false);
  ok('the new "current" row is still fading in shortly after confirming (mid-transition, not already final)',
    samples.early.newBg !== samples.final.newBg);
  ok('the old "current" row is still fading out shortly after confirming (mid-transition, not already final)',
    samples.early.prevBg !== samples.final.prevBg);
  ok('the new row has settled on its final highlighted background once the transition ends',
    samples.late.newBg === samples.final.newBg);
  ok('the old row has settled back to its final plain background once the transition ends',
    samples.late.prevBg === samples.final.prevBg);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
