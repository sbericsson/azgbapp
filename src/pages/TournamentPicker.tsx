import { useEffect, useContext, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { getTournament } from '../lib/data';
import type { Tournament } from '../types/tournament';

/** Shown when a signed-in person has several tournaments and none is open. */
export function TournamentPicker() {
  const { email, myTournamentIds, selectTournament, logout, me } = useContext(AuthContext);
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(myTournamentIds.map((id) => getTournament(id).catch(() => null)))
      .then((list) => {
        if (!cancelled) setTournaments(list.filter((t): t is Tournament => !!t && !t.archivedAt).sort((a, b) => b.createdAt - a.createdAt));
      });
    return () => { cancelled = true; };
  }, [myTournamentIds]);

  const roleOf = (id: string) => (me?.admin.includes(id) ? 'Organiser' : 'Scorer');

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 px-4 py-4 flex items-center justify-between border-b border-gray-700">
        <div>
          <h1 className="font-bold">Your tournaments</h1>
          {email && <p className="text-gray-400 text-xs">{email}</p>}
        </div>
        <button onClick={logout} className="text-gray-400 text-sm">Logout</button>
      </header>
      <div className="p-4 max-w-lg mx-auto flex flex-col gap-2">
        {tournaments === null && <p className="text-gray-400 text-center py-8">Loading…</p>}
        {tournaments?.length === 0 && (
          <div className="text-center py-10">
            <p className="text-gray-300">You're not set up for any tournament yet.</p>
            <p className="text-gray-500 text-sm mt-2">Ask your organiser for your group's sign-in link.</p>
          </div>
        )}
        {tournaments?.map((t) => (
          <button
            key={t.id}
            onClick={() => selectTournament(t.id)}
            className="w-full bg-gray-800 rounded-2xl px-4 py-4 text-left flex items-center justify-between active:bg-gray-700"
          >
            <div>
              <p className="font-semibold">{t.name}</p>
              <p className="text-gray-400 text-sm">{t.id} · {roleOf(t.id)}</p>
            </div>
            <span className="text-gray-500">›</span>
          </button>
        ))}
        <Link to="/create" className="text-green-500 text-sm text-center mt-6">+ Create a tournament</Link>
      </div>
    </div>
  );
}
