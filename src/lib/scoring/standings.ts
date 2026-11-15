import type {
  GroupScoreDoc,
  HoleScore,
  WolfHoleScore,
} from '../../types/scoring';
import type { Group, Player, Round, RoundFormat } from '../../types/tournament';
import { WOLF_PARTNER_WIN_EACH } from '../../constants/wolf';
import { computeWolfPoints, isWolfHole } from './wolf';
import { computeBestScore, isBestBallHole } from './bestBall';
import { isScrambleHole } from './scramble';
import { isGauntletHole } from './gauntlet';

/**
 * Single source of truth for round standings. Every screen that shows a total
 * (in-app leaderboard, scorecard, public results, print results, admin) goes
 * through this module so they cannot disagree.
 *
 * Rules:
 *  - Only locked holes count.
 *  - Par is looked up by the hole's own index in the round, never by its
 *    position in a filtered list.
 *  - Wolf carry and points are derived from the stored inputs (scores, wolf
 *    decision) in hole order at read time, so correcting an earlier hole
 *    updates every later hole.
 */

export const parFor = (pars: number[], holeIndex: number): number => pars[holeIndex] ?? 4;

// ── Wolf ───────────────────────────────────────────────────────────────────────

/**
 * Recompute carry and points for every Wolf hole from its inputs.
 *
 * Carry for hole i is the base stake of each consecutive locked, tied hole
 * immediately before it (lone-wolf bonuses do not carry). An unlocked or
 * decisive hole resets the carry. Unlocked holes get the carry that would
 * apply if they were locked now, and no points.
 */
export function deriveWolfHoles(holes: WolfHoleScore[], players: Player[]): WolfHoleScore[] {
  let carry = 0;
  return holes.map((hole) => {
    if (!hole.locked) {
      const derived = { ...hole, carry, points: [] };
      carry = 0;
      return derived;
    }
    const points = computeWolfPoints(hole, players, carry);
    const derived = { ...hole, carry, points };
    const tied = points.length > 0 && points.every((p) => p.pts === 0);
    carry = tied ? carry + WOLF_PARTNER_WIN_EACH : 0;
    return derived;
  });
}

export function wolfPlayerTotals(
  derivedHoles: WolfHoleScore[],
  players: Player[],
): { playerId: string; name: string; pts: number }[] {
  return players.map((p) => ({
    playerId: p.id,
    name: p.name,
    pts: derivedHoles.reduce((sum, h) => {
      if (!h.locked) return sum;
      return sum + (h.points.find((pt) => pt.playerId === p.id)?.pts ?? 0);
    }, 0),
  }));
}

// ── Stroke formats ────────────────────────────────────────────────────────────

/** Team strokes on a hole for stroke formats, or null if not available. */
export function teamStrokes(hole: HoleScore | undefined): number | null {
  if (!hole) return null;
  if (isWolfHole(hole)) return null;
  if (isBestBallHole(hole)) return hole.bestScore ?? computeBestScore(hole.scores);
  if (isGauntletHole(hole) || isScrambleHole(hole)) return hole.teamScore;
  return null;
}

/** Team score relative to par across locked holes, using each hole's own par. */
export function teamToPar(holes: HoleScore[], pars: number[], throughHole = Infinity): number {
  return holes.reduce((sum, hole, i) => {
    if (i > throughHole || !hole?.locked) return sum;
    const strokes = teamStrokes(hole);
    return strokes === null ? sum : sum + (strokes - parFor(pars, i));
  }, 0);
}

/**
 * Per-player score relative to par across locked holes (Best Ball and Wolf,
 * which record individual gross scores).
 */
export function playerToPar(
  holes: HoleScore[],
  pars: number[],
  playerId: string,
  throughHole = Infinity,
): number {
  return holes.reduce((sum, hole, i) => {
    if (i > throughHole || !hole?.locked) return sum;
    if (!('scores' in hole)) return sum;
    const s = hole.scores.find((sc) => sc.playerId === playerId);
    return s && s.gross > 0 ? sum + (s.gross - parFor(pars, i)) : sum;
  }, 0);
}

export function lockedCount(holes: HoleScore[], throughHole = Infinity): number {
  return holes.filter((h, i) => i <= throughHole && h?.locked).length;
}

// ── Standings ─────────────────────────────────────────────────────────────────

