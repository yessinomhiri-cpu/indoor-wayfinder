# 📄 Fichier d'Attribution et d'Origine des Ressources (ATTRIBUTION.md)

**Projet :** Indoor Wayfinder — Navigation intérieure en réalité augmentée
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed-Becha Kaâniche — INDP3-SIA 26-27
**Version :** 2.0 — Évaluation SUP'COM (2026/2027)
**Dernière mise à jour :** 12 novembre 2026

---

## 1. Modèles 3D, Textures et Assets Graphiques

Tout asset tri-dimensionnel ou visuel importé doit être consigné ci-dessous.

*   **Asset :** Plans des étages de SUP'COM (RDC, étages 1 à 3) et étiquettes (blocs A/B/C, amphithéâtres, escaliers, ascenseurs, accueil, entrée) — convertis dans `assets/campus/supcom.json`
    *   **Source originale :** Couche publique ArcGIS Online « SUPCOM Basemap » publiée par SUP'COM (propriétaire `SUPCOM_TUN`), utilisée par l'ancien site https://supnav.supcom.tn — service https://services-eu1.arcgis.com/Vx1BvPxWQ9O0WzWh/arcgis/rest/services/supcom_basemaps_gdb/FeatureServer
    *   **Auteur / Créateur :** SUP'COM — École Supérieure des Communications de Tunis
    *   **Licence :** Données publiées en accès public par SUP'COM, sans licence explicite ; usage académique interne à SUP'COM, crédit « Plans © SUP'COM » affiché dans l'application ; autorisation formelle à confirmer auprès de l'administration
    *   **Modifications apportées par l'équipe :** Import par `scripts/build-campus.mjs` : conversion WGS84 → mètres locaux (origine : entrée principale), simplification Douglas–Peucker, grille de circulation 25 cm par étage (portes ouvertes à partir des symboles de porte), détection automatique des salles (233 locaux codés `A1-07`…), connecteurs escaliers/ascenseurs entre étages ; aucune géométrie inventée

*   **Asset :** Bâtiments, parkings et voies autour de SUP'COM (Technopôle El Ghazala) — `context` dans `assets/campus/supcom.json`
    *   **Source originale :** OpenStreetMap — https://www.openstreetmap.org (API https://api.openstreetmap.org/api/0.6/map)
    *   **Auteur / Créateur :** © Contributeurs OpenStreetMap
    *   **Licence :** Open Database License (ODbL 1.0) — https://www.openstreetmap.org/copyright ; crédit « © OpenStreetMap » affiché dans l'application
    *   **Modifications apportées par l'équipe :** Conversion en mètres locaux, extrusion des bâtiments selon `building:levels` (3,2 m par niveau, 2 niveaux par défaut), le bâtiment principal de SUP'COM étant dessiné à partir des plans SUP'COM

