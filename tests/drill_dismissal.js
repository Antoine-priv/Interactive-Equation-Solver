const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function drillIntoFactoredGroup(page) {
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, '3x+21=0');
  await page.waitForTimeout(80);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(80);
  await page.click('button.factor-choice-btn[data-factor-choice="common"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="3"]');
  await page.waitForTimeout(80);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);
  const term = await page.$('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  const box = await term.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);

  // 1) Right-click ANYWHERE on the page (far from the parens) exits one level, no
  // residual yellow selection.
  await drillIntoFactoredGroup(page);
  let pending = await page.evaluate(() => window.App.History.getPending());
  ok('drilled into the group', !!pending.drilled);
  await page.mouse.click(900, 700, { button: 'right' });
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('right-click far away exits drill mode', pending.drilled === null);
  ok('right-click exit leaves NO term selected (no stale yellow highlight)',
    pending.selectedLeft.length === 0 && pending.selectedRight.length === 0);

  // 2) Left-click on truly blank space fully cancels (like Escape), clearing everything.
  await drillIntoFactoredGroup(page);
  await page.evaluate(() => { window.App.History.toggleInnerSelection(0); }); // select something inside too
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('an inner term is selected before the outside click', pending.selectedInner.length === 1);
  await page.mouse.click(900, 700, { button: 'left' });
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('left-click on blank space fully cancels (drilled null)', pending.drilled === null);
  ok('left-click on blank space clears inner selection too', pending.selectedInner.length === 0);
  ok('left-click on blank space leaves no top-level selection either',
    pending.selectedLeft.length === 0 && pending.selectedRight.length === 0);

  // 3) Clicking the parenthesis itself (not a specific inner term) still exits, and also
  // no longer leaves a stale selection (this used to select the exited group in yellow).
  await drillIntoFactoredGroup(page);
  const exitEl = await page.$('.drilled-exit');
  ok('.drilled-exit element exists while drilled', !!exitEl);
  // Click near the right edge of the parenthesis element, away from any inner term span.
  const exitBox = await exitEl.boundingBox();
  await page.mouse.click(exitBox.x + exitBox.width - 3, exitBox.y + exitBox.height / 2);
  await page.waitForTimeout(80);
  pending = await page.evaluate(() => window.App.History.getPending());
  ok('clicking the parenthesis itself still exits drill mode', pending.drilled === null);
  ok('clicking the parenthesis itself leaves no stale selection', pending.selectedLeft.length === 0);

  // 4) Hovering the parenthesis background (not an inner term) no longer changes its
  // background color. The drilled parenthesis has NO background at all anymore (neither
  // at rest nor on hover, per explicit request) — it's not itself "selectable" like a
  // term, only its inner terms are, and a background would wrongly suggest otherwise.
  await drillIntoFactoredGroup(page);
  const exitEl2 = await page.$('.drilled-exit');
  const bgBefore = await exitEl2.evaluate((el) => getComputedStyle(el).backgroundColor);
  const exitBox2 = await exitEl2.boundingBox();
  await page.mouse.move(exitBox2.x + exitBox2.width - 3, exitBox2.y + exitBox2.height / 2);
  await page.waitForTimeout(80);
  const bgAfterHover = await exitEl2.evaluate((el) => getComputedStyle(el).backgroundColor);
  ok('parenthesis background does NOT change on hover', bgBefore === bgAfterHover);
  ok('parenthesis has NO background at rest (transparent)', bgBefore === 'rgba(0, 0, 0, 0)' || bgBefore === 'transparent');

  // 5) Right-click while the "+" modal is open must NOT be hijacked (native menu allowed,
  // no exitDrill/preventDefault interference) even if a drill happens to still be active
  // underneath.
  await drillIntoFactoredGroup(page);
  await page.click('#newEquationBtn'); // opens the modal on top of the still-drilled state
  const prevented = await page.evaluate(() => {
    return new Promise((resolve) => {
      var input = document.querySelector('#manualInputSlot math-field');
      input.addEventListener('contextmenu', function (e) { resolve(e.defaultPrevented); }, { once: true });
      var evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      input.dispatchEvent(evt);
    });
  });
  ok('right-click inside the open modal is never intercepted (defaultPrevented stays false)', prevented === false);

  await page.screenshot({ path: `${SCRATCH}/drill_dismissal_final.png` });

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
