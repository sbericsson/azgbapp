import type { DB } from './db';
import { normalizeEmail } from './auth';
import type { TournamentBackup } from '../src/lib/backupFormat';

/**
 * Data access shared by the API and the import script. Everything here trusts
 * its caller: access checks happen in app.ts.
 */

export type Json = Record<string, unknown>;
export const COLLECTIONS = ['rounds', 'groups', 'golfers', 'courses'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isCollection(value: string): value is Collection {
  return (COLLECTIONS as readonly string[]).includes(value);
}

function parse(data: string): Json {
  return JSON.parse(data) as Json;
}

// ── Tournaments ────────────────────────────────────────────────────────────────

export interface TournamentRow {
  id: string;
  data: string;
  created_at: number;
  archived_at: number | null;
}

export function tournamentJson(row: TournamentRow): Json {
  const out: Json = { ...parse(row.data), id: row.id, createdAt: row.created_at };
  if (row.archived_at) out.archivedAt = row.archived_at;
  return out;
}

export function getTournamentRow(db: DB, id: string): TournamentRow | undefined {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as TournamentRow | undefined;
}

export function listTournamentRows(db: DB): TournamentRow[] {
  return db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all() as TournamentRow[];
}

/** Only these tournament fields can be set by clients. */
export function cleanTournamentData(input: Json, base: Json = {}): Json {
  const out: Json = { ...base };
  if ('name' in input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100) throw new Error('Invalid name');
    out.name = input.name.trim();
  }
  if ('logoUrl' in input) {
    if (input.logoUrl === null || input.logoUrl === '') delete out.logoUrl;
    else if (typeof input.logoUrl === 'string' && input.logoUrl.length <= 400_000) out.logoUrl = input.logoUrl;
    else throw new Error('Invalid logo');
  }
  if ('selfService' in input) out.selfService = input.selfService === true;
  return out;
}

export function createTournament(db: DB, id: string, data: Json, admins: string[], createdAt = Date.now()): void {
  db.transaction(() => {
    db.prepare('INSERT INTO tournaments (id, data, created_at) VALUES (?, ?, ?)').run(id, JSON.stringify(data), createdAt);
    setAdmins(db, id, admins);
  })();
}

export function updateTournamentData(db: DB, id: string, data: Json): void {
  db.prepare('UPDATE tournaments SET data = ? WHERE id = ?').run(JSON.stringify(data), id);
}

export function setArchived(db: DB, id: string, archived: boolean): void {
  db.prepare('UPDATE tournaments SET archived_at = ? WHERE id = ?').run(archived ? Date.now() : null, id);
}

export function deleteTournament(db: DB, id: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM scores WHERE tournament_id = ?').run(id);
    db.prepare('DELETE FROM docs WHERE tournament_id = ?').run(id);
    db.prepare('DELETE FROM tournament_admins WHERE tournament_id = ?').run(id);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  })();
}

export function getAdmins(db: DB, tournamentId: string): string[] {
  return (db.prepare('SELECT email FROM tournament_admins WHERE tournament_id = ? ORDER BY email').all(tournamentId) as
    { email: string }[]).map((r) => r.email);
}

export function setAdmins(db: DB, tournamentId: string, emails: string[]): void {
  const clean = [...new Set(emails.map(normalizeEmail).filter((e): e is string => !!e))];
  db.transaction(() => {
    db.prepare('DELETE FROM tournament_admins WHERE tournament_id = ?').run(tournamentId);
    const insert = db.prepare('INSERT INTO tournament_admins (tournament_id, email) VALUES (?, ?)');
    for (const e of clean) insert.run(tournamentId, e);
  })();
}

export function isAdminOf(db: DB, email: string, tournamentId: string): boolean {
  return !!db.prepare('SELECT 1 FROM tournament_admins WHERE tournament_id = ? AND email = ?').get(tournamentId, email);
}

// ── Docs (rounds, groups, golfers, courses) ────────────────────────────────────

interface DocRow {
  id: string;
  round_id: string | null;
  scorer_email: string | null;
  data: string;
}

export function docJson(row: DocRow, withPrivate: boolean): Json {
  const out: Json = { ...parse(row.data), id: row.id };
  if (withPrivate && row.scorer_email) out.scorerEmail = row.scorer_email;
  return out;
}

export function listDocs(db: DB, tournamentId: string, coll: Collection, roundId?: string): DocRow[] {
  return roundId
    ? db.prepare('SELECT id, round_id, scorer_email, data FROM docs WHERE tournament_id = ? AND coll = ? AND round_id = ?')
      .all(tournamentId, coll, roundId) as DocRow[]
    : db.prepare('SELECT id, round_id, scorer_email, data FROM docs WHERE tournament_id = ? AND coll = ?')
      .all(tournamentId, coll) as DocRow[];
}

