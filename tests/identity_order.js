const { chromium } = require('playwright');
const SCRATCH = __dirname + '/screenshots';
const FILE = 'file:///home/antoine/Developpement/Equations/index.html';

function ok(label, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' - ' + label);
  if (!cond) process.exitCode = 1;
}

async function freshPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push('[pageerror] ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('[console.error] ' + m.text()); });
  await page.goto(FILE);
  return { page, errs };
}

async function typeEquation(page, raw) {
  await page.evaluate((eq) => { window.App.History.startNewEquation(window.App.Parser.parseEquation(eq)); }, raw);
}

(async () => {
  const browser = await chromium.launch();
  let allErrs = [];

  // --- 1) Identite 1 (a+b)^2 : a=2, b=x -> (2+x)^2 au lieu de (x+2)^2 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2+4x+4=0');
    await page.evaluate(() => {
      var H = window.App.History;
      H.toggleTermSelection('left', 0);
      H.toggleTermSelection('left', 1);
      H.toggleTermSelection('left', 2);
      H.enterFactorWithSelection();
      H.chooseFactorMode(1);
      H.setIdentityFieldLatex('2');
      H.setIdentityFocus('b');
      H.setIdentityFieldLatex('x');
      H.confirm();
    });
    await page.waitForTimeout(100);
    const eq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('1) identite 1, a=2 b=x:', JSON.stringify(eq));
    ok('1) group is (2+x)^2: left=[2,x] isSquare', JSON.stringify(eq.left[0]) === JSON.stringify({ sign: 1, factors: [{ terms: [{ coeff: 2, pow: 0 }, { coeff: 1, pow: 1 }], exponent: 2 }] }));
    await page.screenshot({ path: `${SCRATCH}/identity1_order.png` });
    allErrs = allErrs.concat(errs);
    await page.close();
  }

  // --- 2) Identite 1 regression : a=x, b=2 (comportement par defaut inchange) -> (x+2)^2 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2+4x+4=0');
    await page.evaluate(() => {
      var H = window.App.History;
      H.toggleTermSelection('left', 0);
      H.toggleTermSelection('left', 1);
      H.toggleTermSelection('left', 2);
      H.enterFactorWithSelection();
      H.chooseFactorMode(1);
      H.setIdentityFieldLatex('x'); // idFocus='a' par defaut -> a=x
      H.setIdentityFocus('b');
      H.setIdentityFieldLatex('2');
      H.confirm();
    });
    await page.waitForTimeout(100);
    const eq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('2) identite 1, a=x b=2 (defaut):', JSON.stringify(eq));
    ok('2) group is (x+2)^2 (unchanged default order)', JSON.stringify(eq.left[0]) === JSON.stringify({ sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 2 }] }));
    allErrs = allErrs.concat(errs);
    await page.close();
  }

  // --- 3) Identite 2 (a-b)^2 : a=2, b=x -> (2-x)^2 au lieu de (x-2)^2 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2-4x+4=0');
    await page.evaluate(() => {
      var H = window.App.History;
      H.toggleTermSelection('left', 0);
      H.toggleTermSelection('left', 1);
      H.toggleTermSelection('left', 2);
      H.enterFactorWithSelection();
      H.chooseFactorMode(2);
      H.setIdentityFieldLatex('2');
      H.setIdentityFocus('b');
      H.setIdentityFieldLatex('x');
      H.confirm();
    });
    await page.waitForTimeout(100);
    const eq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('3) identite 2, a=2 b=x:', JSON.stringify(eq));
    ok('3) group is (2-x)^2: left=[2,-x] isSquare', JSON.stringify(eq.left[0]) === JSON.stringify({ sign: 1, factors: [{ terms: [{ coeff: 2, pow: 0 }, { coeff: -1, pow: 1 }], exponent: 2 }] }));
    await page.screenshot({ path: `${SCRATCH}/identity2_order.png` });
    allErrs = allErrs.concat(errs);
    await page.close();
  }

  // --- 4) Identite 3 (a-b)(a+b) : a=2 (constante), b=x -> -(2-x)(2+x), equivaut a x^2-4 ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2-4=0');
    await page.evaluate(() => {
      var H = window.App.History;
      H.toggleTermSelection('left', 0);
      H.toggleTermSelection('left', 1);
      H.enterFactorWithSelection();
      H.chooseFactorMode(3);
      H.setIdentityFieldLatex('2');
      H.setIdentityFocus('b');
      H.setIdentityFieldLatex('x');
      H.confirm();
    });
    await page.waitForTimeout(100);
    const eq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('4) identite 3, a=2(const) b=x:', JSON.stringify(eq));
    ok('4) group is -(2-x)(2+x): sign=-1, left=[2,-x], right=[2,x]', JSON.stringify(eq.left[0]) === JSON.stringify({ sign: -1, factors: [{ terms: [{ coeff: 2, pow: 0 }, { coeff: -1, pow: 1 }], exponent: 1 }, { terms: [{ coeff: 2, pow: 0 }, { coeff: 1, pow: 1 }], exponent: 1 }] }));

    // Verifie que la valeur (developpee) reste bien x^2-4, malgre le signe -1 global.
    const expanded = await page.evaluate(() => window.App.Expr.expandProductGroup(window.App.History.lastEquation().left[0]));
    console.log('4) developpement de -(2-x)(2+x):', JSON.stringify(expanded));
    ok('4) expands back to x^2-4 (mathematically correct despite sign flip)', JSON.stringify(expanded.sort((a,b)=>b.pow-a.pow)) === JSON.stringify([{ coeff: 1, pow: 2 }, { coeff: -4, pow: 0 }]));

    await page.screenshot({ path: `${SCRATCH}/identity3_order.png` });
    allErrs = allErrs.concat(errs);
    await page.close();
  }

  // --- 5) Identite 3 regression : a=x, b=2 (comportement par defaut) -> (x-2)(x+2) ---
  {
    const { page, errs } = await freshPage(browser);
    await typeEquation(page, 'x^2-4=0');
    await page.evaluate(() => {
      var H = window.App.History;
      H.toggleTermSelection('left', 0);
      H.toggleTermSelection('left', 1);
      H.enterFactorWithSelection();
      H.chooseFactorMode(3);
      H.setIdentityFieldLatex('x'); // a=x par defaut
      H.setIdentityFocus('b');
      H.setIdentityFieldLatex('2');
      H.confirm();
    });
    await page.waitForTimeout(100);
    const eq = await page.evaluate(() => window.App.History.lastEquation());
    console.log('5) identite 3, a=x b=2 (defaut):', JSON.stringify(eq));
    ok('5) group is (x-2)(x+2), sign=1 (unchanged default)', JSON.stringify(eq.left[0]) === JSON.stringify({ sign: 1, factors: [{ terms: [{ coeff: 1, pow: 1 }, { coeff: -2, pow: 0 }], exponent: 1 }, { terms: [{ coeff: 1, pow: 1 }, { coeff: 2, pow: 0 }], exponent: 1 }] }));
    allErrs = allErrs.concat(errs);
    await page.close();
  }

  console.log('--- erreurs JS (toutes pages) ---');
  console.log(allErrs.join('\n') || '(aucune)');
  if (allErrs.length) process.exitCode = 1;
  await browser.close();
})();
