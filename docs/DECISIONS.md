# Journal des décisions

Format : **décision** · raison · alternatives écartées.

## Phase 0

1. **Nom : *Sillage*.** C'est la trace laissée dans la neige, donc le cœur visuel du pilier 1. Le mot est court, original et ne reprend rien de Grand Mountain Adventure ni de Traffic Rider. *Écartés :* « Firnline » (déjà utilisé par une autre session sur cette machine), « Schuss » (trop générique), « Powder Rush » (sans doute déjà pris).
2. **Dossier `~/sillage`, port de dev 5180.** Une autre session Claude construit au même moment un jeu similaire dans `~/firnline`. Travailler dans le même dossier provoquerait des écrasements mutuels, donc tout est séparé : dossier, nom, repo, port.
3. **npm au lieu de pnpm.** pnpm n'est pas installé ; la consigne dit « pnpm si dispo, sinon npm ».
4. **TypeScript 6.0.3 (et non 7.0).** typescript-eslint 8.72 exige `typescript < 6.1`. Le lint fait partie de la CI demandée.
5. **Caméra par défaut : poursuite basse et proche, pas la 1re personne.** En arbitrage, Grand Mountain gagne : on doit *voir* le carve et les figures. Cela réduit aussi le risque de motion sickness. La 1re personne reste une option (touche C).
6. **Tuck explicite** (↑ / deux pouces). C'est l'équivalent de l'accélérateur de Traffic Rider : on *décide* d'aller vite, et ce choix se voit (FOV) et s'entend (vent). On ne peut pas carver en tuck, d'où un arbitrage vitesse / contrôle.
7. **Le carving émerge de la physique.** La vitesse ne peut tourner vers les skis qu'à un taux limité (*grip*), et l'excès devient du dérapage qui freine. Pas de bouton « carve » : un geste doux carve, un geste brutal dérape.
8. **Missions persistantes (1 étoile chacune), à la Grand Mountain.** On progresse par défis indépendants qu'on peut valider en plusieurs runs, plutôt que par listes de missions séquentielles (Traffic Rider). C'est plus chill et respecte la priorité GMA.
9. **Les étoiles sont la seule monnaie.** Pas de boutique ni de grind : l'objectif est l'envie de rejouer, pas la rétention artificielle.
10. **Chute ≠ fin de run.** On se relève en ~1,5 s au dernier point sûr. Le ton reste chill et la chute coûte seulement du temps et le combo.
11. **UI en anglais, documentation en français.** Le jeu est public (GitHub et Vercel) ; les docs s'adressent au porteur du projet.
12. **Physique « au sol analytique ».** La physique interroge la fonction de hauteur exacte (lisse), pas le maillage. On obtient des normales continues, sans tremblement, et un maillage libre de son LOD.

### Décisions issues de la recherche (voir RESEARCH.md)

13. **Défis à 3 paliers (bronze, argent, or = 1 à 3 ★) au lieu d'une étoile par mission.** C'est le modèle de Grand Mountain : médailles cumulées, difficulté par seuils resserrés. Les paliers lissent la courbe (bronze facile, or exigeant), ce qui répond directement à la porte « pas de pic brutal ». Au total 9 défis, 27 ★ ; piste 2 à 4 ★, piste 3 à 10 ★.
14. **Relance au rythme (« pump »).** Dans le jeu de référence, alterner les virages fait prendre de la vitesse, ce qui rend le geste gratifiant et pas seulement freinant. Le paramètre est plafonné et réglable, car ce même jeu a dû retirer un boost trop généreux.
15. **Adhérence = accélération latérale max.** La vitesse tourne au plus à `grip / v` rad/s : virer serré à haute vitesse fait déraper (réaliste et lisible). Cette formulation colle aux données physiques (rayon de carving limité par la force latérale).
16. **Réception en switch tolérée.** Un 180 bien aligné à l'envers est validé, puis le skieur pivote automatiquement. Les critiques du jeu de référence jugent ces réceptions essentielles, sans qu'on ait besoin de gérer le ski à l'envers.
17. **« Trafic » = skieurs lents à doubler de près.** C'est la transposition directe du dépassement serré de Traffic Rider. Comme lui, le near-miss exige une vitesse minimale (40 km/h chez nous), avec un combo en rampe linéaire et le hors-piste ×2 (notre « contresens »). Implémenté après la porte de la Phase 2 (*feel before features*).
18. **Chute comique au lieu d'un retour en arrière manuel.** On se relève au dernier point sûr en ~1,5 s, avec un message ironique (« Yard sale! »). Même effet anti-frustration que le rewind du jeu de référence, sans casser le chronomètre des défis.
19. **Nom conservé malgré des homonymes obscurs** : un RPG Steam à 3 avis, un puzzle Play Store à 0+ téléchargements, une BD. Aucun jeu notable ne porte ce nom et c'est conforme à la règle n° 1. À sous-titrer si une sortie en store est un jour envisagée.

## Phase 1

20. **Gravité de jeu 11 m/s² (×1,12).** Avec la gravité réelle, l'accélération était un peu molle et les sauts flottants. La traînée est légèrement relevée pour garder des vitesses terminales crédibles. Les cibles de `FEEL.md` sont vérifiées par les tests.
21. **Tremplins calibrés par simulation** (3 tailles) : lèvre basse et longue pente de réception qui épouse les trajectoires de 30 à 60 km/h.
22. **Une réception trop rapide coûte de la vitesse au lieu de faire chuter.** On ne chute que pour une mauvaise orientation ou un impact extrême (Vn > 20 m/s). C'est le ton de Grand Mountain : la sanction comique vient d'une erreur de figure, pas d'un excès d'élan.
23. **Verrou des entrées en l'air.** Une touche tenue au décollage doit être relâchée avant de faire vriller ou salto. Sans ce verrou, un débutant en tuck faisait des saltos involontaires.
24. **Classes mathématiques de Three (`Vector3`) autorisées dans `sim/`.** Ce sont des maths pures, testables en Node : inutile de réinventer des vecteurs. Aucun objet de rendu n'entre dans `sim/`.

## Phase 2

