# AZGB Golf Tournament App

A mobile-first live scoring app for a private golf tournament spanning four rounds over a weekend. Built specifically for the AZGB crew — no accounts, no app store, just a PIN and a phone.

---

## What It Does

- **Golfers** enter their group's PIN on arrival and immediately see their active rounds. They enter scores hole-by-hole as they play, with real-time leaderboard updates.
- **The commissioner** uses a password-protected admin panel to set up all rounds and pairings before the tournament starts — no mid-round data entry required.

The app supports four scoring formats that can be mixed across rounds:

| Format | How it works |
|---|---|
| **Wolf** | Each hole, one player is the Wolf and decides to go lone or pick a partner. Points awarded per hole based on outcome. |
| **Best Ball** | 4-person groups; best individual score on each hole counts toward the team total. Score tracked as ± par. |
| **Scramble** | All players hit, best shot is selected, repeat. Team records a single score per hole. Supports 2-person pairs or 4-person groups. |
| **Gauntlet** | 2-person format combining three segments across 18 holes: best ball (holes 1–6), scramble (holes 7–12), and alternate shot (holes 13–18). Single team score per hole throughout. |

---

## AZGB Structure

The app is built around four named rounds:

- **Friday** — Wolf format, 18 holes
- **Saturday AM** — Best Ball, 18 holes
- **Saturday PM** — Gauntlet, 18 holes (2-person pairs)
- **Sunday** — Scramble, 18 holes (4-person groups)

Rounds are created by the admin and can be set to `pending`, `active`, or `complete`. Golfers only see rounds that are `active` or `complete` and that belong to their group.

---

## How It's Built

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 7 |
| Styling | Tailwind CSS v4 |
| Routing | React Router v7 |
| Backend / DB | Firebase Firestore (real-time) |
| Auth | PIN-based (no Firebase Auth) |
| Hosting | nginx on a Linux VPS |

### Data Model

```
tournaments/{tournamentId}
  rounds/{roundId}          ← name, format, day, status, holes, par[], courseId?
    scores/{groupId}        ← holes[], updatedAt (live score doc)
  groups/{groupId}          ← name, pin, players[], roundId
  golfers/{golferId}        ← name (master roster for admin autocomplete)
  courses/{courseId}        ← name, holes, par[]
```

Groups self-identify their round via `roundId`. A group belongs to exactly one round, which makes pairings independent per round (different foursomes Friday vs. Saturday AM, 2-person pairs Saturday PM, etc.).

### Session Handling

No login infrastructure. Session state is stored in `sessionStorage` — closing the tab clears the session; refreshing restores it via a single Firestore read. Admin session is separate and also PIN-protected.

---

## Admin Workflow

1. Open the app, enter the admin PIN at the tournament ID prompt.
2. **Build the golfer roster** — expand the Golfer Roster section and add every participant's name once. These names auto-complete in all player slots when building pairings.
3. **Add golf courses** — expand the Golf Courses section and add each course by name. Tap each hole to cycle its par (3 / 4 / 5); total par updates live. Courses can be edited or deleted at any time.
4. **Create rounds** — name, day, format, and hole count for each of the four rounds. Select a course from the dropdown to pre-fill the per-hole par values, or set them manually. Par values can be adjusted per-hole even after a course is selected.
5. **Add pairings** — expand a round card and tap "+ Add Pairing". Each pairing gets a group name, a 4-digit PIN (type one or hit "Random PIN"), and up to 4 players chosen from the roster or typed freely. For Sat PM scramble pairs, fill just 2 of the 4 player slots.
6. **Edit pairings** — tap "Edit" on any existing pairing to update names, PIN, or player list inline without deleting and re-creating.
7. Before teeing off each day, tap the round's status button to flip it from `pending` → `active`.
8. After the round finishes, flip it to `complete`.

All rounds and pairings for the entire weekend can be entered in one session before the tournament begins.

---

## Golfer Workflow

1. Open the URL on their phone (no app install needed — works as a PWA).
2. Enter the tournament ID and their group's PIN.
3. See their active rounds on the home screen.
4. Tap a round → hole-by-hole scorecard.
5. For Wolf: the Wolf rotates automatically each hole. Select the Wolf's decision (Lone Wolf pre/post or pick a partner) and enter all four scores before locking.
6. Lock each hole as they finish. Tap the leaderboard icon to see live standings.

---

## AI Commentary

When a hole is locked in Best Ball, Scramble, or Gauntlet format, the app calls the Gemini 2.5 Flash-Lite API to generate a one or two sentence commentary line personalised to the moment — referencing player names, recent hole history, scoring streaks, and where the group sits on the leaderboard. The toast shows pulsing dots while the response loads, then updates with the commentary. If the API call fails or times out (5 s), the app falls back silently to static commentary. Wolf format uses static commentary only.

To enable AI commentary, add a Gemini API key to `.env.local`:

```
VITE_GEMINI_API_KEY=your_gemini_key_here
```

Get a free key at [Google AI Studio](https://aistudio.google.com/). The free tier (15 RPM / 1500 RPD) is well within what 18 holes across a handful of groups requires. The key is baked into the client bundle — consistent with the app's existing security model (private tournament, permissive Firestore rules).

---

## Local Development

```bash
# Install dependencies
npm install

# Create a .env.local with your Firebase project config
cp .env.example .env.local   # (edit with your Firebase values)

# Start dev server
npm run dev

# Run tests
npm test

# Build for production
npm run build
```

Required environment variables:

```
VITE_TOURNAMENT_ID=your-tournament-id
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Optional — enables AI commentary for bestBall/scramble/gauntlet
VITE_GEMINI_API_KEY=...
```

---

## Deployment

The app is served as a static build from a VPS behind nginx. To deploy after pushing to `main`:

```bash
# On the server (or via SSH)
bash /var/www/azgb/deploy.sh
```

The script pulls the latest code, runs `npm ci` and `npm run build`. nginx is already configured to serve the `dist/` directory — no restart needed.

---

## Firestore Security Rules

All subcollections (rounds, groups, scores, golfers, courses) are readable by anyone with the tournament ID. Scores are writable by the group that owns them (enforced by document ID matching the group ID in the score doc). Admin writes are gated at the application level by the admin PIN.
