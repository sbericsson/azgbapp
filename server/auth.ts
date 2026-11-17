import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { DB } from './db';

export const SESSION_COOKIE = 'azgb_sid';
/** Sessions last this long after the last request (sliding). */
export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;
/** A link the person asked for themselves. */
export const SELF_LINK_TTL_MS = 2 * 60 * 60 * 1000;
/** A link an organiser sends to a scorer ahead of the event. */
export const INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Wrong codes allowed per email before its outstanding links stop accepting codes. */
export const MAX_FAILED_CODES = 5;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** A link shared by an organiser (text, copy, email): long enough to share ahead of the event. */
export const SHARE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** What a sign-in link grants: an identity (email), one group's scoring, or both. */
export interface LoginTarget {
  email: string | null;
  tournamentId: string | null;
  groupId: string | null;
}

export interface IssuedLogin {
  token: string;
  /** 6 digits for emailed links (used with the email); XXXX-XXXX for shared links (used alone) */
  code: string;
  expiresAt: number;
}

const SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function insertToken(db: DB, tokenHash: string, codeHash: string, target: LoginTarget, ttlMs: number, now: number) {
  db.prepare(
    `INSERT INTO login_tokens (token_hash, code_hash, email, tournament_id, group_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(tokenHash, codeHash, target.email, target.tournamentId, target.groupId, now, now + ttlMs);
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(now);
}

/**
 * A link emailed to someone who asked for it, with a 6-digit code that is
 * checked together with the email. The code lets someone finish signing in
 * inside the iPhone home-screen app when the link opened in Safari.
 */
export function issueEmailLogin(db: DB, email: string, ttlMs: number, tournamentId: string | null, now = Date.now()): IssuedLogin {
  const token = randomBytes(32).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  insertToken(db, sha256(token), sha256(`${email}:${code}`), { email, tournamentId, groupId: null }, ttlMs, now);
  return { token, code, expiresAt: now + ttlMs };
}

/** Upper-case, without spaces or dashes: how shared codes are compared. */
export function normalizeShareCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '');
}

/**
 * A link an organiser copies and texts or emails themselves. Its code is 8
 * characters from a 32-letter alphabet (about 10^12 values) and works without
 * an email, so a scorer with no email can type it into the home-screen app.
 */
export function issueSharedLogin(db: DB, target: LoginTarget, ttlMs = SHARE_LINK_TTL_MS, now = Date.now()): IssuedLogin {
  const token = randomBytes(32).toString('base64url');
  const raw = Array.from({ length: 8 }, () => SHARE_ALPHABET[randomInt(SHARE_ALPHABET.length)]).join('');
  insertToken(db, sha256(token), sha256(`share:${raw}`), target, ttlMs, now);
  return { token, code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt: now + ttlMs };
}

interface TokenRow { email: string | null; tournament_id: string | null; group_id: string | null }
const toTarget = (r: TokenRow): LoginTarget => ({ email: r.email, tournamentId: r.tournament_id, groupId: r.group_id });

export function verifyToken(db: DB, token: string, now = Date.now()): LoginTarget | null {
  if (!token || token.length > 100) return null;
  const row = db
    .prepare('SELECT email, tournament_id, group_id FROM login_tokens WHERE token_hash = ? AND expires_at >= ?')
    .get(sha256(token), now) as TokenRow | undefined;
  return row ? toTarget(row) : null;
}

/** Email + 6-digit code from an emailed link. */
export function verifyCode(db: DB, email: string, code: string, now = Date.now()): LoginTarget | null {
  if (!/^\d{6}$/.test(code)) return null;
  const rows = db
    .prepare(
      `SELECT code_hash, email, tournament_id, group_id, failed_codes FROM login_tokens
       WHERE email = ? AND expires_at >= ? ORDER BY created_at DESC`,
    )
    .all(email, now) as (TokenRow & { code_hash: string; failed_codes: number })[];
  const live = rows.filter((r) => r.failed_codes < MAX_FAILED_CODES);
  const wanted = sha256(`${email}:${code}`);
  const match = live.find((r) => safeEqual(r.code_hash, wanted));
  if (match) return toTarget(match);
  // A wrong guess counts against every outstanding code for this email
  db.prepare('UPDATE login_tokens SET failed_codes = failed_codes + 1 WHERE email = ? AND expires_at >= ?').run(email, now);
  return null;
}

/** XXXX-XXXX code from a shared link, on its own. */
export function verifySharedCode(db: DB, code: string, now = Date.now()): LoginTarget | null {
  const raw = normalizeShareCode(code);
  if (!/^[A-Z2-9]{8}$/.test(raw)) return null;
  const row = db
    .prepare('SELECT email, tournament_id, group_id FROM login_tokens WHERE code_hash = ? AND expires_at >= ?')
    .get(sha256(`share:${raw}`), now) as TokenRow | undefined;
  return row ? toTarget(row) : null;
}

// ── Sessions ───────────────────────────────────────────────────────────────────

export interface Grant {
  tournamentId: string;
  groupId: string;
}

export interface SessionInfo {
  hash: string;
  email: string | null;
  grants: Grant[];
}

export function createSession(db: DB, email: string | null, now = Date.now()): string {
  const sid = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (sid_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(sid), email, now, now + SESSION_TTL_MS);
  return sid;
}

/** The session behind a cookie, extending its expiry when it is more than a day old. */
export function sessionInfo(db: DB, sid: string | undefined, now = Date.now()): SessionInfo | null {
  if (!sid || sid.length > 100) return null;
  const hash = sha256(sid);
  const row = db.prepare('SELECT email, expires_at FROM sessions WHERE sid_hash = ?').get(hash) as
    { email: string | null; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  if (row.expires_at - now < SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE sid_hash = ?').run(now + SESSION_TTL_MS, hash);
  }
  const grants = (db.prepare('SELECT tournament_id, group_id FROM session_grants WHERE sid_hash = ?').all(hash) as
    { tournament_id: string; group_id: string }[]).map((g) => ({ tournamentId: g.tournament_id, groupId: g.group_id }));
  return { hash, email: row.email, grants };
}

export function setSessionEmail(db: DB, hash: string, email: string): void {
  db.prepare('UPDATE sessions SET email = ? WHERE sid_hash = ?').run(email, hash);
}

export function addGrant(db: DB, hash: string, tournamentId: string, groupId: string): void {
  db.prepare('INSERT OR IGNORE INTO session_grants (sid_hash, tournament_id, group_id) VALUES (?, ?, ?)')
    .run(hash, tournamentId, groupId);
}

export function copyGrants(db: DB, fromHash: string, toHash: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO session_grants (sid_hash, tournament_id, group_id)
     SELECT ?, tournament_id, group_id FROM session_grants WHERE sid_hash = ?`,
  ).run(toHash, fromHash);
}

