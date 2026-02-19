import {
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { Tournament, Group, Golfer, Course, Round } from '../types/tournament';
import type { GroupScoreDoc, HoleScore } from '../types/scoring';

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

export async function listTournaments(): Promise<Tournament[]> {
  const snap = await getDocs(collection(db, 'tournaments'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Tournament);
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

export async function listCourses(tournamentId: string): Promise<Course[]> {
  const snap = await getDocs(coursesRef(tournamentId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Course);
}

export async function updateCourse(
  tournamentId: string,
  courseId: string,
  data: Partial<Omit<Course, 'id'>>,
): Promise<void> {
  await updateDoc(doc(db, 'tournaments', tournamentId, 'courses', courseId), data);
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
  await updateDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId), data);
}

export async function deleteGroup(
  tournamentId: string,
  groupId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'groups', groupId));
}

// ── Rounds ─────────────────────────────────────────────────────────────────────

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
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Round);
}

export async function updateRound(
  tournamentId: string,
  roundId: string,
  data: Partial<Omit<Round, 'id'>>,
): Promise<void> {
  await updateDoc(
    doc(db, 'tournaments', tournamentId, 'rounds', roundId),
    data,
  );
}

export async function deleteRound(
  tournamentId: string,
  roundId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'tournaments', tournamentId, 'rounds', roundId));
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

export async function saveGroupScores(
  tournamentId: string,
  roundId: string,
  groupId: string,
  holes: HoleScore[],
): Promise<void> {
  await setDoc(
    scoreDocRef(tournamentId, roundId, groupId),
    { groupId, updatedAt: Date.now(), holes },
    { merge: true },
  );
}

export function subscribeGroupScores(
  tournamentId: string,
  roundId: string,
  groupId: string,
  callback: (doc: GroupScoreDoc | null) => void,
): Unsubscribe {
  return onSnapshot(
    scoreDocRef(tournamentId, roundId, groupId),
    (snap) => {
      if (!snap.exists()) {
        callback(null);
        return;
      }
      callback(snap.data() as GroupScoreDoc);
    },
    (err) => console.error('subscribeGroupScores error', err),
  );
}

export function subscribeAllScores(
  tournamentId: string,
  roundId: string,
  callback: (docs: GroupScoreDoc[]) => void,
): Unsubscribe {
  return onSnapshot(
    scoresCollectionRef(tournamentId, roundId),
    (snap) => {
      callback(snap.docs.map((d) => d.data() as GroupScoreDoc));
    },
    (err) => console.error('subscribeAllScores error', err),
  );
}
