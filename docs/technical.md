# Documentation technique — Indoor Wayfinder

**Version :** 3.0.0 — campus SUP'COM, WebGPU
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed-Becha Kaâniche — INDP3-SIA 26-27

## 1. Objet

PWA de navigation intérieure pour le bâtiment de SUP'COM (Cité Technologique
des Communications, El Ghazala, Ariana) : 3 blocs (A, B, C), hall central,
4 niveaux (RDC, étages 1 à 3). Localisation par QR codes (GPS à l'extérieur),
itinéraire multi-étages par Dijkstra, vue 3D WebGPU et guidage en réalité
augmentée WebXR orienté par la boussole.

## 2. Pile technique

| Élément | Choix |
|---|---|
| Rendu 3D | Three.js **r187**, build `three.webgpu.js`, `WebGPURenderer` sur le backend **WebGPU** uniquement |
| AR | WebXR `immersive-ar` + `hit-test` + `anchors` + `dom-overlay`, fonctionnalité de session **`webgpu`** (`XRGPUBinding`) |
| Localisation | QR (`getUserMedia` + `BarcodeDetector` / jsQR 1.4.0), GPS extérieur (Geolocation) |
| Orientation | DeviceOrientation absolu (`deviceorientationabsolute`) |
| Données | `assets/campus/supcom.json` généré par `scripts/build-campus.mjs` |
| Hors ligne | Service Worker `sw.js`, cache `indoor-wayfinder-v3.0.0` |
| Hébergement | HTTPS (Vercel ; GitHub Pages possible) |

Aucune ligne du code de l'application ne crée de contexte WebGL : `src/gpu.js`
ne construit un `WebGPURenderer` que si `navigator.gpu.requestAdapter()`
renvoie un adaptateur, et rejette le renderer si Three.js n'est pas sur le
backend WebGPU.

## 3. Arborescence

```
indoor-wayfinder/
├── index.html               UI, import map (three@0.187.0 webgpu), styles
├── manifest.json            PWA
├── sw.js                    cache hors ligne
├── src/
│   ├── main.js              NavigationService : contrôleur, état, UI
│   ├── navigation.js        CampusMap, CampusRouter (Dijkstra), stratégies, étapes
│   ├── view3d.js            CampusView3D : campus 3D WebGPU
│   ├── ar.js                ARGuide : immersive-ar sur WebGPU, flèche, chevrons
│   ├── gpu.js               détection WebGPU, fabrique WebGPURenderer
│   ├── geo.js               Compass, GpsTracker
│   ├── survey.js            SurveyStore (mode relevé)
│   └── scanner.js           QR caméra / image
├── assets/campus/
│   ├── supcom.json          plan du campus généré (≈ 1,2 Mo)
│   └── corrections.json     passages et noms relevés sur place
├── scripts/
│   ├── build-campus.mjs     import ArcGIS SUP'COM + OpenStreetMap
│   └── test-navigation.mjs  tests Node
└── docs/                    documentation, QR codes
```

## 4. Données du campus

### 4.1 Sources

- **Plans SUP'COM** : couche publique ArcGIS Online « SUPCOM Basemap »
  (propriétaire `SUPCOM_TUN`) — c'est la source cartographique de l'ancien site
  https://supnav.supcom.tn. Ce site affiche aujourd'hui « Error importing
  Data » car son service de salles/personnes
  (`supws/SupcomServices.svc/getPlacesPersons`) répond HTTP 400 ; les plans,
  eux, restent publiés.
  Couches : `plan_etage0…3` (polylignes) et `point_labels` (18 étiquettes).
  Types de traits : 1 murs, 2 portes, 3 escaliers, 4 ascenseurs, 5 façade,
  6 poteaux.
- **OpenStreetMap** (ODbL) : bâtiments, parkings et voies voisins.

### 4.2 Import

```bash
node scripts/build-campus.mjs
```

1. Conversion WGS84 → mètres locaux (origine : « Entrée principale »,
   x = est, y = nord).
2. Grille 25 cm commune aux 4 niveaux. Murs, façade et poteaux rasterisés ;
   chaque symbole de porte (regroupement des traits voisins) ouvre la baie ;
   aux étages, l'emprise du bâtiment est la fermeture des murs extérieurs.
3. Cellules classées par distance au mur (1 à 4) pour tenir les trajets au
   milieu des couloirs ; cellules extérieures du RDC marquées.
4. Salles = régions fermées par murs **et** portes, 4–900 m², 1 à 4 portes ;
   code stable `<bloc><niveau>-<n°>` (ex. `A1-07`), numérotation dans le sens
   horaire autour du centre du bloc.
5. Étiquettes SUP'COM : amphithéâtres, accueil, bureau d'ordre, buvette,
   entrée → nom officiel ; escaliers / ascenseurs → connecteurs avec leurs
   niveaux.
6. `corrections.json` : passages relevés (carvés dans la grille) et noms de
   salles.

Résultat actuel : 233 salles (99 / 46 / 42 / 46 par niveau), 8 lieux
officiels, 7 connecteurs, 34 bâtiments voisins.

**Limite connue :** les anneaux extérieurs des blocs A et B au RDC (25 locaux
dont la buvette) n'ont aucune porte vers le reste du plan CAD. L'itinéraire
s'arrête au point relié le plus proche avec « Accès à confirmer ». À corriger
par un passage relevé.

## 5. Routage

`CampusRouter.findRoute(from, to)` — `from` / `to` : id de lieu, code de salle,
alias QR ou point `{ level, x, y }` (toucher sur le plan, GPS).

- Graphe : nœuds = cellules praticables des 4 niveaux, 8 voisins, coût =
  longueur × pénalité de proximité au mur ; arêtes verticales aux connecteurs.
- **Dijkstra** avec tas binaire ; heuristique euclidienne admissible (A*)
  activable (`useHeuristic`).
- **Stratégies** : `ShortestPathStrategy` (escalier 7 m / niveau, ascenseur
  15 m + 3 m / niveau) et `AvoidStairsStrategy` (ascenseurs seulement).
- Lissage par visibilité, découpage par niveau, consignes : « Marchez 22 m
  vers le Sud-Ouest », « Prenez l'escalier (Bloc A) jusqu'à l'étage 3 ».
- `distancesFrom(from)` : une seule passe vers tous les lieux (≈ 0,3 s) pour la
  liste des destinations.

## 6. Vue 3D (WebGPU)

`CampusView3D` : murs extrudés (2,9 m), dalles depuis les cellules
intérieures, portes / escaliers / ascenseurs en traits, niveaux espacés de
3,6 m, bâtiments OSM extrudés. Sélecteur RDC / 1 / 2 / 3 / Tous ; étages
inférieurs atténués ; vue orbite (glisser, pincer, deux doigts = déplacer)
ou vue « Plan » nord en haut. Itinéraire : tube par niveau, liaison verticale,
chevrons animés, balise de destination, marqueur de position et cap.

## 7. Réalité augmentée

`ARGuide.prepare()` (au démarrage) : `immersive-ar` supporté ?
`XRGPUBinding` présent ? puis création d'un `WebGPURenderer` compatible XR.

`ARGuide.start(route, position)` (dans le toucher, première étape asynchrone) :
`requestSession('immersive-ar', { requiredFeatures: ['webgpu', 'hit-test'],
optionalFeatures: ['local-floor', 'anchors', 'dom-overlay'] })`. Une seule
requête par toucher ; si la configuration complète est refusée, la cause est
affichée et le toucher suivant utilise `['webgpu', 'hit-test']`.

Avec Three.js r187, la boucle `setAnimationLoop` est posée **avant**
`renderer.xr.setSession()`.

**Orientation :** la boussole donne le cap vrai de la caméra, WebXR son lacet
dans le monde AR ; leur différence (moyenne circulaire) convertit tout cap du
plan en direction AR. Les 40 premiers mètres de l'itinéraire sont dessinés au
sol en chevrons depuis la position du QR scanné ; la flèche posée au toucher
prend le cap du segment le plus proche.

**Prérequis téléphone :** Chrome Android à jour, Google Play Services for AR,
et `chrome://flags/#webxr-webgpu-binding` → *Enabled*, puis redémarrer Chrome.
La liaison WebXR/WebGPU n'est pas encore activée par défaut dans Chrome
(Chrome Platform Status, fonctionnalité 5077077997649920).

## 8. Boussole et GPS

- `Compass` : `deviceorientationabsolute` (Android) ou `webkitCompassHeading`
  (iOS). Cap de la caméra arrière à partir de la matrice Z-X'-Y'' ; téléphone à
  plat → cap du haut de l'écran. Déclinaison +3,5° (El Ghazala). Filtre
  circulaire et estimation de la gigue (fiable si < 12°).
- `GpsTracker` : `watchPosition` haute précision → coordonnées du campus.
  Pris comme départ seulement à l'extérieur et si la précision ≤ 30 m.

## 9. Mode relevé

Bouton **Relevé** : toucher une salle → saisir le nom de la plaque ;
**Passage manquant** : deux touchers de part et d'autre d'une porte absente du
plan. Stockage local, annulation, **Exporter** → `corrections.json` à fusionner
dans `assets/campus/`, puis relancer l'import.

## 10. QR codes

Chaque QR encode l'id d'un lieu (`ENTREE_PRINCIPALE`, `AMPHI_KHAWAREZMI`,
`ESCALIER_A`, …) ou le code d'une salle (`B1-07`). Alias : `ENTREE`, `HALL`.
Cartes prêtes : `docs/qr-codes/` ; planche par niveau : `docs/qr-codes.html`.
Lien direct : `?depart=ID&destination=ID`.

## 11. Vérifications

```bash
node --test scripts/test-navigation.mjs     # 13 tests campus / routage / boussole
python -m http.server 8000                  # puis http://localhost:8000
```

## 12. Déploiement

HTTPS obligatoire (caméra, WebXR, WebGPU, Service Worker). Après une
modification d'un fichier mis en cache, augmenter `CACHE_NAME` dans `sw.js`.

```bash
vercel --prod --yes
```
