# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## AI Rules / Agent Constraints (CRITICAL)

- **No autonomous tests:** Never create exploratory test files outside the `tests/` directory. Do not write Node.js scripts in the root directory to verify your code. If you must write a test, add it exclusively to the existing Playwright suite.
- **Targeted execution:** Never run the full test suite with `./run.sh` to save tokens. If you modify a feature, run ONLY the targeted test with `node tests/<test_name>.js`.
- **No persistent logs:** Always remove your debugging `console.log` statements before committing final code to avoid bloating the session context.
- **Optimized file reading:** NEVER use the file reading tool without specifying the `offset` and `limit` parameters for files over 200 lines. Never load an entire file into memory if you only need to inspect a specific function. Use search tools (grep) beforehand to target the specific lines to read.
- **Git and Commits Management:** Systematically use Git. Before modifying code, run `git status` or `git diff` to understand the current state. After each completed feature or fix validated by a Playwright test, run `git add` and `git commit` on your own initiative. Make atomic commits (one logical change = one commit) and use standard conventions (e.g., `feat:`, `fix:`, `refactor:`). Never run `git push`.

## What this is

A French-language, offline-first educational web app for visually solving first-degree
(and now some second-degree) equations. Runs by double-clicking `index.html` directly
(`file://`, no server). No build step, no bundler, no package manager — just classic
`<script>` tags loaded in dependency order and vanilla ES5-style JS wrapped
in `(function (App) { ... })(window.App = window.App || {});` IIFEs.

## Running / developing

- Open `index.html` directly in a browser (or `xdg-open index.html`). That's it — no
  install, no dev server, no build.
- KaTeX is vendored locally under `vendor/katex/`, and MathLive under `vendor/mathlive/`
  (no CDN dependency for either — this must stay true; do not introduce network calls or
  CDN `<script>`/`<link>` tags). MathLive backs the unified math keypad; KaTeX
  remains the display renderer for confirmed equation steps/arrows, untouched by that work.
- Script load order in `index.html` matters and mirrors the dependency graph: `expression.js`
  → `equation.js` → `parser.js` → `generator.js` → `history.js` → `canvas.js` → `zoom.js` →
  `render.js` → `arrows.js` → `toolbar.js` → `mathKeypad.js` → `keyboard.js` →
  `newEquationModal.js` → `theme.js` → `main.js`.
- No lint/build commands exist for this project. A regression test suite does exist (see
  below) — run the targeted test after any change to `js/*.js`.

## Regression tests (`tests/`)

A Playwright suite lives in `tests/` (its own `package.json`, isolated from the app).
See `tests/README.md` for setup instructions and authoring conventions.
In short: assert on `window.App.*` state and `data-*` attributes rather than rendered text/CSS classes.
Each `.js` file is independently runnable (`node tests/<name>.js`) for faster iteration.

## Core data model (`js/expression.js`)

Equations are `{ left: Side, right: Side }`. A `Side` is `Array<Node>`. A `Node` is one of:

- `Term = { coeff: number, pow: number }` — a monomial (`pow` 0 = constant, 1 = `x`, 2 = `x²`, ... — **not capped**).
- `FactorGroup = { sign: 1|-1, factor: Term, innerTerms: Node[], isDivision?: boolean, factorTerms?: Node[] }` —
  represents `factor·(innerTerms)`, or `(innerTerms)/factor` when `isDivision` is set. When
  the divisor is an expression rather than a number (only ever produced by "÷" in the
  Opération chain, e.g. `÷(x+5)`), `factorTerms` (a `Side`) replaces `factor` entirely — see
  `Expr.isExpressionQuotient`/`wrapSideInQuotient`. Such a quotient is excluded from
  "Développer" as a whole, but both its numerator and its expression-denominator remain
  independently drillable/simplifiable/factorable/expandable (`pending.drilled.part ===
  'den'` for the denominator, mirroring `pending.drilled.branch` for a ProductGroup factor —
  see `Expr.drilledWorkingArray`/`withDrilledArrayAtPath`).
