# Plan : campagne « La Carte des équations »

Ébauche de la gamification de l'application. La carte interactive correspondante est
`carte.html`, dans ce dossier. Ouvre-la directement dans un navigateur.

## Principe

- Le joueur choisit son prochain problème sur une carte de 10 régions, plus un Sommet.
  Chaque région enseigne une notion, avec une difficulté croissante.
- Le Port (7 problèmes) sert de tutoriel. Un coach présente une fonctionnalité par problème :
  une bulle pointe l'élément à utiliser, le met en surbrillance et attend l'action.
  Le joueur n'est jamais bloqué.
- Après le Port, la carte se sépare en branches. Trois régions sont des jonctions qui exigent
  deux branches terminées : le Marais (Forêt + Montagne), la Citadelle (Collines + Montagne)
  et l'Observatoire (Marais + Citadelle).

## Décisions prises (2026-09-25)

1. **Boutons masqués :** dans la campagne, seuls les boutons qui agissent directement sur
   l'équation sont masqués tant que le problème qui les présente n'est pas atteint :
   Simplifier, Développer, Factoriser, Produit nul, √, Condition d'existence et
   Tableau de signes. Le reste de l'interface reste visible : Nouvelle équation, Annuler,
   thème, réglages, zoom.
2. **Mode libre :** accessible dès le départ, avec tous les boutons et tous les générateurs.
   Les récompenses de région sont donc des badges et des fiches mémo, pas des déblocages
   de générateur.
3. **Étoiles :** « Simplifier » ne compte jamais comme une étape pour les ★★★, avec ou sans
   le réglage « Toujours simplifier ».
4. **Défi du jour :** oui, au Sommet. C'est une équation générée à partir de la date, donc la
   même pour tout le monde ce jour-là, sans réseau.

## Progression du joueur

- **Étoiles par problème :**
  - ★ : arriver à la ligne « S = … » correcte, ou à Df pour un niveau « Df seul ».
  - ★★ : sans indice et sans « Annuler ».
  - ★★★ : en au plus *n* étapes, hors « Simplifier ». Les valeurs de *n* ci-dessous sont à
    calibrer en jouant.
- **Indices :** hors du Port, le bouton « Indice » donne d'abord la notion à utiliser, puis
  l'action précise. Utiliser un indice plafonne le problème à ★.
- **Rejouer :** un problème peut être rejoué à volonté pour améliorer son score. Les étoiles
  ne bloquent que le Sommet (110 ★).
- **Réglage « Toujours simplifier » :** débloqué dans la campagne après l'épreuve de la Plaine.
- **Badges :**
  - Premiers pas : terminer le Port.
  - Équilibriste : réussir l'épreuve de la Plaine.
  - Retourneur : inverser le sens d'une inégalité.
  - Alpiniste : réussir l'épreuve de la Montagne.
  - Racine double : séparer les branches ±.
  - Chasseur d'interdits : écarter une valeur interdite.
  - Stratège : réussir l'épreuve de la Citadelle.
  - Astronome : réussir l'épreuve de l'Observatoire.
  - Perfectionniste : obtenir toutes les ★★★ d'une région.
  - Cartographe : atteindre le Sommet.

## Régions et problèmes

### Le Port — Tutoriel

*Notion :* Prise en main : sélection, Opération, glisser, Simplifier, navigation. *S’ouvre après :* Départ. *Récompense :* Badge « Premiers pas ».

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| t1 | Premier pas | `x + 3 = 7` | Isoler x en retirant la même chose des deux côtés | 1 | — | Découvre : Cliquer un terme, pavé Opération « −3 » |
| t2 | Ajouter | `x − 5 = 2` | Ajouter aux deux côtés | 1 | t1 | Découvre : Lire la flèche entre deux étapes |
| t3 | Diviser | `3x = 12` | Diviser par le coefficient | 1 | t2 | Découvre : Opération « ÷3 » |
| t4 | Faire glisser | `x + 8 = 3` | Passer un terme de l'autre côté | 1 | t3 | Découvre : Glisser un terme au-delà du « = » |
| t5 | Deux étapes | `2x + 5 = 11` | Enchaîner soustraction puis division | 2 | t4 | Découvre : Glisser le coefficient 2 pour diviser |
| t6 | Rassembler | `3x + 2x − 4 = 11` | Regrouper les termes semblables | 2 | t5 | Découvre : Sélection multiple et « Simplifier » |
| t7 | Grand large | `5x + 3 = 2x + 12` | x des deux côtés | 3 | t6 | Épreuve · Découvre : Déplacer le canevas et zoomer (loupes, Ctrl + molette) · Badge « Premiers pas » |

