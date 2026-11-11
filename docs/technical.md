# Documentation technique — Indoor Wayfinder

**Version :** 2.2.0 — Sprint 3/4
**Équipe :** Yassine Mhiri, Oussema Harrabi, Amin Jarbaoui
**Superviseur :** Mohamed-Becha Kaâniche — INDP3-SIA 26-27

## 1. Objet

Indoor Wayfinder est une PWA de navigation intérieure en réalité augmentée.
L'utilisateur scanne un QR code, choisit une destination, obtient un itinéraire
calculé par Dijkstra, puis suit une flèche 3D ancrée au sol via WebXR.

Aucun serveur applicatif : GitHub Pages sert les fichiers statiques, Three.js
et jsQR sont chargés depuis jsDelivr avec des versions figées.

## 2. Pile technique

| Couche | Technologie | Rôle |
|---|---|---|
| Interface | HTML/CSS/ES modules | Shell mobile, panneaux, accessibilité |
| 3D | Three.js 0.160.0 (r160) | Scène, renderer, flèche, intégration XR |
| AR | WebXR `immersive-ar` | Session, hit test, `XRAnchor` |
| Caméra | `getUserMedia` | Flux arrière pour les QR |
| QR | `BarcodeDetector` + jsQR 1.4.0 | Décodage natif ou secours |
| Graphe | `assets/building.json` | Nœuds, arêtes, distances |
| Routage | Dijkstra | Plus court chemin |
| Hors ligne | Service Worker | Cache du shell, des modules et du plan |
| Hébergement | GitHub Pages | HTTPS obligatoire |

## 3. Arborescence

```text
index.html              UI, import map Three.js + jsQR
manifest.json           métadonnées PWA
sw.js                   cache hors ligne
src/main.js             contrôleur, UI, routage, intégration AR
src/scanner.js          caméra + décodage QR
src/navigation.js       graphe + Dijkstra + stratégies
src/ar.js               session immersive-ar + hit test + flèche
assets/building.json    plan du bâtiment
assets/icons/           icônes PWA
docs/                   documentation, planche QR, captures
scripts/                tests Node du graphe
ATTRIBUTION.md          ressources et outils IA
```

## 4. Graphe du bâtiment

Le plan est un graphe pondéré non orienté, stocké en JSON :

```json
{
  "building": { "name": "SUP'COM – Bâtiment A", "floor": "Rez-de-chaussée" },
  "nodes": {
    "ENTREE": { "name": "Entrée principale", "x": 0, "y": 0 },
    "SALLE_B12": { "name": "Salle B12", "x": 20, "y": -6 }
  },
  "edges": [
    { "from": "ENTREE", "to": "HALL", "weight": 10 }
  ]
}
```

Règles :

- `x`, `y` sont exprimés en mètres dans le repère du bâtiment.
- `weight` est la distance de marche en mètres.
- Chaque arête est stockée dans les deux sens par `BuildingGraph`.
- Les identifiants de nœuds sont les payloads des QR codes.
- Le graphe v1 couvre un seul étage.

Test de cohérence :

```bash
node --test scripts/test-navigation.mjs
```

Les tests vérifient les nœuds, les arêtes, les poids, l'accessibilité depuis
l'entrée et les itinéraires de référence.

### 4.1 Vue plan interactif

`src/main.js` lit `getAllNodes()` / `getEdges()` et dessine le graphe en SVG.
Le chemin Dijkstra est surligné en cyan. Un clic sur un nœud appelle
`setCurrentNode()` : c'est un mode démonstration explicite, équivalent à un
scan QR, pour permettre une démonstration sur ordinateur sans caméra.

## 5. QR codes

Chaque QR encode **l'identifiant exact d'un nœud**, par exemple `ENTREE`,
`HALL`, `SALLE_B12`. Le scanner normalise la valeur en majuscules.
Sur ordinateur, le bouton **Importer une image QR** décode un fichier image
avec le même backend (`BarcodeDetector` ou jsQR).

Génération locale :

```bash
# Option 1 — qrencode
qrencode -o SALLE_B12.png -s 8 -m 2 "SALLE_B12"

# Option 2 — Python
python - <<'PY'
import qrcode
qrcode.make('SALLE_B12').save('SALLE_B12.png')
PY
```

