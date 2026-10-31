/**
 * ui.js - User Interface Controller & Event Bindings
 * Connects screen router, Firebase real-time listeners, audio engine, and game engine.
 */

import { router } from './router.js';
import { 
  createRoom, 
  joinRoom, 
  listenToRoom, 
  startGameWithRoles,
  removePlayer, 
  isConfigured 
} from './firebase.js';
import { audio } from './audio.js';
import { game } from './game.js';

let activeRoomUnsubscribe = null;
let currentRoomCode = null;
let currentDifficulty = 2; // Default to Level 2: Standard

/**
 * Display a spooky error message inside the Join screen
 * @param {string} message
 */
export function showJoinError(message) {
  const errorBox = document.getElementById('join-error-box');
  const errorText = document.getElementById('join-error-text');
  if (errorBox && errorText) {
    errorText.textContent = message;
    errorBox.style.display = 'flex';
    errorBox.style.animation = 'none';
    errorBox.offsetHeight; // trigger reflow
    errorBox.style.animation = 'errorShake 0.35s ease';
  }
}

/**
 * Clear any active error message on the Join screen
 */
export function clearJoinError() {
  const errorBox = document.getElementById('join-error-box');
  if (errorBox) {
    errorBox.style.display = 'none';
  }
}

/**
 * Display a temporary toast notification
 * @param {string} message
 */
export function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2200);
}

/**
 * Generate and render a high-contrast QR Code linking to {siteURL}/?room=CODE (Host Only)
 * @param {string} roomCode
 */
