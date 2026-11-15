import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { randomInt } from 'node:crypto';
import type { DB } from './db';
import {
  SESSION_COOKIE, SESSION_TTL_MS, SELF_LINK_TTL_MS, INVITE_LINK_TTL_MS,
  normalizeEmail, issueLogin, verifyToken, verifyCode, createSession, sessionEmail, deleteSession,
  RateLimiter, signInMail, type Mailer,
} from './auth';
import { ChangeFeed } from './events';
import {
  ID_RE, isCollection, type Collection, type Json,
  getTournamentRow, listTournamentRows, tournamentJson, cleanTournamentData, createTournament,
  updateTournamentData, setArchived, deleteTournament, getAdmins, setAdmins, isAdminOf,
  listDocs, getDoc, docJson, putDoc, patchDoc, deleteDocCascade, scorerGroups, isScorerOf, isKnownEmail,
  getScores, cleanHoleMap, putHoles, clearScores, exportTournament, importTournament,
} from './store';
import { parseBackup } from '../src/lib/backupFormat';

export interface AppConfig {
  /** Public origin used in emailed links, e.g. https://golf.example.com */
  appUrl: string;
  /** Emails that may administer every tournament. */
  appAdminEmails: Set<string>;
  /** Anyone with a verified email may create a tournament at /create. */
  allowSelfService: boolean;
  /** Send the session cookie only over HTTPS. */
  secureCookies: boolean;
}

interface Viewer {
  email: string | null;
  appAdmin: boolean;
}

type Env = { Variables: { viewer: Viewer } };

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newTournamentCode(db: DB): string {
  for (;;) {
    const code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    if (!getTournamentRow(db, code)) return code;
  }
}

async function readJson(c: Context): Promise<Json> {
  try {
    const body = await c.req.json();
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error();
    return body as Json;
  } catch {
    throw new HttpError(400, 'Expected a JSON object');
  }
}

class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 429, message: string) {
    super(message);
  }
}

