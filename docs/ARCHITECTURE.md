# Architecture

## Principes

- La **logique pure** (physique, terrain, scoring, missions, progression) n'importe pas Three.js. Elle est testable en Node avec Vitest et déterministe : seed + entrées donnent la même sortie.
- Le **rendu** (Three.js) lit l'état de la simulation et ne le modifie jamais.
- La **physique tourne à pas fixe (60 Hz)**. Le rendu tourne à la fréquence de l'écran et interpole entre les deux derniers états physiques.
- On écrit le minimum de code utile, sans abstraction spéculative : une seule implémentation par concept.

## Modules

```
src/
  main.ts              boot : renderer, boucle, câblage UI ↔ jeu
  tuning.ts            tous les paramètres de feel + méta (min/max/step) pour le panneau debug
  core/
    rng.ts             PRNG mulberry32, hash entier, value-noise 2D + fbm (seedés)
  sim/                 ── PUR (aucun import three) ──
    track.ts           définition des 3 pistes ; height(x,z), normal, surface ; features (tremplins, bosses, falaises) ; obstacles par chunk
    skier.ts           état du skieur + stepSkier(state, input, track, dt)
    run.ts             état d'une descente : chrono, score, combo, near-miss, figures, chute, arrivée
    missions.ts        définitions des missions + évaluation
    progress.ts        sauvegarde (localStorage injecté), étoiles, déblocages
  render/              ── Three.js ──
    terrain.ts         maillage des chunks (grille cisaillée le long de la piste), streaming, LOD + skirts
    props.ts           sapins, rochers, piquets, arches : InstancedMesh par chunk
    sky.ts             dôme dégradé, brouillard, lumières, heure du jour
    skierModel.ts      skieur low-poly + pose procédurale (inclinaison, tuck, vrilles)
    camera.ts          rig de poursuite et 1re personne, FOV dynamique, shake (trauma)
    fx.ts              gerbes de neige (pool Points), flocons, traces de skis (rubans)
  audio/audio.ts       synthèse WebAudio (vent, carres, impacts, whoosh, carillons, nappe)
  input/input.ts       clavier, tactile, manette, gyroscope → InputState unique
  ui/
    ui.ts              menus, HUD, pause, fin de run, réglages (DOM léger)
    debug.ts           panneau debug « ~ » généré depuis tuning.ts
  style.css
```

## Flux de données (une frame)

```
          ┌───────────── input.ts ─────────────┐
          │ clavier / tactile / manette / gyro │
          └──────────────┬─────────────────────┘
                         │ InputState {steer, tuck, brake, jumpPressed, flip}
                         ▼
 accumulator += frameDt × timeScale          (frameDt borné à 0,1 s)
 while accumulator ≥ 1/60 (max 5 pas) :
     prev ← cur
     stepSkier(cur, input, track, 1/60)   → événements (décollage, atterrissage, chute…)
     stepRun(run, cur, track, events)     → score, near-miss, missions, arrivée
 alpha = accumulator / (1/60)
                         ▼
 render(alpha) : skier = lerp(prev, cur, alpha)
     terrain.update(z) · props · camera(rig, FOV, shake) · fx · skierModel · HUD
     audio.update(vitesse, charge des carres, surface)
```

- **Événements :** `stepSkier` renvoie une liste de faits typés (`takeoff`, `land{vn, quality}`, `crash`, `nearMiss{dist, side}`…). Le rendu, l'audio et l'UI y réagissent (shake, whoosh, popup) sans connaître la physique.
- **Slow-motion :** il modifie seulement `timeScale`, appliqué à l'accumulateur. Le pas physique reste fixe, donc le résultat reste déterministe.

## Modèle physique du skieur (résumé)

État : position, vitesse 3D, cap des skis `heading` et sa vitesse angulaire, `airborne`, rotations en l'air (vrille, salto), surface, `crashTimer`.

