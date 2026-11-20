# Crédits

## Assets dans le build

Un seul asset externe : le modèle du skieur du joueur (ci-dessous). Arbres, bâtiments, remontées, mobilier de piste, ciel et neige sont générés en code (`src/render/`). Les textures du jeu sont dessinées au chargement (canvas) : bannières et noms des restaurants.

Règle pour la suite : un asset externe n'entre que sous licence CC0 ou CC-BY (Poly Haven, Quaternius, Kenney), avec une ligne ici : source, auteur, licence, URL, fichier.

| Fichier | Source | Auteur | Licence | URL |
|---|---|---|---|---|
| `public/models/skier-high.glb`, `public/models/skier-low.glb` (le skieur du joueur) | « Skiing Lady », Sketchfab | lancehuang526 | CC BY 4.0 | https://sketchfab.com/3d-models/skiing-lady-52aabb1e0773487b93a6e56d0f0b875b |

Modifications (`scripts/build-avatar.mjs`, `src/render/avatar.ts`) : sol retiré ; textures des skis, de la sangle du masque et des bâtons retirées (elles portaient le logo d'une marque réelle), remplacées par des couleurs unies ; cagoule en tissu uni ; textures réduites (1 024 et 512 px, WebP) ; version basse simplifiée ; modèle réattaché au squelette du jeu ; veste, pantalon, casque et accents recolorés selon la tenue choisie. Attribution visible dans le jeu, en bas de l'écran Réglages.

## Photos de référence consultées (hors dépôt, hors build)

Regardées pour comparer la lumière, la neige, la forêt et le bâti pendant la refonte visuelle 2. Elles ne sont ni copiées dans le dépôt ni utilisées comme texture.

| Photo | Auteur | Licence | URL |
|---|---|---|---|
| Haut-Jura en hiver | voir la page | voir la page | https://commons.wikimedia.org/wiki/File:Haut-Jura_en_hiver..jpg |
| Chasseral en hiver 01 | Oblic | CC BY-SA 3.0 | https://commons.wikimedia.org/wiki/File:Chasseral_en_hiver_01.jpg |
| Norway spruce (Picea abies), near Gehlberg, 2018 02 | KaiKemmann | CC BY 4.0 | https://commons.wikimedia.org/wiki/File:Norway_spruce_(Picea_abies),_near_Gehlberg,_Thuringian_Forest,_Germany,_March_21st_2018_02.jpg |
| Avoriaz France winter december 2008 | Look Sharp! | CC BY-SA 3.0 | https://commons.wikimedia.org/wiki/File:Avoriaz_France_winter_december_2008.jpg |

Les photos de `docs/restos/` (Illico Resto, Chalet du Lac) suivent la même règle : elles servent à regarder et restent hors du build (`.gitignore`).
