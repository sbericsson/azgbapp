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

**AZGB / Golf Bender** is a mobile-first real-time scoring app for golf tournaments: a React + TypeScript app served by nginx, and a small Node + SQLite API server on the same VPS. Multiple tournaments live side by side, each identified by a code. Organisers and group scorers sign in with an emailed link or 6-digit code; spectators open results by code without signing in. Firebase is retired (it was the backend until the move documented in `DEPLOY-SELF-HOSTED.md`). `TODOS.md` tracks open work; `REPO_REVIEW.md` (branch `claude/quirky-sagan-sd1tr9`) is the review it came from.

### Scoring Formats
- **Wolf**: 4 players; one player per hole makes a lone/partner decision; point-based scoring with carry-over on ties
- **Best Ball**: best score per hole counts toward team total (tracked ±par)
- **Scramble**: All players hit, select best shot, repeat; one team score per hole
- **Gauntlet**: 2 players; holes split in thirds: best ball → scramble → alternate shot

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript 5, React Router v7 |
| Build & Dev | Vite, Tailwind CSS v4, vite-plugin-pwa |
| API server | Node 20+, Hono, better-sqlite3, nodemailer (`server/`) |
| Database | SQLite file on the VPS (`DB_PATH`, default `/var/lib/azgb/azgb.db`) |
| Auth | Emailed sign-in link + 6-digit code; httpOnly session cookie (60 days, sliding) |
| Live updates | Server-Sent Events per tournament (`/api/tournaments/:t/events`) |
| Hosting | nginx serves `dist/` and proxies `/api/` and `/proxy/*`; systemd runs the API |
| Testing | Vitest (app logic and API access control) |
| Linting | ESLint, TypeScript ESLint |

---

## Commands

```bash
npm run dev:server   # API on 127.0.0.1:8787 with tsx watch; prints sign-in emails (settings: server/.env)
npm run dev          # App on localhost:5173; proxies /api to the API and /proxy/* to the third-party APIs
npm run build        # Typecheck app + server, Vite production build
npm run build:server # Bundle the API to server/dist/index.mjs (esbuild)
npm run lint         # ESLint
npm test             # Vitest once (includes server/app.test.ts access-control tests)
npm run import:firestore -- --env <file> --db <sqlite> --owner <email>   # one-time migration
npm run backup:db -- <db> <dir>   # consistent SQLite copy, keeps 30
```

Local sign-in: run both dev commands, request a link, and copy the code or link the API prints.
Put `APP_ADMIN_EMAILS=you@example.com` in `server/.env` to test the app-admin pages.

### Deploy

```bash
ssh user@server
bash /var/www/azgb/deploy.sh       # main → production
bash /var/www/azgb/deploy-dev.sh   # pick a branch → dev.golfbender.app
```

Both: `git reset` → `npm ci` → `scripts/build-release.sh` (builds into `releases/<stamp>-<sha>`, atomically swaps the `dist/` symlink; a failed build leaves the site untouched) → `scripts/restart-api.sh` (bundles the API, restarts the systemd unit `azgb-api` / `azgb-api-dev`). First-time server setup, nginx, SMTP, keys, migration and backups: `DEPLOY-SELF-HOSTED.md`.

CI (`.github/workflows/ci.yml`) runs lint, tests, and both builds on pushes to `main` and on PRs.

---

## Configuration

- **API server** (`/etc/azgb/api.env` on the VPS, `server/.env` locally; template `server/.env.example`): `PORT`, `DB_PATH`, `APP_URL` (used in emailed links), `APP_ADMIN_EMAILS`, `SMTP_URL`, `MAIL_FROM`, `ALLOW_SELF_SERVICE`, `DEV_LOG_LINKS`.
- **Third-party API keys** never reach the browser (R15). Production: `/etc/nginx/azgb-keys.conf` sets `$openrouter_key` and `$golfcourse_key`, and nginx adds them in `/proxy/openrouter/chat/completions` and `/proxy/golfcourse/v1/courses`, only for signed-in users (`auth_request` → `/api/auth/check`) and rate-limited. Dev: `OPENROUTER_API_KEY` / `GOLF_COURSE_API_KEY` in `.env.local` (no `VITE_` prefix), used by the Vite proxy.
- `VITE_*` values are compiled into the public bundle: never put a secret in one.

