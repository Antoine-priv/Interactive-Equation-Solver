const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

function findSqrtKey(page) {
  return page.$('[data-key="sqrt"]');
}

const startEq = {
  left: [{
    sign: 1,
    factors: [
      { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 },
      {
        terms: [
          { sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], exponent: 2 }] },
          { coeff: -16, pow: 0 }
        ],
        exponent: 1
      }
    ]
  }],
  right: [{ coeff: 0, pow: 0 }]
};

// Applique "Opération" `text` sur le moteur actif (celui que délègue App.History en ce
// moment, à N'IMPORTE quelle profondeur), puis simplifie immédiatement les deux membres
// (l'app n'auto-simplifie jamais après une opération) : réduit chaque membre à un seul
// terme, condition nécessaire pour que detectSquareRoot/isSolved s'y appliquent ensuite.
function applyOpAndSimplify(page, text) {
  return page.evaluate((t) => {
    window.App.History.selectOp('expr');
    window.App.History.setExprChainText(t);
    window.App.History.confirm();
    var eq = window.App.History.lastEquation();
    // Ne sélectionne que les vrais Term plats (jamais un FactorGroup/ProductGroup, ex.
    // le "(x+3)^2" du membre gauche ici) : seuls des termes "compatibles" (même pow)
    // peuvent se combiner via Simplifier.
    var isPlainTerm = function (n) { return !n.factors && !n.innerTerms; };
    var leftIdx = eq.left.map(function (n, i) { return isPlainTerm(n) ? i : -1; }).filter(function (i) { return i >= 0; });
    var rightIdx = eq.right.map(function (n, i) { return isPlainTerm(n) ? i : -1; }).filter(function (i) { return i >= 0; });
    if (leftIdx.length > 1) leftIdx.forEach(function (i) { window.App.History.toggleTermSelection('left', i); });
    if (rightIdx.length > 1) rightIdx.forEach(function (i) { window.App.History.toggleTermSelection('right', i); });
    if (leftIdx.length > 1 || rightIdx.length > 1) window.App.History.confirmSimplifySelection();
  }, text);
}

