# AZGB Golf Tournament App — Claude Guide

## Project Overview

**AZGB** is a mobile-first real-time scoring app for a private 4-round golf tournament. Built with React, TypeScript, and Firebase Firestore. Golfers enter scores hole-by-hole on their phones; an admin (commissioner) manages setup and configuration via a PIN-protected panel.

### Scoring Formats
- **Wolf**: One player per hole makes a lone/partner decision; point-based scoring with carry-over on ties
- **Best Ball**: 4-person teams; best score per hole counts toward team total (tracked ±par)
- **Scramble**: All players hit, select best shot, repeat; 2-person pairs (Sat PM) or 4-person groups (Sun)

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
# Script: git pull → npm ci → npm run build
# nginx already serves dist/ — no restart needed
```

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
│   ├── firestore.ts           # All Firestore CRUD operations
│   └── scoring/
│       ├── wolf.ts            # Wolf calculation logic, carry-over, leaderboard
│       ├── wolf.test.ts       # Wolf scoring unit tests
│       ├── bestBall.ts        # Best ball calculations
│       └── scramble.ts        # Scramble calculations
├── hooks/
│   ├── useAuth.ts             # Auth context: PIN login, session restore
│   ├── useGroup.ts            # Group score subscriptions and saves
│   └── useLeaderboard.ts      # Leaderboard aggregation
├── pages/
│   ├── Login.tsx              # 4-digit PIN entry keypad
│   ├── Home.tsx               # Group's active rounds list
│   ├── Scorecard.tsx          # Hole-by-hole entry (protected)
│   ├── PublicScorecard.tsx    # Public scorecard (no auth)
│   ├── Leaderboard.tsx        # Round leaderboard
│   └── Admin.tsx              # Commissioner control panel
└── components/
    ├── scorecard/             # HoleHeader, HoleNav, WolfControls, etc.
    └── leaderboard/           # WolfLeaderboard, TeamLeaderboard, etc.
```

---

## Data Model (Firestore)

```
tournaments/{tournamentId}
  adminPin: string
  name: string
  createdAt: number

  rounds/{roundId}
    name, day, format, status, holes, par[], courseId?

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
- Session stored in `sessionStorage` only — clearing a tab logs out.
- `useAuth` restores session from storage on mount via one Firestore read.
- Admin login checks `tournament.adminPin`; group login checks `group.pin`.
- Route guards: `RootRoute`, `ProtectedGroupRoute`, `ProtectedAdminRoute` in `App.tsx`.

### Score Locking
- Golfers lock holes one at a time as they finish.
- Locked holes are source-of-truth from Firestore (immutable locally).
- Unlocked holes are driven by local state. `useGroup` merges remote + local on updates.

### Real-Time Subscriptions
- `useGroup` subscribes to `rounds/{roundId}/scores/{groupId}` via Firestore `onSnapshot`.
- `useLeaderboard` subscribes to all scores in a round for aggregation.
- Firestore `persistentMultipleTabManager()` handles multi-tab sync.

### Wolf Rotation & Carry-Over
- Wolf rotates per hole: `players[holeIndex % 4]`.
- Ties carry 1-point base stake to next hole (lone wolf bonuses do NOT carry).
- `computeCarryForHole()` scans backward through locked holes to sum consecutive ties.

---

## Important Gotchas

- **Firestore rules are permissive** (`allow read, write: if true`). PIN validation is app-level only. Do not add user data you wouldn't want publicly readable.
- **TypeScript strict mode** is enabled — builds fail on type errors.
- **Admin PIN not hashed** — treat as a simple shared secret.
- **Random PIN generation** excludes the admin PIN to prevent collisions (fixed in 779f4c2).
- **Tailwind v4** uses `@tailwindcss/vite` plugin — no `tailwind.config.js`.

---

## Common Tasks

### Add a New Scoring Format
1. Create `src/lib/scoring/{format}.ts` with compute and total functions.
2. Add format type to `src/types/tournament.ts → RoundFormat`.
3. Create scorecard component in `src/components/scorecard/`.
4. Create leaderboard component in `src/components/leaderboard/`.
5. Wire up in `Scorecard.tsx` and `Leaderboard.tsx`.

### Modify Wolf Scoring
1. Edit point values in `src/constants/wolf.ts`.
2. Update logic in `src/lib/scoring/wolf.ts`.
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
