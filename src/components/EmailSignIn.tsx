import { useState, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { requestSignIn, verifySignInCode } from '../lib/data';

const LAST_EMAIL_KEY = 'azgb_last_email';

function lastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL_KEY) ?? '';
  } catch {
    return '';
  }
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.status === 0 ? 'No connection. Try again when you have signal.' : err.message;
  return 'Something went wrong. Try again.';
}

/**
 * Email sign-in (R13): request a link, then either tap it or type the 6-digit
 * code from the same email. The code is what makes it work inside the iPhone
 * home-screen app, which does not share Safari's sign-in.
 */
export function EmailSignIn({ purpose = 'signin', tournamentId, onSignedIn }: {
  purpose?: 'signin' | 'create';
  tournamentId?: string;
  onSignedIn?: () => void;
}) {
  const { completeSignIn } = useContext(AuthContext);
  const [email, setEmail] = useState(lastEmail);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      await requestSignIn(email.trim(), { purpose, tournamentId });
      try { localStorage.setItem(LAST_EMAIL_KEY, email.trim()); } catch { /* ignore */ }
      setStep('code');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value = code) => {
    setError('');
    setBusy(true);
    try {
      const me = await verifySignInCode(email.trim(), value);
      await completeSignIn({ ...me, tournamentId: me.tournamentId ?? tournamentId ?? null });
      onSignedIn?.();
    } catch (err) {
      setError(messageFor(err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'code') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-gray-300 text-sm text-center">
          {purpose === 'create'
            ? <>We emailed a sign-in link to <span className="text-white font-medium">{email.trim()}</span>.</>
            : <>If <span className="text-white font-medium">{email.trim()}</span> is set up by an organiser, a sign-in link is on its way.</>}
          {' '}Tap the link, or enter the 6-digit code from the email here.
        </p>
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.5em]
                     placeholder-gray-600 border-2 border-gray-700 focus:border-green-500 focus:outline-none"
          placeholder="••••••"
          value={code}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCode(v);
            setError('');
            if (v.length === 6) void verify(v);
          }}
          aria-label="Sign-in code"
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <button
          onClick={() => verify()}
          disabled={busy || code.length !== 6}
          className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-bold disabled:opacity-40"
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
        <div className="flex justify-between text-sm">
          <button onClick={() => { setStep('email'); setCode(''); setError(''); }} className="text-gray-400">
            ← Different email
          </button>
          <button onClick={() => send()} disabled={busy} className="text-green-500 disabled:opacity-40">
            Send again
          </button>
        </div>
        <p className="text-gray-500 text-xs text-center">Nothing after a minute? Check your spam folder.</p>
      </div>
    );
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-lg placeholder-gray-600
                   border-2 border-gray-700 focus:border-green-500 focus:outline-none"
        placeholder="Your email"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(''); }}
        aria-label="Email"
      />
      {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      <button
        type="submit"
        disabled={busy || !email.includes('@')}
        className="w-full h-14 rounded-2xl bg-green-600 text-white text-lg font-bold disabled:opacity-40"
      >
        {busy ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}
