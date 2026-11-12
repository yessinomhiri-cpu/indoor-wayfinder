# QR codes de démonstration

Ces QR encodent **l'identifiant exact d'un nœud** de `assets/building.json`.
Ils sont prêts à afficher sur un écran ou à imprimer.

| Fichier | Payload | Nœud |
|---|---|---|
| `entree.png` | `ENTREE` | Entrée principale |
| `hall.png` | `HALL` | Hall principal |
| `couloir-est.png` | `COULOIR_EST` | Couloir Est |
| `couloir-sud.png` | `COULOIR_SUD` | Couloir Sud |
| `couloir-ouest.png` | `COULOIR_OUEST` | Couloir Ouest |
| `salle-b12.png` | `SALLE_B12` | Salle B12 |
| `salle-b14.png` | `SALLE_B14` | Salle B14 |
| `salle-b15.png` | `SALLE_B15` | Salle B15 |
| `lab-info.png` | `LAB_INFO` | Labo Informatique |
| `admin.png` | `ADMIN` | Administration |
| `biblio.png` | `BIBLIO` | Bibliothèque |
| `amphi-a.png` | `AMPHI_A` | Amphithéâtre A |
| `demo-sheet.png` | `ENTREE`, `HALL`, `COULOIR_EST`, `SALLE_B12` | Planche 2 × 2 (parcours conseillé) |
| `full-sheet.png` | les 12 nœuds | Planche complète 3 × 4 |

N'importe quel QR peut servir de départ et n'importe quel nœud d'arrivée.
Sans QR, le sélecteur **Départ** de la liste des destinations fixe la position.

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
