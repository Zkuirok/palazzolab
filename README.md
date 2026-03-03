# PokerLab — Training Palazzo

Application web personnelle d'entraînement poker pour Nicolas.

## Stack
- HTML / CSS / JS vanilla (ES modules)
- Pas de framework, pas de build system
- Stockage local (localStorage)
- Thème visuel : "Palazzo" — baroque, marbre crème, or, feutre vert

## Structure
```
pokerlab/
├── index.html              # Page principale (SPA, navigation par pages)
├── css/
│   ├── theme.css           # Variables CSS (couleurs, fonts, spacing)
│   ├── layout.css          # Layout global, sidebar, cards, composants communs
│   └── range-builder.css   # Styles spécifiques au range builder
├── js/
│   ├── app.js              # Point d'entrée, initialisation
│   ├── navigation.js       # Navigation entre pages
│   ├── toast.js            # Notifications toast
│   ├── poker-hands.js      # Données poker : matrice 13x13, combos, utilitaires
│   └── range-model.js      # Modèle de données des ranges (CRUD, localStorage)
└── assets/
    ├── textures/           # Fonds tileable (marbre, feutre)
    ├── ornaments/          # Éléments décoratifs (blason, coins, frises)
    └── game/               # Éléments de jeu (table, jetons, cartes, symboles)
```

## Phases de développement
1. **Range Builder** ← EN COURS
   - Matrice 13x13 interactive
   - Création/édition/sauvegarde de ranges
   - Métadonnées : position (HU/3H), profondeur (intervalle ou exacte), profil (reg/fish)
   - Sous 5bb : profondeur exacte (Nash, sensible aux dixièmes)
   - Au-dessus de 5bb : intervalles de 2bb

2. **Trainer basique** — Génération de situations, feedback, score
3. **Trainer avancé** — Modes variés, stats, progression, paramétrage
4. **Import de mains** — Parsing Winamax/H2N, comparaison avec ranges, revue d'erreurs
5. **Postflop Lab** — Arbre de décision, equity, EV (type Flopzilla)

## Lancer le projet
Ouvrir `index.html` dans un navigateur, ou servir avec :
```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
Note : les ES modules nécessitent un serveur HTTP (pas de file://).

## Design
- Font display : Cinzel Decorative
- Font heading : Cinzel
- Font body : EB Garamond
- Palette : or (#d4a438), crème (#f0e8d8), vert feutre (#2a5a3c), rouge (#a83030)
- Fond : marbre crème avec overlay sombre à 50%
- Style : coins arrondis minimaux, ombres douces, animations fluides
