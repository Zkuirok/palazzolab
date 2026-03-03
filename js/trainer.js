/* ============================================
   PokerLab — Trainer Hub
   Orchestrates trainer subviews and mini-game routing
   ============================================ */

import { loadRanges } from './range-model.js';
import { showToast } from './toast.js';
import { initRubicon, openRubiconSelect } from './rubicon.js';
import { initRubiconChallenge, openRubiconChallenge } from './rubicon-challenge.js';
import { initColosseum, openColosseumSelect, launchColosseumForRange, reconfigureColosseum } from './colosseum.js';

export function initTrainer() {
  // Init Challenge mode
  initRubiconChallenge({ onBackToSelect: showRubiconSelectView });

  // Init Rubicon game with callbacks
  initRubicon({
    onBackToHub: showTrainerHub,
    onBackToSelect: showRubiconSelectView,
    onShowGameView: showRubiconGameView,
    onStartChallenge: (range) => {
      openRubiconChallenge(range);
      showRubiconChallengeView();
    },
  });

  // Init Colosseum
  initColosseum({
    onBack: showTrainerHub,
    showSelectView: showColosseumSelectView,
    showGameView: showColosseumGameView,
  });

  // Rubicon tile click
  document.getElementById('game-rubicon').addEventListener('click', () => {
    const nashRanges = loadRanges().filter(r => r.type === 'nash');
    if (nashRanges.length === 0) {
      showToast('Crée d\'abord une Table Nash dans "Mes Ranges"');
      return;
    }
    openRubiconSelect(nashRanges);
    showRubiconSelectView();
  });

  // Colosseum tile click — restore default callbacks before opening picker
  document.getElementById('game-colosseum').addEventListener('click', () => {
    reconfigureColosseum({
      onBack: showTrainerHub,
      showSelectView: showColosseumSelectView,
      onComplete: null,
    });
    const ranges = loadRanges();
    openColosseumSelect(ranges);
    showColosseumSelectView();
  });

  // Navigate back when the trainer page is shown from the sidebar
  const navItem = document.querySelector('.nav-item[data-page="trainer"]');
  if (navItem) {
    navItem.addEventListener('click', () => showTrainerHub());
  }
}

// === VIEW SWITCHING ===

function hideAllTrainerViews() {
  document.getElementById('trainer-hub').style.display = 'none';
  document.getElementById('rubicon-select-view').style.display = 'none';
  document.getElementById('rubicon-game-view').style.display = 'none';
  document.getElementById('rubicon-challenge-view').style.display = 'none';
  document.getElementById('colosseum-select-view').style.display = 'none';
  document.getElementById('colosseum-game-view').style.display = 'none';
}

function showTrainerHub() {
  hideAllTrainerViews();
  const hub = document.getElementById('trainer-hub');
  hub.style.display = '';
  hub.style.animation = 'none';
  hub.offsetHeight;
  hub.style.animation = '';
}

function showRubiconSelectView() {
  hideAllTrainerViews();
  const view = document.getElementById('rubicon-select-view');
  view.style.display = '';
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';
}

function showRubiconGameView() {
  hideAllTrainerViews();
  const view = document.getElementById('rubicon-game-view');
  view.style.display = '';
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';
}

function showRubiconChallengeView() {
  hideAllTrainerViews();
  const view = document.getElementById('rubicon-challenge-view');
  view.style.display = '';
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';
}

function showColosseumSelectView() {
  hideAllTrainerViews();
  const view = document.getElementById('colosseum-select-view');
  view.style.display = '';
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';
}

function showColosseumGameView() {
  hideAllTrainerViews();
  const view = document.getElementById('colosseum-game-view');
  view.style.display = '';
  view.style.animation = 'none';
  view.offsetHeight;
  view.style.animation = '';
}

// === PROGRAM DEEP LINK ===

export function launchQuizForRange(rangeId, { onComplete, onBack } = {}) {
  const range = loadRanges().find(r => r.id === rangeId);
  if (!range) return;

  const backToDashboard = () => { if (onBack) onBack(); };

  reconfigureColosseum({
    onBack: backToDashboard,
    showSelectView: backToDashboard,
    onComplete: onComplete ? (id, score) => onComplete(id, score) : null,
  });

  window.navigateTo('trainer');
  showColosseumGameView();
  launchColosseumForRange(range);
}
