import { useState } from 'react';
import { createTournament, getTournament } from '../lib/firestore';
import { generateTournamentCode } from '../lib/nanoid';

type Step = 'form' | 'success';

export function CreateTournament() {
  const [step, setStep] = useState<Step>('form');
  const [tournamentCode, setTournamentCode] = useState('');
  const [codeCopied, setCodeCopied] = useState(false);
  const [pinCopied, setPinCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [adminPin, setAdminPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Tournament name is required.');
      return;
    }
    if (!/^\d{4}$/.test(adminPin)) {
      setError('Admin PIN must be exactly 4 digits.');
      return;
    }

    setSubmitting(true);
    try {
      // Generate a code and check for collision (astronomically rare at 380B combos,
      // but we check once to be safe — not a security gate)
      let code = generateTournamentCode();
      const existing = await getTournament(code);
      if (existing) {
        code = generateTournamentCode();
      }

      await createTournament(code, {
        name: trimmedName,
        adminPin,
        createdAt: Date.now(),
        selfService: true,
      });

      setTournamentCode(code);
      setStep('success');
    } catch (err) {
      setError('Failed to create tournament. Please try again.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm flex flex-col gap-6">
          <div className="text-center">
            <div className="text-green-400 text-4xl mb-3">✓</div>
            <h1 className="text-white text-2xl font-bold">Tournament created!</h1>
            <p className="text-gray-400 text-sm mt-1">Save these now — there's no way to recover them.</p>
          </div>

          {/* Tournament Code */}
          <div className="bg-gray-800 rounded-2xl p-5 flex flex-col gap-2">
            <p className="text-gray-400 text-xs uppercase tracking-widest">Tournament Code</p>
            <p className="text-white text-4xl font-bold tracking-widest font-mono">{tournamentCode}</p>
            <p className="text-gray-500 text-xs">Share this link: {window.location.host}/?code={tournamentCode}</p>
            <button
              onClick={() => copyToClipboard(tournamentCode, setCodeCopied)}
              className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2 rounded-xl transition-colors"
            >
              {codeCopied ? 'Copied!' : 'Copy Code'}
            </button>
          </div>

          {/* Admin PIN */}
          <div className="bg-gray-800 rounded-2xl p-5 flex flex-col gap-2">
            <p className="text-gray-400 text-xs uppercase tracking-widest">Your Admin PIN</p>
            <p className="text-white text-4xl font-bold tracking-widest font-mono">{adminPin}</p>
            <p className="text-gray-500 text-xs">You'll need this to manage your tournament.</p>
            <button
              onClick={() => copyToClipboard(adminPin, setPinCopied)}
              className="mt-2 w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2 rounded-xl transition-colors"
            >
              {pinCopied ? 'Copied!' : 'Copy PIN'}
            </button>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
              className="mt-0.5 w-5 h-5 rounded accent-green-500 cursor-pointer"
            />
            <span className="text-gray-300 text-sm">I've saved my tournament code and admin PIN somewhere safe.</span>
          </label>

          <button
            disabled={!savedConfirmed}
            onClick={() => {
              // Write a valid admin session so useAuth restores it on /admin load
              localStorage.setItem(
                'azgb_session',
                JSON.stringify({
                  tournamentId: tournamentCode,
                  groupId: null,
                  isAdmin: true,
                  isAppAdmin: false,
                  loginAt: Date.now(),
                }),
              );
              window.location.replace('/admin');
            }}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl transition-colors text-lg"
          >
            Set Up My Tournament →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">
        {/* Header */}
        <div className="text-center">
          <div className="bg-white rounded-2xl p-3 shadow-lg inline-block mb-4">
            <img src="/azgb-logo.png" alt="Golf Bender" className="w-32 h-auto" />
          </div>
          <h1 className="text-white text-2xl font-bold">Create a Tournament</h1>
          <p className="text-gray-400 text-sm mt-1">Set up your group in 2 minutes. No account needed.</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-gray-400 text-sm font-medium" htmlFor="tourney-name">
              Tournament Name
            </label>
            <input
              id="tourney-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Scottsdale Invitational 2026"
              maxLength={60}
              className="bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-gray-400 text-sm font-medium" htmlFor="admin-pin">
              Your Admin PIN (4 digits)
            </label>
            <input
              id="admin-pin"
              type="tel"
              inputMode="numeric"
              value={adminPin}
              onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="e.g. 4827"
              className="bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500 tracking-widest font-mono"
            />
            <p className="text-gray-600 text-xs">You choose this. Write it down — there's no recovery if you lose it.</p>
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-xl px-4 py-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl transition-colors text-lg mt-2"
          >
            {submitting ? 'Creating…' : 'Create Tournament'}
          </button>
        </form>

        <p className="text-gray-600 text-xs text-center">
          Already have a tournament?{' '}
          <a href="/" className="text-gray-400 underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}
