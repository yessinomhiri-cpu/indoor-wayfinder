# Documentation technique — Indoor Wayfinder

**Version :** 3.8.0 — campus SUP'COM, WebGPU, guidage AR, mode caméra, maquette extérieure (vue Campus) et vue en coupe des étages
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
| Hors ligne | Service Worker `sw.js`, cache `indoor-wayfinder-v3.9.0` |
| Hébergement | HTTPS : Vercel (actif) ; GitHub Pages (à activer par le propriétaire du dépôt, accès admin requis) |

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
├── diagnostic.html          diagnostic AR WebGPU du téléphone de démo
├── src/
│   ├── main.js              NavigationService : contrôleur, état, UI
│   ├── navigation.js        CampusMap, CampusRouter (Dijkstra), stratégies, étapes
│   ├── view3d.js            CampusView3D : campus 3D WebGPU, palettes jour / nuit
│   ├── exterior.js          CampusExterior : maquette extérieure (vue Campus)
│   ├── exterior-textures.js textures procédurales de la maquette
│   ├── interior.js          CampusInterior : intérieur des étages (vue en coupe)
│   ├── mesh-soup.js         construction de maillages fusionnés
│   ├── ar.js                ARGuide : immersive-ar sur WebGPU, flèche, chevrons
│   ├── gpu.js               détection WebGPU, fabrique WebGPURenderer
│   ├── diagnostic.js        vérification de la chaîne AR WebGPU + test AR réel
│   ├── geo.js               Compass, GpsTracker
│   ├── survey.js            SurveyStore (mode relevé)
│   └── scanner.js           QR caméra / image
├── assets/campus/
│   ├── supcom.json          plan du campus généré (≈ 1,2 Mo)
│   └── corrections.json     passages et noms relevés sur place
├── scripts/
│   ├── build-campus.mjs     import ArcGIS SUP'COM + OpenStreetMap
│   ├── test-navigation.mjs  tests Node : campus, routage, boussole
│   ├── test-guidance.mjs    tests Node : marches AR simulées
│   └── test-diagnostic.mjs  tests Node : verdict du diagnostic
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
- **Passage par les portes** : `grid.rooms` donne la région de chaque salle
  (fermée par les murs et les symboles de porte). Sortir d'une salle autre que
  la salle de départ coûte 80 m (non compté dans les distances affichées) ; le
  lissage refuse les raccourcis qui entrent dans une troisième salle. Les
  itinéraires restent dans les couloirs et entrent / sortent par les portes.

## 6. Vue 3D (WebGPU)

`CampusView3D` : murs extrudés (2,9 m), dalles depuis les cellules
intérieures, portes / escaliers / ascenseurs en traits, niveaux espacés de
3,6 m, bâtiments OSM extrudés. Sélecteur RDC / 1 / 2 / 3 / Tous ; étages
inférieurs atténués ; vue orbite (glisser, pincer, deux doigts = déplacer)
ou vue « Plan » nord en haut.
Itinéraire : tube par niveau, liaison verticale,
chevrons animés, balise de destination, marqueur de position et cap.

### 6.1 Maquette extérieure (vue Campus)

