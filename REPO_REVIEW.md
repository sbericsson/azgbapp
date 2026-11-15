# AZGB Repository Review

Date: 2026-11-15, revision 3. **Baseline: `origin/phase1-self-service` @ `073d53a` (2026-06-23).** All file and line references are to that branch. Revision 1 was written against `main`; every finding has been re-checked on the branch.

Evidence labels: **Executed** (I ran it), **Read** (confirmed by reading the code path end to end), **Inferred** (reasoned, not run), **Unverified** (could not check here). Effort: S = half a day or less, M = 1 to 3 days, L = a week or more.

## Decisions recorded

| # | Your answer | Effect on this report |
|---|---|---|
| 1 | `phase1-self-service` is the correct, current branch | Re-baselined. `main` (what `deploy.sh` deploys) is 30 commits behind it |
| 2 | Multiple people will administer their own tournaments; admin logins are still being set up | Backend access control moves from optional to required before organisers are onboarded (S1, R13) |
| 3 | No shotgun starts and no out-of-order play for now (my reading of "no shotguns, out of order for now") | B4 drops from High to Medium; the out-of-order path of B3 is rare, the correction path remains |
| 4 | One scorer per group | B2 drops from High to Medium and R2 from P0 to P2 |
| 5 | Email-link sign-in for both organisers and group scorers, with scorers automatically authorised for their group | Adopted as the design for R13. See "Email-link design" under S1, including the constraints that come with it |

---

## 1. Current health and verification

**Assessment.** The branch is in better shape than `main`: lint is clean, tests and build pass, and the dead Gemini model is gone. The scoring maths is sound for one phone per group, online, holes locked in order. The main on-course weakness is unchanged: scoring stalls offline. The larger issue is now security. The branch adds a public tournament-creation page while every document, including every organiser's admin PIN, stays readable and writable by anyone, and a billable API key ships in the bundle.

| Check (on the branch) | Result | Classification |
|---|---|---|
| `npm test` | Pass, 27 tests in 3 files (Wolf scoring, code generator, code lookup) | Executed |
| `npm run lint` | Pass, 0 problems (`main` has 7 errors) | Executed |
| `npm run build` | Pass. One 675 kB JS chunk (204 kB gzip), PWA precache 890 KiB | Executed |
| `npm audit` | 37 advisories (6 in the production tree), all fixable in range. Lockfile is identical to `main` | Executed on `main`'s identical lockfile. Practical exposure looks low (Inferred) |
| Behaviour against Firestore, on devices, or offline | Not run | Environment limit: no `.env`, no Firebase project, no emulator |
| Deployed nginx config, deployed Firestore and Storage rules, which commit production runs | Not checked | Unverified |

Checks ran in scratch copies made with `git archive`, using `npm ci` from the lockfile. Nothing was installed or changed in the repository. The only repository changes are this file and a remote-tracking ref from `git fetch origin phase1-self-service`.

**Architecture as implemented.** React 19.2 SPA, React Router 7.13, Firestore 12.9 with a persistent single-tab IndexedDB cache, no Firebase Auth, PWA, Tailwind 4.2, Vite 7.3, TypeScript 5.9, Vitest 4.0. About 7,500 lines in `src/`; `Admin.tsx` is 1,332. Three PIN roles (app admin, tournament admin, group); four formats (Wolf, Best Ball, Scramble, Gauntlet); one score document per group per round holding a `holes[]` array. The branch adds `/create` (public tournament creation with a generated 8-character code), golf-course search in the admin panel, `?code=` login links, weekday-based round days, and OpenRouter commentary.

**Branch state and drift.**
- `deploy.sh` deploys `origin/main`, so production cannot be running this branch unless it was deployed another way (Unverified). The branch's `deploy.sh` lacks the `VITE_*` scrub that `main` gained in `c193bdc`, and `deploy-dev.sh` differs from `main`'s; merge `main` into the branch before making it the mainline.
- No `AGENTS.md` exists on either branch. The branch's `CLAUDE.md` adds a gstack skill list (`/review`, `/cso`, `/qa`, and others); none of those skills are installed in this environment, so the review used the built-in code-review skill in one context.
- The rest of `CLAUDE.md` is stale: single tournament, `sessionStorage`, multi-tab cache, no Gauntlet, no self-service. `README.md` is closer to the code.
- `TODOS.md` lists Phase 1 items unchecked although most are implemented, and defers "tighten Firestore security rules" to after Phase 1.
- `deploy-ai.sh` targets a branch that no longer exists on the remote.

