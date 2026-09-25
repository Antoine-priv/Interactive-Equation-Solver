const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

// Solutions de référence de la campagne (voir js/levels.js, docs/gamification/plan.md) :
// chaque niveau est résolu pas à pas avec l'API de l'app, en vérifiant que la campagne le
// déclare réussi, et le nombre d'étapes (hors "Simplifier", voir Campaign.stepCount) est
// comparé au seuil ★★★ (`par`) du catalogue.
//   node tests/campaign_reference.js           -> tous les niveaux
//   node tests/campaign_reference.js port mont -> seulement ces régions
// "Toujours simplifier" est activé : les simplifications ne comptent de toute façon pas.

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// Bibliothèque injectée dans la page : petits gestes de résolution.
function installHelpers() {
  var A = null;
  function H() { A = window.App; return A.History; }
  var R = {
    op: function (chain) { var h = H(); h.selectOp('expr'); h.setExprChainText(chain); h.confirm(); R.check(); },
    sel: function (side, idxs) { idxs.forEach(function (i) { H().toggleTermSelection(side, i); }); },
    simp: function (side, idxs) { R.sel(side, idxs); H().confirmSimplifySelection(); R.check(); },
    // Simplifie tout ce qui peut l'être (ne compte pas comme une étape).
    tidy: function () {
      for (var pass = 0; pass < 4; pass++) {
        var changed = false;
        ['left', 'right'].forEach(function (side) {
          var arr = H().lastEquation()[side];
          var idxs = arr.map(function (_, i) { return i; });
          if (!A.Expr.simplifySelection(arr, idxs)) return;
          R.sel(side, idxs);
          H().confirmSimplifySelection();
          changed = true;
        });
        if (!changed) break;
      }
      H().cancelOp();
    },
    expandAll: function () {
      var h = H(), eq = h.lastEquation();
      ['left', 'right'].forEach(function (side) {
        eq[side].forEach(function (n, i) {
          if (A.Expr.isGroup(n) && !A.Expr.isExpressionQuotient(n) && !A.Expr.isSqrtGroup(n)) h.toggleTermSelection(side, i);
        });
      });
      h.confirmExpandFullSelection();
      R.check();
      R.tidy();
    },
    factorCommon: function (side, idxs, latex) {
      var h = H(); R.sel(side, idxs); h.enterFactorWithSelection(); h.chooseFactorMode('common');
      h.setFactorTermLatex(latex); h.confirm(); R.check();
    },
    identity: function (side, idxs, mode, a, b) {
      var h = H(); R.sel(side, idxs); h.enterFactorWithSelection(); R.identityTail(mode, a, b);
    },
    identityTail: function (mode, a, b) {
      var h = H(); h.chooseFactorMode(mode);
      h.setIdentityFieldLatex(a); h.setIdentityFocus('b'); h.setIdentityFieldLatex(b); h.confirm(); R.check();
    },
    // Dans un groupe "entré" : sélection des termes intérieurs.
    innerIdentity: function (idxs, mode, a, b) {
      var h = H(); idxs.forEach(function (i) { h.toggleInnerSelection(i); }); h.enterFactorWithSelection(); R.identityTail(mode, a, b);
    },
    innerCommon: function (idxs, latex) {
      var h = H(); idxs.forEach(function (i) { h.toggleInnerSelection(i); }); h.enterFactorWithSelection();
      h.chooseFactorMode('common'); h.setFactorTermLatex(latex); h.confirm(); R.check();
    },
    innerTidy: function () {
      var h = H(), p = h.getPending();
      if (!p.drilled) return;
      var node = A.Expr.nodeAtPath(h.lastEquation()[p.drilled.side], p.drilled.path);
      var arr = A.Expr.drilledWorkingArray(node, p.drilled);
      arr.forEach(function (_, i) { h.toggleInnerSelection(i); });
      h.confirmSimplifySelection();
    },
    // Double-clic : dans un groupe, un dénominateur, une racine, une parenthèse d'un produit.
    drill: function (side, i) { H().toggleTermSelection(side, i); H().toggleTermSelection(side, i); },
    drillDen: function (side, i) { H().toggleTermSelection(side, i, null, true); H().toggleTermSelection(side, i, null, true); },
    drillBranch: function (side, i, b) { H().drillIntoProductBranch(side, i, b); },
    exit: function () { H().exitDrill(); H().cancelOp(); },
    existence: function () { H().existenceConditionAction(); R.check(); },
    inDomain: function (i, fn) { H().setFocusedDomain(i); fn(); H().focusMain(); },
    pn: function () { H().confirmProduitNul(); R.check(); },
    // Colonne "Produit nul" (chemin d'index dans l'arbre des scissions).
    branch: function (path, fn) {
      var node = H();
      path.forEach(function (i) { node.focusBranch(i); node = node.getBranches()[i]; });
      fn();
    },
    eachBranch: function (fn) {
      var br = H().getBranches();
      br.forEach(function (_, i) { R.branch([i], fn); });
    },
    square: function () { H().confirmSquareBothSides(); R.check(); R.tidy(); },
    // Racine carrée, étape 1 (touche √ du pavé), puis étape 2 (sélection des deux côtés
    // et « Simplifier »).
    sqrt1: function () { H().cancelOp(); H().confirmSquareRoot(); R.check(); },
    sqrt2: function () {
      var h = H(), eq = h.lastEquation();
      h.cancelOp();
      // "Toujours simplifier" a pu calculer la racine du nombre dès l'étape 1 : seul le
      // côté encore sous √ reste alors à sélectionner.
      ['left', 'right'].forEach(function (side) {
        if (eq[side].length === 1 && A.Expr.isSqrtGroup(eq[side][0])) R.sel(side, [0]);
      });
      h.confirmSquareRoot(); R.check();
    },
    // Résout une équation/inéquation du 1er degré dans la colonne active : x à gauche,
    // constantes à droite, puis division.
    linear: function () {
      R.tidy();
      for (var guard = 0; guard < 6; guard++) {
        var eq = H().lastEquation();
        if (A.Equation.isSolved(eq) || (A.Equation.isConstantSide(eq.left) && A.Equation.isConstantSide(eq.right))) return;
        var rx = eq.right.filter(function (t) { return !A.Expr.isGroup(t) && t.pow === 1; })[0];
        var lc = eq.left.filter(function (t) { return !A.Expr.isGroup(t) && t.pow === 0; })[0];
        var lx = eq.left.filter(function (t) { return !A.Expr.isGroup(t) && t.pow === 1; })[0];
        if (rx) R.op((rx.coeff < 0 ? '+' + R.num(-rx.coeff) : '-' + R.num(rx.coeff)) + 'x');
        else if (lc && lx) R.op(lc.coeff < 0 ? '+' + R.num(-lc.coeff) : '-' + R.num(lc.coeff));
        else if (!lx) {
          // x seulement à droite (ex. "11 = 3x") : on passe tout à gauche.
          var rxx = eq.right.filter(function (t) { return t.pow === 1; })[0];
          if (!rxx) return;
          R.op('-' + R.num(rxx.coeff) + 'x');
        } else if (Math.abs(lx.coeff - 1) > 1e-9) R.op('\\div' + R.num(lx.coeff));
        R.tidy();
      }
    },
    num: function (v) { return String(Math.round(v * 1e9) / 1e9); },
    // Tableau de signes : pose, résout chaque facteur, remplit la rangée "Expression
    // totale" en essayant chaque valeur (signChartCellCorrect), puis "Vérifier".
    signChart: function () {
      var h = H();
      h.signChartAction(); R.check();
      h.getSignChart().factors.forEach(function (f, i) {
        if (f.constant) return;
        h.setFocusedSignChartFactor(i);
        if (f.sqrt) h.confirmSquareBothSides();
        R.linear();
      });
      h.focusMain();
      h.signChartAddRow({ rowKind: 'total' });
      var sc = h.getSignChart(), ri = sc.tableRows.length - 1, cols = h.getSignChartColumns();
      cols.forEach(function (col, ci) {
        var cands = col.type === 'boundary' ? ['0', 'undef'] : ['+', '-', 'undef'];
        for (var k = 0; k < cands.length; k++) {
          if (!h.signChartSetCell(ri, ci, cands[k])) continue;
          if (h.signChartCellCorrect(ri, ci)) break;
        }
      });
      h.signChartVerify();
    },
    errors: [],
    check: function () { var e = H().getPending().error; if (e) R.errors.push(e); }
  };
  window.R = R;
}

