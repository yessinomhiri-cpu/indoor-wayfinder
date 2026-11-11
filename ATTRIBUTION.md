# Attribution et origine des ressources

**Projet :** Indoor Wayfinder — Navigation intérieure en réalité augmentée
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed-Becha Kaâniche
**Cours :** INDP3-SIA 26-27 — Projets Réalité Étendue
**Dernière mise à jour :** 11 novembre 2026
**Responsable du fichier :** Oussema Harrabi

> Ce fichier est mis à jour à chaque sprint et à chaque ajout de ressource externe.
> Il couvre les assets, les bibliothèques, les extraits de code et l'usage des assistants IA.

## Journal des mises à jour

| Date | Version | Auteur | Changement |
|---|---|---|---|
| 2026-11-06 | 1.0 | Yassine Mhiri | Création initiale (Sprint 2) |
| 2026-11-11 | 1.1 | Oussema Harrabi | Audit complet, ressources et outils IA documentés, sections « À COMPLÉTER » supprimées |

---

## 1. Assets graphiques, icônes et polices

### Cube de démonstration — `createCube()`

- **Fichier :** `src/main.js`
- **Origine :** créé par l'équipe avec Three.js (`BoxGeometry`, `EdgesGeometry`, `LineSegments`)
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code du projet
- **Modifications :** aucune ressource externe ; géométrie et matériaux paramétrés dans le code

### Flèche de navigation — `createArrow()`

- **Fichier :** `src/main.js`
- **Origine :** créée par l'équipe. Forme 2D (`THREE.Shape`) extrudée avec `ExtrudeGeometry`, posée à plat sur le sol, orientée vers +Z.
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code du projet
- **Modifications :** remplace l'ancienne flèche cylindre + cône ; aucune texture ni modèle GLB externe

### Halo au sol — `createGroundShadow()`

- **Fichier :** `src/main.js`
- **Origine :** texture générée à l'exécution sur un canvas 2D (dégradé radial)
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code du projet
- **Modifications :** aucune image externe

### Icônes de la PWA — `assets/icons/`

- **Fichiers :** `icon-180.png`, `icon-192.png`, `icon-512.png`, `maskable-192.png`, `maskable-512.png`
- **Origine :** générées par l'équipe avec Python/Pillow à partir du logo boussole du projet
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code du projet
- **Modifications :** variantes `any` et `maskable` avec marges de sécurité

### Icônes SVG de l'interface

- **Fichiers :** `index.html` (SVG inline : boussole, scanner, destination, recherche, fermeture)
- **Origine :** dessinées par l'équipe pour ce projet
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code du projet
- **Modifications :** aucune bibliothèque d'icônes externe

### Police de caractères

