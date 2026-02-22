import { useState, useEffect } from 'react';
import { subscribeAllScores } from '../lib/firestore';
import type { GroupScoreDoc, WolfHoleScore, BestBallHoleScore, ScrambleHoleScore, GauntletHoleScore } from '../types/scoring';
import type { Group, Round } from '../types/tournament';
import { totalWolfPoints, isWolfHole } from '../lib/scoring/wolf';
import { bestBallTotalToPar, isBestBallHole } from '../lib/scoring/bestBall';
import { scrambleTotalToPar, isScrambleHole } from '../lib/scoring/scramble';
import { gauntletTotalToPar, isGauntletHole } from '../lib/scoring/gauntlet';

export interface LeaderboardEntry {
  groupId: string;
  groupName: string;
  score: number; // points for wolf, score-to-par for others
  holesCompleted: number;
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
  const [scoreDocs, setScoreDocs] = useState<GroupScoreDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tournamentId || !round) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = subscribeAllScores(tournamentId, round.id, (docs) => {
      setScoreDocs(docs);
      setLoading(false);
    });
    return unsub;
  }, [tournamentId, round?.id]);

  const entries: LeaderboardEntry[] = groups
    .map((group) => {
      const doc = scoreDocs.find((d) => d.groupId === group.id);
      if (!doc) {
        return {
          groupId: group.id,
          groupName: group.name,
          score: 0,
          holesCompleted: 0,
        };
      }

      const holes = doc.holes;
      const holesCompleted = holes.filter((h) => h.locked).length;

      if (round?.format === 'wolf') {
        const wolfHoles = holes.filter(isWolfHole) as WolfHoleScore[];
        const playerPoints = group.players.map((p) => ({
          playerId: p.id,
          name: p.name,
          pts: totalWolfPoints(wolfHoles, p.id),
        }));
        const totalPts = playerPoints.reduce((s, p) => s + p.pts, 0);
        return {
          groupId: group.id,
          groupName: group.name,
          score: totalPts,
          holesCompleted,
          playerPoints,
        };
      }

      if (round?.format === 'bestBall') {
        const bbHoles = holes.filter(isBestBallHole) as BestBallHoleScore[];
        const score = bestBallTotalToPar(bbHoles, round.par);
        return { groupId: group.id, groupName: group.name, score, holesCompleted };
      }

      if (round?.format === 'scramble') {
        const sHoles = holes.filter(isScrambleHole) as ScrambleHoleScore[];
        const score = scrambleTotalToPar(sHoles, round.par);
        return { groupId: group.id, groupName: group.name, score, holesCompleted, players: group.players };
      }

      if (round?.format === 'gauntlet') {
        const gHoles = holes.filter(isGauntletHole) as GauntletHoleScore[];
        const score = gauntletTotalToPar(gHoles, round.par);
        return { groupId: group.id, groupName: group.name, score, holesCompleted, players: group.players };
      }

      return { groupId: group.id, groupName: group.name, score: 0, holesCompleted };
    });

  // Sort: Wolf → highest points first; others → lowest score-to-par first
  const sorted = [...entries].sort((a, b) => {
    if (round?.format === 'wolf') return b.score - a.score;
    return a.score - b.score;
  });

  return { entries: sorted, loading };
}
