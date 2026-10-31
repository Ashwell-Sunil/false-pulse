/**
 * router.js - Client-Side Screen Router
 * Manages mobile-first screen views: home, join, lobby, game, vote, end.
 * Ensures exactly one screen is visible at any given time.
 */

export const SCREENS = ['home', 'create', 'join', 'lobby', 'game', 'vote', 'end'];

class Router {
  constructor() {
    this.currentScreen = null;
    this.listeners = [];
  }

  /**
   * Initialize screen router, event listeners, and hash navigation
   */
  init() {
    // 1. Check if URL has ?room=CODE (e.g. from QR scan)
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
      const code = roomParam.trim().toUpperCase().slice(0, 4);
      sessionStorage.setItem('fp_auto_join_code', code);
      this.navigate('join', false);
      return;
    }

    // 2. Listen for hash change for deep-linking and browser navigation
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '').trim();
      if (SCREENS.includes(hash)) {
        this.navigate(hash, false);
      }
    });

    // 3. Handle initial route
    const initialHash = window.location.hash.replace('#', '').trim();
    if (SCREENS.includes(initialHash)) {
      this.navigate(initialHash, false);
    } else {
      this.navigate('home', false);
    }
  }

  /**
   * Navigate to a screen
   * @param {string} screenId - Target screen ('home' | 'join' | 'lobby' | 'game' | 'vote' | 'end')
   * @param {boolean} updateHash - Whether to update window.location.hash
   */
  navigate(screenId, updateHash = true) {
    if (!SCREENS.includes(screenId)) {
      console.warn(`[Router] Unknown screen: "${screenId}". Defaulting to "home".`);
      screenId = 'home';
    }

    // Hide all screens
    SCREENS.forEach((id) => {
      const el = document.getElementById(`screen-${id}`);
      if (el) {
        el.classList.remove('active');
      }
    });

    // Show target screen
    const targetEl = document.getElementById(`screen-${screenId}`);
    if (targetEl) {
      targetEl.classList.add('active');
    }

    this.currentScreen = screenId;

    if (updateHash && window.location.hash !== `#${screenId}`) {
      window.location.hash = screenId;
    }


    // Notify listeners
    this.listeners.forEach((fn) => fn(screenId));
    console.log(`[Router] Navigated to screen: "${screenId}"`);
  }

  /**
   * Get the active screen name
   * @returns {string}
   */
  getCurrentScreen() {
    return this.currentScreen;
  }

  /**
   * Subscribe to route change events
   * @param {Function} callback
   */
  onRouteChange(callback) {
    this.listeners.push(callback);
  }
}

export const router = new Router();

// Automatically initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => router.init());
} else {
  router.init();
}
