# Golf Bender — Implementation TODOs

Generated from design doc: `sericsson-main-design-20260326-171042.md`

---

## Phase 1: Self-Service Tournament Creation

Done: `LaunchGate` removed; `randomPin()` in `src/lib/pin.ts`; `generateTournamentCode()` with tests;
`selfService` flag; public `/create` route with collision check and saved-credentials gate;
`CourseSearchStep` course search with manual fallback; `VITE_GOLF_COURSE_API_KEY` in `.env.example`.

Not built:
- [ ] Separate 4-step `OnboardingWizard` page (golfers → rounds → groups → share). The Admin panel covers these steps today.
- [ ] Do not publicise `/create` until backend access control (R13 below) ships.

---

## Repository review follow-ups (`REPO_REVIEW.md`, 2026-11-15)

Done on `main`: R15 interim (OpenRouter key blanked in production builds), R4 + R3 (shared
`standings.ts`, Wolf carry derived at read time), R1 (local-first lock, sync status, double-tap
guard), R5 (admin write fixes), R6 partial (reopen a completed round without deleting scores),
R7 (JSON backup and restore), R8, R9 (CI and standings/backup tests), R10, R11 partial, R12, R14.

Open:
- [ ] **R13 (P0 before onboarding other organisers):** email-link sign-in for organisers and scorers,
  authorisation in Firestore rules, no PINs or emails in public documents, emulator rules tests.
  Needs a billing-enabled Firebase plan (Spark allows 5 sign-in emails a day). Until then the
  public results page still downloads PIN-bearing documents.
- [ ] **R15 proper:** route OpenRouter and golf-course API calls through a server-side proxy with a
  rate limit; the course-search key is still in the bundle.
- [ ] **R6 rest:** admin screen to edit a group's hole scores.
- [ ] **R2 (P2, P1 once organisers edit scores):** per-hole writes with dirty tracking; persist the
  in-progress hole.
- [ ] **R11 rest:** whole-round review before the last lock.
- [ ] Playwright offline test: lock three holes offline against the Firestore emulator, reconnect, assert sync.
- [ ] Firebase SDK is pinned to 12.9.x: 12.19 adds ~60 kB gzipped to the first load. Revisit when code-splitting.

---

## Phase 2 — PR 1: Logic

### Data Model
- [ ] Add `net?: number` to `PlayerScore` in `src/types/scoring.ts`
- [ ] Add `handicapIndex?: number` to `Golfer` in `src/types/tournament.ts`
- [ ] Add `courseRating?: number`, `slopeRating?: number`, `strokeIndex?: number[]` to `Course`
- [ ] Add `useHandicaps?: boolean` to `Round`

### Handicap Library
- [ ] Create `src/lib/scoring/handicap.ts`:
  - `computeCourseHandicap(handicapIndex, slopeRating, courseRating, par): number`
    - WHS formula: `round(HI × (Slope/113) + (CourseRating − Par))`
    - Default slope: 113, default courseRating: par
  - `computeHandicapStrokes(courseHandicap, holeStrokeIndex): number`
    - 0 or 1 (or 2 for very high handicaps)
    - Stroke received when `holeStrokeIndex <= courseHandicap`
  - `computeNetHoleScore(grossScore, courseHandicap, holeStrokeIndex): number`
- [ ] Unit tests for all three functions:
  - WHS formula at slope 113 (course handicap = handicap index)
  - Slope above/below 113
  - SI boundary: stroke on SI ≤ courseHandicap, no stroke on SI > courseHandicap
  - Very high HI (double-stroke scenario)
  - 18-hole SI default: `[1,10,3,12,5,14,7,16,9,2,11,4,13,6,15,8,17,18]`
  - 9-hole SI default: `[1,5,3,7,9,2,6,4,8]`

### Scoring Updates
- [ ] Add baseline tests for `src/lib/scoring/bestBall.ts` before modifying
- [ ] Add baseline tests for `src/lib/scoring/scramble.ts` before modifying
- [ ] Update `computeBestScore()` in `bestBall.ts`: add `useNet = false` flag, use `s.net ?? s.gross` when `useNet`
- [ ] Update `teamToPar()` / `playerToPar()` in `standings.ts` similarly
- [ ] Update scramble net scoring: team net = gross team score − scramble handicap
  - `saturday_pm` → 35% of combined handicap
  - `sunday` → 10% of combined handicap
  - Store as `scrambleHandicapPct?: number` on round (auto from `day` field)
- [ ] Add comment to `deriveWolfHoles()` in `standings.ts`: carry-over uses gross scores only, even when `useHandicaps: true`
- [ ] Net scoring goes in `src/lib/scoring/standings.ts` (`teamStrokes` / `playerToPar`) so every screen picks it up

---

## Phase 2 — PR 2: UI

- [ ] Scorecard: show net score alongside gross per hole when `round.useHandicaps === true`
- [ ] Public scorecard: same net score display
- [ ] Leaderboard: rank by net when `useHandicaps: true`, show gross in secondary column
- [ ] Admin panel: handicap index input field per golfer
- [ ] Admin panel: course slope rating, course rating, stroke index fields (with "estimated data" note when defaults in use)
- [ ] Round creation: `useHandicaps` toggle (default off)

---

## Post-Phase 1 (deferred)

- [ ] Tighten Firestore security rules — superseded by R13 above
- [ ] DRY `generateBestBallFeedback` / `generateScrambleFeedback` in `feedback.ts` (95% identical)
