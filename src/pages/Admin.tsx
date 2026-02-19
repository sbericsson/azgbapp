import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import {
  createGroup,
  deleteGroup,
  listGroupsByRound,
  createRound,
  listRounds,
  deleteRound,
  updateRound,
} from '../lib/firestore';
import type { Group, Round, RoundFormat, Player } from '../types/tournament';
import { DEFAULT_PAR } from '../constants/wolf';
import { nanoid } from '../lib/nanoid';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

export function Admin() {
  const { tournament, logout } = useContext(AuthContext);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [groupsByRound, setGroupsByRound] = useState<Record<string, Group[]>>({});
  const [expandedRound, setExpandedRound] = useState<string | null>(null);
  const [addingGroupToRound, setAddingGroupToRound] = useState<string | null>(null);

  // Round form
  const [rName, setRName] = useState('');
  const [rDay, setRDay] = useState<Round['day']>('friday');
  const [rFormat, setRFormat] = useState<RoundFormat>('wolf');
  const [rHoles, setRHoles] = useState(18);
  const [rSaving, setRSaving] = useState(false);

  // Inline pairing form state (one at a time)
  const [gName, setGName] = useState('');
  const [gPin, setGPin] = useState('');
  const [gPlayers, setGPlayers] = useState(['', '', '', '']);
  const [gSaving, setGSaving] = useState(false);

  useEffect(() => {
    listRounds(TOURNAMENT_ID).then(setRounds);
  }, []);

  const toggleExpand = async (roundId: string) => {
    if (expandedRound === roundId) {
      setExpandedRound(null);
      setAddingGroupToRound(null);
      return;
    }
    setExpandedRound(roundId);
    setAddingGroupToRound(null);
    if (!groupsByRound[roundId]) {
      const grps = await listGroupsByRound(TOURNAMENT_ID, roundId);
      setGroupsByRound((prev) => ({ ...prev, [roundId]: grps }));
    }
  };

  const openAddPairing = (roundId: string) => {
    setAddingGroupToRound(roundId);
    setGName('');
    setGPin('');
    setGPlayers(['', '', '', '']);
  };

  const cancelAddPairing = () => {
    setAddingGroupToRound(null);
  };

  const savePairing = async (roundId: string) => {
    if (!gName.trim() || !gPin.trim()) return;
    setGSaving(true);
    const players: Player[] = gPlayers
      .filter((n) => n.trim())
      .map((name) => ({ id: nanoid(), name: name.trim() }));
    const id = nanoid();
    await createGroup(TOURNAMENT_ID, id, {
      name: gName.trim(),
      pin: gPin.trim(),
      players,
      roundId,
    });
    const newGroup: Group = { id, name: gName.trim(), pin: gPin.trim(), players, roundId };
    setGroupsByRound((prev) => ({
      ...prev,
      [roundId]: [...(prev[roundId] ?? []), newGroup],
    }));
    setAddingGroupToRound(null);
    setGSaving(false);
  };

  const removeGroup = async (roundId: string, groupId: string) => {
    await deleteGroup(TOURNAMENT_ID, groupId);
    setGroupsByRound((prev) => ({
      ...prev,
      [roundId]: (prev[roundId] ?? []).filter((g) => g.id !== groupId),
    }));
  };

  const saveRound = async () => {
    if (!rName.trim()) return;
    setRSaving(true);
    const id = nanoid();
    const par = DEFAULT_PAR.slice(0, rHoles) as number[];
    const round: Round = {
      id,
      name: rName.trim(),
      day: rDay,
      format: rFormat,
      status: 'pending',
      holes: rHoles,
      par,
    };
    await createRound(TOURNAMENT_ID, id, {
      name: round.name,
      day: round.day,
      format: round.format,
      status: round.status,
      holes: round.holes,
      par: round.par,
    });
    setRounds((rs) => [...rs, round]);
    setGroupsByRound((prev) => ({ ...prev, [id]: [] }));
    setExpandedRound(id);
    setRName('');
    setRSaving(false);
  };

  const removeRound = async (id: string) => {
    await deleteRound(TOURNAMENT_ID, id);
    setRounds((rs) => rs.filter((r) => r.id !== id));
    if (expandedRound === id) setExpandedRound(null);
  };

  const toggleRoundStatus = async (round: Round) => {
    const next =
      round.status === 'pending'
        ? 'active'
        : round.status === 'active'
          ? 'complete'
          : 'pending';
    await updateRound(TOURNAMENT_ID, round.id, { status: next });
    setRounds((rs) => rs.map((r) => (r.id === round.id ? { ...r, status: next } : r)));
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 px-4 py-4 flex items-center justify-between border-b border-gray-700">
        <div>
          <h1 className="text-xl font-bold">Admin</h1>
          <p className="text-gray-400 text-sm">{tournament?.name}</p>
        </div>
        <button onPointerDown={logout} className="text-red-400 text-sm font-medium">
          Logout
        </button>
      </header>

      <div className="p-4 max-w-lg mx-auto flex flex-col gap-4">
        {/* Add round form */}
        <div className="bg-gray-800 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="font-bold text-lg">Add Round</h2>
          <input
            className="bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500"
            placeholder="Round name (e.g. Friday Round 1)"
            value={rName}
            onChange={(e) => setRName(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              className="bg-gray-700 rounded-xl px-3 py-3 text-white"
              value={rDay}
              onChange={(e) => setRDay(e.target.value as Round['day'])}
            >
              <option value="friday">Friday</option>
              <option value="saturday_am">Saturday AM</option>
              <option value="saturday_pm">Saturday PM</option>
              <option value="sunday">Sunday</option>
            </select>
            <select
              className="bg-gray-700 rounded-xl px-3 py-3 text-white"
              value={rFormat}
              onChange={(e) => setRFormat(e.target.value as RoundFormat)}
            >
              <option value="wolf">Wolf</option>
              <option value="bestBall">Best Ball</option>
              <option value="scramble">Scramble</option>
            </select>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-gray-400 text-sm">Holes:</label>
            {[9, 18].map((n) => (
              <button
                key={n}
                onPointerDown={() => setRHoles(n)}
                className={`px-4 py-2 rounded-xl font-semibold text-sm
                  ${rHoles === n ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            onPointerDown={saveRound}
            disabled={rSaving || !rName.trim()}
            className="h-12 bg-green-600 rounded-xl font-bold disabled:opacity-40"
          >
            {rSaving ? 'Saving…' : 'Add Round'}
          </button>
        </div>

        {/* Existing rounds */}
        {rounds.map((r) => {
          const isExpanded = expandedRound === r.id;
          const roundGroups = groupsByRound[r.id] ?? [];
          const isAddingHere = addingGroupToRound === r.id;

          return (
            <div key={r.id} className="bg-gray-800 rounded-2xl overflow-hidden">
              {/* Round header */}
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <button
                    onPointerDown={() => toggleExpand(r.id)}
                    className="flex-1 text-left"
                  >
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-gray-400 text-xs capitalize">
                      {r.day.replace('_', ' ')} · {r.format} · {r.holes} holes
                    </p>
                  </button>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onPointerDown={() => toggleRoundStatus(r)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold
                        ${r.status === 'active' ? 'bg-green-700 text-white' :
                          r.status === 'complete' ? 'bg-gray-600 text-gray-300' :
                          'bg-yellow-700 text-white'}`}
                    >
                      {r.status}
                    </button>
                    <button
                      onPointerDown={() => removeRound(r.id)}
                      className="text-red-400 text-xs font-medium px-1"
                    >
                      Delete
                    </button>
                    <span className="text-gray-500 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>
              </div>

              {/* Collapsible pairings */}
              {isExpanded && (
                <div className="border-t border-gray-700 px-4 pb-4 flex flex-col gap-3 pt-3">
                  {roundGroups.length === 0 && !isAddingHere && (
                    <p className="text-gray-500 text-sm">No pairings yet.</p>
                  )}

                  {roundGroups.map((g) => (
                    <div key={g.id} className="bg-gray-700 rounded-xl p-3 flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{g.name}</p>
                        <p className="text-gray-400 text-xs">PIN: {g.pin}</p>
                        <div className="flex flex-col gap-0.5 mt-1">
                          {g.players.map((p) => (
                            <p key={p.id} className="text-gray-300 text-xs">• {p.name}</p>
                          ))}
                        </div>
                      </div>
                      <button
                        onPointerDown={() => removeGroup(r.id, g.id)}
                        className="text-red-400 text-xs font-medium px-1"
                      >
                        Delete
                      </button>
                    </div>
                  ))}

                  {/* Inline add pairing form */}
                  {isAddingHere ? (
                    <div className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                      <p className="text-sm font-semibold text-gray-200">New Pairing</p>
                      <input
                        className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Group name (e.g. Group 1)"
                        value={gName}
                        onChange={(e) => setGName(e.target.value)}
                      />
                      <input
                        className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="PIN (4–6 digits)"
                        value={gPin}
                        onChange={(e) => setGPin(e.target.value)}
                        maxLength={6}
                        inputMode="numeric"
                      />
                      <p className="text-gray-400 text-xs">Players (up to 4):</p>
                      {gPlayers.map((name, i) => (
                        <input
                          key={i}
                          className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                          placeholder={`Player ${i + 1}`}
                          value={name}
                          onChange={(e) => {
                            const next = [...gPlayers];
                            next[i] = e.target.value;
                            setGPlayers(next);
                          }}
                        />
                      ))}
                      <div className="flex gap-2 mt-1">
                        <button
                          onPointerDown={() => savePairing(r.id)}
                          disabled={gSaving || !gName.trim() || !gPin.trim()}
                          className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                        >
                          {gSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onPointerDown={cancelAddPairing}
                          className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onPointerDown={() => openAddPairing(r.id)}
                      className="h-10 bg-gray-700 rounded-xl text-sm text-green-400 font-semibold border border-gray-600"
                    >
                      + Add Pairing
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
