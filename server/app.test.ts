import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from './db';
import { createApp } from './app';
import type { Mail } from './auth';

/**
 * Access-control tests for the API (R13). These replace the Firestore rules
 * tests: every rule the app relies on is enforced here, on the server.
 */

const APP_URL = 'https://golf.test';
const APP_ADMIN = 'boss@example.com';

let db: DB;
let mails: Mail[];
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = openDb(':memory:');
  mails = [];
  app = createApp(db, async (m) => { mails.push(m); }, {
    appUrl: APP_URL,
    appAdminEmails: new Set([APP_ADMIN]),
    allowSelfService: true,
    secureCookies: true,
  });
});

type Session = { cookie?: string };

async function call(method: string, path: string, body?: unknown, session: Session = {}, headers: Record<string, string> = {}) {
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session.cookie ? { cookie: session.cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json: json as Record<string, unknown> & unknown[], res, text };
}

function lastMail() {
  return mails[mails.length - 1];
}

function tokenFrom(mail: Mail): string {
  const m = mail.text.match(/signin\?token=([^\s]+)/);
  if (!m) throw new Error('no link in mail');
  return decodeURIComponent(m[1]);
}

function tokenFromUrl(url: string): string {
  return decodeURIComponent(url.split('token=')[1]);
}

function cookieOf(res: { res: Response }, previous: Session = {}): Session {
  const set = res.res.headers.get('set-cookie');
  return set ? { cookie: set.split(';')[0] } : previous;
}

function codeFrom(mail: Mail): string {
  const m = mail.text.match(/code in the app: (\d{6})/);
  if (!m) throw new Error('no code in mail');
  return m[1];
}

async function signIn(email: string, purpose: 'signin' | 'create' = 'signin'): Promise<Session> {
  const before = mails.length;
  await call('POST', '/auth/request', { email, purpose });
  if (mails.length === before) throw new Error(`no email sent to ${email}`);
  const res = await call('POST', '/auth/verify', { token: tokenFrom(lastMail()) });
  expect(res.status).toBe(200);
  const cookie = res.res.headers.get('set-cookie')!.split(';')[0];
  return { cookie };
}

/** An organiser with one tournament, a round, and a group whose scorer is scorer@example.com. */
async function setup() {
  const org = await signIn('org@example.com', 'create');
  const created = await call('POST', '/tournaments', { name: 'Spring Open' }, org);
  expect(created.status).toBe(201);
  const t = String(created.json.id);
  await call('PUT', `/tournaments/${t}/rounds/r1`, { name: 'R1', day: 'friday', format: 'scramble', status: 'active', holes: 3, par: [4, 4, 4] }, org);
  await call('PUT', `/tournaments/${t}/groups/g1`, { name: 'Alpha', roundId: 'r1', players: [{ id: 'p1', name: 'Ann' }], scorerEmail: 'Scorer@Example.com' }, org);
  await call('PUT', `/tournaments/${t}/groups/g2`, { name: 'Bravo', roundId: 'r1', players: [{ id: 'p2', name: 'Ben' }], scorerEmail: 'other@example.com' }, org);
  await call('PUT', `/tournaments/${t}/golfers/x1`, { name: 'Ann' }, org);
  return { org, t };
}

const hole = (teamScore: number, locked = true) => ({ teamScore, locked });