**Fixed on the branch relative to `main`.** Lint errors; `LaunchGate` removed; Gauntlet label on Home; guarded session parsing; `?code=` login pre-fill; tournament-code case handling; retired Gemini model replaced.

---

## 2. Confirmed bugs and risks

### High

**S1. No access control is enforced by the backend, and the branch opens tournament creation to the public.**

| Capability | UI restriction | Backend enforcement |
|---|---|---|
| Create a tournament | None, `/create` is public (`App.tsx:66`) | None |
| Read any tournament, group, and score, and every PIN including each organiser's admin PIN and the app master PIN | PIN keypad | None. `firestore.rules:9-41` is `allow read, write: if true` on every path |
| Tournament admin and app admin panels | Route guards (`App.tsx:33-52`) | None. `useAuth.ts:111, 148` trusts `isAdmin` / `isAppAdmin` flags in `localStorage` without rechecking a PIN |
| Edit after a round is complete | Unlock hidden (`Scorecard.tsx:477`) | None |
| Delete tournaments, rounds, scores | Admin screens | None |
| Public results link | No login | The page downloads the tournament document (admin PIN) and group documents (group PINs): `PublicResults.tsx:142, 168` |

- Scenario with several organisers: any organiser, golfer, or visitor can list every tournament and read or change another organiser's event, and can obtain any admin PIN from the browser's network tab. The create screen tells organisers their PIN cannot be recovered (`CreateTournament.tsx:74`), while the app admin screen shows all of them.
- There is no export or backup in the repository (Read); Firestore backup configuration is Unverified. One bad write or delete is unrecoverable.
- Confidence: high (Read). Deployed rules Unverified.
- Effort L, including migration of existing tournaments. Interim steps (S): do not publicise `/create`; add the JSON export (R7); stop the public results page from reading PIN-bearing documents.

**Email-link design (decision 5).** Firebase email-link sign-in for organisers and scorers; authorisation by verified email, enforced in Firestore rules. No Cloud Functions are needed. This is a design proposal to be proven with emulator rules tests.

| Element | Proposal |
|---|---|
| Identity | Firebase Auth email link. The sign-in also verifies the address, so rules can trust `request.auth.token.email` when `email_verified` is true |
| Organiser | Signs in, then creates a tournament; their email is recorded as an admin of it. Only listed admins can write the tournament, rounds, groups, courses, and golfers. "My tournaments" replaces the unrecoverable admin PIN |
| Scorer | The organiser enters one scorer email per group (optionally a backup). A signed-in scorer whose email is on a group can write that group's scores, in every round where they are listed. This removes per-round PINs |
| App admin | An email allow-list checked in rules, replacing `config/app.appAdminPin` |
| Viewers | Leaderboards and results stay public to anyone with the tournament code; no sign-in |
| Where emails live | In private access documents that rules read with `get()`, not in the public tournament and group documents. Otherwise the public results page would expose organisers' and golfers' email addresses the way it exposes PINs today |
| Session | Firebase Auth persistence replaces the 6-hour `localStorage` session, which also resolves B12 and the trusted-flag problem in S1 |

Constraints to plan for:

| Constraint | Evidence | Consequence |
|---|---|---|
| The free Spark plan allows 5 email-link sign-in emails per day; Blaze allows 25,000 | Firebase Auth limits page, read through search summaries of several language versions; a note says these limits changed recently | Email link for scorers requires a billing-enabled plan. Confirm on the English limits page |
| A link opened on a different device from the one that requested it must be completed by re-entering the email; Firebase advises against putting the email in the link | Firebase email-link docs (search summary) | Have the scorer request the link on their own phone from the invitation (`/?code=…`), so the tap completes with no typing. A link triggered from the organiser's device needs one confirmation step |
| On iPhone, a link tapped in a mail app opens in Safari or an in-app browser, whose storage is separate from an installed home-screen app | Developer forum reports, several of them old; not re-tested on current iOS | Golfers should use the same browser they sign in with; do not require installing the PWA. Test on current iOS before the first event |
| Sign-in needs email delivery and signal | Inferred | Scorers sign in once before the event, not on the first tee. The session then persists |
| Link lifetime | Not found in the sources | Unverified. Do not send links days ahead; let scorers request them |
| Default sender is a Firebase address | Inferred | Spam-folder risk; configure a custom sender domain |