export function createApp(db: DB, mailer: Mailer, config: AppConfig, feed = new ChangeFeed()) {
  const app = new Hono<Env>().basePath('/api');

  const requestLimiter = new RateLimiter(5, 60 * 60 * 1000); // links per email per hour
  const ipLimiter = new RateLimiter(30, 60 * 60 * 1000); // link requests per IP per hour
  const codeLimiter = new RateLimiter(20, 15 * 60 * 1000); // code attempts per IP per 15 min
  const inviteLimiter = new RateLimiter(300, 60 * 60 * 1000); // invites per tournament per hour

  const clientIp = (c: Context) => c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isAppAdmin = (email: string | null) => !!email && config.appAdminEmails.has(email);

  function viewerOf(c: Context<Env>): Viewer {
    return c.get('viewer');
  }

  function requireSignedIn(c: Context<Env>): string {
    const { email } = viewerOf(c);
    if (!email) throw new HttpError(401, 'Sign in first');
    return email;
  }

  function tournamentOr404(id: string) {
    if (!ID_RE.test(id)) throw new HttpError(404, 'Tournament not found');
    const row = getTournamentRow(db, id);
    if (!row) throw new HttpError(404, 'Tournament not found');
    return row;
  }

  function canAdmin(v: Viewer, tournamentId: string): boolean {
    return !!v.email && (v.appAdmin || isAdminOf(db, v.email, tournamentId));
  }

  function requireAdmin(c: Context<Env>, tournamentId: string): string {
    const email = requireSignedIn(c);
    if (!canAdmin(viewerOf(c), tournamentId)) throw new HttpError(403, 'Organisers only');
    return email;
  }

  function requireAppAdmin(c: Context<Env>): string {
    const email = requireSignedIn(c);
    if (!viewerOf(c).appAdmin) throw new HttpError(403, 'App admins only');
    return email;
  }

  function collOr404(name: string): Collection {
    if (!isCollection(name)) throw new HttpError(404, 'Not found');
    return name;
  }

  function idOr400(id: string): string {
    if (!ID_RE.test(id)) throw new HttpError(400, 'Invalid id');
    return id;
  }

  async function sendLogin(email: string, ttlMs: number, tournamentId: string | null, extra: { tournamentName?: string; groupName?: string; invitedBy?: string }) {
    const { token, code } = issueLogin(db, email, ttlMs, tournamentId);
    const link = `${config.appUrl.replace(/\/$/, '')}/signin?token=${encodeURIComponent(token)}`;
    await mailer(signInMail({
      to: email,
      link,
      code,
      expiresIn: ttlMs >= 24 * 60 * 60 * 1000 ? `${Math.round(ttlMs / 86_400_000)} days` : `${Math.round(ttlMs / 3_600_000)} hours`,
      ...extra,
    }));
  }

  function me(email: string | null) {
    if (!email) return { email: null, appAdmin: false, admin: [], groups: [] };
    const adminOf = (db.prepare('SELECT tournament_id FROM tournament_admins WHERE email = ?').all(email) as { tournament_id: string }[])
      .map((r) => r.tournament_id);
    return { email, appAdmin: isAppAdmin(email), admin: adminOf, groups: scorerGroups(db, email) };
  }

  function signIn(c: Context<Env>, email: string) {
    const sid = createSession(db, email);
    setCookie(c, SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }

  // ── Middleware ─────────────────────────────────────────────────────────────

  app.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }));

  app.use('*', async (c, next) => {
    const email = sessionEmail(db, getCookie(c, SESSION_COOKIE));
    c.set('viewer', { email, appAdmin: isAppAdmin(email) });
    // Reject cross-site writes: browsers send Origin on POST/PUT/PATCH/DELETE
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      if (origin && origin !== new URL(config.appUrl).origin && origin !== new URL(c.req.url).origin) {
        return c.json({ error: 'Cross-site request refused' }, 403);
      }
    }
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
    if (err instanceof Error && /^(Invalid|Bad|No holes|holeMap|Not a valid backup|Tournament code)/.test(err.message)) {
      return c.json({ error: err.message }, 400);
    }
    console.error(err);
    return c.json({ error: 'Server error' }, 500);
  });

  // ── Auth ───────────────────────────────────────────────────────────────────

  app.get('/auth/me', (c) => c.json(me(viewerOf(c).email)));

  /** For nginx auth_request: 204 when signed in (guards the API proxies, R15). */
  app.get('/auth/check', (c) => (viewerOf(c).email ? c.body(null, 204) : c.body(null, 401)));

  app.post('/auth/request', async (c) => {
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    if (!email) throw new HttpError(400, 'Enter a valid email address');
    const purpose = body.purpose === 'create' ? 'create' : 'signin';
    if (!ipLimiter.allow(clientIp(c)) || !requestLimiter.allow(email)) {
      throw new HttpError(429, 'Too many sign-in emails. Wait a while and try again.');
    }
    const allowed = isAppAdmin(email) || isKnownEmail(db, email) || (purpose === 'create' && config.allowSelfService);
    // Same answer either way, so the form does not reveal who is registered
    if (allowed) {
      const tournamentId = typeof body.tournamentId === 'string' && ID_RE.test(body.tournamentId) ? body.tournamentId : null;
      await sendLogin(email, SELF_LINK_TTL_MS, tournamentId, {});
    }
    return c.json({ ok: true });
  });

  app.post('/auth/verify', async (c) => {
    const body = await readJson(c);
    let result = null;
    if (typeof body.token === 'string') {
      result = verifyToken(db, body.token);
    } else {
      const email = normalizeEmail(body.email);
      if (!codeLimiter.allow(clientIp(c))) throw new HttpError(429, 'Too many attempts. Wait 15 minutes.');
      if (email && typeof body.code === 'string') result = verifyCode(db, email, body.code.trim());
    }
    if (!result) throw new HttpError(401, 'That link or code is invalid or has expired. Request a new one.');
    signIn(c, result.email);
    return c.json({ ...me(result.email), tournamentId: result.tournamentId });
  });

  app.post('/auth/logout', (c) => {
    deleteSession(db, getCookie(c, SESSION_COOKIE));
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // ── Tournaments ────────────────────────────────────────────────────────────

  app.get('/tournaments', (c) => {
    const v = viewerOf(c);
    const email = requireSignedIn(c);
    const rows = listTournamentRows(db).filter((r) => v.appAdmin || isAdminOf(db, email, r.id));
    return c.json(rows.map((r) => ({ ...tournamentJson(r), admins: getAdmins(db, r.id) })));
  });

  app.post('/tournaments', async (c) => {
    const email = requireSignedIn(c);
    const v = viewerOf(c);
    if (!config.allowSelfService && !v.appAdmin) throw new HttpError(403, 'Ask the app admin to create a tournament');
    const body = await readJson(c);
    const data = cleanTournamentData({ name: body.name, selfService: !v.appAdmin });
    const id = newTournamentCode(db);
    const admins = Array.isArray(body.admins) ? body.admins.map(String) : [];
    createTournament(db, id, data, v.appAdmin && admins.length > 0 ? admins : [email, ...admins]);
    return c.json(tournamentJson(getTournamentRow(db, id)!), 201);
  });

  app.get('/tournaments/:t', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const out = tournamentJson(row);
    if (canAdmin(viewerOf(c), row.id)) out.admins = getAdmins(db, row.id);
    return c.json(out);
  });

  app.patch('/tournaments/:t', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    requireAdmin(c, row.id);
    const body = await readJson(c);
    updateTournamentData(db, row.id, cleanTournamentData(body, JSON.parse(row.data)));
    feed.publish(row.id, { c: 'tournament' });
    return c.json(tournamentJson(getTournamentRow(db, row.id)!));
  });

  app.put('/tournaments/:t/admins', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const email = requireAdmin(c, row.id);
    const body = await readJson(c);
    if (!Array.isArray(body.emails)) throw new HttpError(400, 'emails must be a list');
    const emails = body.emails.map((e) => normalizeEmail(e));
    if (emails.some((e) => !e)) throw new HttpError(400, 'Invalid email in list');
    const list = emails as string[];
    // An organiser cannot remove themselves by accident and lock the event
    if (!viewerOf(c).appAdmin && !list.includes(email)) throw new HttpError(400, 'Keep yourself on the list');
    if (list.length === 0) throw new HttpError(400, 'A tournament needs at least one organiser');
    setAdmins(db, row.id, list);
    return c.json({ admins: getAdmins(db, row.id) });
  });

  app.post('/tournaments/:t/archive', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    requireAppAdmin(c);
    const body = await readJson(c);
    setArchived(db, row.id, body.archived === true);
    feed.publish(row.id, { c: 'tournament' });
    return c.json(tournamentJson(getTournamentRow(db, row.id)!));
  });

  app.delete('/tournaments/:t', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    requireAppAdmin(c);
    deleteTournament(db, row.id);
    feed.publish(row.id, { c: 'tournament' });
    return c.json({ ok: true });
  });

  app.get('/tournaments/:t/backup', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    requireAdmin(c, row.id);
    return c.json(exportTournament(db, row.id));
  });

  app.post('/import', async (c) => {
    requireAppAdmin(c);
    const body = await readJson(c);
    const backup = parseBackup(body.backup);
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : backup.tournamentId;
    if (getTournamentRow(db, targetId)) throw new HttpError(409, `Tournament code "${targetId}" is already in use`);
    importTournament(db, backup as Parameters<typeof importTournament>[1], targetId);
    return c.json({ id: targetId }, 201);
  });

  // ── Live updates ───────────────────────────────────────────────────────────

  app.get('/tournaments/:t/events', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    c.header('X-Accel-Buffering', 'no'); // nginx: stream, don't buffer
    return streamSSE(c, async (stream) => {
      const unsubscribe = feed.subscribe(row.id, (event) => {
        void stream.writeSSE({ event: 'change', data: JSON.stringify(event) });
      });
      await stream.writeSSE({ event: 'ready', data: '{}' });
      const ping = setInterval(() => { void stream.writeSSE({ event: 'ping', data: '' }); }, 25_000);
      await new Promise<void>((resolve) => stream.onAbort(resolve));
      clearInterval(ping);
      unsubscribe();
    });
  });

  // ── Rounds, groups, golfers, courses ───────────────────────────────────────

  app.get('/tournaments/:t/:coll', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const coll = collOr404(c.req.param('coll'));
    const admin = canAdmin(viewerOf(c), row.id);
    if (coll === 'golfers' && !admin) throw new HttpError(403, 'Organisers only');
    const roundId = c.req.query('roundId');
    const docs = listDocs(db, row.id, coll, coll === 'groups' && roundId ? roundId : undefined);
    return c.json(docs.map((d) => docJson(d, admin)));
  });

  app.get('/tournaments/:t/:coll/:id', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const coll = collOr404(c.req.param('coll'));
    const admin = canAdmin(viewerOf(c), row.id);
    if (coll === 'golfers' && !admin) throw new HttpError(403, 'Organisers only');
    const d = getDoc(db, row.id, coll, c.req.param('id'));
    if (!d) throw new HttpError(404, 'Not found');
    return c.json(docJson(d, admin));
  });

  app.put('/tournaments/:t/:coll/:id', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const coll = collOr404(c.req.param('coll'));
    const id = idOr400(c.req.param('id'));
    requireAdmin(c, row.id);
    const body = await readJson(c);
    if (coll === 'groups' && (typeof body.roundId !== 'string' || !getDoc(db, row.id, 'rounds', body.roundId))) {
      throw new HttpError(400, 'Group needs an existing roundId');
    }
    putDoc(db, row.id, coll, id, body);
    feed.publish(row.id, { c: coll, id, r: coll === 'groups' ? String(body.roundId) : coll === 'rounds' ? id : undefined });
    return c.json(docJson(getDoc(db, row.id, coll, id)!, true));
  });

  app.patch('/tournaments/:t/:coll/:id', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const coll = collOr404(c.req.param('coll'));
    const d = getDoc(db, row.id, coll, c.req.param('id'));
    if (!d) throw new HttpError(404, 'Not found');
    const body = await readJson(c);
    const v = viewerOf(c);
    if (!canAdmin(v, row.id)) {
      // A group's scorer may rename their group, nothing else
      const email = requireSignedIn(c);
      const onlyName = Object.keys(body).length === 1 && typeof body.name === 'string' && body.name.trim().length > 0 && body.name.length <= 60;
      if (!(coll === 'groups' && onlyName && isScorerOf(db, email, row.id, d.id))) throw new HttpError(403, 'Organisers only');
    }
    patchDoc(db, row.id, coll, d, body);
    const updated = getDoc(db, row.id, coll, d.id)!;
    feed.publish(row.id, { c: coll, id: d.id, r: updated.round_id ?? (coll === 'rounds' ? d.id : undefined) });
    return c.json(docJson(updated, canAdmin(v, row.id)));
  });

  app.delete('/tournaments/:t/:coll/:id', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const coll = collOr404(c.req.param('coll'));
    requireAdmin(c, row.id);
    const d = getDoc(db, row.id, coll, c.req.param('id'));
    if (!d) return c.json({ ok: true });
    deleteDocCascade(db, row.id, coll, d.id);
    feed.publish(row.id, { c: coll, id: d.id, r: d.round_id ?? (coll === 'rounds' ? d.id : undefined) });
    if (coll === 'rounds' || coll === 'groups') feed.publish(row.id, { c: 'scores', r: d.round_id ?? d.id });
    return c.json({ ok: true });
  });

  /** Email the group's scorer a sign-in link that works for 7 days. */
  app.post('/tournaments/:t/groups/:id/invite', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const email = requireAdmin(c, row.id);
    const d = getDoc(db, row.id, 'groups', c.req.param('id'));
    if (!d) throw new HttpError(404, 'Group not found');
    if (!d.scorer_email) throw new HttpError(400, 'Add the scorer’s email to the group first');
    if (!inviteLimiter.allow(row.id)) throw new HttpError(429, 'Too many invitations sent. Try again later.');
    const t = JSON.parse(row.data) as Json;
    const g = JSON.parse(d.data) as Json;
    await sendLogin(d.scorer_email, INVITE_LINK_TTL_MS, row.id, {
      tournamentName: String(t.name ?? row.id),
      groupName: String(g.name ?? 'your group'),
      invitedBy: email,
    });
    return c.json({ sentTo: d.scorer_email });
  });

  // ── Scores ─────────────────────────────────────────────────────────────────

  app.get('/tournaments/:t/rounds/:r/scores', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    return c.json(getScores(db, row.id, c.req.param('r')));
  });

  app.get('/tournaments/:t/rounds/:r/scores/:g', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const [doc] = getScores(db, row.id, c.req.param('r'), c.req.param('g'));
    return doc ? c.json(doc) : c.json({ error: 'No scores yet' }, 404);
  });

  app.put('/tournaments/:t/rounds/:r/scores/:g', async (c) => {
    const row = tournamentOr404(c.req.param('t'));
    const roundId = c.req.param('r');
    const groupId = c.req.param('g');
    const email = requireSignedIn(c);
    const round = getDoc(db, row.id, 'rounds', roundId);
    const group = getDoc(db, row.id, 'groups', groupId);
    if (!round || !group || group.round_id !== roundId) throw new HttpError(404, 'Round or group not found');
    if (!canAdmin(viewerOf(c), row.id)) {
      if (!isScorerOf(db, email, row.id, groupId)) throw new HttpError(403, 'Only this group’s scorer or an organiser can enter scores');
      if ((JSON.parse(round.data) as Json).status === 'complete') throw new HttpError(403, 'This round is complete. Ask the organiser to change a score.');
    }
    const body = await readJson(c);
    const holes = cleanHoleMap(body.holeMap);
    const roundHoles = Number((JSON.parse(round.data) as Json).holes ?? 18);
    for (const i of holes.keys()) if (i >= roundHoles) throw new HttpError(400, `Bad hole index ${i}`);
    putHoles(db, row.id, roundId, groupId, holes);
    feed.publish(row.id, { c: 'scores', r: roundId, id: groupId });
    return c.json(getScores(db, row.id, roundId, groupId)[0]);
  });

  app.delete('/tournaments/:t/rounds/:r/scores', (c) => {
    const row = tournamentOr404(c.req.param('t'));
    requireAdmin(c, row.id);
    clearScores(db, row.id, c.req.param('r'));
    feed.publish(row.id, { c: 'scores', r: c.req.param('r') });
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  return app;
}
