import type { HoleScore } from '../../types/scoring';
import type { Player, Round, RoundFormat } from '../../types/tournament';
import { emptyWolfHole, isWolfHole, withComputedPoints } from './wolf';
import { computeBestScore, emptyBestBallHole, isBestBallHole } from './bestBall';
import { emptyScrambleHole, isScrambleHole } from './scramble';
import { emptyGauntletHole, isGauntletHole } from './gauntlet';

/**
 * Hole arrays as stored and as used by the app (R2).
 *
 * Score docs are written one hole at a time into `holeMap` ({ "3": HoleScore }),
 * so a device only ever writes the holes it changed. Older docs hold a full
 * `holes` array. A doc read from Firestore can therefore have gaps; every
 * consumer fills them with `completeHoles` before use.
 */

export type SparseHoles = readonly (HoleScore | null | undefined)[];

type RoundShape = Pick<Round, 'format'> & { holes?: number; par?: number[] };

function holeCount(round: RoundShape): number {
  return round.holes ?? round.par?.length ?? 18;
}

export function emptyHole(format: RoundFormat, players: Player[], index: number, total: number): HoleScore {
  switch (format) {
    case 'wolf': return emptyWolfHole(players, index);
    case 'bestBall': return emptyBestBallHole(players);
    case 'scramble': return emptyScrambleHole();
    case 'gauntlet': return emptyGauntletHole(index, total);
  }
}

export function buildInitialHoles(round: RoundShape, players: Player[]): HoleScore[] {
  const total = holeCount(round);
  return Array.from({ length: total }, (_, i) => emptyHole(round.format, players, i, total));
}

/** True when the stored holes belong to this format (a format change leaves stale docs). */
export function holesMatchFormat(holes: SparseHoles, format: RoundFormat): boolean {
  const first = holes.find(Boolean);
  if (!first) return true;
  switch (format) {
    case 'wolf': return isWolfHole(first);
    case 'bestBall': return isBestBallHole(first);
    case 'scramble': return isScrambleHole(first);
    case 'gauntlet': return isGauntletHole(first);
  }
}

/**
 * A full, gap-free hole array for the round, or null when the stored holes are
 * from a different format.
 */
export function completeHoles(round: RoundShape, players: Player[], holes: SparseHoles): HoleScore[] | null {
  if (!holesMatchFormat(holes, round.format)) return null;
  const total = holeCount(round);
  return Array.from({ length: total }, (_, i) => holes[i] ?? emptyHole(round.format, players, i, total));
}

/** Read the holes of a raw score document: `holeMap` entries win over the legacy array. */
export function holesFromDoc(data: { holes?: unknown; holeMap?: unknown }): (HoleScore | null)[] {
  const out: (HoleScore | null)[] = Array.isArray(data.holes)
    ? (data.holes as (HoleScore | null)[]).map((h) => h ?? null)
    : [];
  if (data.holeMap && typeof data.holeMap === 'object') {
    for (const [key, hole] of Object.entries(data.holeMap as Record<string, HoleScore | null>)) {
      const i = Number(key);
      if (!Number.isInteger(i) || i < 0 || !hole) continue;
      while (out.length <= i) out.push(null);
      out[i] = hole;
    }
  }
  return out;
}

/**
 * Merge a remote snapshot into local state: holes this device has edited and
 * not yet written keep the local value; every other hole takes the remote one,
 * including a remote unlock or an organiser's correction.
 */
export function mergeRemoteHoles(local: HoleScore[], remote: HoleScore[], dirty: ReadonlySet<number>): HoleScore[] {
  return remote.map((r, i) => (dirty.has(i) && local[i] ? local[i] : r));
}

/**
 * The hole as it is saved on lock: unset scores default to par, and Wolf
 * points are computed with the carry in play.
 */
export function withLockDefaults(hole: HoleScore, par: number, players: Player[], carry: number): HoleScore {
  if (isWolfHole(hole)) {
    const scores = hole.scores.map((s) => (s.gross <= 0 ? { ...s, gross: par } : s));
    return withComputedPoints({ ...hole, scores, locked: true }, players, carry);
  }
  if (isBestBallHole(hole)) {
    const scores = hole.scores.map((s) => (s.gross <= 0 ? { ...s, gross: par } : s));
    return { ...hole, scores, bestScore: computeBestScore(scores) ?? hole.bestScore, locked: true };
  }
  if (isScrambleHole(hole) || isGauntletHole(hole)) {
    return { ...hole, teamScore: hole.teamScore ?? par, locked: true };
  }
  return { ...(hole as HoleScore), locked: true };
}
