/**
 * firebase.js - Firebase Realtime Database & Anonymous Auth Module
 * Built using Firebase v10 Modular SDK via official Google CDN.
 * 
 * Data Model:
 * rooms/{CODE}/ {
 *   hostId,
 *   difficulty,
 *   gameState (lobby | playing | voting | ended),
 *   createdAt,
 *   startedAt,
 *   pausedAt,
 *   pausedTotal,
 *   voteCount,
 *   lastVoteEndedAt,
 *   players/{playerId}/ { name, alive, joinedAt },
 *   roles/{playerId},  <-- private per-child read rule
 *   votes/{playerId},  <-- target playerId or 'skip'
 *   tasks/current,     <-- synced paranoia ring trigger
 *   result/ { winner, reason, roles }
 * }
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { 
  getAuth, 
  signInAnonymously,
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  set, 
  get, 
  update, 
  remove, 
  onValue, 
  off, 
  serverTimestamp, 
  onDisconnect 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

// Export serverTimestamp for synchronized timing across the app
export { serverTimestamp };

/**
 * ============================================================================
 * FIREBASE CONFIGURATION PLACEHOLDER
 * Replace the values below with your Firebase project configuration credentials
 * from: Firebase Console > Project Settings > General > Your Apps (Web App)
 * ============================================================================
 */
export const firebaseConfig = {
  apiKey: "AIzaSyD5xQT90Tw1NrvmYRxWapHD4XNPA1iLUh8",
  authDomain: "false-pulse-game.firebaseapp.com",
  databaseURL: "https://false-pulse-game-default-rtdb.firebaseio.com",
  projectId: "false-pulse-game",
  storageBucket: "false-pulse-game.firebasestorage.app",
  messagingSenderId: "818499010155",
  appId: "1:818499010155:web:76852c41687e941e903b2e"
};

// Internal singletons
let _app = null;
let _auth = null;
let _db = null;

/**
 * Check if the user has replaced placeholder credentials
 */
export function isConfigured() {
  return firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";
}

/**
 * Get or initialize Firebase app, auth, and database instances
 */
export function getFirebaseInstances() {
  if (!_app) {
    if (!isConfigured()) {
      console.warn(
        "[Firebase] Configuration is using placeholder values. Update `firebaseConfig` in `js/firebase.js` with your Firebase project credentials."
      );
    }
    _app = initializeApp(firebaseConfig);
    _auth = getAuth(_app);
    _db = getDatabase(_app);
  }
  return { app: _app, auth: _auth, db: _db };
}

/**
 * Ensure the current player is authenticated anonymously.
 * Returns the player's Firebase Auth UID (playerId).
 * @returns {Promise<string>}
 */
export async function ensureAuth() {
  const { auth } = getFirebaseInstances();
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }

  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) {
        resolve(user.uid);
      } else {
        try {
          const cred = await signInAnonymously(auth);
          resolve(cred.user.uid);
        } catch (error) {
          console.error("[Firebase] Anonymous sign-in failed:", error);
          if (error.code === "auth/admin-restricted-operation") {
            const friendlyErr = new Error(
              "Anonymous Authentication is disabled in Firebase. Please enable it in Firebase Console > Authentication > Sign-in method > Anonymous > Enable."
            );
            friendlyErr.code = error.code;
            reject(friendlyErr);
            return;
          }
          reject(error);
        }
      }
    }, reject);
  });
}

/**
 * Generate a random 4-letter uppercase code (avoiding ambiguous letters like I, O)
 * @returns {string}
 */
export function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Create a new game room
 * @param {number} difficulty - 1 (Beginner), 2 (Standard), 3 (Chaos)
 * @param {string} hostName - Name of the host player
 * @param {string} [customCode] - Optional custom 4-letter room code
 * @returns {Promise<{ code: string, playerId: string, isMock?: boolean }>}
 */
