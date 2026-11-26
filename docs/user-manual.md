# Manuel utilisateur — Indoor Wayfinder

**Version :** 3.7.0
**Public :** visiteurs, étudiants, candidats, personnel de SUP'COM

## Ce dont vous avez besoin

- Un smartphone **Android** avec **Chrome** à jour.
- Pour la réalité augmentée : **Google Play Services for AR** et, tant que
  Chrome ne l'active pas par défaut, le réglage
  `chrome://flags/#webxr-webgpu-binding` sur **Enabled** (puis redémarrer Chrome).
- Le lien HTTPS de l'application. Rien à installer ; vous pouvez l'ajouter à
  l'écran d'accueil depuis le menu Chrome.

**Vérifier son téléphone :** touchez le badge **AR : …** en haut de
l'application. La page *Diagnostic AR WebGPU* liste ce qui manque et comment
le corriger, puis propose un test AR de 20 s (l'écran se teinte en vert quand
le sol est détecté). Procédure complète pour l'équipe :
[demo-phone-setup.md](demo-phone-setup.md).

## Utilisation pas à pas

La barre **① Scanner → ② Destination → ③ Guidage** en bas de l'écran montre
où vous en êtes (✓ = fait) ; touchez une étape pour l'ouvrir.

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
5. **Démarrer le guidage** : l'application choisit le mode (pastille **AR**
   ou **CAMÉRA** sur le bouton). La carte en haut de l'écran montre l'icône
   du prochain virage, la distance en grand, l'action (« Tournez à gauche »),
   une barre de progression et les mètres restants. Une **voix** annonce les
   virages (« Dans 10 mètres, tournez à gauche ») et le téléphone vibre au
   moment de tourner ; le bouton 🔊/🔇 coupe la voix.

   **Mode AR** : tenez-vous à l'endroit du QR scanné et tenez le téléphone
   devant vous, caméra vers le couloir. Marchez normalement :
   - une **grande flèche bleue** flotte devant vous, à hauteur de poitrine :
     elle vous suit et pointe toujours vers le chemin à prendre. Elle est
     **grise** tant que la position se calibre (marchez quelques mètres),
     **orange** si vous sortez du trajet, **verte** à l'arrivée ;
   - des **chevrons cyan** sur le sol montrent les 25 m suivants et avancent
     avec vous ; de **grandes flèches** marquent les virages ;
   - le **bandeau** en haut donne la consigne (« Dans 6 m, tournez à gauche »)
     et une flèche qui tourne quand vous tournez ; dessous : distance restante,
     étage et pièce où vous êtes ;
   - la **mini-carte** en bas montre les vrais murs autour de vous ;
   - la position s'affine d'elle-même après quelques mètres (« calée sur les
     murs »). Si les chevrons semblent décalés : **Aligner sur le trajet**
     (face au trajet de la mini-carte) ou **Je suis à…** (choisir le lieu où
     vous êtes) ;
   - dans l'escalier, l'étage change tout seul ; après un ascenseur, touchez
     **Je suis sorti de l'ascenseur** ;
   - si vous vous trompez de chemin, l'itinéraire est **recalculé** ;
   - touchez le sol pour poser une flèche ancrée (optionnel). Si le sol n'est
     pas détecté après 3 s (sol brillant, uni ou sombre), le bandeau indique
     « sol estimé » : le guidage reste affiché et un toucher pose la flèche à
     1,5 m devant vous.
   **Mode Caméra (sans AR)** : si l'AR n'est pas disponible, touchez
   **Caméra** dans le panneau Itinéraire. La caméra s'ouvre comme pour une
   photo et une grande flèche bleue s'affiche sur l'image :
   - tenez le téléphone droit devant vous ; la flèche pointe vers le chemin
     (la boussole la fait tourner quand vous tournez) ;
   - marchez normalement : chaque pas vous fait avancer sur l'itinéraire ;
   - au pied de l'escalier ou de l'ascenseur, touchez **Je suis à l'étage N**
     une fois arrivé ;
   - **Rescanner** au QR suivant pour corriger la position (la caméra se
     rouvre toute seule), **Quitter** pour revenir au plan.
6. Au QR suivant, **Scanner** pour recaler la position ; l'itinéraire est
   recalculé. Le téléphone vibre à l'arrivée.
7. **Quitter AR** termine le guidage.

## Comprendre l'écran

| Élément | Signification |
|---|---|
| **RDC / 1 / 2 / 3 / Tous** | Étage affiché dans la vue 3D |
| **3D / Campus / Plan** | Vue orbite de l'intérieur ; **Campus** : maquette extérieure de SUP'COM en plein jour (tours, aile vitrée, arche d'entrée, drapeaux, parvis) — toucher un étage, un lieu ou lancer un itinéraire revient à la vue 3D ; plan vu de dessus, nord en haut |
| Rose N / E / S / O | Boussole ; touchez-la pour l'activer, la lecture indique le cap (« NE 47° ») |
| **GPS** | Position à l'extérieur des bâtiments |
| **Relevé** | Mode équipe : nommer une salle, signaler une porte absente du plan |
| Ligne cyan + chevrons | Itinéraire ; trait vertical rouge = escalier, vert = ascenseur |
| Balise cyan | Destination |
| Pastille verte « Vous êtes ici » | Dernière position connue |
| Badge **AR : WebGPU prête / flag WebGPU-XR / non disponible** | État de la réalité augmentée ; touchez-le pour le diagnostic |

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
| La caméra ne s'ouvre pas | Le scanner affiche la cause et la solution (caméra bloquée : cadenas 🔒 → Autorisations → Caméra ; caméra occupée : fermer l'autre application), puis **Réessayer**. Sinon **Importer une image QR** ou **Choisir mon départ** |
| « QR code inconnu » | Le QR n'appartient pas au plan de SUP'COM |
| Vue 3D absente | WebGPU requis : Chrome à jour (Android 12+) |
| « AR : flag WebGPU-XR » | Activez `chrome://flags/#webxr-webgpu-binding` et relancez Chrome |
| AR indisponible, cause inconnue | Touchez le badge AR : le diagnostic indique le maillon manquant |
| Message « touchez à nouveau Guidage AR » | Touchez encore une fois : la configuration simplifiée démarre |
| Flèche mal orientée | Recalibrez la boussole (8), rescannez un QR, reposez la flèche |
| « sol estimé » dans le bandeau AR | Visez le sol quelques secondes, bougez lentement, allumez la lumière ; sinon le guidage continue à hauteur estimée |
| Ancienne version affichée | Fermez l'onglet, rouvrez le lien (mise à jour automatique) |

## Confidentialité

Aucune donnée personnelle n'est collectée ni envoyée : position, cap et
relevés restent sur le téléphone. Il n'y a ni compte ni serveur applicatif.
