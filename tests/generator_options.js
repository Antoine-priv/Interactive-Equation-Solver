const { chromium } = require('playwright');
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

// "Options de génération" : engrenage au survol du bouton "Générer aléatoirement" (modale
// "Nouvelle équation"), qui ouvre une fenêtre d'interrupteurs (gen_<tag>, voir
// settings.js) et un double curseur de degré min/max, tous relus par
// App.Generator.generateEquation(App.Settings.generatorOptions()).
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  await page.waitForTimeout(300);

  // Tire N équations avec les options courantes et renvoie des statistiques structurelles
  // (parcours récursif de tous les nœuds, numérateurs/dénominateurs/radicands compris).
  async function sample(N) {
    return page.evaluate((n) => {
      function walk(side, acc) {
        side.forEach(function (node) {
          if (node.factors) {
            acc.product = true;
            var deg = 0;
            node.factors.forEach(function (f) {
              var d = 0;
              f.terms.forEach(function (t) { if (t.pow !== undefined && !t.factors) d = Math.max(d, t.pow); });
              deg += d * f.exponent;
              walk(f.terms, acc);
            });
            acc.productDeg = Math.max(acc.productDeg, deg);
          } else if (node.radicand) {
            acc.sqrt = true;
            walk(node.radicand, acc);
          } else if (node.innerTerms) {
            if (node.isDivision) acc.fraction = true;
            walk(node.innerTerms, acc);
            if (node.factorTerms) walk(node.factorTerms, acc);
          } else {
            acc.maxPow = Math.max(acc.maxPow, node.pow);
          }
        });
      }
      var out = { nulls: 0, ineq: 0, sqrt: 0, fraction: 0, product: 0, maxPow: 0, allDeg3: true };
      for (var i = 0; i < n; i++) {
        var eq = window.App.Generator.generateEquation(window.App.Settings.generatorOptions());
        if (!eq) { out.nulls++; continue; }
        var acc = { product: false, sqrt: false, fraction: false, maxPow: 0, productDeg: 0 };
        walk(eq.left, acc); walk(eq.right, acc);
        if (eq.operator) out.ineq++;
        if (acc.sqrt) out.sqrt++;
        if (acc.fraction) out.fraction++;
        if (acc.product) out.product++;
        out.maxPow = Math.max(out.maxPow, acc.maxPow);
        if (acc.productDeg !== 3) out.allDeg3 = false;
      }
      return out;
    }, N);
  }

  async function toggle(key) {
    await page.click('#generatorOverlay input[data-setting="' + key + '"]');
  }

  // --- Engrenage : caché, visible au survol, ouvre la fenêtre sans générer ---
  await page.click('#newEquationBtn');
  await page.waitForTimeout(300);
  const gearOpacity = () => page.evaluate(() => getComputedStyle(document.querySelector('#randomGenerate .gen-options-gear')).opacity);
  ok('engrenage invisible hors survol', (await gearOpacity()) === '0');
  await page.hover('#randomGenerate');
  await page.waitForTimeout(250);
  ok('engrenage visible au survol du bouton', (await gearOpacity()) === '1');
  const latexBefore = await page.evaluate(() => window.App.MathKeypad.getLatex());
  await page.click('#randomGenerate .gen-options-gear');
  await page.waitForTimeout(300);
  ok('clic sur l\'engrenage ouvre "Options de génération"', await page.evaluate(() => !document.getElementById('generatorOverlay').hidden));
  ok('clic sur l\'engrenage ne génère pas d\'équation', (await page.evaluate(() => window.App.MathKeypad.getLatex())) === latexBefore);
  ok('tous les interrupteurs activés par défaut', await page.evaluate(() =>
    Array.prototype.every.call(document.querySelectorAll('#generatorOverlay input[data-setting]'), (i) => i.checked)));

  // --- Inéquations désactivées : plus aucune inéquation, "Tableau de signes" grisé ---
  await toggle('gen_inequality');
  await page.waitForTimeout(350);
  ok('"Tableau de signes" replié (et non grisé) sans les inéquations', await page.evaluate(() => {
    var row = document.querySelector('#generatorOverlay input[data-setting="gen_signChart"]').closest('.settings-row');
    return row.classList.contains('settings-row-collapsed') && row.getBoundingClientRect().height < 2;
  }));
  let s = await sample(400);
  ok('aucune inéquation générée (' + s.ineq + ')', s.ineq === 0 && s.nulls === 0);
  ok('réglage mémorisé en local', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('equations-settings')).gen_inequality === false));

  // --- Fractions + racines désactivées : ni quotient ni √, domaine grisé ---
  await toggle('gen_fraction');
  await toggle('gen_sqrt');
  ok('"Domaine de définition" replié sans fractions ni racines', await page.evaluate(() =>
    document.querySelector('#generatorOverlay input[data-setting="gen_domain"]').closest('.settings-row').classList.contains('settings-row-collapsed')));
  s = await sample(400);
  ok('ni fraction ni racine générée (' + s.fraction + ', ' + s.sqrt + ')', s.fraction === 0 && s.sqrt === 0 && s.nulls === 0);
  await toggle('gen_inequality');
  await toggle('gen_fraction');
  await toggle('gen_sqrt');
  await page.waitForTimeout(350);
  ok('"Tableau de signes" réapparaît avec les inéquations', await page.evaluate(() =>
    document.querySelector('#generatorOverlay input[data-setting="gen_signChart"]').closest('.settings-row').getBoundingClientRect().height > 20));

  // --- Factorisation coupée : plus d'identité remarquable ni de facteur commun ---
  await toggle('gen_factoring');
  const factorCheck = await page.evaluate(() => {
    for (var i = 0; i < 400; i++) {
      var eq = window.App.Generator.generateEquation(window.App.Settings.generatorOptions());
      var all = eq.left.concat(eq.right);
      // Trinôme identité (x² et constante au premier niveau, = 0) ou facteur commun.
      if (all.some(function (n) { return n.factor && !n.isDivision; })) return false;
      if (!eq.operator && eq.left.length >= 2 && eq.left.some(function (n) { return n.pow === 2; }) && eq.right.length === 1 && eq.right[0].coeff === 0) return false;
    }
    return true;
  });
  ok('sans factorisation : ni identité remarquable ni facteur commun', factorCheck);
  await toggle('gen_factoring');

  // --- Double curseur : les poignées ne se croisent pas ---
  await page.focus('#generatorOverlay [data-degree="max"]');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.focus('#generatorOverlay [data-degree="min"]');
  await page.keyboard.press('ArrowRight');
  let deg = await page.evaluate(() => [window.App.Settings.get('genMinDegree'), window.App.Settings.get('genMaxDegree')]);
  ok('degré max ramené à 1, min bloqué à 1 (' + deg + ')', deg[0] === 1 && deg[1] === 1);
  s = await sample(400);
  ok('degré 1 seulement : aucun x² ni produit (' + s.maxPow + ', ' + s.product + ')', s.maxPow <= 1 && s.product === 0 && s.nulls === 0);

  await page.focus('#generatorOverlay [data-degree="max"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.focus('#generatorOverlay [data-degree="min"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  deg = await page.evaluate(() => [window.App.Settings.get('genMinDegree'), window.App.Settings.get('genMaxDegree')]);
  ok('degré 3 seulement (' + deg + ')', deg[0] === 3 && deg[1] === 3);
  s = await sample(400);
  ok('degré 3 seulement : chaque tirage est un produit de degré 3', s.allDeg3 && s.nulls === 0);

  // --- Souris : la poignée suit le curseur en continu, puis se cale sur l'entier le plus proche ---
  await page.focus('#generatorOverlay [data-degree="min"]');
  await page.keyboard.press('Home');
  const tr = await page.locator('#generatorOverlay .degree-range-track').boundingBox();
  const ty = tr.y + tr.height / 2;
  const thumbCenter = (k) => page.evaluate((key) => {
    var r = document.querySelector('#generatorOverlay [data-degree="' + key + '"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, k);
  await page.waitForTimeout(300);
  let c = await thumbCenter('min');
  ok('poignée min centrée sur le début de la piste', Math.abs(c.x - tr.x) < 1 && Math.abs(c.y - ty) < 1);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(tr.x + tr.width * 0.4, ty, { steps: 6 });
  c = await thumbCenter('min');
  ok('pendant le glisser, la poignée suit la souris (pas de saut à un entier)', Math.abs(c.x - (tr.x + tr.width * 0.4)) < 1.5);
  await page.mouse.up();
  await page.waitForTimeout(350);
  c = await thumbCenter('min');
  deg = await page.evaluate(() => [window.App.Settings.get('genMinDegree'), window.App.Settings.get('genMaxDegree')]);
  ok('au relâchement, calée sur l\'entier le plus proche (2) (' + deg + ')', deg[0] === 2 && Math.abs(c.x - (tr.x + tr.width / 2)) < 1);
  await page.focus('#generatorOverlay [data-degree="min"]');
  await page.keyboard.press('End');

  // --- Aucune forme compatible : message dans la fenêtre et au clic sur "Générer" ---
  await toggle('gen_produitNul');
  await toggle('gen_inequality');
  const hint = await page.textContent('#generatorEmpty');
  ok('message "aucune équation" affiché (' + hint + ')', /Aucune équation/.test(hint));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('Échap ferme la fenêtre d\'options mais pas "Nouvelle équation"', await page.evaluate(() =>
    document.getElementById('generatorOverlay').hidden && !document.getElementById('modalOverlay').hidden));
  await page.click('#randomGenerate', { position: { x: 20, y: 10 } });
  ok('"Générer" signale l\'absence de forme compatible', /Aucune équation/.test(await page.textContent('#manualError')));
  ok('champ inchangé', (await page.evaluate(() => window.App.MathKeypad.getLatex())) === latexBefore);

  // --- Rechargement : options relues, et la génération au démarrage les respecte ---
  await page.evaluate(() => {
    var v = JSON.parse(localStorage.getItem('equations-settings'));
    v.gen_produitNul = true; v.gen_inequality = true; v.genMinDegree = 1; v.genMaxDegree = 1;
    localStorage.setItem('equations-settings', JSON.stringify(v));
  });
  await page.reload();
  await page.waitForTimeout(300);
  s = await sample(200);
  ok('options relues après rechargement (degré 1 seulement)', s.maxPow <= 1 && s.product === 0 && s.nulls === 0);

  console.log('--- erreurs JS ---');
  console.log(errs.join('\n') || '(aucune)');
  if (errs.length) process.exitCode = 1;
  await browser.close();
})();
