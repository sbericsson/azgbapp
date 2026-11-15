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

export interface IssuedLogin {
  token: string;
  code: string;
}

/**
 * Create a sign-in link token plus a 6-digit code for the same email. The
 * code lets someone finish signing in inside the iPhone home-screen app when
 * the link opened in Safari. Both stay usable until they expire.
 */
export function issueLogin(db: DB, email: string, ttlMs: number, tournamentId: string | null, now = Date.now()): IssuedLogin {
  const token = randomBytes(32).toString('base64url');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare(
    `INSERT INTO login_tokens (token_hash, code_hash, email, tournament_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sha256(token), sha256(`${email}:${code}`), email, tournamentId, now, now + ttlMs);
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(now);
  return { token, code };
}

export interface VerifiedLogin {
  email: string;
  tournamentId: string | null;
}

export function verifyToken(db: DB, token: string, now = Date.now()): VerifiedLogin | null {
  if (!token || token.length > 100) return null;
  const row = db
    .prepare('SELECT email, tournament_id FROM login_tokens WHERE token_hash = ? AND expires_at >= ?')
    .get(sha256(token), now) as { email: string; tournament_id: string | null } | undefined;
  return row ? { email: row.email, tournamentId: row.tournament_id } : null;
}

export function verifyCode(db: DB, email: string, code: string, now = Date.now()): VerifiedLogin | null {
  if (!/^\d{6}$/.test(code)) return null;
  const rows = db
    .prepare(
      `SELECT token_hash, code_hash, tournament_id, failed_codes FROM login_tokens
       WHERE email = ? AND expires_at >= ? ORDER BY created_at DESC`,
    )
    .all(email, now) as { token_hash: string; code_hash: string; tournament_id: string | null; failed_codes: number }[];
  const live = rows.filter((r) => r.failed_codes < MAX_FAILED_CODES);
  const wanted = sha256(`${email}:${code}`);
  const match = live.find((r) => safeEqual(r.code_hash, wanted));
  if (match) return { email, tournamentId: match.tournament_id };
  // A wrong guess counts against every outstanding code for this email
  db.prepare('UPDATE login_tokens SET failed_codes = failed_codes + 1 WHERE email = ? AND expires_at >= ?').run(email, now);
  return null;
}

export function createSession(db: DB, email: string, now = Date.now()): string {
  const sid = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (sid_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(sid), email, now, now + SESSION_TTL_MS);
  return sid;
}

/** The session's email, extending its expiry when it is more than a day old. */
export function sessionEmail(db: DB, sid: string | undefined, now = Date.now()): string | null {
  if (!sid || sid.length > 100) return null;
  const hash = sha256(sid);
  const row = db.prepare('SELECT email, expires_at FROM sessions WHERE sid_hash = ?').get(hash) as
    { email: string; expires_at: number } | undefined;
  if (!row || row.expires_at < now) return null;
  if (row.expires_at - now < SESSION_TTL_MS - 24 * 60 * 60 * 1000) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE sid_hash = ?').run(now + SESSION_TTL_MS, hash);
  }
  return row.email;
}

export function deleteSession(db: DB, sid: string | undefined): void {
  if (sid) db.prepare('DELETE FROM sessions WHERE sid_hash = ?').run(sha256(sid));
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