*   **Asset :** Maquette 3D du campus et de l'itinéraire (`src/view3d.js`)
    *   **Source originale :** Aucun modèle importé — murs, dalles, portes, escaliers, ascenseurs, bâtiments voisins, tube d'itinéraire, chevrons, balise, marqueurs GPS / position / cap, flèche du nord générés par code avec Three.js à partir de `assets/campus/supcom.json` ; étiquettes dessinées sur un canvas 2D
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet (projet académique SUP'COM)
    *   **Modifications apportées par l'équipe :** Rendu WebGPU (`WebGPURenderer`), 4 niveaux empilés à 3,6 m, sélecteur d'étage, vue orbite et vue « Plan » nord en haut

*   **Asset :** Flèche de navigation AR, réticule et chevrons au sol (`createArrow()` et géométries dans `src/ar.js`)
    *   **Source originale :** Aucune URL externe — formes 2D (`THREE.Shape`) extrudées avec `ExtrudeGeometry` / `ShapeGeometry`, anneau `RingGeometry`
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Flèche plate de 1 m orientée par la boussole selon le cap réel du couloir ; chevrons tous les 1 m sur les 40 premiers mètres de l'itinéraire

*   **Asset :** Modèle 3D de la flèche au format GLB
    *   **Source originale :** Aucun modèle GLB importé
    *   **Auteur / Créateur :** Sans objet
    *   **Licence :** Sans objet
    *   **Modifications apportées par l'équipe :** La flèche est générée par code ; cette entrée documente explicitement l'absence de ressource externe

*   **Asset :** Icônes PWA (`assets/icons/icon-180.png`, `icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`)
    *   **Source originale :** Aucune URL externe — générées par l'équipe avec Python/Pillow à partir du logo boussole du projet
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Variantes `any` et `maskable`, marges de sécurité, export PNG 180/192/512

*   **Asset :** Icônes SVG et rose des vents de l'interface (`index.html`)
    *   **Source originale :** Aucune URL externe — SVG et CSS inline dessinés par l'équipe (boussole, scanner, destination, recherche, fermeture, AR, rose N/E/S/O)
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Aucune bibliothèque d'icônes externe

*   **Asset :** Police de caractères
    *   **Source originale :** Pile de polices système : `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`
    *   **Auteur / Créateur :** Fournisseurs des systèmes d'exploitation et navigateurs
    *   **Licence :** Licences système/navigateur ; aucune police web n'est redistribuée
    *   **Modifications apportées par l'équipe :** Aucune police téléchargée ni modifiée

*   **Asset :** QR codes des lieux de SUP'COM (`docs/qr-codes/*.png`, `docs/qr-codes/full-sheet.png`)
    *   **Source originale :** Aucune URL externe — images générées localement par l'équipe avec la bibliothèque Python `qrcode` et Pillow ; chaque QR encode l'identifiant d'un lieu de `assets/campus/supcom.json`
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet ; `qrcode` (licence BSD) et Pillow (licence HPND) ne sont utilisés qu'à la génération et ne sont pas redistribués avec l'application
    *   **Modifications apportées par l'équipe :** 15 cartes (entrée, accueil, bureau d'ordre, buvette, 4 amphithéâtres, 7 escaliers/ascenseurs) et une planche complète ; vérifiées avec le décodeur de l'application

*   **Asset :** Planche de QR codes imprimable (`docs/qr-codes.html`)
    *   **Source originale :** Page HTML de l'équipe ; images QR générées à la volée par l'API externe QuickChart — https://quickchart.io/qr
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder pour la page ; service QuickChart pour le rendu QR
    *   **Licence :** Code de la page : projet ; service QuickChart : conditions d'utilisation du service externe
    *   **Modifications apportées par l'équipe :** Lit `assets/campus/supcom.json` et imprime un QR par lieu (lieux principaux ou toutes les salles d'un étage)

---

## 2. Bibliothèques tierces et Modules externes (Pinnés)

Rappel : L'usage des versions "latest" depuis les CDN est proscrit.

*   **Bibliothèque :** Three.js — build WebGPU (`three.webgpu.js`, avec ses modules `three.core.js` et `three.tsl.js`)
    *   **Version fixée :** 0.187.0 (r187, 30 octobre 2026)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.webgpu.js
    *   **Rôle dans le projet :** Moteur 3D, rendu exclusivement par `WebGPURenderer` sur le backend WebGPU : vue 3D du campus (`src/view3d.js`) et session WebXR `immersive-ar` rendue via `XRGPUBinding` (`src/ar.js`) ; création contrôlée dans `src/gpu.js` (aucun renderer créé sans adaptateur WebGPU)

*   **Bibliothèque :** Three.js addons (import map)
    *   **Version fixée :** 0.187.0 (r187)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/three@0.187.0/examples/jsm/
    *   **Rôle dans le projet :** Chemin d'import réservé aux modules complémentaires Three.js ; aucun addon n'est utilisé à ce jour

*   **Bibliothèque :** jsQR
    *   **Version fixée :** 1.4.0
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm
    *   **Rôle dans le projet :** Décodage des QR codes lorsque `BarcodeDetector` n'est pas disponible ; chargé dynamiquement dans `src/scanner.js`, mis en cache par `sw.js`

