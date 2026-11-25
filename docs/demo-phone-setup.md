# Préparer le téléphone de démo (AR WebGPU)

**Version :** 3.5.1 · **Public :** l'équipe, avant chaque test terrain et avant la soutenance

L'AR de l'application est rendue en **WebGPU** (exigence du superviseur) :
la session `immersive-ar` est demandée avec la fonctionnalité `webgpu`, et
Three.js r187 dessine dans une couche `XRGPUBinding`. Chaque maillon doit
fonctionner sur le téléphone. La page **`diagnostic.html`** les vérifie tous.
Pour l'ouvrir, touchez le badge **AR : …** en haut de l'application.

## 1. Réglages (une seule fois par téléphone)

| # | Étape | Comment vérifier |
|---|---|---|
| 1 | Mettre **Chrome** à jour (Play Store) | Diagnostic : « Chrome sur Android » ✓ |
| 2 | Installer / mettre à jour **Google Play Services for AR** (Play Store) | « Session immersive-ar (ARCore) » ✓ |
| 3 | Ouvrir `chrome://flags/#webxr-webgpu-binding` → **Enabled** → **Relaunch** | « Liaison WebXR ↔ WebGPU » ✓ |
| 4 | Ouvrir l'application **en HTTPS** (lien Vercel / GitHub Pages) | « Connexion HTTPS » ✓ |
| 5 | Autoriser la **caméra** pour le site (cadenas → Autorisations) | « Autorisation caméra » ✓ |
| 6 | Laisser l'application se charger en entier, puis **recharger une fois** | « Fichiers en cache pour le hors-ligne » ✓ |
| 7 | Désactiver l'**économie d'énergie** et mettre la luminosité au maximum | Fluidité du test AR ≥ 24 img/s |
| 8 | **Calibrer la boussole** (geste en 8) | « Boussole en direct » ≥ 5 mesures/s |

> Le lien `chrome://flags/...` ne peut pas s'ouvrir depuis une page web : le
> diagnostic propose un bouton **Copier l'adresse** à coller dans la barre
> d'adresse.

## 2. Tests en direct (dans le diagnostic)

1. **Tester caméra + QR** : montrez un QR imprimé (`docs/qr-codes.html`) à
   30–50 cm. Attendu : QR lu en moins de 3 s.
2. **Tester la boussole** : téléphone à plat, tournez lentement.
3. **Lancer le test AR réel (20 s)** : visez le sol du couloir et bougez
   lentement. L'écran se **teinte en vert** quand le sol est détecté. Attendu :
   - suivi ≥ 90 %, sol trouvé en moins de 5 s, ancre **ok** ;
   - fluidité ≥ 24 img/s (idéalement ~30) ;
   - fonctions : `webgpu, hit-test, local-floor, anchors, dom-overlay`.
4. Le verdict en haut doit indiquer **« AR WebGPU fonctionnelle : prêt pour la démo »**.
5. **Copier le rapport** et le coller dans le journal de test ci-dessous.

## 3. Le jour de la soutenance

- [ ] Deux téléphones préparés (principal + secours), chargés à 100 %.
- [ ] Diagnostic vert sur les deux, le matin même (une mise à jour de Chrome
      peut réinitialiser le flag).
- [ ] Application ouverte une fois en ligne (cache hors ligne prêt).
- [ ] QR codes imprimés et fixés sur l'étage de démo.
- [ ] Vidéo de secours de l'AR enregistrée sur le téléphone.

## 4. Journal de test

| Date | Téléphone | Chrome | Verdict | Img/s | Sol trouvé en | Remarques |
|---|---|---|---|---|---|---|
| | | | | | | |