Fallback at the tee: let a signed-in organiser enter or correct scores for any group and change a group's scorer email on the spot. That covers a scorer who cannot sign in, and it also delivers the admin correction path in B9. I recommend launching with that rather than keeping a PIN path; a rules-validated PIN fallback can be added later if a real event shows the need.

Points to prove in rules tests: email case normalisation; the query a scorer uses to find their groups; create-only tournament writes; that no public document contains an email or PIN.

**S2. Billable API keys ship in the client bundle.** `feedbackAI.ts:1, 378`, `CourseSearchStep.tsx:53`.
- Scenario: `VITE_OPENROUTER_API_KEY` is compiled into the JavaScript and sent as a bearer token from the browser. Anyone who opens the site, including the public `/create` and results pages, can extract it and spend the account's credit. The golf-course API key is exposed the same way.
- Confidence: high (Read). Whether production currently sets the key is Unverified.
- Fix: leave the OpenRouter variable unset in production builds now (the code falls back to static commentary immediately); then call both APIs through a small server-side proxy on the VPS (nginx `proxy_pass` with the key injected, plus a rate limit) or drop AI commentary. Effort S for the interim, S to M for the proxy.

**B1. Scoring stalls when the phone is offline.** `useGroup.ts:127`, `Scorecard.tsx:364, 395-399, 580`.
- Scenario: `saveHole` awaits `setDoc`. Offline, that promise does not settle. The lock modal stays open, there is no auto-advance or commentary, `saving` stays true, and "Save & Lock" stays disabled, so a group can lock one hole per offline period. On reconnect the pending handler fires its delayed `setCurrentHole(h + 1)` from wherever the golfer has navigated.
- Confidence: high. Executed: with the network disabled, `setDoc` on firebase 12.9.0 was still pending after 4 seconds. The UI consequence is Read.
- Fix: treat the write as done once queued locally. Close the modal and advance immediately; show "Saved on this phone / Synced" from snapshot `metadata.hasPendingWrites`. Effort S to M.
- Validation: reducer unit tests; Playwright with `context.setOffline(true)` against the Firestore emulator, locking three holes offline and asserting all three sync.

**B3. Wolf points and carry go stale after a correction.** `Scorecard.tsx:139, 350, 402-405`, `wolf.ts:48-62`.
- Scenario: carry and points are computed once at lock time and stored. Hole 3 is locked as a tie; hole 4 is locked with carry 1 and its winners get +2. Hole 3 is unlocked, corrected to a decisive result, and re-locked. Hole 4 keeps the old carry and points, so totals stay inflated. Nothing recomputes later holes.
- Confidence: high (Read). With in-order play this needs a correction that changes a hole between tied and decisive.
- Fix: store only the inputs and derive carry and points for the round in one pure function at read time. Effort S to M, part of R4.
- Validation: unit tests for unlock and re-score and for consecutive ties.

### Medium

