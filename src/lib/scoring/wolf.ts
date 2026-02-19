import type { WolfHoleScore, PlayerPoints } from '../../types/scoring';
import type { Player } from '../../types/tournament';
import {
  WOLF_LONE_PRE_WIN,
  WOLF_LONE_POST_WIN,
  WOLF_LONE_LOSE_EACH,
  WOLF_PARTNER_WIN_EACH,
} from '../../constants/wolf';

/**
 * Determine which player is the Wolf for a given hole (0-indexed).
 * Rotation: players[holeIndex % 4]
 */
export function getWolfPlayer(players: Player[], holeIndex: number): Player {
  return players[holeIndex % players.length];
}

/**
 * How many points the winning side would earn on this hole before carry.
 * Used to compute how much carry rolls over on a tie.
 */
export function getBaseStakes(hole: WolfHoleScore): number {
  if (hole.loneWolfType === 'pre') return WOLF_LONE_PRE_WIN;
  if (hole.loneWolfType === 'post') return WOLF_LONE_POST_WIN;
  return WOLF_PARTNER_WIN_EACH;
}

/**
 * Compute accumulated carry points for hole at holeIndex.
 * Scans backwards through locked holes; accumulates base stakes from consecutive tied holes.
 * Stops at the first decisive hole (any pts > 0) or incomplete hole (points = []).
 */
export function computeCarryForHole(
  holes: WolfHoleScore[],
  holeIndex: number,
): number {
  let carry = 0;
  for (let i = holeIndex - 1; i >= 0; i--) {
    const h = holes[i];
    if (!h.locked) break;
    if (h.points.length === 0) break; // incomplete hole
    if (h.points.some((p) => p.pts > 0)) break; // decisive — carry was collected here
    // all pts = 0 → tied → accumulate base stake only (lone wolf bonus does not carry)
    carry += WOLF_PARTNER_WIN_EACH;
  }
  return carry;
}

/**
 * Compute Wolf points for a hole given the current hole state.
 * Returns an array of PlayerPoints — one per player.
 *
 * Returns [] (incomplete) when:
 *   - Not all scores are entered (any gross ≤ 0)
 *   - No wolf mode is selected (loneWolfType null AND partnerId null)
 *
 * Returns all-zero points (tied) when scores are set and mode is set but
 * the result is a tie (wolf score === best opponent, or team score === opp score).
 *
 * carry is added to each winner's per-player payout.
 */
export function computeWolfPoints(
  hole: Omit<WolfHoleScore, 'points' | 'locked' | 'carry'>,
  players: Player[],
  carry = 0,
): PlayerPoints[] {
  const { wolfPlayerId, loneWolfType, partnerId, scores } = hole;

  // Need all scores to compute points
  if (scores.length < players.length) return [];
  for (const s of scores) {
    if (!s.gross || s.gross <= 0) return [];
  }

  // No wolf mode chosen yet — treat as incomplete
  if (loneWolfType !== 'pre' && loneWolfType !== 'post' && !partnerId) return [];

  const pts: PlayerPoints[] = players.map((p) => ({ playerId: p.id, pts: 0 }));
  const addPts = (playerId: string, delta: number) => {
    const entry = pts.find((p) => p.playerId === playerId);
    if (entry) entry.pts += delta;
  };

  const scoreFor = (playerId: string): number =>
    scores.find((s) => s.playerId === playerId)?.gross ?? 99;

  if (loneWolfType === 'pre' || loneWolfType === 'post') {
    const wolfScore = scoreFor(wolfPlayerId);
    const opponents = players.filter((p) => p.id !== wolfPlayerId);
    const bestOpponent = Math.min(...opponents.map((p) => scoreFor(p.id)));
    const winPts = loneWolfType === 'pre' ? WOLF_LONE_PRE_WIN : WOLF_LONE_POST_WIN;

    if (wolfScore < bestOpponent) {
      // wolf wins
      addPts(wolfPlayerId, winPts + carry);
    } else if (wolfScore > bestOpponent) {
      // wolf loses — each opponent gets base + carry
      opponents.forEach((p) => addPts(p.id, WOLF_LONE_LOSE_EACH + carry));
    }
    // else: wolfScore === bestOpponent → tie → all pts stay 0, carry rolls over
  } else {
    // Wolf picked a partner — best ball (wolf+partner) vs the other two
    if (!partnerId) return pts; // shouldn't reach here (guarded above)

    const wolfScore = scoreFor(wolfPlayerId);
    const partnerScore = scoreFor(partnerId);
    const teamBest = Math.min(wolfScore, partnerScore);

    const opponents = players.filter(
      (p) => p.id !== wolfPlayerId && p.id !== partnerId,
    );
    const oppBest = Math.min(...opponents.map((p) => scoreFor(p.id)));

    if (teamBest < oppBest) {
      addPts(wolfPlayerId, WOLF_PARTNER_WIN_EACH + carry);
      addPts(partnerId, WOLF_PARTNER_WIN_EACH + carry);
    } else if (oppBest < teamBest) {
      opponents.forEach((p) => addPts(p.id, WOLF_PARTNER_WIN_EACH + carry));
    }
    // tie: all pts stay 0, carry rolls over
  }

  return pts;
}