// ---- Scripts de résolution (exécutés dans la page, R disponible) ----
const S = {
  t1: () => { R.op('-3'); },
  t2: () => { R.op('+5'); },
  t3: () => { R.op('\\div3'); },
  t4: () => { R.op('-8'); },
  t5: () => { R.op('-5'); R.op('\\div2'); },
  t6: () => { R.tidy(); R.linear(); },
  t7: () => { R.linear(); },
  l1: () => { R.linear(); },
  l2: () => { R.linear(); },
  l3: () => { R.expandAll(); R.linear(); },
  l4: () => { R.expandAll(); R.linear(); },
  l5: () => { R.op('-2x'); },
  lB: () => { R.expandAll(); R.linear(); },
  f1: () => { R.op('-1'); R.op('\\times3'); R.tidy(); },
  f2: () => { R.op('\\times5'); R.tidy(); R.linear(); },
  f3: () => { R.op('\\times6'); R.expandAll(); R.linear(); },
  i1: () => { R.linear(); },
  i2: () => { R.linear(); },
  i3: () => { R.linear(); },
  iB: () => { R.expandAll(); R.linear(); },
  p1: () => { R.pn(); R.eachBranch(R.linear); },
  p2: () => { R.pn(); R.eachBranch(R.linear); },
  p3: () => { R.factorCommon('left', [0, 1], 'x'); R.pn(); R.eachBranch(R.linear); },
  p4: () => { R.factorCommon('left', [0, 1], 'x+1'); R.tidy(); R.pn(); R.eachBranch(R.linear); },
  p5: () => { R.op('-5x'); R.factorCommon('left', [0, 1], 'x'); R.pn(); R.eachBranch(R.linear); },
  pB: () => {
    R.factorCommon('left', [0, 1], 'x'); R.pn();
    R.branch([1], () => { R.identity('left', [0, 1], 3, 'x', '2'); R.pn(); });
    R.branch([1, 0], R.linear); R.branch([1, 1], R.linear);
  },
  g1: () => { R.expandAll(); R.op('-x^2'); R.linear(); },
  g2: () => { R.expandAll(); R.op('+x^2'); },
  g3: () => { R.identity('left', [0, 1], 3, 'x', '3'); R.pn(); R.eachBranch(R.linear); },
  g4: () => { R.expandAll(); R.identity('left', [0, 1, 2], 2, 'x', '3'); R.pn(); R.eachBranch(R.linear); },
  g5: () => {
    R.factorCommon('left', [0, 1, 2], '-1'); R.drill('left', 0);
    R.innerIdentity([0, 1, 2], 2, 'x', '7'); R.exit(); R.pn(); R.eachBranch(R.linear);
  },
  g6: () => {
    R.identity('left', [0, 1], 3, 'x^2', '5'); R.pn();
    R.branch([0], () => { R.op('+5'); R.sqrt1(); R.sqrt2(); });
    R.branch([1], () => { R.op('-5'); R.sqrt1(); R.sqrt2(); });
  },
  gB: () => { R.identity('left', [0, 1], 3, '2x+1', 'x-3'); R.tidy(); R.pn(); R.eachBranch(R.linear); },
  r1: () => { R.sqrt1(); R.sqrt2(); },
  r2: () => { R.sqrt1(); R.sqrt2(); R.eachBranch(R.linear); },
  r3: () => { R.sqrt1(); R.sqrt2(); R.eachBranch(R.linear); },
  r4: () => { R.sqrt1(); R.sqrt2(); },
  m1: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); },
  m2: () => { R.drill('left', 0); R.existence(); R.inDomain(0, R.linear); },
  m3: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.op('\\times(x-2)'); R.expandAll(); R.linear(); },
  m4: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.op('\\times(x-3)'); R.expandAll(); R.linear(); },
  m5: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.simp('left', [0]); R.linear(); },
  m6: () => {
    R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear);
    R.drill('left', 0); R.innerIdentity([0, 1], 3, 'x', '3'); R.exit(); R.simp('left', [0]); R.linear();
  },
  m7: () => { R.square(); R.linear(); },
  m8: [
    () => { R.square(); },
    () => { R.drillDen('left', 0); R.existence(); R.simp('left', [0]); R.square(); }
  ],
  mB: () => {
    R.drillBranch('left', 0, 1); R.existence(); R.inDomain(0, R.linear);
    R.pn(); R.branch([0], R.linear); R.branch([1], () => { R.square(); R.linear(); });
  },
  s1: () => { R.signChart(); },
  s2: () => { R.signChart(); },
  s3: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.signChart(); },
  s4: () => { R.signChart(); },
  s5: () => { R.signChart(); },
  sB: () => {
    R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear);
    R.drill('left', 0); R.innerIdentity([0, 1], 3, 'x', '2'); R.exit(); R.signChart();
  },
  // Après chaque factorisation, l'app ressort du groupe : on y re-entre.
  o1: () => {
    R.drill('left', 0); R.innerIdentity([0, 1], 3, '3x', '2');
    R.drill('left', 0); R.innerCommon([0, 1], '3x-2'); R.drill('left', 0); R.innerTidy(); R.exit();
    R.drillDen('left', 0); R.innerIdentity([0, 1, 2], 1, 'x', '1');
    R.drillDen('left', 0); R.innerIdentity([0, 1], 3, 'x+1', '2x-3'); R.drillDen('left', 0); R.innerTidy(); R.exit();
    R.drillDen('left', 0); R.existence();
    R.inDomain(0, () => {
      R.pn();
      var col = window.App.History.getDomainConditions()[0].engine;
      col.getBranches().forEach((_, i) => { col.focusBranch(i); R.linear(); });
    });
    R.simp('left', [0]); R.op('\\times(4-x)'); R.tidy(); R.linear();
  },
  // Variante avec x² − 4 déjà factorisé (voir BLOCKED) : factoriser à l'intérieur d'un
  // produit placé au dénominateur n'est pas possible dans l'app.
  oB: () => {
    R.drill('left', 0); window.App.History.clickNestedFactor(0, 1); window.App.History.clickNestedFactor(0, 1);
    R.innerIdentity([0, 1, 2], 1, 'x', '5');
    R.drill('left', 0); R.existence(); R.drillDen('left', 0); R.existence();
    window.App.History.getDomainConditions().forEach((_, i) => R.inDomain(i, R.linear));
    R.signChart();
  },
  o2: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.op('\\times(4-x)'); R.expandAll(); R.linear(); },
  o3: () => { R.drillDen('left', 0); R.existence(); R.inDomain(0, R.linear); R.signChart(); }
};

