/**
 * Tournament backup format (R7). A backup is a plain JSON snapshot of a
 * tournament document and everything under it. Kept free of Firebase imports
 * so it can be unit tested.
 */

export const BACKUP_VERSION = 1;

type Data = Record<string, unknown>;

export interface TournamentBackup {
  version: number;
  exportedAt: number;
  tournamentId: string;
  tournament: Data;
  rounds: { id: string; data: Data; scores: { id: string; data: Data }[] }[];
  groups: { id: string; data: Data }[];
  golfers: { id: string; data: Data }[];
  courses: { id: string; data: Data }[];
}

/** Throws with a readable message if the value is not a usable backup. */
export function parseBackup(value: unknown): TournamentBackup {
  const fail = (msg: string): never => { throw new Error(`Not a valid backup: ${msg}`); };
  if (typeof value !== 'object' || value === null) fail('not an object');
  const b = value as Partial<TournamentBackup>;
  if (b.version !== BACKUP_VERSION) fail(`unsupported version ${String(b.version)}`);
  if (typeof b.tournamentId !== 'string' || !b.tournamentId) fail('missing tournamentId');
  if (typeof b.tournament !== 'object' || b.tournament === null) fail('missing tournament');
  for (const key of ['rounds', 'groups', 'golfers', 'courses'] as const) {
    const list = b[key];
    if (!Array.isArray(list)) fail(`${key} is not a list`);
    for (const item of list as { id?: unknown; data?: unknown }[]) {
      if (typeof item?.id !== 'string' || typeof item.data !== 'object' || item.data === null) {
        fail(`bad entry in ${key}`);
      }
    }
  }
  for (const r of b.rounds as TournamentBackup['rounds']) {
    if (!Array.isArray(r.scores)) fail(`round ${r.id} has no scores list`);
  }
  return b as TournamentBackup;
}
