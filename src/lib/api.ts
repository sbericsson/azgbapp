/**
 * Client transport for the self-hosted API (R13).
 *
 *  - api():   JSON requests to /api with the session cookie.
 *  - live():  a read that stays current. It emits the cached copy first (works
 *             offline), then the server copy, then refetches whenever the
 *             tournament's change feed (Server-Sent Events) says it changed.
 *  - Outbox:  score writes are queued on the phone (localStorage) and sent in
 *             order when there is a connection, so locking holes never waits
 *             for the network (B1). Reads of a group's scores include queued
 *             holes, the way Firestore's local cache used to.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True when the request never reached the server (offline, DNS, timeout). */
export function isNetworkError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

export async function api<T>(method: string, path: string, body?: unknown, opts: { nullsForUndefined?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined
        // In a partial update `undefined` means "remove this field", like Firestore's deleteField (B5)
        ? JSON.stringify(body, opts.nullsForUndefined ? (_k, v) => (v === undefined ? null : v) : undefined)
        : undefined,
    });
  } catch {
    throw new ApiError(0, 'No connection');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    // nginx answers 502/504 while the API restarts: treat like no connection
    throw new ApiError(res.status === 502 || res.status === 504 ? 0 : res.status, message);
  }
  return json as T;
}

// ── Offline read cache ─────────────────────────────────────────────────────────

const CACHE_PREFIX = 'azgb_c:';

function readCache<T>(path: string): T | undefined {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + path);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeCache(path: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(CACHE_PREFIX + path);
    else localStorage.setItem(CACHE_PREFIX + path, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: the app still works online
  }
}

export function clearCache(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

/**
 * GET with the offline cache. A 404 becomes null when `nullOn404` is set.
 * Without a connection the cached copy is returned (fromCache: true).
 */
export async function cachedGet<T>(path: string, nullOn404 = false): Promise<{ value: T; fromCache: boolean }> {
  try {
    const value = await api<T>('GET', path);
    writeCache(path, value);
    return { value, fromCache: false };
  } catch (err) {
    if (nullOn404 && err instanceof ApiError && err.status === 404) {
      writeCache(path, null);
      return { value: null as T, fromCache: false };
    }
    if (isNetworkError(err)) {
      const cached = readCache<T>(path);
      if (cached !== undefined) return { value: cached, fromCache: true };
    }
    throw err;
  }
}

// ── Live updates ───────────────────────────────────────────────────────────────

export interface ChangeEvent {
  c: string;
  r?: string;
  id?: string;
}

interface Watcher {
  match: (e: ChangeEvent) => boolean;
  refresh: () => void;
}

interface Feed {
  source: EventSource | null;
  watchers: Set<Watcher>;
}

const feeds = new Map<string, Feed>();

function refreshAll() {
  for (const feed of feeds.values()) for (const w of feed.watchers) w.refresh();
}

if (typeof window !== 'undefined') {
  // iOS suspends streams in the background; catch up when the app returns
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshAll();
  });
  window.addEventListener('online', refreshAll);
}

function openSource(tournamentId: string, feed: Feed) {
  if (typeof EventSource === 'undefined') return;
  const source = new EventSource(`/api/tournaments/${encodeURIComponent(tournamentId)}/events`);
  let first = true;
  source.addEventListener('ready', () => {
    // A reconnect may have missed changes: refetch everything shown
    if (!first) for (const w of feed.watchers) w.refresh();
    first = false;
  });
  source.addEventListener('change', (msg) => {
    let event: ChangeEvent;
    try {
      event = JSON.parse((msg as MessageEvent).data) as ChangeEvent;
    } catch {
      return;
    }
    for (const w of feed.watchers) if (w.match(event)) w.refresh();
  });
  feed.source = source;
}

function watch(tournamentId: string, watcher: Watcher): () => void {
  let feed = feeds.get(tournamentId);
  if (!feed) {
    feed = { source: null, watchers: new Set() };
    feeds.set(tournamentId, feed);
    openSource(tournamentId, feed);
  }
  feed.watchers.add(watcher);
  return () => {
    feed.watchers.delete(watcher);
    if (feed.watchers.size === 0) {
      feed.source?.close();
      feeds.delete(tournamentId);
    }
  };
}

/** Subscribers by path, so a local write can update every screen showing it at once. */
const pathListeners = new Map<string, Set<(value: unknown) => void>>();

function emitPath(path: string, value: unknown) {
  writeCache(path, value);
  for (const l of pathListeners.get(path) ?? []) l(value);
}

export type Unsubscribe = () => void;

export interface LiveOptions {
  /** Treat 404 as an empty result (null). */
  nullOn404?: boolean;
  onError?: (err: Error) => void;
}

