# Game Design Document: False Pulse
**Event Category:** Spookathon - Track 4 (Make Room for Play)
**Format:** In-person, room-scale multiplayer web game (Smartphones)
**Tech Stack:** AntiGravity IDE (Frontend HTML/CSS/JS), Firebase Realtime Database (Backend), Web Audio API

## 1. The Core Idea
"False Pulse" is a fast-paced, spooky social deduction game that forces players to physically interact in the same room. Everyone connects via their mobile browsers. When the game starts, all screens go black. Everyone's phone plays a low ambient static, but one randomly assigned "Imposter" has a faint heartbeat pulsing every 5 seconds underneath their static. The crew must walk around the physical room, listen closely to each other's phones, and vote out the Imposter before the **2-minute (120-second) timer** runs out. 

## 2. Setup & Lobby Flow
*   **The Platform:** Web application (no app downloads required). 
*   **Host (Create Room):** A user clicks "Create Room" and selects a Difficulty Level. The app generates a 4-letter Room Code (e.g., `DARK`) and displays a large QR code on the host's screen.
*   **Player (Join Room):** Players scan the QR code, auto-filling the Room Code on their mobile browser. 
*   **The Hardware Rule:** Players must check a box stating *"My phone volume is at MAX"* before entering the lobby.
*   **The Sync:** When the Host clicks "Start," Firebase updates the `gameState`, and every phone screen drops to pitch black simultaneously.

## 3. Game Rules & Mechanics

### Audio Mixing & The Hunt
*   **Ambient Static (Everyone):** Plays constantly at a low volume (`gain.value = 0.3`).
*   **The Heartbeat (Imposter Only):** Pulses strictly every 5 seconds to give the Imposter brief windows to move. 
*   **Volume Escalation:** The heartbeat starts at a low level (`gain.value = 0.4`). Every 5 seconds, the volume incrementally increases, peaking at maximum volume right as the 2-minute timer ends.

### Imposter Ability: The Ghost Phase (Stealth)
*   If the Imposter is cornered or suspects they are being tracked, they can press and **hold their screen for 2 seconds**.
*   This activates the "Ghost Phase," which completely mutes their heartbeat for **10 seconds**, leaving only the ambient static.
*   **Cooldown:** After the 10 seconds of silence, the ability goes on a **25-second cooldown** before it can be used again.

### The Voting System
*   **The Trigger:** A crewmate can double-tap their black screen to accuse someone.
*   **The Safety Catch:** Double-tapping spawns a glowing **VOTE** button to prevent accidental triggers. The player must tap this to pause the game.
*   **The 15-Second Phase:** Audio cuts out. Screens show a grid of player names, a 15-second countdown, and a **Skip Vote** button.
*   **Constraints:** 
    *   Maximum of **2 voting interruptions** per game.
    *   **30-second cooldown** after a vote concludes before anyone can double-tap again.

### Paranoia Tasks (Anti-Camping)
*   Shrinking white rings randomly appear on the black screens.
*   **The Penalty:** If *any* player fails to tap the ring before it disappears, they are eliminated.
*   **The Scream:** Eliminated players' phones unleash a max-volume scream, temporarily deafening the room and giving the Imposter chaotic audio cover. Eliminated players cannot vote.

## 4. Difficulty Levels
*   **Level 1 (Beginner):** 1 Imposter. No Paranoia Tasks. Pure listening game.
*   **Level 2 (Standard):** 1 Imposter. Paranoia Tasks are active. High tension.
*   **Level 3 (Chaos):** 1 True Imposter, 2 Decoys, Paranoia Tasks active. 
    *   *Decoys* have a steady, calming heartbeat that never changes volume.
    *   *True Imposter* has the escalating heartbeat. 
    *   If the room accidentally votes out a Decoy, they lose the game instantly.

## 5. Win Conditions
*   **Crew Wins:** The majority votes for the True Imposter.
*   **Imposter Wins:** The 2-minute timer hits zero, or the room wastes their final vote on an innocent/Decoy. The Imposter's phone triggers a massive jumpscare.