- `ProductGroup = { sign: 1|-1, factors: Array<{ terms: Node[], exponent: number }> }` —
  represents a product of N factors, e.g. `(x+2)(x+3)` is 2 factors of exponent 1 each;
  `(x+3)²` is a SINGLE factor of exponent 2.
- `SqrtGroup = { radicand: Node[] }` — represents `√(radicand)`. Produced only by "Racine
  carrée" wrapping an ENTIRE side at once (`Expr.wrapSideInSqrt`), never by manual
  `\sqrt{...}` input (which still folds to a plain number, see `foldSqrt`/parser.js,
  unchanged). "Racine carrée" is two steps with two different triggers: step 1 (the √ key
  in the Opération pad, armed then validated) wraps both full sides in `√(...)` as a normal
  chain step, no branching yet (see `detectSquareRootUnwrapped`/`confirmSquareRoot` in
  `history.js`). Step 2 — once each side's radicand is recognizably `(expr)²` vs. a bare
  constant (see `detectSquareRootWrapped`) — is the regular "Simplifier" button instead
  (deliberately NOT a second arming of the same √ key, which tested as confusing): it
  cancels the √+square and computes the numeric root, splitting into the usual ± branches,
  with no selection needed (`App.History.squareRootStage() === 'simplify'` alone drives
  `computeSelectionInfo().canSimplify`, see `toolbar.js`). No `sign` field (always positive,
  see `Expr.nodeSign`). Drillable exactly once (`pending.drilled.part === 'sqrt'`,
  mirroring the `'den'` quotient-denominator case above) to freely simplify/factor/expand
  the radicand before resolving it.

`Expr.isGroup(node)` is `isFactorGroup || isProductGroup || isSqrtGroup`; group nodes can't be
directly simplified/factored (must be expanded first). All mutating operations on a `Side`
live in `expression.js` and return new arrays (never mutate in place — always clone via `cloneNode`/`cloneSide`).

## History engine (`js/history.js`)

`createEngine()` is a factory producing a self-contained solving engine: `steps[]`
(confirmed equation history) + `pending` (in-progress state) + all mutating methods. Multiple independent engines can exist at once.

`App.History` is a thin orchestrator around one `primary` engine. When the equation is
`(...)( ...)...=0`, selecting the product and clicking "Produit nul" (`confirmProduitNul`)
spawns one independent child engine per DISTINCT factor (`branches`, a plain array,
index-based), rendered side by side and each fully solvable on its own. `App.History.focusBranch(index)`
is called right before delegating a term click to a branch engine.

`pending.opType` is `'expr' | 'factor' | null`. Simplify/Factoriser-selection/Développer/Produit nul are **not** persistent modes — they act immediately directly from free term selection.

## Rendering (`js/render.js`, `js/arrows.js`)

Each equation row is rendered as one KaTeX call per side (`\htmlId{...}` per top-level
node, `trust:true` required for that), so individual terms/groups become clickable via
their DOM ids.

Arrows between steps are hand-drawn SVG in `arrows.js`, positioned via `getBoundingClientRect()` math after
each render (`requestAnimationFrame`). Overlay cleanup is scoped to `:scope > svg.arrows-overlay` (never a global id).

Term drag-and-drop is mouse-only (no native HTML5 DnD) and shares its pointer gesture with click-to-select. It is intentionally disabled inside "Produit nul" branch columns (`noDrag`).

## Infinite canvas (`js/canvas.js`)