*   **Bibliothèque :** API natives du navigateur (aucune bibliothèque tierce)
    *   **Version fixée :** APIs standard du navigateur (pas de version CDN)
    *   **Lien CDN de référence :** Sans objet
    *   **Rôle dans le projet :** WebGPU (`navigator.gpu`), WebXR Device API (`immersive-ar`, hit test, ancres, DOM overlay, liaison WebXR/WebGPU `XRGPUBinding`), DeviceOrientation (boussole), Geolocation (GPS extérieur), `getUserMedia` (caméra arrière), `BarcodeDetector`, Vibration API, Screen Wake Lock, Service Worker / Cache API, localStorage (mode relevé)

*   **Outil de génération (non distribué) :** Node.js 24 (`scripts/build-campus.mjs`, `fetch` natif), Python `qrcode` + Pillow (cartes QR)
    *   **Version fixée :** Node.js 24.18 ; `qrcode` et Pillow 12.3 (poste de l'équipe)
    *   **Lien CDN de référence :** Sans objet (outils locaux)
    *   **Rôle dans le projet :** Import des plans SUP'COM et d'OpenStreetMap ; génération des QR ; rien n'est chargé par l'application

---

## 3. Extraits de code copiés ou adaptés (StackOverflow, Tutoriels, Dépôts tiers)

L'usage de code tiers sans citation est un motif d'annulation de la note technique.

*   **Fonction / Fichier :** Aucun extrait de code tiers copié ou adapté dans `src/` ni `scripts/`
    *   **Source du code original :** Sans objet — les modules ont été écrits par l'équipe avec l'assistance IA déclarée en section 4, à partir de la documentation officielle
    *   **Auteur :** Équipe Indoor Wayfinder
    *   **Adaptation effectuée :** Aucune adaptation d'un extrait externe ; les algorithmes classiques (Dijkstra / tas binaire, Bresenham, Douglas–Peucker, distance de chanfrein 3-4, matrice de rotation Z-X'-Y'' de la spécification DeviceOrientation) ont été réimplémentés

Références techniques consultées :

