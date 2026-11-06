# 📄 Fichier d'Attribution et d'Origine des Ressources (ATTRIBUTION.md)

**Projet :** Indoor Wayfinder – Navigation en réalité augmentée dans un bâtiment
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed Bécha Kaaniche
**Version :** 1.0 — Évaluation SUP'COM (2026/2027)
**Dernière mise à jour :** 6 novembre 2026

---

## 1. Modèles 3D, Textures et Assets Graphiques

Aucun modèle 3D, texture ou image externe n'est importé à ce jour. Tous les éléments visuels actuels sont générés par code.

*   **Asset :** Cube de démonstration (`createCube()` dans `src/main.js`)
    *   **Source originale :** Généré par code (`BoxGeometry` + `EdgesGeometry` de Three.js)
    *   **Auteur / Créateur :** L'équipe
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Sans objet (création originale)

*   **Asset :** Flèche de navigation (`createArrow()` dans `src/main.js`)
    *   **Source originale :** Générée par code (cylindre + cône)
    *   **Auteur / Créateur :** L'équipe
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Sans objet (création originale)

*   **Asset :** Halo d'ombre au sol (`createGroundShadow()` dans `src/main.js`)
    *   **Source originale :** Texture dessinée dynamiquement sur un canvas 2D (dégradé radial)
    *   **Auteur / Créateur :** L'équipe
    *   **Licence :** Code du projet
    *   **Modifications apportées par l'équipe :** Sans objet (création originale)

*   **Asset :** Icônes de l'interface (logo boussole, icônes SVG)
    *   **Source originale :** À COMPLÉTER (SVG écrits par l'équipe ou issus d'une bibliothèque d'icônes ?)
    *   **Licence :** À COMPLÉTER

*   **Asset :** Police de caractères
    *   **Source originale :** À COMPLÉTER (police système ou police web ?)
    *   **Licence :** À COMPLÉTER

*   **Asset :** Modèle 3D de la flèche au format GLB (uniquement si ajouté dans `/assets`)
    *   **Source originale / Auteur / Licence :** À COMPLÉTER, ou supprimer cette entrée s'il n'y en a pas

---

## 2. Bibliothèques tierces et Modules externes (Pinnés)

Rappel : aucune version « latest » n'est utilisée.

*   **Bibliothèque :** Three.js
    *   **Version fixée :** r160 (0.160.0)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
    *   **Addons (import map) :** https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/
    *   **Licence :** MIT
    *   **Rôle dans le projet :** Moteur de rendu 3D (scène, caméra, lumières, flèche) et intégration WebXR (semaine 4)

*   **Bibliothèque :** jsQR (solution de secours si `BarcodeDetector` est absent)
    *   **Version fixée :** 1.4.0 (à confirmer avec la version réellement utilisée)
    *   **Lien CDN de référence :** https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js
    *   **Licence :** Apache-2.0
    *   **Rôle dans le projet :** Décodage des QR codes lorsque l'API native n'est pas disponible
    *   **Statut :** à activer dans ce fichier dès l'intégration dans `scanner.js`

*   **APIs natives du navigateur (aucune bibliothèque) :** WebXR Device API, `getUserMedia`, `BarcodeDetector`, Vibration API, Screen Wake Lock, Service Worker

---

## 3. Extraits de code copiés ou adaptés (StackOverflow, Tutoriels, Dépôts tiers)

À COMPLÉTER. Si tout le code a été écrit par l'équipe ou avec l'aide des assistants IA déclarés en section 4, écrire : « Aucun extrait tiers copié depuis StackOverflow, un tutoriel ou un dépôt externe ».

Sinon, une entrée par extrait :

*   **Fonction / Fichier :** [ex. `src/main.js` (lignes X à Y)]
    *   **Source du code original :** [URL]
    *   **Auteur :** [Nom du contributeur]
    *   **Adaptation effectuée :** [Description]

Sources à vérifier au fil des semaines : tutoriels WebXR (hit-test, immersive-ar), exemples officiels Three.js, documentation MDN pour `BarcodeDetector` et `getUserMedia`.

---

## 4. Déclaration de l'usage des Assistants IA (Copilot, ChatGPT, Claude)

**Outils utilisés :**
*   **Claude** (Anthropic) : assistant conversationnel, utilisé pour l'analyse, l'explication et la planification.
*   **Antigravity** : agent de codage, utilisé pour implémenter le code dans le dépôt à partir de prompts structurés.

L'IA est utilisée comme outil de complétion et d'accélération. Les choix d'architecture suivent le cahier des charges v1.0 (24 octobre 2026), et chaque production de l'IA est relue et testée par l'équipe avant d'être commitée.