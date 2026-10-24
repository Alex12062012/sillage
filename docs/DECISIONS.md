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
