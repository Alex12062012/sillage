# PERF — mesures (22/10/2026)

Toutes les mesures portent sur le **build de production** (`npm run build && npm run preview`). Le bot parcourt la piste à 65 km/h et le temps de chaque frame est mesuré dans la page pendant 15 s (`scripts/perf.mjs`). Machine : MacBook M1, Chromium 1248 (Playwright 1.64.1), GPU via ANGLE Metal.

## Budget vs mesuré

| Poste | Budget (ARCHITECTURE.md) | Mesuré |
|---|---|---|
| FPS desktop | 60 | **60** (p95 59,5–59,9) |
| FPS mobile émulé (CPU ×4) | ≥ 30 (cible 60) | **60** (p95 59,5–59,9) |
| FPS « bas de gamme » (CPU ×6) | ≥ 30 | **60** (p95 59,9) |
| Draw calls | < 60 | **56–58** |
| Triangles visibles | < 250 k | **69–76 k** |
| Construction d'un chunk (pire cas) | ≤ 1 par frame, < 16 ms | 4,8–5,6 ms (desktop), 6,3–6,8 ms (×4), 9,6–10,5 ms (×6) |
| Heap JS | — | 11–14 Mo |
| Bundle initial gzip | < 3 Mo | **172 Ko** (JS 167,4 Ko + CSS 3,3 Ko + HTML 1,1 Ko) |

## Détail par piste et profil

| Profil | Piste | FPS moyen | FPS p95 (frames lentes) | Draw calls | Triangles | Chunk max (ms) | Heap JS (Mo) | DPR final |
|---|---|---|---|---|---|---|---|---|
| desktop 1280×720 | combe-douce | 59.6 | 59.5 | 58 | 75 k | 5.6 | 11 | 1.00 |
| desktop 1280×720 | crete-du-loup | 60.1 | 59.9 | 57 | 69 k | 4.9 | 14 | 1.00 |
| desktop 1280×720 | couloir-noir | 60.1 | 59.9 | 56 | 76 k | 4.8 | 11 | 1.00 |
| mobile Pixel 7, CPU ×4 | combe-douce | 60.0 | 59.9 | 58 | 75 k | 6.3 | 11 | 2.00 |
| mobile Pixel 7, CPU ×4 | crete-du-loup | 60.1 | 59.5 | 57 | 69 k | 6.6 | 11 | 2.00 |
| mobile Pixel 7, CPU ×4 | couloir-noir | 60.1 | 59.5 | 57 | 76 k | 6.8 | 12 | 2.00 |
| low-end stress, CPU ×6 | combe-douce | 60.0 | 59.9 | 58 | 75 k | 9.6 | 11 | 2.00 |
| low-end stress, CPU ×6 | crete-du-loup | 59.9 | 59.9 | 57 | 69 k | 10.5 | 12 | 2.00 |
| low-end stress, CPU ×6 | couloir-noir | 60.1 | 59.9 | 57 | 76 k | 10.1 | 11 | 2.00 |

## Pire cas GPU : rendu logiciel (SwiftShader)

L'émulation CPU ne bride pas le GPU, alors que sur un vrai téléphone le goulot est souvent le **fill-rate GPU**. Pour l'éprouver, la même descente tourne en **rendu logiciel** (SwiftShader, bien plus lent que n'importe quel GPU mobile), viewport Pixel 7 en paysage :

| Temps | FPS | DPR (résolution adaptative) |
|---|---|---|
| 3 s | 36 | 1,05 |
| 6 s | 50 | 1,05 |
| 9 s | 58 | 0,82 |
| 15 s | 60 | 0,82 |

Avant optimisation (paliers lents, pas de « Medium » par défaut sur mobile) : 14,5 FPS au départ, puis 22,5 FPS après 24 s.

## Ce qui tient le budget

- **Terrain :** grille cisaillée le long de la piste (aucun triangle hors couloir), 2 LOD (52 × 69 → 26 × 43 sommets) avec skirts. Au plus 1 chunk construit par frame, cache LRU de 40 chunks : un restart ne reconstruit rien (19–31 ms mesurés).
- **Décor :** sapins, rochers, piquets, drapeaux et poteaux en `InstancedMesh`, 1 draw call par type et par chunk. Sapins simplifiés (14 triangles) au-delà de 170 m.
- **Matériaux :** `MeshLambertMaterial` avec couleurs par sommet, **aucune texture** sauf 2 bannières générées. Brouillard = distance de streaming, ce qui masque l'apparition des chunks.
- **Effets :** pool de 900 particules sans allocation, flocons 100 % GPU (shader, 0 CPU), rubans de traces décalés par `copyWithin`.
- **Ombres :** aucune shadow map (lumière hémisphérique + soleil). La lisibilité des sauts passe par le recul de la caméra et la poussière à l'atterrissage.
- **Pixel ratio :** plafond selon la qualité (Low 1 / Medium 1,5 / High 2). « Medium » par défaut sur appareil tactile. **Résolution adaptative** : −10 % (−15 % si la frame dépasse 33 ms) après ~1 s de frames lentes, jusqu'à 50 % ; remontée lente quand c'est fluide.
- **Boucle :** physique à pas fixe de 60 Hz, au plus 5 sous-pas par frame (pas de spirale de la mort), rendu interpolé.

## Limites connues

- Pas de mesure sur un vrai téléphone (pas d'appareil disponible dans cet environnement). L'émulation couvre le CPU (×4 / ×6) et le scénario SwiftShader couvre un GPU très faible.
- Mesures prises sur une seule machine (M1). En CI (Linux sans GPU), les tests e2e passent en SwiftShader. Ils vérifient le fonctionnement, pas les FPS.
