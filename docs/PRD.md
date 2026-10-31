# PRD: False Pulse

**Event:** Spookathon, Track 4 (Make Room for Play)
**Platform:** Mobile web (smartphones), room-scale multiplayer
**Status:** Hackathon MVP

## 1. Overview
A spooky social deduction game played in one physical room. Every phone goes black and plays static. One phone, the Imposter's, also carries a faint heartbeat. Players walk around, listen to each other's phones, and vote out the Imposter before 120 seconds run out.

## 2. Problem and Goal
Phone games keep people looking at screens and ignoring each other. This game makes the screen the least important part: the fun is walking, listening, and watching faces.

**Goal:** a 2-minute, no-install game that gets 3 to 10 people moving around a room, laughing, and accusing each other.

## 3. Target Users
- Friends and event attendees in the same room, aged 13+.
- Players need only a smartphone browser and a QR scan.

## 4. Core Features (MVP)
| # | Feature | Priority |
|---|---------|----------|
| 1 | Create room with difficulty, 4-letter code, QR | Must |
| 2 | Join via QR, enter name, volume-at-MAX checkbox | Must |
| 3 | Live lobby with player names, host Start | Must |
| 4 | Role assignment, synced black screen, 120s timer | Must |
| 5 | Static + escalating heartbeat audio | Must |
| 6 | Voting (double-tap, VOTE button, 15s phase, Skip) | Must |
| 7 | Win conditions, reveal screen, jumpscare | Must |
| 8 | Ghost Phase (Imposter stealth) | Should |
| 9 | Paranoia Tasks and elimination scream (Levels 2, 3) | Should |
| 10 | Level 3 decoys | Should |
| 11 | Play Again, host kick, reconnect | Could |

## 5. Game Rules Summary
- **Timer:** 120 seconds.
- **Static:** all players, gain 0.3.
- **Imposter heartbeat:** every 5s, starts gain 0.4, rises 0.025 per pulse to 1.0.
- **Ghost Phase:** hold 2s, heartbeat muted 10s, then 25s cooldown.
- **Voting:** max 2 per game, 30s cooldown after each, 15s voting window.
- **Paranoia Tasks:** failing a ring tap eliminates that player and triggers a max-volume scream. Eliminated players cannot vote.
- **Levels:** 1 = pure listening. 2 = adds tasks. 3 = adds 2 Decoys with a steady heartbeat; voting out a Decoy loses the game instantly.

## 6. Win Conditions
- **Crew:** the majority votes out the True Imposter.
- **Imposter:** timer reaches zero, or the room votes out an innocent or a Decoy. Jumpscare plays.

## 7. Success Metrics (for demo)
- A full game runs end to end with 4+ real phones.
- All phones start and end within about 1 second of each other.
- Players can identify the heartbeat by ear at normal room distance.

## 8. Out of Scope
Accounts, chat, persistent stats, native apps, spectator mode, more than one Imposter on Levels 1 and 2.

## 9. Open Questions
- What happens if the Imposter fails a Paranoia Task? (Proposed: Crew wins.)
- Minimum players per level? (Proposed: 3 for Levels 1-2, 5 for Level 3.)
