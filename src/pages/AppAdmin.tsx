import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import {
  listTournaments,
  createTournament,
  deleteTournament,
  getTournament,
} from '../lib/firestore';
import type { Tournament } from '../types/tournament';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AppAdmin() {
  const { logout, enterTournamentAsAdmin } = useContext(AuthContext);
  const navigate = useNavigate();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newAdminPin, setNewAdminPin] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  // Archive confirmation
  const [pendingArchive, setPendingArchive] = useState<Tournament | null>(null);
  const [archiving, setArchiving] = useState(false);

  useEffect(() => {
    listTournaments()
      .then((ts) => setTournaments(ts.sort((a, b) => b.createdAt - a.createdAt)))
      .finally(() => setLoadingList(false));
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    const code = newCode.trim().toLowerCase();
    const pin = newAdminPin.trim();

    if (!name || !code || !pin) {
      setCreateError('All fields are required.');
      return;
    }
    if (!/^\d{4,}$/.test(pin)) {
      setCreateError('Admin PIN must be 4 or more digits.');
      return;
    }

    setCreateSaving(true);
    setCreateError('');
    try {
      const existing = await getTournament(code);
      if (existing) {
        setCreateError('Tournament code is already in use.');
        return;
      }
      const createdAt = Date.now();
      await createTournament(code, { name, adminPin: pin, createdAt });
      setTournaments((prev) => [{ id: code, name, adminPin: pin, createdAt }, ...prev]);
      setNewName('');
      setNewCode('');
      setNewAdminPin('');
      setShowCreate(false);
    } finally {
      setCreateSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await deleteTournament(pendingArchive.id);
      setTournaments((prev) => prev.filter((t) => t.id !== pendingArchive.id));
      setPendingArchive(null);
    } finally {
      setArchiving(false);
    }
  };

  const handleEnterAdmin = async (t: Tournament) => {
    await enterTournamentAsAdmin(t.id);
    navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white">App Admin</h1>
        <button
          onClick={logout}
          className="text-sm text-gray-400 active:text-white"
        >
          Log out
        </button>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">
        {/* Create button */}
        <button
          onClick={() => { setShowCreate((v) => !v); setCreateError(''); }}
          className="w-full py-3 rounded-xl bg-green-700 text-white font-semibold text-sm active:bg-green-600"
        >
          {showCreate ? 'Cancel' : '+ New Tournament'}
        </button>

        {/* Create form */}
        {showCreate && (
          <div className="bg-gray-900 rounded-2xl p-4 space-y-3 border border-gray-700">
            <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
              Create Tournament
            </h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tournament Name</label>
              <input
                type="text"
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm
                           border border-gray-700 focus:border-green-500 focus:outline-none"
                placeholder="e.g. Bandon Dunes 2026"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Tournament Code <span className="text-gray-600">(becomes login code, lowercase)</span>
              </label>
              <input
                type="text"
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm
                           border border-gray-700 focus:border-green-500 focus:outline-none
                           tracking-widest"
                placeholder="e.g. bandon2026"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toLowerCase())}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tournament Admin PIN</label>
              <input
                type="text"
                inputMode="numeric"
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm
                           border border-gray-700 focus:border-green-500 focus:outline-none
                           tracking-widest"
                placeholder="4+ digits"
                value={newAdminPin}
                onChange={(e) => setNewAdminPin(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {createError && (
              <p className="text-red-400 text-xs">{createError}</p>
            )}
            <button
              onClick={handleCreate}
              disabled={createSaving}
              className="w-full py-2.5 rounded-xl bg-green-700 text-white font-semibold text-sm
                         active:bg-green-600 disabled:opacity-40"
            >
              {createSaving ? 'Creating…' : 'Create Tournament'}
            </button>
          </div>
        )}

        {/* Tournament list */}
        {loadingList ? (
          <p className="text-center text-gray-500 text-sm py-8">Loading…</p>
        ) : tournaments.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">No tournaments yet.</p>
        ) : (
          <div className="space-y-3">
            {tournaments.map((t) => (
              <div
                key={t.id}
                className="bg-gray-900 rounded-2xl p-4 border border-gray-800"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-white">{t.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono">{t.id}</p>
                  </div>
                  <span className="text-xs text-gray-600 shrink-0">{fmtDate(t.createdAt)}</span>
                </div>
                <div className="text-xs text-gray-500 mb-3">
                  Admin PIN: <span className="text-gray-400 font-mono">{t.adminPin}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEnterAdmin(t)}
                    className="flex-1 py-2 rounded-xl bg-blue-700 text-white text-sm font-medium
                               active:bg-blue-600"
                  >
                    Enter as Admin
                  </button>
                  <button
                    onClick={() => setPendingArchive(t)}
                    className="px-4 py-2 rounded-xl bg-gray-800 text-gray-400 text-sm
                               active:bg-gray-700"
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Archive confirmation modal */}
      {pendingArchive && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-6 z-50">
          <div className="bg-gray-900 rounded-2xl p-6 w-full max-w-sm border border-gray-700">
            <h2 className="text-white font-semibold mb-2">Archive Tournament?</h2>
            <p className="text-gray-400 text-sm mb-1">
              <span className="text-white">{pendingArchive.name}</span> will be removed from
              the list and no one will be able to log in with code{' '}
              <span className="font-mono text-gray-300">{pendingArchive.id}</span>.
            </p>
            <p className="text-gray-600 text-xs mb-5">
              Score data remains in Firestore but will be inaccessible through the app.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingArchive(null)}
                className="flex-1 py-2.5 rounded-xl bg-gray-800 text-white text-sm active:bg-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="flex-1 py-2.5 rounded-xl bg-red-700 text-white text-sm font-semibold
                           active:bg-red-600 disabled:opacity-40"
              >
                {archiving ? 'Archiving…' : 'Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
