# TRD: False Pulse

## 1. Tech Stack
| Layer | Choice |
|-------|--------|
| IDE | Google Antigravity |
| Frontend | HTML, CSS, vanilla JavaScript (ES modules), no build step |
| Backend | Firebase Realtime Database + Anonymous Auth |
| Audio | Web Audio API |
| QR | Lightweight CDN library (e.g. qrcodejs) |
| Hosting | Vercel (static, HTTPS) |

## 2. Architecture
Serverless. Every phone is a client of the same Firebase room node. There is no custom server.

- The **host** client writes `gameState` changes (start, end).
- Each client listens to the room node and renders the matching screen.
- Game logic (timers, audio, tasks) runs locally on each phone from shared timestamps.

## 3. File Structure
```
/index.html
/css/theme.css, main.css
/js/firebase.js   Firebase init and helpers
/js/router.js     Screen switching
/js/ui.js         Rendering per screen
/js/game.js       Roles, timer, voting, tasks, win logic
/js/audio.js      Web Audio engine
/design/          Reference images (do not modify)
/audio/           Sound files (do not modify)
/vercel.json
```

## 4. Time Sync
- On start, the host writes `startedAt = serverTimestamp()`.
- Clients read `.info/serverTimeOffset` and compute `serverNow = Date.now() + offset`.
- Timer: `remaining = 120000 + pausedTotal - (serverNow - startedAt)`.
- During a vote, store `pausedAt`; on resume add the paused duration to `pausedTotal`.

## 5. Audio Engine
- One shared `AudioContext`, created and resumed on the Join tap (iOS requirement).
- Buffers preloaded and decoded before the game starts.
- Static: looping `AudioBufferSourceNode` through a `GainNode` at 0.3.
- Heartbeat: scheduled with `AudioContext.currentTime` from the synced clock, not `setInterval`.
- Imposter gain: `min(1.0, 0.4 + 0.025 * pulseIndex)`. Decoy gain: fixed 0.4.
- Ghost Phase: heartbeat gain forced to 0 for 10s; escalation index keeps advancing.

## 6. Role Privacy
Roles live under `rooms/{CODE}/roles/{playerId}`, readable only by that player, so nobody can inspect another phone's role from the database. The reveal at the end copies roles to `result.roles`.

## 7. Security Rules (outline)
- Players write only their own `players/{uid}` and `votes/{uid}` nodes.
- Only the host can change `gameState`, `startedAt`, and `roles`.
- Room code is validated as `^[A-Z]{4}$`.
- Names are limited to 12 characters.

## 8. Browser Requirements
- iOS Safari 15+ and Android Chrome (recent).
- HTTPS required for Wake Lock and reliable audio.
- Screen Wake Lock used to keep phones awake; fall back to a silent looping video if unsupported.

## 9. Performance and Limits
- First load under 3 seconds on mobile data: compress images, preload audio only after Join.
- Firebase Spark plan is enough for a demo; keep writes small and avoid per-second writes.

## 10. Risks
| Risk | Mitigation |
|------|-----------|
| iOS blocks audio | Unlock on Join tap |
| Timer drift | Use server offset, not local time |
| Phone sleeps | Wake Lock |
| Tab backgrounded | Warn, and rejoin from sessionStorage |
| Double-tap zooms page | `touch-action: manipulation`, viewport lock |
| Host leaves | Transfer host to the earliest-joined player |
