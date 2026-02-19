import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import {
  createGroup,
  listGroups,
  deleteGroup,
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [tab, setTab] = useState<'groups' | 'rounds'>('groups');

  // Group form
  const [gName, setGName] = useState('');
  const [gPin, setGPin] = useState('');
  const [gPlayers, setGPlayers] = useState(['', '', '', '']);
  const [gSaving, setGSaving] = useState(false);

  // Round form
  const [rName, setRName] = useState('');
  const [rDay, setRDay] = useState<Round['day']>('friday');
  const [rFormat, setRFormat] = useState<RoundFormat>('wolf');
  const [rHoles, setRHoles] = useState(18);
  const [rGroupIds, setRGroupIds] = useState<string[]>([]);
  const [rSaving, setRSaving] = useState(false);

  useEffect(() => {
    listGroups(TOURNAMENT_ID).then(setGroups);
    listRounds(TOURNAMENT_ID).then(setRounds);
  }, []);

  const saveGroup = async () => {
    if (!gName.trim() || !gPin.trim()) return;
    setGSaving(true);
    const players: Player[] = gPlayers
      .filter((n) => n.trim())
      .map((name) => ({ id: nanoid(), name: name.trim() }));
    const id = nanoid();
    const group: Group = { id, name: gName.trim(), pin: gPin.trim(), players };
    await createGroup(TOURNAMENT_ID, id, { name: group.name, pin: group.pin, players });
    setGroups((gs) => [...gs, group]);
    setGName('');
    setGPin('');
    setGPlayers(['', '', '', '']);
    setGSaving(false);
  };

  const removeGroup = async (id: string) => {
    await deleteGroup(TOURNAMENT_ID, id);
    setGroups((gs) => gs.filter((g) => g.id !== id));
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
      groupIds: rGroupIds,
    };
    await createRound(TOURNAMENT_ID, id, {
      name: round.name,
      day: round.day,
      format: round.format,
      status: round.status,
      holes: round.holes,
      par: round.par,
      groupIds: round.groupIds,
    });
    setRounds((rs) => [...rs, round]);
    setRName('');
    setRGroupIds([]);
    setRSaving(false);
  };

  const removeRound = async (id: string) => {
    await deleteRound(TOURNAMENT_ID, id);
    setRounds((rs) => rs.filter((r) => r.id !== id));
  };

  const toggleRoundStatus = async (round: Round) => {
    const next = round.status === 'pending' ? 'active' : round.status === 'active' ? 'complete' : 'pending';
    await updateRound(TOURNAMENT_ID, round.id, { status: next });
    setRounds((rs) => rs.map((r) => (r.id === round.id ? { ...r, status: next } : r)));
  };

  const toggleGroupInRound = (gid: string) => {
    setRGroupIds((ids) =>
      ids.includes(gid) ? ids.filter((i) => i !== gid) : [...ids, gid],
    );
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

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        {(['groups', 'rounds'] as const).map((t) => (
          <button
            key={t}
            onPointerDown={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold capitalize
              ${tab === t ? 'text-green-400 border-b-2 border-green-400' : 'text-gray-400'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-lg mx-auto">
        {tab === 'groups' && (
          <div className="flex flex-col gap-4">
            {/* Add group form */}
            <div className="bg-gray-800 rounded-2xl p-4 flex flex-col gap-3">
              <h2 className="font-bold text-lg">Add Group</h2>
              <input
                className="bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500"
                placeholder="Group name (e.g. Group 1)"
                value={gName}
                onChange={(e) => setGName(e.target.value)}
              />
              <input
                className="bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500"
                placeholder="PIN (4–6 digits)"
                value={gPin}
                onChange={(e) => setGPin(e.target.value)}
                maxLength={6}
                inputMode="numeric"
              />
              <p className="text-gray-400 text-sm">Players (up to 4):</p>
              {gPlayers.map((name, i) => (
                <input
                  key={i}
                  className="bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500"
                  placeholder={`Player ${i + 1}`}
                  value={name}
                  onChange={(e) => {
                    const next = [...gPlayers];
                    next[i] = e.target.value;
                    setGPlayers(next);
                  }}
                />
              ))}
              <button
                onPointerDown={saveGroup}
                disabled={gSaving || !gName.trim() || !gPin.trim()}
                className="h-12 bg-green-600 rounded-xl font-bold disabled:opacity-40"
              >
                {gSaving ? 'Saving…' : 'Add Group'}
              </button>
            </div>

            {/* Existing groups */}
            {groups.map((g) => (
              <div key={g.id} className="bg-gray-800 rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{g.name}</p>
                    <p className="text-gray-400 text-sm">PIN: {g.pin}</p>
                    <div className="flex flex-col gap-0.5 mt-1">
                      {g.players.map((p) => (
                        <p key={p.id} className="text-gray-300 text-sm">• {p.name}</p>
                      ))}
                    </div>
                  </div>
                  <button
                    onPointerDown={() => removeGroup(g.id)}
                    className="text-red-400 text-sm font-medium px-2 py-1"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'rounds' && (
          <div className="flex flex-col gap-4">
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
              <div>
                <p className="text-gray-400 text-sm mb-2">Assign Groups:</p>
                <div className="flex flex-col gap-2">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      onPointerDown={() => toggleGroupInRound(g.id)}
                      className={`h-11 rounded-xl text-sm font-medium
                        ${rGroupIds.includes(g.id) ? 'bg-green-700 text-white' : 'bg-gray-700 text-gray-300'}`}
                    >
                      {g.name}
                    </button>
                  ))}
                </div>
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
            {rounds.map((r) => (
              <div key={r.id} className="bg-gray-800 rounded-2xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-gray-400 text-xs capitalize">{r.day.replace('_', ' ')} · {r.format} · {r.holes} holes</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {r.groupIds.length} group{r.groupIds.length !== 1 ? 's' : ''} assigned
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
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
                      className="text-red-400 text-xs font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
