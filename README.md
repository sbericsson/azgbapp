# AZGB Golf Tournament App

A mobile-first live scoring app for golf tournaments. One deployment serves multiple independent tournaments. No accounts, no app store — just a tournament code, a PIN, and a phone.

---

## What It Does

- **Golfers** enter their tournament code and group PIN on arrival and immediately see their active rounds. They enter scores hole-by-hole as they play, with real-time leaderboard updates.
- **Tournament admins** use a PIN-protected admin panel to set up rounds and pairings before the tournament starts — no mid-round data entry required.
- **The app admin** can create and manage multiple tournaments from a single master panel.

The app supports four scoring formats that can be mixed across rounds:

| Format | How it works |
|---|---|
| **Wolf** | Each hole, one player is the Wolf and decides to go lone or pick a partner. Points awarded per hole based on outcome. |
| **Best Ball** | 4-person groups; best individual score on each hole counts toward the team total. Score tracked as ± par. |
| **Scramble** | All players hit, best shot is selected, repeat. Team records a single score per hole. Supports 2-person pairs or 4-person groups. |
| **Gauntlet** | 2-person format combining three segments across 18 holes: best ball (holes 1–6), scramble (holes 7–12), and alternate shot (holes 13–18). Single team score per hole throughout. |

---

## Roles

There are three access levels, all PIN-based:

| Role | Login | Access |
|---|---|---|
| **App admin** | Leave tournament code blank, enter master PIN | Create/manage all tournaments at `/app-admin` |
| **Tournament admin** | Tournament code + admin PIN | Manage rounds, pairings, golfers, courses for their tournament |
| **Group / golfer** | Tournament code + 4-digit group PIN | Scorecard entry and leaderboard for their round |

---

## Setting Up a New Tournament

1. Log in as app admin (blank code + master PIN) → `/app-admin`
2. Tap **+ New Tournament** and fill in:
   - **Name** — e.g. "Bandon Dunes 2026"
   - **Code** — short slug golfers will type at login, e.g. `bandon2026`
   - **Admin PIN** — the PIN you'll give the tournament organiser
3. Tap **Create Tournament**
4. Hand the tournament code and admin PIN to the organiser. They log in and manage everything from there.

---

## Tournament Admin Workflow

1. Log in with the tournament code + admin PIN → `/admin`
2. **Tournament Settings** — expand the Tournament Settings section to:
   - Edit the **tournament name** without touching Firestore directly.
   - Upload a **custom logo** for this tournament. The image is compressed and resized in the browser (max 512 px) and stored as a base64 data URL directly in Firestore — no external hosting or Firebase Storage required. The logo appears on the login screen and the golfer home screen.
   - Copy the **public results link** — a shareable URL that shows final standings with no PIN required (see [Public Results](#public-results) below).
3. **Build the golfer roster** — expand the Golfer Roster section and add every participant's name once. These names auto-complete in all player slots when building pairings.
4. **Add golf courses** — expand the Golf Courses section and add each course by name. Tap each hole to cycle its par (3 / 4 / 5); total par updates live. Courses can be edited or deleted at any time.
5. **Create rounds** — name, day, format, and hole count for each round. Select a course from the dropdown to pre-fill the per-hole par values, or set them manually.
6. **Add pairings** — expand a round card and tap "+ Add Pairing". Each pairing gets a group name, a 4-digit PIN (type one or hit "Random PIN"), and up to 4 players chosen from the roster or typed freely. For 2-person formats, fill just 2 of the 4 player slots.
7. **Edit pairings** — tap "Edit" on any existing pairing to update names, PIN, or player list inline. Group names can also be changed here at any time.
8. Before teeing off each day, tap the round's status button to flip it from `pending` → `active`.
9. After the round finishes, flip it to `complete`.

Share the **tournament code** and each group's **PIN** with players before they arrive. Both are shown on every pairing card.

---

## Golfer Workflow

1. Open the URL on their phone (no app install needed — works as a PWA).
2. Enter the **tournament code** and their **group PIN**.
3. See their active rounds on the home screen.
4. Tap a round → hole-by-hole scorecard.
5. For Wolf: the Wolf rotates automatically each hole. Select the Wolf's decision and enter all four scores before locking.
6. Lock each hole as they finish. Tap the leaderboard icon to see live standings.

---

## Public Results

After a tournament has completed rounds, the admin can share a PIN-free results link with anyone:

```
https://your-domain.com/results/{tournamentId}
```

The page shows final standings for every completed round — no login, no PIN. It's safe to text or email to all participants after the tournament ends. The link is available in the **Tournament Settings** section of the admin panel (tap the copy button).

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
config/app                    ← app admin PIN (single document)

tournaments/{tournamentId}    ← tournamentId = the login code
  adminPin, name, createdAt, logoUrl? (base64 data URL)
  rounds/{roundId}            ← name, format, day, status, holes, par[], courseId?
    scores/{groupId}          ← holes[], updatedAt (live score doc)
  groups/{groupId}            ← name, pin, players[], roundId
  golfers/{golferId}          ← name (master roster for admin autocomplete)
  courses/{courseId}          ← name, holes, par[]
```

The tournament document ID is the login code (e.g. `azgb2026`), so Firestore lookups are direct — no index query needed at login.

### Session Handling

Session state is stored in `localStorage` with a 6-hour TTL. Closing the tab does not log out; the session is restored on next open via a single Firestore read. There are three session types: app admin (no tournament), tournament admin (tournament scoped), and group (tournament + group scoped).

---

## AI Commentary

When a hole is locked in Best Ball, Scramble, or Gauntlet format, the app calls the Google Generative Language API (`gemini-3.1-flash-lite-preview`) to generate a short, punchy commentary line personalised to the moment — referencing player names (Best Ball only), recent hole history, scoring streaks, and live leaderboard position. The toast shows pulsing dots while the response loads, then updates with the commentary. If the API call fails or times out (5 s), the app falls back silently to static commentary. Wolf format uses static commentary only.

The model is prompted with a `systemInstruction` to act as a dry, brutally honest golf commentator and respond in one sentence (max two). Commentary for scramble and gauntlet formats avoids naming individual players since those formats score as a team.

The Google Generative Language API supports CORS from the browser directly, so no nginx proxy is required. To enable AI commentary:

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/) (no billing required).
2. Add it to `/var/www/azgb/.env.local` on the server:

```
VITE_GEMMA_API_KEY=your_key_here
```

3. Redeploy (`bash /var/www/azgb/deploy.sh`). No nginx changes needed.

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
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Optional — enables AI commentary (Google AI Studio key)
VITE_GEMMA_API_KEY=...
```

The app admin master PIN lives in Firestore (`config/app.appAdminPin`), not in env vars. No env var is needed for it.

---

## First-Time Server Setup

Before deploying for the first time, create the app admin PIN document in Firestore:

1. Open [console.firebase.google.com](https://console.firebase.google.com) → **Firestore Database**
2. Add a new collection: **Collection ID** `config`
3. **Document ID** `app`
4. Add field: `appAdminPin` (string) → your chosen master PIN
5. Save

This is a one-time step. To change the PIN later, edit the field value directly in the console — no redeploy needed.

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

All data is readable and writable by anyone who knows the path — Firestore rules are permissive (`allow read, write: if true`). Access control is enforced entirely at the application level via PINs. Do not store sensitive personal data.
