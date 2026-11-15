# Direction artistique

Ce document fixe le rendu visé par la refonte visuelle et les techniques retenues pour l'atteindre, avec leur coût par palier de qualité. Les mesures réelles sont dans `PERF.md`, les choix techniques dans `DECISIONS.md`.

## Point de départ

Les captures de `docs/captures/avant/` montrent le jeu avant la refonte :

- éclairage Lambert sans aucune ombre portée, donc des volumes plats ;
- sapins en cônes empilés, tous identiques à l'échelle près ;
- bâtiments en boîtes, avec un toit pyramidal blanc et une bande jaune par étage ;
- ciel en dégradé de deux couleurs, brouillard linéaire d'une seule teinte ;
- gares de remontée faites de trois boîtes, sièges réduits à deux planches bleues.

Le relief, lui, est juste : il vient des tuiles d'altitude et d'OpenStreetMap. La refonte garde cette base et change tout ce qui la recouvre.

## Ambiance visée

Une fin de journée d'hiver dans le Jura et les Alpes du Nord. À la mi-février, à 46,4° de latitude, le soleil ne dépasse pas 31° à midi. Il reste donc bas toute la journée, et c'est ce qui donne aux stations leurs ombres longues et leur lumière dorée dès 15 h.

- **Heure par défaut en free ride : 15 h 30.** Le soleil est au sud-ouest, à 17° environ. Le cycle avance lentement et s'arrête à l'heure bleue, vers 18 h, quand les fenêtres s'allument.
- **Azimut réel en free ride** (x = est, z = sud) : le soleil se lève à l'est-sud-est, passe au sud, se couche à l'ouest-sud-ouest. Les pistes arcade, fictives, gardent leur soleil « de scène » venu de l'avant-gauche.
- **Quatre heures de référence**, choisies dans les réglages ou par `?time=` : aube (8 h), jour (12 h 30), golden hour (16 h 45), nuit (21 h, lune haute).
- **Neige** : blanc chaud au soleil, bleu franc à l'ombre. C'est le ciel qui éclaire les ombres, pas un gris.
- **Forêt** : épicéas sombres, presque noirs à contre-jour, chargés de neige sur le dessus des branches.
- **Bâti** : bois miel et brun, crépi gris-beige, toits anthracite ou tuile brune sous une couche de neige épaisse, fenêtres jaune chaud le soir.

## Palette

| Élément | Couleur | Note |
|---|---|---|
| Neige au soleil (golden hour) | `#fff1dc` | albédo `#f2f5f9` éclairé par un soleil `#ffc890` |
| Neige à l'ombre | `#8ea6d6` | éclairée par le ciel seul |
| Neige damée | `#e9eef6` | velours côtelé visible en lumière rasante |
| Glace du lac | `#b9cfe0` | plaques de neige soufflée `#eef3f8` |
| Calcaire du Jura | `#a3a298` | falaises au-delà de 45° |
| Aiguilles d'épicéa | `#22382c` à `#35513d` | teinte par arbre |
| Aiguilles de sapin | `#1c3027` | plus sombre, port plus large |
| Mélèze en hiver | `#8a6a3c` | rameaux nus, roux |
| Écorce | `#4a3b30` | |
| Rondins, bardage miel | `#a8703c` | Chalet du Lac |
| Bardage brun vieilli | `#5e4330` | chalets, fermes |
| Crépi gris-beige | `#cfc8b8` | fermes jurassiennes, Illico Resto |
| Bardeaux de cèdre rouge | `#8c4a32` | résidences d'Avoriaz |
| Toit bac acier | `#3d4146` | joint debout |
| Fenêtre éclairée | `#ffc56b` | émissif, 2 700 K |
| Ciel au zénith (15 h 30) | `#3f74c4` | modèle de Preetham, turbidité 2,5 |
| Horizon (golden hour) | `#f6b98a` | sert aussi de couleur à la brume |

## Techniques retenues et coût par palier

Trois paliers : **bas** (mobile milieu de gamme), **moyen** (mobile haut de gamme, portable à puce graphique intégrée), **élevé** (ordinateur avec carte graphique). Le palier est détecté au premier lancement et reste réglable à la main. Les coûts ci-dessous sont ceux prévus avant mesure.