export function renderLobbyQRCode(roomCode) {
  const qrContainer = document.getElementById('lobby-qr-code');
  if (!qrContainer) return;
  qrContainer.innerHTML = '';

  const siteUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}`;

  if (window.QRCode) {
    try {
      new window.QRCode(qrContainer, {
        text: siteUrl,
        width: 176,
        height: 176,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
      return;
    } catch (err) {
      console.warn('[UI] QRCode generation failed:', err);
    }
  }

  qrContainer.innerHTML = `
    <div style="font-family: var(--font-mono); font-size: 0.75rem; color: #000; padding: 0.5rem; text-align: center; word-break: break-all;">
      <strong>JOIN LINK:</strong><br>
      <span style="color: #ff2a3d;">${siteUrl}</span>
    </div>
  `;
}

/**
 * Update difficulty badge and required player text
 * @param {number} diff
 */
function updateDifficultyUI(diff) {
  const diffBadge = document.getElementById('lobby-difficulty-badge');
  const minReqText = document.getElementById('lobby-min-req-text');
  const diffLabels = {
    1: "Level 1: Beginner",
    2: "Level 2: Standard",
    3: "Level 3: Chaos"
  };

  if (diffBadge) {
    diffBadge.textContent = diffLabels[diff] || `Level ${diff}`;
  }
  if (minReqText) {
    minReqText.textContent = "Unlimited players";
  }
}

/**
 * Update the Lobby view with room details and real-time listeners
 * @param {string} roomCode
 * @param {number} difficulty
 * @param {string} playerName
 */
export function populateLobby(roomCode, difficulty = 2, playerName = "Host") {
  currentRoomCode = roomCode;
  currentDifficulty = difficulty;
  sessionStorage.setItem('fp_roomCode', roomCode);

  const isHost = sessionStorage.getItem('fp_isHost') === 'true';
  const myPlayerId = sessionStorage.getItem('fp_playerId');

  // 1. Room Code in large monospace typography
  const roomCodeEl = document.getElementById('lobby-room-code');
  if (roomCodeEl) {
    roomCodeEl.textContent = roomCode;
  }

  // 2. Host vs Guest visibility: QR Code is HOST ONLY
  const qrCard = document.getElementById('lobby-qr-card');
  const guestCard = document.getElementById('lobby-guest-card');
  const btnStart = document.getElementById('btn-lobby-start');
  const waitingHostMsg = document.getElementById('lobby-waiting-host-msg');
  const kickHint = document.getElementById('lobby-kick-hint');

  if (isHost) {
    if (qrCard) qrCard.style.display = 'block';
    if (guestCard) guestCard.style.display = 'none';
    if (btnStart) btnStart.style.display = 'inline-flex';
    if (waitingHostMsg) waitingHostMsg.style.display = 'none';
    if (kickHint) kickHint.style.display = 'inline';
    renderLobbyQRCode(roomCode);
  } else {
    if (qrCard) qrCard.style.display = 'none';
    if (guestCard) guestCard.style.display = 'block';
    if (btnStart) btnStart.style.display = 'none';
    if (waitingHostMsg) waitingHostMsg.style.display = 'flex';
    if (kickHint) kickHint.style.display = 'none';
  }

  // 3. Difficulty Badge
  updateDifficultyUI(difficulty);

  // 4. Setup Realtime Listener
  if (isConfigured()) {
    if (activeRoomUnsubscribe) {
      activeRoomUnsubscribe();
    }

    activeRoomUnsubscribe = listenToRoom(roomCode, (roomData) => {
      if (!roomData) {
        console.warn('[Lobby] Room data vanished or closed.');
        return;
      }

      // Check for host migration if current host left
      game.checkHostMigration(roomData.hostId, roomData.players);

      // Check if this non-host player was kicked
      if (!isHost && myPlayerId && roomData.players && !roomData.players[myPlayerId]) {
        if (activeRoomUnsubscribe) {
          activeRoomUnsubscribe();
          activeRoomUnsubscribe = null;
        }
        sessionStorage.removeItem('fp_roomCode');
        sessionStorage.removeItem('fp_playerId');
        alert('You were removed from the room by the host.');
        router.navigate('home');
        return;
      }

      // Cache roles if available
      if (roomData.roles) {
        game.rolesCache = roomData.roles;
      }

      // Synchronized game state transitions across all phones
      if (roomData.gameState === 'playing') {
        if (router.getCurrentScreen() !== 'game') {
          console.log('[Room] gameState is "playing". Dropping screen to black.');
          router.navigate('game');
          game.start(roomData);
        } else {
          // If returning from a vote to playing
          if (game.state !== 'playing') {
            game.start(roomData);
          }
          // Check for active paranoia task
          if (roomData.tasks?.current) {
            game.handleParanoiaTaskSpawn(roomData.tasks.current);
          }
        }
        return;
      }

      if (roomData.gameState === 'voting') {
        if (router.getCurrentScreen() !== 'vote') {
          console.log('[Room] gameState is "voting". Transitioning to accusation.');
          router.navigate('vote');
          game.startVotePhase(roomData);
        }
        return;
      }

      if (roomData.gameState === 'ended') {
        if (router.getCurrentScreen() !== 'end' && game.state !== 'ended') {
          console.log('[Room] gameState is "ended". Transitioning to end reveal.');
          game.handleGameEnd(roomData.result);
        }
        return;
      }

      if (roomData.gameState === 'lobby') {
        if (router.getCurrentScreen() !== 'lobby') {
          console.log('[Room] gameState reset to "lobby" (Play Again).');
          game.stop();
          router.navigate('lobby');
        }
      }

      const roomDiff = roomData.difficulty || difficulty;
      updateDifficultyUI(roomDiff);
      updateLobbyPlayers(roomData.players || {}, roomData.hostId, isHost, roomDiff);
    });
  } else {
    // Local preview mode
    const mockPlayers = getMockPlayers(myPlayerId, playerName);
    updateLobbyPlayers(mockPlayers, myPlayerId || 'mock_host', isHost, difficulty);
  }
}

let mockLobbyPlayers = null;

function getMockPlayers(hostId, hostName) {
  if (!mockLobbyPlayers) {
    mockLobbyPlayers = {
      [hostId || 'mock_host']: { name: hostName || 'Host', alive: true, joinedAt: Date.now() },
      'p_ravi': { name: 'Ravi', alive: true, joinedAt: Date.now() + 1000 },
      'p_priya': { name: 'Priya', alive: true, joinedAt: Date.now() + 2000 }
    };
  }
  return mockLobbyPlayers;
}

/**
 * Render connected players inside the lobby list
 * @param {Object} players
 * @param {string} hostId
 * @param {boolean} isHost
 * @param {number} difficulty
 */
function updateLobbyPlayers(players, hostId, isHost, difficulty) {
  const playerListEl = document.getElementById('lobby-players-list');
  const countEl = document.getElementById('lobby-player-count');
  const btnStart = document.getElementById('btn-lobby-start');
  if (!playerListEl) return;

  const entries = Object.entries(players);
  const count = entries.length;
  const minRequired = Number(difficulty) === 3 ? 5 : 3;

  if (countEl) {
    countEl.textContent = `Players Connected (${count})`;
  }

  playerListEl.innerHTML = '';
  entries.forEach(([id, p]) => {
    const isPlayerHost = id === hostId;
    const chip = document.createElement('div');
    const canKick = isHost && !isPlayerHost;

    chip.className = `player-chip ${isPlayerHost ? 'is-host' : ''} ${canKick ? 'can-kick' : ''}`;
    chip.innerHTML = `
      <span class="dot"></span>
      <span class="player-name">${escapeHTML(p.name || 'Anonymous')}${isPlayerHost ? ' (Host)' : ''}</span>
      ${canKick ? '<span class="kick-cross" title="Kick player">✕</span>' : ''}
    `;

    // Host can kick a player by tapping their chip
    if (canKick) {
      chip.addEventListener('click', async () => {
        const confirmKick = confirm(`Kick "${p.name}" from the room?`);
        if (confirmKick) {
          try {
            await removePlayer(currentRoomCode, id);
            if (!isConfigured() && mockLobbyPlayers) {
              delete mockLobbyPlayers[id];
              updateLobbyPlayers(mockLobbyPlayers, hostId, isHost, difficulty);
            }
            showToast(`Removed "${p.name}"`);
          } catch (err) {
            console.error('[Lobby] Failed to remove player:', err);
            showToast('Failed to remove player');
          }
        }
      });
    }

    playerListEl.appendChild(chip);
  });

  // Host Start button check: Allow starting with any number of players!
  if (btnStart && isHost) {
    btnStart.disabled = false;
    if (count <= 1) {
      btnStart.textContent = "START GAME";
    } else {
      btnStart.textContent = `START GAME (${count} PLAYERS)`;
    }
  }
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

/**
 * Initialize all UI bindings and interactions
 */
export function initUI() {
  // 1. Home Screen Buttons
  const btnHomeCreate = document.getElementById('btn-home-create');
  if (btnHomeCreate) {
    btnHomeCreate.addEventListener('click', () => {
      router.navigate('create');
    });
  }

  const btnHomeJoin = document.getElementById('btn-home-join');
  if (btnHomeJoin) {
    btnHomeJoin.addEventListener('click', () => {
      router.navigate('join');
    });
  }

  // 3. Create Room Flow
  const btnCreateBack = document.getElementById('btn-create-back');
  if (btnCreateBack) {
    btnCreateBack.addEventListener('click', () => {
      router.navigate('home');
    });
  }

  const inputHostName = document.getElementById('input-host-name');
  const btnSubmitCreate = document.getElementById('btn-submit-create');
  const difficultyCards = document.querySelectorAll('.difficulty-card');

  difficultyCards.forEach((card) => {
    card.addEventListener('click', () => {
      difficultyCards.forEach((c) => {
        c.classList.remove('active');
        c.setAttribute('aria-checked', 'false');
      });
      card.classList.add('active');
      card.setAttribute('aria-checked', 'true');
      currentDifficulty = Number(card.dataset.difficulty) || 2;
    });
  });

  function validateCreateForm() {
    if (!btnSubmitCreate) return;
    const nameVal = inputHostName ? inputHostName.value.trim() : '';
    btnSubmitCreate.disabled = nameVal.length === 0;
  }

  if (inputHostName) {
    inputHostName.addEventListener('input', validateCreateForm);
  }

  if (btnSubmitCreate) {
    btnSubmitCreate.addEventListener('click', async (e) => {
      e.preventDefault();
      const hostName = (inputHostName ? inputHostName.value.trim() : '') || 'Host';

      btnSubmitCreate.disabled = true;
      btnSubmitCreate.textContent = 'CREATING ROOM...';

      // Unlock AudioContext on user gesture
      try { await audio.unlock(); } catch (e) {}

      try {
        const { code } = await createRoom(currentDifficulty, hostName);
        populateLobby(code, currentDifficulty, hostName);
        router.navigate('lobby');
      } catch (err) {
        console.error('[UI] Room creation failed:', err);
        alert(err.message || 'Could not create room. Please try again.');
      } finally {
        btnSubmitCreate.disabled = false;
        btnSubmitCreate.textContent = 'CREATE';
      }
    });
  }

  // 4. Lobby Screen Controls
  const btnCopyCode = document.getElementById('btn-copy-code');
  if (btnCopyCode) {
    btnCopyCode.addEventListener('click', async () => {
      const code = currentRoomCode || 'DARK';
      try {
        await navigator.clipboard.writeText(code);
        showToast(`Room code "${code}" copied!`);
      } catch {
        showToast(`Room code: ${code}`);
      }
    });
  }

  const btnCopyLink = document.getElementById('btn-copy-link');
  if (btnCopyLink) {
    btnCopyLink.addEventListener('click', async () => {
      const code = currentRoomCode || 'DARK';
      const url = `${window.location.origin}${window.location.pathname}?room=${code}`;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Invite link copied to clipboard!');
      } catch {
        showToast('Link ready to share');
      }
    });
  }

  const btnLobbyStart = document.getElementById('btn-lobby-start');
  if (btnLobbyStart) {
    btnLobbyStart.addEventListener('click', async () => {
      btnLobbyStart.disabled = true;
      btnLobbyStart.textContent = "DROPPING TO BLACK...";

      try {
        const startResult = await startGameWithRoles(currentRoomCode);
        if (!isConfigured()) {
          game.start({
            startedAt: startResult.startedAt,
            pausedTotal: 0,
            difficulty: currentDifficulty
          });
          router.navigate('game');
        }
      } catch (err) {
        console.error('[Lobby] Failed to start game:', err);
        alert('Could not start game: ' + (err.message || 'Unknown error'));
        btnLobbyStart.disabled = false;
        btnLobbyStart.textContent = "START GAME";
      }
    });
  }

  // 5. Join Screen Controls
  const btnJoinBack = document.getElementById('btn-join-back');
  if (btnJoinBack) {
    btnJoinBack.addEventListener('click', () => {
      clearJoinError();
      router.navigate('home');
    });
  }

  const checkVolume = document.getElementById('check-volume');
  const inputRoomCode = document.getElementById('input-room-code');
  const inputPlayerName = document.getElementById('input-player-name');
  const btnSubmitJoin = document.getElementById('btn-submit-join');
  const lockedBadge = document.getElementById('room-code-locked-badge');

  function setupJoinCode() {
    const urlParams = new URLSearchParams(window.location.search);
    const queryCode = urlParams.get('room') || sessionStorage.getItem('fp_auto_join_code');

    if (queryCode && inputRoomCode) {
      const code = queryCode.trim().toUpperCase().slice(0, 4);
      inputRoomCode.value = code;
      inputRoomCode.readOnly = true;
      if (lockedBadge) lockedBadge.style.display = 'inline-flex';
      if (inputPlayerName) setTimeout(() => inputPlayerName.focus(), 150);
    } else if (inputRoomCode) {
      inputRoomCode.readOnly = false;
      if (lockedBadge) lockedBadge.style.display = 'none';
    }
  }

  function validateJoinForm() {
    if (!btnSubmitJoin) return;
    const codeVal = inputRoomCode ? inputRoomCode.value.trim().toUpperCase() : '';
    const nameVal = inputPlayerName ? inputPlayerName.value.trim() : '';
    const isCodeValid = /^[A-Z]{4}$/.test(codeVal);
    const isNameValid = nameVal.length >= 1 && nameVal.length <= 12;
    const isVolumeChecked = checkVolume ? checkVolume.checked : false;

    btnSubmitJoin.disabled = !(isCodeValid && isNameValid && isVolumeChecked);
  }

  if (inputRoomCode) {
    inputRoomCode.addEventListener('input', (e) => {
      clearJoinError();
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      validateJoinForm();
    });
  }

  if (inputPlayerName) {
    inputPlayerName.addEventListener('input', (e) => {
      clearJoinError();
      e.target.value = e.target.value.replace(/[<>'"&]/g, '').slice(0, 12);
      validateJoinForm();
    });
  }

  if (checkVolume) {
    checkVolume.addEventListener('change', () => {
      clearJoinError();
      validateJoinForm();
    });
  }

  if (btnSubmitJoin) {
    btnSubmitJoin.addEventListener('click', async (e) => {
      e.preventDefault();
      clearJoinError();

      // Mandatory user gesture: Create & unlock AudioContext for iOS Safari
      try {
        await audio.unlock();
      } catch (audioErr) {
        console.warn('[Audio] User gesture unlock warning:', audioErr);
      }

      const rawCode = inputRoomCode ? inputRoomCode.value.trim().toUpperCase() : '';
      const rawName = inputPlayerName ? inputPlayerName.value.trim() : '';

      btnSubmitJoin.disabled = true;
      btnSubmitJoin.textContent = 'JOINING...';

      try {
        const joinResult = await joinRoom(rawCode, rawName);
        sessionStorage.removeItem('fp_auto_join_code');
        populateLobby(joinResult.code, joinResult.roomData?.difficulty || 2, rawName);
        router.navigate('lobby');
      } catch (err) {
        console.error('[UI] Join room failed:', err);
        showJoinError(err.message || 'Failed to enter the room. Please try again.');
        btnSubmitJoin.disabled = false;
        btnSubmitJoin.textContent = 'JOIN ROOM';
      }
    });
  }

  // 6. Check for active session to rejoin on browser refresh
  function checkSessionRejoin() {
    const savedCode = sessionStorage.getItem('fp_roomCode');
    const savedPlayerId = sessionStorage.getItem('fp_playerId');
    const savedName = sessionStorage.getItem('fp_playerName') || 'Player';

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('room')) return;

    if (savedCode && savedPlayerId) {
      console.log(`[UI] Found active session in storage: ${savedCode} for ${savedName}.`);
      populateLobby(savedCode, 2, savedName);
    }
  }

  // Route change listener
  router.onRouteChange((screenId) => {
    if (screenId === 'home') {
      if (activeRoomUnsubscribe) {
        activeRoomUnsubscribe();
        activeRoomUnsubscribe = null;
      }
    } else if (screenId === 'join') {
      setupJoinCode();
      validateJoinForm();
    } else if (screenId === 'lobby') {
      const savedCode = sessionStorage.getItem('fp_roomCode') || currentRoomCode || 'DARK';
      const savedDiff = Number(sessionStorage.getItem('fp_difficulty')) || currentDifficulty || 2;
      const savedName = sessionStorage.getItem('fp_playerName') || sessionStorage.getItem('fp_hostName') || 'Host';
      populateLobby(savedCode, savedDiff, savedName);
    } else if (screenId === 'game') {
      if (game.state !== 'playing') {
        game.start({
          startedAt: Number(sessionStorage.getItem('fp_startedAt')) || Date.now(),
          pausedTotal: 0,
          difficulty: currentDifficulty
        });
      }
    } else if (screenId === 'end') {
      game.stop();
    }
  });

  // Initialize form states
  setupJoinCode();
  validateJoinForm();
  validateCreateForm();
  checkSessionRejoin();
}

// Auto-run UI setup on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