| ID | Finding | Where | Failure scenario | Evidence | Fix (effort) |
|---|---|---|---|---|---|
| B2 | Each save rewrites the whole `holes` array from local state, and the merge ignores remote unlocks. Unlocked entries live only in React state | `useGroup.ts:80-85, 122-127`, `firestore.ts:272-283` | With one scorer per group this needs a second device: a backup scorer, the organiser correcting scores (the R13 fallback), or the scorer's own stale second tab. That device's next save overwrites holes it has not yet received. Separately, a tab eviction loses scores entered but not yet locked | Read | Write one hole at a time into a map under a new field name with `setDoc(..., { merge: true })`; accept remote values for non-dirty holes; persist the current hole on change (M). Needed before organiser-side corrections ship |
| B4 | Public results, print results, and the admin summary look up par by position in the filtered list of locked holes | `PublicResults.tsx:59-97`, `PrintResults.tsx:55-94`, `Admin.tsx:35-59` | With in-order play this appears when a hole is unlocked for correction, or left unlocked, while later holes are locked: hole 1 (par 5) unlocked and hole 2 (par 3) locked with a 3 shows -2 instead of E | Executed (scratch test: -2, expected 0) | One shared standings function (S–M) |
| B7 | The in-app leaderboard sums every hole holding a value, including unlocked ones and stale Wolf points, while "holes in" counts locked holes | `useLeaderboard.ts:62-96` | A team unlocks hole 7 or pre-enters hole 8: the total includes it and disagrees with the public page. Four screens use three calculations | Executed for scramble; Read | Same shared function |
| B5 | `updateDoc` is called with `undefined` values | `Admin.tsx:464, 500` | Saving tournament settings without a logo, or editing a pending round with "No course", throws; nothing is saved and the button stays on "Saving…" | Executed (SDK rejects `undefined`) | `deleteField()` and `try/finally` (S) |
| B6 | Deletes do not cascade | `Admin.tsx:396-402, 439-443`, `firestore.ts:47, 236`, `AppAdmin.tsx:83` | Deleting a round leaves its groups and scores although the dialog says they are removed; orphaned PINs block new pairings and still log in. Pairing, course, and golfer deletes have no confirmation (`Admin.tsx:694, 772, 1128`). "Archive" is a delete | Read | Batch-delete children, confirm deletes, make archive a flag (S–M) |
| B8 | Lock can fire twice | `Scorecard.tsx:395-399, 613` | The modal stays enabled during the save; a second tap schedules a second auto-advance and the next scores go on the wrong hole | Read | In-flight guard; cancel the timer on manual navigation (S, folds into B1) |
| B9 | No safe way to reopen or correct a completed round | `Admin.tsx:445-459, 1304` | Status only cycles complete → pending, which deletes all scores. The admin has no score-editing screen | Read | Add complete → active; separate "Reset scores"; admin hole edit (M) |
| B10 | Player IDs follow list position on pairing edit | `Admin.tsx:345-351` | Removing player 2 mid-round shifts players 3 and 4 onto other IDs; stored scores and Wolf points are attributed to the wrong people | Read | Keep IDs per slot (S) |
| B11 | The commentary sheet blocks the screen while the AI call is pending | `HoleFeedbackToast.tsx:31`, `feedbackAI.ts:5` | For up to 5 s on weak signal the 55 vh sheet cannot be dismissed and covers the action bar, on every Best Ball, Scramble, and Gauntlet hole | Read | Dismissable at any time; do not cover the action bar (S) |
| B12 | Session handling logs golfers out at bad moments | `useAuth.ts:40, 65, 142-146` | TTL is 6 hours from login and never refreshed, so a reload late in a long round drops to login. A failed tournament fetch on restore also clears the session | Read | Sliding or end-of-day expiry; keep the session on transient errors (S) |
| B13 | Home and Scorecard read rounds once | `Home.tsx:34`, `Scorecard.tsx:59` | Golfers waiting on "No active rounds yet" never see the round go live without restarting the PWA; a fetch failure shows the same empty state | Read | Subscribe to rounds; error state with retry (S) |

### Low

