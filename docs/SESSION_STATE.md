# État de la session : refonte visuelle

Arrêt demandé le 15/11/2026. Branche `refonte-visuelle`, rien de poussé, rien de déployé. La prochaine session reprend ici.

## Fait

- Audit de l'étape 0 : lecture de `ARCHITECTURE.md`, `PERF.md`, `FEEL.md` et de tout le code de rendu.
- État de départ vérifié avant toute modification : lint, typecheck et 127 tests unitaires verts.
- 11 captures dans `docs/captures/avant/` : les 6 demandées (`jour`, `soleil-bas`, `nuit`, `brume`, `vue-piste`, `vue-village`) et 5 en plus (`extra-gare`, `extra-illico`, `extra-foret`, `extra-avoriaz`, `extra-arcade`). Les points de vue sont fixés dans `scripts/shots.mjs`.
- `docs/ART_DIRECTION.md` : ambiance, palette, techniques prévues par palier. Aucune de ces techniques n'est codée.
- `scripts/shots.mjs` (captures), `scripts/perf.mjs` réécrit (mesure par palier, profil et scène), `scripts/scout.mjs` (positions des remontées, restaurants et pistes d'une station).
- Deux ajouts à l'API de debug `window.__sillage` : `raw()` (accès au jeu) et `photo()` (caméra libre), avec le champ `Game.photo` dans `game.ts`.

## En cours

Rien n'est à moitié codé. Le build de production passait après l'ajout des deux fonctions de debug. Le lint et les tests n'ont pas été relancés depuis.

## Reste à faire

Toute la refonte. Le dernier cadrage reçu limite la prochaine session à une seule couche, dans cet ordre :

1. Ajouter `docs/restos/*/` au `.gitignore`.
2. Retirer `raw()` et `photo()` du build de production, et le prouver en inspectant le bundle. Aujourd'hui elles y sont, puisque `window.__sillage` est toujours exposé. Les tests e2e s'appuient sur le reste de cette API, qui doit rester.
3. Fixer 3 scénarios de mesure reproductibles (free ride aux Rousses, free ride à Avoriaz, vue village) et les consigner dans `PERF.md`.
4. A. Palier bas sous 250 000 triangles visibles dans les 3 scénarios.
5. B. Paliers : Auto, bas, moyen, élevé, avec descente automatique si le FPS reste sous le seuil.
6. C. Lumière : ciel physique, soleil à sa vraie position, ombres, brume de hauteur, tone mapping, neige.
7. D. Tests et captures « après ». E. Critique par un relecteur indépendant.

Les couches suivantes (végétation, bâtiments, modèles, lac, optimisation finale) viennent après.

## Chiffres mesurés (référence avant refonte)

Build de production, MacBook M1, Chromium de Playwright, GPU via ANGLE Metal. Le profil mobile est un Pixel 7 émulé avec le processeur bridé ×4. Le GPU n'est pas bridé.

| Palier | Scène | Triangles | Draw calls | Heap JS (Mo) |
|---|---|---|---|---|
| bas | rousses | 1 050 k | 95 | 74 à 82 |
| bas | village | 934 k | 61 | 72 à 79 |
| bas | avoriaz | 1 387 k | 32 | 119 à 135 |
| bas | arcade | 79 k | 37 | 16 à 18 |
| moyen | rousses | 1 276 k | 95 | 69 à 88 |
| moyen | village | 1 160 k | 61 | 72 à 88 |
| moyen | avoriaz | 1 673 k | 32 | 119 à 136 |
| moyen | arcade | 86 k | 43 | 16 à 17 |
| élevé | rousses | 2 318 k | 95 | 70 à 73 |
| élevé | village | 2 202 k | 61 | 66 à 72 |
| élevé | avoriaz | 3 337 k | 32 | 135 à 158 |
| élevé | arcade | 89 k | 46 | 15 à 18 |

- FPS : 60 dans les 24 mesures, sur ordinateur (1280×720) comme en mobile émulé. Rapport de pixels en mobile : 1, 1,5 et 2 selon le palier.
- Chargement jusqu'à la disparition de l'écran d'attente : 0,7 s en arcade, 1,2 s aux Rousses, 1,8 à 2,0 s à Avoriaz.
- Bundle gzip : JS principal 218 ko, CSS 5,5 ko, données des Rousses 229 ko, données d'Avoriaz 534 ko.
- Le free ride dépasse le budget de 250 000 triangles de `PERF.md` dans tous les paliers, y compris le bas.

Scènes de `scripts/perf.mjs` : `rousses` part du haut du Jouvenceaux avec le bot à 60 km/h, `village` reste à l'arrêt en (-1549,5 ; -1710,5), `avoriaz` part du sommet avec le bot à 60 km/h, `arcade` suit Couloir Noir à 65 km/h. Les scènes pilotées par le bot ne repassent pas exactement au même endroit d'une mesure à l'autre. C'est le point 3 ci-dessus.

## Pièges

- Node n'est pas dans le `PATH`. Avant toute commande : `export PATH="$HOME/.nvm/versions/node/v26.5.1/bin:$PATH"`.
- Pousser sur `main` déploie en production sur Vercel. Ne rien pousser sans demande.
- Les photos de `docs/restos/` ne sont pas dans git et ne doivent pas y entrer : le dépôt est public. Ne jamais faire `git add -A` tant que le `.gitignore` n'est pas complété. Le dossier `Claude outputs/` n'est pas suivi non plus et n'a pas été touché.
- `scripts/raw/` n'existe pas sur cette machine : on ne peut pas relancer `bake-station.mjs` sans retélécharger les données.
- `scripts/perf.mjs` : un onglet sans affichage a bloqué une fois 60 s sur sa première image. Un second essai automatique est en place. La matrice complète (3 paliers, 2 profils, 4 scènes, 8 s chacune) prend environ 6 minutes.
- `scripts/shots.mjs` recharge la page après la capture `brume`, car l'ancien brouillard ne se remet pas en place. Quand le bot conduit, l'invite « ride ... » du HUD reste figée à sa dernière valeur.
- Le Chalet du Lac n'est pas dans les données du jeu. D'après la limite nord de la grille (environ 46,468° N), il se trouverait à peu près 3 km hors de la zone skiable. Position non vérifiée.
- Illico Resto est dessiné en chalet bois. La fiche `docs/restos/illico-resto.md` décrit une ferme crépie.
- Three.js 0.186 fournit déjà `SunLight` (ombres à 2 cascades, `examples/jsm/lights/`) et un ciel de Preetham avec nuages (`examples/jsm/objects/Sky.js`). Le tone mapping de Three ne s'applique que dans le canvas, pas dans une cible de rendu. Dans les shaders de Three, le brouillard passe après le tone mapping : pour une brume en espace linéaire, il faut l'appliquer plus tôt, par exemple dans le chunk `opaque_fragment`.
- Coût : la première heure, en effort `xhigh`, a épuisé le forfait. Travailler une couche par session, sans sous-agents, et vérifier `/usage` avant de lancer.
