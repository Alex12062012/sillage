# Todo list (tenue à jour)

Légende : [x] fait · [~] en cours · [ ] à faire

## Phase 0 — Conception
- [x] Squelette du projet (npm, Vite, TS, Three)
- [x] GDD.md (< 3 pages, 3 piliers)
- [x] FEEL.md (paramètres, plages, tests)
- [x] ARCHITECTURE.md
- [x] RISKS.md
- [x] ROADMAP.md
- [x] DECISIONS.md
- [x] RESEARCH.md (4 recherches en parallèle, sourcées)
- [x] Commit de phase

## Phase 1 — Boîte grise
- [x] rng + noise
- [x] track (pente simple pour commencer)
- [x] physique du skieur (gravité projetée, frottement, carving, frein, saut, décollage)
- [x] boucle fixe 60 Hz + interpolation
- [x] capsule + caméra de poursuite + clavier
- [x] tests physiques (stabilité, carving, frein, saut)
- [x] captures Playwright
- [x] Commit de phase

## Phase 2 — Feeling
- [ ] FOV dynamique, shake (trauma), caméra qui respire
- [ ] audio vent + carres + impacts
- [ ] gerbes de neige, flocons, traces de skis
- [ ] near-miss (+ effet), slow-mo de récompense
- [ ] panneau debug `~`
- [ ] tests de feel + bot + mesure FPS
- [ ] journal de tuning
- [ ] Commit de phase

## Phase 3 — Monde
- [ ] terrain seedé complet + chunks + LOD
- [ ] sapins, rochers, piquets, arches (instancing)
- [ ] ciel, brouillard, heure du jour
- [ ] 3 pistes (3 seeds) + captures de lisibilité
- [ ] Commit de phase

## Phase 4 — Boucle & progression
- [ ] run state, score, missions, étoiles
- [ ] progression + sauvegarde + déblocages
- [ ] écran de fin + restart < 1 s
- [ ] Commit de phase

## Phase 5 — UI/UX & contrôles
- [ ] menus, sélection, HUD, pause, réglages, chargement
- [ ] tactile, manette, gyroscope, gaucher, mode confort
- [ ] Commit de phase

## Phase 6 — Perf & qualité
- [ ] profiling + budgets + bundle
- [ ] suite Vitest + Playwright + captures
- [ ] PERF.md
- [ ] Commit de phase

## Phase 7 — GitHub & Vercel
- [ ] auth gh / vercel
- [ ] repo + README + LICENSE + CONTRIBUTING
- [ ] CI GitHub Actions
- [ ] déploiement Vercel + vérification en prod
- [ ] Commit final
