# Journal des décisions

Format : **décision** · raison · alternatives écartées.

## Phase 0

1. **Nom : *Sillage*.** C'est la trace laissée dans la neige, donc le cœur visuel du pilier 1. Le mot est court, original et ne reprend rien de Grand Mountain Adventure ni de Traffic Rider. *Écartés :* « Firnline » (déjà utilisé par une autre session sur cette machine), « Schuss » (trop générique), « Powder Rush » (sans doute déjà pris).
2. **Dossier `~/sillage`, port de dev 5180.** Une autre session Claude construit au même moment un jeu similaire dans `~/firnline`. Travailler dans le même dossier provoquerait des écrasements mutuels, donc tout est séparé : dossier, nom, repo, port.
3. **npm au lieu de pnpm.** pnpm n'est pas installé ; la consigne dit « pnpm si dispo, sinon npm ».
4. **TypeScript 6.0.3 (et non 7.0).** typescript-eslint 8.72 exige `typescript < 6.1`. Le lint fait partie de la CI demandée.
5. **Caméra par défaut : poursuite basse et proche, pas la 1re personne.** En arbitrage, Grand Mountain gagne : on doit *voir* le carve et les figures. Cela réduit aussi le risque de motion sickness. La 1re personne reste une option (touche C).
6. **Tuck explicite** (↑ / deux pouces). C'est l'équivalent de l'accélérateur de Traffic Rider : on *décide* d'aller vite, et ce choix se voit (FOV) et s'entend (vent). On ne peut pas carver en tuck, d'où un arbitrage vitesse / contrôle.
7. **Le carving émerge de la physique.** La vitesse ne peut tourner vers les skis qu'à un taux limité (*grip*), et l'excès devient du dérapage qui freine. Pas de bouton « carve » : un geste doux carve, un geste brutal dérape.
8. **Missions persistantes (1 étoile chacune), à la Grand Mountain.** On progresse par défis indépendants qu'on peut valider en plusieurs runs, plutôt que par listes de missions séquentielles (Traffic Rider). C'est plus chill et respecte la priorité GMA.
9. **Les étoiles sont la seule monnaie.** Pas de boutique ni de grind : l'objectif est l'envie de rejouer, pas la rétention artificielle.
10. **Chute ≠ fin de run.** On se relève en ~1,5 s au dernier point sûr. Le ton reste chill et la chute coûte seulement du temps et le combo.
11. **UI en anglais, documentation en français.** Le jeu est public (GitHub et Vercel) ; les docs s'adressent au porteur du projet.
12. **Physique « au sol analytique ».** La physique interroge la fonction de hauteur exacte (lisse), pas le maillage. On obtient des normales continues, sans tremblement, et un maillage libre de son LOD.

### Décisions issues de la recherche (voir RESEARCH.md)

13. **Défis à 3 paliers (bronze, argent, or = 1 à 3 ★) au lieu d'une étoile par mission.** C'est le modèle de Grand Mountain : médailles cumulées, difficulté par seuils resserrés. Les paliers lissent la courbe (bronze facile, or exigeant), ce qui répond directement à la porte « pas de pic brutal ». Au total 9 défis, 27 ★ ; piste 2 à 4 ★, piste 3 à 10 ★.
14. **Relance au rythme (« pump »).** Dans le jeu de référence, alterner les virages fait prendre de la vitesse, ce qui rend le geste gratifiant et pas seulement freinant. Le paramètre est plafonné et réglable, car ce même jeu a dû retirer un boost trop généreux.
15. **Adhérence = accélération latérale max.** La vitesse tourne au plus à `grip / v` rad/s : virer serré à haute vitesse fait déraper (réaliste et lisible). Cette formulation colle aux données physiques (rayon de carving limité par la force latérale).
16. **Réception en switch tolérée.** Un 180 bien aligné à l'envers est validé, puis le skieur pivote automatiquement. Les critiques du jeu de référence jugent ces réceptions essentielles, sans qu'on ait besoin de gérer le ski à l'envers.
17. **« Trafic » = skieurs lents à doubler de près.** C'est la transposition directe du dépassement serré de Traffic Rider. Comme lui, le near-miss exige une vitesse minimale (40 km/h chez nous), avec un combo en rampe linéaire et le hors-piste ×2 (notre « contresens »). Implémenté après la porte de la Phase 2 (*feel before features*).
18. **Chute comique au lieu d'un retour en arrière manuel.** On se relève au dernier point sûr en ~1,5 s, avec un message ironique (« Yard sale! »). Même effet anti-frustration que le rewind du jeu de référence, sans casser le chronomètre des défis.
19. **Nom conservé malgré des homonymes obscurs** : un RPG Steam à 3 avis, un puzzle Play Store à 0+ téléchargements, une BD. Aucun jeu notable ne porte ce nom et c'est conforme à la règle n° 1. À sous-titrer si une sortie en store est un jour envisagée.

## Phase 1

20. **Gravité de jeu 11 m/s² (×1,12).** Avec la gravité réelle, l'accélération était un peu molle et les sauts flottants. La traînée est légèrement relevée pour garder des vitesses terminales crédibles. Les cibles de `FEEL.md` sont vérifiées par les tests.
21. **Tremplins calibrés par simulation** (3 tailles) : lèvre basse et longue pente de réception qui épouse les trajectoires de 30 à 60 km/h.
22. **Une réception trop rapide coûte de la vitesse au lieu de faire chuter.** On ne chute que pour une mauvaise orientation ou un impact extrême (Vn > 20 m/s). C'est le ton de Grand Mountain : la sanction comique vient d'une erreur de figure, pas d'un excès d'élan.
23. **Verrou des entrées en l'air.** Une touche tenue au décollage doit être relâchée avant de faire vriller ou salto. Sans ce verrou, un débutant en tuck faisait des saltos involontaires.
24. **Classes mathématiques de Three (`Vector3`) autorisées dans `sim/`.** Ce sont des maths pures, testables en Node : inutile de réinventer des vecteurs. Aucun objet de rendu n'entre dans `sim/`.