---

## Project Structure

```
server/
├── index.ts                   # Entry: env, SMTP mailer, starts Hono on 127.0.0.1
├── app.ts                     # Every API route and EVERY access check
├── store.ts                   # SQLite queries, backup export/import (shared with scripts)
├── auth.ts                    # Sign-in tokens/codes, sessions, email text, rate limiter
├── events.ts                  # In-process change feed for Server-Sent Events
├── db.ts                      # Schema
├── app.test.ts                # Access-control tests (who may read/write what)
└── scripts/                   # import-firestore.ts, backup-db.ts
src/
├── App.tsx                    # Routes and guards (UI only; the server enforces access)
├── types/                     # tournament.ts, scoring.ts
├── constants/wolf.ts          # Wolf point tables
├── lib/
│   ├── api.ts                 # fetch wrapper, offline read cache, live() subscriptions, score outbox
│   ├── data.ts                # All data calls (names kept from the old Firestore layer)
│   ├── backupFormat.ts        # Backup JSON shape + parser (pure)
│   └── scoring/
│       ├── standings.ts       # THE place totals, ranks, and derived Wolf carry are computed
│       ├── holes.ts           # Hole arrays: fill gaps, merge remote/local, lock defaults
│       ├── wolf.ts / bestBall.ts / scramble.ts / gauntlet.ts
│       └── feedback*.ts       # Post-lock commentary (static; AI via the /proxy/openrouter route)
├── hooks/
│   ├── useAuth.ts             # Signed-in email, open tournament, roles, scorer groups
│   ├── useGroup.ts            # One group's scores: dirty tracking, per-hole writes
│   └── useLeaderboard.ts
├── components/EmailSignIn.tsx # Request link → enter code
└── pages/                     # Login, SignIn (/signin?token=), TournamentPicker, CreateTournament,
                               # Home, Scorecard, PublicScorecard, Leaderboard, PublicResults,
                               # PrintResults, Admin, AppAdmin
deploy/azgb-api.service        # systemd unit
nginx.site.conf, nginx/dev-golfbender
```

---

## Data Model (SQLite, `server/db.ts`)

```
tournaments        id (the code), data JSON {name, logoUrl?, selfService?}, created_at, archived_at
tournament_admins  tournament_id, email                  # organisers; private
docs               tournament_id, coll, id, round_id, scorer_email, data JSON
                   coll ∈ rounds | groups | golfers | courses; data keeps the client shapes
                   groups.scorer_email is private (organisers only)
scores             tournament_id, round_id, group_id, hole_index, data JSON (HoleScore), updated_at
login_tokens       token_hash, code_hash, email, tournament_id, expires_at, failed_codes
sessions           sid_hash, email, expires_at
```

App admins are not in the database: `APP_ADMIN_EMAILS`. Emails are stored lower-case.

### Who may do what (enforced in `server/app.ts`, tested in `server/app.test.ts`)
- Anyone: read a tournament, its rounds, groups (without scorer emails), courses and scores; the live feed.
- Signed in: create a tournament (if `ALLOW_SELF_SERVICE`), becoming its organiser.
- Organiser of T (or app admin): everything inside T, the golfer roster, scorer emails, invites, backups, the organiser list.
- Scorer (email on a group): write that group's holes while the round is not complete; rename the group.
- App admin: list, archive, delete and import tournaments.
- Never in a public response: emails, PINs, tokens.

---

## Key Architectural Patterns

