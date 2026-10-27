# Démo commerciale Les Rousses — conception

Date : 2026-10-27 · Statut : à valider par Alexandre

## Intention

Sillage doit devenir un produit vendu aux stations de ski : la station l'intègre à son site, et ses visiteurs skient la vraie station dans le navigateur. Le cas d'usage le plus fort n'est pas la découverte mais le **souvenir** : un ancien client revient sur le site (souvent hors saison, au moment de réserver — hypothèse), refait ses pistes, retrouve « son » resto d'altitude, et a envie de revenir. Viennent ensuite les familles qui comparent les stations (un enfant joueur qui les essaie toutes, un parent non joueur qui doit s'en sortir sans aide).

À terme le produit doit être **automatique** : la station dit oui, répond à quelques questions de réglage, et reçoit sa station. Pas de travail sur mesure à chaque vente.

Cette démo sert à **vendre cet hiver** : il faut quelque chose à montrer aux stations avant Noël 2026. Elle prend Les Rousses (déjà en jeu, à l'échelle 1:1) et y ajoute ce qui manque pour que quelqu'un qui y a skié se dise « j'y étais ».

## Ce qui existe déjà (ne pas refaire)

Free ride Les Rousses : relief réel, 36 km de pistes avec leurs noms et couleurs, remontées (gares solides, embarquement à Espace, barre de progression), forêts, routes, bâtiments en blocs génériques depuis les empreintes OSM (`scripts/bake-station.mjs rousses` → `src/sim/rousses-data.ts`), plan des pistes (M) et mini-map, multijoueur en ligne. Les pistes sont jugées fidèles : ce n'est pas le chantier.

## Objectifs

1. **Les restos du domaine, reconnaissables.** Les lieux où l'on mange sur le domaine Dôle-Tuffes apparaissent au bon endroit, avec leur vrai nom sur une enseigne lisible en jeu, une silhouette fidèle (forme du toit, taille, hauteur) et un aspect inspiré du vrai bâtiment (matériaux, couleurs, terrasse). Liste de départ (vérifiée le 2026-10-27, fiche Google avec photos pour chacun sauf mention) :
   - Côté français : Bistrot du Chalet des Tuffes (fermé temporairement), Le Poyet (haut du Balancier), Telemark'Afé (pied des Tuffes), Snack Côté Dôle / Hôtel-Club à la Pile Dessus, Chalet des Trolles, Jura-Track, L'Eldorado, La Taverne, Illico resto (pied des Jouvencelles), L'Arbezie Franco-Suisse (La Cure).
   - Côté suisse : Chez Mamac, Refuge & Restaurant de la Trélasse, La Givrine, Cuvaloup de Crans, Buvette de La Genolière.
   - Incertains : Bar de la Dôle (introuvable sur Google), Le Lapin Blanc (non vérifié). Le Chalet de la Pile-Dessus est une chambre d'hôtes, pas un resto.
   Coordonnées : OpenStreetMap (`amenity=restaurant|cafe|bar|fast_food`, `tourism=alpine_hut`), recoupées avec la fiche Google.
2. **Les restos sont des lieux du jeu**, pas du décor : visibles sur le plan des pistes et la mini-map (icône + nom), une fiche au clic (nom, type, lien vers leur site quand OSM le donne), et un moyen d'y aller depuis le plan comme pour les remontées.
3. **Le pitch « oui + quelques questions »**, montrable en rendez-vous : un écran de réglages de station où l'on change en direct
   - **Bâtiments** : comme en vrai / génériques ;
   - **Monde sur les pistes** : beaucoup / un peu / personne ;
   - **Pentes** : réelles / accentuées pour le fun / « comme dans le souvenir » (les noires accentuées plus que les autres, le relief général gardé).
   Les réglages forment la configuration de la station (un fichier par station), qui à terme serait le résultat du questionnaire.
4. **Intégrable** : une URL qui ouvre directement le free ride des Rousses, sans le menu arcade, prête à mettre dans une iframe sur un site de station.

## Non-objectifs

- Avoriaz ou toute autre station dans cette démo.
- Le pipeline automatique complet (questionnaire en ligne, génération sans intervention) : la démo le **montre**, elle ne l'industrialise pas. Pour la démo, modéliser les restos à la main en s'inspirant des photos est accepté.
- Les bâtiments des villages autres que les restos du domaine (ils restent en blocs génériques).
- Paiement, comptes, espace client, statistiques pour la station.

## Anti-objectifs (échec même si ça « marche »)

- **Copier ou extraire du contenu Google** (photos, 3D, textures) dans le jeu ou par programme : interdit par les conditions de Google, et rédhibitoire pour un produit vendu. S'inspirer à la main des photos est autorisé ; les textures doivent être faites, générées ou sous licence libre.
- Casser ce qui marche : sensations de ski, 30 FPS sur mobile milieu de gamme, chargement de la station.
- Un parent non joueur perdu : l'intégration doit rester jouable sans explication (clavier et tactile).

## Contraintes

- Délai : démo montrable avant Noël 2026 (viser ~3 semaines de travail).
- Stack existante : Three.js + Vite + TypeScript, physique maison, données cuites par `scripts/bake-station.mjs`. Déploiement Vercel depuis `main`.
- Sources de données autorisées : OpenStreetMap (ODbL, attribution), IGN (LiDAR HD, BD TOPO, BD ORTHO, Licence Ouverte / Etalab 2.0), swisstopo (swissBUILDINGS3D, open data) pour le côté suisse, Panoramax / Mapillary (licences libres) pour des références photo réutilisables.
- Budget perf : les restos ajoutés ne doivent pas faire grimper sensiblement les draw calls (instancier / fusionner comme le reste de `MountainView`).

## Décidé avec Alexandre

- Cible prioritaire : anciens clients qui revivent la station ; puis familles qui comparent.
- Produit automatique à terme (« un oui et quelques questions »), pas un service sur mesure.
- Les trois réglages ci-dessus sont les questions types.
- Ce qui manque pour « j'y étais » : les restos et bâtiments autour des pistes.
- Google Maps sert de référence visuelle consultée à la main, jamais de source copiée.
- Démo sur Les Rousses d'abord.
- **Pentes « réelles » = le relief actuel du jeu** (grande échelle ×2,3 au-dessus de 1160 m, `steep: 2.3` dans `src/sim/stations.ts`, ~105 km/h en tuck), pas le 1:1 qui serait trop plat. « Accentuées pour le fun » et « comme dans le souvenir » vont au-delà de cette base. C'est aussi le réglage par défaut de l'intégration.

## Mes choix (à contrôler)

- Silhouettes : tenter le LiDAR HD IGN (forme et hauteur de toit) côté français et swissBUILDINGS3D côté suisse ; si le LiDAR n'est pas encore publié sur la zone ou trop lourd à traiter dans le délai, modéliser chaque resto à la main (15 bâtiments, c'est faisable) à partir des empreintes OSM / BD TOPO et des photos.
- Enseigne : un panneau 3D avec le nom, lisible à ~40 m, toujours face au chemin d'arrivée principal.
- Écran de réglages : accessible par un bouton discret et par `?setup`, change le rendu en direct sans recharger quand c'est possible ; la configuration vit dans un fichier JSON par station dans le dépôt.
- URL d'intégration : `?station=rousses&embed=1` démarre directement en free ride, masque le menu arcade, garde pause, réglages et plan.
- **Qui voit les réglages** : ce sont ceux de la station, pas du visiteur. Le visiteur ne voit jamais l'écran de réglages de station (il garde les réglages de jeu habituels : qualité, son, caméra…). `?setup` est un aperçu pour le commercial : il change le rendu localement et peut exporter le JSON ; rien n'est réécrit sur le serveur. Tous les joueurs d'une station partagent donc le même relief, et le multijoueur ne change pas.
- **Rechargement** : changer les pentes peut recharger la station (relief, pistes, maillages à reconstruire) ; bâtiments et monde sur les pistes changent en direct.
- **« Personne »** ne retire que les skieurs simulés ; les vrais joueurs en ligne restent visibles.
- **Périmètre des restos** : on agrandit la zone détaillée vers le nord (boîte `rousses.box` de `scripts/bake-station.mjs`, aujourd'hui 46.4185–46.4605 N) jusqu'à ~46.468 N pour inclure La Cure (L'Arbezie, Chez Mamac, Bar de la Dôle), porte d'entrée du côté suisse. La Trélasse, La Givrine et La Genolière restent hors démo : leur coin n'a pas de pistes cuites (secteur exclu volontairement) et La Genolière est hors zone. Cuvaloup de Crans est dans la zone : on le garde. Le Bistrot du Chalet des Tuffes est gardé malgré sa fermeture temporaire (le bâtiment existe). Bar de la Dôle et Le Lapin Blanc passent en dernier et sont abandonnés s'ils restent introuvables.
- « Comme dans le souvenir » : accentuer la pente le long des pistes noires (et un peu les rouges) en gardant le relief général ; la méthode est laissée au constructeur tant que les pistes restent skiables et que le terrain ne présente pas de marches visibles.

## Laissé au constructeur

- La méthode technique de modélisation (procédural paramétré vs modèles faits à la main), le format des données des restos, l'icône et le style de la fiche, la façon d'implémenter la densité de skieurs (le module `render/crowd.ts` existe) et l'accentuation des pentes.
- L'ordre de réalisation, avec une contrainte : les restos reconnaissables passent en premier, c'est le cœur du « j'y étais ».
