# DATABASE_SCHEMA: Firebase Realtime Database

## 1. Structure
```json
{
  "rooms": {
    "DARK": {
      "hostId": "uid_abc",
      "difficulty": 1,
      "gameState": "lobby",
      "createdAt": 1730000000000,
      "startedAt": 1730000100000,
      "pausedAt": null,
      "pausedTotal": 0,
      "voteCount": 0,
      "lastVoteEndedAt": null,
      "players": {
        "uid_abc": { "name": "Anu", "alive": true, "joinedAt": 1730000010000 },
        "uid_def": { "name": "Ravi", "alive": true, "joinedAt": 1730000020000 }
      },
      "roles": {
        "uid_abc": "crew",
        "uid_def": "imposter"
      },
      "votes": {
        "uid_abc": "uid_def"
      },
      "tasks": {
        "current": { "id": "t3", "spawnedAt": 1730000130000 }
      },
      "result": {
        "winner": "crew",
        "reason": "imposter_voted_out",
        "roles": { "uid_abc": "crew", "uid_def": "imposter" }
      }
    }
  }
}
```

## 2. Fields
| Path | Type | Notes |
|------|------|-------|
| `hostId` | string | Auth uid of host |
| `difficulty` | 1, 2, 3 | Chosen at creation |
| `gameState` | `lobby`, `playing`, `voting`, `ended` | Host controls |
| `startedAt` | server timestamp | Timer anchor |
| `pausedAt` / `pausedTotal` | number | For vote pauses |
| `voteCount` | 0 to 2 | Max 2 per game |
| `lastVoteEndedAt` | timestamp | 30s cooldown |
| `players/{uid}/name` | string, max 12 | Unique in room |
| `players/{uid}/alive` | boolean | False after elimination |
| `roles/{uid}` | `crew`, `imposter`, `decoy` | Private to that player |
| `votes/{uid}` | uid or `"skip"` | Cleared after each vote |
| `tasks/current` | object | Synced ring trigger |
| `result` | object | Written at game end |

## 3. Security Rules
The comprehensive security rules are maintained in [`database.rules.json`](file:///c:/Users/ASUS/.gemini/antigravity-ide/scratch/false-pulse/database.rules.json).
Key enforcement points:
- Only authenticated users (`auth != null`) can read or write.
- Players can only write and update their own player node under `players/{playerId}` (Host can kick).
- Only the host (`hostId`) can change `gameState`, `startedAt`, `pausedAt`, `pausedTotal`, `voteCount`, `lastVoteEndedAt`, `roles`, and `result`.
- Player names are validated: strings, 1-12 chars.
- Room code validated: 4 uppercase letters (`^[A-Z]{4}$`).
- Role privacy: roles can only be read by that individual player or the host, and become globally readable once `gameState === 'ended'`.


## 4. Lifecycle
1. Host creates `rooms/{CODE}` with `gameState: lobby`.
2. Players add themselves under `players` and register `onDisconnect().remove()`.
3. Host starts: one atomic update sets `roles`, `startedAt`, and `gameState: playing`.
4. Vote: `gameState: voting`, `pausedAt` set; after tally, `voteCount + 1`, `lastVoteEndedAt` set, `votes` cleared.
5. End: write `result`, `gameState: ended`.
6. Play Again: clear `roles`, `votes`, `result`, reset counters, back to `lobby`.
7. Cleanup: delete rooms older than 24 hours.
