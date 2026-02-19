import type { BestBallHoleScore, PlayerScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';

/**
 * Compute best (lowest) score from all players on a hole.
 * Returns null if any score is missing.
 */
export function computeBestScore(scores: PlayerScore[]): number | null {
  if (scores.length === 0) return null;
  for (const s of scores) {
    if (!s.gross || s.gross <= 0) return null;
  }
  return Math.min(...scores.map((s) => s.gross));
}

/**
 * Build a default empty BestBallHoleScore.
 */
export function emptyBestBallHole(players: Player[]): BestBallHoleScore {
  return {
    scores: players.map((p) => ({ playerId: p.id, gross: 0 })),
    bestScore: null,
    locked: false,
  };
}

/**
 * Returns score relative to par for a hole, or null if incomplete.
 */
export function bestBallRelativeToPar(
  hole: BestBallHoleScore,
  par: number,
): number | null {
  if (hole.bestScore === null) return null;
  return hole.bestScore - par;
}

/**
 * Compute cumulative score-to-par for all completed holes.
 */
export function bestBallTotalToPar(
  holes: BestBallHoleScore[],
  pars: number[],
): number {
  return holes.reduce((sum, hole, i) => {
    const rel = bestBallRelativeToPar(hole, pars[i] ?? 4);
    return rel !== null ? sum + rel : sum;
  }, 0);
}

/**
 * Type guard for BestBallHoleScore
 */
export function isBestBallHole(hole: unknown): hole is BestBallHoleScore {
  return (
    typeof hole === 'object' &&
    hole !== null &&
    'bestScore' in hole &&
    !('wolfPlayerId' in hole) &&
    !('teamScore' in hole)
  );
}
