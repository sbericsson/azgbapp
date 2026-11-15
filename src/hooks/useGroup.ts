import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeGroupScores, saveGroupHoles } from '../lib/firestore';
import type { HoleScore } from '../types/scoring';
import type { Player, Round } from '../types/tournament';
import { buildInitialHoles, completeHoles, mergeRemoteHoles } from '../lib/scoring/holes';

interface UseGroupReturn {
  holes: HoleScore[];
  loading: boolean;
  /** True while this phone has writes the server has not yet acknowledged. */
  pendingSync: boolean;
  saveError: boolean;
  /**
   * Save a hole (lock or unlock). Applies locally and queues the write at once;
   * it does not wait for the server, so it works the same offline (B1).
   */
  saveHole: (holeIndex: number, hole: HoleScore) => void;
  /**
   * Edit a hole in progress. Shown at once and written shortly after the last
   * change, so entries survive the app being closed or the tab evicted (R2).
   */
  setLocalHole: (holeIndex: number, hole: HoleScore) => void;
}

/** Wait this long after the last edit to an unlocked hole before writing it. */
const IN_PROGRESS_SAVE_MS = 800;

interface Ids { tournamentId: string; roundId: string; groupId: string }

export function useGroup(
  tournamentId: string | null,
  round: Round | null,
  groupId: string | null,
  players: Player[],
): UseGroupReturn {
  const [holes, setHoles] = useState<HoleScore[]>([]);
  // Which subscription has delivered its first snapshot; loading is derived from it
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Always up-to-date copy of holes — avoids stale closures in saveHole. Every
  // change goes through commitHoles so the ref and state never diverge.
  const holesRef = useRef<HoleScore[]>([]);
  const subscribedKeyRef = useRef<string | null>(null);
  const idsRef = useRef<Ids | null>(null);
  // Holes edited here and not yet written: remote snapshots do not overwrite them (R2)
  const dirtyRef = useRef(new Set<number>());
  // Pending in-progress writes by hole index
  const timersRef = useRef(new Map<number, number>());

  const commitHoles = useCallback((next: HoleScore[]) => {
    holesRef.current = next;
    setHoles(next);
  }, []);

  // Each write carries only the holes it changes (B2).
  const write = useCallback((ids: Ids, updates: Map<number, HoleScore>) => {
    setSaveError(false);
    setPendingSync(true);
    // Fire and forget: the local cache applies the write at once and the SDK
    // syncs it when a connection is available. The promise only settles on
    // server acknowledgement, so the UI never awaits it.
    try {
      saveGroupHoles(ids.tournamentId, ids.roundId, ids.groupId, updates).catch((err) => {
        console.error('saveHoles error', err);
        setSaveError(true);
      });
    } catch (err) {
      console.error('saveHoles error', err);
      setSaveError(true);
    }
  }, []);

  /** Write every in-progress hole now (app hidden, group change, unmount). */
  const flushPending = useCallback(() => {
    const ids = idsRef.current;
    if (!ids || timersRef.current.size === 0) return;
    const updates = new Map<number, HoleScore>();
    for (const [i, timer] of timersRef.current) {
      window.clearTimeout(timer);
      const hole = holesRef.current[i];
      if (hole) updates.set(i, hole);
      dirtyRef.current.delete(i);
    }
    timersRef.current.clear();
    if (updates.size > 0) write(ids, updates);
  }, [write]);

  useEffect(() => {
    if (!tournamentId || !round || !groupId) return;
    const key = `${tournamentId}/${round.id}/${groupId}`;
    // A different round or group must not inherit the previous one's holes.
    // A resubscribe for the same key (e.g. the round doc changed) keeps local edits.
    if (subscribedKeyRef.current !== key) {
      flushPending();
      subscribedKeyRef.current = key;
      holesRef.current = [];
      dirtyRef.current = new Set();
    }
    idsRef.current = { tournamentId, roundId: round.id, groupId };

    const unsub = subscribeGroupScores(
      tournamentId,
      round.id,
      groupId,
      (doc, meta) => {
        setPendingSync(meta.hasPendingWrites);
        // No doc yet, or a stale doc from a previous format: start from empty holes.
        const remote = (doc && completeHoles(round, players, doc.holes)) ?? buildInitialHoles(round, players);
        const prev = holesRef.current;
        commitHoles(prev.length === 0 ? remote : mergeRemoteHoles(prev, remote, dirtyRef.current));
        setLoadedKey(key);
      },
    );

    return unsub;
  }, [groupId, players, round, tournamentId, commitHoles, flushPending]);

  // Write in-progress entries before the app is backgrounded or the page left
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushPending(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flushPending);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flushPending);
      flushPending();
    };
  }, [flushPending]);

  const setLocalHole = useCallback(
    (holeIndex: number, hole: HoleScore) => {
      const next = [...holesRef.current];
      next[holeIndex] = hole;
      commitHoles(next);
      dirtyRef.current.add(holeIndex);

      const ids = idsRef.current;
      if (!ids) return;
      const existing = timersRef.current.get(holeIndex);
      if (existing !== undefined) window.clearTimeout(existing);
      timersRef.current.set(holeIndex, window.setTimeout(() => {
        timersRef.current.delete(holeIndex);
        dirtyRef.current.delete(holeIndex);
        const latest = holesRef.current[holeIndex];
        if (latest) write(ids, new Map([[holeIndex, latest]]));
      }, IN_PROGRESS_SAVE_MS));
    },
    [commitHoles, write],
  );

  const saveHole = useCallback(
    (holeIndex: number, hole: HoleScore) => {
      const ids = idsRef.current;
      if (!ids) return;
      // This write supersedes any pending in-progress write of the same hole
      const pending = timersRef.current.get(holeIndex);
      if (pending !== undefined) {
        window.clearTimeout(pending);
        timersRef.current.delete(holeIndex);
      }
      dirtyRef.current.delete(holeIndex);

      // Update the ref synchronously so a second save before re-render keeps this one.
      const next = [...holesRef.current];
      next[holeIndex] = hole;
      commitHoles(next);
      write(ids, new Map([[holeIndex, hole]]));
    },
    [commitHoles, write],
  );

  const loading = Boolean(tournamentId && round && groupId) &&
    loadedKey !== `${tournamentId}/${round?.id}/${groupId}`;

  return { holes, loading, pendingSync, saveError, saveHole, setLocalHole };
}
