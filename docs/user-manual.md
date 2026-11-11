# Manuel utilisateur — Indoor Wayfinder

**Version :** 2.2.0
**Public :** visiteurs, étudiants, candidats, personnel du bâtiment

## Ce dont vous avez besoin

- Un smartphone **Android** avec **Chrome** et **ARCore** pour le guidage AR.
- Une connexion **HTTPS** (GitHub Pages ou tunnel sécurisé).
- Les QR codes du bâtiment, imprimés et fixés dans les couloirs.

Aucune application n'est à installer : Indoor Wayfinder s'ouvre dans le
navigateur. Vous pouvez l'ajouter à l'écran d'accueil depuis le menu Chrome.

## Utilisation pas à pas

1. **Ouvrez le lien** de l'application dans Chrome.
2. Autorisez l'accès à la **caméra** quand Chrome le demande.
3. Appuyez sur **SCANNER**.
4. Cadrez le **QR code le plus proche** dans le viseur.
   - Sur ordinateur, utilisez **Importer une image QR** à la place de la caméra.
   - Le voyant de position affiche **« Vous êtes ici : … »**.
   - Si le QR est inconnu, vérifiez que vous êtes dans le bon bâtiment.
5. Appuyez sur **DESTINATION**.
6. Cherchez ou choisissez une salle, par exemple **Salle B12**.
   - L'itinéraire affiche la distance réelle et les étapes calculées par Dijkstra.
7. Lisez le trajet, puis appuyez sur **Guidage AR**.
8. Visez le sol avec la caméra, puis **touchez l'écran** pour placer la flèche.
9. Suivez la flèche jusqu'au prochain QR code.
10. Au QR suivant, appuyez sur **Scanner** pour recalibrer la position ;
    l'itinéraire est recalculé automatiquement.
11. Appuyez sur **Quitter AR** pour terminer le guidage.

## Mode démonstration sur ordinateur

Le plan interactif est affiché au démarrage. Un clic sur un nœud simule un
scan QR (libellé **Démo**). Choisissez ensuite une destination : la ligne cyan
et les distances sont calculées par Dijkstra. Ce mode sert à montrer le
fonctionnement sans téléphone ; la démonstration réelle utilise la caméra.

## Comprendre l'écran

| Élément | Signification |
|---|---|
| Pastille verte « Vous êtes ici » | Dernier QR code scanné |
| Bouton **SCANNER** | Ouvre la caméra et le décodage QR |
| Bouton **DESTINATION** | Ouvre la liste des salles |
| Panneau **Itinéraire** | Distance totale, étapes, guidage AR |
| Bouton **Guidage AR** | Démarre la session `immersive-ar` |
| Bouton **Quitter AR** | Termine la session AR |
| Badge **En ligne / Hors ligne** | État de la connexion |
| Badge **AR : disponible / non disponible** | Support WebXR de l'appareil |
| Plan + ligne cyan | Graphe du bâtiment et itinéraire calculé |

## Bon à savoir

- La position n'est **pas continue** : elle est mise à jour à chaque QR scanné.
- Entre deux QR, l'application conserve la dernière position connue.
- L'application fonctionne **hors ligne** après un premier chargement complet.
- Aucune donnée personnelle n'est collectée ; il n'y a ni compte ni serveur.

## En cas de problème

| Problème | Solution |
|---|---|
| La caméra ne s'ouvre pas | Vérifiez l'URL HTTPS et l'autorisation caméra dans Chrome |
| « QR code inconnu » | Vérifiez que le QR appartient au plan `building.json` |
| Aucun itinéraire | Scannez d'abord un QR, puis choisissez la destination |
| « AR non supporté » | Utilisez Chrome Android avec ARCore et HTTPS |
| Le sol n'est pas détecté | Déplacez légèrement le téléphone, évitez les surfaces réfléchissantes |
| La flèche n'apparaît pas | Touchez l'écran après avoir visé le sol |
| Page ancienne après mise à jour | Rechargez ; le Service Worker met le cache à jour |

## Confidentialité

L'application n'envoie ni position, ni image, ni identifiant vers un serveur.
Le décodage QR et le calcul d'itinéraire se font dans le navigateur.
La dernière position peut être conservée localement pour la session.
