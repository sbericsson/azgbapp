import { collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

import { BACKUP_VERSION, type TournamentBackup } from './backupFormat';

export { parseBackup, type TournamentBackup } from './backupFormat';

/**
 * Tournament backup and restore (R7), so one bad write or delete is recoverable.
 */

type Data = Record<string, unknown>;

export async function exportTournament(tournamentId: string): Promise<TournamentBackup> {
  const tSnap = await getDoc(doc(db, 'tournaments', tournamentId));
  if (!tSnap.exists()) throw new Error(`Tournament ${tournamentId} not found`);

  const sub = (name: string) => getDocs(collection(db, 'tournaments', tournamentId, name));
  const [rounds, groups, golfers, courses] = await Promise.all([
    sub('rounds'), sub('groups'), sub('golfers'), sub('courses'),
  ]);
  const roundsWithScores = await Promise.all(
    rounds.docs.map(async (r) => {
      const scores = await getDocs(collection(r.ref, 'scores'));
      return {
        id: r.id,
        data: r.data(),
        scores: scores.docs.map((s) => ({ id: s.id, data: s.data() })),
      };
    }),
  );

  return {
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    tournamentId,
    tournament: tSnap.data(),
    rounds: roundsWithScores,
    groups: groups.docs.map((d) => ({ id: d.id, data: d.data() })),
    golfers: golfers.docs.map((d) => ({ id: d.id, data: d.data() })),
    courses: courses.docs.map((d) => ({ id: d.id, data: d.data() })),
  };
}

/**
 * Write a backup into Firestore under `targetId` (defaults to the original ID).
 * Refuses to overwrite an existing tournament.
 */
export async function importTournament(backup: TournamentBackup, targetId = backup.tournamentId): Promise<void> {
  const existing = await getDoc(doc(db, 'tournaments', targetId));
  if (existing.exists()) throw new Error(`Tournament code "${targetId}" is already in use`);

  const writes: { path: string[]; data: Data }[] = [];
  const t = (...p: string[]) => ['tournaments', targetId, ...p];
  for (const r of backup.rounds) {
    writes.push({ path: t('rounds', r.id), data: r.data });
    for (const s of r.scores) writes.push({ path: t('rounds', r.id, 'scores', s.id), data: s.data });
  }
  for (const g of backup.groups) writes.push({ path: t('groups', g.id), data: g.data });
  for (const g of backup.golfers) writes.push({ path: t('golfers', g.id), data: g.data });
  for (const c of backup.courses) writes.push({ path: t('courses', c.id), data: c.data });
  // Tournament document last, so a partial import is not visible by code until complete
  const { archivedAt: _archivedAt, ...tournament } = backup.tournament;
  void _archivedAt;
  writes.push({ path: t(), data: tournament });

  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + 450)) {
      const [first, ...rest] = w.path;
      batch.set(doc(db, first, ...rest), w.data);
    }
    await batch.commit();
  }
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
