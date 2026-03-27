# Golf Bender — Implementation TODOs

Generated from design doc: `sericsson-main-design-20260326-171042.md`

---

## Phase 1: Self-Service Tournament Creation

### Foundation
- [ ] Remove `LaunchGate` component and all references in `src/App.tsx`
- [ ] Extract `randomPin()` from `src/pages/Admin.tsx` → `src/lib/pin.ts`
- [ ] Add `generateTournamentCode()` to `src/lib/nanoid.ts` (8-char, A-Z + 2-9, no O/I/0/1)
- [ ] Add unit tests for `generateTournamentCode()` (length, alphabet, no ambiguous chars)

### Data Model
- [ ] Add `selfService?: boolean` to `Tournament` interface in `src/types/tournament.ts`

### `/create` Route
- [ ] Add `/create` as a public route in `src/App.tsx` (no auth, no LaunchGate)
- [ ] Build `src/pages/CreateTournament.tsx` — form: tournament name + organizer-chosen admin PIN
- [ ] Implement Firestore write with collision check (read-before-write on generated code)
- [ ] Build success screen: show tournament code + admin PIN in large text, copy-to-clipboard, "I've saved these" gate before wizard entry
- [ ] Add `VITE_GOLF_COURSE_API_KEY` to `.env.example`

### Course Search (Wizard Step 2)
- [ ] Build `src/components/wizard/CourseSearchStep.tsx`
  - Debounced search input → golfcourseapi.com `GET /courses?search={query}`
  - Dropdown with matching courses (name + location)
  - Auto-fill: name, holes, par[]
  - Manual fallback if course not found
  - Organizer can override any auto-filled field

### Onboarding Wizard
- [ ] Build `src/pages/OnboardingWizard.tsx` with 4 steps:
  - Step 1: Add golfers (name per golfer)
  - Step 2: Create rounds (name, day, format, course via CourseSearchStep)
  - Step 3: Create groups (pick players, auto-generate PINs via `pin.ts`, optional override)
  - Step 4: Share — one copyable invite message per group
- [ ] Trigger: show wizard when `tournament.selfService === true && rounds.length === 0`
- [ ] Resumable: re-entry opens at first step with missing data
- [ ] Once rounds + groups exist: dismiss wizard, show standard Admin panel

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
- [ ] Update `bestBallTotalToPar()` similarly
- [ ] Update scramble net scoring: team net = gross team score − scramble handicap
  - `saturday_pm` → 35% of combined handicap
  - `sunday` → 10% of combined handicap
  - Store as `scrambleHandicapPct?: number` on round (auto from `day` field)
- [ ] Add comment to `computeCarryForHole()` in `wolf.ts`: carry-over uses gross scores only, even when `useHandicaps: true`

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

- [ ] Tighten Firestore security rules — audit `firestore.ts`, move from fully permissive to write-once for unauthenticated tournament creation
- [ ] DRY `generateBestBallFeedback` / `generateScrambleFeedback` in `feedback.ts` (95% identical)
