# APP_FLOW: False Pulse

## 1. Screen List
`home` → `create` / `join` → `lobby` → `game` (black) → `vote` → `game` → `end` (reveal)

## 2. Main Flow
```
Home
 ├─ Create Room → enter name, pick difficulty → Lobby (host)
 └─ Join Room (or QR scan) → code auto-filled, name, volume checkbox → Lobby (player)

Lobby
 └─ Host taps Start (min players met)
      → roles assigned, gameState = playing

Game (black screen, 120s)
 ├─ Static plays for all; heartbeat for Imposter (and steady one for Decoys)
 ├─ Imposter: hold 2s → Ghost Phase
 ├─ Levels 2-3: rings appear → tap in time or be eliminated
 └─ Crew: double-tap → VOTE button → Vote screen

Vote (15s)
 ├─ Audio stops, timer paused
 ├─ Pick a name or Skip Vote
 └─ Result → Game resumes OR End

End
 ├─ Reveal all roles
 ├─ Imposter win → jumpscare first
 └─ Host: Play Again → Lobby
```

## 3. Screen Details
| Screen | Content | Actions |
|--------|---------|---------|
| Home | Title, two buttons | Create, Join |
| Create | Name, difficulty cards | Create |
| Join | Code, name, volume checkbox | Join (disabled until valid) |
| Lobby | Code, QR (host), live names | Start (host), Kick (host) |
| Game | Pure black, no UI | Double-tap, hold, tap ring |
| Vote | Name grid, countdown, Skip | Vote, Skip |
| End | Win/lose message, role reveal | Play Again (host) |

## 4. Voting Rules in Flow
1. Double-tap spawns VOTE for 3s.
2. Tapping VOTE sets `gameState = voting` (only if votes used < 2, cooldown over, player alive).
3. After 15s or when all alive players voted, tally.
4. Majority on True Imposter → Crew wins.
5. Majority on Crew or Decoy → Imposter wins (Decoy: instant loss).
6. Tie or Skip → no result, play resumes, cooldown 30s.

## 5. Edge Cases
- **Refresh mid-game:** rejoin using sessionStorage `playerId` and `roomCode`.
- **Player leaves in lobby:** removed via `onDisconnect`.
- **Host leaves:** host role passes to earliest-joined player.
- **Room full or started:** join blocked with an error.
- **Duplicate name:** blocked at join.
- **Imposter eliminated by a task:** Crew wins (proposed).
- **Timer ends during a vote:** timer is paused, so the vote finishes first.