describe('sign-in', () => {
  it('does not email an unknown address, and answers the same way', async () => {
    const res = await call('POST', '/auth/request', { email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(mails).toHaveLength(0);
  });

  it('emails anyone who wants to create a tournament', async () => {
    await call('POST', '/auth/request', { email: 'new@example.com', purpose: 'create' });
    expect(mails).toHaveLength(1);
    expect(lastMail().text).toContain(`${APP_URL}/signin?token=`);
  });

  it('signs in with the emailed code as well as the link (iPhone home-screen app)', async () => {
    await call('POST', '/auth/request', { email: 'new@example.com', purpose: 'create' });
    const res = await call('POST', '/auth/verify', { email: 'NEW@example.com', code: codeFrom(lastMail()) });
    expect(res.status).toBe(200);
    expect(res.json.email).toBe('new@example.com');
  });

  it('stops accepting codes after five wrong guesses', async () => {
    await call('POST', '/auth/request', { email: 'new@example.com', purpose: 'create' });
    const code = codeFrom(lastMail());
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await call('POST', '/auth/verify', { email: 'new@example.com', code: wrong })).status).toBe(401);
    }
    expect((await call('POST', '/auth/verify', { email: 'new@example.com', code })).status).toBe(401);
  });

  it('rejects a bad token and logs out', async () => {
    expect((await call('POST', '/auth/verify', { token: 'nope' })).status).toBe(401);
    const s = await signIn('boss@example.com');
    expect((await call('GET', '/auth/check', undefined, s)).status).toBe(204);
    await call('POST', '/auth/logout', {}, s);
    expect((await call('GET', '/auth/check', undefined, s)).status).toBe(401);
  });

  it('refuses cross-site writes', async () => {
    const res = await call('POST', '/auth/request', { email: 'x@example.com' }, {}, { origin: 'https://evil.test' });
    expect(res.status).toBe(403);
  });
});

describe('public reads', () => {
  it('lets anyone read standings data, but never an email or a PIN', async () => {
    const { t, org } = await setup();
    const legacy = await call('PUT', `/tournaments/${t}/groups/g3`, { name: 'C', roundId: 'r1', players: [], pin: '1234' }, org);
    expect(legacy.status).toBe(200);
    const paths = [`/tournaments/${t}`, `/tournaments/${t}/rounds`, `/tournaments/${t}/groups`, `/tournaments/${t}/groups/g1`,
      `/tournaments/${t}/groups?roundId=r1`, `/tournaments/${t}/rounds/r1/scores`];
    for (const p of paths) {
      const res = await call('GET', p);
      expect(res.status, p).toBe(200);
      expect(res.text, p).not.toMatch(/@|"pin"|adminPin|scorerEmail/);
    }
  });

  it('keeps the golfer roster to organisers', async () => {
    const { t, org } = await setup();
    expect((await call('GET', `/tournaments/${t}/golfers`)).status).toBe(403);
    expect((await call('GET', `/tournaments/${t}/golfers`, undefined, org)).status).toBe(200);
  });

  it('shows scorer emails to the organiser', async () => {
    const { t, org } = await setup();
    const res = await call('GET', `/tournaments/${t}/groups/g1`, undefined, org);
    expect(res.json.scorerEmail).toBe('scorer@example.com');
  });
});

describe('organisers', () => {
  it('cannot change another organiser’s tournament', async () => {
    const { t } = await setup();
    const rival = await signIn('rival@example.com', 'create');
    expect((await call('PATCH', `/tournaments/${t}`, { name: 'Mine now' }, rival)).status).toBe(403);
    expect((await call('PUT', `/tournaments/${t}/rounds/r9`, { name: 'x' }, rival)).status).toBe(403);
    expect((await call('DELETE', `/tournaments/${t}/rounds/r1`, undefined, rival)).status).toBe(403);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, rival)).status).toBe(403);
    expect((await call('GET', `/tournaments/${t}/backup`, undefined, rival)).status).toBe(403);
  });

  it('anonymous visitors cannot write anything', async () => {
    const { t } = await setup();
    expect((await call('PATCH', `/tournaments/${t}`, { name: 'x' })).status).toBe(401);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } })).status).toBe(401);
    expect((await call('POST', '/tournaments', { name: 'x' })).status).toBe(401);
  });

  it('can add a co-organiser, who can then manage the event', async () => {
    const { t, org } = await setup();
    expect((await call('PUT', `/tournaments/${t}/admins`, { emails: ['org@example.com', 'Co@Example.com'] }, org)).status).toBe(200);
    const co = await signIn('co@example.com');
    expect((await call('PATCH', `/tournaments/${t}`, { name: 'Renamed' }, co)).status).toBe(200);
  });

  it('cannot drop themselves from the organiser list', async () => {
    const { t, org } = await setup();
    expect((await call('PUT', `/tournaments/${t}/admins`, { emails: ['co@example.com'] }, org)).status).toBe(400);
  });

  it('sends the scorer a sign-in link for the group', async () => {
    const { t, org } = await setup();
    const res = await call('POST', `/tournaments/${t}/groups/g1/invite`, {}, org);
    expect(res.status).toBe(200);
    expect(lastMail().to).toBe('scorer@example.com');
    expect(lastMail().text).toContain('Alpha');
    expect(lastMail().text).toContain('14 days');
  });

  it('deleting a round removes its groups and scores', async () => {
    const { t, org } = await setup();
    await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, org);
    await call('DELETE', `/tournaments/${t}/rounds/r1`, undefined, org);
    expect((await call('GET', `/tournaments/${t}/groups`)).json).toEqual([]);
    expect((await call('GET', `/tournaments/${t}/rounds/r1/scores`)).json).toEqual([]);
  });
});