### La Plaine — Équations du 1er degré

*Notion :* x des deux côtés, parenthèses, Développer, cas S = ∅ et S = ℝ. *S’ouvre après :* Le Port. *Récompense :* Réglage « Toujours simplifier » dans la campagne, fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| l1 | Les négatifs | `4x − 7 = −2x + 5` | Signes et x des deux côtés | 3 | t7 |  |
| l2 | Virgules | `0,5x + 1,2 = 3` | Coefficients décimaux | 2 | l1 |  |
| l3 | Parenthèses | `3(x + 2) = 2x − 1` | Développer avant de résoudre | 3 | l2 | Découvre : Bouton « Développer » |
| l4 | Le moins devant | `5 − 2(x − 3) = x` | Distribuer un facteur négatif | 4 | l3 |  |
| l5 | Aucune ou toutes | `2x + 3 = 2x + 5` | Reconnaître S = ∅ (et S = ℝ en variante) | 1 | l4 | Piège : Les x disparaissent : il faut lire la ligne finale 3 = 5. |
| lB | Épreuve de la Plaine | `2(3x − 1) − (x + 4) = 3(x − 2) + 7` | Tout le 1er degré à la fois | 6 | l5 | Épreuve · Badge « Équilibriste » |

### La Forêt — Fractions

*Notion :* \frac, multiplier pour chasser les dénominateurs. *S’ouvre après :* Plaine, 1er problème. *Récompense :* Fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| f1 | Le tiers | `x/3 + 1 = 4` | Multiplier pour chasser un dénominateur | 2 | l1 |  |
| f2 | Numérateur | `(2x + 1)/5 = 3` | Fraction d'une expression | 3 | f1 |  |
| f3 | Deux fractions | `x/2 + x/3 = 5` | Dénominateur commun | 3 | f2 | Épreuve |

### Les Collines — Inéquations

*Notion :* Sens de l'inégalité, S en intervalles. *S’ouvre après :* Plaine, 5e problème. *Récompense :* Badge « Retourneur », fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| i1 | Plus petit que | `x + 4 < 9` | Mêmes règles que pour = | 1 | l5 | Découvre : Relation « < » dans la fenêtre Nouvelle équation |
| i2 | Le retournement | `−2x ≥ 6` | Diviser par un négatif inverse le sens | 1 | i1 | Badge « Retourneur » · Piège : Le sens de l'inégalité doit changer. |
| i3 | Des deux côtés | `3x − 1 > 5x + 7` | Choisir le côté où garder x | 3 | i2 |  |
| iB | Épreuve des Collines | `2(x − 1) ≤ 5x + 4` | Inéquation avec parenthèses | 4 | i3 | Épreuve |

### La Montagne — Degré 2

*Notion :* Produit nul, Factoriser, facteur commun. *S’ouvre après :* Épreuve de la Plaine. *Récompense :* Badge « Alpiniste », fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| p1 | Produit nul | `(x − 2)(x + 5) = 0` | Un produit est nul si un facteur l'est | 3 | lB | Découvre : Sélectionner le produit, « Produit nul », colonnes côte à côte |
| p2 | Trois facteurs | `x(x − 1)(2x + 3) = 0` | Autant de branches que de facteurs | 4 | p1 |  |
| p3 | Mettre en facteur | `x² + 3x = 0` | Factoriser par x | 3 | p2 | Découvre : Bouton « Factoriser » |
| p4 | Facteur commun | `(x + 1)(2x − 3) + (x + 1)(x + 4) = 0` | Factoriser par une parenthèse | 5 | p3 |  |
| p5 | Tout d'un côté | `x² = 5x` | Ramener à 0 avant de factoriser | 4 | p4 | Piège : Diviser par x fait perdre la solution 0. |
| pB | Épreuve de la Montagne | `x³ − 4x = 0` | Degré 3 : factoriser deux fois | 5 | p5 | Épreuve · Badge « Alpiniste » |