// Une colonne "Produit nul" (ou "Racine carrée") peut elle-même atteindre une forme qui
// se prête à une NOUVELLE "Produit nul"/"Racine carrée" (ex. une identité remarquable
// produisant un carré parfait à l'intérieur d'une colonne) : ce test construit
// directement (via l'objet Equation, pour éviter de dépendre du parseur pour des
// parenthèses imbriquées) "(x+2)((x+3)^2-16)=0", scinde par "Produit nul", amène la
// colonne droite à "(x+3)^2=16" par une opération ordinaire, puis vérifie que "Racine
// carrée" y est bien PROPOSÉE (plus le bug d'origine : la touche restait grisée dès
// qu'une scission avait déjà eu lieu, voir history.js/canSquareRoot) et scinde bien
// CETTE colonne en 2 sous-colonnes, rendues imbriquées (voir renderBranchNode dans
// render.js), indépendamment résolubles, jusqu'à un résumé final correct.
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });

  await page.goto(FILE);
  await page.evaluate((eq) => { window.App.History.startNewEquation(eq); }, startEq);
  await page.waitForTimeout(80);

  // 1) Produit nul sur (x+2)((x+3)^2-16)=0 -> 2 colonnes de premier niveau.
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(150);

  const topBranches = await page.evaluate(() => window.App.History.getBranches().map((b) => b.lastEquation()));
  console.log('branches de premier niveau:', JSON.stringify(topBranches));
  ok('produit nul gives exactly 2 top-level columns', topBranches.length === 2);
  const squareIdx = topBranches.findIndex((eq) => eq.left.some((n) => n.factors));
  ok('found the "(x+3)^2-16=0" column', squareIdx !== -1);

  // 2) Focalise cette colonne, l'amène à "(x+3)^2=16" par une opération ordinaire (+16)
  // puis une simplification explicite des deux membres.
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, squareIdx);
  await applyOpAndSimplify(page, '+16');
  await page.waitForTimeout(150);

  const afterOp = await page.evaluate(() => window.App.History.lastEquation());
  console.log('colonne apres +16 puis simplification:', JSON.stringify(afterOp));
  ok('column reaches (x+3)^2=16', JSON.stringify(afterOp.right) === JSON.stringify([{ coeff: 16, pow: 0 }]));

  // 3) LE BUG D'ORIGINE : la touche "Racine carrée" du pavé "Opération" doit être
  // UTILISABLE ici, alors qu'une scission ("Produit nul") a déjà eu lieu plus haut dans
  // l'arbre — canSquareRoot()/canProduitNul() ne doivent plus se limiter à l'équation de
  // tout premier niveau (voir history.js).
  const canSquareRootNow = await page.evaluate(() => window.App.History.canSquareRoot());
  ok('canSquareRoot() is true for a focused branch already inside a split', canSquareRootNow === true);

  await page.click('button[data-op="expr"]');
  await page.waitForTimeout(120);
  const sqrtKey = await findSqrtKey(page);
  const sqrtDisabled = await sqrtKey.evaluate((el) => el.disabled);
  ok('the sqrt key in the Opération keypad is NOT greyed out inside this branch', sqrtDisabled === false);

  await sqrtKey.evaluate((el) => el.click());
  await page.waitForTimeout(120);
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(200);

  // 4) La colonne s'est scindée À SON TOUR (imbriqué) en 2 sous-colonnes.
  const nested = await page.evaluate((idx) => {
    var col = window.App.History.getBranches()[idx];
    var sub = col.getBranches();
    return sub ? sub.map((s) => s.lastEquation()) : null;
  }, squareIdx);
  console.log('sous-branches imbriquees:', JSON.stringify(nested));
  ok('the branch itself split into exactly 2 nested columns', nested && nested.length === 2);
  ok('nested branch 0 is x+3=4', nested && JSON.stringify(nested[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: 4, pow: 0 }] }));
  ok('nested branch 1 is x+3=-4', nested && JSON.stringify(nested[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: 3, pow: 0 }], right: [{ coeff: -4, pow: 0 }] }));

  // 5) Rendu DOM : colonnes imbriquées effectivement présentes, sans erreur JS.
  const domNested = await page.evaluate(() => document.querySelectorAll('.produit-nul-split-nested .produit-nul-branch').length);
  ok('2 nested column elements actually rendered in the DOM', domNested === 2);
  await page.screenshot({ path: `${SCRATCH}/nested_branch_split.png` });

  // 5b) Bug signalé : survoler le bouton "Opération" d'une équation NICHÉE dans une
  // sous-colonne redessine tout (voir hoveredOp dans toolbar.js) — ce conteneur parent
  // ("(x+3)^2=16", qui a lui-même une scission imbriquée) ne doit JAMAIS montrer son
  // propre liseré pendant ce survol (ni transitionner brièvement vers lui), seule la
  // sous-colonne réellement sélectionnée le montre — voir ".produit-nul-branch-resplit"
  // dans style.css/render.js (remplace ":has()", vulnérable à un état DOM intermédiaire).
  const outerColSel = '#history > .produit-nul-split > .produit-nul-branch.branch-focused';
  const outerShadowBefore = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).boxShadow, outerColSel);
  const opBtn = await page.$('button[data-op="expr"]');
  const opBtnBox = await opBtn.boundingBox();
  await page.mouse.move(opBtnBox.x + opBtnBox.width / 2, opBtnBox.y + opBtnBox.height / 2);
  await page.waitForTimeout(50);
  const outerShadowDuring = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).boxShadow, outerColSel);
  await page.waitForTimeout(200);
  const outerShadowSettled = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).boxShadow, outerColSel);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(50);
  const outerShadowAfter = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).boxShadow, outerColSel);
  console.log('liseré colonne parente (re-scindée) avant/pendant/après survol "Opération":',
    JSON.stringify({ before: outerShadowBefore, during: outerShadowDuring, settled: outerShadowSettled, after: outerShadowAfter }));
  ok('outer column outline never leaves its suppressed (transparent) resting state while hovering "Opération" on a nested equation',
    outerShadowBefore === outerShadowDuring && outerShadowDuring === outerShadowSettled && outerShadowSettled === outerShadowAfter);

  // 6) Termine de résoudre TOUT l'arbre (les 2 sous-branches + l'autre colonne de
  // premier niveau) et vérifie le résumé final agrégé (pas seulement le premier niveau).
  await page.evaluate((idx) => {
    window.App.History.setFocusedBranch(idx);
    window.App.History.getBranches()[idx].setFocusedBranch(0);
  }, squareIdx);
  await applyOpAndSimplify(page, '-3'); // "x+3=4" -> "x=1"
  await page.waitForTimeout(100);

  await page.evaluate((idx) => { window.App.History.getBranches()[idx].setFocusedBranch(1); }, squareIdx);
  await applyOpAndSimplify(page, '-3'); // "x+3=-4" -> "x=-7"
  await page.waitForTimeout(100);

  const otherIdx = squareIdx === 0 ? 1 : 0;
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, otherIdx);
  await applyOpAndSimplify(page, '-2'); // "x+2=0" -> "x=-2"
  await page.waitForTimeout(200);

  const summaryLatexExists = await page.evaluate(() => !!document.querySelector('.solution-set'));
  ok('final aggregated solution-set summary appears once EVERY leaf (nested included) is solved', summaryLatexExists);
  const summaryText = await page.evaluate(() => document.querySelector('.solution-set').textContent);
  console.log('resume final:', summaryText);
  ok('summary contains all 3 distinct roots (-7, -2, 1)', /-7/.test(summaryText) && /-2/.test(summaryText) && /1/.test(summaryText));

  await page.screenshot({ path: `${SCRATCH}/nested_branch_split_solved.png` });

  // 7) Undo : d'abord la scission imbriquée seule (retour à "(x+3)^2=16" DANS la
  // colonne), sans toucher à la scission de premier niveau ni à l'autre colonne.
  // (Redémarre depuis zéro un scénario plus court pour ce point précis, plus lisible.)
  await page.evaluate((eq) => { window.App.History.startNewEquation(eq); }, startEq);
  await page.evaluate(() => {
    window.App.History.toggleTermSelection('left', 0);
    window.App.History.confirmProduitNul();
  });
  await page.waitForTimeout(80);
  const sqIdx2 = (await page.evaluate(() => window.App.History.getBranches().map((b) => b.lastEquation())))
    .findIndex((eq) => eq.left.some((n) => n.factors));
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, sqIdx2);
  await applyOpAndSimplify(page, '+16');
  await page.evaluate(() => window.App.History.confirmSquareRoot());
  await page.waitForTimeout(80);

  const hasNestedBefore = await page.evaluate((idx) => !!window.App.History.getBranches()[idx].getBranches(), sqIdx2);
  ok('nested split exists before undo', hasNestedBefore);

  await page.evaluate(() => window.App.History.undo());
  await page.waitForTimeout(80);
  const stateAfterFirstUndo = await page.evaluate((idx) => ({
    hasNested: !!window.App.History.getBranches()[idx].getBranches(),
    hasTop: !!window.App.History.getBranches(),
    eq: window.App.History.getBranches()[idx].lastEquation()
  }), sqIdx2);
  console.log('etat apres 1er undo:', JSON.stringify(stateAfterFirstUndo));
  ok('first undo dissolves ONLY the nested split (back to (x+3)^2=16)', !stateAfterFirstUndo.hasNested);
  ok('the outer split (top-level columns) is untouched by that undo', stateAfterFirstUndo.hasTop);
  ok('column equation is back to (x+3)^2=16', JSON.stringify(stateAfterFirstUndo.eq.right) === JSON.stringify([{ coeff: 16, pow: 0 }]));

  // 8) Second bug signalé (repro exacte de la capture d'écran) : "Produit nul" doit
  // aussi être proposé à l'intérieur d'une colonne quand elle atteint un FactorGroup issu
  // d'un facteur commun (ex. "x(x-5)=0" après "Factoriser par x"), pas seulement un
  // ProductGroup classique ((A)(B)=0) — voir detectProduitNul dans history.js. Entièrement
  // piloté via de vrais clics DOM (pas l'API), pour vérifier le bouton lui-même, pas
  // seulement l'état interne.
  //
  // App.Canvas.set(0, 0) d'abord : startNewEquation (voir history.js) ne réinitialise
  // JAMAIS le panorama/zoom de la toile lui-même (aucune raison qu'il le fasse -- ce
  // n'est pas son rôle) -- sans ce repli explicite, le panorama horizontal laissé par le
  // scénario 7 ci-dessus (colonnes larges, jamais recentré horizontalement hors "wide
  // split", voir isWideSplit dans render.js) fait apparaître cette nouvelle équation hors
  // du viewport, provoquant un timeout sur le clic ci-dessous. Même repli que
  // zoom_controls.js entre deux scénarios indépendants du même fichier.
  await page.evaluate((eq) => {
    window.App.Canvas.set(0, 0);
    window.App.History.startNewEquation(window.App.Parser.parseEquation(eq));
  }, '(x-6)(x^2-5x)=0');
  await page.waitForTimeout(80);
  await page.click('.eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(150);

  const branchesRepro = await page.evaluate(() => window.App.History.getBranches().map((b) => b.lastEquation()));
  const quadIdx = branchesRepro.findIndex((eq) => eq.left.some((n) => n.pow === 2));
  ok('repro: found the "x^2-5x=0" column', quadIdx !== -1);
  await page.evaluate((idx) => { window.App.History.setFocusedBranch(idx); }, quadIdx);
  await page.waitForTimeout(100);

  await page.click('.produit-nul-branch.branch-focused .eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('.produit-nul-branch.branch-focused .eq-row.current .side[data-side="left"] .term[data-index="1"]');
  await page.click('button[data-op="factor"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    var btns = Array.from(document.querySelectorAll('.factor-choice-btn'));
    btns.find((el) => el.textContent.includes('Facteur commun')).click();
  });
  await page.waitForTimeout(100);
  await page.click('[data-key="x"]');
  await page.click('[data-key="enter"]');
  await page.waitForTimeout(150);

  const eqAfterFactor = await page.evaluate((idx) => window.App.History.getBranches()[idx].lastEquation(), quadIdx);
  console.log('repro colonne apres "factoriser par x":', JSON.stringify(eqAfterFactor));
  ok('repro: column reaches x(x-5)=0', JSON.stringify(eqAfterFactor) === JSON.stringify({
    left: [{ sign: 1, factor: { coeff: 1, pow: 1 }, innerTerms: [{ coeff: 1, pow: 1 }, { coeff: -5, pow: 0 }] }],
    right: [{ coeff: 0, pow: 0 }]
  }));

  const pnRowHidden = await page.evaluate(() => document.querySelector('button[data-op="produitnul"]').parentElement.hidden);
  ok('THE REPORTED BUG: "Produit nul" row is NOT hidden for x(x-5)=0 inside this column', pnRowHidden === false);
  await page.screenshot({ path: `${SCRATCH}/nested_produitnul_factorgroup_button.png` });

  await page.click('.produit-nul-branch.branch-focused .eq-row.current .side[data-side="left"] .term[data-index="0"]');
  await page.click('button[data-op="produitnul"]');
  await page.waitForTimeout(150);

  const nestedRepro = await page.evaluate((idx) => {
    var sub = window.App.History.getBranches()[idx].getBranches();
    return sub ? sub.map((s) => s.lastEquation()) : null;
  }, quadIdx);
  console.log('repro sous-branches apres Produit nul sur x(x-5)=0:', JSON.stringify(nestedRepro));
  ok('repro: x(x-5)=0 splits into nested branches x=0 and x-5=0', nestedRepro && nestedRepro.length === 2 &&
    JSON.stringify(nestedRepro[0]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }], right: [{ coeff: 0, pow: 0 }] }) &&
    JSON.stringify(nestedRepro[1]) === JSON.stringify({ left: [{ coeff: 1, pow: 1 }, { coeff: -5, pow: 0 }], right: [{ coeff: 0, pow: 0 }] }));
  await page.screenshot({ path: `${SCRATCH}/nested_produitnul_factorgroup_split.png` });

  // 9) La colonne de premier niveau "quadIdx" (celle-ci) s'est donc scindée À NOUVEAU :
  // elle héberge maintenant ses propres étapes gelées ET la scission imbriquée, ce n'est
  // plus "une équation" mais un conteneur de plusieurs. Son propre liseré de focus
  // (.branch-focused, voir style.css) doit s'effacer au profit de celui de la sous-colonne
  // réellement sélectionnée (x=0, focalisée par défaut) — voir la règle CSS ajoutée pour
  // ".produit-nul-branch.branch-focused:has(.produit-nul-split-nested)".
  const shadows = await page.evaluate(() => {
    var outerEl = document.querySelector('#history > .produit-nul-split > .produit-nul-branch.branch-focused');
    var nestedEl = document.querySelector('#history .produit-nul-split-nested > .produit-nul-branch.branch-focused');
    return { outer: outerEl ? getComputedStyle(outerEl).boxShadow : null, nested: nestedEl ? getComputedStyle(nestedEl).boxShadow : null };
  });
  console.log('box-shadow colonne parente re-scindee vs sous-colonne focalisee:', JSON.stringify(shadows));
  const TRANSPARENT_RE = /rgba\(0,\s*0,\s*0,\s*0\)/;
  ok('outer column outline is suppressed once it hosts a nested split', shadows.outer && TRANSPARENT_RE.test(shadows.outer));
  ok('the nested focused sub-column keeps its own visible accent outline', shadows.nested && !TRANSPARENT_RE.test(shadows.nested));

  // 10) Cliquer un terme dans une colonne de PREMIER NIVEAU pas encore focalisée (l'autre
  // facteur, "x-6=0", jamais visitée depuis le tout premier "Produit nul" de ce repro) ne
  // doit QUE la focaliser — sans sélectionner accidentellement le terme sur lequel le clic
  // a atterri. Un second clic, une fois focalisée, sélectionne normalement — voir le garde
  // `opts.focused === false` ajouté dans onTermClick (render.js).
  const otherTopIdx = quadIdx === 0 ? 1 : 0;
  const siblingSel = '#history > .produit-nul-split > .produit-nul-branch:not(.branch-focused) .eq-row.current .side[data-side="left"] .term[data-index="0"]';
  ok('sibling top-level column ("x-6=0") term found in the DOM', !!(await page.$(siblingSel)));
  await page.click(siblingSel);
  await page.waitForTimeout(100);
  const afterFirstSiblingClick = await page.evaluate((idx) => ({
    focused: window.App.History.getFocusedBranch() === idx,
    selectedCount: window.App.History.getBranches()[idx].getPending().selectedLeft.length
  }), otherTopIdx);
  console.log('apres 1er clic sur "x-6=0" (jamais visitee):', JSON.stringify(afterFirstSiblingClick));
  ok('first click on a not-yet-focused column focuses it...', afterFirstSiblingClick.focused);
  ok('...without selecting the term it landed on', afterFirstSiblingClick.selectedCount === 0);

  // 10b) Bug signalé : "quadIdx" ("x(x-5)=0") vient de perdre le focus de premier niveau
  // au profit de "x-6=0" ci-dessus, mais sa sous-colonne imbriquée (x=0, focalisée en son
  // sein — mémoire purement interne à SON PROPRE moteur, voir focusedIdx dans
  // renderBranchNode) doit elle aussi perdre son liseré : sinon elle continue de
  // ressembler à une sélection active alors que le focus réel est ailleurs. Voir
  // `childFocused` (opts.focused !== false && focusedIdx === idx) désormais utilisé pour
  // la classe ".branch-focused" elle-même, pas seulement pour le garde de clic.
  const nestedShadowAfterTopSwitch = await page.evaluate(() => {
    var el = document.querySelector('#history .produit-nul-split-nested > .produit-nul-branch');
    return el ? { hasBranchFocused: el.classList.contains('branch-focused'), boxShadow: getComputedStyle(el).boxShadow } : null;
  });
  console.log('sous-colonne imbriquee de "x(x-5)=0" apres avoir perdu le focus de premier niveau:', JSON.stringify(nestedShadowAfterTopSwitch));
  ok('THE REPORTED BUG: nested sub-column loses its own outline once its parent column is no longer the focused top-level column',
    nestedShadowAfterTopSwitch && !nestedShadowAfterTopSwitch.hasBranchFocused && /rgba\(0,\s*0,\s*0,\s*0\)/.test(nestedShadowAfterTopSwitch.boxShadow));

  const focusedSel = '#history > .produit-nul-split > .produit-nul-branch.branch-focused .eq-row.current .side[data-side="left"] .term[data-index="0"]';
  await page.click(focusedSel);
  await page.waitForTimeout(100);
  const afterSecondSiblingClick = await page.evaluate((idx) => window.App.History.getBranches()[idx].getPending().selectedLeft.length, otherTopIdx);
  ok('second click on the now-focused column selects the term normally', afterSecondSiblingClick === 1);
  await page.screenshot({ path: `${SCRATCH}/branch_focus_before_select.png` });

  // 11) Le survol gris (voir .term.selectable:hover dans style.css) doit lui aussi rester
  // désactivé tant que la colonne n'est pas focalisée — cohérent avec le clic (§10
  // ci-dessus) : un terme qui ne se sélectionne pas au clic ne doit pas non plus SEMBLER
  // survolable. `quadIdx` (celle contenant "x(x-5)=0", elle-même déjà re-scindée) vient
  // de perdre le focus au profit de `otherTopIdx` ci-dessus.
  const quadTermSel = '#history > .produit-nul-split > .produit-nul-branch:not(.branch-focused) .term.selectable';
  const quadTermHandle = await page.$(quadTermSel);
  ok('unfocused sibling column ("x(x-5)=0") has a hoverable-looking term in the DOM', !!quadTermHandle);
  const quadTermBox = await quadTermHandle.boundingBox();
  await page.mouse.move(quadTermBox.x + quadTermBox.width / 2, quadTermBox.y + quadTermBox.height / 2);
  await page.waitForTimeout(60);
  const quadTermBg = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, quadTermSel);
  console.log('fond au survol dans la colonne NON focalisee:', quadTermBg);
  ok('hover gray background is disabled on a term inside a not-focused column', /rgba\(0,\s*0,\s*0,\s*0\)/.test(quadTermBg));

  const focusedTermSel = '#history > .produit-nul-split > .produit-nul-branch.branch-focused .eq-row.current .side[data-side="left"] .term[data-index="1"]';
  const focusedTermHandle = await page.$(focusedTermSel);
  ok('now-focused sibling column term found', !!focusedTermHandle);
  const focusedTermBox = await focusedTermHandle.boundingBox();
  await page.mouse.move(focusedTermBox.x + focusedTermBox.width / 2, focusedTermBox.y + focusedTermBox.height / 2);
  await page.waitForTimeout(60);
  const focusedTermBg = await page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, focusedTermSel);
  console.log('fond au survol dans la colonne focalisee:', focusedTermBg);
  ok('hover gray background still shows normally on a term inside the focused column', !/rgba\(0,\s*0,\s*0,\s*0\)/.test(focusedTermBg));

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
