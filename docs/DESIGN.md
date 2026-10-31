# DESIGN: False Pulse

> Reference images are in `/design`. Fill the **[FROM REFERENCE]** values after reviewing them. The defaults below are placeholders in a dark horror style.

## 1. Mood
Dark, tense, minimal. The game screen is pure black. Menus feel like a haunted terminal: dim glow, flicker, fog.

## 2. Colour Tokens
```css
:root {
  --bg: #000000;            /* game screen, always pure black */
  --bg-menu: #0a0a0f;       /* [FROM REFERENCE] */
  --surface: #14141c;       /* cards, inputs */
  --text: #e8e6e3;
  --text-dim: #8a8790;
  --accent: #ff2a3d;        /* blood red, VOTE button, danger */
  --accent-glow: #ff2a3d66;
  --ghost: #7a5cff;         /* optional highlight */
  --success: #3ddc97;       /* crew win */
  --ring: #ffffff;          /* paranoia ring */
}
```

## 3. Typography
- Headings: creepy display font **[FROM REFERENCE]** (e.g. Creepster, Nosifer, or Metal Mania) via Google Fonts.
- Body and UI: a clean sans (Inter or system-ui) for readability.
- Room code: monospace, very large, letter-spacing 0.3em.

## 4. Components
| Component | Style |
|-----------|-------|
| Primary button | Full width, 56px tall, red glow, 12px radius |
| Secondary button | Outlined, dim text |
| Input | 52px tall, dark surface, red focus border |
| Player chip | Pill with name, fade-in animation |
| Difficulty card | Selectable card, red border when active |
| VOTE button | Large circle, pulsing red glow |
| Paranoia ring | White 3px circle, shrinks with CSS animation |
| Vote grid | 2 columns, 64px tall tiles |

## 5. Motion
- Screen transitions: 250ms fade.
- Menu title: slow flicker.
- Background: subtle fog drift (CSS only).
- Reveal: roles flip one by one, 600ms apart.
- Respect `prefers-reduced-motion`.

## 6. Layout Rules
- Mobile portrait first; test 360x640 and 390x844.
- Use `100dvh` and `env(safe-area-inset-*)`.
- Tap targets at least 48px.
- No horizontal scroll, no text selection, `touch-action: manipulation`.

## 7. Special Screens
- **Game:** `#000`, no elements visible except transient VOTE button and rings.
- **Eliminated:** black with dim red "YOU ARE DEAD".
- **Jumpscare:** full-screen image from `/design`, shake animation, max-volume audio.
- **Crew win:** calm dark blue-green glow, soft text.

## 8. Assets
| Asset | Location |
|-------|----------|
| Reference mockups | `/design` |
| Jumpscare image | `/design` **[FROM REFERENCE]** |
| Audio | `/audio` (static, heartbeat, scream, jumpscare, vote) |
