import { useState, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { verifySignInCode, verifySignInToken } from '../lib/data';

/**
 * Finish signing in with a link that opened somewhere else: paste the link or
 * type its code. Needed in the iPhone home-screen app, which a link tapped in
 * Messages or Mail does not open.
 */
export function LinkSignIn({ onSignedIn, compact = false }: { onSignedIn?: () => void; compact?: boolean }) {
  const { completeSignIn } = useContext(AuthContext);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const input = value.trim();
    if (!input) return;
    setBusy(true);
    setError('');
    try {
      const token = input.includes('token=') ? new URL(input, window.location.origin).searchParams.get('token') : null;
      const me = token ? await verifySignInToken(token) : await verifySignInCode(null, input);
      await completeSignIn(me);
      onSignedIn?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0
        ? 'No connection. Try again when you have signal.'
        : 'That link or code did not work. It may have expired: ask your organiser for a new one.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      {!compact && (
        <p className="text-gray-400 text-sm text-center">
          Got a sign-in link from your organiser? Tap it. If this app is on your home screen, paste the link or type its code here.
        </p>
      )}
      <input
        className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-center text-lg placeholder-gray-600
                   border-2 border-gray-700 focus:border-green-500 focus:outline-none tracking-wider"
        placeholder="Link or code (ABCD-EFGH)"
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(''); }}
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Sign-in link or code"
      />
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <button
        type="submit"
        disabled={busy || value.trim().length < 8}
        className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-bold disabled:opacity-40"
      >
        {busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}
