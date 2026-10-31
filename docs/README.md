# False Pulse

A spooky, room-scale social deduction game played on smartphones. Screens go black, one phone has a hidden heartbeat, and the crew must find the Imposter by ear before time runs out.

**Spookathon, Track 4: Make Room for Play**

## How to Play
1. One person taps **Create Room**, picks a difficulty, and shows the QR code.
2. Everyone else scans the QR, enters a name, ticks **"My phone volume is at MAX"**, and joins.
3. Host taps **Start**. All screens go black and play static.
4. One phone has a heartbeat that gets louder every 5 seconds. Walk around and listen.
5. **Double-tap** your screen, then tap **VOTE** to accuse someone.
6. Crew wins by voting out the True Imposter. Imposter wins when 120 seconds pass or the room votes wrong.

| Level | Description |
|-------|-------------|
| 1 Beginner | 1 Imposter, pure listening |
| 2 Standard | Adds Paranoia Tasks (tap the ring or be eliminated) |
| 3 Chaos | Adds 2 Decoys; voting one out loses instantly |

## Tech Stack
HTML, CSS, vanilla JS, Firebase Realtime Database, Web Audio API, Vercel.

## Project Docs
`PRD.md`, `TRD.md`, `APP_FLOW.md`, `DESIGN.md`, `DATABASE_SCHEMA.md`

## Folder Structure
```
/index.html
/css  /js
/design   reference images
/audio    sound files
/vercel.json
```

## Setup
1. **Firebase:** create a project, enable **Realtime Database** and **Anonymous Authentication**.
2. Copy your web app config into `firebaseConfig` in `js/firebase.js`.
3. Paste the rules from `DATABASE_SCHEMA.md` into the database Rules tab.
4. Put your design images in `/design` and audio files in `/audio`.
5. Run locally with any static server, e.g. `npx serve .`

## Deploy to Vercel
1. Push the repo to GitHub.
2. In Vercel, **Add New Project**, import the repo, framework preset **Other**, deploy.
3. Add your Vercel domain to **Firebase Auth > Settings > Authorized domains**.
4. Open the live URL on a phone to test.

## Testing Checklist
- [ ] 4 real phones in one room, volume at max
- [ ] Heartbeat audible at 1 to 2 metres
- [ ] All phones start and end together
- [ ] Voting, cooldown, and 2-vote limit work
- [ ] Ghost Phase mutes and cools down correctly
- [ ] Paranoia ring and scream work
- [ ] Jumpscare plays on Imposter win
- [ ] Refresh mid-game rejoins

## Credits
Team name, members, and asset credits here.
