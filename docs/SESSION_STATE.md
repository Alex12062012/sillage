# État de session : refonte visuelle

## Session 2 (15/11/2026, autonomie) : couche lumière

Étapes : 1 draw calls, 2 paliers, 3 lumière de base, 4 ombres, 5 neige, 6 remesure, 7 critique.

- [x] 1. Draw calls (palier bas, mobile) : Rousses 78 → 49, Avoriaz 98 → 30, village 70 → 46. Triangles : 275 → 258 k, 408 → 389 k, 245 → 245 k. Commit « perf(free ride): tuiles en un seul maillage ».
- [x] 2. Paliers : Auto (par défaut) / Low / Medium / High, mémorisé dans la sauvegarde. Low = rendu direct ; Medium = EffectComposer (cible HDR, sortie) ; High = + MSAA ×4 et bloom léger. En Auto, si le jeu reste lent à la résolution minimale, il descend d'un palier.
- [x] 3. Lumière de base : soleil réel en free ride (46,4° N, mi-février, départ 15 h 30), ciel plus riche autour du soleil bas, brume de hauteur (patch des chunks de brouillard), tone mapping Neutral (exposition 1,15), étalonnage en medium/high, palier bas fermé par la brume à 5 km. Palier bas : Rousses 246 k / 49 draw calls, Avoriaz 240 k / 30, village 233 k / 46.
- [ ] 4. Ombres
- [ ] 5. Neige
- [ ] 6. Remesure
- [ ] 7. Critique indépendante

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
