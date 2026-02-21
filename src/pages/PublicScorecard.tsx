import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getGroupById, listRounds } from '../lib/firestore';
import { useGroup } from '../hooks/useGroup';
import type { Round, Group } from '../types/tournament';
import type { WolfHoleScore, BestBallHoleScore, ScrambleHoleScore } from '../types/scoring';
import { isWolfHole, totalWolfPoints } from '../lib/scoring/wolf';
import { isBestBallHole } from '../lib/scoring/bestBall';
import { isScrambleHole } from '../lib/scoring/scramble';
import { WolfHoleResult } from '../components/scorecard/WolfHoleResult';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

export function PublicScorecard() {
  const { roundId, groupId } = useParams<{ roundId: string; groupId: string }>();
  const navigate = useNavigate();

  const [round, setRound] = useState<Round | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);

  useEffect(() => {
    if (!roundId || !groupId) return;
    Promise.all([
      listRounds(TOURNAMENT_ID),
      getGroupById(TOURNAMENT_ID, groupId),
    ]).then(([rounds, grp]) => {
      setRound(rounds.find((r) => r.id === roundId) ?? null);
      setGroup(grp);
      setMetaLoading(false);
    });
  }, [roundId, groupId]);

  const players = group?.players ?? [];
  const { holes, loading } = useGroup(TOURNAMENT_ID, round, groupId ?? null, players);

  const wolfHoles = round?.format === 'wolf'
    ? (holes as WolfHoleScore[]).filter((h) => h.locked)
    : [];

  const runningPoints = players.map((p) => ({
    playerId: p.id,
    name: p.name,
    pts: totalWolfPoints(wolfHoles, p.id),
  }));

  const lockedHoles = holes.filter((h) => h.locked);

  if (metaLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!round || !group) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">Scorecard not found</p>
      </div>
    );
  }

  const totalGroupPts = runningPoints.reduce((s, p) => s + p.pts, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="bg-gray-900 px-4 py-4 flex items-center gap-3 border-b border-gray-700">
        <button onPointerDown={() => navigate(`/leaderboard/${roundId}`)} className="text-gray-400 text-2xl p-3 -ml-3">‹</button>
        <div className="flex-1">
          <p className="text-xs text-gray-400 uppercase tracking-wide">{round.name}</p>
          <h1 className="text-lg font-bold">{group.name}</h1>
        </div>
        {round.format === 'wolf' && (
          <div className="text-right">
            <p className="text-xs text-gray-400">Group pts</p>
            <p className="text-green-400 font-bold text-lg">{totalGroupPts}</p>
          </div>
        )}
      </header>

      {/* Wolf: per-player running totals */}
      {round.format === 'wolf' && runningPoints.length > 0 && (
        <div className="bg-gray-900 border-b border-gray-700 px-4 py-3 flex gap-4 flex-wrap">
          {runningPoints.map((p) => (
            <div key={p.playerId} className="text-center">
              <p className="text-gray-400 text-xs">{p.name.split(' ')[0]}</p>
              <p className={`font-bold ${p.pts > 0 ? 'text-green-400' : 'text-gray-500'}`}>{p.pts}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {lockedHoles.length === 0 && (
          <div className="text-center py-12">
            <p className="text-3xl mb-3">🏌️</p>
            <p className="text-gray-400">No holes locked yet.</p>
          </div>
        )}

        {holes.map((hole, i) => {
          if (!hole.locked) return null;
          const par = round.par[i] ?? 4;

          return (
            <div key={i} className="bg-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="font-bold">Hole {i + 1}</p>
                <p className="text-gray-400 text-xs">Par {par}</p>
              </div>

              {round.format === 'wolf' && isWolfHole(hole) && (
                <WolfHoleResult hole={hole as WolfHoleScore} players={players} />
              )}

              {round.format === 'bestBall' && isBestBallHole(hole) && (
                <div className="flex flex-col gap-1">
                  {(hole as BestBallHoleScore).scores.map((s) => {
                    const name = players.find((p) => p.id === s.playerId)?.name ?? s.playerId;
                    return (
                      <div key={s.playerId} className="flex justify-between">
                        <span className="text-gray-300 text-sm">{name}</span>
                        <span className="text-white text-sm font-bold">{s.gross}</span>
                      </div>
                    );
                  })}
                  <div className="mt-1 pt-1 border-t border-gray-700 flex justify-between">
                    <span className="text-gray-400 text-xs">Best</span>
                    <span className={`text-sm font-bold ${
                      (hole as BestBallHoleScore).bestScore !== null &&
                      (hole as BestBallHoleScore).bestScore! < par ? 'text-red-400' :
                      (hole as BestBallHoleScore).bestScore! === par ? 'text-white' : 'text-blue-400'
                    }`}>
                      {(hole as BestBallHoleScore).bestScore}
                    </span>
                  </div>
                </div>
              )}

              {round.format === 'scramble' && isScrambleHole(hole) && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-300 text-sm">Team score</span>
                  <span className={`font-bold ${
                    (hole as ScrambleHoleScore).teamScore !== null &&
                    (hole as ScrambleHoleScore).teamScore! < par ? 'text-red-400' :
                    (hole as ScrambleHoleScore).teamScore! === par ? 'text-white' : 'text-blue-400'
                  }`}>
                    {(hole as ScrambleHoleScore).teamScore}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