| ID | Finding | Where | Evidence |
|---|---|---|---|
| B14 | The app-admin create form accepts admin PINs of 4+ digits but the keypad stops at 4, locking that organiser out (`/create` correctly requires exactly 4). A manually typed group PIN equal to the admin PIN logs that group in as admin. PIN fields accept non-digits | `AppAdmin.tsx:54`, `Login.tsx:89`, `Admin.tsx:367-374, 1035, 1201` | Read |
| B15 | Changing a pending round's course does not update its pars or hole count | `Admin.tsx:460-475` | Read |
| B16 | Swipe navigation listens on `window` with no vertical check, so scrolling the hole strip also changes hole | `Scorecard.tsx:99-114` | Read |
| B17 | Rounds saved with the old `saturday_am` / `saturday_pm` values no longer appear on Home, which groups by weekday | `Home.tsx:7, 47-51`, `types/tournament.ts:25` | Inferred. Affects existing tournaments only |
| B18 | Ties get different ranks and medals; teams with no holes rank at E above over-par teams; Wolf groups are ranked by the sum of their players' points | `TeamLeaderboard.tsx:18`, `useLeaderboard.ts:56, 69` | Read |
| B19 | No player-count validation per format; Wolf with fewer than 4 players misbehaves (`Math.min()` of an empty list is `Infinity`) | `wolf.ts:127`, `Admin.tsx:377-379` | Inferred |
| B20 | Deploy builds in place: Vite empties `dist/` while nginx serves it, and a failed build leaves production without assets. `add_header` inside location blocks means server-level security headers are not sent for `index.html` or assets | `deploy.sh:18-28`, `nginx.site.conf`, `nginx/dev-golfbender:14-31` | Read. Live config Unverified |
| B21 | `/bypass` route remains although `LaunchGate` is gone | `App.tsx:54-60, 65` | Read |
| B22 | `storage.rules` allows public writes to a logo path although logos are stored in Firestore | `storage.rules:6-9` | Read. Deployed state Unverified |
| B23 | `user-scalable=no` blocks pinch zoom; an unset score shows par in grey and differs from an entered par only by colour; the leaderboard "Live" badge is always on | `index.html:7`, `ScoreInput.tsx:35-51`, `Leaderboard.tsx:58` | Read |
| B24 | `forceOwnership: true` lets a second tab take the cache lease from the first | `firebase.ts:23` | Inferred, not tested |

---

## 3. Recommended improvements

| ID | Improvement | Fixes | Impact | Effort | Confidence | Priority |
|---|---|---|---|---|---|---|
| R13 | Backend access control: email-link sign-in for organisers and scorers, authorisation by verified email in rules, no PINs or emails in public documents, App Check | S1, B12 | High | L | Medium (design to be proven with rules tests; needs a billing-enabled plan) | P0 before onboarding other organisers |
| R15 | Keep API keys out of the bundle: unset now, proxy later | S2 | High | S, then S–M | High | P0 |
| R1 | Local-first save with a sync indicator and a lock guard | B1, B8 | High | S–M | High | P0 |
| R4 | One shared standings module with tests, used by all four screens | B4, B7, B18 | High | S–M | High | P0. Prerequisite for handicaps |
| R3 | Derive Wolf carry and points from inputs at read time | B3 | Medium-high | S–M | High | P0 with R4 |
| R2 | Per-hole writes, dirty tracking, persist the in-progress hole | B2 | Medium | M | Medium-high | P2, rising to P1 when organisers can edit a group's scores |
| R7 | Tournament JSON export and import; Firestore backups if billing allows | S1 recovery | High when needed | S | High | P1 |
| R5 | Admin write fixes: `undefined`, cascade deletes, confirmations, PIN validation, stable player IDs, par refresh | B5, B6, B10, B14, B15, B19 | Medium | S–M | High | P1 |
| R6 | Round reopen without data loss, and admin score correction | B9 | Medium-high | M | Medium (product choice) | P1 |
| R8 | Session and round freshness | B12, B13 | Medium | S | High | P1 |
| R9 | Tests and CI: unit tests for Best Ball, Scramble, Gauntlet, standings, and the merge reducer; GitHub Actions for lint, test, build | Regressions | Medium | S–M | High | P1 |
| R10 | Commentary sheet never blocks score entry | B11 | Low-medium | S | High | P1 |
| R11 | Scorecard clarity: explicit "not entered" state, scoped swipe, whole-round review before the last lock, allow zoom | B16, B23 | Medium | S–M | Medium | P2 |
| R12 | Deploy hardening: merge `main`'s fixes, build to a temporary directory and swap, delete `deploy-ai.sh`, repeat headers per location | B20 | Low-medium | S | High | P2 |
| R14 | Housekeeping: refresh `CLAUDE.md` and `TODOS.md`, remove `/bypass`, lock or remove `storage.rules`, in-range dependency updates, map legacy day values | B17, B21, B22, drift | Low | S | High | P2 |