### La Grotte — Identités remarquables

*Notion :* a² − b², (a ± b)² : développer, factoriser par −1, puissances de x. *S’ouvre après :* Montagne, 1er problème (développer) et 3e (factoriser). *Récompense :* Fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| g1 | Un carré à développer | `(x − 7)² = x² − 7` | Développer (a − b)² : les x² s'annulent, il reste une équation du 1er degré | 4 | p1 | Source : Inspiré de l'exercice 4 |
| g2 | Toujours faux | `(5 + x)(5 − x) = 9 − x²` | (a + b)(a − b) = a² − b², puis 25 = 9 : S = ∅ | 2 | g1 | Piège : Les x disparaissent des deux côtés. · Source : Inspiré de l'exercice 4 |
| g3 | Différence de carrés | `x² − 9 = 0` | a² − b² = (a − b)(a + b) | 4 | g2, p3 |  |
| g4 | Moins moins | `9 − (−x²) − 6x = 0` | Simplifier −(−x²), remettre dans l'ordre, reconnaître (x − 3)² | 3 | g3 | Source : Inspiré de l'exercice 4 (J) |
| g5 | Factoriser par −1 | `−49 − x² + 14x = 0` | Mettre −1 en facteur pour retrouver x² − 14x + 49 = (x − 7)² | 4 | g4 | Piège : Sans le −1, aucune identité ne s'applique. · Source : Inspiré de l'exercice 4 (K) · **À développer :** À vérifier : factoriser par −1, puis appliquer l'identité dans la parenthèse. |
| g6 | Puissance 4 | `x⁴ − 25 = 0` | a = x² : (x² − 5)(x² + 5), puis √ sur x² = 5 | 6 | g5 | Piège : x² + 5 = 0 n'a pas de solution. · Source : Inspiré de l'exercice 4 (I) |
| gB | Deux carrés | `(2x + 1)² − (x − 3)² = 0` | a² − b² avec des expressions | 6 | g6 | Épreuve |

### La Source — Racine carrée

*Notion :* Racine carrée en deux temps, branches ±. *S’ouvre après :* Montagne, 5e problème. *Récompense :* Badge « Racine double », fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| r1 | Racine carrée | `x² = 16` | √ des deux côtés puis ± | 2 | p5 | Découvre : Touche √ du pavé, puis « Simplifier » côté par côté · Badge « Racine double » |
| r2 | Carré d'une expression | `(x + 3)² = 9` | Deux branches à résoudre | 4 | r1 |  |
| r3 | Racine non entière | `(2x − 1)² = 5` | Garder √5 exact | 6 | r2 |  |
| r4 | Pas de racine | `x² = −4` | Un carré n'est jamais négatif | 1 | r3 | Épreuve · Piège : S = ∅, rien à calculer. |

### Le Marais — Ensembles de définition

