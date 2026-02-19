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
 * Compute Wolf points for a hole given the current hole state.
 * Returns an array of PlayerPoints — one per player.
 * If any score is missing (0 or undefined), returns empty points array (hole not complete).
 */
export function computeWolfPoints(
  hole: Omit<WolfHoleScore, 'points' | 'locked'>,
  players: Player[],
): PlayerPoints[] {
  const { wolfPlayerId, loneWolfType, partnerId, scores } = hole;

  // Need all 4 scores to compute points
  if (scores.length < players.length) return [];
  for (const s of scores) {
    if (!s.gross || s.gross <= 0) return [];
  }

  const pts: PlayerPoints[] = players.map((p) => ({ playerId: p.id, pts: 0 }));
  const addPts = (playerId: string, delta: number) => {
    const entry = pts.find((p) => p.playerId === playerId);
    if (entry) entry.pts += delta;
  };

  const scoreFor = (playerId: string): number =>
    scores.find((s) => s.playerId === playerId)?.gross ?? 99;

  if (loneWolfType === 'pre' || loneWolfType === 'post') {
    // Lone wolf: wolf vs all three others
    const wolfScore = scoreFor(wolfPlayerId);
    const opponents = players.filter((p) => p.id !== wolfPlayerId);
    const bestOpponent = Math.min(...opponents.map((p) => scoreFor(p.id)));
    const wolfWins = wolfScore < bestOpponent;
    const winPts = loneWolfType === 'pre' ? WOLF_LONE_PRE_WIN : WOLF_LONE_POST_WIN;

    if (wolfWins) {
      addPts(wolfPlayerId, winPts);
    } else {
      // Each opponent gets 1 pt
      opponents.forEach((p) => addPts(p.id, WOLF_LONE_LOSE_EACH));
    }
  } else {
    // Wolf picked a partner — best ball (wolf+partner) vs the other two
    if (!partnerId) return pts; // shouldn't happen

    const wolfScore = scoreFor(wolfPlayerId);
    const partnerScore = scoreFor(partnerId);
    const teamBest = Math.min(wolfScore, partnerScore);

    const opponents = players.filter(
      (p) => p.id !== wolfPlayerId && p.id !== partnerId,
    );
    const oppBest = Math.min(...opponents.map((p) => scoreFor(p.id)));

    if (teamBest < oppBest) {
      addPts(wolfPlayerId, WOLF_PARTNER_WIN_EACH);
      addPts(partnerId, WOLF_PARTNER_WIN_EACH);
    } else if (oppBest < teamBest) {
      opponents.forEach((p) => addPts(p.id, WOLF_PARTNER_WIN_EACH));
    }
    // tie = 0 all
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
    locked: false,
  };
}

/**
 * Given a wolf hole state and players, recompute points and return updated hole.
 */
export function withComputedPoints(
  hole: WolfHoleScore,
  players: Player[],
): WolfHoleScore {
  return {
    ...hole,
    points: computeWolfPoints(hole, players),
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

  if (hole.loneWolfType === 'pre') {
    const wolfWon = (hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0) > 0;
    return wolfWon
      ? `${wolf.name} went Lone Wolf (pre) and WON! +${WOLF_LONE_PRE_WIN} pts`
      : `${wolf.name} went Lone Wolf (pre) and lost. Others +${WOLF_LONE_LOSE_EACH} each`;
  }
  if (hole.loneWolfType === 'post') {
    const wolfWon = (hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0) > 0;
    return wolfWon
      ? `${wolf.name} went Lone Wolf (post) and WON! +${WOLF_LONE_POST_WIN} pts`
      : `${wolf.name} went Lone Wolf (post) and lost. Others +${WOLF_LONE_LOSE_EACH} each`;
  }
  if (hole.partnerId) {
    const partner = players.find((p) => p.id === hole.partnerId);
    const wolfPts = hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0;
    if (wolfPts > 0) {
      return `${wolf.name} & ${partner?.name} WON! Each +${WOLF_PARTNER_WIN_EACH} pt`;
    }
    const opponents = players.filter(
      (p) => p.id !== hole.wolfPlayerId && p.id !== hole.partnerId,
    );
    const oppPts = hole.points.find((p) => p.playerId === opponents[0]?.id)?.pts ?? 0;
    if (oppPts > 0) {
      return `Opponents beat ${wolf.name} & ${partner?.name}. Each +${WOLF_PARTNER_WIN_EACH} pt`;
    }
    return `Tie — no points awarded`;
  }
  return 'Awaiting wolf decision';
}