export function live<T>(
  tournamentId: string,
  path: string,
  match: (e: ChangeEvent) => boolean,
  callback: (value: T, meta: { fromCache: boolean }) => void,
  opts: LiveOptions = {},
): Unsubscribe {
  let active = true;
  let timer: number | null = null;
  let seq = 0;

  const cached = readCache<T>(path);
  if (cached !== undefined) queueMicrotask(() => { if (active) callback(cached, { fromCache: true }); });

  const fetchNow = () => {
    const mine = ++seq;
    cachedGet<T>(path, opts.nullOn404)
      .then(({ value, fromCache }) => { if (active && mine === seq) callback(value, { fromCache }); })
      .catch((err: Error) => { if (active && mine === seq) opts.onError?.(err); });
  };
  // Several events in a burst (e.g. a batch of admin edits) cause one refetch
  const refresh = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => { timer = null; fetchNow(); }, 120);
  };
  fetchNow();

  const listener = (value: unknown) => { if (active) callback(value as T, { fromCache: false }); };
  let set = pathListeners.get(path);
  if (!set) {
    set = new Set();
    pathListeners.set(path, set);
  }
  set.add(listener);
  const unwatch = watch(tournamentId, { match, refresh });

  return () => {
    active = false;
    if (timer !== null) window.clearTimeout(timer);
    unwatch();
    set.delete(listener);
    if (set.size === 0) pathListeners.delete(path);
  };
}

// ── Score outbox ───────────────────────────────────────────────────────────────

export interface OutboxEntry {
  key: string;
  tournamentId: string;
  roundId: string;
  groupId: string;
  holeMap: Record<string, unknown>;
}

const OUTBOX_KEY = 'azgb_outbox';

function loadOutbox(): OutboxEntry[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const list = raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

let outbox: OutboxEntry[] = typeof localStorage !== 'undefined' ? loadOutbox() : [];
const outboxListeners = new Set<() => void>();
const waiters = new Map<string, { resolve: () => void; reject: (err: Error) => void }>();
let flushing = false;
let retryTimer: number | null = null;

function saveOutbox() {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch {
    // The write stays in memory and is sent while the app is open
  }
  for (const l of outboxListeners) l();
}

export function onOutboxChange(listener: () => void): Unsubscribe {
  outboxListeners.add(listener);
  return () => outboxListeners.delete(listener);
}

export function pendingHoles(tournamentId: string, roundId: string, groupId?: string): OutboxEntry[] {
  return outbox.filter((e) => e.tournamentId === tournamentId && e.roundId === roundId && (!groupId || e.groupId === groupId));
}

export function scorePath(tournamentId: string, roundId: string, groupId?: string): string {
  const base = `/tournaments/${encodeURIComponent(tournamentId)}/rounds/${encodeURIComponent(roundId)}/scores`;
  return groupId ? `${base}/${encodeURIComponent(groupId)}` : base;
}

/**
 * Queue some holes of a group's scores. Visible to readers at once; sent when
 * possible. The promise settles when the server accepts or refuses the write,
 * which may be much later: never await it in the scoring UI.
 */
export function queueHoles(tournamentId: string, roundId: string, groupId: string, holeMap: Record<string, unknown>): Promise<void> {
  const key = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  outbox.push({ key, tournamentId, roundId, groupId, holeMap });
  saveOutbox();
  const done = new Promise<void>((resolve, reject) => waiters.set(key, { resolve, reject }));
  void flushOutbox();
  return done;
}

function settle(entry: OutboxEntry, err: Error | null) {
  outbox = outbox.filter((e) => e.key !== entry.key);
  saveOutbox();
  const w = waiters.get(entry.key);
  waiters.delete(entry.key);
  if (w && err) w.reject(err);
  else if (w) w.resolve();
}

function scheduleRetry() {
  if (retryTimer !== null) return;
  retryTimer = window.setTimeout(() => { retryTimer = null; void flushOutbox(); }, 10_000);
}

export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (outbox.length > 0) {
      const entry = outbox[0];
      try {
        const doc = await api<unknown>('PUT', scorePath(entry.tournamentId, entry.roundId, entry.groupId), { holeMap: entry.holeMap });
        settle(entry, null);
        // Publish the server's copy before the change feed round-trip, so the
        // hole does not flicker back to its old state when the overlay drops
        emitPath(scorePath(entry.tournamentId, entry.roundId, entry.groupId), doc);
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 0 || status === 429 || status >= 500) {
          scheduleRetry();
          return;
        }
        // Refused (signed out, round complete, not this group's scorer): drop it
        settle(entry, err instanceof Error ? err : new Error(String(err)));
      }
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void flushOutbox(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushOutbox();
  });
  if (outbox.length > 0) queueMicrotask(() => { void flushOutbox(); });
}
