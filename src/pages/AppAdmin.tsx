import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import {
  listTournaments,
  createTournament,
  setTournamentArchived,
  getTournament,
} from '../lib/data';
import type { Tournament } from '../types/tournament';
import { importTournament, parseBackup } from '../lib/data';

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AppAdmin() {
  const { logout, selectTournament, email } = useContext(AuthContext);
  const navigate = useNavigate();

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newOrganiser, setNewOrganiser] = useState('');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  // Archive confirmation
  const [pendingArchive, setPendingArchive] = useState<Tournament | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState('');
  const restoreInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listTournaments()
      .then((ts) => setTournaments(ts.sort((a, b) => b.createdAt - a.createdAt)))
      .finally(() => setLoadingList(false));
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    const organiser = newOrganiser.trim();
    if (!name) {
      setCreateError('Tournament name is required.');
      return;
    }
    setCreateSaving(true);
    setCreateError('');
    try {
      // The server picks the code. The organiser signs in with their email;
      // left blank, you are the organiser.
      const created = await createTournament(name, organiser ? [organiser] : undefined);
      const full = await getTournament(created.id);
      setTournaments((prev) => [full ?? created, ...prev]);
      setNewName('');
      setNewOrganiser('');
      setShowCreate(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not create the tournament.');
    } finally {
      setCreateSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!pendingArchive) return;
    setArchiving(true);
    try {
      await setTournamentArchived(pendingArchive.id, true);
      const archivedAt = Date.now();
      setTournaments((prev) => prev.map((t) => (t.id === pendingArchive.id ? { ...t, archivedAt } : t)));
      setPendingArchive(null);
    } finally {
      setArchiving(false);
    }
  };

  const handleRestore = async (t: Tournament) => {
    await setTournamentArchived(t.id, false);
    setTournaments((prev) => prev.map((x) => (x.id === t.id ? { ...x, archivedAt: undefined } : x)));
  };

  const handleRestoreFile = async (file: File) => {
    setRestoreMsg('');
    try {
      const backup = parseBackup(JSON.parse(await file.text()));
      const target = window.prompt(
        'Restore into which tournament code? It must not already exist.',
        backup.tournamentId,
      );
      if (!target) return;
      const code = target.trim();
      await importTournament(backup, code);
      const restored = await getTournament(code);
      if (restored) setTournaments((prev) => [restored, ...prev.filter((t) => t.id !== code)]);
      setRestoreMsg(`Restored "${String(backup.tournament.name ?? code)}" as ${code}.`);
    } catch (err) {
      setRestoreMsg(err instanceof Error ? err.message : 'Restore failed.');
    }
  };

  const activeTournaments = tournaments.filter((t) => !t.archivedAt);
  const archivedTournaments = tournaments.filter((t) => t.archivedAt);

  const handleEnterAdmin = async (t: Tournament) => {
    if (await selectTournament(t.id)) navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-white">App Admin</h1>
          <p className="text-xs text-gray-500">{email}</p>
        </div>
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

        <button
          onClick={() => restoreInputRef.current?.click()}
          className="w-full py-2.5 rounded-xl bg-gray-800 text-gray-300 text-sm active:bg-gray-700"
        >
          Restore from backup…
        </button>
        <input
          ref={restoreInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleRestoreFile(file);
            e.target.value = '';
          }}
        />
        {restoreMsg && <p className="text-xs text-gray-400 text-center">{restoreMsg}</p>}

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
                Organiser email <span className="text-gray-600">(blank: you)</span>
              </label>
              <input
                type="email"
                className="w-full bg-gray-800 rounded-lg px-3 py-2 text-white text-sm
                           border border-gray-700 focus:border-green-500 focus:outline-none"
                placeholder="organiser@example.com"
                value={newOrganiser}
                onChange={(e) => setNewOrganiser(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className="text-xs text-gray-600 mt-1">They sign in at the app with this email. The code is generated.</p>
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
        ) : activeTournaments.length === 0 ? (
          <p className="text-center text-gray-500 text-sm py-8">No tournaments yet.</p>
        ) : (
          <div className="space-y-3">
            {activeTournaments.map((t) => (
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
                <div className="text-xs text-gray-500 mb-3 break-all">
                  Organisers: <span className="text-gray-400">{t.admins?.length ? t.admins.join(', ') : 'none'}</span>
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

        {archivedTournaments.length > 0 && (
          <div className="pt-2">
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="text-xs text-gray-500 active:text-gray-300"
            >
              {showArchived ? 'Hide' : 'Show'} archived ({archivedTournaments.length})
            </button>
            {showArchived && (
              <div className="space-y-2 mt-3">
                {archivedTournaments.map((t) => (
                  <div key={t.id} className="bg-gray-900/60 rounded-xl px-4 py-3 border border-gray-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-gray-300 text-sm truncate">{t.name}</p>
                      <p className="text-xs text-gray-600 font-mono">{t.id}</p>
                    </div>
                    <button
                      onClick={() => handleRestore(t)}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 text-xs active:bg-gray-700"
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              Nothing is deleted. You can restore it from the archived list.
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
