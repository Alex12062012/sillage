# Sillage — Game Design Document

> *Sillage* (n.m.) : la trace qu'on laisse derrière soi. Ici : deux lignes nettes dans la neige fraîche.

## Pitch

**Sillage** est un jeu de ski 3D low-poly jouable dans le navigateur, sur mobile comme sur desktop. Chaque descente dure 45 à 90 s. On y cherche la ligne parfaite : carver en rythme, doubler les skieurs lents en les frôlant, décoller d'un tremplin. Puis on recommence aussitôt pour faire mieux. Le plaisir vient du **geste** (une courbe propre qui grave un beau sillage) et de la **vitesse** (le monde qui défile, le vent qui monte).

## Les 3 piliers

1. **La glisse d'abord.** Chaque virage doit procurer du plaisir, même sans objectif. Les carres mordent, l'inertie est crédible, la poudreuse gicle, une trace reste dans la neige. Un carve propre et rythmé *relance* la vitesse ; un virage brutal dérape et freine.
2. **La vitesse se ressent.** Caméra basse, FOV qui s'ouvre, vent qui siffle, micro-vibrations, sapins et skieurs frôlés. La vitesse se gagne (tuck, rythme, risque) et se perd (dérapage, chute).
3. **Encore une descente.** Runs courtes, défis clairs toujours visibles, restart en moins d'1 s, progression visible (étoiles → pistes → tenues).

*Arbitrage :* en cas de conflit, le pilier 1 gagne (priorité Grand Mountain). Les mécaniques « à la Traffic Rider » (near-miss avec vitesse minimale, défis courts, vitesse brute) servent les piliers 2 et 3, jamais au détriment de la glisse.

## Boucles de jeu

| Échelle | Boucle |
|---|---|
| **30 s** | Carver en rythme pour relancer → choisir sa ligne (sûre, ou risquée : hors-piste, sapins, skieurs à doubler, tremplin) → atterrir proprement → le combo monte. |
| **5 min** | Choisir une piste → ses 3 défis s'affichent → descente de 45 à 90 s, avec médailles qui tombent en direct → écran de fin (temps, score, étoiles) → *Retry* instantané ou piste suivante. |
| **Session (10–20 min)** | Monter ses médailles de bronze à or → débloquer la piste suivante et des cosmétiques → battre ses records. |

## Contrôles

| Action | Clavier | Tactile (défaut) | Manette |
|---|---|---|---|
| Carver G/D (analogique lissé) | ← → / A D | maintenir moitié gauche / droite de l'écran | stick gauche |
| *Tuck* (recherche de vitesse, peu de direction) | ↑ / W | maintenir les deux moitiés | RT |
| Freiner (dérapage) | ↓ / S | glisser vers le bas et maintenir | LT / B |
| Saut (*pop*) | Espace | glisser vers le haut | A |
| En l'air : vrille / salto | ← → / ↑ ↓ | maintenir G/D / glisser haut/bas | stick |
| Restart · Pause · Caméra | R · Échap · C | boutons à l'écran | Y · Start · Select |

Options : direction par inclinaison (gyroscope), sensibilité, mode gaucher (miroir des boutons). Aucun tutoriel : une aide contextuelle s'affiche au premier départ et les défis restent affichés dans le HUD.

## Caméra

Caméra de poursuite **basse et proche** (≈ 2 m au-dessus des skis, 4,5 m derrière). Elle regarde loin devant dans l'axe de la vitesse et non des skis, ce qui la garde stable en vrille. C'est notre réponse à la principale critique du jeu de référence (caméra qui masque la piste). FOV de 72° qui s'ouvre jusqu'à 92° à grande vitesse. Roulis ≤ 4° en virage, respiration au ralenti, recul pendant les sauts. Une caméra casque (1re personne) est disponible en option. **Mode confort :** FOV fixe, sans shake ni roulis.

## Défis & progression

- **3 pistes** générées depuis 3 seeds fixes : *Combe Douce* (bleue), *Crête du Loup* (rouge), *Couloir Noir* (noire).
- **3 défis par piste, chacun à 3 paliers** (bronze, argent, or = 1, 2, 3 ★), validables sur plusieurs runs, à la manière des médailles de Grand Mountain. La difficulté monte en **resserrant les seuils**, jamais en ajoutant des mécaniques. Familles :
  - **Course** : temps sous un seuil ;
  - **Vitesse** : pointe ;
  - **Air** : distance de saut ;
  - **Near-miss** : chaîne ;
  - **Figure** : 360 / 720 / 1080 ;
  - **Propre** : nombre de chutes ;
  - **Score**.
- **Déblocages :** *Crête du Loup* à 4 ★, *Couloir Noir* à 10 ★ (sur 27). Couleurs de veste, de skis et de trace aux paliers d'étoiles.
- **Records** par piste : meilleur temps, meilleur score, vitesse max.

## Économie & score

Les **étoiles sont la seule monnaie**, cumulées et jamais dépensées : pas de boutique, pas de grind, aucune mission bloquée par l'équipement. Le score sert à se mesurer à soi-même :

| Source | Points |
|---|---|
| Near-miss (sapin, rocher, skieur, à ≥ 40 km/h) | 100 (250 si frôlé), × rang dans la chaîne (rampe 1, 2, 3…), × 2 hors-piste |
| Temps de vol | 100 / s |
| Vrilles | 360 = 300, 720 = 800, 1080 = 1 500 ; salto 500 |
| Réception | parfaite ×1,25 ; switch acceptée (180 / 540) |
| Vitesse | au-delà de 60 km/h, en continu |
| Arrivée | bonus selon le par |

Une chute (« Yard sale! ») casse le combo et coûte ~1,5 s, mais ne fait jamais perdre de points.

## Direction artistique

Low-poly stylisé et lumineux. La neige est douce, éclairée par un soleil chaud, avec des ombres bleutées. Les sapins sont en cônes facettés coiffés de neige, les rochers en ardoise facettée. Ciel en dégradé pastel avec brouillard de distance assorti, une heure du jour par piste (matin, midi, couchant).

**La lisibilité passe avant tout :**
- piste damée plus claire que le hors-piste ;
- piquets de bord colorés selon la difficulté ;
- tremplins marqués d'orange ;
- arche d'arrivée visible de loin ;
- traces de ski persistantes.

La montagne est vivante : des skieurs lents y circulent. Tous les assets sont générés par code.

## Audio

Tout est synthétisé en WebAudio :
- vent filtré qui monte et siffle avec la vitesse ;
- crissement des carres en grains de bruit (feutré en poudreuse, brillant sur glace) ;
- *thump* d'atterrissage, *whoosh* stéréo au near-miss, chute ;
- carillon de médaille ;
- nappe d'ambiance calme, façon piano lointain, désactivable.

## Ton

Chill mais grisant. Les chutes sont drôles et sans punition : on se relève et on repart. Les messages sont courts et positifs (« Clean! », « Close call! », « Big air! »). L'interface est en anglais pour un public international, la documentation en français.