export function getDoc(db: DB, tournamentId: string, coll: Collection, id: string): DocRow | undefined {
  return db.prepare('SELECT id, round_id, scorer_email, data FROM docs WHERE tournament_id = ? AND coll = ? AND id = ?')
    .get(tournamentId, coll, id) as DocRow | undefined;
}

/**
 * Split client data into what is stored as the public document and the
 * private columns. Drops legacy PINs and the id.
 */
function splitDoc(coll: Collection, input: Json): { data: Json; roundId: string | null; scorerEmail: string | null } {
  const data: Json = { ...input };
  delete data.id;
  delete data.pin;
  delete data.adminPin;
  let scorerEmail: string | null = null;
  if (coll === 'groups') {
    if (data.scorerEmail !== undefined && data.scorerEmail !== null && data.scorerEmail !== '') {
      scorerEmail = normalizeEmail(data.scorerEmail);
      if (!scorerEmail) throw new Error('Invalid scorer email');
    }
    delete data.scorerEmail;
  }
  const roundId = coll === 'groups' && typeof data.roundId === 'string' ? data.roundId : null;
  return { data, roundId, scorerEmail };
}

export function putDoc(db: DB, tournamentId: string, coll: Collection, id: string, input: Json): void {
  const { data, roundId, scorerEmail } = splitDoc(coll, input);
  db.prepare(
    `INSERT INTO docs (tournament_id, coll, id, round_id, scorer_email, data) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tournament_id, coll, id) DO UPDATE SET round_id = excluded.round_id,
       scorer_email = excluded.scorer_email, data = excluded.data`,
  ).run(tournamentId, coll, id, roundId, scorerEmail, JSON.stringify(data));
}

/** Merge top-level fields; a null value removes the field. */
export function patchDoc(db: DB, tournamentId: string, coll: Collection, row: DocRow, patch: Json): void {
  const current: Json = { ...parse(row.data) };
  if (row.scorer_email) current.scorerEmail = row.scorer_email;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete current[k];
    else current[k] = v;
  }
  putDoc(db, tournamentId, coll, row.id, current);
}

export function deleteDocCascade(db: DB, tournamentId: string, coll: Collection, id: string): void {
  db.transaction(() => {
    if (coll === 'rounds') {
      db.prepare('DELETE FROM scores WHERE tournament_id = ? AND round_id = ?').run(tournamentId, id);
      db.prepare(`DELETE FROM docs WHERE tournament_id = ? AND coll = 'groups' AND round_id = ?`).run(tournamentId, id);
    }
    if (coll === 'groups') {
      db.prepare('DELETE FROM scores WHERE tournament_id = ? AND group_id = ?').run(tournamentId, id);
    }
    db.prepare('DELETE FROM docs WHERE tournament_id = ? AND coll = ? AND id = ?').run(tournamentId, coll, id);
  })();
}

/** Groups this email keeps score for, across all tournaments. */
export function scorerGroups(db: DB, email: string): { tournamentId: string; id: string; roundId: string | null; name: string }[] {
  const rows = db.prepare(`SELECT tournament_id, id, round_id, data FROM docs WHERE coll = 'groups' AND scorer_email = ?`)
    .all(email) as { tournament_id: string; id: string; round_id: string | null; data: string }[];
  return rows.map((r) => ({
    tournamentId: r.tournament_id,
    id: r.id,
    roundId: r.round_id,
    name: String(parse(r.data).name ?? ''),
  }));
}

export function isScorerOf(db: DB, email: string, tournamentId: string, groupId: string): boolean {
  return !!db.prepare(`SELECT 1 FROM docs WHERE tournament_id = ? AND coll = 'groups' AND id = ? AND scorer_email = ?`)
    .get(tournamentId, groupId, email);
}

export function isKnownEmail(db: DB, email: string): boolean {
  return !!db.prepare('SELECT 1 FROM tournament_admins WHERE email = ? LIMIT 1').get(email)
    || !!db.prepare(`SELECT 1 FROM docs WHERE coll = 'groups' AND scorer_email = ? LIMIT 1`).get(email);
}

// ── Scores ─────────────────────────────────────────────────────────────────────

export interface ScoreDocJson {
  groupId: string;
  updatedAt: number;
  holeMap: Record<string, Json>;
}

export function getScores(db: DB, tournamentId: string, roundId: string, groupId?: string): ScoreDocJson[] {
  const rows = (groupId
    ? db.prepare('SELECT group_id, hole_index, data, updated_at FROM scores WHERE tournament_id = ? AND round_id = ? AND group_id = ?')
      .all(tournamentId, roundId, groupId)
    : db.prepare('SELECT group_id, hole_index, data, updated_at FROM scores WHERE tournament_id = ? AND round_id = ?')
      .all(tournamentId, roundId)) as { group_id: string; hole_index: number; data: string; updated_at: number }[];
  const byGroup = new Map<string, ScoreDocJson>();
  for (const r of rows) {
    let entry = byGroup.get(r.group_id);
    if (!entry) {
      entry = { groupId: r.group_id, updatedAt: 0, holeMap: {} };
      byGroup.set(r.group_id, entry);
    }
    entry.holeMap[String(r.hole_index)] = parse(r.data);
    entry.updatedAt = Math.max(entry.updatedAt, r.updated_at);
  }
  return [...byGroup.values()];
}

