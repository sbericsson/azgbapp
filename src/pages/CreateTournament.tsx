import { useState, useContext, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { createTournament, getServerConfig } from '../lib/data';
import { EmailSignIn } from '../components/EmailSignIn';
import { LinkSignIn } from '../components/LinkSignIn';

/**
 * Self-service tournament creation. You sign in with your email first and
 * become the tournament's organiser, so there is no admin PIN to lose (R13).
 */
export function CreateTournament() {
  const { email, loading, refreshMe, selectTournament } = useContext(AuthContext);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [emailSignIn, setEmailSignIn] = useState<boolean | null>(null);

  useEffect(() => {
    getServerConfig().then((c) => setEmailSignIn(c.emailSignIn)).catch(() => setEmailSignIn(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Tournament name is required.');
      return;
    }
    setSubmitting(true);
    try {
      const t = await createTournament(trimmedName);
      await refreshMe();
      await selectTournament(t.id);
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.status !== 0 ? err.message : 'Could not create the tournament. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="text-center">
          <h1 className="text-white text-2xl font-bold">Create a tournament</h1>
          <p className="text-gray-400 text-sm mt-1">
            {email
              ? <>You'll be the organiser as <span className="text-gray-200">{email}</span>.</>
              : emailSignIn
                ? 'First, sign in with your email. You will manage the tournament with it.'
                : 'Organisers sign in with a link from the app admin. Open yours, or paste it or its code here.'}
          </p>
        </div>

        {loading ? (
          <p className="text-gray-400 text-center">Loading…</p>
        ) : !email ? (
          emailSignIn ? <EmailSignIn purpose="create" /> : emailSignIn === false ? <LinkSignIn compact /> : null
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <input
              className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-lg placeholder-gray-600 border-2 border-gray-700 focus:border-green-500 focus:outline-none"
              placeholder="Tournament name (e.g. Spring Classic)"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              maxLength={100}
              autoFocus
            />
            {error && <p className="text-red-400 text-sm text-center">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl text-lg"
            >
              {submitting ? 'Creating…' : 'Create & set up →'}
            </button>
            <p className="text-gray-500 text-xs text-center">
              You'll get a tournament code to share. Add rounds and groups next, then send each group's scorer a sign-in link.
            </p>
          </form>
        )}

        <Link to="/" className="text-gray-500 text-sm text-center">← Back</Link>
      </div>
    </div>
  );
}
