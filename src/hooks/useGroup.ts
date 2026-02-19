import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeGroupScores, saveGroupScores } from '../lib/firestore';
import type { GroupScoreDoc, HoleScore } from '../types/scoring';
import type { Round } from '../types/tournament';
import { emptyWolfHole } from '../lib/scoring/wolf';
import { emptyBestBallHole } from '../lib/scoring/bestBall';
import { emptyScrambleHole } from '../lib/scoring/scramble';
import type { Player } from '../types/tournament';

interface UseGroupReturn {
  scoreDoc: GroupScoreDoc | null;
  holes: HoleScore[];
  loading: boolean;
  saving: boolean;
  saveHole: (holeIndex: number, hole: HoleScore) => Promise<void>;
  setLocalHole: (holeIndex: number, hole: HoleScore) => void;
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
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!tournamentId || !round || !groupId) {
      setLoading(false);
      return;
    }

    initializedRef.current = false;
    setLoading(true);

    const unsub = subscribeGroupScores(
      tournamentId,
      round.id,
      groupId,
      (doc) => {
        if (doc) {
          setScoreDoc(doc);
          setHoles(doc.holes);
        } else {
          // No existing doc — initialise with empty holes
          const initial = buildInitialHoles(round, players);
          setHoles(initial);
        }
        setLoading(false);
        initializedRef.current = true;
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

      // Optimistic update
      setHoles((prev) => {
        const next = [...prev];
        next[holeIndex] = hole;
        return next;
      });

      setSaving(true);
      try {
        // Read current holes, apply update, write full doc
        setHoles((prev) => {
          const next = [...prev];
          next[holeIndex] = hole;
          saveGroupScores(tournamentId, round.id, groupId, next).finally(() =>
            setSaving(false),
          );
          return next;
        });
      } catch (err) {
        console.error('saveHole error', err);
        setSaving(false);
      }
    },
    [tournamentId, round, groupId],
  );

  return { scoreDoc, holes, loading, saving, saveHole, setLocalHole };
}
