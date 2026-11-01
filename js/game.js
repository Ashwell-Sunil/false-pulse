/**
 * game.js - Master Game Engine
 * Aligned with GDD.md, PRD.md, and TRD.md:
 * - 120s master timer synced with Firebase .info/serverTimeOffset
 * - Screen Wake Lock API keeping screens awake
 * - Audio engine control (static, heartbeats, screams, jumpscare)
 * - Ghost Phase (2s hold, 10s mute, 25s cooldown, vibration)
 * - Double-tap -> glowing VOTE button (3s timeout, max 2 votes, 30s cooldown)
 * - Paranoia Tasks (Levels 2 & 3): shrinking rings, elimination + scream, imposter death win
 * - Voting Phase: 15s synced countdown, tallying (majority imposter = crew win, innocent/decoy = imposter win, tie/skip = resume)
 * - Imposter Win: 2.8s full-screen jumpscare with jumpscare.mp3 at max volume
 * - Staggered 600ms role reveal sequence
 * - Host departure migration & tab visibility management
 */

import { router } from './router.js';
import { audio } from './audio.js';
import { 
  listenToServerTimeOffset, 
  listenToPlayerRole, 
  triggerVotePhase,
  castVote,
  resumeFromVote,
  spawnParanoiaTask,
  clearParanoiaTask,
  eliminatePlayer,
  endGameWithResult,
  resetRoomToLobby,
  transferHost,
  getRoomSnapshot,
  isConfigured 
} from './firebase.js';

export const GAME_STATES = {
  LOBBY: 'lobby',
  PLAYING: 'playing',
  VOTING: 'voting',
  ENDED: 'ended'
};

export class GameEngine {
  constructor() {
    this.roomCode = null;
    this.playerId = null;
    this.playerName = 'Player';
    this.role = null;
    this.isHost = false;
    this.difficulty = 2;
    this.state = GAME_STATES.LOBBY;
    this.isAlive = true;

    // Room synced metadata
    this.startedAt = null;
    this.pausedAt = null;
    this.pausedTotal = 0;
    this.voteCount = 0;
    this.lastVoteEndedAt = 0;
    this.serverTimeOffset = 0;
    this.players = {};
    this.rolesCache = {};

    // Master 120s timer
    this.remainingSeconds = 120;
    this.gameDurationMs = 120000;
    this.timerInterval = null;

    // Screen Wake Lock
    this.wakeLock = null;

    // Debug overlay
    this.debugVisible = false;
    this.longPressTimer = null;

    // Double-tap VOTE trigger state
    this.lastTapTime = 0;
    this.voteBtnTimeout = null;

    // Ghost Phase state (Imposter only)
    this.isGhostActive = false;
    this.ghostCooldownSec = 0;
    this.ghostCooldownTimer = null;
    this.ghostHoldTimer = null;
    this.ghostPressStart = 0;

    // Paranoia Tasks state
    this.paranoiaTaskTimer = null;
    this.activeTaskTimeout = null;
    this.currentTaskId = null;

    // Voting phase state
    this.voteCountdownTimer = null;
    this.hasVoted = false;
    this.voteCountdownSec = 15;

    // Listeners
    this.roleUnsubscribe = null;
  }

  /**
   * Initialize listeners and gestures
   */
  init() {
    this.listenToClockOffset();
    this.setupDebugTrigger();
    this.setupGameScreenGestures();
    this.setupVisibilityListeners();
    console.log('[Game] Engine initialized.');
  }

  /**
   * Listen to Firebase server time offset
   */
  listenToClockOffset() {
    if (isConfigured()) {
      listenToServerTimeOffset((offset) => {
        this.serverTimeOffset = offset;
        this.updateDebugOverlay();
      });
    }
  }

