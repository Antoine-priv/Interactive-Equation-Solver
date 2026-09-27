/* Levels : catalogue de la campagne "La Carte des équations" (voir
   docs/gamification/plan.md). Données pures : régions (ZONES), niveaux (LEVELS) et badges
   (BADGES). Aucune logique ici — la progression vit dans progress.js, l'écran de carte dans
   map.js, le déroulé d'un niveau dans campaign.js.

   Un niveau :
   - `latex` : l'équation de départ, lue par App.Parser.parseLatexEquation ;
   - `sol` : l'ensemble-solution attendu, sous la forme des intervalles d'App.Ineq ;
     `domain` à la place de `sol` pour un niveau "Df seul" (kind 'domain') ;
   - `parts` : plusieurs équations à résoudre l'une après l'autre dans le même niveau ;
   - `requireDomain` : la solution n'est acceptée qu'une fois la condition d'existence posée ;
   - `domainStar` : sans condition d'existence posée et résolue, la réussite est limitée à ★
     (le Marais) ;
   - `par` : nombre d'étapes (hors "Simplifier") de la solution de référence, pour ★★★
     (voir tests/campaign_reference_*.js) ; aucun dans le Port (tutoriel), sans étoiles,
     voir App.Levels.starred ;
   - `feat` : actions présentées par ce niveau (boutons/touches masqués avant, voir
     campaign.js) ;
   - `hints` : indices, de la notion vers l'action précise. */