| Sujet | Référence |
|---|---|
| WebXR `immersive-ar`, `hit-test`, ancres | https://immersiveweb.dev/ et spécification W3C WebXR Device API |
| Liaison WebXR / WebGPU (`XRGPUBinding`) | https://immersive-web.github.io/WebXR-WebGPU-Binding/ (Editor's Draft) ; https://chromestatus.com/feature/5077077997649920 |
| Three.js `WebGPURenderer` et `XRManager` | https://threejs.org/manual/en/webgpurenderer.html ; source r187 |
| WebGPU | https://www.w3.org/TR/webgpu/ |
| DeviceOrientation (cap absolu) | https://www.w3.org/TR/orientation-event/ |
| Geolocation | https://developer.mozilla.org/fr/docs/Web/API/Geolocation_API |
| ArcGIS REST (requête GeoJSON d'une couche) | https://developers.arcgis.com/rest/services-reference/enterprise/query-feature-service-layer/ |
| OpenStreetMap API / ODbL | https://wiki.openstreetmap.org/wiki/API_v0.6 ; https://www.openstreetmap.org/copyright |
| `getUserMedia` | https://developer.mozilla.org/fr/docs/Web/API/MediaDevices/getUserMedia |
| `BarcodeDetector` | https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector |
| jsQR | https://github.com/cozmo/jsQR |
| Dijkstra | Cours d'algorithmique / documentation algorithmique standard |

Si un extrait tiers est ajouté plus tard, il devra être consigné ici avec le fichier et les lignes, l'URL source, l'auteur, la licence et l'adaptation réalisée.

---

## 4. Déclaration de l'usage des Assistants IA (Copilot, ChatGPT, Claude)

L'utilisation d'IA est un outil de complétion. Elle doit être documentée et maîtrisée.

**Outils utilisés par l'équipe :** Claude (Anthropic), Antigravity, OMP (agent de codage). Aucun autre assistant IA n'est utilisé pour le code du dépôt à ce jour.

*   **Composant ou Shader concerné :** Shell PWA et design system (`index.html`)
    *   **Prompt ou usage principal :** Génération de la structure mobile-first, du système de design glassmorphism, des dialogues scanner/destination et des états d'accessibilité ; v3 : barre d'outils (étages, 3D/Plan, GPS, relevé), rose des vents, panneau de relevé
    *   **Axe de vérification appliqué par l'étudiant :** Relecture de l'équipe, rendu dans Chrome desktop/mobile (375 × 812), parcours clavier (Tab/Escape), contraste AA, validation du manifest

*   **Composant ou Shader concerné :** Scanner caméra et QR (`src/scanner.js`)
    *   **Prompt ou usage principal :** Implémentation de `getUserMedia`, de `BarcodeDetector`, du fallback jsQR, de la boucle de détection et de la libération caméra
    *   **Axe de vérification appliqué par l'étudiant :** Décodage des 15 QR SUP'COM par `scanImage` (jsQR), libération des pistes, test Android réel encore à faire

*   **Composant ou Shader concerné :** Analyse de SupNav et import du campus (`scripts/build-campus.mjs`, `assets/campus/supcom.json`, `assets/campus/corrections.json`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : analyse du bundle de https://supnav.supcom.tn (React + ArcGIS ; service `supws` en erreur 400, d'où « Error importing Data »), découverte de la couche publique ArcGIS des plans SUP'COM, décodage des types de traits (murs, portes, escaliers, ascenseurs, façade, poteaux), import, grille de circulation, détection des salles et connecteurs, corrections relevées
    *   **Axe de vérification appliqué par l'étudiant :** Rendus PNG de chaque étage comparés aux plans ; 4 amphithéâtres détectés à ≈ 310 m² chacun ; 233 salles ; 25 locaux sans porte sur le plan signalés « accès à confirmer » au lieu d'un passage inventé ; 13 tests Node

*   **Composant ou Shader concerné :** Routage multi-étages (`src/navigation.js` — `CampusMap`, `CampusRouter`, stratégies, étapes)
    *   **Prompt ou usage principal :** Claude (Anthropic) : Dijkstra sur la grille de tous les étages (tas binaire, heuristique A* optionnelle), arêtes verticales escaliers/ascenseurs, stratégies « plus court » / « sans escaliers », lissage, consignes en français avec caps (Nord, Sud-Ouest…), distances depuis un point en une passe
    *   **Axe de vérification appliqué par l'étudiant :** `node --test scripts/test-navigation.mjs` (13 tests) : toutes les paires de lieux officiels, tous les lieux depuis l'entrée, trajet vers l'étage 3, stratégie sans escaliers, cohérence des distances ; ≈ 70 ms par itinéraire

*   **Composant ou Shader concerné :** Migration WebGPU (`src/gpu.js`, `src/view3d.js`, `src/ar.js`, import map de `index.html`, `sw.js`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : passage de Three.js r160 à r187 (build WebGPU), `WebGPURenderer` pour la vue 3D et pour l'AR (fonctionnalité de session `webgpu`, `XRGPUBinding`), suppression de toute référence WebGL dans le code, ordre `setAnimationLoop` avant `setSession` exigé par r187
    *   **Axe de vérification appliqué par l'étudiant :** Chrome 152 : console « renderer WebGPU: true » ; simulateur WebXR avec `XRGPUBinding` adossé à de vraies textures GPU : session `webgpu` + `hit-test` démarrée, 280 images rendues, ancre posée, sortie propre ; recherche « webgl » vide dans `src/`, `index.html`, `sw.js` ; **validation sur le Samsung S23 (flag chrome://flags/#webxr-webgpu-binding) encore requise**

*   **Composant ou Shader concerné :** Boussole, flèche orientée et GPS (`src/geo.js`, `src/ar.js` — `#updateNorthOffset`, `#buildTrail`, `#routeBearingAt`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : cap de la caméra arrière à partir de la matrice de rotation DeviceOrientation, filtre circulaire, déclinaison magnétique de Tunis (+3,5°), décalage nord ↔ monde AR, chevrons de l'itinéraire réel au sol, GPS extérieur converti en coordonnées du campus
    *   **Axe de vérification appliqué par l'étudiant :** Tests unitaires du cap (téléphone debout nord/est, téléphone à plat) ; simulateur : flèche orientée à 208° = cap du couloir « Sud-Ouest » ; rose N/E/S/O et lecture « N 4° » ; **calibration sur site encore requise**

*   **Composant ou Shader concerné :** Guidage AR en temps réel (`src/ar-guidance.js`, `src/ar.js`, HUD dans `src/main.js` / `index.html`, `scripts/test-guidance.mjs`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : localisation continue pendant la session AR (départ QR + suivi ARCore + boussole), recalage par correspondance cartographique sur les murs et l'itinéraire (recherche globale de l'angle et de la translation, champs de distance), suivi des étages, consignes pas à pas, détection de sortie d'itinéraire et recalcul, chevrons au sol, flèches de virage, murs occultants invisibles, HUD et mini-carte
    *   **Axe de vérification appliqué par l'étudiant :** 12 marches simulées sur les vrais plans (angle AR inconnu, boussole faussée de ±15°) : erreur moyenne < 0,6 m, alignement à moins de 3°, arrivée détectée ; dans l'application (WebGPU + simulateur WebXR) : Entrée → Amphi Ibn Khaldoun 55 m, erreur moyenne 0,64 m, angle 40,2° pour 40° réel ; Entrée → A3-18 par l'escalier, étages 0→3 suivis, erreur max 1,3 m ; demi-tour et recalcul vérifiés ; **essai réel dans SUP'COM sur le S23 encore requis**

*   **Composant ou Shader concerné :** Mode relevé (`src/survey.js`, `src/main.js` — `handleSurveyPick`, `saveSurveyName`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : nommage des salles depuis le plan, passages manquants, annulation (patron Command), export `corrections.json` réinjecté par le script d'import
    *   **Axe de vérification appliqué par l'étudiant :** Touché sur l'amphithéâtre A0-35 → sélection correcte ; nom enregistré, retrouvé par la recherche, annulé ; export JSON

*   **Composant ou Shader concerné :** Corrections AR antérieures (`src/ar.js` — une requête par geste, choix de l'espace de référence, racine DOM overlay)
    *   **Prompt ou usage principal :** Claude (Anthropic) : diagnostic des erreurs relevées sur le Samsung S23 (« requires user activation », espace `local-floor` non demandé) et correctifs conservés dans la version WebGPU
    *   **Axe de vérification appliqué par l'étudiant :** Simulateur WebXR reproduisant mot pour mot l'erreur du téléphone, puis démarrage correct ; **validation sur le S23 encore requise**

*   **Composant ou Shader concerné :** PWA, offline et icônes (`sw.js`, `manifest.json`, `assets/icons/`)
    *   **Prompt ou usage principal :** Génération du Service Worker (cache du shell, des données du campus et du build Three.js WebGPU), du manifeste et des icônes
    *   **Axe de vérification appliqué par l'étudiant :** Cache `v3.0.0`, mise à jour d'une version précédente sans boucle de rechargement, vérification JSON du manifeste

*   **Composant ou Shader concerné :** Documentation (`README.md`, `docs/technical.md`, `docs/user-manual.md`, `docs/design-notebook.md`, `docs/qr-codes/`)
    *   **Prompt ou usage principal :** Rédaction et mise à jour de la documentation technique, du manuel utilisateur, du design notebook UML et du README
    *   **Axe de vérification appliqué par l'étudiant :** Relecture croisée avec le code, les tests et le cahier des charges ; liens vérifiés

---

*Ce fichier est mis à jour à chaque sprint et avant chaque commit introduisant une ressource externe. Une absence ou un fichier non mis à jour entraîne la note de suivi à zéro, conformément à la consigne du superviseur.*