export async function createRoom(difficulty = 1, hostName = "Host", customCode = null) {
  const sanitizedHostName = (hostName || "Host").trim().slice(0, 12);
  const parsedDifficulty = Number(difficulty) || 1;

  // Local preview fallback mode if API keys are placeholders
  if (!isConfigured()) {
    console.warn("[Firebase] Running in local preview mode.");
    const mockCode = (customCode || generateRoomCode()).trim().toUpperCase();
    const mockPlayerId = "host_" + Math.random().toString(36).substring(2, 8);

    sessionStorage.setItem("fp_roomCode", mockCode);
    sessionStorage.setItem("fp_playerId", mockPlayerId);
    sessionStorage.setItem("fp_playerName", sanitizedHostName);
    sessionStorage.setItem("fp_isHost", "true");
    sessionStorage.setItem("fp_difficulty", String(parsedDifficulty));

    return { code: mockCode, playerId: mockPlayerId, isMock: true };
  }

  const playerId = await ensureAuth();
  const { db } = getFirebaseInstances();

  let code = customCode ? customCode.trim().toUpperCase() : null;

  if (code) {
    if (!/^[A-Z]{4}$/.test(code)) {
      throw new Error("Room code must consist of exactly 4 uppercase letters [A-Z].");
    }
    const existingSnap = await get(ref(db, `rooms/${code}`));
    if (existingSnap.exists()) {
      throw new Error(`Room code "${code}" already exists.`);
    }
  } else {
    let attempts = 0;
    const maxAttempts = 10;
    while (!code && attempts < maxAttempts) {
      const candidate = generateRoomCode();
      const snap = await get(ref(db, `rooms/${candidate}`));
      if (!snap.exists()) {
        code = candidate;
        break;
      }
      attempts++;
    }
    if (!code) {
      throw new Error("Could not find an available 4-letter room code. Please try again.");
    }
  }

  const roomRef = ref(db, `rooms/${code}`);
  const initialRoomData = {
    hostId: playerId,
    difficulty: parsedDifficulty,
    gameState: "lobby",
    createdAt: serverTimestamp(),
    startedAt: null,
    pausedAt: null,
    pausedTotal: 0,
    voteCount: 0,
    lastVoteEndedAt: null,
    players: {
      [playerId]: {
        name: sanitizedHostName,
        alive: true,
        joinedAt: serverTimestamp()
      }
    },
    roles: {},
    votes: {},
    tasks: null,
    result: null
  };

  await set(roomRef, initialRoomData);

  // Auto-remove host player presence on disconnect
  const hostPlayerRef = ref(db, `rooms/${code}/players/${playerId}`);
  onDisconnect(hostPlayerRef).remove();

  sessionStorage.setItem("fp_roomCode", code);
  sessionStorage.setItem("fp_playerId", playerId);
  sessionStorage.setItem("fp_playerName", sanitizedHostName);
  sessionStorage.setItem("fp_isHost", "true");
  sessionStorage.setItem("fp_difficulty", String(parsedDifficulty));

  console.log(`[Firebase] Room created: ${code} by host ${playerId}`);
  return { code, playerId };
}

/**
 * Join an existing game room
 * @param {string} code - 4-letter room code
 * @param {string} playerName - Player screen name (max 12 chars)
 * @returns {Promise<{ code: string, playerId: string, roomData: Object, isMock?: boolean }>}
 */
