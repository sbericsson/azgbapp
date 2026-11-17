import { api, ApiError, cachedGet, live, onOutboxChange, pendingHoles, queueHoles, scorePath, type Unsubscribe } from './api';
import { tournamentCodeCandidates } from './tournamentCode';
import { holesFromDoc } from './scoring/holes';
import { parseBackup, type TournamentBackup } from './backupFormat';
import type { Tournament, Group, Golfer, Course, Round } from '../types/tournament';
import type { GroupScoreDoc, HoleScore } from '../types/scoring';

export type { Unsubscribe } from './api';
export { parseBackup, type TournamentBackup } from './backupFormat';

/**
 * Data access for the app, backed by the self-hosted API (R13). Function names
 * match the old Firestore layer so pages did not need to change shape.
 * Access control is enforced by the server; these calls fail with 401/403
 * when the signed-in person may not do something.
 */

const enc = encodeURIComponent;
const tPath = (t: string) => `/tournaments/${enc(t)}`;
const cPath = (t: string, coll: string, id?: string) => `${tPath(t)}/${coll}${id ? `/${enc(id)}` : ''}`;

async function getOrNull<T>(path: string): Promise<T | null> {
  try {
    return (await cachedGet<T>(path, true)).value;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

const patch = (path: string, data: object) => api<unknown>('PATCH', path, data, { nullsForUndefined: true });

// ── Auth ───────────────────────────────────────────────────────────────────────

export interface ScorerGroupRef {
  tournamentId: string;
  id: string;
  roundId: string | null;
  name: string;
}

export interface Me {
  email: string | null;
  appAdmin: boolean;
  /** Signed in by email or by a shared group link */
  signedIn: boolean;
  /** Tournament codes this person organises */
  admin: string[];
  /** Groups this person keeps score for */
  groups: ScorerGroupRef[];
}

export async function fetchMe(): Promise<Me> {
  return api<Me>('GET', '/auth/me');
}

export interface ServerConfig {
  /** The server can email sign-in links (SMTP configured) */
  emailSignIn: boolean;
}

export async function getServerConfig(): Promise<ServerConfig> {
  return (await cachedGet<ServerConfig>('/config')).value;
}

/** A sign-in link to copy, text or email yourself, and its stand-alone code. */
export interface SignInLink {
  url: string;
  code: string;
  expiresAt: number;
}

export async function requestSignIn(email: string, opts: { purpose?: 'signin' | 'create'; tournamentId?: string } = {}): Promise<void> {
  await api('POST', '/auth/request', { email, purpose: opts.purpose ?? 'signin', tournamentId: opts.tournamentId });
}

export async function verifySignInToken(token: string): Promise<Me & { tournamentId: string | null }> {
  return api('POST', '/auth/verify', { token });
}

/** Email + 6-digit code from an emailed link, or the XXXX-XXXX code of a shared link alone. */
export async function verifySignInCode(email: string | null, code: string): Promise<Me & { tournamentId: string | null }> {
  return api('POST', '/auth/verify', email ? { email, code } : { code });
}

/** App admins: a sign-in link for anyone, e.g. a new organiser. */
export async function appAdminSignInLink(email: string): Promise<SignInLink> {
  return api('POST', '/auth/link', { email });
}

export async function signOut(): Promise<void> {
  await api('POST', '/auth/logout', {});
}

// ── Tournaments ────────────────────────────────────────────────────────────────

/** Create a tournament owned by the signed-in person; the server picks the code. */
export async function createTournament(name: string, admins?: string[]): Promise<Tournament> {
  return api<Tournament>('POST', '/tournaments', { name, admins });
}

export async function getTournament(id: string): Promise<Tournament | null> {
  return getOrNull<Tournament>(tPath(id));
}

export async function findTournamentByCode(code: string): Promise<Tournament | null> {
  for (const candidate of tournamentCodeCandidates(code)) {
    const tournament = await getTournament(candidate);
    // Archived tournaments cannot be opened by code
    if (tournament && !tournament.archivedAt) return tournament;
  }
  return null;
}

/** Every tournament for an app admin; the ones you organise otherwise. */
export async function listTournaments(): Promise<Tournament[]> {
  return api<Tournament[]>('GET', '/tournaments');
}

export async function deleteTournament(id: string): Promise<void> {
  await api('DELETE', tPath(id));
}

export async function setTournamentArchived(id: string, archived: boolean): Promise<void> {
  await api('POST', `${tPath(id)}/archive`, { archived });
}

export async function updateTournament(id: string, data: Partial<Pick<Tournament, 'name' | 'logoUrl'>>): Promise<void> {
  await patch(tPath(id), data);
}

export async function setTournamentAdmins(id: string, emails: string[]): Promise<string[]> {
  return (await api<{ admins: string[] }>('PUT', `${tPath(id)}/admins`, { emails })).admins;
}

/** A sign-in link for one of the tournament's organisers. */
export async function organiserSignInLink(id: string, email: string): Promise<SignInLink> {
  return api('POST', `${tPath(id)}/admins/link`, { email });
}

// ── Courses ────────────────────────────────────────────────────────────────────

export async function createCourse(t: string, id: string, data: Omit<Course, 'id'>): Promise<void> {
  await api('PUT', cPath(t, 'courses', id), data);
}

export async function getCourse(t: string, courseId: string): Promise<Course | null> {
  return getOrNull<Course>(cPath(t, 'courses', courseId));
}

export async function listCourses(t: string): Promise<Course[]> {
  return (await cachedGet<Course[]>(cPath(t, 'courses'))).value;
}

export async function updateCourse(t: string, courseId: string, data: Partial<Omit<Course, 'id'>>): Promise<void> {
  await patch(cPath(t, 'courses', courseId), data);
}

export async function deleteCourse(t: string, courseId: string): Promise<void> {
  await api('DELETE', cPath(t, 'courses', courseId));
}

// ── Golfers (organisers only) ──────────────────────────────────────────────────

export async function createGolfer(t: string, id: string, data: Omit<Golfer, 'id'>): Promise<void> {
  await api('PUT', cPath(t, 'golfers', id), data);
}

export async function listGolfers(t: string): Promise<Golfer[]> {
  return api<Golfer[]>('GET', cPath(t, 'golfers'));
}

export async function deleteGolfer(t: string, golferId: string): Promise<void> {
  await api('DELETE', cPath(t, 'golfers', golferId));
}

// ── Groups ─────────────────────────────────────────────────────────────────────

const groupsOfRound = (t: string, roundId: string) => `${cPath(t, 'groups')}?roundId=${enc(roundId)}`;

export async function createGroup(t: string, id: string, data: Omit<Group, 'id'>): Promise<void> {
  await api('PUT', cPath(t, 'groups', id), data);
}

export async function listGroups(t: string): Promise<Group[]> {
  return (await cachedGet<Group[]>(cPath(t, 'groups'))).value;
}

export async function listGroupsByRound(t: string, roundId: string): Promise<Group[]> {
  return (await cachedGet<Group[]>(groupsOfRound(t, roundId))).value;
}

export function subscribeGroupsByRound(t: string, roundId: string, callback: (groups: Group[]) => void): Unsubscribe {
  return live<Group[]>(t, groupsOfRound(t, roundId), (e) => e.c === 'groups' && (!e.r || e.r === roundId), (g) => callback(g));
}

export async function getGroupById(t: string, groupId: string): Promise<Group | null> {
  return getOrNull<Group>(cPath(t, 'groups', groupId));
}

export async function updateGroup(t: string, groupId: string, data: Partial<Omit<Group, 'id'>>): Promise<void> {
  await patch(cPath(t, 'groups', groupId), data);
}

/** Delete one group; the server removes its scores too. */
export async function deleteGroupWithScores(t: string, _roundId: string, groupId: string): Promise<void> {
  await api('DELETE', cPath(t, 'groups', groupId));
}

/** A sign-in link for the group's scorer, to text or email (valid 14 days). */
export async function groupSignInLink(t: string, groupId: string): Promise<SignInLink> {
  return api('POST', `${cPath(t, 'groups', groupId)}/link`, {});
}

/** Email the group's scorer the sign-in link (server must have email). Returns the address. */
export async function inviteScorer(t: string, groupId: string): Promise<string> {
  return (await api<{ sentTo: string }>('POST', `${cPath(t, 'groups', groupId)}/invite`, {})).sentTo;
}

/** Void the group's links and sign out every phone that joined through one. */
export async function revokeGroupLinks(t: string, groupId: string): Promise<void> {
  await api('POST', `${cPath(t, 'groups', groupId)}/revoke`, {});
}

// ── Rounds ─────────────────────────────────────────────────────────────────────

const LEGACY_DAYS: Record<string, Round['day']> = {
  saturday_am: 'saturday',
  saturday_pm: 'saturday',
  sunday_am: 'sunday',
  sunday_pm: 'sunday',
};

/** Translate legacy day values (B17). */
function toRound(data: Round): Round {
  const day = String(data.day ?? '');
  return { ...data, day: LEGACY_DAYS[day] ?? (day as Round['day']) };
}

export async function createRound(t: string, id: string, data: Omit<Round, 'id'>): Promise<void> {
  await api('PUT', cPath(t, 'rounds', id), data);
}

export async function listRounds(t: string): Promise<Round[]> {
  return (await cachedGet<Round[]>(cPath(t, 'rounds'))).value.map(toRound);
}

export function subscribeRounds(t: string, callback: (rounds: Round[]) => void, onError?: (err: Error) => void): Unsubscribe {
  return live<Round[]>(t, cPath(t, 'rounds'), (e) => e.c === 'rounds', (r) => callback(r.map(toRound)), { onError });
}

export function subscribeRound(t: string, roundId: string, callback: (round: Round | null) => void): Unsubscribe {
  return live<Round | null>(
    t,
    cPath(t, 'rounds', roundId),
    (e) => e.c === 'rounds' && (!e.id || e.id === roundId),
    (r) => callback(r ? toRound(r) : null),
    { nullOn404: true },
  );
}

export async function updateRound(t: string, roundId: string, data: Partial<Omit<Round, 'id'>>): Promise<void> {
  await patch(cPath(t, 'rounds', roundId), data);
}

/** Delete a round with its groups and scores (the server cascades). */
export async function deleteRound(t: string, roundId: string): Promise<void> {
  await api('DELETE', cPath(t, 'rounds', roundId));
}

// ── Scores ─────────────────────────────────────────────────────────────────────

interface ScoreDocJson {
  groupId: string;
  updatedAt: number;
  holeMap: Record<string, HoleScore>;
}

/** Server copy plus any holes still waiting in this phone's outbox. */
function withPending(t: string, roundId: string, groupId: string, doc: ScoreDocJson | null): ScoreDocJson | null {
  const pending = pendingHoles(t, roundId, groupId);
  if (pending.length === 0) return doc;
  const holeMap: Record<string, HoleScore> = { ...(doc?.holeMap ?? {}) };
  for (const p of pending) Object.assign(holeMap, p.holeMap);
  return { groupId, updatedAt: doc?.updatedAt ?? Date.now(), holeMap };
}

function toScoreDoc(doc: ScoreDocJson): GroupScoreDoc {
  return { groupId: doc.groupId, updatedAt: doc.updatedAt, holes: holesFromDoc(doc) };
}

/**
 * Queue some holes of a group's scores (R2: only the holes that changed).
 * Applied locally at once; the promise settles on server acknowledgement,
 * so never await it in the scoring UI (B1).
 */
export function saveGroupHoles(t: string, roundId: string, groupId: string, updates: ReadonlyMap<number, HoleScore>): Promise<void> {
  const holeMap: Record<string, HoleScore> = {};
  for (const [i, hole] of updates) holeMap[String(i)] = hole;
  return queueHoles(t, roundId, groupId, holeMap);
}

export function subscribeGroupScores(
  t: string,
  roundId: string,
  groupId: string,
  callback: (doc: GroupScoreDoc | null, meta: { hasPendingWrites: boolean; fromCache: boolean }) => void,
): Unsubscribe {
  let server: ScoreDocJson | null = null;
  let fromCache = true;
  let received = false;
  const emit = () => {
    if (!received && pendingHoles(t, roundId, groupId).length === 0) return;
    const merged = withPending(t, roundId, groupId, server);
    callback(merged ? toScoreDoc(merged) : null, {
      hasPendingWrites: pendingHoles(t, roundId, groupId).length > 0,
      fromCache,
    });
  };
  const unsubLive = live<ScoreDocJson | null>(
    t,
    scorePath(t, roundId, groupId),
    (e) => e.c === 'scores' && (!e.r || e.r === roundId) && (!e.id || e.id === groupId),
    (doc, meta) => { server = doc; fromCache = meta.fromCache; received = true; emit(); },
    {
      nullOn404: true,
      // Never seen this group's scores and no connection: start empty
      onError: () => { if (!received) { received = true; emit(); } },
    },
  );
  const unsubOutbox = onOutboxChange(emit);
  return () => { unsubLive(); unsubOutbox(); };
}

export async function listAllScores(t: string, roundId: string): Promise<GroupScoreDoc[]> {
  return (await cachedGet<ScoreDocJson[]>(scorePath(t, roundId))).value.map(toScoreDoc);
}

export function subscribeAllScores(t: string, roundId: string, callback: (docs: GroupScoreDoc[]) => void): Unsubscribe {
  let server: ScoreDocJson[] = [];
  const emit = () => {
    const byGroup = new Map(server.map((d) => [d.groupId, d]));
    for (const p of pendingHoles(t, roundId)) {
      byGroup.set(p.groupId, withPending(t, roundId, p.groupId, byGroup.get(p.groupId) ?? null)!);
    }
    callback([...byGroup.values()].map(toScoreDoc));
  };
  const unsubLive = live<ScoreDocJson[]>(t, scorePath(t, roundId), (e) => e.c === 'scores' && (!e.r || e.r === roundId), (docs) => {
    server = docs;
    emit();
  });
  const unsubOutbox = onOutboxChange(emit);
  return () => { unsubLive(); unsubOutbox(); };
}

export async function clearRoundScores(t: string, roundId: string): Promise<void> {
  await api('DELETE', scorePath(t, roundId));
}

// ── Backup (R7) ────────────────────────────────────────────────────────────────

export async function exportTournament(t: string): Promise<TournamentBackup> {
  return parseBackup(await api<unknown>('GET', `${tPath(t)}/backup`));
}

/** App admins only. Refuses a code that is already in use. */
export async function importTournament(backup: TournamentBackup, targetId = backup.tournamentId): Promise<void> {
  await api('POST', '/import', { backup, targetId });
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
