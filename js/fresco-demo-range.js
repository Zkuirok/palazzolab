/* ============================================
   PokerLab — Fresco : range de démonstration
   Fournie avec l'outil pour qu'il soit testable
   sur un navigateur vierge (sans range en localStorage).
   Elle n'est jamais écrite dans « Mes Ranges ».
   ============================================ */

// Grille 13×13, une ligne par rang (A → 2), un chiffre par main = index d'action,
// '.' = main non assignée. Même ordre que HANDS_MATRIX.
const ROWS = [
  '0000000022222',
  '0000211111133',
  '0202211333333',
  '2210211333333',
  '2111011333333',
  '2333301333333',
  '2333330133333',
  '2333333033333',
  '3333333323333',
  '2333333332333',
  '3333333333233',
  '3333333333323',
  '3333333333332',
];

function decodeCells(rows) {
  const cells = {};
  rows.forEach((row, r) => {
    for (let c = 0; c < 13; c++) {
      const ch = row[c];
      if (ch !== '.') cells[r * 13 + c] = parseInt(ch, 10);
    }
  });
  return cells;
}

export const FRESCO_DEMO_RANGE = Object.freeze({
  id: 'fresco_demo_btn_open_15',
  demo: true,
  name: 'Démo — BTN open 15bb',
  situation: '3H_BTN_open',
  depthMin: 13,
  depthMax: 16,
  opponentType: 'reg',
  opponentSubcategory: '',
  actionDefs: [
    { label: 'MR Call', color: '#e69100' },
    { label: 'MR Fold', color: '#ffe852' },
    { label: 'OS',      color: '#ff2200' },
    { label: 'Fold',    color: '#5e5e5e' },
  ],
  cells: decodeCells(ROWS),
  createdAt: '2026-02-28T10:15:11.801Z',
  updatedAt: '2026-02-28T10:15:11.801Z',
});