Refactors are limited to those that fix a named problem. Splitting `Admin.tsx` is worth doing only while implementing R5, R6, and R13. The format `switch` blocks and casts repeated across the scorecard and results pages mostly disappear once R4 exists. `TODOS.md` Phase 2 (handicaps) plans to change `bestBall.ts` and `scramble.ts`; with four separate aggregations today, do R4 first or net scoring has to be implemented four times.

### Improvements to existing workflows versus new features

Existing workflows: everything in the table above.

New features, each a product hypothesis rather than a finding:

| Idea | Benefit | Note |
|---|---|---|
| Organiser accounts with "my tournaments" | Replaces unrecoverable admin PINs; an organiser sees and manages only their events | Falls out of R13 |
| One sign-in per scorer for the whole event | Groups and PINs are per round today, so players need a new PIN each round | Falls out of R13: the scorer's email is listed on each round's group |
| Overall standings across rounds | Results are per round only | Needs a rule for combining formats |
| Handicaps and net scoring | Already planned in `TODOS.md` Phase 2 | After R4 |
| High-contrast or light theme for sunlight | Dark grey on dark grey is hard to read outdoors | Not tested on a device |

Not recommended: push notifications, chat, GPS or shot tracking. Nothing in the current product calls for them.

---

## 4. Five highest-value next actions

1. **Make `phase1-self-service` the mainline safely**: merge `main`'s two deploy fixes into it, leave the OpenRouter key unset in production builds (R15), then merge to `main`. Do not publicise `/create` yet.
2. **R13: build email-link sign-in and the rules**, with emulator tests, organiser-side score entry as the fallback, and a billing-enabled plan confirmed first. This is the gate for onboarding other organisers.
3. **R1: local-first locking** with a visible sync state and a double-tap guard. Largest on-course reliability gain for the least work.
4. **R4 with R3: one tested standings module**, including derived Wolf carry. Corrects the public and print totals and unblocks handicaps.
5. **R7 plus B5 and B6**: an export button gives a recovery path the same day, and the settings-save and round-delete bugs are small.

---

## 5. Roadmap

**Quick wins (hours each).** Unset the OpenRouter key in production. B5 `deleteField` and `try/finally`. B8 lock guard. B11 dismissable sheet. B14 PIN validation. B10 stable player IDs. JSON export. Remove `/bypass` and `deploy-ai.sh`. In-range dependency updates (`npm update`, which also clears the audit advisories). Refresh `CLAUDE.md` and tick off `TODOS.md`.

**One focused cycle (about two to three weeks).** R13 first: email-link sign-in, rules with emulator tests, scorer emails on groups, organiser-side score entry, migration. Then R1 and R4 with R3, with R9 tests and CI built alongside, then R6 and what remains of R8. Exit criteria: in rules tests an organiser cannot write another organiser's tournament and no public document holds a PIN or email; a scorer signs in on an iPhone and an Android phone and reaches their group; three holes locked offline sync after reconnect; all four standings screens agree on a fixture set; CI is green.

**Larger optional investments.** R2 per-hole writes (before organiser corrections are used during live rounds). API proxy with rate limiting. Cross-round standings. Handicaps (Phase 2). Sunlight theme. Per-golfer identity across rounds.

---

## 6. Modernization

| Topic | What I verified | Recommendation |
|---|---|---|
| In-range updates | `npm outdated` (Executed): React 19.3.1, React Router 7.18.5, firebase 12.19.0, Vite 7.3.8, Tailwind 4.3.5, Vitest 4.1.12 available without a major bump | Take them, with tests and build as the gate |
| Vite 8 | Stable since 2026-03-12, built on Rolldown; migration guide at vite.dev (search summary) | Defer. The build takes 3 seconds. `vite-plugin-pwa` 2.0 compatibility Unverified |
| TypeScript 7 | Released 2026; secondary sources report it ships without the programmatic API and that `typescript-eslint` does not support it yet | Stay on 5.9; recheck when `typescript-eslint` declares support |
| ESLint 10 | Available; reported as blocked on the same dependency | Stay on 9 |
| Firebase 13 | Released 2026-10-07. Breaking changes I found concern AI Logic; Firestore changes Unverified | No reason to move now |
| API keys in clients | Firebase's guidance for its own AI product is to keep model keys server-side and enforce App Check | Same principle applies to the OpenRouter and course-search keys (S2) |
| Firestore recovery | Point-in-time recovery and scheduled backups exist and require billing to be enabled | Consider if the plan allows; JSON export covers the gap meanwhile |

