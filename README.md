# False Pulse 🩸

> **Spookathon — Track 4: Make Room for Play**  
> An in-person, room-scale social deduction mobile web game. Screens drop to pitch black, static fills the room, and one player carries a hidden pulse. Walk around, listen to each other's phones, and find the Imposter before time runs out.

---

## 🎮 How to Play

1. **Host** taps **Create Room**, selects a difficulty level (1, 2, or 3), and shows the large QR code.
2. **Players** scan the QR code with their mobile cameras, enter their name (max 12 characters), check the mandatory **"My phone volume is at MAX & unmuted"** box, and join.
3. Host taps **Start Game**. All screens plunge to pitch black `#000000` simultaneously.
4. **Listen**:
   - Everyone hears ambient static (`gain 0.3`).
   - The **Imposter** hears an escalating heartbeat every 5 seconds (`gain 0.4` rising to `1.0`).
   - In **Level 3 (Chaos)**, two **Decoys** hear a steady, un-escalating pulse (`gain 0.4`). Voting out a Decoy is an instant loss!
5. **Accuse**: Living players double-tap their black screen to summon the glowing **VOTE** button (3s window).
6. **Elimination & Win Conditions**:
   - **Crew Wins**: Majority vote exposes the True Imposter, or the Imposter fails a Paranoia Task.
   - **Imposter Wins**: 120s timer expires, or the room votes out an innocent crewmate / Decoy. On Imposter win, a full-screen horror jumpscare detonates on every phone!

| Level | Name | Description |
| :--- | :--- | :--- |
| **1** | **Beginner** | 1 Imposter. Pure listening & physical deduction. Min 3 players. |
| **2** | **Standard** | 1 Imposter + Paranoia Tasks (shrinking white rings appear; tap in time or be eliminated with a bloodcurdling scream). Min 3 players. |
| **3** | **Chaos** | 1 True Imposter, 2 Decoys + Paranoia Tasks. Accusing a Decoy loses the game instantly. Min 5 players. |

---

## 🛠️ Architecture & Tech Stack

- **Frontend**: Plain HTML5, CSS3, Vanilla ES Modules (Zero build step, zero dependencies).
- **Backend / Realtime Sync**: Firebase Realtime Database + Anonymous Authentication (Modular SDK v10 via CDN).
- **Audio Engine**: Web Audio API with synchronized clock scheduling via `AudioContext.currentTime` (immune to `setInterval` drift), procedural fallback synthesis, and iOS Safari unlock.
- **Hardware Integration**: Screen Wake Lock API (keeps mobile screens awake in darkness), Web Vibration API.
- **Hosting**: Vercel (static HTTPS).

---

## 📁 Project Directory Structure

```text
false-pulse/
├── index.html              # Main single-page application & mobile viewports
├── README.md               # Setup & testing guide
├── vercel.json             # Vercel deployment & media headers
├── firebase.rules.json     # Firebase security rules with child-level role privacy
├── database.rules.json     # Synced database rules
├── audio/                  # Audio sound files
│   ├── static.mp3          # Ambient room static loop (gain 0.3)
│   ├── heartbeat_imposter.mp3 # Escalating heartbeat (gain 0.4 -> 1.0)
│   ├── heartbeat_decoy.mp3 # Steady decoy pulse (gain 0.4)
│   ├── scream.mp3          # Max volume elimination scream (gain 1.0)
│   └── jumpscare.mp3       # Max volume jumpscare roar (gain 1.0)
├── design/                 # Visual assets & mockups
│   └── jumpscare.jpg       # Full-screen horror jumpscare image
├── css/
│   ├── theme.css           # Color tokens, typography, insets
│   └── main.css            # Responsive layout, animations, horror styling
├── docs/                   # Specifications (GDD, PRD, TRD, APP_FLOW, DESIGN, etc.)
└── js/
    ├── firebase.js         # Firebase config, RTDB queries, role assignment, voting
    ├── audio.js            # Web Audio API engine & clock-synced scheduler
    ├── game.js             # 120s timer, wake lock, tasks, voting tally, ghost phase
    ├── router.js           # Screen router (home, create, join, lobby, game, vote, end)
    └── ui.js               # DOM controller, QR rendering, event listeners
```

---

## 🚀 Setup Steps

### 1. Firebase Setup

