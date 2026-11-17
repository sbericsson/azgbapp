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
  players: Player[];
  roundId: string;
  /** Who keeps score for this group. Only organisers can see it. */
  scorerEmail?: string;
}

export type RoundFormat = 'wolf' | 'bestBall' | 'scramble' | 'gauntlet';
export type RoundStatus = 'pending' | 'active' | 'complete';

export interface Round {
  id: string;
  name: string;
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
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
  createdAt: number;
  /** Organiser emails. Only organisers can see them. */
  admins?: string[];
  logoUrl?: string;
  selfService?: boolean; // true when created via /create; triggers onboarding wizard
  archivedAt?: number; // set when archived: hidden from the list, code login blocked
}