*Notion :* Df d'une fonction, valeurs interdites, √ d'une expression, simplification piégée. *S’ouvre après :* Forêt + Montagne. *Récompense :* Badge « Chasseur d'interdits », fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| m1 | Df d'un quotient | `f(x) = 1/(1 + x)` | Df = ℝ \ {−1} | 2 | f3, pB | Objectif : Df · Découvre : Colonne « Condition d'existence » · Source : Exercice 22 |
| m2 | Df d'une racine | `g(x) = √(3 − 2x)` | Df = ]−∞ ; 3/2] | 2 | m1 | Objectif : Df · Source : Exercice 22 |
| m3 | Dénominateur en x | `3/(x − 2) = 1` | Condition x ≠ 2, puis résoudre | 4 | m2 |  |
| m4 | Quotient | `(x + 1)/(x − 3) = 2` | Multiplier par un dénominateur en x | 4 | m3 |  |
| m5 | Le faux ami | `(x + 3)(x + 1)/(x + 3) = 0` | −3 annule le numérateur mais est interdite | 4 | m4 | Badge « Chasseur d'interdits » · Piège : Écrire S = {−3 ; −1} au lieu de S = {−1}. Le niveau exige la condition d'existence avant de valider. |
| m6 | Le faux ami caché | `(x² − 9)/(x + 3) = 0` | Le même piège, après factorisation | 5 | m5 | Piège : Même valeur interdite, moins visible. |
| m7 | Racine d'expression | `√(x + 2) = 3` | Radicande ≥ 0 | 3 | m6 |  |
| m8 | Les jumeaux | `√x = 0   et   1/√(1/x) = 0` | Même expression après simplification, domaines différents : [0 ; +∞[ contre ]0 ; +∞[ | 4 | m7 | Piège : La première donne S = {0}, la seconde S = ∅. · **À développer :** Condition d'existence d'un radicande qui est lui-même un quotient (√(1/x)). |
| mB | Épreuve du Marais | `(x − 6)√(x − 8) = 0` | Produit nul et domaine | 4 | m8 | Épreuve · Piège : x = 6 est hors du domaine. |

### La Citadelle — Tableau de signes

*Notion :* Produits et quotients comparés à 0, facteur de signe constant. *S’ouvre après :* Collines + Montagne. *Récompense :* Badge « Stratège », fiche mémo.

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| s1 | Signe d'un produit | `(x − 1)(x + 3) > 0` | Lire un tableau de signes | 3 | iB, pB | Découvre : « Tableau de signes » |
| s2 | Facteur inversé | `(2 − x)(x + 4) ≤ 0` | Un facteur décroissant | 3 | s1 |  |
| s3 | Le moins devant | `−(x + 1)(x − 2)/(1 − x) ≥ 0` | Signe de tête, valeur interdite en double barre | 4 | s2 | Source : Exercice 23, question 1 |
| s4 | Trois facteurs | `x(x − 1)(x + 2) < 0` | Degré 3 | 4 | s3 |  |
| s5 | Toujours positif | `(2x² − 3x + 1)/(x² + 1) ≤ 0` | Factoriser le numérateur en (2x − 1)(x − 1) ; x² + 1 est toujours positif | 4 | s4 | Source : Exercice 23, question 2 · **À développer :** Tableau de signes avec un facteur de signe constant de degré 2 (x² + 1), et factorisation d'un trinôme vérifiée par développement. |
| sB | Épreuve de la Citadelle | `(x² − 4)/(x − 1) ≤ 0` | Factoriser puis étudier le signe | 5 | s5 | Épreuve · Badge « Stratège » |

### L'Observatoire — Fonctions, problèmes en plusieurs parties

*Notion :* Enchaîner factorisation, Df, simplification, équations et inéquations sur une même fonction. *S’ouvre après :* Marais + Citadelle. *Récompense :* Badge « Astronome ».

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| o1 | h(x) = 0 | `h(x) = f(x)/g(x) = 0` | f = 9x² − 4 + (3 − 2x)(3x − 2) et g = x² + 2x + 1 − (2x − 3)². Factoriser f et g, poser Df, résoudre. | 8 | mB, sB | Piège : 2/3 annule le numérateur mais est interdite. · Source : Exercice 24 |
| o2 | h(x) = 3 | `h(x) = 3` | Simplifier h en (x + 5)/(4 − x) sans oublier x ≠ 2/3 | 5 | o1 | Source : Exercice 24 · **À développer :** Simplifier un facteur commun dans un quotient en gardant la valeur exclue. |
| o3 | h(x) < 0 | `h(x) < 0` | Tableau de signes de la forme simplifiée, 2/3 toujours exclue | 4 | o2 | Source : Exercice 24 |
| oB | Épreuve de l'Observatoire | `√(x + 8)(x² + 10x + 25)(−x + 3) / ((x² − 4)√(−x + 6)) ≥ 0` | Df puis signe : identités, racines au numérateur et au dénominateur | 10 | o3 | Épreuve · Badge « Astronome » · Piège : Racine au dénominateur : condition stricte −x + 6 > 0. −5 est une racine double. · Source : Exercice 23, question 3 |

### Le Sommet — Défi du jour

*Notion :* Une équation générée par jour, toutes notions confondues. *S’ouvre après :* Observatoire + 110 ★. *Récompense :* Badge « Cartographe ».

| Id | Problème | Énoncé | Apprend | ★★★ en | Prérequis | Notes |
|---|---|---|---|---|---|---|
| top | Le Sommet | `Défi du jour` | Une équation générée chaque jour, la même pour tout le monde ce jour-là | — | oB | Épreuve · Badge « Cartographe » · 110 ★ requises |

## Évolutions de l'application nécessaires

J'ai vérifié ces points dans le code le 2026-09-25. Tous les autres problèmes fonctionnent
avec l'application actuelle. Par exemple, `−(x+1)(x−2)/(1−x) ≥ 0` (exercice 23, question 1)
est accepté tel quel par le tableau de signes (`Expr.extractSignChartFactors`).

1. **Facteur de signe constant dans le tableau de signes.** `extractSignChartFactors`
   refuse tout facteur de degré ≥ 2. Il faut une ligne « x² + 1 : toujours + » pour
   s5. Pour oB, la carte prévoit que l'élève factorise d'abord x² + 10x + 25 en (x + 5)²
   (une puissance paire est déjà gérée).
2. **Simplifier un facteur commun dans un quotient** en gardant la valeur exclue visible,
   comme le « si (…) ≠ 0 » actuel (`desc.nonZero`). C'est nécessaire pour o2 (h simplifiée
   en (x + 5)/(4 − x), x ≠ 2/3). Aujourd'hui, seul un numérateur nul se simplifie.
3. **Condition d'existence d'un radicande qui est un quotient** (`√(1/x)`, m8). Aujourd'hui,
   seuls les radicandes linéaires sont traités.
4. **Factoriser un trinôme sans racine évidente** (s5 : 2x² − 3x + 1). Proposition :
   l'élève saisit la forme factorisée suggérée par l'énoncé, et l'application vérifie
   l'égalité en développant.
5. **Identités remarquables avec une puissance de x** : FAIT le 2026-09-25 (commit
   `6cde151`). « a » peut valoir k·xᵖ, par exemple x⁴ − 25 = (x² − 5)(x² + 5) avec a = x²
   (niveau g6). L’exercice 4 sert seulement d’inspiration pour des équations de la Grotte.
   Pas de mode « expression seule », pas de nouvelle fonctionnalité pour « Développer ».
   Reste à vérifier : le niveau g5 (factoriser par −1, puis appliquer l’identité dans la
   parenthèse).
6. **Nouveaux types de niveau :**
   - Niveau « Df seul » (m1, m2) : réussi quand toutes ses colonnes
     « Condition d'existence » sont résolues.
   - Problème en plusieurs parties (o1 → o3) : un énoncé commun (f, g, h) partagé par
     plusieurs nœuds.
7. **Validation qui exige le domaine :** m5 (`(x+3)(x+1)/(x+3)=0`) doit refuser
   S = {−3 ; −1}. La ligne S est déjà intersectée avec le domaine une fois les colonnes
   « Condition d'existence » résolues. Le niveau doit donc exiger ces colonnes avant de
   valider.

## Esquisse technique

- `js/levels.js` : le catalogue des problèmes (données pures), chargé après `generator.js`.
- `js/progress.js` : étoiles, badges et déblocages, enregistrés dans `localStorage`
  comme `App.Settings`.
- `js/map.js` : l'écran de carte en SVG et le coach, chargés avant `main.js`.
- **Réussite :** comparer `App.Ineq.solutionRanges` à la solution attendue du niveau, et
  compter les étapes de la chaîne (hors Simplifier) et les appels à « Annuler ».
- **Contraintes :** pas de réseau, pas de build, ES5, `file://`. Le canevas existant ne
  change pas.

```js
// js/levels.js — un niveau
{ id: 'm5', zone: 'marais', title: 'Le faux ami',
  latex: '\\frac{(x+3)(x+1)}{x+3}=0',
  requires: ['m4'],
  solution: [{ eq: -1 }],        // −3 est exclu par la condition d'existence
  par: 4,                        // ★★★ (Simplifier ne compte pas)
  requireDomain: true,
  badge: 'chasseur-interdits',
  hints: ['Commence par la condition d\'existence.', 'Produit nul sur le numérateur.'] }
```