1. Go to the [Firebase Console](https://console.firebase.google.com/) and create a new project (e.g. `false-pulse-game`).
2. **Enable Realtime Database**:
   - In the left sidebar, navigate to **Build > Realtime Database** and click **Create Database**.
   - Select your nearest region and start in **Locked Mode**.
3. **Enable Anonymous Authentication**:
   - Navigate to **Build > Authentication > Sign-in method**.
   - Click **Anonymous**, toggle **Enable**, and save.
4. **Deploy Security Rules**:
   - In Realtime Database, click the **Rules** tab.
   - Copy the contents of [`firebase.rules.json`](file:///C:/Users/ASUS/.gemini/antigravity-ide/scratch/false-pulse/firebase.rules.json) and paste it into the editor.
   - Click **Publish**.  
   *(Notice: These rules enforce per-child read security so nobody can inspect another phone's private role node during the game).*
5. **Add Web App Credentials**:
   - In Project Settings (**Gear Icon > Project settings > General**), scroll down to **Your apps** and click the `</>` (Web) icon.
   - Register the app and copy the `firebaseConfig` object.
   - Open [`js/firebase.js`](file:///C:/Users/ASUS/.gemini/antigravity-ide/scratch/false-pulse/js/firebase.js) and replace the placeholder credentials:
     ```javascript
     export const firebaseConfig = {
       apiKey: "AIzaSy...",
       authDomain: "false-pulse.firebaseapp.com",
       databaseURL: "https://false-pulse-default-rtdb.firebaseio.com",
       projectId: "false-pulse",
       storageBucket: "false-pulse.appspot.com",
       messagingSenderId: "1234567890",
       appId: "1:1234567890:web:abcdef"
     };
     ```

---

### 2. Vercel Deployment

1. Initialize Git in the project and push to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "False Pulse Complete Game"
   git branch -M main
   git remote add origin https://github.com/<your-username>/false-pulse.git
   git push -u origin main
   ```
2. Log into [Vercel](https://vercel.com/) and click **Add New Project**.
3. Import your GitHub repository.
4. Set the Framework Preset to **Other** (Root directory `./`).
5. Click **Deploy**.
6. **Authorize Vercel Domain in Firebase**:
   - Go to **Firebase Console > Authentication > Settings > Authorized domains**.
   - Click **Add domain** and paste your Vercel deployment URL (e.g. `false-pulse.vercel.app`).

---

## 🔊 Audio & Visual Asset Mapping

| Asset File | Format / Location | Role / Trigger | Behavior |
| :--- | :--- | :--- | :--- |
| `static.mp3` | `audio/static.mp3` | **All Players** | Continuous ambient hiss loop at `gain 0.3`. |
| `heartbeat_imposter.mp3` | `audio/heartbeat_imposter.mp3` | **True Imposter** | Visceral double-thump scheduled every 5s via audio clock. Starts at `0.4`, escalates by `+0.025` per pulse to `1.0` at 120s. Muted for 10s during Ghost Phase. |
| `heartbeat_decoy.mp3` | `audio/heartbeat_decoy.mp3` | **Level 3 Decoys** | Lighter, steady rhythmic heartbeat pulse every 5s at fixed `gain 0.4`. |
| `scream.mp3` | `audio/scream.mp3` | **Paranoia Task Failure** | Blasts at `gain 1.0` (max volume) when a player misses the shrinking ring, deafening the room. |
| `jumpscare.mp3` | `audio/jumpscare.mp3` | **Imposter Win** | Horrific distorted bass drop & screech at `gain 1.0` on every phone. |
| `jumpscare.jpg` | `design/jumpscare.jpg` | **Imposter Win** | Full-screen horrifying demon face with rapid screen shaking & strobe flash for 2.8s. |

*(Note: The audio engine features built-in procedural synthesis fallback, guaranteeing sound playback even if offline or if network file loading fails).*

---

## 📱 How to Test on Mobile Phones

### A. Testing Locally on Same Wi-Fi Network
1. Ensure your PC and smartphones are connected to the **same Wi-Fi network**.
2. Run a local HTTP server from the project directory:
   ```bash
   npx serve -l 3000 .
   ```
3. Find your PC's local IP address (e.g., `192.168.1.45`).
4. On Phone 1 (Host):
   - Open browser and navigate to `http://192.168.1.45:3000`.
   - Tap **Create Room**, pick difficulty, and keep the screen visible.
5. On Phones 2, 3, 4 (Players):
   - Scan the QR code displayed on the host's screen (or navigate to `http://192.168.1.45:3000/?room=CODE`).
   - Enter your name, tick **"My phone volume is at MAX"**, and tap **Join Room**.
6. When players are in the lobby:
   - Host taps **Start Game**.
   - All screens plunge to pitch black `#000000` simultaneously!

### B. Testing Mobile In-Game Features
- **Listen Closely**: Walk around the room. Find the phone with the pulse growing louder every 5 seconds.
- **Ghost Phase (Imposter)**: If you have the heartbeat, press and hold anywhere on your screen for **2 seconds**. Your phone vibrates, and the heartbeat silences for 10 seconds (giving you 10 seconds of stealth).
- **Accuse (Crew)**: Double-tap your black screen. A glowing red **VOTE** button appears for 3 seconds. Tap it to halt the hunt and trigger the 15-second emergency accusation screen!
- **Paranoia Tasks (Levels 2 & 3)**: Keep your eyes ready. When a white ring appears, tap inside it before it shrinks to 0. If you miss, your phone screams and your screen turns red!
- **Secret Debug Overlay**: Long-press (1.2s) on the invisible top-left corner of the black screen to inspect your current role, server time offset, and remaining seconds.
- **Reconnection**: Refresh your mobile browser mid-game. The session persists in `sessionStorage` and automatically brings you back into the live hunt.
