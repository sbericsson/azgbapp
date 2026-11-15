import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  query,
  where,
  onSnapshot,
  FieldPath,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { tournamentCodeCandidates } from './tournamentCode';
import { holesFromDoc } from './scoring/holes';
import type { Tournament, Group, Golfer, Course, Round, AppConfig } from '../types/tournament';
import type { GroupScoreDoc, HoleScore } from '../types/scoring';
import type { DocumentReference, UpdateData, DocumentData } from 'firebase/firestore';

/**
 * Firestore rejects `undefined` field values. In a partial update, `undefined`
 * means "clear this field", so translate it to deleteField() (B5).
 */
function toUpdate<T extends object>(data: T): UpdateData<DocumentData> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v === undefined ? deleteField() : v;
  }
  return out as UpdateData<DocumentData>;
}

/** Delete many documents in batches of at most 450 writes. */
async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

// ── Tournaments ────────────────────────────────────────────────────────────────

export async function createTournament(
  id: string,
  data: Omit<Tournament, 'id'>,
): Promise<void> {
  await setDoc(doc(db, 'tournaments', id), data);
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const snap = await getDoc(doc(db, 'tournaments', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Tournament;
}

export async function findTournamentByCode(code: string): Promise<Tournament | null> {
  for (const candidate of tournamentCodeCandidates(code)) {
    const tournament = await getTournament(candidate);
    // Archived tournaments cannot be logged into by code
    if (tournament && !tournament.archivedAt) return tournament;
  }
  return null;
}

export async function listTournaments(): Promise<Tournament[]> {
  const snap = await getDocs(collection(db, 'tournaments'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tournament);
}

/**
 * Permanently delete a tournament and everything under it (rounds and their
 * scores, groups, golfers, courses). Firestore does not cascade on its own.
 */
export async function deleteTournament(id: string): Promise<void> {
  const [rounds, groups, golfers, courses] = await Promise.all([
    getDocs(collection(db, 'tournaments', id, 'rounds')),
    getDocs(collection(db, 'tournaments', id, 'groups')),
    getDocs(collection(db, 'tournaments', id, 'golfers')),
    getDocs(collection(db, 'tournaments', id, 'courses')),
  ]);
  const scoreSnaps = await Promise.all(
    rounds.docs.map((r) => getDocs(collection(r.ref, 'scores'))),
  );
  await deleteRefs([
    ...scoreSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
    ...rounds.docs.map((d) => d.ref),
    ...groups.docs.map((d) => d.ref),
    ...golfers.docs.map((d) => d.ref),
    ...courses.docs.map((d) => d.ref),
    doc(db, 'tournaments', id),
  ]);
}

/** Archive hides a tournament and blocks code login; data is kept and can be restored. */
export async function setTournamentArchived(id: string, archived: boolean): Promise<void> {
  await updateDoc(doc(db, 'tournaments', id), toUpdate({ archivedAt: archived ? Date.now() : undefined }));
}

export async function updateTournament(
  id: string,
  data: Partial<Omit<Tournament, 'id'>>,
): Promise<void> {
  await updateDoc(doc(db, 'tournaments', id), toUpdate(data));
}

// ── App Config ─────────────────────────────────────────────────────────────────

export async function getAppConfig(): Promise<AppConfig | null> {
  const snap = await getDoc(doc(db, 'config', 'app'));
  if (!snap.exists()) return null;
  return snap.data() as AppConfig;
}

// ── Courses ────────────────────────────────────────────────────────────────────

export function coursesRef(tournamentId: string) {
  return collection(db, 'tournaments', tournamentId, 'courses');
}

export async function createCourse(
  tournamentId: string,
  id: string,
  data: Omit<Course, 'id'>,
): Promise<void> {
  await setDoc(doc(db, 'tournaments', tournamentId, 'courses', id), data);
}

export async function getCourse(tournamentId: string, courseId: string): Promise<Course | null> {
  const snap = await getDoc(doc(db, 'tournaments', tournamentId, 'courses', courseId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Course;
}

export async function listCourses(tournamentId: string): Promise<Course[]> {
  const snap = await getDocs(coursesRef(tournamentId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Course);
}

export async function updateCourse(
  tournamentId: string,
  courseId: string,
  data: Partial<Omit<Course, 'id'>>,
): Promise<void> {
  await updateDoc(doc(db, 'tournaments', tournamentId, 'courses', courseId), toUpdate(data));
}

export async function deleteCourse(
  tournamentId: string,
  courseId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'courses', courseId));
}

// ── Golfers (master roster) ────────────────────────────────────────────────────

export function golfersRef(tournamentId: string) {
  return collection(db, 'tournaments', tournamentId, 'golfers');
}

export async function createGolfer(
  tournamentId: string,
  id: string,
  data: Omit<Golfer, 'id'>,
): Promise<void> {
  await setDoc(doc(db, 'tournaments', tournamentId, 'golfers', id), data);
}

export async function listGolfers(tournamentId: string): Promise<Golfer[]> {
  const snap = await getDocs(golfersRef(tournamentId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Golfer);
}

export async function deleteGolfer(
  tournamentId: string,
  golferId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'golfers', golferId));
}

// ── Groups ─────────────────────────────────────────────────────────────────────

export function groupsRef(tournamentId: string) {
  return collection(db, 'tournaments', tournamentId, 'groups');
}

export async function createGroup(
  tournamentId: string,
  id: string,
  data: Omit<Group, 'id'>,
): Promise<void> {
  await setDoc(doc(db, 'tournaments', tournamentId, 'groups', id), data);
}

export async function listGroups(tournamentId: string): Promise<Group[]> {
  const snap = await getDocs(groupsRef(tournamentId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Group);
}

export async function listGroupsByRound(
  tournamentId: string,
  roundId: string,
): Promise<Group[]> {
  const q = query(groupsRef(tournamentId), where('roundId', '==', roundId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Group);
}

export function subscribeGroupsByRound(
  tournamentId: string,
  roundId: string,
  callback: (groups: Group[]) => void,
): Unsubscribe {
  const q = query(groupsRef(tournamentId), where('roundId', '==', roundId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Group));
  });
}

export async function getGroupById(
  tournamentId: string,
  groupId: string,
): Promise<Group | null> {
  const snap = await getDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as Group;
}

export async function getGroupByPin(
  tournamentId: string,
  pin: string,
): Promise<Group | null> {
  const q = query(groupsRef(tournamentId), where('pin', '==', pin));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Group;
}

export async function updateGroup(
  tournamentId: string,
  groupId: string,
  data: Partial<Omit<Group, 'id'>>,
): Promise<void> {
  await updateDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId), toUpdate(data));
}

export async function deleteGroup(
  tournamentId: string,
  groupId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId));
}

