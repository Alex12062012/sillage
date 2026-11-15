# État de session : refonte visuelle

## Session 3 (15/11/2026, autonomie) : refonte visuelle 2

Branche `refonte-visuelle-2`, partie de `main`. Rien n'est poussé. Étapes : 1 lumière, 2 végétation, 3 bâtiments, 4 modèles, 5 critique.

Départ, palier bas, Pixel 7 émulé (triangles / draw calls) : Rousses 271 k / 49, Avoriaz 278 k / 31, village 255 k / 45. Captures de départ : `docs/captures/v2-avant/` (palier bas, profil mobile).

- [x] 1. Lumière : clé d'ambiance de l'après-midi, horizon froid à l'opposé du soleil, brume teintée selon la direction et bleutée à mi-distance, aiguilles vertes. Après : Rousses 276 k / 50, Avoriaz 278 k / 31, village 260 k / 47 (même géométrie, la foule fait varier le total de 5 à 10 k). DECISIONS.md, point 96.
- [x] 2. Végétation : conifère (épicéa, sapin) et arbre nu (feuillus, mélèzes), neige au pixel, vent, cônes lointains à 6 triangles, forêt plus dense au palier bas. Après : Rousses 269 k / 49, Avoriaz 280 k / 32, village 252 k / 48 ; moyen 514 k / 88 et élevé 790 k / 101 aux Rousses. DECISIONS.md, point 97.
- [x] 3. Bâtiments : Illico refait (ferme crépie, arche), cinq archétypes à variantes, vitres sombres le jour et allumées en fin de journée, restaurants regroupés par carré de 2 km (test mis à jour). Après : Rousses 241 k / 52, Avoriaz 282 k / 32, village 227 k / 51 ; moyen Rousses 456 k / 90 ; élevé Avoriaz 2 202 k / 57. DECISIONS.md, point 98.
- [ ] 4. Modèles
- [ ] 5. Critique

Usage : aucun outil de la session n'en donne le pourcentage (vérifié au début : rien dans `~/.claude`).

## Session 2 (15/11/2026, autonomie) : couche lumière

Étapes : 1 draw calls, 2 paliers, 3 lumière de base, 4 ombres, 5 neige, 6 remesure, 7 critique.

- [x] 1. Draw calls (palier bas, mobile) : Rousses 78 → 49, Avoriaz 98 → 30, village 70 → 46. Triangles : 275 → 258 k, 408 → 389 k, 245 → 245 k. Commit « perf(free ride): tuiles en un seul maillage ».
- [x] 2. Paliers : Auto (par défaut) / Low / Medium / High, mémorisé dans la sauvegarde. Low = rendu direct ; Medium = EffectComposer (cible HDR, sortie) ; High = + MSAA ×4 et bloom léger. En Auto, si le jeu reste lent à la résolution minimale, il descend d'un palier.
- [x] 3. Lumière de base : soleil réel en free ride (46,4° N, mi-février, départ 15 h 30), ciel plus riche autour du soleil bas, brume de hauteur (patch des chunks de brouillard), tone mapping Neutral (exposition 1,15), étalonnage en medium/high, palier bas fermé par la brume à 5 km. Palier bas : Rousses 246 k / 49 draw calls, Avoriaz 240 k / 30, village 233 k / 46.
- [x] 4. Ombres : carte d'ombre du soleil en medium (1024 px, ±55 m) et high (2048 px, ±110 m), recentrée devant la caméra et calée sur les texels ; ombres du relief calculées sur le CPU (grille de 20 m) pour tous les paliers. Bug de la sous-étape A corrigé : les sapins « profonds » étaient coupés au-delà de 200 m au palier bas. Palier bas après correctif : Rousses 276 k / 50, Avoriaz 278 k / 31, village 260 k / 47.
- [x] 5. Neige : velours de dameuse dans le sens de la piste (texture damé + direction sur la grille de 10 m, 14 ms aux Rousses et 56 ms à Avoriaz au chargement en desktop), grain de 12 cm près de la caméra, part de ciel bleutée dans l'ombre. Aucun triangle ajouté.
- [x] 6. Remesure (PERF.md, « Couche lumière ») : palier bas Rousses 271 k / 49, Avoriaz 278 k / 31, village 255 k / 45. Budget de 250 k non tenu, proposition dans DECISIONS.md point 91. e2e : 18 réussis, aucun échec.
- [x] 7. Critique indépendante : 6,5/10. Défauts 1 à 3 corrigés (lavande, contraste, velours au loin), 4 et 5 restent (DECISIONS.md point 92).

### Rapport final de la session 2