export async function joinRoom(code, playerName) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(formattedCode)) {
    throw new Error("Invalid room code. Please enter a 4-letter uppercase code.");
  }

  const sanitizedName = (playerName || "")
    .trim()
    .replace(/[<>'"&]/g, "")
    .slice(0, 12);

  if (!sanitizedName || sanitizedName.length === 0) {
    throw new Error("Player name cannot be empty.");
  }

  if (!isConfigured()) {
    console.warn("[Firebase] Running join in local preview mode.");
    const mockPlayerId = "player_" + Math.random().toString(36).substring(2, 8);
    sessionStorage.setItem("fp_roomCode", formattedCode);
    sessionStorage.setItem("fp_playerId", mockPlayerId);
    sessionStorage.setItem("fp_playerName", sanitizedName);
    sessionStorage.setItem("fp_isHost", "false");
    return {
      code: formattedCode,
      playerId: mockPlayerId,
      roomData: { gameState: "lobby", difficulty: 2 },
      isMock: true
    };
  }

  const playerId = await ensureAuth();
  const { db } = getFirebaseInstances();

  const roomRef = ref(db, `rooms/${formattedCode}`);
  const roomSnap = await get(roomRef);

  if (!roomSnap.exists()) {
    const error = new Error(`SIGNAL LOST: Room "${formattedCode}" does not exist in the darkness.`);
    error.code = "ROOM_NOT_FOUND";
    throw error;
  }

  const roomData = roomSnap.val();
  if (roomData.gameState !== "lobby") {
    const stateMessages = {
      playing: `DOOR SEALED: The hunt in room "${formattedCode}" is already underway.`,
      voting: `ACCUSATION ACTIVE: Room "${formattedCode}" is currently voting.`,
      ended: `GRAVEYARD COLD: The game in room "${formattedCode}" has already ended.`
    };
    const error = new Error(stateMessages[roomData.gameState] || `DOOR SEALED: Room "${formattedCode}" cannot be joined right now.`);
    error.code = "ROOM_ALREADY_STARTED";
    throw error;
  }

  // Check for duplicate active player name in the room (case-insensitive)
  if (roomData.players) {
    const isDuplicate = Object.entries(roomData.players).some(
      ([id, p]) => id !== playerId && p.name && p.name.trim().toLowerCase() === sanitizedName.toLowerCase()
    );
    if (isDuplicate) {
      const error = new Error(`FALSE IDENTITY: Name "${sanitizedName}" is already claimed by someone in this room.`);
      error.code = "DUPLICATE_NAME";
      throw error;
    }
  }

  const playerRef = ref(db, `rooms/${formattedCode}/players/${playerId}`);
  const playerData = {
    name: sanitizedName,
    alive: true,
    joinedAt: serverTimestamp()
  };

  await set(playerRef, playerData);
  onDisconnect(playerRef).remove();

  sessionStorage.setItem("fp_roomCode", formattedCode);
  sessionStorage.setItem("fp_playerId", playerId);
  sessionStorage.setItem("fp_playerName", sanitizedName);
  sessionStorage.setItem("fp_isHost", String(roomData.hostId === playerId));
  sessionStorage.setItem("fp_difficulty", String(roomData.difficulty || 2));

  console.log(`[Firebase] Player ${sanitizedName} (${playerId}) joined room ${formattedCode}`);
  return { code: formattedCode, playerId, roomData };
}

/**
 * Listen for real-time room changes.
 * Reads public room properties without violating role privacy rules.
 * @param {string} code
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
export function listenToRoom(code, callback) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) return () => {};

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);

  const unsubscribe = onValue(
    roomRef,
    (snapshot) => {
      const data = snapshot.exists() ? snapshot.val() : null;
      callback(data, snapshot);
    },
    (error) => {
      console.warn(`[Firebase] Room subscription error on ${formattedCode}:`, error);
    }
  );

  return () => {
    off(roomRef);
  };
}

/**
 * Generate role assignments based on difficulty
 * Level 1 & 2: 1 Imposter, rest Crew
 * Level 3 (Chaos): 1 True Imposter, 2 Decoys, rest Crew
 * @param {string[]} playerIds
 * @param {number} difficulty
 * @returns {Record<string, "imposter" | "decoy" | "crew">}
 */
export function generateRoleAssignments(playerIds, difficulty = 2) {
  const shuffled = [...playerIds];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const roles = {};
  if (Number(difficulty) === 3) {
    shuffled.forEach((id, idx) => {
      if (idx === 0) {
        roles[id] = "imposter";
      } else if (idx === 1 || idx === 2) {
        roles[id] = "decoy";
      } else {
        roles[id] = "crew";
      }
    });
  } else {
    shuffled.forEach((id, idx) => {
      roles[id] = idx === 0 ? "imposter" : "crew";
    });
  }

  return roles;
}

/**
 * Start game with one atomic update assigning roles into private roles/{uid} node,
 * setting startedAt via serverTimestamp, and gameState = 'playing'.
 * @param {string} code
 * @returns {Promise<{ roles: Record<string, string>, startedAt: number }>}
 */
export async function startGameWithRoles(code) {
  const formattedCode = (code || "").trim().toUpperCase();

  if (!isConfigured()) {
    const hostId = sessionStorage.getItem("fp_playerId") || "mock_host";
    const difficulty = Number(sessionStorage.getItem("fp_difficulty")) || 2;
    const playerIds = [hostId, "mock_ravi", "mock_priya"];
    const rolesMap = generateRoleAssignments(playerIds, difficulty);

    sessionStorage.setItem("fp_roles", JSON.stringify(rolesMap));
    sessionStorage.setItem("fp_role", rolesMap[hostId] || "imposter");
    sessionStorage.setItem("fp_gameState", "playing");
    sessionStorage.setItem("fp_startedAt", String(Date.now()));

    return { roles: rolesMap, startedAt: Date.now() };
  }

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);
  const snap = await get(roomRef);

  if (!snap.exists()) {
    throw new Error(`Room "${formattedCode}" does not exist.`);
  }

  const roomData = snap.val();
  const players = roomData.players || {};
  const playerIds = Object.keys(players);
  const difficulty = Number(roomData.difficulty) || 2;
  const minRequired = difficulty === 3 ? 5 : 3;

  if (playerIds.length < minRequired) {
    throw new Error(`Cannot start. Minimum ${minRequired} players required (currently ${playerIds.length}).`);
  }

  const rolesMap = generateRoleAssignments(playerIds, difficulty);

  // Single atomic update
  const atomicPayload = {
    gameState: "playing",
    startedAt: serverTimestamp(),
    pausedAt: null,
    pausedTotal: 0,
    voteCount: 0,
    lastVoteEndedAt: null,
    roles: rolesMap,
    votes: null,
    tasks: null,
    result: null
  };

  await update(roomRef, atomicPayload);
  console.log(`[Firebase] Game started atomically for room ${formattedCode}`);
  return { roles: rolesMap, startedAt: Date.now() };
}

