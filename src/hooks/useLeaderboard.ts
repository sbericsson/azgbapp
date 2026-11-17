import { useState, useEffect } from 'react';
import { subscribeAllScores } from '../lib/data';
import type { GroupScoreDoc } from '../types/scoring';
import type { Group, Round } from '../types/tournament';
import { computeStandings } from '../lib/scoring/standings';

export interface LeaderboardEntry {
  groupId: string;
  groupName: string;
  score: number; // points for wolf, score-to-par for others
  holesCompleted: number;
  rank: number | null;
  tied: boolean;
  // Wolf: per-player points breakdown
  playerPoints?: { playerId: string; name: string; pts: number }[];
  // Scramble / Gauntlet: team member names
  players?: { id: string; name: string }[];
}

export function useLeaderboard(
  tournamentId: string | null,
  round: Round | null,
  groups: Group[],
): { entries: LeaderboardEntry[]; loading: boolean } {
  const roundId = round?.id ?? null;
  const [scoreState, setScoreState] = useState<{
    roundId: string | null;
    docs: GroupScoreDoc[];
  }>({
    roundId: null,
    docs: [],
  });

  useEffect(() => {
    if (!tournamentId || !round) {
      return;
    }

    const unsub = subscribeAllScores(tournamentId, round.id, (docs) => {
      setScoreState({ roundId: round.id, docs });
    });
    return unsub;
  }, [tournamentId, round]);

  const scoreDocs = scoreState.roundId === roundId ? scoreState.docs : [];
  const loading = Boolean(tournamentId && round) && scoreState.roundId !== roundId;

  const entries: LeaderboardEntry[] = round
    ? computeStandings(round, groups, scoreDocs).map((s) => ({
        groupId: s.group.id,
        groupName: s.group.name,
        score: s.score,
        holesCompleted: s.holesCompleted,
        rank: s.rank,
        tied: s.tied,
        playerPoints: s.playerPoints,
        players: round.format === 'scramble' || round.format === 'gauntlet' ? s.group.players : undefined,
      }))
    : [];

  return { entries, loading };
}