(function (App) {
  'use strict';

  // ---- Ensembles-solution (mêmes intervalles qu'App.Ineq) ----
  function P() {
    return Array.prototype.slice.call(arguments).sort(function (a, b) { return a - b; })
      .map(function (r) { return { from: r, to: r, fromIncluded: true, toIncluded: true }; });
  }
  function I(from, fromIncluded, to, toIncluded) {
    return [{ from: from, to: to, fromIncluded: !!fromIncluded && from !== -Infinity, toIncluded: !!toIncluded && to !== Infinity }];
  }
  function U() { return [].concat.apply([], arguments); }
  var E = [];
  var INF = Infinity;
  var R = I(-INF, false, INF, false);
  function allBut() {
    var pts = Array.prototype.slice.call(arguments).sort(function (a, b) { return a - b; });
    var out = [], prev = -INF;
    pts.forEach(function (p) { out.push({ from: prev, to: p, fromIncluded: false, toIncluded: false }); prev = p; });
    out.push({ from: prev, to: INF, fromIncluded: false, toIncluded: false });
    return out;
  }

  // Régions : nom et symbole seulement ; leur forme, leurs décors et la position de leur
  // panneau sont dessinés par mapArt.js à partir des positions (x, y) des niveaux.
  var ZONES = [
    { id: 'port', name: 'Le Port', sub: 'Tutoriel', mark: '=' },
    { id: 'plaine', name: 'La Plaine', sub: 'Équations du 1er degré', mark: 'x' },
    { id: 'foret', name: 'La Forêt', sub: 'Fractions', mark: '½' },
    { id: 'coll', name: 'Les Collines', sub: 'Inéquations', mark: '<' },
    { id: 'mont', name: 'La Montagne', sub: 'Degré 2', mark: 'x²' },
    { id: 'grotte', name: 'La Grotte', sub: 'Identités remarquables', mark: '(a+b)²' },
    { id: 'source', name: 'La Source', sub: 'Racine carrée', mark: '√' },
    { id: 'marais', name: 'Le Marais', sub: 'Ensembles de définition', mark: '≠' },
    { id: 'cit', name: 'La Citadelle', sub: 'Tableau de signes', mark: '±' },
    { id: 'obs', name: 'L\'Observatoire', sub: 'Problèmes en plusieurs parties', mark: 'f(x)' },
    { id: 'som', name: 'Le Sommet', sub: 'Défi du jour', mark: '★' }
  ];

  var BADGES = [
    { id: 'premiers-pas', name: 'Premiers pas', desc: 'Terminer le Port', mark: '=' },
    { id: 'equilibriste', name: 'Équilibriste', desc: 'Réussir l\'épreuve de la Plaine', mark: 'x' },
    { id: 'retourneur', name: 'Retourneur', desc: 'Inverser le sens d\'une inégalité', mark: '<' },
    { id: 'alpiniste', name: 'Alpiniste', desc: 'Réussir l\'épreuve de la Montagne', mark: 'x²' },
    { id: 'racine-double', name: 'Racine double', desc: 'Séparer les branches ±', mark: '√' },
    { id: 'chasseur-interdits', name: 'Chasseur d\'interdits', desc: 'Écarter une valeur interdite', mark: '≠' },
    { id: 'stratege', name: 'Stratège', desc: 'Réussir l\'épreuve de la Citadelle', mark: '±' },
    { id: 'astronome', name: 'Astronome', desc: 'Réussir l\'épreuve de l\'Observatoire', mark: 'f' },
    { id: 'perfectionniste', name: 'Perfectionniste', desc: 'Toutes les ★★★ d\'une région', mark: '★' },
    { id: 'cartographe', name: 'Cartographe', desc: 'Atteindre le Sommet', mark: '⌂' }
  ];

  var LEVELS = [
    // ---- Le Port (tutoriel) ----
    // `code` : libellé affiché quand il diffère de l'id (l'ancien T2 a été fusionné dans T1,
    // l'ancien T5 « Rassembler » (t6) dans T6 ; les ids restent ceux des sauvegardes, seul
    // l'affichage est renuméroté).
    { id: 't1', zone: 'port', x: 200, y: 790, req: [], title: 'Premier pas', latex: 'x+3=7', sol: P(4),
      feat: ['simplify'], learn: 'Ajouter ou retirer la même chose des deux côtés',
      hints: ['Pour isoler x, il faut faire disparaître le +3.', 'Clique sur Opération, tape −3 dans le pavé, puis Simplifier.'] },
    { id: 't3', code: 'T2', zone: 'port', x: 300, y: 740, req: ['t1'], title: 'Diviser', latex: '3x=12', sol: P(4),
      learn: 'Diviser par le coefficient',
      hints: ['3x veut dire 3 fois x.', 'Opération ÷3, puis Simplifier.'] },
    { id: 't4', code: 'T3', zone: 'port', x: 225, y: 650, req: ['t3'], title: 'Faire glisser', latex: 'x+8=3', sol: P(-5),
      enables: 'autoSimplify',
      learn: 'Passer un terme de l\'autre côté',
      hints: ['Un terme peut passer de l\'autre côté du « = ».', 'Attrape le 8 et lâche-le de l\'autre côté du « = ».'] },
    { id: 't5', code: 'T4', zone: 'port', x: 320, y: 585, req: ['t4'], title: 'Deux étapes', latex: '2x+5=11', sol: P(3),
      learn: 'Soustraire puis diviser',
      hints: ['Commence par le terme sans x.', 'Retire 5, puis glisse le 2 de 2x de l\'autre côté.'] },
    { id: 't7', code: 'T5', zone: 'port', x: 455, y: 560, req: ['t5'], title: 'Grand large', latex: '3x+2x+3=2x+12', sol: P(3),
      boss: true, badge: 'premiers-pas', learn: 'Regrouper les termes semblables, des x des deux côtés',
      hints: ['3x et 2x peuvent se réunir, puis rassemble tous les x du même côté.',
        'Sélectionne 3x et 2x, puis Simplifier. Retire ensuite 2x des deux côtés, puis 3, puis divise par 3.'] },

    // ---- La Plaine ----
    { id: 'l1', zone: 'plaine', x: 820, y: 560, req: ['t7'], title: 'Les négatifs', latex: '4x-7=-2x+5', sol: P(2), par: 3,
      learn: 'Signes et x des deux côtés',
      hints: ['Commence par rassembler les x.', 'Ajoute 2x des deux côtés, puis 7, puis divise par 6.'] },
    { id: 'l2', zone: 'plaine', x: 910, y: 615, req: ['l1'], title: 'Virgules', latex: '0,5x+1,2=3', sol: P(3.6), par: 2,
      learn: 'Coefficients décimaux',
      hints: ['Les décimaux se manipulent comme les entiers.', 'Retire 1,2, puis divise par 0,5.'] },
    { id: 'l3', zone: 'plaine', x: 850, y: 705, req: ['l2'], title: 'Parenthèses', latex: '3(x+2)=2x-1', sol: P(-7), par: 3,
      feat: ['expand'], learn: 'Développer avant de résoudre',
      hints: ['La parenthèse empêche d\'isoler x.', 'Sélectionne 3(x+2) et clique sur Développer.'] },
    { id: 'l4', zone: 'plaine', x: 950, y: 760, req: ['l3'], title: 'Le moins devant', latex: '5-2(x-3)=x', sol: P(11 / 3), par: 4,
      learn: 'Distribuer un facteur négatif',
      hints: ['−2 multiplie les deux termes de la parenthèse.', 'Développe −2(x−3) : on obtient −2x+6.'] },
    { id: 'l5', zone: 'plaine', x: 1045, y: 705, req: ['l4'], title: 'Aucune ou toutes', latex: '2x+3=2x+5', sol: E, par: 1,
      learn: 'Reconnaître S = ∅', trap: 'Les x disparaissent : il faut lire la ligne 3 = 5.',
      hints: ['Que se passe-t-il si on retire 2x ?', 'Retire 2x des deux côtés et lis le résultat.'] },
    { id: 'lB', zone: 'plaine', x: 1080, y: 595, req: ['l5'], title: 'Épreuve de la Plaine', latex: '2(3x-1)-(x+4)=3(x-2)+7',
      sol: P(3.5), par: 4, boss: true, badge: 'equilibriste', learn: 'Tout le 1er degré à la fois',
      hints: ['Développe chaque parenthèse.', 'Après développement et simplification : 5x−6 = 3x+1.'] },

    // ---- La Forêt ----
    { id: 'f1', zone: 'foret', x: 845, y: 440, req: ['l1'], title: 'Le tiers', latex: '\\frac{x}{3}+1=4', sol: P(9), par: 2,
      learn: 'Multiplier pour chasser un dénominateur',
      hints: ['Isole d\'abord la fraction.', 'Retire 1, puis multiplie par 3.'] },
    { id: 'f2', zone: 'foret', x: 925, y: 345, req: ['f1'], title: 'Numérateur', latex: '\\frac{2x+1}{5}=3', sol: P(7), par: 3,
      learn: 'Fraction d\'une expression',
      hints: ['Le 5 divise tout le numérateur.', 'Multiplie par 5, puis résous 2x+1 = 15.'] },
    { id: 'f3', zone: 'foret', x: 1050, y: 265, req: ['f2'], title: 'Deux fractions', latex: '\\frac{x}{2}+\\frac{x}{3}=5', sol: P(6), par: 1,
      boss: true, learn: 'Dénominateur commun',
      hints: ['2 et 3 divisent tous les deux 6.', 'Multiplie les deux côtés par 6.'] },

    // ---- Les Collines ----
    { id: 'i1', zone: 'coll', x: 1000, y: 835, req: ['l5'], title: 'Plus petit que', latex: 'x+4<9', sol: I(-INF, false, 5, false), par: 1,
      learn: 'Mêmes règles que pour =',
      hints: ['On résout comme une équation.', 'Retire 4 des deux côtés.'] },
    { id: 'i2', zone: 'coll', x: 1090, y: 905, req: ['i1'], title: 'Le retournement', latex: '-2x\\geq6', sol: I(-INF, false, -3, true), par: 1,
      badge: 'retourneur', learn: 'Diviser par un négatif inverse le sens', trap: 'Le sens de l\'inégalité doit changer.',
      hints: ['Que devient le sens quand on divise par un négatif ?', 'Divise par −2 : ≥ devient ≤.'] },
    { id: 'i3', zone: 'coll', x: 1180, y: 865, req: ['i2'], title: 'Des deux côtés', latex: '3x-1>4x+7', sol: I(-INF, false, -8, false), par: 2,
      learn: 'Choisir le côté où garder x',
      hints: ['Rassemble les x du côté où il y en a le plus.', 'Retire 3x, puis retire 7 : −8 > x.'] },
    { id: 'iB', zone: 'coll', x: 1265, y: 945, req: ['i3'], title: 'Épreuve des Collines', latex: '2(x-1)\\leq5x+4', sol: I(-2, true, INF, false), par: 4,
      boss: true, learn: 'Inéquation avec parenthèses',
      hints: ['Développe d\'abord.', '2x−2 ≤ 5x+4, puis rassemble les x.'] },

    // ---- La Montagne ----
    { id: 'p1', zone: 'mont', x: 1180, y: 560, req: ['lB'], title: 'Produit nul', latex: '(x-2)(x+5)=0', sol: P(-5, 2), par: 3,
      feat: ['produitnul'], learn: 'Un produit est nul si l\'un de ses facteurs l\'est',
      hints: ['Un produit égal à 0 : un des facteurs vaut 0.', 'Clique sur Produit nul, puis résous chaque colonne.'] },
    { id: 'p2', zone: 'mont', x: 1260, y: 515, req: ['p1'], title: 'Trois facteurs', latex: 'x(x-1)(2x+3)=0', sol: P(-1.5, 0, 1), par: 4,
      learn: 'Autant de colonnes que de facteurs',
      hints: ['Même méthode, avec trois facteurs.', 'Produit nul, puis résous les trois colonnes.'] },
    { id: 'p3', zone: 'mont', x: 1330, y: 585, req: ['p2'], title: 'Mettre en facteur', latex: 'x^2+3x=0', sol: P(-3, 0), par: 3,
      feat: ['factor'], learn: 'Factoriser par x',
      hints: ['x² et 3x ont un facteur commun.', 'Sélectionne les deux termes, Factoriser, facteur commun x.'] },
    { id: 'p4', zone: 'mont', x: 1395, y: 655, req: ['p3'], title: 'Facteur commun', latex: '(x+1)(2x-3)+(x+1)(x+4)=0',
      sol: P(-1, -1 / 3), par: 5, learn: 'Factoriser par une parenthèse',
      hints: ['(x+1) apparaît dans les deux produits.', 'Factorise par (x+1), puis simplifie la grande parenthèse.'] },
    { id: 'p5', zone: 'mont', x: 1480, y: 650, req: ['p4'], title: 'Tout d\'un côté', latex: 'x^2=5x', sol: P(0, 5), par: 4,
      learn: 'Ramener à 0 avant de factoriser', trap: 'Diviser par x fait perdre la solution 0.',
      hints: ['Un produit nul demande un « = 0 ».', 'Retire 5x des deux côtés, puis factorise par x.'] },
    { id: 'pB', zone: 'mont', x: 1505, y: 530, req: ['p5', 'g3'], title: 'Épreuve de la Montagne', latex: 'x^3-4x=0', sol: P(-2, 0, 2), par: 6,
      boss: true, badge: 'alpiniste', learn: 'Degré 3 : factoriser deux fois',
      hints: ['Commence par le facteur commun x.', 'x(x²−4) : x²−4 est une différence de carrés.'] },

    // ---- La Grotte ----
    { id: 'g1', zone: 'grotte', x: 1190, y: 440, req: ['p1'], title: 'Un carré à développer', latex: '(x-7)^2=x^2-7', sol: P(4), par: 4,
      learn: 'Développer (a − b)² : les x² s\'annulent',
      hints: ['Développe le carré.', '(x−7)² = x² − 14x + 49, puis retire x² des deux côtés.'] },
    { id: 'g2', zone: 'grotte', x: 1275, y: 410, req: ['g1'], title: 'Toujours faux', latex: '(5+x)(5-x)=9-x^2', sol: E, par: 2,
      learn: '(a + b)(a − b) = a² − b²', trap: 'Les x disparaissent des deux côtés.',
      hints: ['Développe le produit.', '25 − x² = 9 − x² : ajoute x² des deux côtés.'] },
    { id: 'g3', zone: 'grotte', x: 1370, y: 455, req: ['g2', 'p3'], title: 'Différence de carrés', latex: 'x^2-9=0', sol: P(-3, 3), par: 4,
      feat: ['identities'], learn: 'a² − b² = (a − b)(a + b)',
      hints: ['9 = 3².', 'Factoriser, identité a² − b² avec a = x et b = 3.'] },
    { id: 'g4', zone: 'grotte', x: 1340, y: 350, req: ['g3'], title: 'Moins moins', latex: '9-(-x^2)-6x=0', sol: P(3), par: 4,
      learn: 'Simplifier −(−x²), puis reconnaître (x − 3)²',
      hints: ['−(−x²) vaut +x².', 'Simplifie, puis identité (a − b)² avec a = x et b = 3.'] },
    { id: 'g5', zone: 'grotte', x: 1420, y: 330, req: ['g4'], title: 'Factoriser par −1', latex: '-49-x^2+14x=0', sol: P(7), par: 4,
      learn: 'Mettre −1 en facteur pour retrouver une identité', trap: 'Sans le −1, aucune identité ne s\'applique.',
      hints: ['Le x² a un signe −.', 'Factorise par −1, puis entre dans la parenthèse : (a − b)² avec a = x, b = 7.'] },
    { id: 'g6', zone: 'grotte', x: 1360, y: 270, req: ['g5'], title: 'Puissance 4', latex: 'x^4-8x^2+16=0', sol: P(-2, 2), par: 6,
      learn: 'a = x² : x⁴ − 8x² + 16 = (x² − 4)²', trap: 'x² − 4 se factorise encore.',
      hints: ['x⁴ = (x²)² et 16 = 4².', 'Identité (a − b)² avec a = x² et b = 4, puis a² − b² sur x² − 4.'] },
    { id: 'gB', zone: 'grotte', x: 1450, y: 250, req: ['g6'], title: 'Deux carrés', latex: '(2x+1)^2-(x-3)^2=0', sol: P(-4, 2 / 3), par: 5,
      boss: true, learn: 'a² − b² avec des expressions',
      hints: ['C\'est une différence de deux carrés.', 'Identité a² − b² avec a = 2x+1 et b = x−3.'] },

    // ---- La Source ----
    { id: 'r1', zone: 'source', x: 1495, y: 775, req: ['p5'], title: 'Racine carrée', latex: 'x^2=16', sol: P(-4, 4), par: 1,
      feat: ['sqrt'], badge: 'racine-double', learn: 'Racine carrée des deux côtés, puis ±',
      hints: ['Quel nombre au carré donne 16 ?', 'Touche √ du pavé Opération, puis Simplifier.'] },
    { id: 'r2', zone: 'source', x: 1405, y: 835, req: ['r1'], title: 'Carré d\'une expression', latex: '(x+3)^2=9', sol: P(-6, 0), par: 3,
      learn: 'Deux colonnes à résoudre',
      hints: ['Même méthode qu\'avec x².', 'Racine carrée, puis résous x+3 = 3 et x+3 = −3.'] },
    { id: 'r3', zone: 'source', x: 1305, y: 815, req: ['r2'], title: 'Racine non entière', latex: '(2x-1)^2=5',
      sol: P((1 - Math.sqrt(5)) / 2, (1 + Math.sqrt(5)) / 2), par: 5, learn: 'Une racine qui ne tombe pas juste',
      hints: ['√5 n\'est pas entier, ce n\'est pas grave.', 'Racine carrée, puis résous 2x−1 = √5 et 2x−1 = −√5.'] },
    { id: 'r4', zone: 'source', x: 1310, y: 725, req: ['r3'], title: 'Pas de racine', latex: 'x^2=-4', sol: E, par: 1,
      boss: true, learn: 'Un carré n\'est jamais négatif', trap: 'S = ∅, rien à calculer.',
      hints: ['x² peut-il être négatif ?', 'Un carré est toujours positif ou nul : aucune solution.'] },

    // ---- Le Marais ----
    { id: 'm1', zone: 'marais', x: 1600, y: 410, req: ['f3', 'pB'], title: 'Df d\'un quotient', latex: '\\frac{1}{1+x}=0',
      kind: 'domain', domain: allBut(-1), par: 2, feat: ['existence'], statement: 'Trouve l\'ensemble de définition de f(x) = 1/(1+x).',
      learn: 'Un dénominateur ne doit pas s\'annuler',
      hints: ['Le dénominateur ne doit pas valoir 0.', 'Double-clique le dénominateur, puis Condition d\'existence.'] },
    { id: 'm2', zone: 'marais', x: 1630, y: 300, req: ['m1'], title: 'Df d\'une racine', latex: '\\sqrt{3-2x}=0',
      kind: 'domain', domain: I(-INF, false, 1.5, true), par: 3, statement: 'Trouve l\'ensemble de définition de g(x) = √(3 − 2x).',
      learn: 'Ce qui est sous la racine doit être positif',
      hints: ['On ne prend la racine que d\'un nombre positif ou nul.', 'Double-clique la racine, puis Condition d\'existence.'] },
    { id: 'm3', zone: 'marais', x: 1720, y: 245, req: ['m2'], domainStar: true, title: 'Dénominateur en x', latex: '\\frac{3}{x-2}=1', sol: P(5), par: 6,
      learn: 'Poser x ≠ 2, puis résoudre',
      hints: ['Commence par la condition d\'existence.', 'Puis multiplie les deux côtés par (x−2).'] },
    { id: 'm4', zone: 'marais', x: 1730, y: 355, req: ['m3'], domainStar: true, title: 'Quotient', latex: '\\frac{x+1}{x-3}=2', sol: P(7), par: 7,
      learn: 'Multiplier par un dénominateur en x',
      hints: ['Condition d\'existence d\'abord.', 'Multiplie par (x−3) : x+1 = 2(x−3).'] },
    { id: 'm5', zone: 'marais', x: 1750, y: 500, req: ['m4'], domainStar: true, title: 'Le faux ami', latex: '\\frac{(x+3)(x+1)}{x+3}=0', sol: P(-1), par: 3,
      requireDomain: true, badge: 'chasseur-interdits', learn: '−3 annule le numérateur mais est interdite',
      trap: 'Garder −3 comme solution.',
      hints: ['Une valeur interdite ne peut pas être solution.', 'Pose la condition d\'existence du dénominateur avant de conclure.'] },
    { id: 'm6', zone: 'marais', x: 1845, y: 470, req: ['m5'], domainStar: true, title: 'Le faux ami caché', latex: '\\frac{x^2-9}{x+3}=0', sol: P(3), par: 4,
      requireDomain: true, learn: 'Le même piège, après factorisation',
      hints: ['Le numérateur est une différence de carrés.', 'Condition d\'existence, puis factorise x² − 9.'] },
    { id: 'm7', zone: 'marais', x: 1840, y: 360, req: ['m6'], domainStar: true, title: 'Racine d\'expression', latex: '\\sqrt{x+2}=3', sol: P(7), par: 4,
      feat: ['square'], learn: 'Élever au carré les deux côtés',
      hints: ['Condition d\'existence d\'abord, puis : le contraire d\'une racine carrée, c\'est le carré.', 'x+2 ≥ 0, puis touche (‥)² du pavé et résous x+2 = 9.'] },
    { id: 'm8', zone: 'marais', x: 1865, y: 250, req: ['m7'], domainStar: true, title: 'Les jumeaux', par: 6,
      parts: [
        { latex: '\\sqrt{x}=0', sol: P(0) },
        { latex: '\\frac{\\sqrt{x}\\sqrt{x}}{\\sqrt{x}}=0', sol: E, requireDomain: true }
      ],
      learn: 'Même forme après simplification, domaines différents', trap: 'La première donne S = {0}, la seconde S = ∅.',
      hints: ['Compare les ensembles de définition.', 'Condition d\'existence dans les deux : x ≥ 0 pour la 1re, x > 0 pour la 2e.'] },
    { id: 'mB', zone: 'marais', x: 1960, y: 300, req: ['m8'], domainStar: true, title: 'Épreuve du Marais', latex: '(x-6)\\sqrt{x-8}=0', sol: P(8), par: 6,
      boss: true, requireDomain: true, learn: 'Produit nul et domaine', trap: 'x = 6 est hors du domaine.',
      hints: ['La racine impose une condition.', 'Condition d\'existence sur la racine, puis Produit nul.'] },

    // ---- La Citadelle ----
    { id: 's1', zone: 'cit', x: 1640, y: 800, req: ['iB', 'pB'], title: 'Signe d\'un produit', latex: '(x-1)(x+3)>0',
      sol: U(I(-INF, false, -3, false), I(1, false, INF, false)), par: 3, feat: ['signchart'], learn: 'Lire un tableau de signes',
      hints: ['Étudie le signe de chaque facteur.', 'Tableau de signes, résous chaque facteur, puis remplis le tableau.'] },
    { id: 's2', zone: 'cit', x: 1715, y: 880, req: ['s1'], title: 'Facteur inversé', latex: '(2-x)(x+4)\\leq0',
      sol: U(I(-INF, false, -4, true), I(2, true, INF, false)), par: 4, learn: 'Un facteur décroissant',
      hints: ['2 − x est positif avant 2.', 'Attention au sens quand tu résous 2 − x > 0.'] },
    { id: 's4', code: 'S3', zone: 'cit', x: 1800, y: 815, req: ['s2'], title: 'Trois facteurs', latex: 'x(x-1)(x+2)<0',
      sol: U(I(-INF, false, -2, false), I(0, false, 1, false)), par: 3, learn: 'Degré 3',
      hints: ['Trois facteurs, trois rangées.', 'Tableau de signes avec x, x − 1 et x + 2.'] },
    { id: 's3', code: 'S4', zone: 'cit', x: 1765, y: 700, req: ['s4', 'm5'], title: 'Le moins devant', latex: '-\\frac{(x+1)(x-2)}{1-x}\\geq0',
      sol: U(I(-1, true, 1, false), I(2, true, INF, false)), par: 8, learn: 'Signe de tête, valeur interdite',
      hints: ['N\'oublie pas le − devant la fraction.', 'Condition d\'existence sur 1 − x, puis tableau de signes.'] },
    { id: 's5', zone: 'cit', x: 1865, y: 640, req: ['s3'], title: 'Toujours positif', latex: '\\frac{(2x-1)(x-1)}{x^2+1}\\leq0',
      sol: I(0.5, true, 1, true), par: 4, learn: 'x² + 1 est toujours positif',
      hints: ['x² + 1 ne s\'annule jamais.', 'Dans le tableau, la rangée x² + 1 ne contient que des +.'] },
    { id: 'sB', zone: 'cit', x: 1930, y: 760, req: ['s5'], title: 'Épreuve de la Citadelle', latex: '\\frac{x^2-4}{x-1}\\leq0',
      sol: U(I(-INF, false, -2, true), I(1, false, 2, true)), par: 7, boss: true, badge: 'stratege',
      learn: 'Factoriser, puis étudier le signe',
      hints: ['x² − 4 est une différence de carrés.', 'Condition d\'existence, factorise, puis tableau de signes.'] },

    // ---- L'Observatoire ----
    { id: 'o1', zone: 'obs', x: 2040, y: 520, req: ['mB', 'sB'], title: 'Tout factoriser',
      latex: '\\frac{9x^2-4+(3-2x)(3x-2)}{x^2+2x+1-(2x-3)^2}=0', sol: P(-5), par: 12, requireDomain: true,
      learn: 'Factoriser le numérateur et le dénominateur, poser le domaine, résoudre', trap: '2/3 annule le numérateur mais est interdite.',
      hints: ['Factorise le numérateur et le dénominateur.', 'Numérateur : (3x − 2)(x + 5). Dénominateur : (4 − x)(3x − 2).'] },
    { id: 'o2', zone: 'obs', x: 2110, y: 425, req: ['o1'], title: 'h(x) = 3', latex: '\\frac{x+5}{4-x}=3', sol: P(1.75), par: 8,
      statement: 'h(x) = (x + 5)/(4 − x), avec x ≠ 2/3.', learn: 'Résoudre avec la forme simplifiée',
      hints: ['Condition d\'existence sur 4 − x.', 'Multiplie par (4 − x) : x + 5 = 3(4 − x).'] },
    { id: 'o3', zone: 'obs', x: 2200, y: 500, req: ['o2'], title: 'h(x) < 0', latex: '\\frac{x+5}{4-x}<0',
      sol: U(I(-INF, false, -5, false), I(4, false, INF, false)), par: 7,
      statement: 'h(x) = (x + 5)/(4 − x), avec x ≠ 2/3.', learn: 'Tableau de signes de la forme simplifiée',
      hints: ['Deux facteurs : x + 5 et 4 − x.', 'Condition d\'existence, puis tableau de signes.'] },
    { id: 'oB', zone: 'obs', x: 2150, y: 615, req: ['o3'], title: 'Épreuve de l\'Observatoire',
      latex: '\\frac{\\sqrt{x+8}(x^2+10x+25)(-x+3)}{(x^2-4)\\sqrt{-x+6}}\\geq0',
      sol: U(I(-8, true, -2, false), I(2, false, 3, true)), par: 26, boss: true, badge: 'astronome',
      learn: 'Domaine puis signe, avec des racines', trap: 'Racine au dénominateur : −x + 6 > 0. −5 est une racine double.',
      hints: ['Factorise x² + 10x + 25 et x² − 4.', 'Conditions d\'existence de chaque racine et de x² − 4, puis tableau de signes.'] },

    // ---- Le Sommet ----
    { id: 'top', zone: 'som', x: 2265, y: 690, req: ['oB'], title: 'Le Sommet', daily: true, stars: 110, badge: 'cartographe',
      learn: 'Une équation générée chaque jour, la même pour tout le monde ce jour-là' }
  ];

  var byId = {};
  LEVELS.forEach(function (l) { byId[l.id] = l; });

  // Actions présentées au fil de la campagne (voir `feat`) : boutons de #opButtons
  // (data-op) et touches du pavé (data-key).
  var FEATURES = {
    simplify: { op: 'simplify', label: 'Simplifier' },
    expand: { op: 'expand', label: 'Développer' },
    factor: { op: 'factor', label: 'Factoriser' },
    produitnul: { op: 'produitnul', label: 'Produit nul' },
    existence: { op: 'existence', label: 'Condition d\'existence' },
    signchart: { op: 'signchart', label: 'Tableau de signes' },
    sqrt: { key: 'sqrt', label: 'Racine carrée' },
    square: { key: 'square', label: 'Carré' },
    // Choix « identité remarquable » dans Factoriser (voir buildFactorChoiceStep, toolbar.js).
    identities: { label: 'Identités remarquables' }
  };

  App.Levels = {
    ZONES: ZONES,
    LEVELS: LEVELS,
    BADGES: BADGES,
    FEATURES: FEATURES,
    get: function (id) { return byId[id] || null; },
    code: function (l) { return l.code || l.id.toUpperCase(); },
    // Le Port est un tutoriel : ni étoiles, ni limite d'étapes (voir campaign.js, progress.js, map.js).
    starred: function (l) { return !!l && l.zone !== 'port'; },
    zone: function (id) { return ZONES.filter(function (z) { return z.id === id; })[0] || null; },
    badge: function (id) { return BADGES.filter(function (b) { return b.id === id; })[0] || null; },
    // Les équations d'un niveau (une seule, sauf `parts`).
    partsOf: function (level) {
      if (level.parts) return level.parts;
      if (level.daily) return [];
      return [{ latex: level.latex, sol: level.sol, domain: level.domain, requireDomain: level.requireDomain }];
    }
  };
})(window.App = window.App || {});
