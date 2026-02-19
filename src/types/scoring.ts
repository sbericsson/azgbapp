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

export type HoleScore = WolfHoleScore | BestBallHoleScore | ScrambleHoleScore;

export interface GroupScoreDoc {
  groupId: string;
  updatedAt: number;
  holes: HoleScore[];
}
