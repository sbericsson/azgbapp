import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { listRounds } from '../lib/firestore';
import type { Round } from '../types/tournament';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

const dayOrder: Round['day'][] = ['friday', 'saturday_am', 'saturday_pm', 'sunday'];
const dayLabel: Record<Round['day'], string> = {
  friday: 'Friday',
  saturday_am: 'Saturday AM',
  saturday_pm: 'Saturday PM',
  sunday: 'Sunday',
};

const formatLabel: Record<string, string> = {
  wolf: 'Wolf',
  bestBall: 'Best Ball',
  scramble: 'Scramble',
};

export function Home() {
  const { group, tournament, logout } = useContext(AuthContext);
  const navigate = useNavigate();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRounds(TOURNAMENT_ID)
      .then((all) => {
        // Only show rounds this group is in, that are active
        const myRounds = all.filter(
          (r) =>
            r.status !== 'pending' &&
            (!group || r.groupIds.includes(group.id)),
        );
        setRounds(myRounds);
      })
      .finally(() => setLoading(false));
  }, [group?.id]);

  const byDay = dayOrder.reduce<Record<string, Round[]>>((acc, day) => {
    const dayRounds = rounds.filter((r) => r.day === day);
    if (dayRounds.length > 0) acc[day] = dayRounds;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 px-4 py-4 flex items-center justify-between border-b border-gray-700">
        <div>
          <h1 className="text-xl font-bold">⛳ {tournament?.name ?? 'AZGB'}</h1>
          {group && <p className="text-green-400 text-sm font-medium">{group.name}</p>}
        </div>
        <button onPointerDown={logout} className="text-gray-400 text-sm">
          Logout
        </button>
      </header>

      <div className="p-4 max-w-lg mx-auto">
        {loading && (
          <p className="text-gray-400 text-center py-8">Loading rounds…</p>
        )}

        {!loading && rounds.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🏌️</p>
            <p className="text-gray-400">No active rounds yet.</p>
            <p className="text-gray-500 text-sm mt-1">Check back when the commissioner starts a round.</p>
          </div>
        )}

        {Object.entries(byDay).map(([day, dayRounds]) => (
          <div key={day} className="mb-6">
            <p className="text-gray-400 text-xs uppercase tracking-widest mb-2 px-1">
              {dayLabel[day as Round['day']]}
            </p>
            <div className="flex flex-col gap-2">
              {dayRounds.map((round) => (
                <button
                  key={round.id}
                  onPointerDown={() => navigate(`/scorecard/${round.id}`)}
                  className="w-full bg-gray-800 rounded-2xl px-4 py-4 text-left flex items-center justify-between hover:bg-gray-700 active:bg-gray-700 transition-colors"
                >
                  <div>
                    <p className="text-white font-semibold">{round.name}</p>
                    <p className="text-gray-400 text-sm">
                      {formatLabel[round.format]} · {round.holes} holes
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {round.status === 'active' && (
                      <span className="text-xs bg-green-900 text-green-300 px-2 py-1 rounded-full font-medium">
                        Live
                      </span>
                    )}
                    {round.status === 'complete' && (
                      <span className="text-xs bg-gray-700 text-gray-400 px-2 py-1 rounded-full font-medium">
                        Complete
                      </span>
                    )}
                    <span className="text-gray-500">›</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
