import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { listRounds, subscribeGroupsByRound, getCourse } from '../lib/firestore';
import { useLeaderboard } from '../hooks/useLeaderboard';
import type { Round, Group } from '../types/tournament';
import { WolfLeaderboard } from '../components/leaderboard/WolfLeaderboard';
import { TeamLeaderboard } from '../components/leaderboard/TeamLeaderboard';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

export function Leaderboard() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const { group } = useContext(AuthContext);

  const [round, setRound] = useState<Round | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [courseName, setCourseName] = useState<string | undefined>();

  // Load round once
  useEffect(() => {
    if (!roundId) return;
    listRounds(TOURNAMENT_ID).then((all) => {
      const r = all.find((r) => r.id === roundId) ?? null;
      setRound(r);
      if (r?.courseId) {
        getCourse(TOURNAMENT_ID, r.courseId).then((c) => setCourseName(c?.name));
      }
    });
  }, [roundId]);

  // Subscribe to groups for real-time name updates
  useEffect(() => {
    if (!roundId) return;
    return subscribeGroupsByRound(TOURNAMENT_ID, roundId, setGroups);
  }, [roundId]);

  const { entries, loading } = useLeaderboard(TOURNAMENT_ID, round, groups);

  const handleGroupClick = (groupId: string) => {
    if (roundId) navigate(`/scorecard/${roundId}/${groupId}`);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      <header className="bg-gray-900 px-4 py-4 flex items-center gap-3 border-b border-gray-700">
        <button onPointerDown={() => navigate(-1)} className="text-gray-400 text-xl">‹</button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">Leaderboard</h1>
          {round && (
            <p className="text-gray-400 text-sm">
              {round.name}{courseName ? ` · ${courseName}` : ''}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-400">Live</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <p className="text-gray-400 text-center py-8">Loading scores…</p>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">📊</p>
            <p className="text-gray-400">No scores yet.</p>
          </div>
        )}

        {!loading && entries.length > 0 && (
          <p className="text-gray-500 text-xs mb-3">Tap a group to view their scorecard</p>
        )}

        {!loading && round?.format === 'wolf' && (
          <WolfLeaderboard entries={entries} onGroupClick={handleGroupClick} />
        )}
        {!loading && round?.format === 'bestBall' && (
          <TeamLeaderboard entries={entries} format="bestBall" onGroupClick={handleGroupClick} />
        )}
        {!loading && round?.format === 'scramble' && (
          <TeamLeaderboard entries={entries} format="scramble" onGroupClick={handleGroupClick} />
        )}

        {/* Wolf format also shows per-player totals across groups */}
        {!loading && round?.format === 'wolf' && entries.length > 0 && (
          <div className="mt-6">
            <p className="text-gray-400 text-xs uppercase tracking-widest mb-3">Individual Points</p>
            <div className="flex flex-col gap-2">
              {entries.flatMap((e) =>
                (e.playerPoints ?? []).map((pp) => ({
                  ...pp,
                  groupName: e.groupName,
                })),
              )
              .sort((a, b) => b.pts - a.pts)
              .map((pp, i) => (
                <div key={`${pp.playerId}-${i}`} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3">
                  <div>
                    <p className="text-white text-sm font-medium">{pp.name}</p>
                    <p className="text-gray-500 text-xs">{pp.groupName}</p>
                  </div>
                  <span className="text-green-400 font-bold">{pp.pts} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="bg-gray-900 border-t border-gray-700 p-4 pb-safe">
        {roundId && group && (
          <button
            onPointerDown={() => navigate(`/scorecard/${roundId}`)}
            className="w-full h-14 rounded-xl bg-green-700 text-white font-bold"
          >
            Back to Scorecard
          </button>
        )}
      </div>
    </div>
  );
}
