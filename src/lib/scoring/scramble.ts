import type { ScrambleHoleScore } from '../../types/scoring';

/**
 * Build a default empty ScrambleHoleScore.
 */
export function emptyScrambleHole(): ScrambleHoleScore {
  return { teamScore: null, locked: false };
}

/**
 * Score relative to par for a single hole, or null if not entered.
 */
export function scrambleRelativeToPar(
  hole: ScrambleHoleScore,
  par: number,
): number | null {
  if (hole.teamScore === null) return null;
  return hole.teamScore - par;
}

/**
 * Cumulative score-to-par across all holes.
 */
export function scrambleTotalToPar(
  holes: ScrambleHoleScore[],
  pars: number[],
): number {
  return holes.reduce((sum, hole, i) => {
    const rel = scrambleRelativeToPar(hole, pars[i] ?? 4);
    return rel !== null ? sum + rel : sum;
  }, 0);
}

/**
 * Type guard for ScrambleHoleScore
 */
export function isScrambleHole(hole: unknown): hole is ScrambleHoleScore {
  return (
    typeof hole === 'object' &&
    hole !== null &&
    'teamScore' in hole &&
    !('segment' in hole)
  );
}