25. **Skieur low-poly à pose procédurale dès la Phase 2** au lieu de la capsule. L'« inertie crédible » se *voit* surtout dans le corps : flexion en tuck, inclinaison ∝ charge latérale, hockey stop, bras en l'air, chute « yard sale ».
26. **Flocons calculés dans le shader**, en boîte qui suit la caméra (0 CPU par frame) : c'est l'indice de vitesse le moins cher qui soit.
27. **Bot de suivi de ligne** (`sim/bot.ts`) : il prouve qu'une piste se finit sans technique particulière (porte c), pilote les captures et sert de banc FPS reproductible.
28. **API debug `window.__sillage`** (état, `drive`, `autopilot`, `gpu`) : elle rend les tests Playwright déterministes sans simuler le clavier.
29. **Mesure FPS sur le GPU matériel** (ANGLE Metal), pas sur SwiftShader : les chiffres sont représentatifs du desktop. Le « mobile émulé » = CPU ×4 (référence Lighthouse) + viewport et DPR d'un Pixel 7. Le GPU n'est pas bridé : la marge GPU mobile est gérée par le pixel ratio adaptatif (Phase 6).

## Phase 3

30. **Tremplin = bosse locale + creux intégré à la pente de base.** Un creux de réception local (17 m de profondeur sur le grand tremplin) formait une fosse ; vu de la caméra, le ciel apparaissait à travers. Le creux est maintenant un raidissement de toute la largeur, comme un « mur » naturel, et la bosse d'envol reste locale. Le long de l'axe, bosse + creux = le profil calibré en Phase 1 (test dédié).
31. **Garde au sol de la caméra** (à sa position et à mi-chemin du skieur). Sur pente raide ou sur le talus, « skieur + 2 m » passait sous la neige. Diagnostic mesuré : caméra à 9 cm du sol.
32. **Plan lointain à 3 000 m.** Le dôme du ciel (1 400 m) était découpé au centre de l'écran, ce qui donnait du noir.
33. **Grille cisaillée le long de la ligne + normales calculées sur une grille à bord fantôme.** Aucune couture d'éclairage entre chunks, aucun triangle gaspillé hors couloir. Coût mesuré : 6–7 ms par chunk LOD0, au plus un chunk par frame.
34. **Clairières « justes »** : un écart d'au moins 6 m entre troncs d'une même rangée, et des rangées espacées de 10–15 m. Il y a toujours un couloir praticable, comme le prouve le bot (0 chute à allure prudente).
35. **Le bot ne freine pas en virage** (freiner divise l'adhérence par trois). Il cherchait à tenir 50 km/h en freinant sur 23° et percutait les sapins. C'est aussi un conseil de pilotage pour le joueur.
36. **Lisibilité** : bande damée plus claire avec une ligne de bord, piquets de la couleur de la difficulté (bleu, rouge, noir), drapeaux orange avant les tremplins, lèvres teintées, poteaux jaune et noir avant les falaises, arches de départ et d'arrivée.

## Phase 4

37. **Seuils des défis calibrés sur des descentes du bot** (prudent 45 km/h, rapide 60–75 km/h) : bronze ≈ prudent, argent ≈ rapide, or = mieux que le bot (lignes, tuck, figures, near-miss). Le test `balance.test.ts` vérifie la courbe à chaque changement de physique.
38. **Couloir Noir à 9 ★ au lieu de 10.** Le joueur « en progrès » simulé obtenait exactement 9 ★ sur les deux premières pistes. 9 = un tiers des 27 étoiles : la courbe reste douce sans palier artificiel.
39. **Défi « Propre » sur la noire** (0 / 1 / 2 chutes). Un joueur prudent y décroche de l'or. C'est voulu : la piste la plus dure offre aussi des étoiles au contrôle et pas seulement à la vitesse (pas de pic brutal).
40. **Médailles en direct** pour vitesse, air, chaîne et vrille, au moment où elles tombent (l'objectif instantané de Traffic Rider). Course, Propre et Score se valident à l'arrivée.
41. **Restart = on garde les médailles déjà gagnées pendant la descente** (vitesse, air…) : rejouer n'efface jamais un exploit. Restart mesuré : 19–26 ms jusqu'au premier rendu (porte < 1 s).
42. **Départ « en attente »** : le skieur reste dans le portillon jusqu'à la première entrée. Le chrono part à z = 0, ce qui est juste et lisible.
43. **Tenues purement cosmétiques**, débloquées à 3, 6, 9, 13, 18, 23 et 27 ★.

## Phase 5

44. **Tactile : zones (moitiés d'écran) + gestes, plutôt qu'un joystick virtuel.** C'est la logique « deux bâtons » du jeu de référence. Maintenir un côté = carver, les deux = tuck, glisser ↑ = saut (salto arrière en l'air), glisser ↓ = frein (salto avant en l'air). Un bouton saut optionnel existe pour qui préfère taper. Rien ne masque le centre de l'écran.
45. **Mode gaucher = miroir des boutons à l'écran** (saut, pause). Les zones de carve sont symétriques et n'ont pas besoin d'être inversées.
46. **Inclinaison (gyroscope) en option**, avec demande de permission iOS dans le geste et retour au tactile si refus. Avec le gyroscope, n'importe quel appui sert au tuck.
47. **Manette au mapping standard** : stick / croix = carve, RT = tuck, LT / B = frein, A = saut, Start = pause, Y = restart, Select = caméra. Menus navigables à la croix et à A (vérifié avec une manette simulée).
48. **Menu sur fond « attract »** : le bot dévale la dernière piste jouée derrière les menus. Le jeu se montre avant même qu'on joue, sans écran statique.
49. **Poussée de départ (5 m/s) à la sortie du portillon.** Le départ était mou (21 km/h après 3 s) ; une boucle « encore une descente » exige un démarrage nerveux.
50. **Résolution adaptative** : −10 % de pixel ratio après 90 frames de plus de 22 ms, retour progressif au-delà de 600 frames rapides. Le plafond dépend de la qualité (1 / 1,5 / 2). MSAA seulement en « High », choisi au démarrage.
51. **`[hidden] { display: none !important }`** : un `display: flex` d'auteur annulait l'attribut `hidden`. Le calque de menu, invisible, interceptait les taps (trouvé par le test tactile).
52. **Mode confort activé par défaut si l'OS demande `prefers-reduced-motion`** (recommandation des guides d'accessibilité : confort par défaut, désactivable).
53. **Écran de chargement en HTML/CSS inline** dans `index.html` : il s'affiche avant le téléchargement du JS (≈ 170 Ko gzip).

## Phase 6 — revue adversariale (4 relecteurs en parallèle) et correctifs

Les 19 défauts signalés ont été vérifiés un par un puis corrigés. Les principaux :

54. **Critique — bassins remontants après les tremplins.** La récupération du creux de réception faisait remonter la pente jusqu'à −0,52 sur toute la largeur. Un skieur arrêté ou tombé y restait piégé, et le bot restait bloqué 400 s sur la noire. **Correctif :** la pente de base ne descend jamais sous 4°. *Test :* aucune remontée le long du couloir, sur les 3 pistes.
55. **Majeur — réapparition dans un sapin**, d'où une seconde chute immédiate qui comptait pour le défi « Propre ». **Correctif :** le contrôle inclut les obstacles juste derrière le point, et à défaut on recule de 3 m. *Test :* 0 réapparition au contact d'un obstacle, avec un pas de 0,5 m sur les 3 pistes.
56. **Critique — manette, A sur Retry.** Le pad est lu pendant un pas de physique ; la réinitialisation survenait en plein pas, et l'ancien skieur « finissait » la nouvelle descente en 0,02 s : faux record et médailles gratuites. **Correctif :** le pas est abandonné si la descente a changé. *Test e2e*, vérifié rouge (sans le correctif) puis vert.
57. **Critique — manette en pause** : plus lue du tout. **Correctif :** lecture des boutons en pause, sans file de saut.
58. **Majeur — Retry pendant les 1,3 s de glissade après l'arrivée** : la descente terminée (record, médailles) était perdue. **Correctif :** la descente est sauvegardée telle quelle. *Test e2e.*
59. **Majeur — écran de fin.** Il n'était pas navigable à la manette ni aux flèches, et Entrée relançait toujours, même avec le focus sur « Menu ». **Correctif :** navigation dans l'écran de fin, Entrée active le bouton ciblé. *Test e2e.*
60. **Majeur — audio muet sur iOS** : le geste n'est validé qu'au relâchement. **Correctif :** déverrouillage aussi sur pointerup et touchend.
61. **Majeur — canvas étiré sur mobile** : 100vh en CSS contre innerHeight au rendu. **Correctif :** 100 % de la boîte fixe.
62. **Mineurs corrigés :**
    - traces « fantômes » entre décollage et réception, ou entre chute et réapparition ;
    - cycle du jour qui sautait du crépuscule au matin ;
    - écritures DOM du HUD à chaque frame (désormais seulement si ça change) ;
    - fuite des arches, bannières et matériaux au changement de piste ;
    - Espace bloqué sur les boutons ;
    - vent qui continuait en pause ;
    - bouton pause qui masquait le score ;
    - compteur FPS invisible sur desktop ;
    - focus perdu dans les réglages ;
    - `setItem` non protégé (sonde d'écriture, avec repli en mémoire).
63. **Effet de bord assumé : seuils recalibrés.** Sans bassins, les descentes sont plus rapides et le bot rapide prenait l'or « Course » partout. Nouveaux seuils course : 100/74/60, 135/100/80, 165/120/96 s ; score de la noire : 3 500/7 000/11 000. Le test d'équilibrage reste vert : débutant ≥ 1 ★ par piste, déblocages successifs, joueur « simple » à 17 ★ sur 27.
64. **Bot : évitement d'urgence à court terme.** Il vire tout de suite si un obstacle est sur sa ligne dans les ~0,7 s suivantes. Le test fragile sur l'« ordre des chutes » est remplacé par « finit les 3 pistes à allure soutenue ».
65. **Déploiement : CLI Vercel déjà connecté plutôt qu'envoi inline.** `npx vercel@65.1.0 deploy --prod` envoie les vrais fichiers du dépôt (`.vercelignore` écarte le build, les rapports de test et les docs) : aucune recopie à la main. Le bundle en prod est identique au build local (même hash `index-Dpx5Y60E.js`). GitHub : `gh` n'est pas connecté, c'est le blocage autorisé ; je n'ai pas cherché de jeton ailleurs.

## Phase 8 — passe « perso réaliste + énormément satisfaisant »

66. **Trois spécialistes en parallèle (personnage, neige, son) dans des worktrees séparés**, sur un contrat posé d'abord dans la simulation (grab, événement `edgeChange`, position de l'obstacle frôlé). L'intégration dans `game.ts` est faite à la main.
67. **Skieur = un seul `SkinnedMesh`** (20 os, poids rigides, primitives lisses fusionnées), 2 draw calls au lieu de 17, plus une ombre planaire au stencil (1 draw call). C'est ce qui libère le budget pour les nouveaux effets.
68. **Grab :** maintenir en l'air ; les points ne comptent que si on lâche avant de toucher le sol (« release to bank »). Ça n'apporte aucune pénalité : le ton reste chill.
69. **Le flow est purement sensoriel** (aucun point) : l'équilibrage des médailles, calibré sur le bot, reste intact. La vitesse seule plafonne au niveau 2.
70. **Rythme musical :** chaque changement de carre propre joue une note de l'accord en cours, qui monte avec la série. Le joueur « joue » la musique en carvant.
71. **Réception parfaite = coup marqué :** hitstop de 50 ms, flash chaud, plongée de caméra (ressort), sting en accord. Tout est atténué en mode confort.
72. **Mesures (build de prod, M1) :** 59,7 FPS desktop, 59,5 FPS mobile émulé (CPU ×4), 52–55 draw calls (< 60). Les 76 tests unitaires et les 14 e2e sont verts.

## Phase 9 — free ride = Les Rousses, massif Dôle-Tuffes, 1:1

73. **Données ouvertes plutôt que montagne inventée.** Le relief vient des tuiles « terrarium » AWS (z14, ≈ 6,6 m/px, rééchantillonnées à 20 m ; z11 à 300 m pour 48 × 40 km autour, Léman compris). Les pistes, remontées, forêts, routes et bâtiments viennent d'Overpass (OSM). Un script sans dépendance (`scripts/rousses.mjs`, avec son propre décodeur PNG) écrit un module de 300 ko : le jeu n'a pas besoin de réseau, et la simulation reste pure et testable.
74. **Pistes damées « en banquette ».** Chaque piste est rééchantillonnée tous les 5 m. Son altitude est lissée sur 50 m et ne remonte jamais, mais elle peut descendre jusqu'à 6 m sous le relief (les tuiles lisent la cime des épicéas). En travers, elle est plate et se raccorde au relief sur 16 m. Sans ça, les chemins en dévers (Route forestière, Balcon de la Dôle) étaient inskiables. Une grille finale de 10 m, interpolée en bicubique (C1), sert à la fois à la physique et au maillage.
75. **Plus de ligne unique.** Le bot suit `guide()` (un point plus bas sur la piste où il se trouve, puis la suivante). Sur les pistes en couloir, son comportement reste identique au bit près (avant = +z, voies = x) : les tests d'équilibrage ne bougent pas.
76. **Téléskis = remorquage au sol** (le skieur reste debout, il laisse ses traces, la perche le relie au câble). Les télésièges gardent la pose assise. Les pylônes sont ceux d'OSM, complétés tous les 120 m pour les télésièges et tous les 80 m pour les téléskis.
77. **Budget :** ≈ 1,9 M triangles en qualité haute (terrain 10 m, 36 k épicéas dont 23 k simplifiés au fond des bois). En moyen/bas, le terrain passe à 20 m et la forêt à 50 % / 30 %. On reste à 60 FPS sur desktop et en mobile émulé (CPU ×4), avec 43 draw calls.

## Phase 10 — Les Rousses plus raide, départ en bas, effets de vitesse

78. **Raidir l'échelle, pas le détail.** La grille « alentours » (300 m) porte le grand relief : au-dessus de `H0 = 1160 m` (le pied des Jouvencelles), elle est multipliée par `STEEP = 2,3`, avec un raccord en softplus pour qu'aucune pliure n'apparaisse à H0. Le détail du massif (fin − alentours) est ensuite rajouté tel quel. Les longues descentes deviennent plus raides, mais les bosses, les combes et les falaises ne doublent pas. Sous H0, les vallées et le Léman restent à leur vraie hauteur : on ne plonge pas dans un ravin en ratant la gare du bas.
79. **La pente plafonne vite ; virages, replats et envols comptent autant.** Mesures faites avec le bot en recherche de vitesse, depuis le haut de chaque remontée, sur 40 s :
    - Lisser les tracés OSM sur ±50 m : on carve au lieu de zigzaguer d'un nœud à l'autre.
    - Profil des banquettes moyenné sur ±80 m, puis « ne remonte jamais », puis les cassures arrondies sur ±60 m. Les fenêtres sont symétriques et se resserrent vers les extrémités, sinon les départs se creusaient de 20 m.
    - Le sol garde les skis sur les crêtes (`Ground.launch = 4 m/s` en free ride) : à 140 km/h, le relief raidi faisait décoller le skieur à chaque bosse, avec 35 à 58 km/h perdus à la réception. Un saut ou une vraie rupture décolle toujours.
    - Résultat : 2,0 → 100 km/h de moyenne sur les 11 grandes remontées, 2,3 → 105, 2,6 → 111. Retenu : 2,3. Un test garde plus de 90 km/h depuis l'arrêt sur les grandes pistes.
80. **Pistes réorientées sur le relief raidi** (un petit tronçon peut s'inverser) et **enchaînées vers la voisine qui descend le plus sur 200 m**. Au bout de la dernière, on suit la ligne de pente. À la sortie d'une remontée, on regarde la piste qui plonge le plus dans un rayon de 120 m, à condition qu'elle ne parte pas plus haut que soi et que les 20 premiers mètres descendent ; sinon on suit la ligne de pente (la relecture a trouvé 5 sorties sur 22 qui faisaient face à la montée). Le sommet de La Dôle (<kbd>T</kbd>) est choisi sur la plus grosse chute sur 600 m, pas sur la plus longue piste, qui finissait en replat.
81. **Départ dans la file du Jouvenceaux** : la première poussée fait embarquer. Les bâtiments OSM posés sur une gare (la caisse) ne sont pas dessinés, puisque la gare l'est. Pour sauter une montée, il faut une nouvelle pression ; une touche déjà tenue en arrivant ne compte pas. ↑ / ↓ comptent aussi sur un télésiège : l'entrée n'est plus lue « en l'air » pendant la montée. Le mode démo part du sommet de La Dôle.
82. **Effets de vitesse** (un agent dans un worktree isolé, puis cherry-pick) :
    - les traînées existantes : 90 → 320, plus longues et plus denses avec la vitesse ;
    - un tunnel en CSS (bords assombris et rayons discrets), sans rendu hors écran ;
    - un buzz de caméra de 90 à 125 km/h ;
    - un compteur blanc → or → orange qui flashe à 100 et 120 km/h et pulse au-delà de 125 km/h. La pulsation ne marque que les pointes, puisqu'on roule à 100–110.
    
    En mode confort : ni traînées, ni rayons, ni buzz, ni pulsation. Le jeu reste à 59 FPS en mobile émulé, sans draw call de plus.

## Correctif — les skis sous la neige en free ride

83. **La neige qu'on voit est celle sur laquelle on skie.** La physique suit la surface lisse (bicubique) de la grille à 10 m, alors que le maillage du massif trace des triangles plats entre ses nœuds. Dans un creux, ces triangles passaient au-dessus des skis : jusqu'à 1 m en qualité haute, et jusqu'à 4 m en moyen/bas (un nœud sur deux), soit plus de 30 cm pendant 14 % du temps de ski. Le skieur disparaissait, et la caméra passait parfois sous la neige. Le mode arcade n'était pas touché (moins de 10 cm).
    - Correctif : un carré de 320 m autour du skieur trace lui-même la surface lisse, avec un point tous les 2,5 m. Le maillage du massif est percé à cet endroit (`discard` dans le shader). Sur ses 40 derniers mètres, le carré se plie sur les triangles du massif, et ses bords tombent sur les lignes de la grille à 20 m : aucune marche, aucune couture de couleur ni d'ombrage.
    - Il est reconstruit 8 rangées par image pendant qu'on avance (environ 1 ms par image sur desktop, une reconstruction toutes les 0,75 s à 140 km/h), et d'un coup après une remontée, un respawn ou un changement de qualité (environ 11 ms).
    - Résultat : 99 % du temps sous 5 cm, 15 cm au pire, dans toutes les qualités. Les autres skieurs sont posés sur la neige telle qu'elle est dessinée. Un test le garde (`tests/unit/mountain-view.test.ts`).

## Refonte visuelle, sous-étape A : 250 k triangles au palier bas

84. **Le décor de la montagne passe par le culling de la caméra, avec un LOD lointain au palier bas.** Avant, le massif, la forêt, les piquets, les remontées et les bâtiments étaient chacun un maillage couvrant toute la station, dessiné en entier même derrière le skieur : 1 044 k triangles au palier bas aux Rousses, 1 392 k à Avoriaz.
    - Terrain : découpé en tuiles d'environ 1,3 km qui partagent leurs sommets. Au palier bas, une tuile à plus de 1 km prend sa version lointaine, avec un sommet sur deux.
    - Sapins et piquets : deux maillages instanciés, remplis avec les seuls objets du champ de vision (frustum élargi de 24°, rafraîchi tous les 10 m ou tous les 8° de rotation). Ça reste un draw call par type. Au palier bas, les sapins prennent la géométrie simplifiée au-delà de 200 m, comme l'arcade depuis la phase 1, et les piquets ne sont plus dessinés au-delà de 700 m (moins d'un pixel).
    - Bâtiments : regroupés par tuiles de 2 km. Au palier bas, au-delà de 800 m, ils perdent leurs bandes de fenêtres (12 triangles par étage, moins d'un pixel à cette distance).
    - Remontées : sièges, cabines et perches hors champ ne sont plus dessinés. Au palier bas, les sièges et perches sont coupés au-delà de 700 m, les cabines au-delà de 1,5 km.
    - Foule au palier bas : 12 corps au plus (24 sinon). Une ombre n'est dessinée qu'à moins de 80 m et dans le champ ; three ne la cullait jamais.
    - Résultat : Rousses 275 k, Avoriaz 408 k, vue village 245 k (détail dans PERF.md). Les draw calls passent de 94 / 35 / 55 à 78 / 98 / 70.

85. **Le budget de 250 k n'est pas atteint à Avoriaz ni aux Rousses, et l'image n'a pas été dégradée pour y arriver.** Les options restantes changent toutes ce qu'on voit. À trancher :
    - Avoriaz (408 k) : depuis le sommet, on voit toute la station. Il faudrait un troisième niveau de terrain au-delà de 3 km (une maille de 80 m, des crêtes plus anguleuses), retirer les bâtiments ou les sapins au-delà de 2,5 km (Morzine devient une pente vide), ou réduire la distance de vue au palier bas (le brouillard monterait).
    - Rousses (275 k) : un maillage par restaurant donnait 249 k, mais le test `restos-view.test.ts` impose 3 maillages au plus pour les restaurants. Le culling ne compte pourtant que les restaurants dans le champ. Assouplir ce test (3 draw calls « visibles ») suffirait. Autre piste : moins de corps dans la foule, ce qui se voit sur une piste chargée.

## Refonte visuelle, couche lumière (session autonome du 15/11/2026)

86. **Les tuiles d'une même famille sont dessinées en un seul maillage.** Le massif, le terrain alentour et les bâtiments avaient chacun un maillage par tuile visible : 98 draw calls à Avoriaz au palier bas, pour un budget de 60. Chaque famille garde maintenant une seule géométrie. À chaque rafraîchissement (tous les 10 m ou 8°, comme les sapins), les triangles des tuiles visibles, en version proche ou lointaine, sont recopiés dans un seul tampon d'index, et seule la partie utile est envoyée au GPU. Les tuiles du massif passent de 1,3 km à 640 m, ce qui affine le culling. Palier bas, mobile : Rousses 78 → 49 draw calls, Avoriaz 98 → 30, village 70 → 46. Les triangles baissent aussi (275 → 258 k aux Rousses, 408 → 389 k à Avoriaz).
87. **Paliers de qualité Auto / Low / Medium / High.** « Auto » est le réglage par défaut, et le choix est gardé dans la sauvegarde. Les libellés restent en anglais, comme le reste de l'interface.
    - Détection au démarrage : un GPU logiciel ou faible (SwiftShader, Mali 4xx à 7xx, Adreno 300 à 500, PowerVR), ou un téléphone avec 4 Go ou moins (ou 4 cœurs ou moins), passe en Low. Les autres téléphones et tablettes passent en Medium, un ordinateur en High (en Medium avec un Intel HD/UHD ancien).
    - Repli : en Auto seulement, si les images restent lentes alors que la résolution adaptative est déjà à 50 %, on descend d'un palier. Un palier choisi à la main n'est jamais changé : le joueur a décidé.
    - Low dessine directement à l'écran. Medium passe par un EffectComposer (cible HDR demi-flottant avec stencil, pour l'ombre du skieur, puis OutputPass). High ajoute le MSAA ×4 sur cette cible et un bloom très léger (seuil 0,92 : seuls les reflets du soleil sur la neige fleurissent). Le canvas n'a plus d'antialias, puisque celui-ci n'atteint pas une cible hors écran.
    - Avec le post-traitement, renderer.info compte toute l'image (scène et passes). Rousses, mobile : 78 draw calls en Medium, 91 en High, contre 49 en Low. Le budget de 60 n'est tenu qu'en Low ; Medium et High dépassent à cause de la foule (24 corps et leurs ombres) et du bloom.
88. **Lumière de base.**
    - Soleil : en free ride, il est à sa vraie position au-dessus du Jura et du Chablais à la mi-février (latitude 46,4°, déclinaison −12,6°, heure solaire = heure légale − 50 min). Le temps du jeu se lit 7 h + 12 h × t. Le départ passe à 15 h 30 (t = 0,708), et le cycle lent existant continue jusqu'au crépuscule. L'élévation ne descend jamais sous 2°, pour que la scène reste éclairée. Le mode arcade garde son soleil réglé à la main (avant-gauche), qui sert la lisibilité des pistes.
    - Ciel : on garde le dôme et ses ambiances (pas le ciel Preetham de three, dont l'horizon ne se raccorde pas à une brume de couleur unique). Il gagne trois effets liés à la hauteur du soleil : horizon plus chaud côté soleil et plus froid à l'opposé, zénith plus sombre quand le soleil est bas, large halo autour du soleil bas.
    - Brume de hauteur : les chunks de brouillard de three sont patchés (`src/render/heightFog.ts`). La brume est plus épaisse au fond des vallées, plus fine en altitude ; elle diminue de moitié tous les 260 m au-dessus du fond (altitude basse de la station − 150 m). Les matériaux reçoivent l'uniforme dans `onBeforeCompile` ; sans lui, la brume de hauteur est simplement coupée (arcade).
    - Distance de rendu : au palier bas, la brume ferme la vue à 5 km et le plan lointain de la caméra s'arrête au même endroit. Ce qui serait entièrement dans la brume n'est donc plus dessiné. Medium et High gardent la vue jusqu'au Léman et au Mont-Blanc.
    - Tone mapping Neutral (Khronos PBR Neutral), exposition 1,15 : les couleurs sous environ 0,8 restent telles que dessinées, et seule la neige au soleil est adoucie au lieu d'être écrêtée. ACES et AgX auraient désaturé toute la palette.
    - Étalonnage (Medium et High, après le tone mapping) : ombres un peu plus froides, hautes lumières un peu plus chaudes, saturation +6 %, vignette douce. Le palier bas n'en a pas, puisqu'il n'a pas de post-traitement.
89. **Ombres.**
    - Les cascades de three (CSM) ont été écartées. L'addon crée une lumière directionnelle par cascade : tout matériau qu'on ne lui a pas fait préparer (skieurs, foule, objets instanciés) serait éclairé trois fois. Il remplace aussi le `onBeforeCompile` de chaque matériau, alors que trois matériaux en ont déjà un (trou du massif, scintillement, brume). À la place : une seule carte d'ombre pour le soleil, de 2048 px sur ±110 m en High et de 1024 px sur ±55 m en Medium (PCF doux), centrée devant la caméra et calée sur ses texels pour ne pas scintiller. Pas d'ombre portée au palier bas.
    - Ce qui projette une ombre : sapins proches (version détaillée jusqu'à 300 m en Medium et 450 m en High), bâtiments, restaurants, pylônes, sièges et cabines. Ce qui la reçoit : terrain, bâtiments, restaurants. Les skieurs gardent leur ombre projetée existante, pour ne pas la doubler. Le relief ne projette pas dans la carte, il a ses propres ombres (point suivant).
    - Soleil bas derrière la caméra : les sapins et les bâtiments à moins de 150 m (Medium) ou 260 m (High) restent dans les tampons même hors du champ, et la boîte d'ombre part de 650 m en amont du soleil. Vérifié par comptage (`scripts/check-shadows.mjs` et un relevé ponctuel) : l'arbre placé derrière la caméra est dans le tampon qui projette les ombres et en sort quand ce rayon vaut 0. Sur ce point, son ombre ne change pas mesurablement les pixels, donc l'effet visible n'est pas démontré. Au-delà de la distance des sapins proches, un sapin ne projette plus d'ombre : avec un soleil sous 5°, une ombre longue de plus de 300 m peut manquer.
    - Ombres du relief, pour tous les paliers : calculées sur le CPU sur la grille de 20 m. Pour chaque nœud, on marche vers le soleil de 15 m à 3 km (pas croissant de 20 %), et la plus forte pente rencontrée donne l'ombre, avec un bord doux. Le résultat est une texture lue par tous les matériaux éclairés (même hook que la brume), qui atténue la lumière directe du soleil. Premier calcul au démarrage : 18 ms aux Rousses et 29 ms à Avoriaz en desktop, 61 et 116 ms avec le CPU ×4. Quand le soleil a tourné d'environ 1°, le calcul est refait sur environ 20 images, et la texture n'est remplacée qu'à la fin.
    - **Correctif de la sous-étape A.** Les sapins « profonds » (une seule géométrie) étaient supprimés au-delà de la distance de LOD, 200 m au palier bas : les forêts lointaines disparaissaient sans que personne l'ait décidé. Ils sont maintenant toujours dessinés. Palier bas, mobile : Rousses 246 → 276 k, Avoriaz 240 → 278 k, village 233 → 260 k. Les chiffres de la sous-étape A et de l'étape 3 sous-estimaient donc le coût réel.
    - Le palier High à Avoriaz tombe à 30 FPS au p95, même sur le GPU du M1 (2,6 M triangles, passe d'ombre comprise). High reste un réglage pour ordinateur puissant ; l'Auto ne le choisit que sur ordinateur et redescend si ça rame.
90. **Neige** (`src/render/snow.ts`, matériaux de neige seulement, aucun triangle).
    - Velours de dameuse : stries tous les 30 cm et passes de 4,5 m, sur la neige damée. Le sens vient de la piste elle-même (`pisteAt` puis `along`), pas de la ligne de pente : les pistes sont taillées en banquettes, souvent en traversée, et la ligne de pente du terrain y est perpendiculaire au passage de la dameuse (premier essai abandonné). Le sens est stocké en (cos 2θ, sin 2θ) dans une texture RGBA de la grille de 10 m, pour s'interpoler sans saut entre les nœuds. Calcul au chargement : 14 ms aux Rousses, 56 ms à Avoriaz en desktop. Les stries s'effacent avant de crénelage (`fwidth`) et au-delà de 70 m ; les passes, au-delà de 240 m.
    - Grain de 12 cm (±3,5 % de luminosité), près de la caméra seulement.
    - Ombres bleutées : la lumière qui ne vient pas du soleil (ciel, sol) est un peu plus bleue sur la neige.
    - Les stries régulières qui traversent la piste dans la capture « vue-piste » viennent des ombres de la lisière au soleil de 14 h 30 (mesuré : elles disparaissent avec la carte d'ombre, pas sans velours ni sans relief). Le velours lui-même n'a pas été vérifié à l'œil, faute de captures disponibles.
91. **Budget de triangles du palier bas : proposition, non imposée.** Mesuré en fin de session (Pixel 7 émulé) : Rousses 271 k, Avoriaz 278 k, village 255 k. La brume à 5 km a fait passer Avoriaz de 408 à 278 k, sans descendre sous 250 k. Une fois les forêts lointaines rétablies, le jeu normal dépasse lui aussi de 2 à 10 %. Deux voies, au choix :
    - garder 250 k partout et payer en image au palier bas : brume à 3,5 km, 8 corps dans la foule au lieu de 12, forêt lointaine éclaircie au-delà de 1,5 km, ou un maillage par restaurant (il faudrait alors assouplir `restos-view.test.ts`) ;
    - fixer un budget en deux parties : environ 280 k pour le jeu normal au palier bas (piste, village) et environ 450 k pour le panorama du sommet (Avoriaz, vue jusqu'à Morzine). Le budget « panorama » tolère 450 k parce que ce point de vue est rare et immobile.
    Rien n'est changé en attendant la décision.
92. **Critique indépendante** (un sous-agent, 4 images réduites : avant/après pour la piste des Rousses et le sommet d'Avoriaz). Notes de l'après : piste 6/10, Avoriaz 7/10, globale 6,5/10. Défauts relevés, du plus grave au moins grave : 1) dominante lavande sur toute la neige ; 2) velours répétitif et visible trop loin ; 3) lumière plate, l'ombre presque aussi claire que le soleil ; 4) brume et ciel sans profondeur, zénith qui ne bleuit pas ; 5) sapins bleu ardoise presque noirs.
    - Corrigés : 1) couleurs du ciel et du sol de l'hémisphère tirées vers le bleu-cyan et le gris chaud ; mesuré sur la piste, l'ombre vaut [79, 95, 120] en RVB, bleu-cyan et non plus mauve. 3) En free ride, lumière du ciel ×0,8 et soleil ×1,15, soit une ombre à environ la moitié de la neige au soleil (calcul sur les intensités). 2) Passes du velours effacées entre 25 et 90 m au lieu de 60 à 240 m, amplitude 3 → 2 %.
    - Non corrigés, faute de marge : 4) profondeur du ciel et de la brume ; 5) couleur et liseré des sapins. La chaleur de la neige au soleil n'a pas été vérifiée : la zone mesurée était surtout à l'ombre, et aucune capture ne restait pour regarder.
