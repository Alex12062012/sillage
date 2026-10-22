# FEEL — décomposer la satisfaction en éléments mesurables

Principe : chaque sensation correspond à **un paramètre réglable** (dans `src/tuning.ts`, exposé dans le panneau debug `~`), à **une cible chiffrée** et à **un test**. Les tests vérifient la physique en simulation headless (Vitest, `tests/unit/feel.test.ts`). Les captures Playwright (`scripts/capture.mjs`) vérifient le rendu.

Unités : m, s, m/s (×3,6 = km/h), rad. Gravité 9,81 m/s². Masse du skieur 75 kg.

## 1. Physique de glisse (cœur du pilier 1)

| Élément | Paramètre(s) | Plage initiale | Cible mesurable | Test |
|---|---|---|---|---|
| Accélération sur pente | `gravity`, `muGroomed` / `muIce` / `muPowder` (frottement), `powderDrag` (compaction), `cdaUpright` / `cdaTuck` (traînée), `airDensity` | μ 0,02–0,04 / 0,01–0,02 / 0,04–0,06 (sources : 0,005–0,035 damé) ; CdA 0,55–0,65 m² debout, 0,22–0,26 m² en tuck (soufflerie) | 0 → 50 km/h en **3–5 s** en tuck sur 18° ; vitesse terminale tuck sur 18° : **> 110 km/h**, debout **≈ 75–90 km/h** | sim en ligne droite |
| Pente « lisible » | `slopeDeg` par piste | 11–14° / 16–21° / 22–28° | vitesse moyenne d'un bot qui carve : 40–55 / 55–70 / 65–85 km/h (référence réelle : 43 km/h de moyenne en loisir sur piste bleue) | sim avec bot de suivi de piste |
| Inertie du carving | `yawRateMax` (autorité des skis, lent → rapide), `yawResponse` (constante de temps) | 2,8 → 1,6 rad/s ; τ 0,10–0,20 s | virage de 90° à 50 km/h en **0,9–1,5 s** | sim : cap → 90° |
| Mordant des carres | `gripGroomed` / `gripPowder` / `gripIce` = **accélération latérale max** ; la vitesse tourne au plus à `grip / v` rad/s, l'excès devient du dérapage | 18–24 / 11–15 / 6–10 m/s² (≈ 2 g sur damé) | carve propre de 90° : perte de vitesse **< 15 %** ; braquage sec à 70 km/h : perte **> 30 %** | sim : virage doux vs braquage sec |
| Relance au rythme (à la GMA) | `pumpBoost`, `pumpMinTurn`, `pumpMaxSpeed` | +0,4–0,9 m/s par changement de carre propre ; virage ≥ 0,35 s ; seulement sous 70 km/h | carver en rythme sur 15° ≥ tenir une ligne debout ; ne bat jamais le tuck en ligne droite | sim : bot qui slalome vs bot droit |
| Freinage (dérapage) | `brakeDecel`, `skidFriction` | 5–9 m/s² | 70 → 0 km/h en **2,5–4 s** | sim freinage |
| Poussée de bâtons | `poleAccel` sous `poleMaxSpeed` | 2–3 m/s² sous 4 m/s | quitter un replat en < 2 s | sim départ arrêté |
| Saut (pop) | `jumpImpulse` | 3,5–5 m/s | temps de vol sur plat : **0,6–0,9 s** | sim saut |
| Décollage des bosses | `launchThreshold` (vitesse normale relative à partir de laquelle on quitte le sol) | 0,6–1,5 m/s | tremplin moyen à 50 km/h : vol de **1–2 s** ; petites bosses à 40 km/h : collé au sol (pas de micro-sauts parasites) | sim tremplin + sim bosses |
| Stabilité au sol | — | — | sur pente plane : **0 frame aérienne** sur 10 s ; vitesse normale résiduelle < 0,01 m/s ; aucun NaN | sim 10 s, assertions |

## 2. Vitesse ressentie (pilier 2)

