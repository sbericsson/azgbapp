export interface PlayerScore {
  playerId: string;
  gross: number;
}

export interface PlayerPoints {
  playerId: string;
  pts: number;
}

// Wolf
export type LoneWolfType = null | 'pre' | 'post';

export interface WolfHoleScore {
  wolfPlayerId: string;
  loneWolfType: LoneWolfType;
  partnerId: string | null;
  scores: PlayerScore[];
  points: PlayerPoints[];
  carry: number; // accumulated carry points in play when this hole was played
  locked: boolean;
}

// Best Ball
export interface BestBallHoleScore {
  scores: PlayerScore[];
  bestScore: number | null;
  locked: boolean;
}

// Scramble (2-person or 4-person)
export interface ScrambleHoleScore {
  teamScore: number | null;
  locked: boolean;
}

// Gauntlet (2-person): holes 1–6 best ball, 7–12 scramble, 13–18 alternate shot
// All three segments use a single team score entry.
export interface GauntletHoleScore {
  segment: 'bestBall' | 'scramble' | 'altShot';
  teamScore: number | null;
  locked: boolean;
}

export type HoleScore = WolfHoleScore | BestBallHoleScore | ScrambleHoleScore | GauntletHoleScore;

export interface GroupScoreDoc {
  groupId: string;
  updatedAt: number;
  holes: HoleScore[];
}