Le site s'ouvre sur cette vue. Le bouton **Campus** affiche `CampusExterior` (`src/exterior.js`), construit
une fois au démarrage, et passe la scène en palette de jour
(`#applyEnvironment` : ciel, brouillard, lumières, sol, zones OSM par type) ;
les étages intérieurs sont masqués. Choisir un étage, un lieu ou un itinéraire
revient à la vue 3D (`onViewModeChange` met à jour la barre d'outils).

- **Données** : `scripts/build-campus.mjs` écrit `floors[].outline` (marching
  squares sur l'emprise de chaque étage à 0,5 m, Douglas–Peucker 0,3 m ;
  anneaux extérieurs anti-horaires, cours intérieures horaires) et
  `exterior.apron` (emprise du RDC dilatée de 6 m).
- **Façades** : un prisme par étage (3,6 m). Les arêtes proches de l'axe des
  deux tours qui encadrent l'entrée sont l'**aile vitrée** (texture
  mur-rideau, coordonnée u projetée sur l'axe) ; les autres sont des **tours**
  (texture enduit blanc + vitrage haut, u = angle autour du centre du bloc,
  nombre entier de baies, donc vitrages alignés d'un étage à l'autre).
- **Toits** : une arête est un bord de toit si l'étage supérieur ne la couvre
  pas (test à 2 m vers l'intérieur) : corniche grise inclinée (tours) ou
  bandeau (aile), décalages en onglet pour rester continus ; poteaux d'acier
  instanciés tous les 6,5 m sous la corniche des tours.
- **Entrée** : repère calé sur la façade du RDC devant « Entrée principale »
  (normale moyenne des arêtes proches) : arche parabolique extrudée posée
  contre le mur (face arrière sur le point le plus saillant de la façade
  sous sa portée), terrasse
  et marches, trois mâts avec le drapeau tunisien, enseigne « SUP'COM » sur le
  bandeau du dernier étage, parvis dallé, pelouses.
- **Paysage** : palmiers et arbres instanciés autour du parvis (hors bâtiments
  OSM et hors parvis d'entrée), lampadaires, voies OSM en rubans, ciel en
  dégradé qui suit la caméra, soleil d'après-midi avec ombres (PCF, 2048²),
  actif seulement dans cette vue.
- **Textures** : `src/exterior-textures.js`, dessinées sur canvas (aucune
  image externe). Référence : vidéo officielle SUP'COM (voir `ATTRIBUTION.md`).

### 6.2 Vue en coupe des étages (bouton 3D)

Le bouton **3D** et les onglets d'étage montrent la même maquette de jour,
coupée : le bâtiment extérieur est un `ClippingGroup` (plan de coupe WebGPU,
ombres coupées aussi) coupé à `niveau × 3,6 m + 2,2 m`, et `CampusInterior`
(`src/interior.js`) affiche l'intérieur de l'étage choisi. « Tous » empile les
quatre intérieurs sans l'enveloppe ; « Plan » garde le plan de nuit vu de
dessus. Chaque étage est construit à son premier affichage.

- **Sol** : une bande par suite de cellules d'une même salle (ou du couloir)
  sur chaque ligne de la grille ; salles trouvées par remplissage de la grille
  de circulation depuis le point intérieur de chaque salle, limité à sa boîte.
- **Murs** : traits des plans en faces verticales coupées à 2,2 m, ligne de
  coupe sombre au sommet ; portes (arcs d'ouverture), marches d'escalier,
  cages d'ascenseur vitrées.
- **Amphithéâtres** (4, au RDC des blocs A et B) : scène du côté du centre de
  la tour, gradins en arcs de 0,9 m autour de ce centre (montée ≤ 1,7 m),
  sièges instanciés tous les 0,56 m là où la salle les contient, tableau et
  pupitre. Les plans ne donnent pas le mobilier : disposition plausible.
- **Interaction** : toucher le sol d'une salle place la position (sol de
  l'étage affiché) ; itinéraire, balise et étiquettes dessinés dans la coupe.

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

**Localisation en continu (`src/ar-guidance.js`).** Le QR scanné fixe le point
de départ ; ARCore suit chaque pas et chaque rotation (pose de la caméra
WebXR). La transformation monde AR → plan (angle φ, translation δ) part de la
boussole puis est corrigée par **correspondance cartographique** toutes les
0,6 s : recherche globale de φ (±30°, pas de 1°) et de δ (±1 m) qui place la
trajectoire parcourue dans les cellules praticables du plan (murs = contrainte
forte, −3 par point dans un mur) et près de l'itinéraire (contrainte faible,
seulement pour les tronçons parcourus sur l'itinéraire). La boussole ne sert
plus qu'à départager. Étages : hauteur de la caméra (escaliers), recalage sur
le palier d'arrivée connu du plan ; ascenseur : bouton de confirmation.

**Guidage.** Projection sur l'itinéraire, prochaine manœuvre (« Dans 6 m,
tournez à gauche », « Prenez l'escalier… », « Faites demi-tour »), distance
restante, sortie d'itinéraire > 3,2 m pendant 2,5 s → recalcul depuis la
position suivie, arrivée à moins de 2 m. Rendu dans un repère aligné sur le
plan : chevrons sur les 25 m suivants, flèches de virage, panneaux escalier /
ascenseur, épingle de destination, **murs réels en occulteurs invisibles**
(`colorWrite: false`). Le HUD (DOM overlay) affiche la consigne, une flèche
qui tourne avec l'utilisateur, la pièce traversée, la confiance, une
mini-carte orientée et les boutons Aligner / Je suis à… / Quitter.

**Précision mesurée (simulation, `scripts/test-guidance.mjs`) :** erreur
moyenne < 0,6 m et alignement à moins de 3° malgré une boussole faussée de
±15° ; dans un grand espace ouvert avec dérive forte et utilisateur hors
itinéraire, l'erreur peut atteindre quelques mètres → « Je suis à… » ou
nouveau scan QR.

**Prérequis téléphone :** Chrome Android à jour, Google Play Services for AR,
et `chrome://flags/#webxr-webgpu-binding` → *Enabled*, puis redémarrer Chrome.
La liaison WebXR/WebGPU n'est pas encore activée par défaut dans Chrome
(Chrome Platform Status, fonctionnalité 5077077997649920).

**Sol non détecté (risque « Hit Testing instable »).** `FloorEstimator`
(`ar-guidance.js`) donne la hauteur du sol : médiane des derniers impacts
ARCore situés 0,7 à 2,4 m sous le téléphone (*détecté*) ; sinon 1,45 m sous
le téléphone, lissé sur 1,2 s pour ne pas suivre les mouvements de la main
mais suivre les escaliers (*estimé*, annoncé après 3 s). Les impacts d'un
ancien étage sont oubliés dès qu'ils ne correspondent plus à la hauteur du
téléphone. Un toucher sans impact pose la flèche à 1,5 m devant le téléphone
(`fixedArrowPoint`), ancrée par `XRFrame.createAnchor` si disponible.

**Flèche de guidage flottante.** `ARGuide.#updateGuideArrow` place une
grande flèche 2 m devant le téléphone, 45 cm plus bas (`fixedArrowPoint`),
orientée vers le point de l'itinéraire situé 4 m plus loin
(`state.targetBearing` → `directionOfBearing`). Position et cap sont lissés
(constantes de temps 120 / 180 ms, `smoothAngle` par le plus court chemin).
`guideArrowMode` choisit la couleur : grise si confiance < 50 % (hors
alignement manuel), orange hors trajet, verte à l'arrivée, bleue sinon. Elle
est dessinée sans test de profondeur pour ne jamais être masquée par les murs.

### 7.1 Mode Caméra (sans ARCore)

`CameraGuide` (`camera-guide.js`) : flux `getUserMedia` (caméra arrière) en
plein écran, canvas WebGPU transparent par-dessus (`createWebGPURenderer({
alpha: true })`) avec la même flèche (`createGuideArrow`). Lacet de la flèche
= `targetBearing − cap boussole` ; tangage de la caméra virtuelle = `beta −
90°` (inclinaison du téléphone). `RouteFollower` (`route-follower.js`) fait
du *pedestrian dead reckoning* contraint à l'itinéraire : `StepDetector`
détecte les pas sur la norme de `accelerationIncludingGravity` (moyenne lente
1 s, rapide 50 ms, seuil 1,2 m/s², ≥ 320 ms entre deux pas) ; chaque pas
avance de 0,7 m si le téléphone fait face au trajet (< 70°), recule au-delà de
110°, sinon ne bouge pas. Changement d'étage confirmé par l'utilisateur.
Sans boussole (ordinateur + webcam), le clavier simule la marche.

### 7.2 Interface de guidage et voix

`nav-format.js` découpe l'instruction (« Dans 6 m, tournez à gauche » →
« 6 m » + « Tournez à gauche » + icône). `voice.js` : `VoiceAnnouncer`
(pur, testé) décide quoi dire et quand (12 m puis 3 m avant chaque virage,
escalier une fois, demi-tour au plus toutes les 8 s, arrivée une fois) ;
`Voice` parle via `speechSynthesis` (fr-FR), préférence en `localStorage`.

### 7.3 Budget d'images de la vue 3D

`CampusView3D.#frameInterval` : pleine vitesse si l'utilisateur touche la
carte ou si la caméra bouge (> 1 cm), 30 images/s pour les animations de
l'itinéraire, 4 images/s sinon. Mesuré : 720 → 144 images en 5 s (carte
immobile avec itinéraire), 720 → 20 (sans itinéraire).

### 7.4 Service Worker

`activate` ne recharge plus les onglets (`client.navigate` supprimé) : la
page se recharge une seule fois après une mise à jour, et attend la fin
d'un guidage en cours (`registerServiceWorker` dans `main.js`).

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

**Génération.** Les cartes sont produites hors ligne avec Python `qrcode` +
Pillow à partir de `assets/campus/supcom.json` : le payload est l'identifiant
du lieu, les modules sont entiers pour un décodage fiable. La planche
`docs/qr-codes.html` interroge QuickChart pour imprimer toutes les salles d'un
étage. Détail des fichiers : `docs/qr-codes/README.md`.

## 11. Installation et vérifications

```bash
git clone https://github.com/yessinomhiri-cpu/indoor-wayfinder.git
cd indoor-wayfinder
# aucune dépendance npm : Three.js et jsQR sont chargés depuis le CDN épinglé
npm test                                    # 68 tests : routage, guidage AR, mode caméra, diagnostic, contours extérieurs
python -m http.server 8000                  # puis http://localhost:8000
```

**Sur le téléphone de démo :** `diagnostic.html` (badge **AR : …** de
l'application) vérifie HTTPS, Chrome Android, adaptateur WebGPU
`xrCompatible`, device GPU (rendu de test), WebXR, `immersive-ar` (ARCore),
`XRGPUBinding` (flag), caméra, BarcodeDetector, boussole, Wake Lock,
vibration, Service Worker et cache hors ligne. Son **test AR réel** ouvre une
session `immersive-ar` + `webgpu` + `hit-test` comme Three.js r187
(`XRGPUBinding.createProjectionLayer`, `getViewSubImage` à chaque image, rendu
WebGPU brut) pendant 20 s et mesure démarrage, img/s, saccades, suivi, délai
de détection du sol et ancre. Procédure complète :
[demo-phone-setup.md](demo-phone-setup.md).

## 12. Déploiement

HTTPS obligatoire (caméra, WebXR, WebGPU, Service Worker). Après une
modification d'un fichier mis en cache, augmenter `CACHE_NAME` dans `sw.js`.

Déploiement actif (Vercel) :

```bash
vercel --prod --yes
```

Adresse : <https://indoor-wayfinder-lyart.vercel.app>.

GitHub Pages est demandé par le cahier des charges, mais le site
`github.io/indoor-wayfinder` est encore en 404 : seul le propriétaire du
dépôt (accès admin) peut l'activer dans **Settings → Pages → Deploy from a
branch → main / (root)**. Une fois activé, le même build statique est servi
en HTTPS ; aucun serveur applicatif n'est nécessaire.