describe('scorers', () => {
  it('can score their own group only (email case does not matter)', async () => {
    const { t } = await setup();
    const scorer = await signIn('SCORER@example.com');
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, scorer)).status).toBe(200);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g2`, { holeMap: { 0: hole(3) } }, scorer)).status).toBe(403);
    expect((await call('PATCH', `/tournaments/${t}/rounds/r1`, { status: 'complete' }, scorer)).status).toBe(403);
  });

  it('writes one hole without touching the others', async () => {
    const { t } = await setup();
    const scorer = await signIn('scorer@example.com');
    await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3), 1: hole(5, false) } }, scorer);
    await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 1: hole(4) } }, scorer);
    const res = await call('GET', `/tournaments/${t}/rounds/r1/scores/g1`);
    expect(res.json.holeMap).toEqual({ 0: hole(3), 1: hole(4) });
  });

  it('cannot change scores once the round is complete; the organiser can', async () => {
    const { t, org } = await setup();
    const scorer = await signIn('scorer@example.com');
    await call('PATCH', `/tournaments/${t}/rounds/r1`, { status: 'complete' }, org);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, scorer)).status).toBe(403);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, org)).status).toBe(200);
  });

  it('may rename their group but change nothing else about it', async () => {
    const { t } = await setup();
    const scorer = await signIn('scorer@example.com');
    expect((await call('PATCH', `/tournaments/${t}/groups/g1`, { name: 'The Birdies' }, scorer)).status).toBe(200);
    expect((await call('PATCH', `/tournaments/${t}/groups/g1`, { scorerEmail: 'me@x.com' }, scorer)).status).toBe(403);
    expect((await call('PATCH', `/tournaments/${t}/groups/g2`, { name: 'Mine' }, scorer)).status).toBe(403);
  });

  it('rejects malformed holes', async () => {
    const { t, org } = await setup();
    const bad = [{ 0: { teamScore: 3 } }, { 99: hole(3) }, { 3: hole(3) }, { x: hole(3) }, {}];
    for (const holeMap of bad) {
      expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap }, org)).status).toBe(400);
    }
  });

  it('sees their groups in /auth/me', async () => {
    const { t } = await setup();
    const scorer = await signIn('scorer@example.com');
    const me = await call('GET', '/auth/me', undefined, scorer);
    expect(me.json.groups).toEqual([{ tournamentId: t, id: 'g1', roundId: 'r1', name: 'Alpha' }]);
  });
});

describe('app admin', () => {
  it('can manage any tournament, archive it, and restore a backup under a new code', async () => {
    const { t } = await setup();
    const boss = await signIn(APP_ADMIN);
    expect((await call('PATCH', `/tournaments/${t}`, { name: 'Fixed' }, boss)).status).toBe(200);
    expect((await call('POST', `/tournaments/${t}/archive`, { archived: true }, boss)).json.archivedAt).toBeTypeOf('number');
    const backup = (await call('GET', `/tournaments/${t}/backup`, undefined, boss)).json;
    expect((await call('POST', '/import', { backup, targetId: 'COPY1' }, boss)).status).toBe(201);
    expect((await call('GET', '/tournaments/COPY1/groups/g1', undefined, boss)).json.scorerEmail).toBe('scorer@example.com');
    expect((await call('POST', '/import', { backup, targetId: 'COPY1' }, boss)).status).toBe(409);
  });

  it('imports a Firestore-era backup: legacy holes array, PINs dropped', async () => {
    const boss = await signIn(APP_ADMIN);
    const backup = {
      version: 1, exportedAt: 0, tournamentId: 'OLD', tournament: { name: 'Old', adminPin: '9999', createdAt: 5 },
      rounds: [{ id: 'r1', data: { name: 'R', format: 'scramble', holes: 2, par: [4, 4], status: 'complete', day: 'saturday_am' },
        scores: [{ id: 'g1', data: { groupId: 'g1', updatedAt: 1, holes: [hole(4), hole(5)], holeMap: { 1: hole(3) } } }] }],
      groups: [{ id: 'g1', data: { name: 'G', roundId: 'r1', pin: '1234', players: [] } }],
      golfers: [], courses: [],
    };
    expect((await call('POST', '/import', { backup }, boss)).status).toBe(201);
    const scores = await call('GET', '/tournaments/OLD/rounds/r1/scores/g1');
    expect(scores.json.holeMap).toEqual({ 0: hole(4), 1: hole(3) });
    const all = (await call('GET', '/tournaments/OLD/backup', undefined, boss)).text;
    expect(all).not.toMatch(/"pin"|adminPin/);
  });

  it('only app admins can list every tournament or import', async () => {
    await setup();
    const rival = await signIn('rival@example.com', 'create');
    expect((await call('GET', '/tournaments', undefined, rival)).json).toEqual([]);
    expect((await call('POST', '/import', { backup: {} }, rival)).status).toBe(403);
  });
});

describe('shared sign-in links (organiser copies and texts them)', () => {
  async function groupLink(t: string, groupId: string, org: Session) {
    const res = await call('POST', `/tournaments/${t}/groups/${groupId}/link`, {}, org);
    expect(res.status).toBe(200);
    return res.json as unknown as { url: string; code: string; expiresAt: number };
  }

  it('signs a phone in to the group without any email', async () => {
    const { t, org } = await setup();
    await call('PATCH', `/tournaments/${t}/groups/g1`, { scorerEmail: null }, org);
    const link = await groupLink(t, 'g1', org);
    expect(link.url).toMatch(/^https:\/\/golf\.test\/signin\?token=/);
    expect(link.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const res = await call('POST', '/auth/verify', { token: tokenFromUrl(link.url) });
    expect(res.status).toBe(200);
    expect(res.json.email).toBeNull();
    expect(res.json.groups).toEqual([{ tournamentId: t, id: 'g1', roundId: 'r1', name: 'Alpha' }]);
    const phone = cookieOf(res);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, phone)).status).toBe(200);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g2`, { holeMap: { 0: hole(3) } }, phone)).status).toBe(403);
    expect((await call('GET', '/auth/check', undefined, phone)).status).toBe(204);
  });

  it('a group-only phone cannot organise, create tournaments or read the roster', async () => {
    const { t, org } = await setup();
    await call('PATCH', `/tournaments/${t}/groups/g1`, { scorerEmail: null }, org);
    const phone = cookieOf(await call('POST', '/auth/verify', { token: tokenFromUrl((await groupLink(t, 'g1', org)).url) }));
    expect((await call('POST', '/tournaments', { name: 'x' }, phone)).status).toBe(403);
    expect((await call('GET', `/tournaments/${t}/golfers`, undefined, phone)).status).toBe(403);
    expect((await call('POST', `/tournaments/${t}/groups/g1/link`, {}, phone)).status).toBe(403);
    expect((await call('PATCH', `/tournaments/${t}/groups/g1`, { name: 'Renamed' }, phone)).status).toBe(200);
  });

  it('the code alone works (home-screen app), with or without the dash', async () => {
    const { t, org } = await setup();
    const link = await groupLink(t, 'g1', org);
    const res = await call('POST', '/auth/verify', { code: link.code.replace('-', '').toLowerCase() });
    expect(res.status).toBe(200);
    expect((await call('POST', '/auth/verify', { code: 'AAAA-AAAA' })).status).toBe(401);
  });

  it('a second link adds its group to the same phone', async () => {
    const { t, org } = await setup();
    await call('PATCH', `/tournaments/${t}/groups/g1`, { scorerEmail: null }, org);
    await call('PATCH', `/tournaments/${t}/groups/g2`, { scorerEmail: null }, org);
    const first = await call('POST', '/auth/verify', { token: tokenFromUrl((await groupLink(t, 'g1', org)).url) });
    const phone = cookieOf(first);
    const second = await call('POST', '/auth/verify', { token: tokenFromUrl((await groupLink(t, 'g2', org)).url) }, phone);
    expect(second.res.headers.get('set-cookie')).toBeNull();
    expect((second.json.groups as unknown[]).length).toBe(2);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g2`, { holeMap: { 0: hole(3) } }, phone)).status).toBe(200);
  });

  it('a link for a group with a scorer email signs in as that person', async () => {
    const { t, org } = await setup();
    const res = await call('POST', '/auth/verify', { token: tokenFromUrl((await groupLink(t, 'g1', org)).url) });
    expect(res.json.email).toBe('scorer@example.com');
  });

  it('resetting a group signs its phones out and voids its links', async () => {
    const { t, org } = await setup();
    await call('PATCH', `/tournaments/${t}/groups/g1`, { scorerEmail: null }, org);
    const link = await groupLink(t, 'g1', org);
    const phone = cookieOf(await call('POST', '/auth/verify', { token: tokenFromUrl(link.url) }));
    expect((await call('POST', `/tournaments/${t}/groups/g1/revoke`, {}, org)).status).toBe(200);
    expect((await call('PUT', `/tournaments/${t}/rounds/r1/scores/g1`, { holeMap: { 0: hole(3) } }, phone)).status).toBe(403);
    expect((await call('POST', '/auth/verify', { token: tokenFromUrl(link.url) })).status).toBe(401);
    expect((await call('POST', '/auth/verify', { code: link.code })).status).toBe(401);
  });

  it('a deleted group’s link stops working', async () => {
    const { t, org } = await setup();
    const link = await groupLink(t, 'g1', org);
    await call('DELETE', `/tournaments/${t}/groups/g1`, undefined, org);
    expect((await call('POST', '/auth/verify', { token: tokenFromUrl(link.url) })).status).toBe(401);
  });

  it('organisers get links for co-organisers on their list only; app admins for anyone', async () => {
    const { t, org } = await setup();
    expect((await call('POST', `/tournaments/${t}/admins/link`, { email: 'co@example.com' }, org)).status).toBe(400);
    await call('PUT', `/tournaments/${t}/admins`, { emails: ['org@example.com', 'co@example.com'] }, org);
    const link = (await call('POST', `/tournaments/${t}/admins/link`, { email: 'co@example.com' }, org)).json as unknown as { url: string };
    const co = cookieOf(await call('POST', '/auth/verify', { token: tokenFromUrl(link.url) }));
    expect((await call('PATCH', `/tournaments/${t}`, { name: 'Co-run' }, co)).status).toBe(200);
    expect((await call('POST', '/auth/link', { email: 'new@example.com' }, org)).status).toBe(403);
    const boss = await signIn(APP_ADMIN);
    expect((await call('POST', '/auth/link', { email: 'new@example.com' }, boss)).status).toBe(200);
  });
});

describe('without an email account on the server', () => {
  it('turns email sign-in off; shared links still work', async () => {
    const quiet = createApp(db, null, { appUrl: APP_URL, appAdminEmails: new Set([APP_ADMIN]), allowSelfService: true, secureCookies: true });
    const q = async (method: string, path: string, body?: unknown, cookie?: string) => {
      const res = await quiet.request(`/api${path}`, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null), res };
    };
    expect((await q('GET', '/config')).json).toEqual({ emailSignIn: false });
    expect((await q('POST', '/auth/request', { email: 'org@example.com', purpose: 'create' })).status).toBe(400);
    // The first sign-in comes from the login-link command on the server
    const { issueSharedLogin } = await import('./auth');
    const { token } = issueSharedLogin(db, { email: APP_ADMIN, tournamentId: null, groupId: null });
    const res = await q('POST', '/auth/verify', { token });
    expect(res.status).toBe(200);
    const cookie = res.res.headers.get('set-cookie')!.split(';')[0];
    expect((await q('POST', '/tournaments', { name: 'No Mail Open' }, cookie)).status).toBe(201);
    expect(mails).toHaveLength(0);
  });
});
