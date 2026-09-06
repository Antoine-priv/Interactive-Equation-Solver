const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bug rapporté par l'utilisateur (capture d'écran) : une ligne d'équation trop longue
// même à la police minimale (MIN_EQ_FONT_PX, voir autoFitRowFont dans render.js) se
// rabat sur le défilement horizontal natif (.eq-row { overflow-x: auto }) — mais avec le
// centrage flex par défaut (justify-content:center), le contenu déborde symétriquement
// des DEUX côtés, et Chromium ne peut défiler QUE vers la droite (débordement négatif/
// gauche non atteignable) : sans correctif, la ligne s'affiche par défaut dans sa
// position centrée déjà rognée, le DÉBUT de l'équation étant invisible ET impossible à
// faire apparaître en défilant. autoFitRowFont bascule maintenant la ligne en
// justify-content:flex-start dès qu'elle reste trop large, pour que scrollLeft=0 (son
// état initial) corresponde bien au DÉBUT du contenu, entièrement défilable vers la
// droite jusqu'à la fin.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  await page.evaluate(() => {
    var H = window.App.History;
    H.startNewEquation(window.App.Parser.parseEquation('(x^2-12x+36)(x-4)=0'));
    H.selectOp('expr');
    H.setExprChainText('\\times((x+1)(x+2))');
    H.confirm();
  });
  await page.waitForTimeout(200);

  const rows = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('#history > .eq-row')).map((r) => ({
      fontSize: r.querySelector('.eq-line').style.fontSize,
      justifyContent: getComputedStyle(r).justifyContent,
      scrollLeft: r.scrollLeft,
      overflowing: r.scrollWidth > r.clientWidth
    }));
  });
  console.log(JSON.stringify(rows, null, 2));

  // "Repro condition" = la police a été ramenée au plancher MIN_EQ_FONT_PX (18px) : c'est
  // le seul cas où autoFitRowFont bascule en flex-start (voir render.js) — une ligne dont
  // la police n'est PAS au plancher peut légèrement déborder par la marge de sécurité de
  // 0.96 sans jamais déclencher ce correctif, ce n'est pas le cas testé ici.
  const overflowingRow = rows.find((r) => r.fontSize === '18px');
  ok('at least one row is forced to the minimum font and still overflows (repro condition met)',
    !!overflowingRow && overflowingRow.overflowing);
  ok('an overflowing row switches to flex-start (not the default centered overflow)',
    overflowingRow.justifyContent === 'flex-start');
  ok('an overflowing row starts flush left (scrollLeft 0 = the actual start of the content)',
    overflowingRow.scrollLeft === 0);

  const nonOverflowingRow = rows.find((r) => r.fontSize !== '18px');
  ok('a row that fits keeps the normal centered layout', !nonOverflowingRow || nonOverflowingRow.justifyContent === 'center');

  // Visually confirm: .eq-line's own box (the actual equation content, its 26px padding
  // is INSIDE this box) starts right at .eq-row's own left edge — .eq-row has no padding
  // of its own, so with flex-start they must coincide. Before the fix, the default
  // centered-overflow layout pushed .eq-line's box start well to the LEFT of the row's
  // (negative, off-screen), clipping the opening parenthesis away with no way to scroll
  // back to it.
  const lineFlush = await page.evaluate(() => {
    var rows = Array.from(document.querySelectorAll('#history > .eq-row'));
    var overflowing = rows.find((r) => r.querySelector('.eq-line').style.fontSize === '18px');
    if (!overflowing) return null;
    var rowRect = overflowing.getBoundingClientRect();
    var lineRect = overflowing.querySelector('.eq-line').getBoundingClientRect();
    return { rowLeft: rowRect.left, lineLeft: lineRect.left };
  });
  console.log('eq-line flush-left check:', JSON.stringify(lineFlush));
  ok('.eq-line\'s box starts at the row\'s left edge, the opening parenthesis is not clipped',
    lineFlush && Math.abs(lineFlush.lineLeft - lineFlush.rowLeft) < 2);

  await page.screenshot({ path: `${SCRATCH}/eq_row_overflow_flush_left.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
