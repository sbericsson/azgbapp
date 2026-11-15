# AZGB Golf Tournament App — Claude Guide

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

Available gstack skills:
- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`

If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.

## Project Overview

**AZGB / Golf Bender** is a mobile-first real-time scoring app for golf tournaments. Built with React, TypeScript, and Firebase Firestore. Multiple tournaments live side by side, each identified by a code; organisers create them at `/create` or an app admin creates them. Golfers enter scores hole-by-hole on their phones; each tournament's organiser manages setup via a PIN-protected admin panel. `REPO_REVIEW.md` (branch `claude/quirky-sagan-sd1tr9`) is the current review; `TODOS.md` tracks what is open from it.

### Scoring Formats
- **Wolf**: 4 players; one player per hole makes a lone/partner decision; point-based scoring with carry-over on ties
- **Best Ball**: best score per hole counts toward team total (tracked ±par)
- **Scramble**: All players hit, select best shot, repeat; one team score per hole
- **Gauntlet**: 2 players; holes split in thirds: best ball → scramble → alternate shot

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5 |
| Build & Dev | Vite, Tailwind CSS v4 |
| Routing | React Router v7 |
| Backend / DB | Firebase Firestore |
| Auth | PIN-based (no Firebase Auth) |
| Hosting | Static build on nginx (VPS) |
| Testing | Vitest |
| Linting | ESLint, TypeScript ESLint |

---

## Commands

```bash
npm run dev          # Start Vite dev server (localhost:5173)
npm run build        # TypeScript check + Vite production build → dist/
npm run lint         # ESLint check
npm test             # Run Vitest tests once
npm run test:watch   # Vitest watch mode
npm run preview      # Preview production build locally
```

### Deploy to Production

```bash
# After committing and pushing to main:
ssh user@server
bash /var/www/azgb/deploy.sh
# Script: git reset to origin/main → npm ci → scripts/build-release.sh
# build-release.sh builds into releases/<stamp>-<sha> and atomically swaps the dist/ symlink;
# a failed build leaves the live site untouched. nginx needs no restart.
```

CI (`.github/workflows/ci.yml`) runs lint, tests, and build on pushes to `main` and on PRs.

---

## Environment Variables

Required in `.env` or `.env.local`:

```bash
VITE_TOURNAMENT_ID=...
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

---

## Project Structure

```
src/
├── App.tsx                    # Root router with protected routes
├── firebase.ts                # Firebase config and Firestore init
├── types/
│   ├── tournament.ts          # Tournament, Round, Group, Course, Golfer interfaces
│   └── scoring.ts             # HoleScore variants (Wolf/BestBall/Scramble)
├── constants/
│   └── wolf.ts                # Wolf point tables (lone/partner/lose)
├── lib/
│   ├── firestore.ts           # All Firestore CRUD operations (cascading deletes, deleteField for undefined)
│   ├── backup.ts              # Tournament JSON export / restore (backupFormat.ts is the pure part)
│   └── scoring/
│       ├── standings.ts       # THE place totals, ranks, and derived Wolf carry are computed
│       ├── wolf.ts            # Wolf per-hole points, rotation, type guard
│       ├── bestBall.ts        # Best ball helpers and type guard
│       ├── scramble.ts        # Scramble helpers and type guard
│       ├── gauntlet.ts        # Gauntlet segments and type guard
│       └── feedback*.ts       # Post-lock commentary (static; AI via OpenRouter when a key is set)
├── hooks/
│   ├── useAuth.ts             # Auth context: PIN login, session restore
│   ├── useGroup.ts            # Group score subscriptions and saves
│   └── useLeaderboard.ts      # Leaderboard aggregation
├── pages/
│   ├── Login.tsx              # Tournament code + 4-digit PIN keypad (?code= pre-fills)
│   ├── CreateTournament.tsx   # Public self-service tournament creation
│   ├── Home.tsx               # Group's rounds list (live subscription)
│   ├── Scorecard.tsx          # Hole-by-hole entry (protected)
│   ├── PublicScorecard.tsx    # Read-only scorecard of another group
│   ├── Leaderboard.tsx        # Round leaderboard
│   ├── PublicResults.tsx      # /results/:tournamentId, no login
│   ├── PrintResults.tsx       # Printable results (admin)
│   ├── Admin.tsx              # Tournament admin panel
│   └── AppAdmin.tsx           # App admin: all tournaments, archive, restore
└── components/
    ├── scorecard/             # HoleHeader, HoleNav, WolfControls, etc.
    └── leaderboard/           # WolfLeaderboard, TeamLeaderboard, etc.
```

---

## Data Model (Firestore)