export interface StandingEntry {
  group: Group;
  /** Wolf: total points (higher is better). Others: team score to par (lower is better). */
  score: number;
  holesCompleted: number;
  /** 1-based; tied scores share a rank. Groups with no holes are unranked (null). */
  rank: number | null;
  tied: boolean;
  /** Wolf: per-player points. */
  playerPoints?: { playerId: string; name: string; pts: number }[];
  /** Best Ball: per-player score to par. */
  playerTotals?: { playerId: string; name: string; total: number }[];
  /** Score doc with Wolf carry/points derived from inputs. */
  scoreDoc?: GroupScoreDoc;
}

export function higherIsBetter(format: RoundFormat): boolean {
  return format === 'wolf';
}

function holesMatchFormat(holes: HoleScore[], format: RoundFormat): boolean {
  const first = holes.find(Boolean);
  if (!first) return true;
  switch (format) {
    case 'wolf': return isWolfHole(first);
    case 'bestBall': return isBestBallHole(first);
    case 'scramble': return isScrambleHole(first);
    case 'gauntlet': return isGauntletHole(first);
  }
}

export function computeGroupStanding(
  round: Pick<Round, 'format' | 'par'>,
  group: Group,
  scoreDoc: GroupScoreDoc | undefined,
): Omit<StandingEntry, 'rank' | 'tied'> {
  if (!scoreDoc || !Array.isArray(scoreDoc.holes) || !holesMatchFormat(scoreDoc.holes, round.format)) {
    return { group, score: 0, holesCompleted: 0 };
  }
  const holes = scoreDoc.holes;
  const holesCompleted = lockedCount(holes);

  if (round.format === 'wolf') {
    const derived = deriveWolfHoles(holes as WolfHoleScore[], group.players);
    const playerPoints = wolfPlayerTotals(derived, group.players);
    return {
      group,
      score: playerPoints.reduce((s, p) => s + p.pts, 0),
      holesCompleted,
      playerPoints,
      scoreDoc: { ...scoreDoc, holes: derived },
    };
  }

  const score = teamToPar(holes, round.par);
  if (round.format === 'bestBall') {
    const playerTotals = group.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      total: playerToPar(holes, round.par, p.id),
    }));
    return { group, score, holesCompleted, playerTotals, scoreDoc };
  }
  return { group, score, holesCompleted, scoreDoc };
}

/**
 * Rank already-computed entries. Groups that have not locked a hole sort to
 * the bottom and are unranked. Equal scores share a rank (1, 1, 3); ties are
 * listed with more holes completed first, then by name.
 */
export function rankEntries<T extends { score: number; holesCompleted: number; group: { name: string } }>(
  entries: T[],
  format: RoundFormat,
): (T & { rank: number | null; tied: boolean })[] {
  const sign = higherIsBetter(format) ? -1 : 1;
  const sorted = [...entries].sort((a, b) => {
    const aPlayed = a.holesCompleted > 0;
    const bPlayed = b.holesCompleted > 0;
    if (aPlayed !== bPlayed) return aPlayed ? -1 : 1;
    if (a.score !== b.score) return sign * (a.score - b.score);
    if (a.holesCompleted !== b.holesCompleted) return b.holesCompleted - a.holesCompleted;
    return a.group.name.localeCompare(b.group.name);
  });

  return sorted.map((entry, i) => {
    if (entry.holesCompleted === 0) return { ...entry, rank: null, tied: false };
    const first = sorted.findIndex((e) => e.holesCompleted > 0 && e.score === entry.score);
    const tied = sorted.some((e, j) => j !== i && e.holesCompleted > 0 && e.score === entry.score);
    return { ...entry, rank: first + 1, tied };
  });
}

export function computeStandings(
  round: Pick<Round, 'format' | 'par'>,
  groups: Group[],
  scoreDocs: GroupScoreDoc[],
): StandingEntry[] {
  const entries = groups.map((group) =>
    computeGroupStanding(round, group, scoreDocs.find((d) => d.groupId === group.id)),
  );
  return rankEntries(entries, round.format);
}

export function formatScore(score: number, format: RoundFormat): string {
  if (format === 'wolf') return `${score} pts`;
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}

export function formatRank(rank: number | null, tied: boolean): string {
  if (rank === null) return '–';
  return tied ? `T${rank}` : `${rank}`;
}
