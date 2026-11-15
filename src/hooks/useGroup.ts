import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeGroupScores, saveGroupScores } from '../lib/firestore';
import type { GroupScoreDoc, HoleScore } from '../types/scoring';
import type { Round } from '../types/tournament';
import { emptyWolfHole, isWolfHole } from '../lib/scoring/wolf';
import { emptyBestBallHole, isBestBallHole } from '../lib/scoring/bestBall';
import { emptyScrambleHole, isScrambleHole } from '../lib/scoring/scramble';
import { emptyGauntletHole, isGauntletHole } from '../lib/scoring/gauntlet';
import type { Player, RoundFormat } from '../types/tournament';

interface UseGroupReturn {
  scoreDoc: GroupScoreDoc | null;
  holes: HoleScore[];
  loading: boolean;
  /** True while this phone has writes the server has not yet acknowledged. */
  pendingSync: boolean;
  saveError: boolean;
  /**
   * Save a hole. Applies locally and queues the write immediately; it does not
   * wait for the server, so it works the same offline (B1).
   */
  saveHole: (holeIndex: number, hole: HoleScore) => void;
  setLocalHole: (holeIndex: number, hole: HoleScore) => void;
}

function holesMatchFormat(holes: HoleScore[], format: RoundFormat): boolean {
  if (holes.length === 0) return true;
  const first = holes[0];
  switch (format) {
    case 'wolf':     return isWolfHole(first);
    case 'bestBall': return isBestBallHole(first);
    case 'scramble': return isScrambleHole(first);
    case 'gauntlet': return isGauntletHole(first);
  }
}

function buildInitialHoles(round: Round, players: Player[]): HoleScore[] {
  return Array.from({ length: round.holes }, (_, i) => {
    switch (round.format) {
      case 'wolf':
        return emptyWolfHole(players, i);
      case 'bestBall':
        return emptyBestBallHole(players);
      case 'scramble':
        return emptyScrambleHole();
      case 'gauntlet':
        return emptyGauntletHole(i, round.holes);
    }
  });
}

export function useGroup(
  tournamentId: string | null,
  round: Round | null,
  groupId: string | null,
  players: Player[],
): UseGroupReturn {
  const [scoreDoc, setScoreDoc] = useState<GroupScoreDoc | null>(null);
  const [holes, setHoles] = useState<HoleScore[]>([]);
  // Which subscription has delivered its first snapshot; loading is derived from it
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Always up-to-date copy of holes — avoids stale closures in saveHole. Every
  // change goes through commitHoles so the ref and state never diverge.
  const holesRef = useRef<HoleScore[]>([]);
  const subscribedKeyRef = useRef<string | null>(null);
  const commitHoles = useCallback((next: HoleScore[]) => {
    holesRef.current = next;
    setHoles(next);
  }, []);

  useEffect(() => {
    if (!tournamentId || !round || !groupId) return;
    const key = `${tournamentId}/${round.id}/${groupId}`;
    // A different round or group must not inherit the previous one's holes.
    // A resubscribe for the same key (e.g. the round doc changed) keeps local edits.
    if (subscribedKeyRef.current !== key) {
      subscribedKeyRef.current = key;
      holesRef.current = [];
    }

    const unsub = subscribeGroupScores(
      tournamentId,
      round.id,
      groupId,
      (doc, meta) => {
        setPendingSync(meta.hasPendingWrites);
        if (doc && holesMatchFormat(doc.holes, round.format)) {
          setScoreDoc(doc);
          // Merge: keep local state for any unlocked holes (user may be entering data),
          // but always accept locked holes from Firestore as the source of truth.
          const prev = holesRef.current;
          commitHoles(
            prev.length === 0
              ? doc.holes
              : prev.map((localHole, i) => {
                  const remoteHole = doc.holes[i];
                  return remoteHole?.locked ? remoteHole : localHole;
                }),
          );
        } else {
          // No doc, or stale doc from a previous format — build fresh holes.
          commitHoles(buildInitialHoles(round, players));
        }
        setLoadedKey(key);
      },
    );

    return unsub;
  }, [groupId, players, round, tournamentId, commitHoles]);

  const setLocalHole = useCallback(
    (holeIndex: number, hole: HoleScore) => {
      const next = [...holesRef.current];
      next[holeIndex] = hole;
      commitHoles(next);
    },
    [commitHoles],
  );

  const saveHole = useCallback(
    (holeIndex: number, hole: HoleScore) => {
      if (!tournamentId || !round || !groupId) return;

      // Build the full holes array to persist: latest known state + this hole.
      // Update the ref synchronously so a second save before re-render keeps this one.
      const next = [...holesRef.current];
      next[holeIndex] = hole;
      commitHoles(next);
      setSaveError(false);
      setPendingSync(true);

      // Fire and forget: the local cache applies the write at once and the SDK
      // syncs it when a connection is available. The promise only settles on
      // server acknowledgement, so it is never awaited by the UI.
      try {
        saveGroupScores(tournamentId, round.id, groupId, next).catch((err) => {
          console.error('saveHole error', err);
          setSaveError(true);
        });
      } catch (err) {
        console.error('saveHole error', err);
        setSaveError(true);
      }
    },
    [tournamentId, round, groupId, commitHoles],
  );

  const loading = Boolean(tournamentId && round && groupId) &&
    loadedKey !== `${tournamentId}/${round?.id}/${groupId}`;

  return { scoreDoc, holes, loading, pendingSync, saveError, saveHole, setLocalHole };
}