- **Origine :** pile de polices système (`system-ui`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Roboto`, `Helvetica`, `Arial`)
- **Licence :** polices fournies par le système d'exploitation / le navigateur
- **Modifications :** aucune police web téléchargée

### Planche de QR codes de test — `docs/qr-codes.html`

- **Origine :** page HTML de l'équipe ; les images QR sont générées à la volée par l'API externe **QuickChart** (`https://quickchart.io/qr`)
- **Auteur :** équipe Indoor Wayfinder
- **Licence :** code de la page : projet ; service QuickChart : service externe gratuit, soumis à ses propres conditions
- **Remarque :** cette page est un outil de test, pas une ressource embarquée dans l'application. Pour une utilisation hors ligne, les QR peuvent être générés localement avec `qrencode` ou Python `qrcode` (voir `docs/technical.md`).

### Modèle 3D de la flèche au format GLB

- **Statut :** aucun modèle GLB n'est utilisé. La flèche est générée par code. Cette entrée est conservée pour documenter l'absence de ressource externe.

---

## 2. Bibliothèques et modules externes

Toutes les versions sont figées ; aucune dépendance `latest` n'est utilisée.

### Three.js

- **Version :** 0.160.0 (r160)
- **URL :** https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
- **Addons :** https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
- **Licence :** MIT
- **Rôle :** scène, caméra, renderer, géométries, matériaux, boucle de rendu, intégration WebXR (`renderer.xr`)
- **Fichiers :** `index.html` (import map), `src/main.js`, `src/ar.js`

### jsQR

- **Version :** 1.4.0
- **URL :** https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm
- **Licence :** Apache-2.0
- **Rôle :** décodage des QR codes lorsque `BarcodeDetector` n'est pas disponible
- **Statut :** actif dans `src/scanner.js` (solution de secours), chargé dynamiquement
- **Fichiers :** `index.html` (import map), `src/scanner.js`, `sw.js` (cache)

### APIs natives du navigateur

Aucune bibliothèque externe supplémentaire :

- **WebXR Device API** — session `immersive-ar`, hit testing, ancres
- **`getUserMedia`** — flux caméra arrière
- **`BarcodeDetector`** — décodage natif des QR codes (Chrome Android)
- **Vibration API** — retour haptique à la détection
- **Screen Wake Lock** — écran maintenu allumé pendant le guidage (Sprint 5)
- **Service Worker / Cache API** — fonctionnement hors ligne

---

## 3. Extraits de code copiés ou adaptés

**Constat au 11 novembre 2026 :** aucun extrait de code tiers n'a été copié tel quel dans les modules `src/`. Les implémentations ont été écrites par l'équipe avec l'assistance IA déclarée en section 4, à partir de la documentation officielle et des spécifications.

Références techniques consultées :

| Sujet | Référence |
|---|---|
| WebXR `immersive-ar`, `hit-test`, ancres | https://immersiveweb.dev/ et spécification W3C WebXR Device API |
| Three.js WebXR | https://threejs.org/docs/#api/en/renderers/webxr/WebXRManager |
| Three.js `ExtrudeGeometry`, `Shape` | https://threejs.org/docs/ |
| `getUserMedia` | https://developer.mozilla.org/fr/docs/Web/API/MediaDevices/getUserMedia |
| `BarcodeDetector` | https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector |
| jsQR | https://github.com/cozmo/jsQR |
| Dijkstra | cours d'algorithmique / documentation algorithmique standard |

Si un extrait tiers est ajouté plus tard, il devra être ajouté ici avec :

- le fichier et les lignes concernées,
- l'URL source,
- l'auteur,
- la licence,
- l'adaptation réalisée.

---

## 4. Déclaration de l'usage des assistants IA

L'IA est utilisée comme outil d'assistance. Les choix d'architecture suivent le cahier des charges v1.0 (24 octobre 2026). Chaque production est relue, testée et validée par un membre de l'équipe avant d'être commitée.

| Outil | Usage | Période | Validation |
|---|---|---|---|
| **Claude** (Anthropic) | analyse du cahier des charges, explication, planification, revue | novembre 2026 | relecture équipe |
| **Antigravity** | assistance à l'implémentation du Sprint 1 / Sprint 2 | novembre 2026 | relecture équipe |
| **OMP** (agent de codage) | audit du Sprint 1, corrections accessibilité/PWA, documentation, intégration Sprint 3–4 | 5 et 11 novembre 2026 | relecture équipe, tests navigateur/Node |

Aucun autre assistant IA n'est utilisé pour le code du dépôt à ce jour. Cette liste doit être mise à jour si un nouvel outil est employé.

---

## 5. Licences et conformité

- **Code du projet :** projet académique SUP'COM — INDP3-SIA 26-27. Le code est produit par l'équipe pour ce projet.
- **Three.js :** MIT — conserver la notice de licence lors d'une redistribution.
- **jsQR :** Apache-2.0 — conserver la notice de licence lors d'une redistribution.
- **QuickChart :** service externe utilisé uniquement par la planche de QR de test ; aucune image n'est revendiquée comme asset du projet.
- **Polices :** polices système, aucune redistribution.
- **Assets 3D / textures / icônes :** créés par l'équipe ou générés par code, sauf mention contraire.

---

## 6. Règle de maintenance

1. Toute nouvelle bibliothèque, image, police, modèle 3D, service externe ou extrait de code doit être ajouté ici **avant** le commit qui l'introduit.
2. Le journal des mises à jour doit être complété à chaque sprint.
3. Le fichier doit être présent à la racine du dépôt sous le nom exact `ATTRIBUTION.md`.
4. Une absence ou un fichier non mis à jour entraîne la note de suivi à zéro, conformément à la consigne du superviseur.