| Élément | Paramètre(s) | Plage initiale | Cible | Test |
|---|---|---|---|---|
| FOV dynamique | `fovBase`, `fovMaxBoost`, `fovSpeedRef`, `fovSmoothing` | 70–74° ; +16–22° ; atteint à 100 km/h ; τ 0,25–0,4 s | 20 km/h ≈ 73°, 60 ≈ 82°, 100+ ≈ 92° ; lissé, sans à-coups | fonction pure testée + captures à 3 vitesses |
| Tuck | `fovTuckBoost` | +3–5° | la mise en tuck se *voit* | capture avant/après |
| Screen shake (trauma) | `shakeMaxOffset`, `shakeMaxRoll`, `traumaDecay`, `shakeFreq` | 0,08–0,15 m ; 1–2° ; 1,2–2 /s ; 15–25 Hz | shake = trauma² ; un atterrissage lourd (Vn 10 m/s) donne trauma ≈ 0,8, un léger (< 3 m/s) quasi nul | test unitaire de la courbe |
| Vibration de vitesse | `speedRumble` | 0,005–0,02 m au-delà de 70 km/h | perceptible, jamais gênante ; off en mode confort | capture vidéo |
| Vent (audio) | `windGain(v)`, `windFreq(v)`, `windQ(v)` | bruit → 3 passe-bandes ; gain ∝ (v / 32)² ; centre 300 → 1 600 Hz ; Q 0,7 → 4 (sifflement) ; rafales lissées 0,1–0,5 Hz | silence à l'arrêt, plein à ~115 km/h | test unitaire du mapping |
| Particules de neige | `sprayRate`, `sprayLife`, `poolSize` | 0–400 /s ∝ charge des carres × vitesse ; 0,5–1,2 s ; 800 | gerbe visible en carve, nuage en poudreuse (taille ×1,8) ; pool sans allocation | capture + compteur debug |
| Flocons ambiants | `flakeCount` | 400–900 | les flocons défilent plus vite que la neige au sol (sensation de vitesse) | capture |
| Trace (le « sillage ») | `trailLength`, `trailWidth` | 100–150 m ; 0,10–0,14 m | deux lignes nettes en carve, coupées en l'air | capture vue arrière |
| Near-miss | `nearMissDist` / `razorDist`, `nearMissMinSpeed`, `comboWindow` | 1,2–1,8 m / 0,5–0,8 m ; 35–45 km/h (vitesse minimale, cf. Traffic Rider à 100 km/h) ; 2,5–3,5 s | frôler un sapin à 60 km/h à 1 m déclenche *whoosh* stéréo, flash de FOV (+6°) et popup ; 0 near-miss si contact réel ; rien sous la vitesse minimale | test unitaire sur trajectoires scriptées |

## 3. Récompense (pilier 3)

| Élément | Paramètre(s) | Plage initiale | Cible | Test |
|---|---|---|---|---|
| Atterrissage | `landCleanAngle`, `landCrashAngle`, `landHardVn`, `landCrashVn` (Vn = vitesse normale à l'impact, EFH = Vn² / 2g) | 30–40° ; 65–80° (switch toléré à ±35° de 180°) ; 6–8 m/s (EFH ≈ 2–3 m : dur, perte de vitesse) ; 13–16 m/s (chute) | plus de 90 % des réceptions « normales » sont propres ; une vrille mal finie fait chuter ; thump et shake ∝ Vn | test unitaire des seuils |
| Slow-motion de récompense | `slowmoScale`, `slowmoHold`, `slowmoEase` | 0,35–0,5 ; 0,2–0,3 s ; 0,3 s (timers en temps réel) | déclenché uniquement sur un 360 réussi ou ≥ 2 s de vol ; jamais pendant un virage critique | test unitaire de la courbe timeScale |
| Micro-hitstop au near-miss serré | `razorTimeScale`, `razorHold` | 0,25–0,6 ; 0,04–0,08 s (sources : 40–80 ms pour un coup léger) | sensation de « tchac » sans perte de contrôle | capture |
| Chute | `crashDuration` | 1,2–1,6 s | se relever et repartir en < 2 s (le run continue) | test unitaire |
| Restart | — | — | touche R → contrôle rendu en **< 1 s** (mesuré) | Playwright `performance.now()` |

## 4. Caméra qui « respire »

| Élément | Paramètre | Plage | Cible |
|---|---|---|---|
| Ressort de suivi | `camStiffness`, `camDamping` | 8–14 ; ratio critique 0,9–1 | pas d'oscillation, léger retard au démarrage |
| Hauteur / distance | `camHeight`, `camDistance`, `camLookAhead` | 1,8–2,4 m ; 4–5 m ; 5–8 m | sol proche = vitesse ; on voit 2 s de piste devant |
| Roulis en virage | `camRollFactor` | ≤ 4° | 0 en mode confort |
| Respiration | `camBreath` | 0,02–0,04 m à 0,25 Hz | uniquement sous 15 km/h |
| Recul en l'air | `camAirPullback` | +1–1,5 m | on voit la figure et la réception |

## Méthode d'itération (Phase 2)

1. On règle en live avec le panneau debug, puis on copie le JSON des valeurs dans `tuning.ts`.
2. À chaque itération, les tests de feel restent verts, une série de captures est faite (départ, carve, freinage, saut, near-miss) et les FPS sont mesurés.
3. Chaque réglage est consigné dans le journal ci-dessous (valeur, raison, effet observé).

## Journal de tuning

*(rempli pendant la Phase 2)*
