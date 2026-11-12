# 📄 Fichier d'Attribution et d'Origine des Ressources (ATTRIBUTION.md)

**Projet :** Indoor Wayfinder — Navigation intérieure en réalité augmentée
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed-Becha Kaâniche — INDP3-SIA 26-27
**Version :** 1.2 — Évaluation SUP'COM (2026/2027)
**Dernière mise à jour :** 12 novembre 2026

---

## 1. Modèles 3D, Textures et Assets Graphiques

Tout asset tri-dimensionnel ou visuel importé doit être consigné ci-dessous.

*   **Asset :** Cube de démonstration (`createCube()` dans `src/main.js`)
    *   **Source originale :** Aucune URL externe — géométrie générée par code avec Three.js (`BoxGeometry`, `EdgesGeometry`, `LineSegments`)
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet (projet académique SUP'COM)
    *   **Modifications apportées par l'équipe :** Objet créé pour la scène de démonstration ; matériau cyan et arêtes ajoutés par l'équipe

*   **Asset :** Flèche de navigation (`createArrow()` dans `src/main.js`)
    *   **Source originale :** Aucune URL externe — forme 2D (`THREE.Shape`) extrudée avec `ExtrudeGeometry`
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Flèche plate de 1 m, origine à la queue, pointe vers +Z, matériau non éclairé ; remplace l'ancienne flèche cylindre + cône

*   **Asset :** Halo au sol (`createGroundShadow()` dans `src/main.js`)
    *   **Source originale :** Aucune URL externe — texture générée à l'exécution sur un canvas 2D (dégradé radial)
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Dégradé cyan, opacité et échelle animées avec le cube

*   **Asset :** Maquette 3D de l'étage et de l'itinéraire (`src/view3d.js`)
    *   **Source originale :** Aucune URL externe — dalle, couloirs, salles, tube d'itinéraire, chevrons, balise de destination et marqueur de position générés par code avec Three.js (`BoxGeometry`, `TubeGeometry`, `ShapeGeometry`, `ConeGeometry`, `RingGeometry`, `Sprite`) à partir de `assets/building.json` ; étiquettes dessinées à l'exécution sur un canvas 2D
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Aucun modèle importé ; couleurs du design system, animation des chevrons le long du chemin Dijkstra, désactivée avec `prefers-reduced-motion`

*   **Asset :** Icônes PWA (`assets/icons/icon-180.png`, `icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`)
    *   **Source originale :** Aucune URL externe — générées par l'équipe avec Python/Pillow à partir du logo boussole du projet
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Variantes `any` et `maskable`, marges de sécurité, export PNG 180/192/512

*   **Asset :** Icônes SVG de l'interface (`index.html`)
    *   **Source originale :** Aucune URL externe — SVG inline dessinés par l'équipe (boussole, scanner, destination, recherche, fermeture, AR)
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Aucune bibliothèque d'icônes externe

*   **Asset :** Police de caractères
    *   **Source originale :** Pile de polices système : `system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`
    *   **Auteur / Créateur :** Fournisseurs des systèmes d'exploitation et navigateurs
    *   **Licence :** Licences système/navigateur ; aucune police web n'est redistribuée
    *   **Modifications apportées par l'équipe :** Aucune police téléchargée ni modifiée

*   **Asset :** QR codes de démonstration (`docs/qr-codes/*.png`, `docs/qr-codes/demo-sheet.png`, `docs/qr-codes/full-sheet.png`)
    *   **Source originale :** Aucune URL externe — images générées localement par l'équipe avec la bibliothèque Python `qrcode` et Pillow ; chaque QR encode l'identifiant d'un nœud de `assets/building.json`
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder
    *   **Licence :** Code du projet ; `qrcode` (licence BSD) et Pillow (licence HPND) ne sont utilisés qu'à la génération et ne sont pas redistribués avec l'application
    *   **Modifications apportées par l'équipe :** Une carte par nœud (12) avec nom et identifiant, planche 2 × 2 (parcours conseillé) et planche complète 3 × 4

*   **Asset :** Planche de QR codes de test (`docs/qr-codes.html`)
    *   **Source originale :** Page HTML de l'équipe ; images QR générées à la volée par l'API externe QuickChart — https://quickchart.io/qr
    *   **Auteur / Créateur :** Équipe Indoor Wayfinder pour la page ; service QuickChart pour le rendu QR
    *   **Licence :** Code de la page : projet ; service QuickChart : conditions d'utilisation du service externe
    *   **Modifications apportées par l'équipe :** Paramètres `text`, `size` et `margin` pour imprimer les identifiants de nœuds du plan

*   **Asset :** Modèle 3D de la flèche au format GLB
    *   **Source originale :** Aucun modèle GLB importé
    *   **Auteur / Créateur :** Sans objet
    *   **Licence :** Sans objet
    *   **Modifications apportées par l'équipe :** La flèche est générée par code ; cette entrée documente explicitement l'absence de ressource externe

---

## 2. Bibliothèques tierces et Modules externes (Pinnés)

Rappel : L'usage des versions "latest" depuis les CDN est proscrit.

*   **Bibliothèque :** Three.js
    *   **Version fixée :** 0.160.0 (r160)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
    *   **Rôle dans le projet :** Moteur de rendu 3D : scène, caméra, renderer, géométries, matériaux, boucle de rendu, intégration WebXR (`renderer.xr`) dans `src/main.js` et `src/ar.js`, et vue 3D de l'itinéraire dans `src/view3d.js`

*   **Bibliothèque :** Three.js addons (import map)
    *   **Version fixée :** 0.160.0 (r160)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
    *   **Rôle dans le projet :** Chemin d'import réservé aux modules complémentaires Three.js ; aucun addon externe n'est utilisé à ce jour

*   **Bibliothèque :** jsQR
    *   **Version fixée :** 1.4.0
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm
    *   **Rôle dans le projet :** Décodage des QR codes lorsque `BarcodeDetector` n'est pas disponible ; chargé dynamiquement dans `src/scanner.js`, mis en cache par `sw.js`

*   **Bibliothèque :** API natives du navigateur (aucune bibliothèque tierce)
    *   **Version fixée :** APIs standard du navigateur (pas de version CDN)
    *   **Lien CDN de référence :** Sans objet
    *   **Rôle dans le projet :** WebXR Device API (`immersive-ar`, hit test, ancres), `getUserMedia` (caméra arrière), `BarcodeDetector` (QR natif), Vibration API, Screen Wake Lock (Sprint 5), Service Worker/Cache API

---

## 3. Extraits de code copiés ou adaptés (StackOverflow, Tutoriels, Dépôts tiers)

L'usage de code tiers sans citation est un motif d'annulation de la note technique.

*   **Fonction / Fichier :** Aucun extrait de code tiers copié ou adapté dans `src/`
    *   **Source du code original :** Sans objet — les modules ont été écrits par l'équipe avec l'assistance IA déclarée en section 4, à partir de la documentation officielle
    *   **Auteur :** Équipe Indoor Wayfinder
    *   **Adaptation effectuée :** Aucune adaptation d'un extrait externe ; les références ci-dessous ont été consultées pour comprendre les APIs, pas copiées

Références techniques consultées :

| Sujet | Référence |
|---|---|
| WebXR `immersive-ar`, `hit-test`, ancres | https://immersiveweb.dev/ et spécification W3C WebXR Device API |
| Three.js WebXR | https://threejs.org/docs/#api/en/renderers/webxr/WebXRManager |
| Three.js `Shape` / `ExtrudeGeometry` | https://threejs.org/docs/ |
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
    *   **Prompt ou usage principal :** Génération de la structure mobile-first, du système de design glassmorphism, des dialogues scanner/destination et des états d'accessibilité
    *   **Axe de vérification appliqué par l'étudiant :** Relecture de l'équipe, rendu dans Chrome desktop/mobile, parcours clavier (Tab/Escape), contraste AA, captures d'écran, validation du manifest

*   **Composant ou Shader concerné :** Scène Three.js (`src/main.js` — `createScene`, `createCamera`, `createRenderer`, `createCube`, `createGroundShadow`, `startAnimationLoop`)
    *   **Prompt ou usage principal :** Génération de la scène de démonstration, du cube à arêtes, de la grille, du brouillard, du halo et de la boucle de rendu
    *   **Axe de vérification appliqué par l'étudiant :** Console `Three.js r160`, captures, test `prefers-reduced-motion`, redimensionnement/orientation, fallback WebGL, relecture du code

*   **Composant ou Shader concerné :** Scanner caméra et QR (`src/scanner.js`)
    *   **Prompt ou usage principal :** Implémentation de `getUserMedia`, de `BarcodeDetector`, du fallback jsQR, de la boucle de détection et de la libération caméra
    *   **Axe de vérification appliqué par l'étudiant :** Test avec caméra simulée sur le QR `ENTREE`, vérification de la libération des pistes, test de fermeture pendant la permission, `node --check`, test Android réel encore à faire

*   **Composant ou Shader concerné :** Graphe et routage (`src/navigation.js`, `assets/building.json`)
    *   **Prompt ou usage principal :** Génération de la liste d'adjacence, de Dijkstra, des stratégies et des helpers de distance/direction
    *   **Axe de vérification appliqué par l'étudiant :** 9 tests Node (`node --test scripts/test-navigation.mjs`) : nœuds, arêtes, poids, chemins `ENTREE → SALLE_B12` (26 m) et `ENTREE → AMPHI_A` (54 m), accessibilité de tous les nœuds

*   **Composant ou Shader concerné :** Destinations et itinéraire UI (`src/main.js` — `renderDestinationList`, `updateRouteForCurrentDestination`, `selectDestination`)
    *   **Prompt ou usage principal :** Remplacement des fausses distances par les données du graphe, génération des cartes de destination, panneau d'itinéraire et recalcul après scan
    *   **Axe de vérification appliqué par l'étudiant :** Test de bout en bout avec caméra simulée : QR `ENTREE` → 9 destinations → Salle B12 26 m / 3 étapes → Amphi A 54 m / 5 étapes ; contrôle des identifiants de nœuds et de `aria-pressed`

*   **Composant ou Shader concerné :** Guidage AR (`src/ar.js`, intégration dans `src/main.js`)
    *   **Prompt ou usage principal :** Implémentation de la session `immersive-ar`, de `hit-test`, du réticule au sol, de `XRAnchor`, de la flèche et du nettoyage de session
    *   **Axe de vérification appliqué par l'étudiant :** `node --check`, chargement de la page sans erreur, test du chemin « AR non supportée », revue du cycle de session et des ressources ; **test physique Android/ARCore encore requis**

*   **Composant ou Shader concerné :** Vue 3D de l'itinéraire (`src/view3d.js`, bascule 2D/3D dans `src/main.js` et `index.html`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : génération de la maquette 3D de l'étage depuis le graphe, du tube d'itinéraire animé, de la balise de destination, des contrôles tactiles (rotation, pincement, sélection par raycast) et du repli « Voir en 3D » quand `immersive-ar` n'est pas disponible
    *   **Axe de vérification appliqué par l'étudiant :** Navigateur mobile 375 × 812 : `ENTREE → SALLE_B12` = 26 m / 3 étapes affiché en 3D ; touche sur la salle B15 = position B15 ; `B15 → LAB_INFO` = 54 m / 5 étapes ; rotation par glisser ; bascule 2D/3D ; repli AR → 3D ; **test physique Android encore requis**

*   **Composant ou Shader concerné :** Départ et arrivée quelconques (`src/main.js` — `renderStartOptions`, `getOrderedNodes`, liste de destinations ; sélecteur **Départ** dans `index.html`), QR des 12 nœuds, test de toutes les paires (`scripts/test-navigation.mjs`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : choix manuel du point de départ, destinations générées depuis tous les nœuds du graphe, génération des 8 QR manquants et de la planche complète, test Node des 144 paires départ/arrivée
    *   **Axe de vérification appliqué par l'étudiant :** Parcours UI automatisé des 144 paires (sélecteur Départ → liste → itinéraire) : distance et nombre d'étapes identiques à Dijkstra, bouton AR désactivé si départ = arrivée, aucune erreur console ; les 12 QR décodés par `scanImage` (jsQR) de l'application ; 11/11 tests Node

*   **Composant ou Shader concerné :** Correctif du démarrage AR (`src/ar.js` — `#requestSession`, `#pickReferenceSpaceType` ; `src/main.js` — `startARGuide`, `describeArError`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : diagnostic de l'échec de « Guidage AR » sur Android (espace de référence `local-floor` non demandé, plantage du gestionnaire de fin de session Three.js, racine DOM overlay = `body`), correctif et messages d'erreur explicites
    *   **Axe de vérification appliqué par l'étudiant :** Lecture du code de `WebXRManager.setSession` de Three.js r160 ; simulateur WebXR (session `immersive-ar` factice imposant le geste utilisateur et les espaces de référence) : ancien code = bannière d'erreur reproduite, nouveau code = session démarrée, hit test, ancre au toucher, « Quitter AR » sans placement, repli `local` quand `local-floor` est refusé, refus de permission = message clair ; **validation sur le Samsung S23 encore requise**

*   **Composant ou Shader concerné :** Correctif « requires user activation » (`src/ar.js` — `start`, `#sessionOptions`, `isUserActivationError` ; `src/main.js` — `startARGuide`)
    *   **Prompt ou usage principal :** Claude (Anthropic) : analyse du message d'erreur relevé sur le Samsung S23 (nouvel essai `requestSession` dans le même geste), une seule requête par geste, mode simplifié au geste suivant, cause réelle affichée
    *   **Axe de vérification appliqué par l'étudiant :** Simulateur WebXR consommant l'activation utilisateur comme Chrome : version v2.3.1 = message d'erreur du téléphone reproduit mot pour mot ; version corrigée = 1er toucher affiche la cause, 2e toucher démarre l'AR (hit test, ancre, sortie) ; configuration complète acceptée = AR au 1er toucher ; **validation sur le S23 encore requise**

*   **Composant ou Shader concerné :** PWA, offline et icônes (`sw.js`, `manifest.json`, `assets/icons/`)
    *   **Prompt ou usage principal :** Génération du Service Worker (cache du shell, navigation network-first, assets cache-first), du manifeste et des icônes
    *   **Axe de vérification appliqué par l'étudiant :** Rechargement hors ligne après contrôle du SW, cache `v2.1.0`, vérification JSON du manifeste, requêtes d'icônes 200, contrôle des tailles 192/512

*   **Composant ou Shader concerné :** Documentation (`README.md`, `docs/technical.md`, `docs/user-manual.md`, `docs/design-notebook.md`)
    *   **Prompt ou usage principal :** Rédaction et mise à jour de la documentation technique, du manuel utilisateur, du design notebook UML et du README
    *   **Axe de vérification appliqué par l'étudiant :** Relecture croisée avec le code, les tests et le cahier des charges ; liens vérifiés ; captures d'écran recapturées après les changements

---

*Ce fichier est mis à jour à chaque sprint et avant chaque commit introduisant une ressource externe. Une absence ou un fichier non mis à jour entraîne la note de suivi à zéro, conformément à la consigne du superviseur.*
