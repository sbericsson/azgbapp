import type { GauntletHoleScore } from '../../types/scoring';

/**
 * Returns which segment applies to a given hole index.
 * Splits totalHoles evenly into thirds: best ball → scramble → alternate shot.
 */
export function getGauntletSegment(
  holeIndex: number,
  totalHoles: number,
): 'bestBall' | 'scramble' | 'altShot' {
  const third = Math.floor(totalHoles / 3);
  if (holeIndex < third) return 'bestBall';
  if (holeIndex < third * 2) return 'scramble';
  return 'altShot';
}

/**
 * Returns the player index (0 or 1) who tees off on a given alternate-shot hole.
 * Player 1 (index 0) tees off on the first alt-shot hole, then alternates each hole.
 */
export function getAltShotTeeOffIndex(
  holeIndex: number,
  totalHoles: number,
): 0 | 1 {
  const altShotStart = Math.floor(totalHoles / 3) * 2;
  return (holeIndex - altShotStart) % 2 === 0 ? 0 : 1;
}

/**
 * Build a default empty GauntletHoleScore for a given hole index.
 */
export function emptyGauntletHole(
  holeIndex: number,
  totalHoles: number,
): GauntletHoleScore {
  return {
    segment: getGauntletSegment(holeIndex, totalHoles),
    teamScore: null,
    locked: false,
  };
}

/**
 * Type guard for GauntletHoleScore.
 */
export function isGauntletHole(hole: unknown): hole is GauntletHoleScore {
  return typeof hole === 'object' && hole !== null && 'segment' in hole;
}

/**
 * Score relative to par for a single gauntlet hole, or null if not yet entered.
 */
export function gauntletRelativeToPar(
  hole: GauntletHoleScore,
  par: number,
): number | null {
  if (hole.teamScore === null) return null;
  return hole.teamScore - par;
}

/**
 * Cumulative score-to-par across all completed gauntlet holes.
 */
export function gauntletTotalToPar(
  holes: GauntletHoleScore[],
  pars: number[],
): number {
  return holes.reduce((sum, hole, i) => {
    const rel = gauntletRelativeToPar(hole, pars[i] ?? 4);
    return rel !== null ? sum + rel : sum;
  }, 0);
}