/**
 * Sum Wolf points across all holes for leaderboard.
 */
export function totalWolfPoints(
  holes: WolfHoleScore[],
  playerId: string,
): number {
  return holes.reduce((sum, hole) => {
    const entry = hole.points.find((p) => p.playerId === playerId);
    return sum + (entry?.pts ?? 0);
  }, 0);
}

/**
 * Build a default empty WolfHoleScore for a given hole.
 */
export function emptyWolfHole(
  players: Player[],
  holeIndex: number,
): WolfHoleScore {
  return {
    wolfPlayerId: getWolfPlayer(players, holeIndex).id,
    loneWolfType: null,
    partnerId: null,
    scores: players.map((p) => ({ playerId: p.id, gross: 0 })),
    points: [],
    carry: 0,
    locked: false,
  };
}

/**
 * Given a wolf hole state, carry amount, and players, recompute points and return updated hole.
 */
export function withComputedPoints(
  hole: WolfHoleScore,
  players: Player[],
  carry = 0,
): WolfHoleScore {
  return {
    ...hole,
    carry,
    points: computeWolfPoints(hole, players, carry),
  };
}

/**
 * Type guard for WolfHoleScore
 */
export function isWolfHole(hole: unknown): hole is WolfHoleScore {
  return typeof hole === 'object' && hole !== null && 'wolfPlayerId' in hole;
}

/**
 * Returns a human-readable description of what happened on a wolf hole.
 */
export function wolfHoleResultDescription(
  hole: WolfHoleScore,
  players: Player[],
): string {
  const wolf = players.find((p) => p.id === hole.wolfPlayerId);
  if (!wolf) return '';

  const carryBonus = hole.carry > 0 ? ` (+${hole.carry} carry)` : '';

  // All-zero points → tied → carry rolls over to next hole
  const isTied = hole.points.length > 0 && hole.points.every((p) => p.pts === 0);
  if (isTied) {
    // Always 1 pt base carries — lone wolf bonus does not carry
    return `Tie — ${hole.carry + WOLF_PARTNER_WIN_EACH} pts carry to next hole`;
  }

  if (hole.loneWolfType === 'pre') {
    const wolfWon = (hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0) > 0;
    return wolfWon
      ? `${wolf.name} went Lone Wolf (pre) and WON! +${WOLF_LONE_PRE_WIN + hole.carry} pts${carryBonus}`
      : `${wolf.name} went Lone Wolf (pre) and lost. Others +${WOLF_LONE_LOSE_EACH + hole.carry} each${carryBonus}`;
  }
  if (hole.loneWolfType === 'post') {
    const wolfWon = (hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0) > 0;
    return wolfWon
      ? `${wolf.name} went Lone Wolf (post) and WON! +${WOLF_LONE_POST_WIN + hole.carry} pts${carryBonus}`
      : `${wolf.name} went Lone Wolf (post) and lost. Others +${WOLF_LONE_LOSE_EACH + hole.carry} each${carryBonus}`;
  }
  if (hole.partnerId) {
    const partner = players.find((p) => p.id === hole.partnerId);
    const wolfPts = hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0;
    if (wolfPts > 0) {
      return `${wolf.name} & ${partner?.name} WON! Each +${WOLF_PARTNER_WIN_EACH + hole.carry} pt${carryBonus}`;
    }
    const opponents = players.filter(
      (p) => p.id !== hole.wolfPlayerId && p.id !== hole.partnerId,
    );
    const oppPts = hole.points.find((p) => p.playerId === opponents[0]?.id)?.pts ?? 0;
    if (oppPts > 0) {
      return `Opponents beat ${wolf.name} & ${partner?.name}. Each +${WOLF_PARTNER_WIN_EACH + hole.carry} pt${carryBonus}`;
    }
    return `Tie — ${hole.carry + WOLF_PARTNER_WIN_EACH} pts carry to next hole`;
  }
  return 'Awaiting wolf decision';
}
