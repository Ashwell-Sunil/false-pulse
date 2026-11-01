/**
 * audio.js - Web Audio API Engine
 * Aligned with GDD.md, PRD.md, and TRD.md:
 * - Single shared AudioContext unlocked on user gesture (iOS Safari requirement)
 * - Buffers preloaded for static, heartbeat_imposter, heartbeat_decoy, scream, jumpscare
 * - Procedural synthesis fallbacks so audio is 100% resilient
 * - Static loop for everyone at gain 0.3
 * - Sample-accurate heartbeat scheduling via AudioContext.currentTime synced with server clock
 * - Imposter heartbeat: gain 0.4 rising 0.025 per pulse every 5s up to 1.0 at 120s
 * - Decoy heartbeat: steady gain 0.4 every 5s
 * - Crew: static only
 * - Ghost Phase: muting heartbeat for 10s while escalation keeps advancing
 * - Max volume scream on elimination & jumpscare on imposter win
 */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.isUnlocked = false;
    this.buffers = new Map();
    this.isPreloaded = false;

    // Active nodes
    this.staticSource = null;
    this.staticGain = null;

    // Scheduler state
    this.role = null; // 'imposter' | 'decoy' | 'crew'
    this.startedAt = null;
    this.pausedTotal = 0;
    this.serverTimeOffset = 0;
    this.isGhostMuted = false;
    this.ghostMutedUntilAudioTime = 0;

    this.schedulerRafId = null;
    this.lastScheduledPulseIndex = -1;
    this.activePulseNodes = [];

    // Track audio loading state
    this.preloadPromise = null;
  }

  /**
   * Unlock AudioContext on user gesture (mandatory for iOS Safari)
   */
  async unlock() {
    if (this.isUnlocked && this.ctx && this.ctx.state === 'running') {
      return this.ctx;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn('[Audio] Web Audio API is not supported in this browser.');
        return null;
      }

      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }

      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      // iOS Safari priming: play 1-sample micro buffer to unlock hardware output
      try {
        const primeBuf = this.ctx.createBuffer(1, 1, 22050);
        const primeSrc = this.ctx.createBufferSource();
        primeSrc.buffer = primeBuf;
        primeSrc.connect(this.ctx.destination);
        primeSrc.start(0);
      } catch (e) {
        // Non-critical
      }

      this.isUnlocked = true;
      console.log('[Audio] AudioContext unlocked and primed for mobile playback.');

      // Preload assets if not done
      this.preload();

      return this.ctx;
    } catch (err) {
      console.error('[Audio] Failed to unlock AudioContext:', err);
      return null;
    }
  }

  /**
   * Preload audio files from /audio directory with automatic procedural synthesis fallback
   */
  async preload() {
    if (this.isPreloaded || this.preloadPromise) {
      return this.preloadPromise;
    }

    const manifest = {
      static: ['audio/static.mp3', 'audio/static.mpeg.mp3', 'audio/static.mpeg', 'audio/static.wav'],
      heartbeat_imposter: ['audio/heartbeat_imposter.mp3', 'audio/heartbeat_imposter.mpeg', 'audio/heartbeat_imposter.wav'],
      heartbeat_decoy: ['audio/heartbeat_decoy.mp3', 'audio/heartbeat_decoy.wav'],
      scream: ['audio/scream.mp3', 'audio/scream.wav'],
      jumpscare: ['audio/jumpscare.mp3', 'audio/jumpscare.wav']
    };

    this.preloadPromise = (async () => {
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }

      for (const [key, paths] of Object.entries(manifest)) {
        let loadedBuffer = null;

        for (const p of paths) {
          try {
            const resp = await fetch(p);
            if (resp.ok) {
              const arrayBuffer = await resp.arrayBuffer();
              loadedBuffer = await this.ctx.decodeAudioData(arrayBuffer);
              if (loadedBuffer) break;
            }
          } catch (fetchErr) {
            // Try next path
          }
        }

        if (loadedBuffer) {
          this.buffers.set(key, loadedBuffer);
          console.log(`[Audio] Loaded buffer: ${key}`);
        } else {
          // Synthesize high-quality procedural buffer as fallback
          console.warn(`[Audio] Asset ${key} could not be loaded via fetch; synthesizing procedural buffer.`);
          const synthBuffer = this.synthesizeBuffer(key);
          if (synthBuffer) {
            this.buffers.set(key, synthBuffer);
          }
        }
      }

      this.isPreloaded = true;
    })();

    return this.preloadPromise;
  }

  /**
   * Procedural sound buffer synthesis for 100% offline and fallback reliability
   * @param {string} type
   * @returns {AudioBuffer}
   */
  synthesizeBuffer(type) {
    if (!this.ctx) return null;
    const sampleRate = this.ctx.sampleRate || 44100;

    if (type === 'static') {
      const duration = 2.5;
      const count = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, count, sampleRate);
      const data = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < count; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99 * b0 + w * 0.05;
        b1 = 0.95 * b1 + w * 0.03;
        b2 = 0.90 * b2 + w * 0.02;
        let s = (b0 + b1 + b2) * 0.4;
        const fade = 2000;
        if (i < fade) {
          const a = i / fade;
          s = s * a + data[count - fade + i] * (1 - a);
        }
        data[i] = s;
      }
      return buf;
    }

    if (type === 'heartbeat_imposter') {
      const duration = 1.0;
      const count = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, count, sampleRate);
      const data = buf.getChannelData(0);

      const thump = (offsetSec, peakFreq, durSec, amp) => {
        const start = Math.floor(offsetSec * sampleRate);
        const len = Math.floor(durSec * sampleRate);
        for (let i = 0; i < len && (start + i) < count; i++) {
          const t = i / sampleRate;
          const prog = i / len;
          const env = Math.sin(prog * Math.PI) * Math.exp(-prog * 4.5);
          const freq = peakFreq * (1 - prog * 0.4);
          data[start + i] += Math.sin(2 * Math.PI * freq * t) * env * amp;
        }
      };

      thump(0.04, 75, 0.22, 0.95);
      thump(0.32, 60, 0.25, 0.85);
      return buf;
    }

    if (type === 'heartbeat_decoy') {
      const duration = 1.0;
      const count = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, count, sampleRate);
      const data = buf.getChannelData(0);

      const decoyThump = (offsetSec, freq, durSec, amp) => {
        const start = Math.floor(offsetSec * sampleRate);
        const len = Math.floor(durSec * sampleRate);
        for (let i = 0; i < len && (start + i) < count; i++) {
          const t = i / sampleRate;
          const prog = i / len;
          const env = Math.sin(prog * Math.PI) * Math.exp(-prog * 6);
          const val = (Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(4 * Math.PI * freq * t)) * env * amp;
          data[start + i] += val;
        }
      };

      decoyThump(0.05, 140, 0.18, 0.7);
      decoyThump(0.28, 120, 0.16, 0.55);
      return buf;
    }

    if (type === 'scream') {
      const duration = 2.0;
      const count = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, count, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < count; i++) {
        const t = i / sampleRate;
        const prog = t / duration;
        const env = Math.min(1, t * 20) * Math.exp(-prog * 2.2);
        const mod = Math.sin(2 * Math.PI * 18 * t) * 200;
        const f1 = 850 + mod - prog * 200;
        const f2 = 1200 + mod * 1.5 - prog * 300;
        const noise = (Math.random() * 2 - 1) * 0.35;
        const s = (Math.sin(2 * Math.PI * f1 * t) * 0.4 + Math.sin(2 * Math.PI * f2 * t) * 0.3 + noise) * env;
        data[i] = Math.tanh(s * 1.8);
      }
      return buf;
    }

    if (type === 'jumpscare') {
      const duration = 2.5;
      const count = Math.floor(sampleRate * duration);
      const buf = this.ctx.createBuffer(1, count, sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < count; i++) {
        const t = i / sampleRate;
        const prog = t / duration;
        const env = Math.min(1, t * 50) * Math.exp(-prog * 2.5);
        const sub = Math.sin(2 * Math.PI * Math.max(35, 140 - t * 60) * t) * 0.7;
        const roar = Math.sin(2 * Math.PI * (420 + Math.sin(2 * Math.PI * 45 * t) * 250) * t) * 0.5;
        const noise = (Math.random() * 2 - 1) * Math.exp(-prog * 4) * 0.8;
        data[i] = Math.max(-1, Math.min(1, (sub + roar + noise) * env * 2.2));
      }
      return buf;
    }

    return null;
  }

  /**
   * Start looping static ambient sound at gain 0.3 (for all players)
   */
  startStatic() {
    this.stopStatic();
    if (!this.ctx) return;

    const buffer = this.buffers.get('static');
    if (!buffer) return;

    try {
      this.staticSource = this.ctx.createBufferSource();
      this.staticSource.buffer = buffer;
      this.staticSource.loop = true;

      this.staticGain = this.ctx.createGain();
      this.staticGain.gain.setValueAtTime(0.3, this.ctx.currentTime);

      this.staticSource.connect(this.staticGain);
      this.staticGain.connect(this.ctx.destination);
      this.staticSource.start();
      console.log('[Audio] Ambient static loop started at gain 0.3');
    } catch (err) {
      console.error('[Audio] Error starting static loop:', err);
    }
  }

  /**
   * Stop ambient static loop
   */
  stopStatic() {
    if (this.staticSource) {
      try {
        this.staticSource.stop();
        this.staticSource.disconnect();
      } catch (e) {}
      this.staticSource = null;
    }
    if (this.staticGain) {
      try {
        this.staticGain.disconnect();
      } catch (e) {}
      this.staticGain = null;
    }
  }

  /**
   * Start master gameplay audio loop
   * @param {string} role - 'imposter' | 'decoy' | 'crew'
   * @param {number} startedAt - Room startedAt server timestamp
   * @param {number} pausedTotal - Accumulated paused milliseconds
   * @param {number} serverTimeOffset - Clock offset from Firebase
   */
  startGameplayAudio(role, startedAt, pausedTotal = 0, serverTimeOffset = 0) {
    this.role = role;
    this.startedAt = startedAt;
    this.pausedTotal = pausedTotal;
    this.serverTimeOffset = serverTimeOffset;

    // 1. Start static for all players at gain 0.3
    this.startStatic();

    // 2. Start heartbeat clock scheduler (Imposter & Decoy only)
    this.stopHeartbeatScheduler();
    this.lastScheduledPulseIndex = -1;

    if (role === 'imposter' || role === 'decoy') {
      this.startHeartbeatScheduler();
    }

    console.log(`[Audio] Gameplay audio started for role: ${role}`);
  }

  /**
   * Schedule heartbeat pulses using AudioContext time synced to server clock
   */
  startHeartbeatScheduler() {
    const PULSE_INTERVAL_MS = 5000; // strictly every 5 seconds
    const LOOKAHEAD_SEC = 1.5;

    const scheduleTick = () => {
      if (!this.ctx || !this.startedAt) return;

      const serverNow = Date.now() + this.serverTimeOffset;
      const effectiveStart = this.startedAt + this.pausedTotal;
      const audioNow = this.ctx.currentTime;

      // Determine the earliest pulse index to schedule
      const currentElapsedMs = serverNow - effectiveStart;
      const currentPulseIndex = Math.floor(currentElapsedMs / PULSE_INTERVAL_MS);

      // Schedule pulses within lookahead window
      for (let p = Math.max(0, currentPulseIndex); p <= 24; p++) {
        if (p <= this.lastScheduledPulseIndex) continue;

        const pulseServerTime = effectiveStart + (p * PULSE_INTERVAL_MS);
        const timeUntilPulseSec = (pulseServerTime - serverNow) / 1000;
        const targetAudioTime = audioNow + timeUntilPulseSec;

        // If pulse is in the future within the lookahead window
        if (targetAudioTime >= audioNow - 0.05 && targetAudioTime <= audioNow + LOOKAHEAD_SEC) {
          this.schedulePulse(p, Math.max(audioNow, targetAudioTime));
          this.lastScheduledPulseIndex = p;
        } else if (targetAudioTime > audioNow + LOOKAHEAD_SEC) {
          // Pulses further ahead will be scheduled in subsequent frames
          break;
        }
      }

      this.schedulerRafId = requestAnimationFrame(scheduleTick);
    };

    scheduleTick();
  }

  /**
   * Schedule a single heartbeat pulse at targetAudioTime
   * @param {number} pulseIndex - 0 to 24 (corresponds to 0s to 120s)
   * @param {number} targetAudioTime - AudioContext.currentTime target
   */
  schedulePulse(pulseIndex, targetAudioTime) {
    if (!this.ctx) return;

    let bufferKey = 'heartbeat_imposter';
    let baseGain = 0.4;

    if (this.role === 'imposter') {
      bufferKey = 'heartbeat_imposter';
      // Gain starts at 0.4 and rises 0.025 per pulse to 1.0 at 120s (pulse index 24)
      baseGain = Math.min(1.0, 0.4 + (0.025 * pulseIndex));
    } else if (this.role === 'decoy') {
      bufferKey = 'heartbeat_decoy';
      // Decoys have a steady heartbeat that never changes volume (gain 0.4)
      baseGain = 0.4;
    } else {
      return; // Crew hear nothing
    }

    const buffer = this.buffers.get(bufferKey);
    if (!buffer) return;

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      const gainNode = this.ctx.createGain();

      // Check if Ghost Phase is currently active for this pulse
      const isMuted = (this.role === 'imposter' && this.isGhostMuted && targetAudioTime < this.ghostMutedUntilAudioTime);
      const finalGain = isMuted ? 0.0 : baseGain;

      gainNode.gain.setValueAtTime(finalGain, targetAudioTime);

      src.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      src.start(targetAudioTime);

      this.activePulseNodes.push({ src, gainNode, targetAudioTime });

      // Clean up reference after playback
      src.onended = () => {
        const idx = this.activePulseNodes.findIndex(n => n.src === src);
        if (idx !== -1) this.activePulseNodes.splice(idx, 1);
      };

      console.log(`[Audio] Scheduled pulse #${pulseIndex} at ${targetAudioTime.toFixed(2)}s (Gain: ${finalGain.toFixed(3)}${isMuted ? ' [GHOST MUTED]' : ''})`);
    } catch (err) {
      console.error('[Audio] Error scheduling heartbeat pulse:', err);
    }
  }

  /**
   * Activate Ghost Phase stealth for Imposter:
   * Heartbeat is muted for exactly 10 seconds.
   * Escalation index keeps advancing in the background.
   */
  activateGhostPhase(durationSec = 10) {
    if (this.role !== 'imposter' || !this.ctx) return;

    this.isGhostMuted = true;
    this.ghostMutedUntilAudioTime = this.ctx.currentTime + durationSec;

    // Immediately mute any active or pending pulses
    this.activePulseNodes.forEach(({ gainNode, targetAudioTime }) => {
      if (targetAudioTime < this.ghostMutedUntilAudioTime) {
        try {
          gainNode.gain.cancelScheduledValues(this.ctx.currentTime);
          gainNode.gain.setValueAtTime(0.0, this.ctx.currentTime);
        } catch (e) {}
      }
    });

    console.log(`[Audio] Ghost Phase activated: heartbeat muted for ${durationSec}s`);

    // Reset mute state after duration
    setTimeout(() => {
      this.isGhostMuted = false;
      console.log('[Audio] Ghost Phase finished: heartbeat un-muted at current escalation volume.');
    }, durationSec * 1000);
  }

  /**
   * Stop scheduled pulses and scheduler loop
   */
  stopHeartbeatScheduler() {
    if (this.schedulerRafId) {
      cancelAnimationFrame(this.schedulerRafId);
      this.schedulerRafId = null;
    }
    this.activePulseNodes.forEach(({ src, gainNode }) => {
      try {
        src.stop();
        src.disconnect();
        gainNode.disconnect();
      } catch (e) {}
    });
    this.activePulseNodes = [];
  }

  /**
   * Pause all game audio (used during Voting phase)
   */
  pauseGameAudio() {
    this.stopStatic();
    this.stopHeartbeatScheduler();
    console.log('[Audio] Game audio paused for voting phase.');
  }

  /**
   * Resume game audio after a vote resumes
   */
  resumeGameAudio(role, startedAt, pausedTotal = 0, serverTimeOffset = 0) {
    this.startGameplayAudio(role, startedAt, pausedTotal, serverTimeOffset);
  }

  /**
   * Play max-volume scream (Paranoia Task elimination)
   */
  playScream() {
    this.playOneShot('scream', 1.0);
  }

  /**
   * Play max-volume jumpscare audio (Imposter win)
   */
  playJumpscare() {
    this.playOneShot('jumpscare', 1.0);
  }

  /**
   * Play one-shot audio buffer at specified gain
   * @param {string} bufferKey
   * @param {number} gainValue
   */
  playOneShot(bufferKey, gainValue = 1.0) {
    if (!this.ctx) return;
    const buffer = this.buffers.get(bufferKey);
    if (!buffer) return;

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      const gainNode = this.ctx.createGain();
      gainNode.gain.setValueAtTime(gainValue, this.ctx.currentTime);

      src.connect(gainNode);
      gainNode.connect(this.ctx.destination);
      src.start();
      console.log(`[Audio] Played one-shot: ${bufferKey} at gain ${gainValue}`);
    } catch (err) {
      console.error(`[Audio] Error playing one-shot ${bufferKey}:`, err);
    }
  }

  /**
   * Stop all audio completely
   */
  stopAll() {
    this.stopStatic();
    this.stopHeartbeatScheduler();
    this.isGhostMuted = false;
    console.log('[Audio] All audio stopped.');
  }
}

export const audio = new AudioEngine();