- Fait : les 7 étapes. Draw calls regroupés ; paliers Auto/Low/Medium/High avec repli ; lumière de base (soleil réel, 15 h 30, brume de hauteur, tone mapping Neutral, étalonnage) ; ombres (carte d'ombre en medium/high, relief sur le CPU pour tous) ; neige (velours, grain, ombres bleutées) ; remesure ; critique et 3 corrections.
- Palier bas, Pixel 7 émulé (CPU ×4), triangles / draw calls, avant → après : Rousses 275 k / 78 → 271 k / 49 ; Avoriaz 408 k / 98 → 278 k / 31 ; village 245 k / 70 → 255 k / 45. FPS 60 partout, p99 59,5.
- Les chiffres « avant » oubliaient les forêts lointaines (bug de la sous-étape A, corrigé). Le budget de 250 k n'est pas tenu : proposition de budget séparé dans DECISIONS.md, point 91.
- Medium : 543 k / 89, 1 476 k / 42, 402 k / 57. High : 889 k / 102, 2 647 k / 55 (Avoriaz : p99 à 30 FPS même sur le M1), 671 k / 70. Le budget de 60 draw calls n'est tenu qu'au palier bas.
- Reste moyen : sapins trop sombres, ciel et brume sans profondeur, High trop lourd à Avoriaz, la foule pèse beaucoup en Medium/High.
- Pas vérifié : la chaleur de la neige au soleil, le velours à l'œil, l'effet à l'image des ombres projetées par les objets derrière la caméra (seulement le comptage), le temps de démarrage sur un vrai téléphone (relief + velours : environ 0,2 à 0,35 s estimés avec le CPU ×4 à Avoriaz), le repli automatique de palier, qui n'a jamais été déclenché.
- L'émulation (CPU bridé, GPU du M1 non bridé) ne remplace pas un test sur un vrai téléphone.
- Usage : non mesurable depuis la session (aucun outil n'y donne accès). Rien n'a été poussé.


## Session 1 : sous-étape A

Branche `refonte-visuelle`. Dernière session : 15/11/2026, sous-étape A (budget de triangles du palier bas).

## Fait

- L'API de debug (`window.__sillage`, dont `raw()` et la caméra libre `photo()`) n'est plus dans le build de production. Elle n'est compilée qu'en mode `test` : `npm run build:test`. Les tests e2e (`playwright.config.ts`) et les scripts `perf.mjs` et `shots.mjs` s'en servent. Preuve : après `npm run build`, `grep -c __sillage dist/assets/index-*.js` donne 0.
- `docs/restos/*/` est dans le `.gitignore`. Les fichiers `.md` à la racine de `docs/restos/` restent non suivis, je n'y ai pas touché.
- Culling caméra et LOD lointain du décor de la montagne (DECISIONS.md, point 84). Commits 6d39e59, f628494 et 16617d9.
- `scripts/perf.mjs` : scénarios fixes (skieur freiné sur place) et option `--breakdown` (triangles par objet).

## Chiffres (palier bas, mobile Pixel 7, CPU ×4)

| Scénario | Avant | Après |
|---|---|---|
| Free ride Rousses | 1 044 k | 275 k |
| Free ride Avoriaz | 1 392 k | 408 k |
| Vue village | 914 k | 245 k |

## Reste

- Avoriaz et Rousses dépassent toujours 250 k. Les options sont listées dans DECISIONS.md (point 85) et toutes changent l'image : il faut une décision avant de continuer.
- Aucune comparaison visuelle palier bas avant/après. Les captures `docs/captures/avant/` sont en palier haut. Deux captures en palier bas après les changements (vue « jour » aux Rousses, sommet d'Avoriaz) ne montrent ni trou ni couture dans le terrain.
- Pas de mesure sur un vrai téléphone.

## Pièges

- `npm` n'est pas dans le PATH des shells non interactifs : `export PATH=~/.nvm/versions/node/v26.5.1/bin:$PATH`.
- Les scripts de mesure et les tests e2e demandent `npm run build:test`. Avec `npm run build`, `window.__sillage` n'existe pas et ils attendent jusqu'au timeout.
- La foule bouge : le total de triangles varie d'environ 10 k d'une mesure à l'autre.
- `tests/unit/restos-view.test.ts` impose 3 maillages au plus pour les restaurants.
- Le test e2e « gamepad A on Retry starts a clean new run » a échoué une fois sur 4 lancements, puis est passé 3 fois sans changement de code : il est instable.
- Les ombres des skieurs (`SkinnedMesh` projetées) ont `frustumCulled = false`. Le culling se fait dans `crowd.ts` avec `viewFrustum`, exporté par `mountainView.ts`, qui doit donc être mis à jour avant la foule dans `game.ts`.