/**
 * Listen to this player's private role node: rooms/{CODE}/roles/{playerId}
 * @param {string} code
 * @param {string} playerId
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export function listenToPlayerRole(code, playerId, callback) {
  const formattedCode = (code || "").trim().toUpperCase();

  if (!isConfigured()) {
    const savedRole = sessionStorage.getItem("fp_role") || "crew";
    callback(savedRole);
    return () => {};
  }

  const { db } = getFirebaseInstances();
  const roleRef = ref(db, `rooms/${formattedCode}/roles/${playerId}`);

  const unsubscribe = onValue(roleRef, (snap) => {
    const role = snap.exists() ? snap.val() : null;
    if (role) {
      sessionStorage.setItem("fp_role", role);
      callback(role);
    }
  });

  return () => {
    off(roleRef);
  };
}

/**
 * Trigger Voting Phase: sets gameState = 'voting' and pausedAt = serverTimestamp()
 * @param {string} code
 */
export async function triggerVotePhase(code) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) {
    sessionStorage.setItem("fp_gameState", "voting");
    return;
  }

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);

  await update(roomRef, {
    gameState: "voting",
    pausedAt: serverTimestamp(),
    votes: null
  });
  console.log(`[Firebase] Vote phase triggered for room ${formattedCode}`);
}

/**
 * Submit player vote (accused playerId or 'skip')
 * @param {string} code
 * @param {string} playerId
 * @param {string} targetVote - target player ID or 'skip'
 */
export async function castVote(code, playerId, targetVote) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) return;

  const { db } = getFirebaseInstances();
  const voteRef = ref(db, `rooms/${formattedCode}/votes/${playerId}`);
  await set(voteRef, targetVote);
  console.log(`[Firebase] Player ${playerId} voted: ${targetVote}`);
}

/**
 * Resume game from vote phase
 * @param {string} code
 * @param {number} newPausedTotal
 * @param {number} newVoteCount
 */
export async function resumeFromVote(code, newPausedTotal, newVoteCount) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) {
    sessionStorage.setItem("fp_gameState", "playing");
    return;
  }

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);

  await update(roomRef, {
    gameState: "playing",
    pausedAt: null,
    pausedTotal: newPausedTotal,
    voteCount: newVoteCount,
    lastVoteEndedAt: serverTimestamp(),
    votes: null
  });
  console.log(`[Firebase] Game resumed after vote. PausedTotal: ${newPausedTotal}ms, VoteCount: ${newVoteCount}`);
}

/**
 * Spawn a Paranoia Task ring for Level 2 & 3
 * @param {string} code
 * @param {Object} taskData
 */
