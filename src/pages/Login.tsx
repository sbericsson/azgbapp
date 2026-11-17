import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { findTournamentByCode, getServerConfig } from '../lib/data';
import { EmailSignIn } from '../components/EmailSignIn';
import { LinkSignIn } from '../components/LinkSignIn';

function initialTournamentCode(): string {
  const urlCode = new URLSearchParams(window.location.search).get('code');
  if (urlCode) return urlCode.trim();
  try {
    const raw = localStorage.getItem('azgb_tournament');
    return raw ? String(JSON.parse(raw)) : '';
  } catch {
    return '';
  }
}

/**
 * Sign-in for organisers and scorers (R13): a link from the organiser (or
 * its code), or, when the server can send email, an emailed link. Spectators
 * can open a tournament's results by code without signing in.
 */
export function Login() {
  const [emailSignIn, setEmailSignIn] = useState(false);
  useEffect(() => {
    getServerConfig().then((c) => setEmailSignIn(c.emailSignIn)).catch(() => {});
  }, []);
  // Pre-fill from ?code= (shared links), else the last tournament on this phone
  const [tournamentCode, setTournamentCode] = useState(initialTournamentCode);
  const [found, setFound] = useState<{ code: string; id: string | null; name?: string; logoUrl?: string }>({ code: '', id: null });

  const trimmedCode = tournamentCode.trim();
  const tournament = trimmedCode && found.code === trimmedCode ? found : null;

  useEffect(() => {
    if (!trimmedCode) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      findTournamentByCode(trimmedCode)
        .then((t) => { if (!cancelled) setFound({ code: trimmedCode, id: t?.id ?? null, name: t?.name, logoUrl: t?.logoUrl }); })
        .catch(() => { if (!cancelled) setFound({ code: trimmedCode, id: null }); });
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [trimmedCode]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-white rounded-2xl p-3 shadow-lg">
            <img src={tournament?.logoUrl ?? '/azgb-logo.png'} alt="AZ Golf Bender" className="w-44 h-auto" />
          </div>
        </div>

        {tournament?.name && (
          <p className="text-white text-center text-lg font-semibold mb-4">{tournament.name}</p>
        )}

        <LinkSignIn />

        {emailSignIn && (
          <div className="mt-6 pt-6 border-t border-gray-800">
            <p className="text-gray-400 text-sm text-center mb-3">Or get a link by email:</p>
            <EmailSignIn tournamentId={tournament?.id ?? undefined} />
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-gray-800">
          <p className="text-gray-400 text-sm text-center mb-3">Just following along? Open the results by tournament code.</p>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 min-w-0 bg-gray-800 rounded-xl px-4 py-3 text-white text-center
                         placeholder-gray-600 border-2 border-gray-700 focus:border-green-500 focus:outline-none tracking-widest"
              placeholder="Tournament code"
              value={tournamentCode}
              onChange={(e) => setTournamentCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Tournament code"
            />
            <Link
              to={tournament?.id ? `/results/${tournament.id}` : '#'}
              aria-disabled={!tournament?.id}
              className={`px-4 rounded-xl font-medium flex items-center ${tournament?.id ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-600 pointer-events-none'}`}
            >
              Results
            </Link>
          </div>
          {trimmedCode && found.code === trimmedCode && !found.id && (
            <p className="text-gray-500 text-xs text-center mt-2">No tournament with that code.</p>
          )}
        </div>

        <p className="text-center mt-6 text-gray-600 text-sm">
          Running your own tournament?{' '}
          <Link to="/create" className="text-green-500 hover:text-green-400 underline">
            Create one here
          </Link>
        </p>
      </div>
    </div>
  );
}
