# Manuel utilisateur — Indoor Wayfinder

**Version :** 3.0.0
**Public :** visiteurs, étudiants, candidats, personnel de SUP'COM

## Ce dont vous avez besoin

- Un smartphone **Android** avec **Chrome** à jour.
- Pour la réalité augmentée : **Google Play Services for AR** et, tant que
  Chrome ne l'active pas par défaut, le réglage
  `chrome://flags/#webxr-webgpu-binding` sur **Enabled** (puis redémarrer Chrome).
- Le lien HTTPS de l'application. Rien à installer ; vous pouvez l'ajouter à
  l'écran d'accueil depuis le menu Chrome.

## Utilisation pas à pas

1. **Ouvrez le lien** dans Chrome. Le plan 3D de SUP'COM s'affiche.
2. **Indiquez où vous êtes :**
   - **SCANNER** → cadrez le QR code le plus proche ; ou
   - **DESTINATION** → champ **Départ** ; ou
   - touchez le plan à l'endroit où vous vous trouvez ; ou
   - dehors, **GPS** (précision affichée).
3. **DESTINATION** → cherchez un amphi, un service ou une salle (ex. `A1-07`).
   Toutes les salles des 4 niveaux sont listées avec leur distance.
4. Le panneau **Itinéraire** donne la distance, la durée, les changements
   d'étage et les consignes (« Marchez 22 m vers le Sud-Ouest », « Prenez
   l'escalier jusqu'à l'étage 3 »). Cochez **Sans escaliers** pour passer par
   les ascenseurs.
5. **Guidage AR** : tenez-vous à l'endroit du QR scanné, visez le sol. Des
   chevrons cyan montrent le début du trajet ; touchez le sol pour poser la
   flèche, orientée vers le couloir à prendre.
6. Au QR suivant, **Scanner** pour recaler la position ; l'itinéraire est
   recalculé. Le téléphone vibre à l'arrivée.
7. **Quitter AR** termine le guidage.

## Comprendre l'écran

| Élément | Signification |
|---|---|
| **RDC / 1 / 2 / 3 / Tous** | Étage affiché dans la vue 3D |
| **3D / Plan** | Vue orbite ou plan vu de dessus, nord en haut |
| Rose N / E / S / O | Boussole ; touchez-la pour l'activer, la lecture indique le cap (« NE 47° ») |
| **GPS** | Position à l'extérieur des bâtiments |
| **Relevé** | Mode équipe : nommer une salle, signaler une porte absente du plan |
| Ligne cyan + chevrons | Itinéraire ; trait vertical rouge = escalier, vert = ascenseur |
| Balise cyan | Destination |
| Pastille verte « Vous êtes ici » | Dernière position connue |
| Badge **AR : WebGPU prête / flag WebGPU-XR / non disponible** | État de la réalité augmentée |

## Bon à savoir

- À l'intérieur, la position vient des **QR codes** (le GPS n'est pas assez précis).
- La boussole peut être perturbée près de structures métalliques : faites un
  mouvement en **8** avec le téléphone pour la recalibrer.
- Les salles sans nom affichent leur code (`B2-05`) : le mode relevé permet de
  saisir le nom écrit sur la porte.
- « **Accès à confirmer** » : le plan ne montre pas de porte vers ce local ;
  l'itinéraire vous amène au point le plus proche.
- L'application fonctionne **hors ligne** après un premier chargement complet.

## En cas de problème

| Problème | Solution |
|---|---|
| La caméra ne s'ouvre pas | URL en HTTPS et autorisation caméra dans Chrome |
| « QR code inconnu » | Le QR n'appartient pas au plan de SUP'COM |
| Vue 3D absente | WebGPU requis : Chrome à jour (Android 12+) |
| « AR : flag WebGPU-XR » | Activez `chrome://flags/#webxr-webgpu-binding` et relancez Chrome |
| Message « touchez à nouveau Guidage AR » | Touchez encore une fois : la configuration simplifiée démarre |
| Flèche mal orientée | Recalibrez la boussole (8), rescannez un QR, reposez la flèche |
| Ancienne version affichée | Fermez l'onglet, rouvrez le lien (mise à jour automatique) |

## Confidentialité

Aucune donnée personnelle n'est collectée ni envoyée : position, cap et
relevés restent sur le téléphone. Il n'y a ni compte ni serveur applicatif.
