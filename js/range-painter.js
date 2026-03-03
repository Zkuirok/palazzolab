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
 */
export function initPainter(matrixEl, getActiveAction, onCellChange) {
  let painting = false;
  let erasing = false;
  let lastCellIndex = -1;

  function getCellIndex(el) {
    const cell = el?.closest('.mini-cell');
    if (!cell) return -1;
    const idx = cell.dataset.index;
    return idx !== undefined ? parseInt(idx, 10) : -1;
  }

  function getCellElement(index) {
    return matrixEl.querySelector(`.mini-cell[data-index="${index}"]`);
  }

  function applyToCell(index) {
    if (index < 0 || index === lastCellIndex) return;
    lastCellIndex = index;
    if (erasing) {
      onCellChange(index, null);
    } else {
      onCellChange(index, getActiveAction());
    }
  }

  // === MOUSE ===

  function onMouseDown(e) {
    const index = getCellIndex(e.target);
    if (index < 0) return;
    e.preventDefault();

    const activeAction = getActiveAction();

    if (e.button === 2 || activeAction < 0) {
      erasing = true;
    } else if (e.button === 0) {
      const cell = getCellElement(index);
      const currentAction = cell?.dataset.action;
      if (currentAction !== undefined && parseInt(currentAction) === activeAction) {
        erasing = true;
      } else {
        painting = true;
      }
    }

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

    const activeAction = getActiveAction();
    if (activeAction < 0) {
      erasing = true;
    } else {
      const cell = getCellElement(index);
      const currentAction = cell?.dataset.action;
      if (currentAction !== undefined && parseInt(currentAction) === activeAction) {
        erasing = true;
      } else {
        painting = true;
      }
    }

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
    painting = false;
    erasing = false;
    lastCellIndex = -1;
    matrixEl.classList.remove('painting');
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