**Au sol, à chaque pas :**
1. Normale `n` du terrain analytique ; gravité projetée sur le plan tangent ; frottement de Coulomb `μ·g·n.y` opposé à la vitesse ; traînée `k·|v|·v` (k selon debout, tuck ou frein).
2. Le cap suit la consigne de braquage via une vitesse angulaire lissée. C'est l'inertie : `yawRateMax` diminue avec la vitesse.
3. **Carving :** la vitesse tourne vers l'axe des skis d'au plus `grip·dt` rad. L'écart restant est du **dérapage**, qui freine (`skidFriction·sin(écart)`) et fait gicler la neige. Un virage progressif carve proprement et conserve la vitesse ; un braquage brutal dérape. La compétence émerge de ce mécanisme, sans règle spéciale.
4. Intégration de la position, puis échantillonnage du terrain au nouveau point :
   - si la vitesse normale relative `v·n' > launchThreshold` → **décollage** (bosse, tremplin) ;
   - sinon on recolle au sol et on projette la vitesse sur le nouveau plan **en conservant la norme** (la réaction normale ne travaille pas).

**En l'air :** gravité + traînée. Les entrées pilotent la vrille et le salto.

**À l'atterrissage :** on calcule l'impact `Vn = -v·n` et l'écart cap/vitesse, d'où un atterrissage propre, limite ou une chute.

**Obstacles :** cercles (sapin, rocher) testés dans un rayon de 8 m autour du skieur via l'index par chunk. On mesure la distance minimale pendant le passage : un passage sous le seuil donne un near-miss, un contact une chute.

## Terrain

- Une piste = ligne centrale `cx(z)` (somme de sinus seedés), altitude de base `H(z)` (intégrale analytique de la pente variable, falaises incluses) et profil latéral en léger **bol** qui ramène vers le centre, bordé de talus.
- On y ajoute : bruit fbm hors-piste (atténué sur la piste), bosses, tremplins (rampe concave + lèvre + pente de réception), zones de glace et de poudreuse.
- **Chunks** de 64 m le long de z, ±150 m latéralement. La grille est cisaillée : chaque rangée est centrée sur `cx(z)`, colonnes serrées au centre (1,5 m) et lâches sur les bords (jusqu'à 6 m). Aucun triangle n'est gaspillé hors couloir.
- **LOD :** deux niveaux (plein / demi). Des **skirts** de 3 m sur les bords cachent les fissures entre niveaux. Au plus un chunk est (re)construit par frame, et un cache évite de régénérer au restart.
- Physique et rendu utilisent la même fonction de hauteur. Le maillage n'en est qu'un échantillonnage (1 à 1,5 m près du skieur), donc l'écart visuel reste de quelques cm.

## Rendu & perf (budget mobile)

| Poste | Budget |
|---|---|
| Draw calls | < 60 (terrain ~10, sapins / rochers / piquets instanciés par chunk ~30, skieur ~3, FX ~3, ciel 1) |
| Triangles | < 250 k visibles |
| Matériaux | `MeshLambertMaterial` + vertex colors, aucune texture ; ombre « blob » sous le skieur |
| Pixel ratio | min(devicePixelRatio, 1 / 1,5 / 2 selon la qualité) + baisse adaptative si la frame dépasse 22 ms |
| Allocation | zéro allocation par frame dans la boucle chaude (pools, vecteurs réutilisés) |

## Persistance

Clé `localStorage` `sillage.save.v1` : étoiles par mission, records, cosmétique équipé, réglages. Les erreurs de lecture ou d'écriture (navigation privée) sont absorbées : on retombe sur l'état par défaut.

## Tests

- **Vitest :** `rng`, `track` (déterminisme, continuité, normales), `skier` (stabilité, carving, frein, saut, atterrissage), `run` (near-miss, combo, figures, chute), `missions`, `progress`, plus les cibles de `FEEL.md`.
- **Playwright :** smoke (chargement, menu, démarrage d'une run, aucune erreur console, restart < 1 s), captures desktop et mobile, mesure FPS (CPU ×4 pour l'émulation mobile).
- **API debug** `window.__sillage` (lecture d'état et injection d'entrées) pour piloter les tests e2e.
