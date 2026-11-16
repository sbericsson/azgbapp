/**
 * One-time migration: copy every tournament from Firestore into the SQLite
 * database (R13). Run on the VPS (or locally) with the Firestore config that
 * the old app used:
 *
 *   npx tsx server/scripts/import-firestore.ts \
 *     --env /var/www/azgb/.env --db ~/azgb-data/azgb.db --owner you@example.com [--dry-run]
 *
 * --env    file with the old VITE_FIREBASE_* values (default .env.local)
 * --db     SQLite file the API server uses (DB_PATH)
 * --owner  organiser email(s) given to every imported tournament (repeatable).
 *          Add more organisers and each group's scorer email in the app afterwards.
 *
 * PINs are dropped. Tournaments whose code already exists in SQLite are skipped,
 * so it is safe to run again.
 */
import { readFileSync } from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { openDb } from '../db';
import { getTournamentRow, importTournament } from '../store';
import type { TournamentBackup } from '../../src/lib/backupFormat';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
function args(name: string): string[] {
  return process.argv.flatMap((a, i) => (a === `--${name}` ? [process.argv[i + 1]] : []));
}

const envPath = arg('env', '.env.local')!;
const dbPath = arg('db', process.env.DB_PATH ?? './data/azgb.db')!;
const owners = args('owner');
const dryRun = process.argv.includes('--dry-run');

if (owners.length === 0) {
  console.error('Give at least one --owner email: the organiser who will sign in to manage the imported tournaments.');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);

const fs = getFirestore(initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}));
console.log(`Reading Firestore project ${env.VITE_FIREBASE_PROJECT_ID}…`);

type Data = Record<string, unknown>;
const list = async (...path: string[]) => {
  const [first, ...rest] = path;
  return (await getDocs(collection(fs, first, ...rest))).docs.map((d) => ({ id: d.id, data: d.data() as Data }));
};

const db = openDb(dbPath);
const tournaments = await list('tournaments');
let imported = 0;

for (const t of tournaments) {
  if (getTournamentRow(db, t.id)) {
    console.log(`- ${t.id} "${String(t.data.name)}": already in SQLite, skipped`);
    continue;
  }
  const [rounds, groups, golfers, courses] = await Promise.all([
    list('tournaments', t.id, 'rounds'),
    list('tournaments', t.id, 'groups'),
    list('tournaments', t.id, 'golfers'),
    list('tournaments', t.id, 'courses'),
  ]);
  const roundsWithScores = await Promise.all(rounds.map(async (r) => ({
    ...r,
    scores: await list('tournaments', t.id, 'rounds', r.id, 'scores'),
  })));
  const backup: TournamentBackup = {
    version: 1,
    exportedAt: Date.now(),
    tournamentId: t.id,
    tournament: t.data,
    rounds: roundsWithScores,
    groups,
    golfers,
    courses,
  };
  const scoreDocs = roundsWithScores.reduce((n, r) => n + r.scores.length, 0);
  console.log(`- ${t.id} "${String(t.data.name)}": ${rounds.length} rounds, ${groups.length} groups, ${golfers.length} golfers, ${courses.length} courses, ${scoreDocs} score docs${t.data.archivedAt ? ' (archived)' : ''}`);
  if (!dryRun) importTournament(db, backup, t.id, owners);
  imported++;
}

db.close();
console.log(`${dryRun ? 'Would import' : 'Imported'} ${imported} of ${tournaments.length} tournaments into ${dbPath}. Organisers: ${owners.join(', ')}.`);
process.exit(0);
