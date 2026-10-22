# Roadmap — jalons chiffrés

> Avancement : phases 0 à 6 terminées (voir TODO.md et les commits).

| Phase | Livrable | Porte (critère chiffré) | Budget |
|---|---|---|---|
| **0 — Conception** | GDD, FEEL, RESEARCH, ARCHITECTURE, RISKS, ROADMAP, DECISIONS | GDD < 3 pages (≈ 1 000 mots) ; 3 piliers | ~1 h |
| **1 — Boîte grise** | capsule + pente simple + caméra + physique custom 60 Hz | descendre, tourner, freiner, sauter ; 0 NaN ; 0 frame aérienne parasite sur 10 s de pente ; tests physiques verts | ~1,5 h |
| **2 — Feeling** | FOV, vent, neige, gerbes, traces, shake, near-miss, slow-mo, caméra vivante, panneau debug `~` | (a) ≥ 60 FPS desktop, ≥ 30 FPS mobile émulé (CPU ×4) ; (b) cibles `FEEL.md` vertes + captures non « molles » ; (c) un bot sans aide finit la piste | ~2,5 h |
| **3 — Monde** | terrain seedé (virages, bosses, tremplins, falaises), sapins et rochers instanciés, arches, ciel, brouillard, heure du jour | 3 pistes distinctes (3 seeds fixes) ; ligne de jeu lisible sur captures ; bot qui finit les 3 | ~2 h |
| **4 — Boucle & progression** | 9 missions, score, étoiles, déblocages (pistes + cosmétiques), écran de fin, restart | restart < 1 s mesuré ; courbe des 9 étoiles sans pic (simulée) ; sauvegarde testée | ~1,5 h |
| **5 — UI/UX & contrôles** | menus, sélection de piste, HUD, pause, réglages, tactile, manette, gyroscope, chargement, mode confort | run complète au clavier **et** au toucher (Playwright) ; captures mobile et desktop lisibles | ~1,5 h |
| **6 — Perf & qualité** | profiling, budgets, suite Vitest et Playwright, `PERF.md` | tout vert ; bundle initial < 3 Mo gzip ; FPS consignés | ~1 h |
| **7 — GitHub & Vercel** | repo public, CI, README, LICENSE, déploiement, vérification en prod | URL de prod chargée et run automatisée en prod sans erreur console | ~0,5 h (dépend de l'auth) |

## Hors scope v1 (idées v2)

- Mode infini (seed aléatoire ou quotidienne) et classement en ligne.
- Remontées mécaniques et montagne ouverte (à la Grand Mountain).
- Grabs, rails et modules de snowpark.
- Autres skieurs (IA) comme obstacles mobiles.
- Snowboard, météo dynamique (tempête, jour blanc), musique composée.