### Auth / Session
- `/auth/request` emails a link (`/signin?token=…`) plus a 6-digit code; only known emails get one unless `purpose: 'create'`. Same answer either way. Self-requested links last 2 hours; organiser invites (`/groups/:id/invite`) 7 days. Five wrong codes block an email's outstanding codes.
- The code exists for the iPhone home-screen app, which does not share Safari's cookies.
- `useAuth` caches `/auth/me` in `localStorage` (`azgb_me`) so the app opens offline, and remembers the open tournament (`azgb_tournament`). A generation counter stops a slow start-up check from overwriting a newer sign-in.
- Scorers have one group per round: `groupForRound(roundId)`; Scorecard loads that group (or the URL's group in organiser mode).

### Score Locking (local-first)
- `saveHole` is fire-and-forget. Writes go into the outbox (`localStorage` `azgb_outbox`, `src/lib/api.ts`) and are sent in order when there is a connection; 5xx/429/no connection retry, 4xx drop and reject the promise (shown as a save error). Never `await` a score write in the scoring UI.
- Reads of a group's scores include queued holes (`withPending` in `data.ts`), and `pendingSync` comes from the outbox. After the server accepts a write, its copy is published locally at once so nothing flickers.
- Writes carry only the holes they change (`PUT …/scores/:g {holeMap}`), one SQLite row per hole, so devices never overwrite each other's holes. In-progress (unlocked) edits are written 0.8 s after the last change and flushed when the app is hidden.
- `GroupScoreDoc.holes` can have gaps: fill with `completeHoles()` (`src/lib/scoring/holes.ts`); standings already does.
- `useGroup` keeps a dirty set: holes edited here and not yet written keep their local value; every other hole takes the remote value (`mergeRemoteHoles`).
- Organisers correct scores in the same `Scorecard` page at `/admin/scorecard/:roundId/:groupId` (edits allowed on completed rounds, no commentary).

### Live updates
- Each write publishes `{c: collection, r?: roundId, id?}` on the tournament's feed. `live()` in `api.ts` emits the cached copy, then the server copy, then refetches when a matching event arrives, the stream reconnects, the app becomes visible, or the browser comes online.

### Standings
- Every total and rank goes through `src/lib/scoring/standings.ts` (`computeStandings`, `teamToPar`, `playerToPar`, `deriveWolfHoles`). Do not add per-screen aggregation.
- Only locked holes count; par is looked up by the hole's own index. Ties share a rank (`T2`); groups with no locked holes are unranked and listed last.

### Wolf Rotation & Carry-Over
- Wolf rotates per hole: `players[holeIndex % 4]`. Ties carry the 1-point base stake (lone-wolf bonuses do not).
- Carry and points are derived at read time by `deriveWolfHoles()`; stored `carry`/`points` are informational.

---

## Important Gotchas

- **Access control lives only in `server/app.ts`.** Route guards in `App.tsx` are UI. Add a test to `server/app.test.ts` for any new route or permission.
- **Partial updates:** `data.ts` sends `undefined` as `null` on PATCH, and the server deletes fields set to `null`. PUT replaces the whole document.
- **Never put secrets in `VITE_*`.** Keys go to nginx (prod) or the Vite proxy (dev), which also strip the session cookie.
- **The service worker** must not serve the app shell for `/api/` or `/proxy/` (`navigateFallbackDenylist` in `vite.config.ts`).
- **nginx must not buffer `/api/`** (Server-Sent Events): `proxy_buffering off`.
- **One API process.** The change feed and rate limits are in memory; do not run several instances.
- **TypeScript strict mode** for app and server (`tsconfig.server.json`); builds fail on type errors.
- **Tailwind v4** uses `@tailwindcss/vite` — no `tailwind.config.js`.
- **Firestore** (`azgb-8612c`) only matters for the one-time import; `firestore.rules` now denies everything and should be deployed after the import.

---

## Common Tasks

### Add a New Scoring Format
1. Create `src/lib/scoring/{format}.ts` with a type guard and per-hole helpers; handle it in `holes.ts` (`emptyHole`, `holesMatchFormat`, `withLockDefaults`).
2. Add the format to `RoundFormat` in `src/types/tournament.ts` and handle it in `standings.ts`.
3. Scorecard component in `src/components/scorecard/`, leaderboard component in `src/components/leaderboard/`, wire up in `Scorecard.tsx` and `Leaderboard.tsx`.

### Add an API route or permission
1. Route and access check in `server/app.ts`; queries in `server/store.ts`; publish a change event if clients show the data.
2. Client call in `src/lib/data.ts`.
3. Tests in `server/app.test.ts` for allowed and refused callers.

### Modify Wolf Scoring
1. Point values in `src/constants/wolf.ts`; per-hole logic in `src/lib/scoring/wolf.ts`; carry and totals in `standings.ts`.
2. `npm test`.