// Niveaux qu'on sait impossibles à finir avec l'app actuelle (voir le compte rendu).
const BLOCKED = {
  mB: 'Produit nul indisponible sur une équation qui porte déjà une condition d\'existence (restriction v1)',
  oB: 'x² − 4 ne se factorise pas dans un produit au dénominateur ; la variante (x − 2)(x + 2) se résout (script oB)' };

(async () => {
  const zones = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  await page.addInitScript(installHelpers);
  await page.goto(FILE);
  await page.evaluate(() => {
    var levels = {};
    window.App.Levels.LEVELS.forEach(function (l) { if (!l.daily) levels[l.id] = { stars: 1 }; });
    localStorage.setItem('equations-progress', JSON.stringify({ version: 1, badges: [], levels: levels }));
    window.App.Progress.load();
    window.App.Settings.set('autoSimplify', true);
  });
  const levels = await page.evaluate(() => window.App.Levels.LEVELS.filter((l) => !l.daily).map((l) => ({ id: l.id, zone: l.zone, par: l.par })));
  const summary = [];
  for (const lv of levels) {
    if (zones.length && zones.indexOf(lv.zone) === -1) continue;
    if (BLOCKED[lv.id]) { console.log('SKIP - ' + lv.id + ' : ' + BLOCKED[lv.id]); continue; }
    const scripts = Array.isArray(S[lv.id]) ? S[lv.id] : [S[lv.id]];
    await page.evaluate((id) => { window.R.errors = []; window.App.Campaign.startLevel(id); }, lv.id);
    let err = null;
    for (let k = 0; k < scripts.length; k++) {
      try {
        await page.evaluate('(' + scripts[k].toString() + ')()');
      } catch (e) { err = e.message.split('\n')[0]; break; }
      await page.waitForTimeout(k + 1 < scripts.length ? 1100 : 60);
    }
    const res = await page.evaluate(() => {
      var c = window.App.Campaign.current();
      return { won: c && c.won, steps: window.App.Campaign.stepCount(), message: c && c.message,
        appErrors: window.R.errors, final: window.App.Render.finalSolutionRanges(),
        eq: window.App.History.lastEquation() };
    });
    const label = lv.id + ' solved in ' + res.steps + ' step(s), par ' + lv.par;
    ok(label, res.won && !err);
    if (!res.won || err) {
      console.log('   script error:', err, '| app errors:', JSON.stringify(res.appErrors), '| message:', res.message);
      console.log('   last equation:', JSON.stringify(res.eq));
      console.log('   final S:', JSON.stringify(res.final));
    }
    summary.push(lv.id + '=' + res.steps + (res.steps !== lv.par ? ' (par ' + lv.par + ')' : ''));
  }
  console.log('steps: ' + summary.join(', '));
  ok('no page errors', errs.length === 0);
  if (errs.length) console.log(errs.join('\n'));
  await browser.close();
})();