La planche `docs/qr-codes.html` regroupe les codes de test. Elle utilise
actuellement l'API QuickChart pour dessiner les QR. Des PNG prêts à l'emploi
sont aussi disponibles dans `docs/qr-codes/` (`entree.png`, `hall.png`,
`couloir-est.png`, `salle-b12.png`, `demo-sheet.png`) avec la séquence de
démonstration dans `docs/qr-codes/README.md`.

Impression : une étiquette par nœud, hauteur constante, dans le couloir.
La position est mise à jour uniquement quand un QR est scanné.

## 6. Routage

`BuildingGraph.loadGraph(url)` charge le JSON, construit la liste d'adjacence,
puis `findShortestPath(fromId, toId)` exécute Dijkstra. `getPathDistance()`
somme les poids ; `getDirectionVector()` fournit la direction normalisée
utilisée pour orienter la flèche.

`AvoidStairsStrategy` existe comme point d'extension pour le multi-étages ;
en v1, il délègue à Dijkstra car le graphe ne contient pas d'escalier.

## 7. Scan caméra

`QrScanner.start(video, canvas)` :

1. attend la détection du backend (`BarcodeDetector` ou jsQR) ;
2. demande la caméra arrière avec `getUserMedia` ;
3. décode au maximum une frame toutes les 150 ms ;
4. applique un cooldown de 2 s par valeur ;
5. diffuse le résultat via `onDetect`.

Le scanner s'arrête et libère les pistes caméra à la fermeture. Un jeton de
génération annule un démarrage si l'utilisateur ferme l'overlay pendant la
demande de permission.

## 8. Réalité augmentée

`ARGuide.start(route)` :

1. vérifie `navigator.xr.isSessionSupported('immersive-ar')` ;
2. demande une session avec `hit-test` (et `anchors` / `dom-overlay` si disponible) ;
3. active `renderer.xr` et l'espace `local-floor` ;
4. masque le cube, la grille et le halo de démonstration ;
5. affiche un réticule à l'intersection détectée avec le sol ;
6. sur `select`, place la flèche et crée un `XRAnchor` ;
7. restaure la scène à la fin de la session.

La page d'accueil est le plan SVG. `setARView(true)` masque le plan et affiche
le canvas Three.js avant la session ; `setARView(false)` restaure le plan à la
fin. Le cube de démonstration est masqué hors AR.

La flèche est générée par `createArrow()` : forme extrudée plate de 1 m,
origine à la queue, pointe vers +Z, matériau non éclairé.

**Limite v2.2.0 :** l'orientation utilise la direction de la caméra au moment
du placement. La calibration au nord du bâtiment (orientation du QR ou
boussole) est prévue au Sprint 5.

## 9. HTTPS et déploiement

`getUserMedia`, WebXR et le Service Worker exigent un contexte sécurisé.

- Local : `http://localhost:8000` est accepté.
- Téléphone : utiliser GitHub Pages ou un tunnel HTTPS ; une IP LAN en HTTP
  est refusée par Chrome.
- GitHub Pages : Settings → Pages → Deploy from branch → `main` / root.

## 10. Vérifications

```bash
# Tests du graphe
node --test scripts/test-navigation.mjs

# Serveur local
python -m http.server 8000
```

Vérifications manuelles :

- QR `ENTREE` scanné → pastille « Vous êtes ici : Entrée principale » ;
- destination Salle B12 → itinéraire 26 m en 3 étapes ;
- bouton Guidage AR → session si WebXR/ARCore est disponible, sinon message ;
- mode avion après un premier chargement → le shell et Three.js démarrent ;
- plan : 12 nœuds, 12 arêtes, 9 libellés, clic `ENTREE` → `SALLE_B12` = 26 m ;
- upload QR sur ordinateur → même position et même itinéraire.

## 11. Limites connues

- Un seul étage.
- Position discrète (QR uniquement), pas de suivi continu.
- Orientation AR non calibrée sur le nord du bâtiment.
- Test Android/ARCore encore à documenter.
- Pages non activé à la date de rédaction.
