# QR codes de démonstration

Ces QR encodent **l'identifiant exact d'un nœud** de `assets/building.json`.
Ils sont prêts à afficher sur un écran ou à imprimer.

| Fichier | Payload | Nœud |
|---|---|---|
| `entree.png` | `ENTREE` | Entrée principale |
| `hall.png` | `HALL` | Hall principal |
| `couloir-est.png` | `COULOIR_EST` | Couloir Est |
| `salle-b12.png` | `SALLE_B12` | Salle B12 |
| `demo-sheet.png` | les quatre | Planche 2 × 2 |

## Démonstration conseillée

1. Ouvrir <https://indoor-wayfinder-lyart.vercel.app> sur Android Chrome.
2. Scanner `entree.png` : la position devient **Entrée principale**.
3. Choisir **Salle B12** : itinéraire **26 m · 3 étapes**.
4. Lancer **Guidage AR**, viser le sol, toucher pour placer la flèche.
5. Revenir au scan et scanner `hall.png` : l'itinéraire est recalculé
   (**16 m · 2 étapes**).
6. Scanner `couloir-est.png` : il reste **6 m · 1 étape** jusqu'à B12.
7. Scanner `salle-b12.png` : **« Vous êtes déjà sur place »**.

## Affichage / impression

- Afficher `demo-sheet.png` en plein écran sur un ordinateur portable.
- Ou imprimer la planche en A4 paysage ; garder une marge blanche autour des QR.
- Éviter les reflets, le mode nuit et les filtres bleus.
- Si la caméra est indisponible, utiliser **Importer une image QR** dans le
  scanner et choisir le PNG correspondant.

## Régénération

```bash
python - <<'PY'
import qrcode
qrcode.make('ENTREE').save('entree.png')
PY
```

Ou utiliser `qrencode` :

```bash
qrencode -o entree.png -s 10 -m 4 "ENTREE"
```