  /**
   * Screen Wake Lock management
   */
  async requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
        console.log('[WakeLock] Screen Wake Lock active.');
      } catch (err) {
        console.warn('[WakeLock] Could not acquire Wake Lock:', err.message);
      }
    }
  }

  async releaseWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
        this.wakeLock = null;
      } catch (err) {}
    }
  }

  setupVisibilityListeners() {
    const warningEl = document.getElementById('tab-blur-warning');

    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        if (warningEl) warningEl.style.display = 'none';
        if (this.state === GAME_STATES.PLAYING) {
          await this.requestWakeLock();
        }
      } else {
        // Warn if backgrounded during active hunt
        if (this.state === GAME_STATES.PLAYING) {
          if (warningEl) warningEl.style.display = 'block';
        }
      }
    });
  }

  /**
   * Top-left corner debug overlay trigger (1.2s long press)
   */
  setupDebugTrigger() {
    const trigger = document.getElementById('game-debug-trigger');
    const overlay = document.getElementById('game-debug-overlay');

    if (trigger) {
      trigger.addEventListener('contextmenu', (e) => e.preventDefault());

      const start = () => {
        this.cancelDebugPress();
        this.longPressTimer = setTimeout(() => {
          this.toggleDebug();
          if (navigator.vibrate) try { navigator.vibrate(50); } catch {}
        }, 1200);
      };

      trigger.addEventListener('pointerdown', start);
      trigger.addEventListener('pointerup', () => this.cancelDebugPress());
      trigger.addEventListener('pointerleave', () => this.cancelDebugPress());
      trigger.addEventListener('pointercancel', () => this.cancelDebugPress());
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        if (this.debugVisible) this.toggleDebug();
      });
    }
  }

  cancelDebugPress() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    const overlay = document.getElementById('game-debug-overlay');
    if (overlay) {
      overlay.style.display = this.debugVisible ? 'flex' : 'none';
      this.updateDebugOverlay();
    }
  }

  updateDebugOverlay() {
    const timerVal = document.getElementById('debug-timer-val');
    const roleVal = document.getElementById('debug-role-val');
    const offsetVal = document.getElementById('debug-offset-val');
    const ghostVal = document.getElementById('debug-ghost-val');

    if (timerVal) timerVal.textContent = `${this.remainingSeconds}s`;
    if (roleVal) {
      const currentRole = this.role || 'UNKNOWN';
      roleVal.textContent = currentRole.toUpperCase();
      roleVal.className = `debug-val ${currentRole.toLowerCase()}`;
    }
    if (offsetVal) {
      offsetVal.textContent = `${this.serverTimeOffset >= 0 ? '+' : ''}${this.serverTimeOffset}ms`;
    }
    if (ghostVal) {
      if (this.role !== 'imposter') {
        ghostVal.textContent = 'N/A';
        ghostVal.style.color = 'var(--text-dim)';
      } else if (this.isGhostActive) {
        ghostVal.textContent = 'ACTIVE';
        ghostVal.style.color = '#3ddc97';
      } else if (this.ghostCooldownSec > 0) {
        ghostVal.textContent = `${this.ghostCooldownSec}s`;
        ghostVal.style.color = 'var(--accent)';
      } else {
        ghostVal.textContent = 'READY';
        ghostVal.style.color = 'var(--ghost)';
      }
    }
  }

  /**
   * Display dramatic role announcement splash with clear instructions
   * @param {string} role - 'imposter' | 'decoy' | 'crew'
   */
  showRoleAnnouncement(role) {
    const splash = document.getElementById('role-reveal-splash');
    const card = document.getElementById('role-splash-card');
    const badge = document.getElementById('role-splash-badge');
    const icon = document.getElementById('role-splash-icon');
    const title = document.getElementById('role-splash-title');
    const desc = document.getElementById('role-splash-desc');
    const ability = document.getElementById('role-splash-ability');
    const countdown = document.getElementById('role-splash-countdown');
    const timerFill = document.getElementById('role-splash-timer-fill');
    const btnEnter = document.getElementById('btn-enter-darkness');
    const currentRole = (role || 'crew').toLowerCase();

    if (!splash || !card) return;

    card.className = `role-splash-card role-${currentRole}`;

    if (currentRole === 'imposter') {
      if (badge) badge.textContent = '🩸 TOP SECRET • HUNT TARGET';
      if (icon) icon.textContent = '🩸';
      if (title) title.textContent = 'YOU ARE THE IMPOSTER';
      if (desc) {
        desc.textContent = 'Your phone pulses with the False Pulse every 5 seconds. The volume increases as time expires! Blend in and survive 120s.';
      }
      if (ability) ability.style.display = 'block';
    } else if (currentRole === 'decoy') {
      if (badge) badge.textContent = '⚠️ LEVEL 3 • SPECIAL ROLE';
      if (icon) icon.textContent = '⚠️';
      if (title) title.textContent = 'YOU ARE A DECOY';
      if (desc) {
        desc.textContent = 'Your phone plays a steady, calm heartbeat pulse. You are NOT the real imposter! If the crew wrongly votes you out, you lose instantly.';
      }
      if (ability) ability.style.display = 'none';
    } else {
      if (badge) badge.textContent = '🛡️ CREW OBJECTIVE';
      if (icon) icon.textContent = '🛡️';
      if (title) title.textContent = 'YOU ARE CREWMATE';
      if (desc) {
        desc.textContent = 'Your phone plays only ambient static. Walk around the room, listen closely to other phones, and find the False Pulse before time runs out!';
      }
      if (ability) ability.style.display = 'none';
    }

    splash.style.display = 'flex';

    let secLeft = 5;
    if (this.roleSplashTimer) clearInterval(this.roleSplashTimer);
    if (countdown) countdown.textContent = `Entering darkness in ${secLeft}s...`;
    if (timerFill) {
      timerFill.style.transition = 'none';
      timerFill.style.width = '100%';
      setTimeout(() => {
        timerFill.style.transition = 'width 5s linear';
        timerFill.style.width = '0%';
      }, 50);
    }

    const dismissSplash = () => {
      if (this.roleSplashTimer) {
        clearInterval(this.roleSplashTimer);
        this.roleSplashTimer = null;
      }
      splash.style.display = 'none';
    };

    if (btnEnter) {
      btnEnter.onclick = dismissSplash;
    }

    this.roleSplashTimer = setInterval(() => {
      secLeft--;
      if (countdown) countdown.textContent = `Entering darkness in ${secLeft}s...`;
      if (secLeft <= 0) {
        dismissSplash();
      }
    }, 1000);
  }

  /**
   * Game screen touch gestures:
   * 1. Living player double-tap (< 350ms) -> spawn transient VOTE button (3s)
   * 2. Imposter hold (2s) -> trigger Ghost Phase stealth
   */
  setupGameScreenGestures() {
    const gameScreen = document.getElementById('screen-game');
    const voteBtn = document.getElementById('vote-trigger-btn');
    const ghostChargeRing = document.getElementById('ghost-charge-ring');

    if (!gameScreen) return;

    // Prevent zoom and context menu
    gameScreen.addEventListener('contextmenu', (e) => e.preventDefault());

    // Pointer down: handle double tap and ghost hold start
    gameScreen.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#vote-trigger-btn') || e.target.closest('.paranoia-ring') || e.target.closest('.blood-orb') || e.target.closest('#game-debug-trigger')) {
        return;
      }
      if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

      const now = Date.now();

      // 1. Double tap detection
      if (now - this.lastTapTime < 350) {
        this.handleDoubleTap(e);
        this.cancelGhostHold();
        this.lastTapTime = 0;
        return;
      }
      this.lastTapTime = now;

      // 2. Ghost phase hold (Imposter only)
      if (this.role === 'imposter' && !this.isGhostActive && this.ghostCooldownSec <= 0) {
        this.startGhostHold(e.clientX, e.clientY);
      }
    });

    const cancelHold = () => this.cancelGhostHold();
    gameScreen.addEventListener('pointerup', cancelHold);
    gameScreen.addEventListener('pointercancel', cancelHold);
    gameScreen.addEventListener('pointerleave', cancelHold);

    // Vote button click handler
    if (voteBtn) {
      voteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideVoteButton();
        this.triggerVoteAccusation();
      });
    }
  }

  /**
   * Handle double tap -> show VOTE button if cooldown & limits permit
   */
  handleDoubleTap(e) {
    if (!this.isAlive || this.state !== GAME_STATES.PLAYING) return;

    // Check maximum 2 votes per game
    if (this.voteCount >= 2) {
      console.log('[Voting] Max 2 votes already used this game.');
      return;
    }

    // Check 30s cooldown after last vote
    const now = Date.now() + this.serverTimeOffset;
    if (this.lastVoteEndedAt && (now - this.lastVoteEndedAt) < 30000) {
      const waitRemaining = Math.ceil((30000 - (now - this.lastVoteEndedAt)) / 1000);
      console.log(`[Voting] Cooldown active. Wait ${waitRemaining}s before voting.`);
      return;
    }

    const voteBtn = document.getElementById('vote-trigger-btn');
    if (!voteBtn) return;

    // Center VOTE button near touch point or center screen
    const x = Math.min(Math.max(60, e.clientX || window.innerWidth / 2), window.innerWidth - 60);
    const y = Math.min(Math.max(60, e.clientY || window.innerHeight / 2), window.innerHeight - 60);

    voteBtn.style.left = `${x}px`;
    voteBtn.style.top = `${y}px`;
    voteBtn.style.transform = 'translate(-50%, -50%)';
    voteBtn.style.display = 'flex';

    if (this.voteBtnTimeout) clearTimeout(this.voteBtnTimeout);
    this.voteBtnTimeout = setTimeout(() => {
      this.hideVoteButton();
    }, 3000); // Disappears after 3 seconds
  }

  hideVoteButton() {
    const voteBtn = document.getElementById('vote-trigger-btn');
    if (voteBtn) voteBtn.style.display = 'none';
    if (this.voteBtnTimeout) {
      clearTimeout(this.voteBtnTimeout);
      this.voteBtnTimeout = null;
    }
  }

  /**
   * Trigger emergency vote accusation
   */
  async triggerVoteAccusation() {
    if (!this.roomCode || this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

    try {
      console.log('[Voting] Emergency accusation triggered!');
      await triggerVotePhase(this.roomCode);
    } catch (err) {
      console.error('[Voting] Error triggering vote:', err);
    }
  }

  /**
   * Ghost Phase: Start 2-second hold charge
   */
  startGhostHold(x, y) {
    const ring = document.getElementById('ghost-charge-ring');
    if (ring) {
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.classList.add('charging');
    }

    this.ghostPressStart = Date.now();
    this.ghostHoldTimer = setTimeout(() => {
      this.activateGhostPhase();
      this.cancelGhostHold();
    }, 2000); // 2.0s hold
  }

  cancelGhostHold() {
    if (this.ghostHoldTimer) {
      clearTimeout(this.ghostHoldTimer);
      this.ghostHoldTimer = null;
    }
    const ring = document.getElementById('ghost-charge-ring');
    if (ring) {
      ring.classList.remove('charging');
    }
  }

  /**
   * Activate Ghost Phase stealth for Imposter:
   * Mutes heartbeat for 10s, then 25s cooldown. Escalation keeps advancing.
   */
  activateGhostPhase() {
    if (this.role !== 'imposter' || this.isGhostActive || this.ghostCooldownSec > 0) return;

    console.log('[Ghost] Ghost Phase activated!');
    this.isGhostActive = true;

    // Vibrate on activation
    if (navigator.vibrate) {
      try { navigator.vibrate([100, 50, 100]); } catch {}
    }

    // Audio engine mutes heartbeat for 10s
    audio.activateGhostPhase(10);

    const pill = document.getElementById('ghost-active-pill');
    if (pill) pill.style.display = 'flex';
    this.updateDebugOverlay();

    // After 10s of silence, start 25s cooldown
    setTimeout(() => {
      this.isGhostActive = false;
      if (pill) pill.style.display = 'none';

      // 25s cooldown
      this.ghostCooldownSec = 25;
      this.updateDebugOverlay();

      if (this.ghostCooldownTimer) clearInterval(this.ghostCooldownTimer);
      this.ghostCooldownTimer = setInterval(() => {
        this.ghostCooldownSec--;
        this.updateDebugOverlay();
        if (this.ghostCooldownSec <= 0) {
          clearInterval(this.ghostCooldownTimer);
          this.ghostCooldownTimer = null;
          console.log('[Ghost] Cooldown finished. Ghost Phase is ready again.');
        }
      }, 1000);
    }, 10000);
  }

  /**
   * Start active gameplay loop
   * @param {Object} roomData
   */
  async start(roomData) {
    this.roomCode = sessionStorage.getItem('fp_roomCode');
    this.playerId = sessionStorage.getItem('fp_playerId');
    this.playerName = sessionStorage.getItem('fp_playerName') || 'Player';
    this.isHost = (sessionStorage.getItem('fp_isHost') === 'true') || (roomData.hostId && roomData.hostId === this.playerId);
    this.difficulty = Number(roomData.difficulty) || Number(sessionStorage.getItem('fp_difficulty')) || 2;
    this.state = GAME_STATES.PLAYING;
    this.isAlive = true;

    this.startedAt = roomData.startedAt || Date.now();
    this.pausedTotal = roomData.pausedTotal || 0;
    this.voteCount = roomData.voteCount || 0;
    this.lastVoteEndedAt = roomData.lastVoteEndedAt || 0;
    this.players = roomData.players || {};

    console.log(`[Game] Starting hunt loop for room ${this.roomCode}. Difficulty: ${this.difficulty}, Host: ${this.isHost}`);

    // Hide dead overlay if reviving
    const deadOverlay = document.getElementById('game-dead-overlay');
    if (deadOverlay) deadOverlay.style.display = 'none';

    // 1. Acquire Screen Wake Lock
    await this.requestWakeLock();

    // 2. Listen to this player's private assigned role
    this.listenToRole();

    // 3. Start high-frequency master 120s timer
    this.startMasterTimer();

    // 4. Paranoia Tasks scheduling (Levels 2 & 3)
    if (this.difficulty >= 2) {
      this.setupParanoiaTasks();
    }

    this.updateDebugOverlay();
  }

  /**
   * Listen to this player's private role node
   */
  listenToRole() {
    if (this.roleUnsubscribe) this.roleUnsubscribe();

    if (this.roomCode && this.playerId) {
      this.roleUnsubscribe = listenToPlayerRole(this.roomCode, this.playerId, (role) => {
        this.role = role;
        console.log(`[Game] Received assigned role: ${role}`);
        this.updateDebugOverlay();
        this.showRoleAnnouncement(role);

        // Start gameplay audio once role is verified
        if (this.state === GAME_STATES.PLAYING) {
          audio.startGameplayAudio(this.role, this.startedAt, this.pausedTotal, this.serverTimeOffset);
        }
      });
    }
  }

  /**
   * Master 120-second timer loop
   */
  startMasterTimer() {
    this.stopMasterTimer();

    const tick = () => {
      if (this.state !== GAME_STATES.PLAYING) return;

      const serverNow = Date.now() + this.serverTimeOffset;
      const effectiveStart = this.startedAt || serverNow;
      const elapsed = serverNow - effectiveStart;
      const remainingMs = Math.max(0, (this.gameDurationMs + this.pausedTotal) - elapsed);

      this.remainingSeconds = Math.ceil(remainingMs / 1000);
      this.updateDebugOverlay();

      // Win Condition: 120-second timer hits zero -> Imposter wins!
      if (remainingMs <= 0) {
        console.log('[Game] 120s timer expired! Imposter wins.');
        this.handleTimerExpired();
      }
    };

    tick();
    this.timerInterval = setInterval(tick, 200);
  }

  stopMasterTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Handle timer hitting zero (Imposter Win)
   */
  async handleTimerExpired() {
    if (this.state !== GAME_STATES.PLAYING) return;
    this.state = GAME_STATES.ENDED;
    this.stopMasterTimer();
    audio.stopAll();

    if (this.isHost && this.roomCode) {
      try {
        await endGameWithResult(this.roomCode, 'imposter', 'timer_expired', this.rolesCache);
      } catch (err) {
        console.error('[Game] Error ending game on timer expiration:', err);
      }
    }
  }

  /**
   * Side Tasks System (Levels 2 and 3):
   * Falling Red Blood Orb: Descends from top of screen to bottom.
   * Players MUST tap the falling orb before it reaches the bottom!
   * Failing to tap eliminates the player with scream.mp3 and red DEAD screen.
   */
  setupParanoiaTasks() {
    this.stopParanoiaTasks();

    if (this.difficulty < 2) return; // Level 1 (Beginner) has no side tasks
    if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

    console.log(`[Side Tasks] Starting Falling Blood Orb loop for Level ${this.difficulty}`);

    const scheduleNextOrb = () => {
      if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

      // Medium (Level 2): 15s - 24s interval
      // Hard (Level 3): 10s - 18s interval
      const minDelay = this.difficulty === 3 ? 10000 : 15000;
      const varDelay = this.difficulty === 3 ? 8000 : 9000;
      const delayMs = Math.floor(minDelay + Math.random() * varDelay);

      this.paranoiaTaskTimer = setTimeout(() => {
        if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

        this.spawnFallingBloodOrb();
        scheduleNextOrb();
      }, delayMs);
    };

    // First orb drops 8-12 seconds after entering darkness
    const initialDelay = Math.floor(8000 + Math.random() * 4000);
    this.paranoiaTaskTimer = setTimeout(() => {
      if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;
      this.spawnFallingBloodOrb();
      scheduleNextOrb();
    }, initialDelay);
  }

  stopParanoiaTasks() {
    if (this.paranoiaTaskTimer) {
      clearTimeout(this.paranoiaTaskTimer);
      this.paranoiaTaskTimer = null;
    }
    if (this.activeTaskTimeout) {
      clearTimeout(this.activeTaskTimeout);
      this.activeTaskTimeout = null;
    }
    this.clearActiveRing();
  }

  /**
   * Spawn a falling red blood orb that descends from the top of the screen.
   * Player must tap it before it reaches the bottom!
   */
  spawnFallingBloodOrb(customData = null) {
    if (this.state !== GAME_STATES.PLAYING || !this.isAlive) return;

    this.clearActiveRing();

    const container = document.getElementById('paranoia-ring-container');
    if (!container) return;

    // Medium: 4.2s to fall; Hard: 3.2s to fall
    const fallDurationMs = customData?.durationMs || (this.difficulty === 3 ? 3200 : 4200);

    // Random horizontal position within safe mobile bounds (15% to 78%)
    const leftPct = customData?.xPct || Math.floor(15 + Math.random() * 63);

    const orb = document.createElement('div');
    orb.className = 'blood-orb';
    orb.setAttribute('role', 'button');
    orb.setAttribute('aria-label', 'Tap the falling blood orb!');
    orb.style.left = `${leftPct}%`;
    orb.style.animation = `orbFallLinear ${fallDurationMs}ms linear forwards`;

    let orbTapped = false;

    const handleOrbTap = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (orbTapped) return;
      orbTapped = true;

      // Haptic confirmation
      if (navigator.vibrate) {
        try { navigator.vibrate([40, 25, 60]); } catch {}
      }

      // Play burst effect
      orb.classList.add('burst');

      if (this.activeTaskTimeout) {
        clearTimeout(this.activeTaskTimeout);
        this.activeTaskTimeout = null;
      }

      console.log('[Side Task] Falling blood orb caught in time!');

      setTimeout(() => {
        if (orb.parentNode) orb.remove();
      }, 350);
    };

    orb.addEventListener('pointerdown', handleOrbTap, { passive: false });
    orb.addEventListener('touchstart', handleOrbTap, { passive: false });
    orb.addEventListener('click', handleOrbTap);

    container.appendChild(orb);

    // If the orb reaches the bottom without being tapped -> ELIMINATION!
    this.activeTaskTimeout = setTimeout(() => {
      if (!orbTapped && this.state === GAME_STATES.PLAYING && this.isAlive) {
        if (orb.parentNode) orb.remove();
        console.warn('[Side Task] Blood orb missed! Player eliminated.');
        this.eliminateThisPlayer();
      }
    }, fallDurationMs + 50);
  }

  handleParanoiaTaskSpawn(taskData) {
    if (!taskData || !taskData.id || taskData.id === this.currentTaskId) return;
    this.currentTaskId = taskData.id;
    this.spawnFallingBloodOrb(taskData);
  }

  clearActiveRing() {
    const container = document.getElementById('paranoia-ring-container');
    if (container) container.innerHTML = '';
  }

  /**
   * Eliminate this player on Paranoia Task failure:
   * Play max-volume scream, vibrate vigorously, set alive = false, show DEAD overlay
   */
  async eliminateThisPlayer() {
    if (!this.isAlive) return;
    this.isAlive = false;

    console.warn('[Game] Player failed Paranoia Task: ELIMINATED!');

    // 1. Max volume scream
    audio.playScream();

    // 2. Vigorous vibration
    if (navigator.vibrate) {
      try { navigator.vibrate([300, 100, 300, 100, 500]); } catch {}
    }

    // 3. Show dead screen overlay
    const deadOverlay = document.getElementById('game-dead-overlay');
    if (deadOverlay) deadOverlay.style.display = 'flex';

    // 4. Update in Firebase
    if (this.roomCode && this.playerId) {
      try {
        await eliminatePlayer(this.roomCode, this.playerId);
      } catch (err) {
        console.error('[Game] Error eliminating player:', err);
      }
    }

    // 5. Special Rule: If the Imposter is eliminated by a task, Crew wins!
    if (this.role === 'imposter' && this.roomCode) {
      console.log('[Game] The Imposter died in a Paranoia Task! Crew wins.');
      try {
        await endGameWithResult(this.roomCode, 'crew', 'imposter_eliminated', this.rolesCache);
      } catch (err) {}
    }
  }

  /**
   * Voting Phase: Start 15s countdown and render vote grid
   * @param {Object} roomData
   */
  startVotePhase(roomData) {
    this.state = GAME_STATES.VOTING;
    this.pausedAt = roomData.pausedAt || Date.now();
    this.voteCount = roomData.voteCount || 0;
    this.hasVoted = false;
    this.voteCountdownSec = 15;

    // 1. Audio pauses
    audio.pauseGameAudio();

    // 2. Clear paranoia rings & hide vote button
    this.stopParanoiaTasks();
    this.hideVoteButton();

    // 3. Render Voting UI
    this.renderVoteGrid(roomData.players || {});

    // 4. Start 15s countdown
    this.startVoteCountdown(roomData);
  }

  /**
   * Render grid of living players plus Skip Vote
   * @param {Object} players
   */
  renderVoteGrid(players) {
    const grid = document.getElementById('vote-players-grid');
    const skipBtn = document.getElementById('btn-skip-vote');
    const specMsg = document.getElementById('vote-spectator-msg');
    const statusBox = document.getElementById('vote-status-feedback');
    const promptText = document.getElementById('vote-prompt-text');

    if (!grid) return;
    grid.innerHTML = '';
    if (statusBox) statusBox.style.display = 'none';

    // Eliminated players cannot vote
    const canVote = this.isAlive;
    if (specMsg) specMsg.style.display = canVote ? 'none' : 'block';
    if (promptText) promptText.style.display = canVote ? 'block' : 'none';
    if (skipBtn) skipBtn.disabled = !canVote;

    // Living players only
    const living = Object.entries(players).filter(([id, p]) => p.alive !== false);
    this.livingCount = living.length;

    living.forEach(([id, p]) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'vote-card';
      card.disabled = !canVote;

      const isMe = id === this.playerId;
      const cleanName = escapeHTML(p.name || 'Anonymous');
      card.innerHTML = `
        <span style="color: #ffffff; font-weight: 800; font-size: 1.15rem; text-shadow: 0 0 10px rgba(255,255,255,0.8);">${cleanName}</span>
        ${isMe ? '<span style="font-size: 0.72rem; color: #ff9900; margin-left: 0.4rem; font-weight: 800; background: rgba(255, 153, 0, 0.2); padding: 0.15rem 0.45rem; border-radius: 4px; border: 1px solid rgba(255, 153, 0, 0.4);">(YOU)</span>' : ''}
      `;

      card.addEventListener('click', () => {
        if (!canVote || this.hasVoted) return;
        this.submitVote(id, p.name);
      });

      grid.appendChild(card);
    });

    if (skipBtn) {
      skipBtn.onclick = () => {
        if (!canVote || this.hasVoted) return;
        this.submitVote('skip', 'Skip Vote');
      };
    }
  }

  /**
   * Submit this player's vote
   */
  async submitVote(targetId, targetName) {
    if (this.hasVoted || !this.roomCode || !this.playerId) return;
    this.hasVoted = true;

    // Visual feedback
    const statusBox = document.getElementById('vote-status-feedback');
    const statusText = document.getElementById('vote-status-text');
    if (statusBox && statusText) {
      statusText.textContent = `Accused: ${targetName}. Waiting for room tally...`;
      statusBox.style.display = 'block';
    }

    // Disable grid buttons
    document.querySelectorAll('.vote-card, #btn-skip-vote').forEach(b => b.disabled = true);

    try {
      await castVote(this.roomCode, this.playerId, targetId);
    } catch (err) {
      console.error('[Voting] Error submitting vote:', err);
    }
  }

  /**
   * 15-second voting countdown bar
   */
  startVoteCountdown(roomData) {
    if (this.voteCountdownTimer) clearInterval(this.voteCountdownTimer);

    const bar = document.getElementById('vote-timer-bar');
    const countdownText = document.getElementById('vote-countdown-text');
    const totalSec = 15;
    let elapsedSec = 0;

    this.voteCountdownTimer = setInterval(async () => {
      elapsedSec++;
      const remaining = Math.max(0, totalSec - elapsedSec);
      if (countdownText) countdownText.textContent = `${remaining}s`;

      if (bar) {
        const pct = (remaining / totalSec) * 100;
        bar.style.width = `${pct}%`;
      }

      // Early completion: if all living players have already voted, tally without waiting!
      if (this.isHost && this.roomCode && elapsedSec >= 2) {
        try {
          const fresh = await getRoomSnapshot(this.roomCode);
          if (fresh && fresh.votes) {
            const votesCount = Object.keys(fresh.votes).length;
            if (votesCount >= this.livingCount && this.livingCount > 0) {
              clearInterval(this.voteCountdownTimer);
              this.voteCountdownTimer = null;
              this.tallyVotesAndConclude(fresh);
              return;
            }
          }
        } catch (err) {}
      }

      // If time runs out, host tallies votes
      if (remaining <= 0) {
        clearInterval(this.voteCountdownTimer);
        this.voteCountdownTimer = null;
        if (this.isHost) {
          this.tallyVotesAndConclude(roomData);
        }
      }
    }, 1000);
  }

  /**
   * Tally votes and determine outcome (Host only)
   * Majority on True Imposter -> Crew wins
   * Majority on innocent / Decoy -> Imposter wins (Decoy: instant loss)
   * Tie or Skip -> Resume game (Round 1), or Imposter wins if Vote 2 exhausted
   */
  async tallyVotesAndConclude(roomData) {
    if (!this.isHost || !this.roomCode) return;

    let votes = roomData?.votes || {};
    let roles = roomData?.roles || this.rolesCache || {};
    let currentVoteCount = this.voteCount || 0;

    // Fetch fresh room data directly from Firebase to guarantee complete vote tally
    try {
      const freshSnap = await getRoomSnapshot(this.roomCode);
      if (freshSnap) {
        votes = freshSnap.votes || {};
        roles = freshSnap.roles || roles;
        currentVoteCount = freshSnap.voteCount || currentVoteCount;
      }
    } catch (err) {
      console.warn('[Voting] Error fetching fresh room snapshot:', err);
    }

    const suspectTally = {};
    let skipCount = 0;

    Object.values(votes).forEach((target) => {
      if (!target) return;
      if (target === 'skip') {
        skipCount++;
      } else {
        suspectTally[target] = (suspectTally[target] || 0) + 1;
      }
    });

    let topSuspect = null;
    let maxSuspectVotes = 0;
    let isSuspectTie = false;

    for (const [suspectId, count] of Object.entries(suspectTally)) {
      if (count > maxSuspectVotes) {
        maxSuspectVotes = count;
        topSuspect = suspectId;
        isSuspectTie = false;
      } else if (count === maxSuspectVotes && count > 0) {
        isSuspectTie = true;
      }
    }

    console.log('[Voting] Tally: suspects=', suspectTally, 'skips=', skipCount, 'top=', topSuspect, 'tie=', isSuspectTie);

    // Check if a suspect received majority votes (more votes than skips and no tie among suspects)
    if (topSuspect && maxSuspectVotes > skipCount && !isSuspectTie) {
      const targetRole = roles[topSuspect] || 'crew';

      if (targetRole === 'imposter') {
        // Crew exposed the Imposter! Crew Wins!
        console.log('[Voting] True Imposter was voted out! Crew wins!');
        await endGameWithResult(this.roomCode, 'crew', 'imposter_voted_out', roles);
      } else if (targetRole === 'decoy') {
        // Voted out a Decoy! Instant Loss -> Imposter Wins!
        console.log('[Voting] Voted out a Decoy! Instant loss. Imposter wins!');
        await endGameWithResult(this.roomCode, 'imposter', 'decoy_voted_out', roles);
      } else {
        // Voted out an innocent Crewmate! Imposter Wins!
        console.log('[Voting] Voted out an innocent Crewmate. Imposter wins!');
        await endGameWithResult(this.roomCode, 'imposter', 'crew_voted_out', roles);
      }
      return;
    }

    // No suspect majority found (tied votes, skip majority, or no votes cast)
    const newVoteCount = currentVoteCount + 1;

    // RULE: Maximum 2 voting opportunities per game.
    // If both votes are now used and the Imposter was not found, IMPOSTER WINS!
    if (newVoteCount >= 2) {
      console.log('[Voting] Both voting chances exhausted. Imposter wins!');
      await endGameWithResult(this.roomCode, 'imposter', 'votes_exhausted', roles);
      return;
    }

    // Still have 1 vote remaining -> Resume hunt for final round!
    console.log(`[Voting] Vote tied/skipped. Resuming hunt (${newVoteCount}/2 votes used).`);
    const pausedDuration = Date.now() - (this.pausedAt || Date.now());
    const newPausedTotal = (this.pausedTotal || 0) + pausedDuration;
    await resumeFromVote(this.roomCode, newPausedTotal, newVoteCount);
    return;
  }

  /**
   * End Screen: Jumpscare execution (if Imposter wins) + Staggered role reveal
   * @param {Object} resultData - { winner, reason, roles }
   */
  async handleGameEnd(resultData) {
    this.state = GAME_STATES.ENDED;
    this.stopMasterTimer();
    this.stopParanoiaTasks();
    if (this.voteCountdownTimer) clearInterval(this.voteCountdownTimer);
    audio.stopAll();
    await this.releaseWakeLock();

    const winner = resultData?.winner || 'imposter';
    const reason = resultData?.reason || 'timer_expired';
    const revealedRoles = resultData?.roles || this.rolesCache;

    // 1. If Imposter Wins: Trigger Full-Screen Horror Jumpscare!
    if (winner === 'imposter') {
      await this.triggerJumpscareSequence();
    }

    // 2. Navigate to End Screen and render reveal
    router.navigate('end');
    this.renderRoleReveal(winner, reason, revealedRoles);
  }

  /**
   * Full-screen horror jumpscare sequence:
   * 2.8s shaking demon face, jumpscare.mp3 audio at max volume, intense vibration
   */
  triggerJumpscareSequence() {
    return new Promise((resolve) => {
      const jumpscareOverlay = document.getElementById('jumpscare-overlay');
      if (!jumpscareOverlay) {
        resolve();
        return;
      }

      // Max volume jumpscare audio
      audio.playJumpscare();

      // Shake & strobe
      jumpscareOverlay.classList.add('active');

      // Vibration
      if (navigator.vibrate) {
        try { navigator.vibrate([200, 50, 200, 50, 400]); } catch {}
      }

      setTimeout(() => {
        jumpscareOverlay.classList.remove('active');
        resolve();
      }, 2800);
    });
  }

  /**
   * Render End Screen role reveal cards with 600ms staggered animations
   */
  renderRoleReveal(winner, reason, roles = {}) {
    const endTitle = document.getElementById('end-title');
    const endSubtitle = document.getElementById('end-subtitle');
    const revealBox = document.getElementById('role-reveal-box');
    const btnPlayAgain = document.getElementById('btn-play-again');
    const waitingHost = document.getElementById('end-waiting-host');

    // Winner Banner
    if (winner === 'crew') {
      if (endTitle) {
        endTitle.textContent = 'CREW WINS';
        endTitle.style.color = 'var(--success)';
        endTitle.style.textShadow = '0 0 25px var(--success-glow)';
      }
      if (endSubtitle) {
        endSubtitle.textContent = reason === 'imposter_eliminated'
          ? 'The Imposter fell to the paranoia tasks.'
          : 'The True Imposter was exposed in time.';
      }
    } else {
      if (endTitle) {
        endTitle.textContent = 'IMPOSTER WINS';
        endTitle.style.color = 'var(--accent)';
        endTitle.style.textShadow = '0 0 25px var(--accent-glow-strong)';
      }
      if (endSubtitle) {
        const reasonTexts = {
          timer_expired: '120 seconds elapsed. The hunt claimed all souls.',
          decoy_voted_out: 'A Decoy was executed! Instant disaster for the Crew.',
          crew_voted_out: 'An innocent crewmate was wrongly accused.',
          votes_exhausted: 'Both voting chances were wasted. The Imposter survives!'
        };
        endSubtitle.textContent = reasonTexts[reason] || 'The darkness consumed the room.';
      }
    }

    // Role reveal cards
    if (revealBox) {
      revealBox.innerHTML = '';
      const playerEntries = Object.entries(this.players);

      playerEntries.forEach(([id, p], index) => {
        const assignedRole = roles[id] || 'crew';
        const card = document.createElement('div');
        card.className = 'role-reveal-card';

        const roleLabels = {
          imposter: 'TRUE IMPOSTER',
          decoy: 'DECOY',
          crew: 'CREW'
        };

        card.innerHTML = `
          <span style="font-weight: 700;">${p.name || 'Player'}</span>
          <span class="role-tag ${assignedRole.toLowerCase()}">${roleLabels[assignedRole] || 'CREW'}</span>
        `;

        revealBox.appendChild(card);

        // Staggered reveal animation (600ms apart)
        setTimeout(() => {
          card.classList.add('revealed');
        }, 300 + index * 600);
      });
    }

    // Host Play Again vs Guest Waiting
    if (this.isHost) {
      if (btnPlayAgain) btnPlayAgain.style.display = 'inline-flex';
      if (waitingHost) waitingHost.style.display = 'none';

      if (btnPlayAgain) {
        btnPlayAgain.onclick = async () => {
          btnPlayAgain.disabled = true;
          btnPlayAgain.textContent = 'RESETTING ROOM...';
          try {
            await resetRoomToLobby(this.roomCode, this.players);
            router.navigate('lobby');
          } catch (err) {
            console.error('[Game] Error resetting room:', err);
          } finally {
            btnPlayAgain.disabled = false;
            btnPlayAgain.textContent = 'PLAY AGAIN';
          }
        };
      }
    } else {
      if (btnPlayAgain) btnPlayAgain.style.display = 'none';
      if (waitingHost) waitingHost.style.display = 'flex';
    }
  }

  /**
   * Host Migration: If current host disconnects, transfer to earliest-joined living player
   * @param {string} currentHostId
   * @param {Object} players
   */
  async checkHostMigration(currentHostId, players = {}) {
    if (!this.roomCode || !currentHostId) return;

    // Check if current host is absent from players list
    if (!players[currentHostId]) {
      const remainingEntries = Object.entries(players);
      if (remainingEntries.length === 0) return;

      // Sort by earliest joinedAt
      remainingEntries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
      const newHostId = remainingEntries[0][0];

      console.log(`[HostMigration] Previous host ${currentHostId} left. Earliest player: ${newHostId}`);

      // If current client is the new host, claim host role
      if (this.playerId === newHostId) {
        this.isHost = true;
        sessionStorage.setItem('fp_isHost', 'true');
        await transferHost(this.roomCode, newHostId);
      }
    }
  }

  /**
   * Stop game engine completely
   */
  stop() {
    this.stopMasterTimer();
    this.stopParanoiaTasks();
    this.hideVoteButton();
    this.cancelGhostHold();
    if (this.voteCountdownTimer) clearInterval(this.voteCountdownTimer);
    if (this.ghostCooldownTimer) clearInterval(this.ghostCooldownTimer);
    audio.stopAll();
    this.releaseWakeLock();
    if (this.roleUnsubscribe) {
      this.roleUnsubscribe();
      this.roleUnsubscribe = null;
    }
    this.state = GAME_STATES.ENDED;
    console.log('[Game] Engine stopped.');
  }
}

export const game = new GameEngine();
game.init();

function escapeHTML(str) {
  return String(str || '').replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
