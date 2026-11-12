# QR codes — SUP'COM

Chaque QR encode **l'identifiant d'un lieu** de `assets/campus/supcom.json`.
Collez-le au mur, à l'endroit du lieu : le scan place l'utilisateur à ce point
(et à cet étage).

| Fichier | Payload | Lieu |
|---|---|---|
| `entree-principale.png` | `ENTREE_PRINCIPALE` | Entrée principale — RDC |
| `accueil.png` | `ACCUEIL` | Accueil — RDC |
| `bureau-d-ordre.png` | `BUREAU_D_ORDRE` | Bureau d'ordre — RDC |
| `buvette.png` | `BUVETTE` | Buvette — RDC |
| `amphi-khawarezmi.png` | `AMPHI_KHAWAREZMI` | Amphithéâtre Khawarezmi — RDC, Bloc B |
| `amphi-ibn-rochd.png` | `AMPHI_IBN_ROCHD` | Amphithéâtre Ibn Rochd — RDC, Bloc B |
| `amphi-ibn-el-haithem.png` | `AMPHI_IBN_EL_HAITHEM` | Amphithéâtre Ibn El Haithem — RDC, Bloc A |
| `amphi-ibn-khaldoun.png` | `AMPHI_IBN_KHALDOUN` | Amphithéâtre Ibn Khaldoun — RDC, Bloc A |
| `escalier-a.png`, `escalier-a2.png`, `escalier-b.png`, `escalier-b2.png`, `escalier-c.png` | `ESCALIER_*` | Escaliers (pied de l'escalier, RDC) |
| `ascenseur-a.png`, `ascenseur-b.png` | `ASCENSEUR_*` | Ascenseurs (palier du RDC) |
| `full-sheet.png` | les 15 | Planche complète |

Les salles (codes `A1-07`, `B2-05`…) s'impriment depuis
[`docs/qr-codes.html`](../qr-codes.html), étage par étage. Alias acceptés :
`ENTREE` → entrée principale, `HALL` → accueil.

## Démonstration conseillée

1. Ouvrir <https://indoor-wayfinder-lyart.vercel.app> dans Chrome Android.
2. Scanner `entree-principale.png` : « Vous êtes ici : Entrée principale (RDC) ».
3. Choisir **Amphithéâtre Khawarezmi**, puis une salle de l'étage 3.
4. **Guidage AR** depuis l'entrée : chevrons au sol, flèche vers le couloir.
5. Au pied de l'escalier, scanner `escalier-a2.png` : l'itinéraire est recalé.

## Régénération

Les cartes sont produites avec Python `qrcode` + Pillow à partir de
`assets/campus/supcom.json` (modules entiers pour un décodage fiable).
