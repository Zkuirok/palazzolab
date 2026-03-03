/* ============================================
   PokerLab — Main App Entry Point
   ============================================ */

import { initNavigation } from './navigation.js';
import { initRangeBuilder } from './range-builder.js';
import { initTrainer, launchQuizForRange } from './trainer.js';
import { loadRanges, exportRanges, importRangesFromFile } from './range-model.js';
import { initDashboard } from './dashboard.js';

// === INIT ===
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initToggles();
  initRangeBuilder();
  initTrainer();                         // must run before initDashboard
  initDashboard({ launchQuizForRange });
  initSettings();
});

// === TOGGLES ===
function initToggles() {
  document.querySelectorAll('.toggle').forEach(toggle => {
    toggle.addEventListener('click', () => toggle.classList.toggle('on'));
  });
}

// === SETTINGS ===
function initSettings() {
  const btnExport = document.getElementById('btn-export-ranges');
  const btnImport = document.getElementById('btn-import-ranges');
  const fileInput = document.getElementById('import-file-input');
  const feedback = document.getElementById('import-feedback');

  btnExport.addEventListener('click', () => {
    const ranges = loadRanges();
    exportRanges(ranges);
    feedback.style.color = '#5a9a60';
    feedback.textContent = `✓ ${ranges.length} range(s) exportée(s) — vérifie ton dossier Téléchargements.`;
  });

  btnImport.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    feedback.style.color = 'var(--cream-muted)';
    feedback.textContent = 'Import en cours…';
    try {
      const result = await importRangesFromFile(file, loadRanges());
      feedback.style.color = '#5a9a60';
      feedback.textContent = `✓ ${result.added} range(s) importée(s), ${result.skipped} déjà présente(s).`;
    } catch (err) {
      feedback.style.color = '#c05050';
      feedback.textContent = `✗ ${err.message}`;
    }
  });
}