/** Sign out every phone signed in through this group's shared links, and void the links. */
export function revokeGroupAccess(db: DB, tournamentId: string, groupId: string): void {
  db.transaction(() => {
    db.prepare('DELETE FROM session_grants WHERE tournament_id = ? AND group_id = ?').run(tournamentId, groupId);
    db.prepare('DELETE FROM login_tokens WHERE tournament_id = ? AND group_id = ?').run(tournamentId, groupId);
  })();
}

export function deleteSession(db: DB, sid: string | undefined): void {
  if (!sid) return;
  const hash = sha256(sid);
  db.prepare('DELETE FROM session_grants WHERE sid_hash = ?').run(hash);
  db.prepare('DELETE FROM sessions WHERE sid_hash = ?').run(hash);
}

// ── Email ──────────────────────────────────────────────────────────────────────

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type Mailer = (mail: Mail) => Promise<void>;

/** Fixed-window rate limiter kept in memory (one server process). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private limit: number, private windowMs: number) {}

  allow(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  private prune(now: number) {
    for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function signInMail(opts: {
  to: string;
  link: string;
  code: string;
  tournamentName?: string;
  groupName?: string;
  invitedBy?: string;
  expiresIn: string;
}): Mail {
  const what = opts.groupName && opts.tournamentName
    ? `keep score for ${opts.groupName} at ${opts.tournamentName}`
    : opts.tournamentName
      ? `open ${opts.tournamentName}`
      : 'sign in to Golf Bender';
  const subject = opts.tournamentName ? `Your Golf Bender sign-in for ${opts.tournamentName}` : 'Your Golf Bender sign-in link';
  const text = [
    opts.invitedBy ? `${opts.invitedBy} invited you to ${what}.` : `Use this link to ${what}:`,
    '',
    opts.link,
    '',
    `Or enter this code in the app: ${opts.code}`,
    '',
    `The link and code work for ${opts.expiresIn}. Open the link on the phone you will score with.`,
    "If you didn't expect this email, you can ignore it.",
  ].join('\n');
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#111">
<p>${escapeHtml(opts.invitedBy ? `${opts.invitedBy} invited you to ${what}.` : `Use this link to ${what}.`)}</p>
<p><a href="${escapeHtml(opts.link)}" style="display:inline-block;background:#16a34a;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:bold">Sign in</a></p>
<p>Or enter this code in the app: <strong style="font-size:20px;letter-spacing:3px">${opts.code}</strong></p>
<p style="color:#555;font-size:13px">The link and code work for ${escapeHtml(opts.expiresIn)}. Open the link on the phone you will score with. If you didn't expect this email, you can ignore it.</p>
</body></html>`;
  return { to: opts.to, subject, text, html };
}
