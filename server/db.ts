import Database from 'better-sqlite3';

export type DB = Database.Database;

/**
 * SQLite schema. Tournament content keeps the shapes the client already uses
 * (stored as JSON), while anything private lives in its own columns or tables
 * so it is never part of a public response: organiser emails, scorer emails,
 * sign-in tokens and sessions.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tournaments (
  id          TEXT PRIMARY KEY,
  data        TEXT NOT NULL,          -- { name, logoUrl?, selfService? }
  created_at  INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS tournament_admins (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  PRIMARY KEY (tournament_id, email)
);
CREATE INDEX IF NOT EXISTS tournament_admins_email ON tournament_admins(email);

-- rounds, groups, golfers, courses
CREATE TABLE IF NOT EXISTS docs (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  coll          TEXT NOT NULL,
  id            TEXT NOT NULL,
  round_id      TEXT,                 -- groups only
  scorer_email  TEXT,                 -- groups only; never sent to the public
  data          TEXT NOT NULL,
  PRIMARY KEY (tournament_id, coll, id)
);
CREATE INDEX IF NOT EXISTS docs_round ON docs(tournament_id, coll, round_id);
CREATE INDEX IF NOT EXISTS docs_scorer ON docs(scorer_email);

-- One row per hole, so writes from different devices never overwrite each other
CREATE TABLE IF NOT EXISTS scores (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_id      TEXT NOT NULL,
  group_id      TEXT NOT NULL,
  hole_index    INTEGER NOT NULL,
  data          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, round_id, group_id, hole_index)
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash    TEXT PRIMARY KEY,
  code_hash     TEXT NOT NULL,
  email         TEXT NOT NULL,
  tournament_id TEXT,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  failed_codes  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS login_tokens_email ON login_tokens(email);

CREATE TABLE IF NOT EXISTS sessions (
  sid_hash   TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}
