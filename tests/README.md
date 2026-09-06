# Regression tests

*(Note: All previous test scripts have been removed. The Playwright infrastructure and `run.sh` script remain intact and ready for new tests to be written.)*

Playwright scripts that drive `index.html` in a real headless browser and assert on app
state (`window.App.History`/`Pending`/etc.) and rendered DOM. Completely separate from the
app itself — the app still has no build step, no bundler, no dependencies of its own;
this `tests/` folder is the only place with a `package.json`.

## Setup (one-time)

```sh
cd tests
npm install
npx playwright install chromium   # only if this errors with "Executable doesn't exist"
```

## Running

```sh
cd tests
./run.sh
```

Currently, since the directory is empty of `.js` test scripts, this will simply exit with success. Once tests are added, it prints `ALL REGRESSION SCRIPTS OK` and exits 0 if every script passes. On failure it prints the failing script's name and the tail of its output, and exits 1.

Each script will also be runnable on its own for faster iteration while debugging one feature:

```sh
cd tests
node my_new_test.js  # Replace with the actual filename once created
```

Screenshots each script takes land in `tests/screenshots/` (gitignored, wiped at the start
of every `run.sh` so it never accumulates stale files from removed/renamed screenshots).

To seed a starting equation, don't drive the "Nouvelle équation" modal's UI — call the
engine directly and skip the modal/keypad entirely:

```js
await page.evaluate((eq) => {
  window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
}, '3x+2=11');
```

This is faster and more robust than typing through a UI whose only purpose here is setup,
not the thing under test. If a script instead specifically tests the modal, "Opération", or
"Factoriser"/identité remarquable — every on-screen keypad now shares the same underlying
`<math-field>` + docked button grid (`js/mathKeypad.js`) — drive it by clicking into the
right mode first (`#newEquationBtn`, `button[data-op="expr"]`, or
`button[data-op="factor"]` → a `.factor-choice-btn`), then type through
`[data-key="..."]` (every key carries a stable `data-key`, e.g. `"x"`, `"7"`, `"plus"`,
`"minus"`, `"times"`, `"div"`, `"sqrt"`, `"("`, `")"`, `"enter"` — never target a key by its
rendered label/title) or `page.keyboard.type(...)`/`page.keyboard.press('Tab'|'Enter')` for
native physical-keyboard editing, then `[data-key="enter"]` to confirm (the emphasized "↵"
key — there is no separate "Valider" button anywhere anymore). For "Factoriser"'s identité
a/b fields specifically, only the NON-focused one is a plain clickable button
(`.identity-ab-static`, showing its committed value); the focused one holds the live field,
switch focus by clicking the other one or via `App.History.setIdentityFocus('a'|'b')`. Read/
write the live field's content directly via
`window.App.MathKeypad.getLatex()`/`setLatex()`. Physical keys dispatched right after a
mode switch or focus change may need a short `page.waitForTimeout(100-150)` first — MathLive
needs a brief moment to settle focus after being re-parented before it reliably picks up
native keyboard events (clicking a `[data-key="..."]` button doesn't have this issue, since
it explicitly re-focuses the field itself before inserting).

A product of 3+ factors (e.g. `(x+2)(x+3)(x+4)=0`) can be typed/parsed directly —
`parseEquation`/`parseSide` accept a chain of any length, so there's no need to hand-build
a nested `ProductGroup` fixture the way `fork_layout.js`/`sqrt_and_nfactor.js` used to
before the N-ary migration. See the "Core data model" section of `../CLAUDE.md` for the
current `ProductGroup = { sign, factors: [{terms, exponent}] }` shape before asserting on
one directly (it's `factors[i].terms`/`.exponent`, not the old `.left`/`.right`/`.isSquare`).

## Writing a new script

Follow the existing convention: a self-contained `.js` file, one `chromium.launch()`,
assertions via the local `ok(label, cond)` helper (prints `OK`/`FAIL` per line and sets
`process.exitCode = 1` on any failure — `run.sh` picks that up), and a final dump of
`page.on('pageerror'/'console')` collected messages so a JS exception anywhere fails the
script too. Target `data-*` attributes and `window.App.*` state over text content or CSS
classes where possible — text-content selectors (button labels, tooltips) and copies of
rendered LaTeX are exactly what broke silently across earlier UI iterations (see git
history around this file's introduction). Name the file after the feature it guards, not
the debugging session that produced it.