| Technique | Bas | Moyen | Élevé |
|---|---|---|---|
| Sortie | rendu direct dans le canvas, tone mapping dans les shaders | cible HDR demi-flottante, une passe finale, FXAA | cible HDR, MSAA ×4 |
| Ciel | modèle de Preetham cuit dans une cubemap de 128 px par face, relue par le dôme (1 lecture par pixel) | cubemap de 256 px | shader calculé en direct, nuages nets |
| Soleil et ombres | carte d'ombre du relief calculée sur le processeur (1 texture, 1 lecture) et ombres plaquées sous les arbres proches | idem, plus 2 cascades de 1 024 px sur 90 m | 2 cascades de 2 048 px sur 220 m |
| Occlusion ambiante | occlusion du relief cuite dans la même texture, occlusion par sommet sur les arbres et les bâtiments | idem, plus GTAO en demi-résolution | GTAO en pleine résolution |
| Brume | brume de hauteur analytique dans chaque shader, teintée vers le soleil (aucune passe) | idem | idem |
| Tone mapping et étalonnage | AgX, exposition par heure, étalonnage dans la même fonction | même fonction, en passe finale, plus vignette | idem, plus bloom à 5 niveaux |
| Bloom | non | 4 niveaux en demi-résolution | 5 niveaux |
| Neige | albédo par zone, scintillement coupé, grain de normale à une échelle | scintillement, deux échelles, velours des pistes | idem, plus ombres de nuages |
| Végétation | 3 espèces, géométrie simple jusqu'à 60 m, imposteurs au-delà, densité 35 % | détail jusqu'à 110 m, densité 60 % | détail jusqu'à 160 m, densité 100 %, vent |
| Bâtiments | volumes texturés, fenêtres peintes dans la texture | fenêtres, balcons et débords en géométrie jusqu'à 250 m | idem jusqu'à 600 m |
| Particules | neige soufflée réduite, fumée coupée | fumée des cheminées, brume de vallée | idem, densité pleine |
| Résolution | rapport de pixels 1, adaptatif jusqu'à 0,5 | 1,5 | 2 |

### Pourquoi une carte d'ombre du relief

Le soleil bas met des versants entiers à l'ombre. Des cascades d'ombre classiques ne portent pas à 5 km. Un balayage de la grille d'altitude dans la direction du soleil donne, en un passage, l'ombre de chaque crête et de chaque lisière de forêt sur tout le massif. Le résultat tient dans une texture relue par tous les matériaux. Il coûte une lecture de texture par pixel, sur les trois paliers, et se recalcule par tranches quand le soleil bouge.

Les ombres en cascade ne servent qu'au détail proche : chaque sapin, le skieur, les pylônes. Au-delà de leur portée, elles se fondent dans la carte du relief.

### Pourquoi pas de matériaux PBR

Presque tout ce qu'on voit est mat : neige, bois, crépi, écorce, aiguilles. Un éclairage Lambert avec des textures de normales rend ces surfaces correctement et coûte deux à trois fois moins par pixel qu'un matériau physique complet. Le verre, la glace et l'acier des remontées prennent un reflet du ciel et un éclat spéculaire simple. Le même matériau sert aux trois paliers, ce qui évite d'entretenir deux jeux de shaders.

### Assets

- **Textures** : Poly Haven (CC0), en 512 px ou 1 024 px, chargées après le premier rendu. Chacune est consignée dans `CREDITS.md`.
- **Modèles** : générés en code (arbres, bâtiments, remontées, mobilier). Les modèles photogrammétriques libres pèsent trop lourd pour un mobile, et les packs low-poly ne tiennent pas à côté de textures photo.
- **Photos de `docs/restos/`** : elles servent à observer les volumes, les matières et les couleurs des deux restaurants de référence. Elles n'entrent ni dans le build ni dans une texture, et le code livré ne les cite pas.

## Ce que chaque capture doit montrer après la refonte

| Capture | Critère |
|---|---|
| `jour` | ombres des crêtes sur les combes, forêt lisible en masse, lointain bleuté par la brume |
| `soleil-bas` | ombres longues des sapins sur la piste, neige dorée d'un côté et bleue de l'autre |
| `nuit` | fenêtres allumées, neige éclairée par la lune, ciel étoilé |
| `brume` | les sapins s'effacent par plans successifs, la brume s'épaissit vers le bas |
| `vue-piste` | velours de dameuse, traces, scintillement, skieur ombré |
| `vue-village` | aucun bâtiment identique à son voisin, matières lisibles, gare de télésiège crédible |