```
config/app
  appAdminPin: string            # app-wide admin (blank tournament code at login)

tournaments/{tournamentId}       # ID is the tournament code
  adminPin: string
  name: string
  createdAt: number
  logoUrl?, selfService?, archivedAt?

  rounds/{roundId}
    name, day (weekday), format, status, holes, par[], courseId?

    scores/{groupId}             # Live score doc (created on first save)
      groupId, updatedAt, holes: HoleScore[]

  groups/{groupId}
    name, pin (4-digit), players: [{id, name}], roundId

  golfers/{golferId}             # Master roster (admin only)
    id, name

  courses/{courseId}             # Golf courses (admin only)
    name, holes, par[]
```

---

## Key Architectural Patterns

### Auth / Session
- Session stored in `localStorage` (`azgb_session`) with a 16-hour sliding expiry, refreshed while the app is in use. A network error during restore keeps the session.
- `useAuth` restores session from storage on mount.
- Admin login checks `tournament.adminPin`; group login checks `group.pin`; blank code + `config/app.appAdminPin` is app admin.
- Route guards: `RootRoute`, `ProtectedGroupRoute`, `ProtectedAdminRoute`, `ProtectedAppAdminRoute` in `App.tsx`. These are UI-only: nothing is enforced server-side yet (R13).

### Score Locking (local-first)
- Golfers lock holes one at a time as they finish.
- `saveHole` is fire-and-forget: it applies the write to the local Firestore cache and returns at once. Never `await` a Firestore write in the scoring UI — offline, the promise does not settle until reconnect.
- Sync state comes from snapshot `metadata.hasPendingWrites` (`pendingSync` in `useGroup`).
- Locked holes are source-of-truth from Firestore. Unlocked holes are driven by local state; `useGroup` merges remote + local on updates.

### Standings
- Every total and rank goes through `src/lib/scoring/standings.ts` (`computeStandings`, `teamToPar`, `playerToPar`, `deriveWolfHoles`). Do not add per-screen aggregation.
- Only locked holes count; par is looked up by the hole's own index.
- Ties share a rank (`T2`); groups with no locked holes are unranked and listed last.

### Real-Time Subscriptions
- `useGroup` subscribes to `rounds/{roundId}/scores/{groupId}` with metadata changes.
- `useLeaderboard` subscribes to all scores in a round. Home and Scorecard subscribe to rounds.
- Firestore uses a persistent single-tab cache (`persistentSingleTabManager`) in `firebase.ts`.

### Wolf Rotation & Carry-Over
- Wolf rotates per hole: `players[holeIndex % 4]`.
- Ties carry 1-point base stake to next hole (lone wolf bonuses do NOT carry).
- Carry and points are derived from the stored inputs at read time by `deriveWolfHoles()`, so correcting an earlier hole updates later ones. The `carry`/`points` stored on each hole are informational only.

---

## Important Gotchas

- **Firestore rules are permissive** (`allow read, write: if true`). PIN validation is app-level only, and every PIN (including admin PINs) is readable by anyone. Do not add user data you wouldn't want publicly readable. Backend access control is R13 in `TODOS.md`.
- **API keys in the bundle**: any `VITE_*` value ships to browsers. `deploy.sh` blanks `VITE_OPENROUTER_API_KEY`; the golf-course key is still public until a proxy exists.
- **Firestore rejects `undefined`**: the update helpers in `firestore.ts` turn `undefined` into `deleteField()`; use them rather than raw `updateDoc`.
- **TypeScript strict mode** is enabled — builds fail on type errors.
- **Admin PIN not hashed** — treat as a simple shared secret.
- **Random PIN generation** excludes the admin PIN to prevent collisions (fixed in 779f4c2).
- **Tailwind v4** uses `@tailwindcss/vite` plugin — no `tailwind.config.js`.

---

## Common Tasks

### Add a New Scoring Format
1. Create `src/lib/scoring/{format}.ts` with a type guard and per-hole helpers.
2. Add format type to `src/types/tournament.ts → RoundFormat`, and handle it in `standings.ts`.
3. Create scorecard component in `src/components/scorecard/`.
4. Create leaderboard component in `src/components/leaderboard/`.
5. Wire up in `Scorecard.tsx` and `Leaderboard.tsx`.

### Modify Wolf Scoring
1. Edit point values in `src/constants/wolf.ts`.
2. Per-hole logic is in `src/lib/scoring/wolf.ts`; carry and totals are in `standings.ts`.
3. Run `npm test` to verify carry-over and tie logic.

### Add a Golfer Field
1. Update `src/types/tournament.ts → Golfer`.
2. Update `src/lib/firestore.ts` if new queries needed.
3. Update `Admin.tsx` form if editable by admin.

---

## Firebase Project

- **Project ID**: `azgb-8612c`
- **Security Rules**: `firestore.rules` (currently permissive — see gotcha above)
- **Composite Indexes**: `firestore.indexes.json`
- **Hosting config**: `firebase.json`