export async function spawnParanoiaTask(code, taskData) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) return;

  const { db } = getFirebaseInstances();
  const taskRef = ref(db, `rooms/${formattedCode}/tasks/current`);
  await set(taskRef, taskData);
}

/**
 * Clear the current Paranoia Task
 * @param {string} code
 */
export async function clearParanoiaTask(code) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) return;

  const { db } = getFirebaseInstances();
  const taskRef = ref(db, `rooms/${formattedCode}/tasks/current`);
  await remove(taskRef);
}

/**
 * Eliminate a player (alive = false)
 * @param {string} code
 * @param {string} playerId
 */
export async function eliminatePlayer(code, playerId) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) return;

  const { db } = getFirebaseInstances();
  const playerRef = ref(db, `rooms/${formattedCode}/players/${playerId}`);
  await update(playerRef, { alive: false });
  console.log(`[Firebase] Player ${playerId} eliminated.`);
}

/**
 * End game with winner, reason, and revealed roles
 * @param {string} code
 * @param {"crew" | "imposter"} winner
 * @param {string} reason
 * @param {Object} revealedRoles
 */
export async function endGameWithResult(code, winner, reason, revealedRoles) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) {
    sessionStorage.setItem("fp_gameState", "ended");
    sessionStorage.setItem("fp_result", JSON.stringify({ winner, reason, roles: revealedRoles }));
    return;
  }

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);

  await update(roomRef, {
    gameState: "ended",
    result: {
      winner,
      reason,
      roles: revealedRoles
    }
  });
  console.log(`[Firebase] Game ended in room ${formattedCode}: ${winner} won (${reason})`);
}

/**
 * Reset room back to lobby for Host "Play Again"
 * @param {string} code
 * @param {Object} players
 */
export async function resetRoomToLobby(code, players = {}) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured()) {
    sessionStorage.setItem("fp_gameState", "lobby");
    sessionStorage.removeItem("fp_result");
    sessionStorage.removeItem("fp_startedAt");
    return;
  }

  const { db } = getFirebaseInstances();
  const roomRef = ref(db, `rooms/${formattedCode}`);

  // Revive all players to alive = true
  const revivedPlayers = {};
  Object.entries(players).forEach(([id, p]) => {
    revivedPlayers[id] = {
      name: p.name || "Player",
      alive: true,
      joinedAt: p.joinedAt || Date.now()
    };
  });

  await update(roomRef, {
    gameState: "lobby",
    startedAt: null,
    pausedAt: null,
    pausedTotal: 0,
    voteCount: 0,
    lastVoteEndedAt: null,
    roles: null,
    votes: null,
    tasks: null,
    result: null,
    players: revivedPlayers
  });
  console.log(`[Firebase] Room ${formattedCode} reset to lobby for Play Again.`);
}

/**
 * Host migration: transfer host role to the earliest-joined remaining player
 * @param {string} code
 * @param {string} newHostId
 */
export async function transferHost(code, newHostId) {
  const formattedCode = (code || "").trim().toUpperCase();
  if (!isConfigured() || !newHostId) return;

  const { db } = getFirebaseInstances();
  const hostRef = ref(db, `rooms/${formattedCode}/hostId`);
  await set(hostRef, newHostId);
  console.log(`[Firebase] Host transferred to player: ${newHostId}`);
}

/**
 * Remove player from room (leave or kick)
 * @param {string} code
 * @param {string} playerId
 */
export async function removePlayer(code, playerId) {
  const formattedCode = (code || "").trim().toUpperCase();
  const targetId = playerId || (await ensureAuth());

  if (!isConfigured()) return;

  const { db } = getFirebaseInstances();
  const playerRef = ref(db, `rooms/${formattedCode}/players/${targetId}`);
  await remove(playerRef);
}

/**
 * Listen to Firebase server time offset (.info/serverTimeOffset)
 * @param {Function} callback
 * @returns {Function} Unsubscribe
 */
export function listenToServerTimeOffset(callback) {
  if (!isConfigured()) {
    callback(0);
    return () => {};
  }
  const { db } = getFirebaseInstances();
  const offsetRef = ref(db, ".info/serverTimeOffset");
  return onValue(offsetRef, (snap) => {
    const offset = snap.val() || 0;
    callback(offset);
  });
}
