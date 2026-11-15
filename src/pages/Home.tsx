import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { subscribeRounds, listCourses } from '../lib/firestore';
import type { Round, Course } from '../types/tournament';

const dayOrder: Round['day'][] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayLabel: Record<Round['day'], string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const formatLabel: Record<string, string> = {
  wolf: 'Wolf',
  bestBall: 'Best Ball',
  scramble: 'Scramble',
  gauntlet: 'Gauntlet',
};

export function Home() {
  const { group, logout, tournamentId, tournament } = useContext(AuthContext);
  const navigate = useNavigate();
  const [allRounds, setAllRounds] = useState<Round[]>([]);
  const [courseMap, setCourseMap] = useState<Map<string, Course>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  // Live subscription so a round going active appears without restarting the app (B13)
  useEffect(() => {
    if (!tournamentId) return;
    return subscribeRounds(
      tournamentId,
      (next) => {
        setAllRounds(next);
        setError(false);
        setLoading(false);
      },
      () => {
        setError(true);
        setLoading(false);
      },
    );
  }, [tournamentId, retryKey]);

  useEffect(() => {
    if (!tournamentId) return;
    listCourses(tournamentId)
      .then((allCourses) => setCourseMap(new Map(allCourses.map((c) => [c.id, c]))))
      .catch(() => {});
  }, [tournamentId]);

  const rounds = allRounds.filter((r) => {
    if (r.status === 'pending') return false;
    if (r.status === 'complete') return true; // all completed rounds visible to everyone
    return !group || group.roundId === r.id;  // active: only their assigned round
  });

  const byDay = dayOrder.reduce<Record<string, Round[]>>((acc, day) => {
    const dayRounds = rounds.filter((r) => r.day === day);
    if (dayRounds.length > 0) acc[day] = dayRounds;
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 px-4 py-4 flex items-center justify-between border-b border-gray-700">
        <div className="flex items-center gap-3">
          <img src={tournament?.logoUrl || '/azgb-logo.png'} alt="AZGB" className="h-10 w-auto bg-white rounded-lg p-0.5" />
          {group && <p className="text-green-400 text-sm font-medium">{group.name}</p>}
        </div>
        <button onClick={logout} className="text-gray-400 text-sm">
          Logout
        </button>
      </header>

      <div className="p-4 max-w-lg mx-auto">
        {loading && (
          <p className="text-gray-400 text-center py-8">Loading rounds…</p>
        )}

        {!loading && error && (
          <div className="text-center py-12">
            <p className="text-gray-300">Couldn’t load rounds.</p>
            <button
              onClick={() => { setLoading(true); setRetryKey((k) => k + 1); }}
              className="mt-4 px-5 h-12 rounded-xl bg-gray-700 text-white font-medium"
            >
              Try again
            </button>
          </div>
        )}

        {!loading && !error && rounds.length === 0 && (
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
              {dayRounds.map((round) => {
                const course = round.courseId ? courseMap.get(round.courseId) : undefined;
                return (
                <button
                  key={round.id}
                  onClick={() => navigate(
                    round.status === 'complete'
                      ? `/leaderboard/${round.id}`
                      : `/scorecard/${round.id}`
                  )}
                  className="w-full bg-gray-800 rounded-2xl px-4 py-4 text-left flex items-center justify-between hover:bg-gray-700 active:bg-gray-700 transition-colors"
                >
                  <div>
                    <p className="text-white font-semibold">{round.name}</p>
                    <p className="text-gray-400 text-sm">
                      {formatLabel[round.format]} · {round.holes} holes
                      {course ? ` · ${course.name}` : ''}
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
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