`firebase.google.com` was not reachable for direct page reads from this session, so Firebase statements rest on search summaries of official pages plus the two SDK behaviours I executed locally. The R13 design relies on `request.auth.token.email`, `email_verified`, and `get()` in rules, which the Firebase rules documentation describes (search summary); the combined rule has not been run.

**Easier now with stronger coding models (no AI at runtime).** Firestore rules with an emulator test suite; the R1 to R4 rework with full unit tests; a Playwright offline suite; splitting `Admin.tsx`; keeping `CLAUDE.md` and `TODOS.md` accurate. These were expensive relative to the app's size and are now a few supervised sessions.

**Runtime AI.** The only use is hole commentary, which is entertainment. Keep it only if it never delays score entry and its key is not public. I do not recommend runtime AI elsewhere: scoring, standings, and setup are deterministic, and no user problem found here needs a model.

---

## 7. Working well, preserve

- Pure, readable scoring functions and type guards under `src/lib/scoring/`, with meaningful Wolf tests.
- Firestore persistent cache: queued writes should survive a killed tab (Inferred from configuration; not device-tested).
- The score-entry design: large steppers that start from par, tee order with the Wolf last, carry banner, lock confirmation, jump to the first unlocked hole.
- No accounts for golfers; `?code=` login links; per-group share, text, and copy invitations; the PIN collision check.
- Unambiguous 8-character tournament codes with tests.
- Public results with hole detail and the printable results page.
- `deploy.sh` type-checks before building; the dev deployment is isolated from production.
- Immediate fallback to static commentary when no AI key is configured or the call fails.
- A small dependency surface, a fast build, and a clean lint run on this branch.

---

## 8. Open questions

1. Is the Firebase project on a billing-enabled plan, or can it be? Email-link sign-in for scorers depends on it (5 sign-in emails per day otherwise), as do backups.
2. Will organisers have a scorer's email address for every group before the event? If not, scorers need a way to claim a group, which changes the design.
3. Is organiser-side score entry an acceptable fallback, or do you want a PIN fallback for scorers who cannot sign in?
4. Which commit is production running, and are the OpenRouter and course-search keys set there?
5. Are these Wolf rules intended: carry paid in full to each winner, a fixed rotation on holes 17 and 18, each opponent receiving the carry when a lone wolf loses?
6. Should Wolf groups be ranked against each other at all, or only individuals?
7. Do older tournaments with `saturday_am` / `saturday_pm` rounds need to stay viewable (B17)?
8. When is the next event? That fixes the cut line between quick wins and the focused cycle.
9. Can you share the live nginx config and the deployed Firestore and Storage rules? B20 and B22 rest on repository files only.

---

## Sources for external claims

- [Announcing Vite 8](https://vite.dev/blog/announcing-vite8) and [Vite migration guide](https://vite.dev/guide/migration.md)
- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7.0/)
- [Firebase JavaScript SDK release notes](https://firebase.google.cn/support/release-notes/js)
- [Firebase AI Logic security checklist](https://firebase.google.com/docs/ai-logic/security-checklist) and [production checklist](https://firebase.google.cn/docs/ai-logic/production-checklist?hl=en)
- [Firebase Authentication limits](https://firebase.google.com/docs/auth/limits), [email-link sign-in for web](https://firebase.google.com/docs/auth/web/email-link-auth?authuser=377174373), and [Security Rules and Firebase Authentication](https://firebase.google.com/docs/rules/rules-and-auth?authuser=19)
- [iOS home-screen app OAuth and storage report (Apple developer forum)](https://developer.apple.com/forums/thread/100407)
- [Firestore point-in-time recovery](https://firebase.google.com/docs/firestore/pitr?authuser=252) and [disaster recovery planning](https://firebase.google.com/docs/firestore/disaster-recovery)