93. **Comme dans Grand Mountain Adventure : bouton de télésiège et journée calme.** Le wiki de GMA refuse l'accès (HTTP 402), et la page Steam comme les tests lus ne décrivent ni l'embarquement ni le cycle jour/nuit. Ce qui suit vient donc de ce qu'ils confirment (des télésièges qu'on accélère en maintenant une touche) et de la logique du jeu.
    - Près d'une gare du bas, un gros bouton « 🚡 Ride <nom> » apparaît ; un toucher ou un clic embarque. Sur PC, il affiche « Space » et Espace marche toujours. Maintenir pendant la montée l'accélère, comme avant.
    - Jour/nuit : la nuit tombait en environ 3 minutes de jeu (de 15 h 30 au crépuscule). Le temps avance maintenant 12 fois moins vite (de 15 h 30 à l'heure dorée, vers 17 h, en environ 20 minutes) puis s'arrête : il ne fait plus jamais noir. Un vrai ski de nuit (pistes éclairées) reste à faire.
94. **Tutoriel du premier free ride** (`src/ui/tutorial.ts`). Play, puis une station : on arrive dans la file d'un télésiège. Chaque leçon fige le jeu sur le geste à faire jusqu'à ce que le joueur le fasse : bouton Ride (contour qui pulse), deux pouces pour monter plus vite (deux ronds posés), droite puis gauche (un rond de chaque côté), saut (deux ronds qui tapent), salto arrière (deux ronds qui tirent vers l'arrière, avec « lâche quand tu es à l'endroit »), une petite forêt, le freinage. Ensuite : « You finished the tutorial! Continue », et le free ride reprend en haut du télésiège pris.
    - Après le télésiège, les leçons ont lieu sur une piste à part, « tuto » : droite, large (22 m), pente de 10°. Elle a deux bosses sur toute sa largeur (le skieur peut être n'importe où après les zigzags) et une petite forêt. Les stations ne sont pas touchées : les montagnes restent à l'échelle 1:1.
    - Un salto raté (chute, ou moins d'un tour) reprend juste avant la grande bosse, pas au début du tutoriel.
    - « Skip tutorial » en haut à gauche. Terminé ou passé une fois, le tutoriel ne revient plus dans ce navigateur (localStorage `sillage.tutorial`, versionné : TUTORIAL_VERSION dans main.ts le remontre à tous). Un lien direct vers une station (`?station=`, sites des stations) n'en a pas.
    - Au tactile, les saltos sont inversés : pouces tirés vers l'arrière = salto arrière, poussés vers l'avant = salto avant. Le clavier est inchangé (↑ arrière, ↓ avant).
    - Depuis la pause, un toucher sur la mini-carte ouvre la carte des pistes ; la fermer ramène au menu pause.


## Refonte visuelle 2 (branche `refonte-visuelle-2`, session autonome du 15/11/2026)

95. **Décisions du commanditaire, prises avant la session.**
    - Budget de triangles du palier bas : environ 280 k en jeu normal (piste, village), environ 450 k pour le panorama du sommet d'Avoriaz. C'est la deuxième voie proposée au point 91.
    - Draw calls : 60 au plus au palier bas, 90 en moyen, 110 en élevé.
    - Le Chalet du Lac n'est pas dans le jeu. Son style (`docs/restos/chalet-du-lac.md` et ses photos) sert de modèle à un archétype « chalet en rondins / restaurant bois » utilisé ailleurs.
    - Illico Resto est dans le jeu : il est refait d'après `docs/restos/illico-resto.md` (ferme crépie, arche en pierre) et les 8 vues `sv_yaw*.jpg`.
    - Les photos de `docs/restos/` servent à regarder. Elles n'entrent ni dans une texture ni dans le build.
96. **Ciel et brume (étape 1).** Mesures de départ, palier bas, Pixel 7 émulé : Rousses 271 k / 49, Avoriaz 278 k / 31, village 255 k / 45. Comparaison faite avec 4 photos de Wikimedia Commons (Haut-Jura en hiver, Chasseral en hiver, épicéas enneigés, Avoriaz en décembre), gardées hors du dépôt.
    - Nouvelle clé d'ambiance à t = 0,68 (15 h 10 en free ride) : zénith `#3f74c4`, horizon `#e6e4dc` presque neutre. Avant, 15 h 30 tombait entre midi et la golden hour, et tout le ciel virait au saumon. La golden hour garde un zénith bleu (`#3d66b4` au lieu de `#45559d`, qui tirait sur le violet) et prend l'horizon de la palette (`#f6b98a`).
    - Dôme : l'horizon prend `uHorizon` vers le soleil et une teinte plus pâle et plus froide à l'opposé (`fogAway`). Le dégradé passe de l'horizon à un bleu pâle dans une bande fine (plus large vers un soleil bas), puis fonce jusqu'au zénith. Mélanger directement l'horizon chaud et le bleu donnait un ciel mauve.
    - Brume : même loi que le dôme, selon la direction du regard, pour que le relief lointain se fonde dans l'horizon de sa propre direction. Tant qu'elle est fine, la brume est plus bleue (`fogHaze`, entre le zénith et l'horizon) : les versants lointains bleuissent d'abord, puis pâlissent. Aucune passe, quelques opérations par pixel dans le chunk de brouillard déjà patché. Sans ciel (`fogSun` nul), la brume reste la couleur unique d'avant.
    - Piège rencontré : le produit scalaire normalisé dépassait parfois [-1, 1] d'un cheveu, et `sqrt` d'un nombre négatif rendait des pixels noirs (les sièges d'un télésiège lointain dans le ciel). `toward` est maintenant borné à [0, 1].
    - Aiguilles des sapins : `#2e5b52` (bleu canard, presque noir sous la lumière du ciel) devient `#40623f`, un vert d'épicéa. L'étape 2 refait les arbres.
    - Aucun triangle ni draw call en plus.
97. **Végétation (étape 2, `src/render/trees.ts`).**
    - Deux formes instanciées, chacune avec une géométrie proche et une lointaine, donc 4 draw calls comme avant. Le conifère sert à l'épicéa et au sapin : l'espèce change la teinte (épicéa `#30592f`, sapin `#24493a`, plus sombre) et la largeur (sapin plus large). L'arbre nu sert aux feuillus d'hiver en bas de station et aux mélèzes en altitude à Avoriaz, dessinés plus hauts et plus minces, en brun roux.
    - Espèce choisie par arbre d'après son altitude relative dans la station et son identifiant : feuillus dans les 16 % les plus bas (1 arbre sur 5), sapins sous 55 % aux Rousses (38 %), mélèzes au-dessus de 50 % à Avoriaz (de 20 à 50 % des arbres en montant), épicéas ailleurs. À Avoriaz, les arbres rapetissent jusqu'à 30 % en haut de la forêt. La simulation n'est pas touchée : les obstacles restent ceux d'avant, seul leur dessin change.
    - Conifère proche : 44 triangles (tronc court et 4 étages en étoile, dessous fermé sur les 2 étages bas, qu'un skieur voit). Ancien sapin : 62. Conifère lointain : 6 triangles, un seul étage sans fond. L'ancien cône lointain en avait 12, dont 6 de fond jamais vu. Arbre nu : 46 triangles de près, 5 de loin.
    - Normales arrondies données à la main : avec des facettes plates, les étages en étoile ressemblaient à des éclats de cristal.
    - Couleurs de sommet détournées : r = neige, g = ombre, b = bois. Le shader mélange la teinte de l'instance et la couleur de l'écorce, puis pose la neige au pixel près (`smoothstep` dans le fragment shader). Calculé par sommet, le seuil donnait un dégradé gris au lieu d'une calotte blanche. La quantité de neige varie d'un arbre à l'autre.
    - Vent : balancement lent dans le vertex shader, proportionnel au carré de la hauteur, déphasé d'un arbre à l'autre, environ 15 cm en haut d'un arbre de 20 m. La passe d'ombre (medium et high) ne balance pas : l'écart n'est pas visible à cette amplitude.
    - Densité : chaque liste est triée pour qu'un préfixe éclaircisse uniformément, avec les arbres de lisière (h < DEEP) deux fois moins éclaircis que ceux du fond des bois. Palier bas : 80 % des arbres de lisière et 40 % du fond (avant : 30 % partout). Moyen : 100 % et 60 % (avant : 50 %). Le gain des cônes lointains paie cette densité.
    - Pas d'imposteurs (sprites texturés) au loin. Un conifère lointain coûte déjà 6 triangles, et un imposteur demande un test alpha qui casse l'early-z et ajoute du remplissage sur un GPU mobile. Au-delà de quelques centaines de mètres, la couleur sombre des bois sur le terrain (`C_WOODS`) porte déjà la masse de la forêt.
    - Clairières et zones denses viennent des données (OSM). Clairsemer la haute altitude en cachant des arbres aurait laissé des obstacles invisibles : seule leur taille baisse.
    - Mesures, triangles / draw calls, avant puis après l'étape. Palier bas, Pixel 7 émulé : Rousses 276 k / 50 puis 269 k / 49, Avoriaz 278 k / 31 puis 280 k / 32, village 260 k / 47 puis 252 k / 48. Desktop, Rousses : moyen 543 k / 89 puis 514 k / 88, élevé 889 k / 102 puis 790 k / 101.
