export interface Player {
  id: string;
  name: string;
}

export interface Golfer {
  id: string;
  name: string;
}

export interface Group {
  id: string;
  name: string;
  pin: string;
  players: Player[];
  roundId: string;
}

export type RoundFormat = 'wolf' | 'bestBall' | 'scramble' | 'gauntlet';
export type RoundStatus = 'pending' | 'active' | 'complete';

export interface Round {
  id: string;
  name: string;
  day: 'friday' | 'saturday_am' | 'saturday_pm' | 'sunday';
  format: RoundFormat;
  status: RoundStatus;
  holes: number;
  par: number[];
  courseId?: string;
}

export interface Course {
  id: string;
  name: string;
  holes: number;
  par: number[];
}

export interface Tournament {
  id: string;
  name: string;
  adminPin: string;
  createdAt: number;
  logoUrl?: string;
}

export interface AppConfig {
  appAdminPin: string;
}