export const MAX_HOLES = 36;

/** Validate a client holeMap: integer keys within range, object values with a boolean `locked`. */
export function cleanHoleMap(input: unknown): Map<number, Json> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('holeMap must be an object');
  const out = new Map<number, Json>();
  for (const [key, value] of Object.entries(input as Json)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= MAX_HOLES) throw new Error(`Bad hole index ${key}`);
    if (typeof value !== 'object' || value === null || typeof (value as Json).locked !== 'boolean') {
      throw new Error(`Bad hole ${key}`);
    }
    out.set(i, value as Json);
  }
  if (out.size === 0) throw new Error('No holes');
  return out;
}

export function putHoles(db: DB, tournamentId: string, roundId: string, groupId: string, holes: Map<number, Json>, now = Date.now()): void {
  const stmt = db.prepare(
    `INSERT INTO scores (tournament_id, round_id, group_id, hole_index, data, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tournament_id, round_id, group_id, hole_index) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const [i, hole] of holes) stmt.run(tournamentId, roundId, groupId, i, JSON.stringify(hole), now);
  })();
}

export function clearScores(db: DB, tournamentId: string, roundId: string): void {
  db.prepare('DELETE FROM scores WHERE tournament_id = ? AND round_id = ?').run(tournamentId, roundId);
}

// ── Backup ─────────────────────────────────────────────────────────────────────

export function exportTournament(db: DB, tournamentId: string): TournamentBackup & { admins: string[] } {
  const row = getTournamentRow(db, tournamentId);
  if (!row) throw new Error('Tournament not found');
  const docs = (coll: Collection) => listDocs(db, tournamentId, coll).map((d) => {
    const { id, ...data } = docJson(d, true);
    return { id: String(id), data };
  });
  return {
    version: 1,
    exportedAt: Date.now(),
    tournamentId,
    tournament: { ...parse(row.data), createdAt: row.created_at },
    admins: getAdmins(db, tournamentId),
    rounds: docs('rounds').map((r) => ({
      ...r,
      scores: getScores(db, tournamentId, r.id).map((s) => ({
        id: s.groupId,
        data: { groupId: s.groupId, updatedAt: s.updatedAt, holeMap: s.holeMap },
      })),
    })),
    groups: docs('groups'),
    golfers: docs('golfers'),
    courses: docs('courses'),
  };
}

/**
 * Write a backup (or a Firestore export in the same shape) as a new
 * tournament. Score docs may hold a legacy `holes` array, a `holeMap`, or
 * both; holeMap entries win. PINs are dropped.
 */
export function importTournament(db: DB, backup: TournamentBackup & { admins?: string[] }, targetId: string, extraAdmins: string[] = []): void {
  if (!ID_RE.test(targetId)) throw new Error('Invalid tournament code');
  if (getTournamentRow(db, targetId)) throw new Error(`Tournament code "${targetId}" is already in use`);
  const t = backup.tournament as Json;
  const data = cleanTournamentData({ name: t.name ?? targetId, logoUrl: t.logoUrl ?? null, selfService: t.selfService ?? false });
  const createdAt = typeof t.createdAt === 'number' ? t.createdAt : Date.now();
  db.transaction(() => {
    createTournament(db, targetId, data, [...(backup.admins ?? []), ...extraAdmins], createdAt);
    if (typeof t.archivedAt === 'number') setArchived(db, targetId, true);
    for (const coll of COLLECTIONS) {
      for (const d of backup[coll]) {
        if (!ID_RE.test(d.id)) throw new Error(`Invalid id in ${coll}: ${d.id}`);
        putDoc(db, targetId, coll, d.id, d.data);
      }
    }
    for (const r of backup.rounds) {
      for (const s of r.scores) {
        const holes = new Map<number, Json>();
        const legacy = (s.data as Json).holes;
        if (Array.isArray(legacy)) legacy.forEach((h, i) => { if (h && typeof h === 'object') holes.set(i, h as Json); });
        const map = (s.data as Json).holeMap;
        if (map && typeof map === 'object') {
          for (const [k, h] of Object.entries(map as Json)) {
            const i = Number(k);
            if (Number.isInteger(i) && i >= 0 && h && typeof h === 'object') holes.set(i, h as Json);
          }
        }
        const updatedAt = typeof (s.data as Json).updatedAt === 'number' ? (s.data as Json).updatedAt as number : Date.now();
        if (holes.size > 0) putHoles(db, targetId, r.id, s.id, holes, updatedAt);
      }
    }
  })();
}
