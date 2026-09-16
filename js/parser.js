/* Parse une équation saisie à la main, ex "25x+3x=58-6x" -> {left:Term[], right:Term[]}.
   Accepte aussi :
   - une fraction, en LaTeX ("\frac{1}{2}x+3=58-6x") ou en notation "/" plus intuitive
     ("1/2x+3=58-6x", "x/2+3=58-6x") : latexify() convertit la seconde en la première
     avant analyse, pour que la saisie n'exige jamais de connaître les balises ;
   - un terme au carré, en notation "^2" ou "²" ("3x^2-5=0", "3x²-5=0") ;
   - un produit de deux sommes entre parenthèses ("(x+2)(x+3)=0"), ou un carré d'une
     somme ("(x+3)^2=0") : reconnu comme un ProductGroup (voir expression.js), pas
     distribué automatiquement (à l'élève de le développer via le bouton "Développer").
*/
(function (App) {
  'use strict';

  var NUM = '\\d+(?:[.,]\\d+)?';
  // Le numérateur peut être un nombre ou "x" (ex. "\frac{x}{2}" = 0,5x, terme complet
  // à lui seul, pas suivi d'un "x" séparé — voir plus bas).
  var FRAC_NUMER = '(?:-?' + NUM + '|-?x)';
  var FRAC = '\\\\frac\\{' + FRAC_NUMER + '\\}\\{-?' + NUM + '\\}';
  // Suffixe de puissance optionnel après un nombre/une fraction : "x^N" (N à un ou
  // plusieurs chiffres, degré N — pas de plafond, voir modèle de données dans
  // expression.js), "x²" (toujours degré 2) ou "x" seul (degré 1), rien (degré 0).
  var POW_SUFFIX = '(?:x\\^[0-9]+|x²|x)?';
  var TOKEN_RE = new RegExp('[+-]?(?:' + FRAC + POW_SUFFIX + '|' + NUM + POW_SUFFIX + '|x\\^[0-9]+|x²|x)', 'y');
  var FRAC_BODY_RE = new RegExp('^\\\\frac\\{(' + FRAC_NUMER + ')\\}\\{(-?' + NUM + ')\\}$');
  // Numérateur "simple" (nombre ou x seul) : celui déjà pris en charge par FRAC/TOKEN_RE
  // ci-dessus comme un COEFFICIENT décimal ("\frac{1}{2}x" = 0,5x). Sert à distinguer ce
  // cas du numérateur QUELCONQUE (voir plus bas dans parseSide), qui reste un FactorGroup
  // isDivision affiché en fraction plutôt qu'un nombre replié — même chose pour un
  // dénominateur qui contiendrait x (voir denIsNumeric plus bas).
  var SIMPLE_FRAC_NUMER_RE = new RegExp('^' + FRAC_NUMER + '$');
  // Coefficient explicite devant une parenthèse ouvrante, ex. "2(" dans "2(5x-7)" : permet
  // de taper directement un FactorGroup déjà factorisé (voir plus bas dans parseSide),
  // plutôt que de ne reconnaître QUE l'équation développée.
  var FACTOR_COEFF_RE = new RegExp('^(' + NUM + ')\\(');
  // "x(" devant une parenthèse ouvrante, ex. "x(x-5)" dans "x(x-5)=0" : même idée que
  // FACTOR_COEFF_RE ci-dessus mais avec x lui-même (coeff 1, pow 1) comme facteur plutôt
  // qu'une constante — un FactorGroup.factor n'est pas forcément une constante (voir
  // expression.js et detectProduitNul dans history.js, qui traite déjà ce cas produit par
  // "Factoriser par x"). Seulement "x(", jamais "2x(" : ambigu avec un produit de deux
  // facteurs distincts "2x" et "(...)", non pris en charge par cette notation manuelle.
  var VAR_FACTOR_RE = /^x\(/;

  // Notation "/" (ex. "1/2", "-3/4", "x/2") -> "\frac{...}{...}" LaTeX, appliquée avant
  // toute analyse : la saisie reste "1/2x+3=58-6x" plutôt que d'exiger "\frac{1}{2}x...".
  var SLASH_FRAC_RE = new RegExp('(-?(?:' + NUM + '|x))/(-?' + NUM + ')', 'g');
  function latexify(str) {
    return str.replace(SLASH_FRAC_RE, '\\frac{$1}{$2}');
  }

  // Index de la parenthèse fermante correspondant à celle ouverte en `openIdx` (déjà '(').
  function findMatchingParen(s, openIdx) {
    var depth = 0;
    for (var i = openIdx; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Même principe que findMatchingParen mais pour une accolade "{" déjà ouverte en
  // `openIdx` (voir le numérateur QUELCONQUE d'un "\frac{...}{...}" ci-dessous).
  function findMatchingBrace(s, openIdx) {
    var depth = 0;
    for (var i = openIdx; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  // Suffixe d'exposant optionnel "^N" (N à un ou plusieurs chiffres) ou "²" (toujours 2)
  // juste après une parenthèse fermante — voir readParenFactor ci-dessous. Pas de suffixe
  // reconnu : exposant implicite 1, position inchangée.
  function readExponentSuffix(s, pos) {
    if (s[pos] === '²') return { exponent: 2, nextPos: pos + 1 };
    var m = /^\^([0-9]+)/.exec(s.slice(pos));
    if (m) return { exponent: parseInt(m[1], 10), nextPos: pos + m[0].length };
    return { exponent: 1, nextPos: pos };
  }

  // Lit UN facteur parenthésé à partir de `pos` (déjà un '(') : son contenu (analysé
  // récursivement via parseSide) et son exposant éventuel. Utilisé en boucle pour accepter
  // une chaîne "(A)(B)(C)..." de longueur arbitraire (voir plus bas), pas seulement deux.
  function readParenFactor(s, pos) {
    var close = findMatchingParen(s, pos);
    if (close === -1) {
      throw new Error('Parenthèse non fermée près de "' + s.slice(pos) + '".');
    }
    var inner = s.slice(pos + 1, close);
    if (!inner) throw new Error('Parenthèses vides.');
    var terms = parseSide(inner);
    var suf = readExponentSuffix(s, close + 1);
    return { terms: terms, exponent: suf.exponent, nextPos: suf.nextPos };
  }

  // Retire, si présent, le suffixe de puissance final de `body` (déjà débarrassé de son
  // signe) : renvoie { body: reste, pow: 0|1|2 }.
  var TRAILING_POW_RE = /x\^([0-9]+)$/;
  function stripPowSuffix(body) {
    var m = TRAILING_POW_RE.exec(body);
    if (m) return { body: body.slice(0, -m[0].length), pow: parseInt(m[1], 10) };
    if (body.slice(-2) === 'x²') return { body: body.slice(0, -2), pow: 2 };
    if (body.slice(-1) === 'x') return { body: body.slice(0, -1), pow: 1 };
    return { body: body, pow: 0 };
  }

  function parseSide(raw) {
    var s = latexify(raw).replace(/\s+/g, '');
    if (!s) throw new Error('Un membre de l\'équation est vide.');
    var nodes = [];
    var pos = 0;
    while (pos < s.length) {
      var sign = 1;
      var signLen = 0;
      if (s[pos] === '+') {
        signLen = 1;
      } else if (s[pos] === '-') {
        sign = -1;
        signLen = 1;
      }
      var afterSign = pos + signLen;

      // Coefficient explicite devant une parenthèse ("2(5x-7)", "-10(9+3x)") : un
      // FactorGroup déjà factorisé — SEULEMENT si rien d'autre ne suit cette parenthèse
      // (pas un second facteur ni un exposant), pour préserver exactement le comportement
      // existant ; sinon (ex. "5(x+2)(x+3)", "5(x+2)^2"), le scalaire devient le PREMIER
      // facteur d'un ProductGroup à N facteurs — voir le cas bare-parenthèse ci-dessous,
      // dont la boucle est réutilisée telle quelle après ce premier facteur scalaire.
      var coeffMatch = FACTOR_COEFF_RE.exec(s.slice(afterSign));
      if (coeffMatch) {
        var openIdxF = afterSign + coeffMatch[1].length;
        var coeffVal = parseFloat(coeffMatch[1].replace(',', '.'));
        var firstParenF = readParenFactor(s, openIdxF);
        if (firstParenF.exponent === 1 && s[firstParenF.nextPos] !== '(') {
          nodes.push({
            sign: sign,
            factor: { coeff: coeffVal, pow: 0 },
            innerTerms: firstParenF.terms
          });
          pos = firstParenF.nextPos;
          continue;
        }
        var factorsF = [
          { terms: [{ coeff: coeffVal, pow: 0 }], exponent: 1 },
          { terms: firstParenF.terms, exponent: firstParenF.exponent }
        ];
        var curPosF = firstParenF.nextPos;
        while (s[curPosF] === '(') {
          var nfF = readParenFactor(s, curPosF);
          factorsF.push({ terms: nfF.terms, exponent: nfF.exponent });
          curPosF = nfF.nextPos;
        }
        nodes.push({ sign: sign, factors: App.Expr.canonicalizeFactors(factorsF) });
        pos = curPosF;
        continue;
      }

      if (VAR_FACTOR_RE.test(s.slice(afterSign))) {
        var openIdxV = afterSign + 1; // longueur de "x"
        var firstParenV = readParenFactor(s, openIdxV);
        if (firstParenV.exponent === 1 && s[firstParenV.nextPos] !== '(') {
          nodes.push({
            sign: sign,
            factor: { coeff: 1, pow: 1 },
            innerTerms: firstParenV.terms
          });
          pos = firstParenV.nextPos;
          continue;
        }
        var factorsV = [
          { terms: [{ coeff: 1, pow: 1 }], exponent: 1 },
          { terms: firstParenV.terms, exponent: firstParenV.exponent }
        ];
        var curPosV = firstParenV.nextPos;
        while (s[curPosV] === '(') {
          var nfV = readParenFactor(s, curPosV);
          factorsV.push({ terms: nfV.terms, exponent: nfV.exponent });
          curPosV = nfV.nextPos;
        }
        nodes.push({ sign: sign, factors: App.Expr.canonicalizeFactors(factorsV) });
        pos = curPosV;
        continue;
      }

      // "\frac{...}{...}" dont le NUMÉRATEUR n'est pas un simple nombre/x (ex.
      // "\frac{7x-3}{5}"), OU dont le DÉNOMINATEUR contient x (ex. "\frac{5}{x+3}",
      // "\frac{7x-3}{x+5}") : un FactorGroup isDivision, le membre quelconque (numérateur
      // et/ou dénominateur) analysé RÉCURSIVEMENT via parseSide (même principe que
      // readParenFactor pour "(...)"). Le cas simple ("\frac{1}{2}", "\frac{x}{2}" — un
      // coefficient décimal, PAS une fraction affichée) reste géré plus bas par
      // TOKEN_RE/FRAC_BODY_RE, inchangé : on ne l'intercepte pas ici (numérateur simple ET
      // dénominateur numérique, seul cas qui retombe sans "continue" ci-dessous).
      if (s.slice(afterSign, afterSign + 6) === '\\frac{') {
        var numOpen = afterSign + 5;
        var numClose = findMatchingBrace(s, numOpen);
        if (numClose === -1) throw new Error('Fraction non fermée près de "' + s.slice(afterSign) + '".');
        var numerContent = s.slice(numOpen + 1, numClose);
        if (s[numClose + 1] === '{') {
          var denOpen = numClose + 1;
          var denClose = findMatchingBrace(s, denOpen);
          if (denClose === -1) throw new Error('Fraction non fermée près de "' + s.slice(afterSign) + '".');
          var denContent = s.slice(denOpen + 1, denClose);
          var denIsNumeric = /^-?\d+(?:[.,]\d+)?$/.test(denContent);
          if (!denIsNumeric) {
            // Dénominateur QUELCONQUE (contient x) : factorTerms (pas factor), jamais
            // replié en coefficient — voir Expr.isExpressionQuotient/wrapSideInQuotient
            // dans expression.js, la même forme que produit "÷(expression)" en cours de
            // résolution (voir divide_by_expression.js), désormais aussi saisissable
            // directement dans une équation neuve.
            if (!denContent) throw new Error('Dénominateur vide dans une fraction.');
            var denTerms = parseSide(denContent);
            if (denTerms.length === 1 && !App.Expr.isGroup(denTerms[0]) && denTerms[0].pow === 0 &&
                App.Expr.roundClean(denTerms[0].coeff) === 0) {
              throw new Error('Division par zéro dans une fraction.');
            }
            nodes.push({
              sign: sign,
              factorTerms: denTerms,
              innerTerms: parseSide(numerContent),
              isDivision: true
            });
            pos = denClose + 1;
            continue;
          }
          if (!SIMPLE_FRAC_NUMER_RE.test(numerContent)) {
            // Numérateur quelconque, dénominateur NUMÉRIQUE (ex. "\frac{7x-3}{5}") :
            // comportement inchangé.
            var denVal = parseFloat(denContent.replace(',', '.'));
            if (denVal === 0) throw new Error('Division par zéro dans une fraction.');
            nodes.push({
              sign: sign * (denVal < 0 ? -1 : 1),
              factor: { coeff: Math.abs(denVal), pow: 0 },
              innerTerms: parseSide(numerContent),
              isDivision: true
            });
            pos = denClose + 1;
            continue;
          }
        }
      }

      if (s[afterSign] === '(') {
        // Chaîne d'un ou plusieurs facteurs parenthésés ("(x+2)(x+3)", "(x+3)^2",
        // "(x+2)(x+3)(x+4)^2"...) — jamais un simple terme, boucle dédiée plutôt que
        // TOKEN_RE (qui ne connaît que des termes plats). Au moins 2 facteurs, OU un seul
        // d'exposant >= 2 (ex. "(x+3)^2" seul) : sinon rien ne justifie le ProductGroup.
        var factorsB = [];
        var curPosB = afterSign;
        while (s[curPosB] === '(') {
          var nfB = readParenFactor(s, curPosB);
          factorsB.push({ terms: nfB.terms, exponent: nfB.exponent });
          curPosB = nfB.nextPos;
        }
        if (factorsB.length < 2 && factorsB[0].exponent < 2) {
          throw new Error('Un groupe entre parenthèses doit être suivi d\'un second facteur "(...)" ou d\'un carré "^2".');
        }
        nodes.push({ sign: sign, factors: App.Expr.canonicalizeFactors(factorsB) });
        pos = curPosB;
        continue;
      }

      TOKEN_RE.lastIndex = pos;
      var m = TOKEN_RE.exec(s);
      if (!m || m.index !== pos || m[0].length === 0) {
        throw new Error('Expression invalide près de "' + s.slice(pos) + '".');
      }
      var tok = m[0];
      pos += tok.length;
      var body = tok;
      if (body[0] === '+') {
        body = body.slice(1);
      } else if (body[0] === '-') {
        sign = -1;
        body = body.slice(1);
      }
      // Le suffixe de puissance ("x^2"/"x²"/"x") appartient au terme (ex. "\frac{1}{2}x"
      // = (1/2)·x) sauf s'il est déjà DANS le numérateur d'une fraction elle-même
      // (ex. "\frac{x}{2}", qui ne se termine pas par "x" mais par "}" : rien à retirer
      // ici, géré plus bas).
      var stripped = stripPowSuffix(body);
      body = stripped.body;
      var pow = stripped.pow;
      var coeff;
      if (body === '') {
        if (pow === 0) throw new Error('Terme invalide dans "' + tok + '".');
        coeff = 1;
      } else if (body.indexOf('\\frac') === 0) {
        var fm = FRAC_BODY_RE.exec(body);
        if (!fm) throw new Error('Fraction invalide dans "' + tok + '".');
        var den = parseFloat(fm[2].replace(',', '.'));
        if (den === 0) throw new Error('Division par zéro dans une fraction.');
        if (fm[1] === 'x' || fm[1] === '-x') {
          pow = 1; // le "x" est dans le numérateur de la fraction elle-même
          coeff = (fm[1] === '-x' ? -1 : 1) / den;
        } else {
          coeff = parseFloat(fm[1].replace(',', '.')) / den;
        }
      } else {
        coeff = parseFloat(body.replace(',', '.'));
      }
      nodes.push({ coeff: sign * coeff, pow: pow });
    }
    return nodes;
  }

  function parseEquation(str) {
    var parts = str.split('=');
    if (parts.length !== 2) {
      throw new Error('L\'équation doit contenir exactement un signe =.');
    }
    var left = parseSide(parts[0]);
    var right = parseSide(parts[1]);
    return { left: left, right: right };
  }

  // ---- Pont clavier mathématique unifié (MathLive) -------------------------------------
  // Le champ <math-field> ne produit pas la notation "1/2"/"x^2" ci-dessus mais du LaTeX
  // "réel" : "\frac{1}{2}x" (accolades systématiquement pour un numérateur/dénominateur de
  // PLUSIEURS caractères, mais compact — "\frac12" — pour un seul chiffre/lettre, convention
  // LaTeX standard), "\sqrt{...}", "\times"/"\div" comme opérateurs explicites entre deux
  // termes plats (le clavier ne les insère qu'entre opérandes simples, jamais contre une
  // parenthèse). Plutôt que de dupliquer parseSide, on RAMÈNE cette sortie à la même
  // notation "N(...)"/"x^2"/"\frac{a}{b}" déjà acceptée ci-dessus, puis on délègue.

  // Lit un argument LaTeX à partir de s[pos] : soit un groupe accolades {...}, soit un seul
  // caractère (convention LaTeX standard pour \frac/\sqrt/^ sans accolades).
  function readLatexArg(s, pos) {
    if (s[pos] === '{') {
      var depth = 0;
      for (var i = pos; i < s.length; i++) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') {
          depth--;
          if (depth === 0) return { text: s.slice(pos + 1, i), next: i + 1 };
        }
      }
      throw new Error('Accolade non fermée.');
    }
    if (pos >= s.length) throw new Error('Argument manquant après "' + s.slice(0, pos) + '".');
    return { text: s[pos], next: pos + 1 };
  }

  // "\frac12" / "\frac1{23}" / "\frac{1}2" -> "\frac{1}{2}" (accolades systématiques) :
  // parseSide n'accepte que la forme accoladée (FRAC ci-dessus).
  function normalizeFracBraces(s) {
    return s.replace(/\\frac(\{[^{}]*\}|[^{}])(\{[^{}]*\}|[^{}])/g, function (m, a, b) {
      var braceA = a.charAt(0) === '{' ? a : '{' + a + '}';
      var braceB = b.charAt(0) === '{' ? b : '{' + b + '}';
      return '\\frac' + braceA + braceB;
    });
  }

  var SQRT_NUM_RE = new RegExp('^-?' + NUM + '$');
  // "\sqrt{25}" -> "+5", "\sqrt5" -> "+2.23606797749979" : la racine carrée n'a pas
  // d'équivalent dans le modèle de données (pas de noeud dédié, voir CLAUDE.md), donc on
  // l'évalue immédiatement en nombre décimal — un Term({coeff, pow:0}) l'exprime très bien —
  // sauf si le radicande n'est pas un simple nombre, auquel cas c'est un message clair
  // plutôt que l'erreur générique de parseSide.
  function foldSqrt(s) {
    var idx;
    var guard = 0;
    while ((idx = s.indexOf('\\sqrt')) !== -1) {
      var arg = readLatexArg(s, idx + 5);
      if (!SQRT_NUM_RE.test(arg.text)) {
        throw new Error('La racine carrée n\'est prise en charge que sur un nombre.');
      }
      var radicand = parseFloat(arg.text.replace(',', '.'));
      if (radicand < 0) throw new Error('Racine carrée d\'un nombre négatif impossible.');
      var value = Math.sqrt(radicand);
      s = s.slice(0, idx) + (value < 0 ? '-' : '+') + Math.abs(value) + s.slice(arg.next);
      if (++guard > 20) throw new Error('Expression trop complexe.');
    }
    return s;
  }

  // Un terme plat isolé (nombre, x, "x^n", "Nx", "Nx^n", signé) tel qu'il peut apparaître de
  // part et d'autre d'un "\times"/"\div" explicite — jamais une parenthèse ou une fraction
  // (le clavier ne les place qu'entre opérandes simples).
  var LATEX_ATOM_SRC = '-?(?:' + NUM + '(?:x(?:\\^[0-9]+)?)?|x(?:\\^[0-9]+)?)';
  var TIMES_DIV_RE = new RegExp('(' + LATEX_ATOM_SRC + ')\\\\(times|div)(' + LATEX_ATOM_SRC + ')');
  var FLAT_ATOM_RE = new RegExp('^(-)?(?:(' + NUM + ')(x)?(?:\\^([0-9]+))?|(x)(?:\\^([0-9]+))?)$');

  function parseFlatAtom(str) {
    var m = FLAT_ATOM_RE.exec(str);
    if (!m) throw new Error('Expression invalide dans "' + str + '".');
    var neg = !!m[1];
    var coeff, pow;
    if (m[5]) {
      coeff = 1;
      pow = m[6] ? parseInt(m[6], 10) : 1;
    } else {
      coeff = parseFloat(m[2].replace(',', '.'));
      pow = m[3] ? (m[4] ? parseInt(m[4], 10) : 1) : 0;
    }
    return { coeff: neg ? -coeff : coeff, pow: pow };
  }

  // Reformate {coeff,pow} en terme plat TOUJOURS signé explicitement ("+6", "-2x"), pour
  // pouvoir être splicé n'importe où dans la chaîne (y compris juste après un autre terme
  // sans "+" implicite) sans jamais fusionner accidentellement deux nombres adjacents.
  function formatFlatAtom(coeff, pow) {
    var sign = coeff < 0 ? '-' : '+';
    var abs = Math.abs(coeff);
    var xStr = pow === 0 ? '' : (pow === 1 ? 'x' : 'x^' + pow);
    var numStr = (pow > 0 && abs === 1) ? '' : String(abs);
    return sign + numStr + xStr;
  }

  // Replie chaque "\times"/"\div" explicite entre deux termes plats en un seul terme
  // équivalent ("2\times3" -> "+6", "x\times x" -> "+x^2"), en boucle (gère les chaînes,
  // ex. "2\times3\times x"). Un "\times"/"\div" qui ne touche pas deux termes plats des
  // deux côtés (ex. contre une parenthèse) n'a pas d'équivalent représentable : message
  // clair plutôt que l'erreur générique de parseSide.
  function foldTimesDiv(s) {
    var guard = 0;
    while (TIMES_DIV_RE.test(s)) {
      s = s.replace(TIMES_DIV_RE, function (m, aStr, op, bStr) {
        var a = parseFlatAtom(aStr);
        var b = parseFlatAtom(bStr);
        if (op === 'times') {
          return formatFlatAtom(a.coeff * b.coeff, a.pow + b.pow);
        }
        if (b.pow !== 0) throw new Error('Division par une expression contenant x non prise en charge.');
        if (b.coeff === 0) throw new Error('Division par zéro.');
        return formatFlatAtom(a.coeff / b.coeff, a.pow);
      });
      // formatFlatAtom signe TOUJOURS explicitement son résultat (voir son commentaire) —
      // utile pour spliceer en milieu de chaîne sans fusion accidentelle, mais quand le
      // remplacement atterrit juste après un signe déjà présent dans `s` (ex. chaîne de 3+
      // "\times", "x^2\times x" repliée en tête de "+x^2\times x=8" -> "+"+"+x^3" = "++x^3"),
      // ça produit un double signe : on le simplifie ici plutôt que dans formatFlatAtom (qui
      // ne connaît pas le contexte autour de la sous-chaîne remplacée).
      var prevS;
      do {
        prevS = s;
        s = s.replace(/\+\+/g, '+').replace(/\+-/g, '-').replace(/-\+/g, '-').replace(/--/g, '+');
      } while (s !== prevS);
      if (++guard > 50) throw new Error('Expression trop complexe.');
    }
    if (/\\times|\\div/.test(s)) {
      throw new Error('Multiplication ou division non prise en charge à cet endroit : utilisez la notation "N(...)" pour multiplier par une parenthèse.');
    }
    return s;
  }

  // Point d'entrée pour le champ <math-field> unifié : convertit son contenu LaTeX en la
  // notation déjà acceptée par parseSide, puis délègue.
  function parseLatexSide(latex) {
    // "{,}" : convention LaTeX de MathLive pour une virgule décimale française (voir
    // MathfieldElement.decimalSeparator, réglé sur ',' dans mathKeypad.js) et ce que produit
    // App.Expr.formatNumberLatex pour préremplir le champ (ex. "Générer aléatoirement") —
    // équivalent à la simple virgule déjà acceptée par NUM ci-dessus.
    var s = String(latex).replace(/\{,\}/g, ',').replace(/\\left|\\right/g, '')
      .replace(/\^\{([0-9]+)\}/g, '^$1').replace(/\s+/g, '');
    if (!s) throw new Error('Un membre de l\'équation est vide.');
    s = foldSqrt(s);
    s = foldTimesDiv(s);
    s = normalizeFracBraces(s);
    return parseSide(s);
  }

  function parseLatexEquation(latex) {
    var parts = String(latex).split('=');
    if (parts.length !== 2) {
      throw new Error('L\'équation doit contenir exactement un signe =.');
    }
    return { left: parseLatexSide(parts[0]), right: parseLatexSide(parts[1]) };
  }

  App.Parser = {
    parseSide: parseSide,
    parseEquation: parseEquation,
    latexify: latexify,
    parseLatexSide: parseLatexSide,
    parseLatexEquation: parseLatexEquation
  };
})(window.App = window.App || {});