// ── Rounds ─────────────────────────────────────────────────────────────────────

const LEGACY_DAYS: Record<string, Round['day']> = {
  saturday_am: 'saturday',
  saturday_pm: 'saturday',
  sunday_am: 'sunday',
  sunday_pm: 'sunday',
};

/** Map a round document to a Round, translating legacy day values (B17). */
function toRound(id: string, data: Record<string, unknown>): Round {
  const day = String(data.day ?? '');
  return { id, ...data, day: LEGACY_DAYS[day] ?? day } as Round;
}

export function roundsRef(tournamentId: string) {
  return collection(db, 'tournaments', tournamentId, 'rounds');
}

export async function createRound(
  tournamentId: string,
  id: string,
  data: Omit<Round, 'id'>,
): Promise<void> {
  await setDoc(doc(db, 'tournaments', tournamentId, 'rounds', id), data);
}

export async function listRounds(tournamentId: string): Promise<Round[]> {
  const snap = await getDocs(roundsRef(tournamentId));
  return snap.docs.map((d) => toRound(d.id, d.data()));
}

export function subscribeRounds(
  tournamentId: string,
  callback: (rounds: Round[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    roundsRef(tournamentId),
    (snap) => callback(snap.docs.map((d) => toRound(d.id, d.data()))),
    (err) => {
      console.error('subscribeRounds error', err);
      onError?.(err);
    },
  );
}

export function subscribeRound(
  tournamentId: string,
  roundId: string,
  callback: (round: Round | null) => void,
): Unsubscribe {
  return onSnapshot(
    doc(db, 'tournaments', tournamentId, 'rounds', roundId),
    (snap) => callback(snap.exists() ? toRound(snap.id, snap.data()) : null),
    (err) => console.error('subscribeRound error', err),
  );
}

export async function updateRound(
  tournamentId: string,
  roundId: string,
  data: Partial<Omit<Round, 'id'>>,
): Promise<void> {
  await updateDoc(
    doc(db, 'tournaments', tournamentId, 'rounds', roundId),
    toUpdate(data),
  );
}

/** Delete a round together with its groups (pairings and PINs) and scores (B6). */
export async function deleteRound(
  tournamentId: string,
  roundId: string,
): Promise<void> {
  const [groups, scores] = await Promise.all([
    getDocs(query(groupsRef(tournamentId), where('roundId', '==', roundId))),
    getDocs(scoresCollectionRef(tournamentId, roundId)),
  ]);
  await deleteRefs([
    ...scores.docs.map((d) => d.ref),
    ...groups.docs.map((d) => d.ref),
    doc(db, 'tournaments', tournamentId, 'rounds', roundId),
  ]);
}

/** Delete one group and its score document for the round. */
export async function deleteGroupWithScores(
  tournamentId: string,
  roundId: string,
  groupId: string,
): Promise<void> {
  await deleteRefs([
    scoreDocRef(tournamentId, roundId, groupId),
    doc(db, 'tournaments', tournamentId, 'groups', groupId),
  ]);
}

// ── Scores ─────────────────────────────────────────────────────────────────────

export function scoreDocRef(
  tournamentId: string,
  roundId: string,
  groupId: string,
) {
  return doc(
    db,
    'tournaments',
    tournamentId,
    'rounds',
    roundId,
    'scores',
    groupId,
  );
}

export function scoresCollectionRef(tournamentId: string, roundId: string) {
  return collection(
    db,
    'tournaments',
    tournamentId,
    'rounds',
    roundId,
    'scores',
  );
}

/**
 * Write a group's holes. Resolves when the server acknowledges the write,
 * which never happens while offline: callers should not block the UI on it.
 * The write is applied to the local cache (and visible to snapshot listeners)
 * immediately, and queued for sync.
 */
/**
 * Write some holes of a group's score doc (R2). Each hole is its own field
 * (`holeMap.<index>`), replaced whole, so a device never overwrites holes it
 * did not change. Works on a doc that does not exist yet. Returns the write's
 * promise, which settles on server acknowledgement: never await it in the
 * scoring UI (B1).
 */
export function saveGroupHoles(
  tournamentId: string,
  roundId: string,
  groupId: string,
  updates: ReadonlyMap<number, HoleScore>,
): Promise<void> {
  const holeMap: Record<string, HoleScore> = {};
  const fields: (string | FieldPath)[] = ['groupId', 'updatedAt'];
  for (const [index, hole] of updates) {
    holeMap[String(index)] = hole;
    fields.push(new FieldPath('holeMap', String(index)));
  }
  return setDoc(
    scoreDocRef(tournamentId, roundId, groupId),
    { groupId, updatedAt: Date.now(), holeMap },
    { mergeFields: fields },
  );
}

function toScoreDoc(data: DocumentData, id: string): GroupScoreDoc {
  return {
    groupId: typeof data.groupId === 'string' ? data.groupId : id,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
    holes: holesFromDoc(data),
  };
}

export function subscribeGroupScores(
  tournamentId: string,
  roundId: string,
  groupId: string,
  callback: (doc: GroupScoreDoc | null, meta: { hasPendingWrites: boolean; fromCache: boolean }) => void,
): Unsubscribe {
  return onSnapshot(
    scoreDocRef(tournamentId, roundId, groupId),
    { includeMetadataChanges: true },
    (snap) => {
      const meta = {
        hasPendingWrites: snap.metadata.hasPendingWrites,
        fromCache: snap.metadata.fromCache,
      };
      if (!snap.exists()) {
        callback(null, meta);
        return;
      }
      callback(toScoreDoc(snap.data(), snap.id), meta);
    },
    (err) => console.error('subscribeGroupScores error', err),
  );
}

export async function listAllScores(
  tournamentId: string,
  roundId: string,
): Promise<GroupScoreDoc[]> {
  const snap = await getDocs(scoresCollectionRef(tournamentId, roundId));
  return snap.docs.map((d) => toScoreDoc(d.data(), d.id));
}

export async function clearRoundScores(
  tournamentId: string,
  roundId: string,
): Promise<void> {
  const snap = await getDocs(scoresCollectionRef(tournamentId, roundId));
  await deleteRefs(snap.docs.map((d) => d.ref));
}

export function subscribeAllScores(
  tournamentId: string,
  roundId: string,
  callback: (docs: GroupScoreDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    scoresCollectionRef(tournamentId, roundId),
    (snap) => {
      callback(snap.docs.map((d) => toScoreDoc(d.data(), d.id)));
    },
    (err) => console.error('subscribeAllScores error', err),
  );
}