`#historyScroll` is a fixed-size `overflow:hidden` viewport — it never scrolls natively.
Its single persistent child `#canvasLayer` (wrapping `#history`, `#opButtons`, and
`#liveOpPill`, see `mathKeypad.js`) is moved via CSS `transform: translate()`, driven by
`App.Canvas`, an unbounded `{x, y}` offset (deliberately API-compatible with
`scrollLeft`/`scrollTop`/`scrollTo`, same sign convention, so `render.js`/`arrows.js`/
`toolbar.js` reason about it exactly as they used to reason about native scroll — just
never clamped to `[0, scrollWidth - clientWidth]` the way a real scroll container is).
Background click-and-drag and wheel/trackpad panning (`initCanvasPan` in `main.js`) both
go through this offset. `App.Canvas.scrollTo({..., behavior:'smooth'})` animates via a
real CSS transition (`.canvas-panning-animated`) rather than a hand-rolled
`requestAnimationFrame` loop — rAF on the main thread can be throttled (backgrounded tab,
headless Chromium) independently of wall-clock time, which desynchronizes a JS-driven
animation's real duration from its programmed one; a CSS transition is compositor-timed
and doesn't have this problem. Because the transition updates `App.Canvas`'s internal
target immediately while the *paint* catches up over ~80ms, `getX()`/`getY()` read the
live computed transform (not the stored target) while a transition is in flight — reading
the target early would desync any calculation done mid-transition (e.g. the next render's
centering math) from what's actually on screen, the same way native `scrollLeft` never
would have. `renderAll()` (`render.js`) also force-resets `#historyScroll`'s *native*
`scrollTop`/`scrollLeft` to 0 after every rebuild: the browser still clamps that real
(otherwise-unused) property to a container's valid range as content is torn down and
rebuilt, and that clamped value is silently subtracted from descendants'
`getBoundingClientRect()` regardless of `overflow-anchor`.

`App.Canvas` also carries the zoom level (`getScale`/`zoomAt`, clamped to `[0.4, 2.5]`),
applied as `transform: scale(...) translate(...)` on `#canvasLayer` (scale first, so a
screen-space delta between two points inside `#canvasLayer` equals `scale` times the
equivalent *local* delta). `App.Zoom` (`js/zoom.js`) drives it from the two floating
magnifying-glass buttons (`#zoomInBtn`/`#zoomOutBtn`, centered on the viewport, animated)
and from Ctrl+wheel (`initCanvasPan` in `main.js`, centered on the cursor, instant — see
`wheelZoom`). Because `getBoundingClientRect()` is always real screen space regardless of
this scale, any code that turns a rect-derived screen delta into a *local* pixel value
(`style.left`/`top` on a descendant of `#canvasLayer`, or an SVG path's `d`) must divide
that delta by `App.Canvas.getScale()` first — see the geometry helpers in `arrows.js`
(`computeSideGeometry`/`drawFork`), the recentring math in `render.js`'s `renderAll`, and
`positionPanel` in `toolbar.js` for the pattern. `offsetWidth`/`offsetHeight` are
unaffected by this transform (it only changes paint, not layout), so comparisons against
them (e.g. `render.js`'s `isWideSplit`) instead divide the *screen*-space threshold
(`scroller.clientWidth`) by the scale to bring it into the same local space.

## Manual input parsing (`js/parser.js`)

A regex-based tokenizer (no formal grammar): `parseSide`/`parseEquation` accept `,` or `.`
as decimal separator, `\frac{a}{b}` for fractions, `x^2`/`x²` for degree-2 terms,
and a `while` loop over consecutive `(...)` groups for products of arbitrary factor count.
`parseLatexSide`/`parseLatexEquation` are the entry points for the unified math keypad, normalizing LaTeX into this dialect.

## Unified math keypad (`js/mathKeypad.js`)

A GeoGebra/Desmos-style math input backed by MathLive.
- Always use `App.MathKeypad` to interface with the math field.
- Never destroy or recreate the main `<math-field>` element (to avoid losing focus/cursor).
- Physical keys and UI buttons share the same underlying logic. Read/write the field's content directly via `getLatex`/`setLatex`.

## Theming

CSS custom properties on `:root`, redefined for dark mode both via `@media (prefers-color-scheme: dark)` and via `:root[data-theme="dark"]`. `js/theme.js` persists the explicit choice to `localStorage` and applies it synchronously.

## Constraints to preserve

- **Desktop only.** Mobile/responsive support was explicitly removed — don't reintroduce it.
- **No external network dependencies.** Everything must keep working from a local `file://` open with no internet access. Never call anything that needs the MathLive compute-engine.
- **No build step.** Keep using plain `<script>` tags and ES5-compatible syntax consistent with the rest of the codebase.
