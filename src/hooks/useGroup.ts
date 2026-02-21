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
  saving: boolean;
  saveError: boolean;
  saveHole: (holeIndex: number, hole: HoleScore) => Promise<void>;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Always up-to-date reference to holes — avoids stale closure in saveHole
  const holesRef = useRef<HoleScore[]>([]);
  holesRef.current = holes;

  useEffect(() => {
    if (!tournamentId || !round || !groupId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const unsub = subscribeGroupScores(
      tournamentId,
      round.id,
      groupId,
      (doc) => {
        if (doc && holesMatchFormat(doc.holes, round.format)) {
          setScoreDoc(doc);
          // Merge: keep local state for any unlocked holes (user may be entering data),
          // but always accept locked holes from Firestore as the source of truth.
          setHoles((prev) => {
            if (prev.length === 0) return doc.holes;
            return prev.map((localHole, i) => {
              const remoteHole = doc.holes[i];
              return remoteHole?.locked ? remoteHole : localHole;
            });
          });
        } else {
          // No doc, or stale doc from a previous format — build fresh holes.
          const initial = buildInitialHoles(round, players);
          setHoles(initial);
        }
        setLoading(false);
      },
    );

    return unsub;
  }, [tournamentId, round?.id, groupId]);

  const setLocalHole = useCallback(
    (holeIndex: number, hole: HoleScore) => {
      setHoles((prev) => {
        const next = [...prev];
        next[holeIndex] = hole;
        return next;
      });
    },
    [],
  );

  const saveHole = useCallback(
    async (holeIndex: number, hole: HoleScore) => {
      if (!tournamentId || !round || !groupId) return;

      // Optimistic local update
      setHoles((prev) => {
        const next = [...prev];
        next[holeIndex] = hole;
        return next;
      });

      // Build the full holes array to persist: latest known state + this hole
      const next = [...holesRef.current];
      next[holeIndex] = hole;

      setSaving(true);
      try {
        await saveGroupScores(tournamentId, round.id, groupId, next);
        setSaveError(false);
      } catch (err) {
        console.error('saveHole error', err);
        setSaveError(true);
      } finally {
        setSaving(false);
      }
    },
    [tournamentId, round, groupId],
  );

  return { scoreDoc, holes, loading, saving, saveError, saveHole, setLocalHole };
}
