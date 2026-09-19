/* ============================================
   PokerLab — Range Painter
   Click-and-drag painting on the 13x13 matrix
   ============================================ */

/**
 * Initialize paint interaction on a matrix element.
 * Returns a destroy() function to clean up all listeners.
 *
 * @param {HTMLElement} matrixEl - The .mini-matrix container
 * @param {Function} getActiveAction - Returns current action index (or -1 for eraser)
 * @param {Function} onCellChange - Called with (cellIndex, actionIndex|null) on each paint
 * @param {Object} [hooks] - Optional stroke hooks (a stroke = one press → release, or one Shift+click)
 * @param {Function} [hooks.onStrokeStart] - Called before the first cell of a stroke changes
 * @param {Function} [hooks.onStrokeEnd] - Called once the stroke is complete
 *
 * Shift+click fills the rectangle between the last clicked cell and the
 * clicked one with the active action (or erases it with the eraser).
 */
export function initPainter(matrixEl, getActiveAction, onCellChange, { onStrokeStart = null, onStrokeEnd = null } = {}) {
  let painting = false;
  let erasing = false;
  let lastCellIndex = -1;
  let anchorIndex = -1; // last cell pressed without Shift — origin of a Shift+click rectangle

  function getCellIndex(el) {
    const cell = el?.closest('.mini-cell');
    if (!cell) return -1;
    const idx = cell.dataset.index;
    return idx !== undefined ? parseInt(idx, 10) : -1;
  }

  function getCellElement(index) {
    return matrixEl.querySelector(`.mini-cell[data-index="${index}"]`);
  }

  function beginStroke() {
    if (onStrokeStart) onStrokeStart();
  }

  function endStroke() {
    if (onStrokeEnd) onStrokeEnd();
  }

  function applyToCell(index) {
    if (index < 0 || index === lastCellIndex) return;
    // A fast drag can skip cells between two mousemove samples: fill the
    // straight line from the previous cell so the stroke stays continuous
    const path = lastCellIndex >= 0 ? lineIndices(lastCellIndex, index) : [index];
    lastCellIndex = index;
    const value = erasing ? null : getActiveAction();
    path.forEach(i => onCellChange(i, value));
  }

  // Cells on the segment from index a (excluded) to index b (included)
  function lineIndices(a, b) {
    const r1 = Math.floor(a / 13), c1 = a % 13;
    const r2 = Math.floor(b / 13), c2 = b % 13;
    const steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
    const out = [];
    for (let k = 1; k <= steps; k++) {
      const r = Math.round(r1 + (r2 - r1) * k / steps);
      const c = Math.round(c1 + (c2 - c1) * k / steps);
      out.push(r * 13 + c);
    }
    return out;
  }

  // Cells of the rectangle spanned by two matrix indices (inclusive)
  function rectangleIndices(a, b) {
    const r1 = Math.floor(a / 13), c1 = a % 13;
    const r2 = Math.floor(b / 13), c2 = b % 13;
    const out = [];
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.push(r * 13 + c);
    }
    return out;
  }

  // Decide paint vs erase for a press on `index`: re-pressing a cell that already
  // carries the active action erases (toggle behaviour)
  function startStrokeMode(index, activeAction) {
    if (activeAction < 0) {
      erasing = true;
      return;
    }
    const cell = getCellElement(index);
    const currentAction = cell?.dataset.action;
    if (currentAction !== undefined && parseInt(currentAction) === activeAction) {
      erasing = true;
    } else {
      painting = true;
    }
  }

  // === MOUSE ===

  function onMouseDown(e) {
    const index = getCellIndex(e.target);
    if (index < 0) return;
    e.preventDefault();

    const activeAction = getActiveAction();

    // Shift+click: rectangle from the anchor to this cell, in one stroke
    if (e.shiftKey && e.button === 0 && anchorIndex >= 0) {
      const value = activeAction < 0 ? null : activeAction;
      beginStroke();
      rectangleIndices(anchorIndex, index).forEach(i => onCellChange(i, value));
      endStroke();
      return;
    }
    anchorIndex = index;

    if (e.button === 2) {
      erasing = true;
    } else if (e.button === 0) {
      startStrokeMode(index, activeAction);
    } else {
      return;
    }

    beginStroke();
    lastCellIndex = -1;
    matrixEl.classList.add('painting');
    applyToCell(index);
  }

  function onMouseMove(e) {
    if (!painting && !erasing) return;
    const index = getCellIndex(e.target);
    if (index < 0) return;
    applyToCell(index);
  }

  function onMouseUp() {
    if (painting || erasing) {
      painting = false;
      erasing = false;
      lastCellIndex = -1;
      matrixEl.classList.remove('painting');
      endStroke();
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  // === TOUCH ===

  function onTouchStart(e) {
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const index = getCellIndex(el);
    if (index < 0) return;
    e.preventDefault();

    anchorIndex = index;
    startStrokeMode(index, getActiveAction());

    beginStroke();
    lastCellIndex = -1;
    matrixEl.classList.add('painting');
    applyToCell(index);
  }

  function onTouchMove(e) {
    if (!painting && !erasing) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const index = getCellIndex(el);
    if (index < 0) return;
    e.preventDefault();
    applyToCell(index);
  }

  function onTouchEnd() {
    if (painting || erasing) {
      painting = false;
      erasing = false;
      lastCellIndex = -1;
      matrixEl.classList.remove('painting');
      endStroke();
    }
  }

  // Attach listeners
  matrixEl.addEventListener('mousedown', onMouseDown);
  matrixEl.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  matrixEl.addEventListener('contextmenu', onContextMenu);
  matrixEl.addEventListener('touchstart', onTouchStart, { passive: false });
  matrixEl.addEventListener('touchmove', onTouchMove, { passive: false });
  matrixEl.addEventListener('touchend', onTouchEnd);

  // Return cleanup function that removes ALL listeners
  return function destroy() {
    matrixEl.removeEventListener('mousedown', onMouseDown);
    matrixEl.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    matrixEl.removeEventListener('contextmenu', onContextMenu);
    matrixEl.removeEventListener('touchstart', onTouchStart);
    matrixEl.removeEventListener('touchmove', onTouchMove);
    matrixEl.removeEventListener('touchend', onTouchEnd);
  };
}
