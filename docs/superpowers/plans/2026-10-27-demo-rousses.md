# Démo commerciale Les Rousses — plan de réalisation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une démo Les Rousses à montrer aux stations : les restos du domaine reconnaissables et utilisables (plan, fiche, « y aller »), trois réglages de station (bâtiments, monde, pentes) dans un écran `?setup`, et une URL d'intégration `?station=rousses&embed=1`.

**Architecture:** Une configuration de station (`StationConfig`, un JSON par station) entre dans `makeMountain` (pentes) et dans `Game` (bâtiments, monde, appliqués en direct). Les restos sont une liste faite à la main (`RestoDef`, lat/lon + paramètres de forme relevés sur LiDAR / swisstopo / photos), placés dans le repère local par `makeMountain`, solides, dessinés par un nouveau `RestoView` et listés sur les cartes.

**Tech Stack:** TypeScript 6, Three.js 0.186, Vite 8, Vitest 5, Playwright 1.64. Node ≥ 22.12.

**Spec:** `docs/superpowers/specs/2026-10-27-demo-rousses-design.md`

## Global Constraints

- Aucun contenu Google (photos, 3D, textures) copié ou extrait, à la main ou par programme ; les photos Google ne servent que de référence regardée à la main. Textures faites, procédurales ou sous licence libre.
- Sources : OSM (ODbL), IGN LiDAR HD / BD TOPO (Licence Ouverte / Etalab 2.0), swisstopo swissBUILDINGS3D ; ajouter « IGN » et « swisstopo » à l'attribution affichée (`hud.showHint` dans `src/main.ts`, README).
- 30 FPS sur mobile milieu de gamme : restos fusionnés dans le moins de draw calls possible (comme `MountainView`), enseignes dans un seul atlas.
- Pentes « real » = le relief actuel (`steep: 2.3`) ; c'est le défaut, y compris en intégration.
- Les réglages sont ceux de la station : le visiteur ne voit jamais l'écran de réglages de station.
- Textes du jeu en anglais (comme le reste de l'interface).
- Ne pas lancer `npm run build` pendant que `npm run dev` tourne.
- Commits directs sur `main`, un par tâche.

## Review Focus

- **Resto posé sur une pente** : il ne doit ni flotter ni être enterré ; un socle descend jusqu'au terrain le plus bas de l'emprise. → test dans la tâche 4.
- **Resto au milieu d'une piste ou d'une gare** : les restos sont des obstacles, mais une piste ne doit pas devenir infranchissable ; aucun resto à moins de `halfWidth` de l'axe d'une piste nommée. → test dans la tâche 3.
- **Paramètres d'URL faux** (`?slopes=steep`, `?crowd=`, JSON incomplet) : on retombe sur la config de la station, sans plantage. → test dans la tâche 1.
- **Intégration en iframe** : le clavier doit marcher après un clic dans l'iframe, le son ne démarre qu'après une interaction, aucun retour possible au menu arcade. → test e2e dans la tâche 9.
- **« Y aller » vers un resto** : on arrive devant la porte côté enseigne, sur la neige, sans être dans un mur ni tomber. → test dans la tâche 5.

---

### Task 1: Configuration de station

**Files:**
- Create: `src/sim/stationConfig.ts`
- Create: `src/stations/rousses.config.json`
- Modify: `src/sim/stations.ts` (champ `config` sur `Station`)
- Test: `tests/unit/station-config.test.ts`

**Interfaces:**
- Produces:
  - `type BuildingsMode = 'real' | 'generic'`, `type CrowdLevel = 'busy' | 'some' | 'none'`, `type SlopesMode = 'real' | 'fun' | 'memory'`
  - `interface StationConfig { buildings: BuildingsMode; crowd: CrowdLevel; slopes: SlopesMode }`
  - `const DEFAULT_CONFIG: StationConfig = { buildings: 'real', crowd: 'busy', slopes: 'real' }`
  - `parseConfig(raw: unknown, base: StationConfig): StationConfig` — garde chaque champ valide de `raw`, sinon celui de `base`
  - `configFromUrl(params: URLSearchParams, base: StationConfig): StationConfig` — lit `buildings`, `crowd`, `slopes`
  - `Station.config: StationConfig` (Les Rousses : le JSON ; Avoriaz : `DEFAULT_CONFIG`)

- [ ] **Step 1: Write the failing test** `tests/unit/station-config.test.ts`
  - `parseConfig({ slopes: 'memory' }, DEFAULT_CONFIG)` → `{ buildings: 'real', crowd: 'busy', slopes: 'memory' }`
  - `parseConfig({ slopes: 'steep', crowd: 3 }, DEFAULT_CONFIG)` → `DEFAULT_CONFIG`
  - `parseConfig(null, DEFAULT_CONFIG)` et `parseConfig('x', DEFAULT_CONFIG)` → `DEFAULT_CONFIG`
  - `configFromUrl(new URLSearchParams('crowd=none&slopes=oops'), DEFAULT_CONFIG)` → `{ ...DEFAULT_CONFIG, crowd: 'none' }`
  - `STATIONS[0].config` égale `DEFAULT_CONFIG`
- [ ] **Step 2:** `npx vitest run tests/unit/station-config.test.ts` → FAIL (module introuvable)
- [ ] **Step 3:** Implémenter `src/sim/stationConfig.ts`, écrire `src/stations/rousses.config.json` = `{ "buildings": "real", "crowd": "busy", "slopes": "real" }`, l'importer dans `stations.ts` via `parseConfig(json, DEFAULT_CONFIG)`.
- [ ] **Step 4:** `npx vitest run tests/unit/station-config.test.ts` → PASS ; `npm run typecheck` → 0 erreur
- [ ] **Step 5: Commit** `feat(station): station config (buildings, crowd, slopes)`

### Task 2: Zone détaillée agrandie jusqu'à La Cure (re-cuisson)

**Files:**
- Modify: `scripts/bake-station.mjs:84-95` (bornes `rousses`)
- Modify: `.gitignore` (ajouter `scripts/raw/`)
- Regenerate: `src/sim/rousses-data.ts`
- Test: `tests/unit/mountain.test.ts`

**Interfaces:**
- Produces: `ROUSSES.grid` couvrant au moins jusqu'à 46.468 N (z ≤ −3 100 m dans le repère local, origine 46.44 / 6.075, `z = (46.44 − lat) × 111195`).

- [ ] **Step 1: Write the failing test** dans `tests/unit/mountain.test.ts` : `it('reaches La Cure: the detailed grid covers 46.468 N')` → `expect(m.bounds.z0).toBeLessThan((46.44 - 46.468) * 111195)`.
- [ ] **Step 2:** `npx vitest run tests/unit/mountain.test.ts` → FAIL sur ce test seulement.
- [ ] **Step 3:** Passer `box` à `[46.4185, 6.0385, 46.468, 6.1135]` ; vérifier que la ligne `fine` (tuiles z14 `y 5798–5803`) couvre 46.468 N, sinon ajouter la rangée de tuiles manquante ; `land.json` est déjà requis jusqu'à 46.468. Ne pas toucher au filtre `keep` des pistes (Trélasse/Givrine restent exclues). Retélécharger les sources listées en tête de script dans `scripts/raw/rousses/` (gitignoré), puis `node scripts/bake-station.mjs rousses scripts/raw/rousses`.
- [ ] **Step 4:** `npm test` → tout PASS (les tests de relief, pistes, forêts, vitesse restent verts) ; vérifier dans le jeu (`npm run dev`, free ride Les Rousses, T) que La Dôle et le départ des Jouvenceaux n'ont pas bougé et que le premier chargement reste < 3 s sur desktop.
- [ ] **Step 5: Commit** `feat(rousses): detailed terrain up to La Cure`

### Task 3: Les restos du domaine — données et placement

**Files:**
- Create: `src/sim/restos.ts`
- Create: `src/sim/restos-rousses.ts`
- Modify: `src/sim/stations.ts` (`Station.restos: RestoDef[]`, `[]` pour Avoriaz)
- Modify: `src/sim/mountain.ts` (placement, obstacles, retrait des blocs OSM recouverts)
- Modify: `src/sim/track.ts:20` (`kind` += `'building'`)
- Test: `tests/unit/restos.test.ts`

**Interfaces:**
- Consumes: `Station.config` (tâche 1), grille élargie (tâche 2)
- Produces:
  - `interface RestoDef { id: string; name: string; kind: 'restaurant' | 'cafe' | 'bar' | 'snack' | 'hut'; lat: number; lon: number; website?: string; w: number; d: number; yaw: number; eave: number; ridge: number; roof: 'gable' | 'hip' | 'flat'; wall: 'wood' | 'render' | 'stone'; wallColor: number; roofColor: number; trim: number; terrace: boolean; signYaw: number; source: 'lidar' | 'swisstopo' | 'photo' }` (mètres, `yaw` et `signYaw` en radians dans le repère du jeu, `eave`/`ridge` = hauteur de l'égout et du faîtage au-dessus du sol)
  - `interface Resto extends RestoDef { x: number; z: number; y: number /* sol le plus bas de l'emprise */ }`
  - `toLocal(origin: number[], lat: number, lon: number): [number, number]` — même projection que `toXZ` de `bake-station.mjs:178-181`
  - `Mountain.restos: Resto[]`
  - `Mountain.restoSpot(i: number): Spot` — 10 m devant l'enseigne (direction `signYaw`), face au resto

- [ ] **Step 1: Relever les restos** dans `src/sim/restos-rousses.ts` (`export const ROUSSES_RESTOS: RestoDef[]`). Liste et ordre de priorité : Le Poyet, Telemark'Afé, Bistrot du Chalet des Tuffes, Snack Côté Dôle (Pile Dessus), Chalet des Trolles, L'Eldorado, La Taverne, Illico resto, Jura-Track, L'Arbezie Franco-Suisse, Chez Mamac, Cuvaloup de Crans ; puis Bar de la Dôle et Le Lapin Blanc seulement s'ils sont localisés de façon fiable (sinon les omettre et le noter dans le commit). Position : OSM (`amenity`/`tourism`, sortie `center`), recoupée à la main avec la fiche Google. Emprise et hauteurs : LiDAR HD IGN (côté français) ou swissBUILDINGS3D (côté suisse) ; à défaut, estimées sur photos (`source: 'photo'`). Aspect (toit, bardage, couleurs, terrasse, côté de l'enseigne) : regardé à la main sur les photos, jamais copié. `website` depuis OSM quand il existe.
- [ ] **Step 2: Write the failing test** `tests/unit/restos.test.ts` avec `makeMountain(STATIONS[0], ROUSSES)` :
  - `m.restos.length` ≥ 12, noms uniques, contient `'Le Poyet'` et `"Telemark'Afé"`
  - chaque resto est dans `m.bounds`
  - chaque resto a un obstacle `kind === 'building'` à moins de 1 m de `(x, z)` qui couvre son emprise
  - aucun bloc de `m.scenery.buildings` dont le centre tombe dans l'emprise d'un resto
  - aucun resto à moins de `p.halfWidth` de l'axe d'une piste nommée (`m.pisteAt(x, z)?.d ?? Infinity` ≥ `halfWidth`) ni à moins de 15 m du centre d'une gare
  - `m.restoSpot(i)` : `m.clearSpot` le laisse en place (pas d'obstacle à < 2 m)
- [ ] **Step 3:** `npx vitest run tests/unit/restos.test.ts` → FAIL
- [ ] **Step 4:** Implémenter `restos.ts` et le placement dans `makeMountain` : `y` = minimum de `height` aux quatre coins de l'emprise ; obstacles `building` en cercles le long du grand axe (comme les gares) ; filtrer `scenery.buildings` ; ajouter `restoSpot`.
- [ ] **Step 5:** `npm test` → PASS
- [ ] **Step 6: Commit** `feat(rousses): the ski area's restaurants, placed and solid`

### Task 4: Dessin des restos et de leurs enseignes, réglage « Bâtiments »

**Files:**
- Create: `src/render/restos.ts`
- Modify: `src/render/mountainView.ts` (ajout du `RestoView`, blocs génériques à la place en mode `generic`)
- Modify: `src/game.ts` (`setConfig`)
- Test: `tests/unit/restos-view.test.ts`

**Interfaces:**
- Consumes: `Mountain.restos`, `StationConfig`
- Produces:
  - `restoGeometry(r: Resto, real: boolean): BufferGeometry` — `real` : toit `roof` à `eave`/`ridge`, murs `wall`/`wallColor`, encadrements `trim`, terrasse en bois si `terrace`, socle jusqu'à `y` ; `generic` : le bloc `building()` existant à l'emprise du resto
  - `class RestoView { readonly group: Group; constructor(m: Mountain, real: boolean); setReal(real: boolean): void; dispose(): void }` — une géométrie fusionnée + un `InstancedMesh`/atlas pour les enseignes (nom en blanc sur fond bois, lisible à ~40 m, face `signYaw`)
  - `Game.setConfig(cfg: StationConfig): void` — applique `buildings` et `crowd` en direct (crowd : tâche 6)

- [ ] **Step 1: Write the failing test** `tests/unit/restos-view.test.ts` :
  - `restoGeometry(r, true)` : boîte englobante — hauteur ≈ `r.ridge` + (`r.y` → sol) ± 0,5 m, base ≤ `r.y` (pas de vide sous le socle sur pente)
  - `restoGeometry(r, false)` : hauteur = celle du bloc générique pour `levels = round(eave / 2.9)`
  - `new RestoView(m, true).group` contient au plus 3 objets dessinables (draw calls)
- [ ] **Step 2:** `npx vitest run tests/unit/restos-view.test.ts` → FAIL
- [ ] **Step 3:** Implémenter `src/render/restos.ts` (réutiliser `paint`, `noUv`, `mergeGeometries` de `mountainView.ts`, les exporter si besoin) ; brancher dans `MountainView` ; `Game.setConfig` → `view.restos.setReal(cfg.buildings === 'real')`.
- [ ] **Step 4:** `npm test` → PASS ; dans le jeu, aller voir Le Poyet (haut du Balancier) et Telemark'Afé : enseigne lisible en arrivant, bâtiment posé sur la neige, FPS du panneau `~` inchangés à ±3.
- [ ] **Step 5: Commit** `feat(rousses): restaurants drawn with their signs, real or generic`

### Task 5: Restos sur le plan, la mini-map, et « Go there »

**Files:**
- Modify: `src/ui/trailMap.ts` (icône, nom, fiche, bouton)
- Modify: `src/ui/miniMap.ts` (icône)
- Modify: `src/game.ts` (`toResto`)
- Modify: `src/main.ts` (callback, API de test `resto(i)`)
- Test: `tests/unit/restos.test.ts`

**Interfaces:**
- Consumes: `Mountain.restos`, `Mountain.restoSpot(i)`
- Produces:
  - `Game.toResto(i: number): void` — `unload(m.restoSpot(i))`, phase `running`
  - `TrailMap` : constructeur `new TrailMap(parent, markers, onLift, onClose, onResto: (i: number) => void)` ; `Pick` gagne `{ resto: number }` ; fiche resto = nom, type, lien `website` (nouvel onglet, `rel="noopener"`) s'il existe, bouton `Go there`
  - Noms des restos dans `labels()` avec priorité au-dessus des pistes, en-dessous des remontées
  - `window.__sillage.resto(i)` pour les tests

- [ ] **Step 1: Write the failing test** (dans `restos.test.ts`) : pour chaque `i`, après `unload(restoSpot(i))` simulé avec `createSkier` + 120 pas `stepSkier` sans entrée, le skieur n'a pas chuté (`crashTimer === 0`) et reste à moins de 25 m du resto.
- [ ] **Step 2:** `npx vitest run tests/unit/restos.test.ts` → FAIL si `restoSpot` mène dans un mur ou une pente qui l'emporte ; ajuster `restoSpot` jusqu'au vert.
- [ ] **Step 3:** Implémenter cartes + `toResto`.
- [ ] **Step 4:** Navigateur (souris réelle) : M, zoom sur les Tuffes, survol et clic sur Le Poyet → fiche, `Go there` → on est devant l'enseigne ; la mini-map montre l'icône. `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(rousses): restaurants on the maps, go there from their card`

### Task 6: Réglage « Monde sur les pistes »

**Files:**
- Modify: `src/render/crowd.ts`
- Modify: `src/game.ts` (`setConfig` → crowd)
- Test: `tests/unit/crowd.test.ts`

**Interfaces:**
- Produces: `Crowd.setDensity(level: CrowdLevel): void` — fraction active des skieurs : `busy` 1, `some` 0.4, `none` 0 ; les inactifs sont invisibles et leur obstacle est mis hors de portée (`x = z = 1e9`, comme les joueurs sur un télésiège dans `others.ts`). Les vrais joueurs en ligne (`OtherSkiers`) ne sont jamais touchés.

- [ ] **Step 1: Write the failing test** `tests/unit/crowd.test.ts` : avec une `Crowd` sur `makeMountain(STATIONS[0], ROUSSES)`, compter les obstacles `skier` de `m.dynamic` à `x < 1e8` après `update` : `busy` = total, `some` ≈ 40 % (±1), `none` = 0 ; repasser à `busy` les rend tous.
- [ ] **Step 2:** `npx vitest run tests/unit/crowd.test.ts` → FAIL
- [ ] **Step 3:** Implémenter `setDensity` (garder les premiers `round(n × f)` riders, ordre déterministe).
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5: Commit** `feat(crowd): station crowd density (busy, some, none)`

### Task 7: Réglage « Pentes » (réelles / fun / souvenir)

**Files:**
- Modify: `src/sim/mountain.ts` (`makeMountain(st, R, cfg = st.config)`)
- Modify: `src/game.ts:60-145` (`load` passe la config)
- Test: `tests/unit/slopes.test.ts`

**Interfaces:**
- Consumes: `StationConfig.slopes`
- Produces: `SLOPES: Record<SlopesMode, { steep: number; accent: Record<PisteColor, number> }>` exporté de `mountain.ts` :
  - `real` : `{ steep: 1, accent: { green: 1, blue: 1, red: 1, black: 1 } }`
  - `fun` : `{ steep: 1.25, accent: { green: 1, blue: 1, red: 1, black: 1 } }`
  - `memory` : `{ steep: 1, accent: { green: 1, blue: 1, red: 1.15, black: 1.4 } }`
  - `steep` multiplie `station.steep` ; `accent` augmente la dénivelée locale le long des pistes de cette couleur (méthode libre : par ex. amplifier le détail local `fine − around` dans une bande autour des pistes, avec un fondu doux) ; `Mountain.config` garde la config utilisée.

- [ ] **Step 1: Write the failing test** `tests/unit/slopes.test.ts` — trois montagnes (`real`, `fun`, `memory`) :
  - pente moyenne le long des pistes noires (dénivelée du banc / longueur) : `memory` ≥ 1.3 × `real` ; rouges ≥ 1.1 × ; vertes et bleues entre 0.95 × et 1.05 ×
  - `fun` : pente moyenne de toutes les pistes ≥ 1.15 × `real`
  - `real` : `m.height(m.summit.x, m.summit.z)` égal à la valeur actuelle à 1 m près (aucun changement du jeu par défaut)
  - aucune marche : sur la grille 10 m, l'écart max entre deux cellules voisines en `memory` ≤ 1.2 × celui de `real`
  - les tests existants « graded pistes never climb more than a skate » et « is fast… » repassés sur `memory` et `fun`
- [ ] **Step 2:** `npx vitest run tests/unit/slopes.test.ts` → FAIL
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npm test` → PASS (dont `npm run feel`) ; dans le jeu en `?slopes=memory`, descendre une noire depuis La Dôle : plus raide, sans marche ni décollage parasite.
- [ ] **Step 5: Commit** `feat(rousses): slopes setting (real, fun, as remembered)`

### Task 8: Écran de réglages de station (`?setup`)

**Files:**
- Create: `src/ui/setup.ts`
- Modify: `src/main.ts`, `src/style.css`
- Test: `tests/e2e/setup.spec.ts`

**Interfaces:**
- Consumes: `StationConfig`, `configFromUrl`, `Game.setConfig`
- Produces: `class SetupPanel { constructor(parent: HTMLElement, cfg: StationConfig, onChange: (cfg: StationConfig) => void); show(): void; hide(): void }` — trois questions (libellés anglais : *Buildings — As they really are / Generic* ; *People on the slopes — Busy / A few / Nobody* ; *Slopes — Real / Steeper for fun / As remembered (blacks steeper)*), bouton *Export settings* qui télécharge `rousses.config.json`.
  - Bâtiments et monde : `game.setConfig` en direct ; pentes : recharge avec `?setup&slopes=<mode>` (et garde les autres paramètres).
  - Visible seulement si l'URL contient `setup` ; un bouton ⚙ discret l'ouvre / le ferme.

- [ ] **Step 1: Write the failing test** `tests/e2e/setup.spec.ts` : `/?station=rousses&setup` → le panneau est visible ; clic *Nobody* → `__sillage` ne compte plus de skieurs simulés actifs ; clic *As remembered* → l'URL contient `slopes=memory` après rechargement ; `/?station=rousses` sans `setup` → pas de panneau ni de bouton ⚙.
- [ ] **Step 2:** `npx playwright test tests/e2e/setup.spec.ts` → FAIL
- [ ] **Step 3:** Implémenter (styles cohérents avec `.menu.wide` / `.card`).
- [ ] **Step 4:** `npx playwright test tests/e2e/setup.spec.ts` → PASS
- [ ] **Step 5: Commit** `feat(setup): station settings screen for sales demos`

### Task 9: URL d'intégration `?station=rousses&embed=1`

**Files:**
- Modify: `src/main.ts` (démarrage, pause), `src/ui/menus.ts` (pause sans *Quit* en embed)
- Test: `tests/e2e/embed.spec.ts`

**Interfaces:**
- Consumes: `startRun`, `Station.config`, `configFromUrl`
- Produces: au démarrage, `params.get('station')` → `startRun(station.trackId)` sans passer par le menu ; `embed=1` → pas de menu arcade, la pause propose *Resume*, *Restart*, *Settings*, pas *Quit* ; la config = `configFromUrl(params, station.config)`.

- [ ] **Step 1: Write the failing test** `tests/e2e/embed.spec.ts` : page hôte locale avec `<iframe src="/?station=rousses&embed=1">` ; dans l'iframe : `state().track === 'free'`, `state().mode === 'run'`, `state().menu === null` ; clic dans l'iframe puis `ArrowUp` maintenu 1 s → `kmh > 5` ; Échap → pause sans bouton *Quit* ; aucune erreur console.
- [ ] **Step 2:** `npx playwright test tests/e2e/embed.spec.ts` → FAIL
- [ ] **Step 3:** Implémenter.
- [ ] **Step 4:** `npx playwright test` (toute la suite e2e) → PASS
- [ ] **Step 5: Commit** `feat(embed): open straight into Les Rousses for resort websites`

### Task 10: Vérification finale de la démo

**Files:**
- Modify: `README.md` (réglages, intégration, attributions IGN / swisstopo), `docs/TODO.md`

- [ ] **Step 1:** `npm run lint && npm run typecheck && npm test && npx playwright test` → tout vert.
- [ ] **Step 2:** Perf : `node scripts/perf.mjs` (ou panneau `~`) sur free ride Les Rousses, mobile émulé CPU ×4 : ≥ 30 FPS, draw calls ≤ valeur d'avant la tâche 4 + 3.
- [ ] **Step 3:** Parcours démo au navigateur (souris et clavier réels) : `?station=rousses&setup` → changer les trois réglages → M → Le Poyet → *Go there* → skier jusqu'à Telemark'Afé. Noter tout accroc.
- [ ] **Step 4: Commit** `docs: Les Rousses demo — settings, embedding, attributions`
- [ ] **Step 5:** Demander à Alexandre avant de pousser (`git push` déploie en production sur Vercel).
