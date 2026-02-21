import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import {
  createGolfer, listGolfers, deleteGolfer,
  createCourse, listCourses, updateCourse, deleteCourse,
  createGroup, updateGroup, deleteGroup, listGroupsByRound,
  createRound, listRounds, deleteRound, updateRound,
  listAllScores,
} from '../lib/firestore';
import type { Golfer, Course, Group, Round, RoundFormat, Player } from '../types/tournament';
import type { GroupScoreDoc, WolfHoleScore, BestBallHoleScore, ScrambleHoleScore } from '../types/scoring';
import { DEFAULT_PAR } from '../constants/wolf';
import { totalWolfPoints, isWolfHole } from '../lib/scoring/wolf';
import { bestBallTotalToPar, isBestBallHole } from '../lib/scoring/bestBall';
import { scrambleTotalToPar, isScrambleHole } from '../lib/scoring/scramble';
import { nanoid } from '../lib/nanoid';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

interface GroupSummary {
  groupId: string;
  score: number;
  holesCompleted: number;
  playerPoints?: { playerId: string; pts: number }[];
}

function computeGroupSummary(
  group: Group,
  round: Round,
  scoreDocs: GroupScoreDoc[],
): GroupSummary {
  const doc = scoreDocs.find((d) => d.groupId === group.id);
  if (!doc) return { groupId: group.id, score: 0, holesCompleted: 0 };
  const lockedHoles = doc.holes.filter((h) => h.locked);
  const holesCompleted = lockedHoles.length;
  if (round.format === 'wolf') {
    const wolfHoles = lockedHoles.filter(isWolfHole) as WolfHoleScore[];
    const playerPoints = group.players.map((p) => ({
      playerId: p.id,
      pts: totalWolfPoints(wolfHoles, p.id),
    }));
    return {
      groupId: group.id,
      score: playerPoints.reduce((s, p) => s + p.pts, 0),
      holesCompleted,
      playerPoints,
    };
  }
  if (round.format === 'bestBall') {
    const bbHoles = lockedHoles.filter(isBestBallHole) as BestBallHoleScore[];
    return { groupId: group.id, score: bestBallTotalToPar(bbHoles, round.par), holesCompleted };
  }
  const sHoles = lockedHoles.filter(isScrambleHole) as ScrambleHoleScore[];
  return { groupId: group.id, score: scrambleTotalToPar(sHoles, round.par), holesCompleted };
}

function randomPin(excludePin?: string) {
  let pin: string;
  do {
    pin = String(Math.floor(1000 + Math.random() * 9000));
  } while (pin === excludePin);
  return pin;
}

function cyclePar(val: number) {
  return val === 3 ? 4 : val === 4 ? 5 : 3;
}

function defaultPar(holes: number): number[] {
  return (DEFAULT_PAR.slice(0, holes) as number[]);
}

// ── Par grid editor ───────────────────────────────────────────────────────────

function ParEditor({
  par,
  holes,
  onCycle,
}: {
  par: number[];
  holes: number;
  onCycle: (i: number) => void;
}) {
  const row = (start: number, end: number) => (
    <div className="grid grid-cols-9 gap-1">
      {par.slice(start, end).map((p, idx) => {
        const hole = start + idx;
        return (
          <div key={hole} className="flex flex-col items-center gap-0.5">
            <span className="text-gray-500 text-xs">{hole + 1}</span>
            <button
              onPointerDown={() => onCycle(hole)}
              className={`w-full h-8 rounded text-xs font-bold text-white
                ${p === 3 ? 'bg-blue-700' : p === 5 ? 'bg-purple-700' : 'bg-gray-600'}`}
            >
              {p}
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {row(0, Math.min(holes, 9))}
      {holes === 18 && row(9, 18)}
      <p className="text-gray-500 text-xs text-right">
        Total par: {par.slice(0, holes).reduce((s, v) => s + v, 0)}
      </p>
    </div>
  );
}

// ── Admin page ────────────────────────────────────────────────────────────────

export function Admin() {
  const { tournament, logout } = useContext(AuthContext);

  // Roster
  const [golfers, setGolfers] = useState<Golfer[]>([]);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [newGolferName, setNewGolferName] = useState('');
  const [golferSaving, setGolferSaving] = useState(false);

  // Courses
  const [courses, setCourses] = useState<Course[]>([]);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [addingCourse, setAddingCourse] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [cName, setCName] = useState('');
  const [cHoles, setCHoles] = useState(18);
  const [cPar, setCPar] = useState<number[]>(defaultPar(18));
  const [cSaving, setCSaving] = useState(false);

  // Rounds
  const [rounds, setRounds] = useState<Round[]>([]);
  const [groupsByRound, setGroupsByRound] = useState<Record<string, Group[]>>({});
  const [scoresByRound, setScoresByRound] = useState<Record<string, GroupScoreDoc[]>>({});
  const [expandedRound, setExpandedRound] = useState<string | null>(null);
  const [addingGroupToRound, setAddingGroupToRound] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // Round form
  const [rName, setRName] = useState('');
  const [rDay, setRDay] = useState<Round['day']>('friday');
  const [rFormat, setRFormat] = useState<RoundFormat>('wolf');
  const [rHoles, setRHoles] = useState(18);
  const [rCourseId, setRCourseId] = useState('');
  const [rPar, setRPar] = useState<number[]>(defaultPar(18));
  const [rSaving, setRSaving] = useState(false);

  // Inline pairing form (one at a time)
  const [gName, setGName] = useState('');
  const [gPin, setGPin] = useState('');
  const [gPlayers, setGPlayers] = useState(['', '', '', '']);
  const [gSaving, setGSaving] = useState(false);

  // Status-change confirmation
  const [pendingStatusRound, setPendingStatusRound] = useState<Round | null>(null);
  // Delete confirmation
  const [pendingDeleteRound, setPendingDeleteRound] = useState<Round | null>(null);

  useEffect(() => {
    listGolfers(TOURNAMENT_ID).then((gs) =>
      setGolfers(gs.sort((a, b) => a.name.localeCompare(b.name))),
    );
    listCourses(TOURNAMENT_ID).then((cs) =>
      setCourses(cs.sort((a, b) => a.name.localeCompare(b.name))),
    );
    listRounds(TOURNAMENT_ID).then(setRounds);
  }, []);

  // ── Roster ────────────────────────────────────────────────────────────────────

  const addGolfer = async () => {
    const name = newGolferName.trim();
    if (!name) return;
    setGolferSaving(true);
    const id = nanoid();
    await createGolfer(TOURNAMENT_ID, id, { name });
    setGolfers((gs) =>
      [...gs, { id, name }].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setNewGolferName('');
    setGolferSaving(false);
  };

  const removeGolfer = async (id: string) => {
    await deleteGolfer(TOURNAMENT_ID, id);
    setGolfers((gs) => gs.filter((g) => g.id !== id));
  };

  // ── Courses ───────────────────────────────────────────────────────────────────

  const openAddCourse = () => {
    setEditingCourseId(null);
    setCName('');
    setCHoles(18);
    setCPar(defaultPar(18));
    setAddingCourse(true);
  };

  const openEditCourse = (c: Course) => {
    setAddingCourse(false);
    setEditingCourseId(c.id);
    setCName(c.name);
    setCHoles(c.holes);
    setCPar([...c.par]);
  };

  const cancelCourseForm = () => {
    setAddingCourse(false);
    setEditingCourseId(null);
  };

  const handleCHolesChange = (n: number) => {
    setCHoles(n);
    setCPar((prev) =>
      n === 9 ? prev.slice(0, 9) : [...prev, ...defaultPar(18).slice(prev.length)],
    );
  };

  const cycleCPar = (i: number) =>
    setCPar((prev) => prev.map((v, idx) => (idx === i ? cyclePar(v) : v)));

  const saveCourse = async () => {
    if (!cName.trim()) return;
    setCSaving(true);
    const par = cPar.slice(0, cHoles);
    const id = nanoid();
    await createCourse(TOURNAMENT_ID, id, { name: cName.trim(), holes: cHoles, par });
    const course: Course = { id, name: cName.trim(), holes: cHoles, par };
    setCourses((cs) => [...cs, course].sort((a, b) => a.name.localeCompare(b.name)));
    setAddingCourse(false);
    setCSaving(false);
  };

  const saveEditCourse = async (courseId: string) => {
    if (!cName.trim()) return;
    setCSaving(true);
    const par = cPar.slice(0, cHoles);
    await updateCourse(TOURNAMENT_ID, courseId, { name: cName.trim(), holes: cHoles, par });
    setCourses((cs) =>
      cs
        .map((c) =>
          c.id === courseId ? { ...c, name: cName.trim(), holes: cHoles, par } : c,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditingCourseId(null);
    setCSaving(false);
  };

  const removeCourse = async (id: string) => {
    await deleteCourse(TOURNAMENT_ID, id);
    setCourses((cs) => cs.filter((c) => c.id !== id));
    if (rCourseId === id) {
      setRCourseId('');
      setRPar(defaultPar(rHoles));
    }
  };

  // ── Round form helpers ────────────────────────────────────────────────────────

  const handleRCourseChange = (courseId: string) => {
    setRCourseId(courseId);
    if (courseId) {
      const course = courses.find((c) => c.id === courseId);
      if (course) {
        setRHoles(course.holes);
        setRPar([...course.par]);
      }
    }
  };

  const handleRHolesChange = (n: number) => {
    setRHoles(n);
    setRCourseId(''); // clear course link when manually changing holes
    setRPar((prev) =>
      n === 9 ? prev.slice(0, 9) : [...prev, ...defaultPar(18).slice(prev.length)],
    );
  };

  const cycleRPar = (i: number) =>
    setRPar((prev) => prev.map((v, idx) => (idx === i ? cyclePar(v) : v)));

  // ── Rounds ────────────────────────────────────────────────────────────────────

  const toggleExpand = async (roundId: string) => {
    if (expandedRound === roundId) {
      setExpandedRound(null);
      setAddingGroupToRound(null);
      setEditingGroupId(null);
      return;
    }
    setExpandedRound(roundId);
    setAddingGroupToRound(null);
    setEditingGroupId(null);
    const [grps, scoreDocs] = await Promise.all([
      listGroupsByRound(TOURNAMENT_ID, roundId),
      listAllScores(TOURNAMENT_ID, roundId),
    ]);
    setGroupsByRound((prev) => ({ ...prev, [roundId]: grps }));
    setScoresByRound((prev) => ({ ...prev, [roundId]: scoreDocs }));
  };

  const openAddPairing = (roundId: string) => {
    setEditingGroupId(null);
    setAddingGroupToRound(roundId);
    setGName('');
    setGPin(randomPin(tournament?.adminPin));
    setGPlayers(['', '', '', '']);
  };

  const cancelAddPairing = () => setAddingGroupToRound(null);

  const openEdit = (group: Group) => {
    setAddingGroupToRound(null);
    setEditingGroupId(group.id);
    setGName(group.name);
    setGPin(group.pin);
    const names = group.players.map((p) => p.name);
    while (names.length < 4) names.push('');
    setGPlayers(names);
  };

  const saveEdit = async (roundId: string, group: Group) => {
    if (!gName.trim() || !gPin.trim()) return;
    setGSaving(true);
    const players: Player[] = gPlayers
      .filter((n) => n.trim())
      .map((name, i) => ({
        id: group.players[i]?.id ?? nanoid(),
        name: name.trim(),
      }));
    await updateGroup(TOURNAMENT_ID, group.id, {
      name: gName.trim(),
      pin: gPin.trim(),
      players,
    });
    setGroupsByRound((prev) => ({
      ...prev,
      [roundId]: (prev[roundId] ?? []).map((g) =>
        g.id === group.id ? { ...g, name: gName.trim(), pin: gPin.trim(), players } : g,
      ),
    }));
    setEditingGroupId(null);
    setGSaving(false);
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

  // ── Round CRUD ────────────────────────────────────────────────────────────────

  const saveRound = async () => {
    if (!rName.trim()) return;
    setRSaving(true);
    const id = nanoid();
    const par = rPar.slice(0, rHoles);
    const round: Round = {
      id,
      name: rName.trim(),
      day: rDay,
      format: rFormat,
      status: 'pending',
      holes: rHoles,
      par,
      ...(rCourseId ? { courseId: rCourseId } : {}),
    };
    await createRound(TOURNAMENT_ID, id, {
      name: round.name,
      day: round.day,
      format: round.format,
      status: round.status,
      holes: round.holes,
      par: round.par,
      ...(round.courseId ? { courseId: round.courseId } : {}),
    });
    setRounds((rs) => [...rs, round]);
    setGroupsByRound((prev) => ({ ...prev, [id]: [] }));
    setExpandedRound(id);
    setRName('');
    setRCourseId('');
    setRPar(defaultPar(rHoles));
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

  // ── Derived ───────────────────────────────────────────────────────────────────

  const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));

  const activeFormRoundId =
    addingGroupToRound ??
    (editingGroupId
      ? (Object.entries(groupsByRound).find(([, gs]) =>
          gs.some((g) => g.id === editingGroupId),
        )?.[0] ?? null)
      : null);

  const takenNames = activeFormRoundId
    ? new Set(
        (groupsByRound[activeFormRoundId] ?? [])
          .filter((g) => g.id !== editingGroupId)
          .flatMap((g) => g.players.map((p) => p.name)),
      )
    : new Set<string>();

  const availableGolfers = golfers.filter((g) => !takenNames.has(g.name));

  // ── Render ────────────────────────────────────────────────────────────────────

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

        {/* ── Golfer Roster ── */}
        <div className="bg-gray-800 rounded-2xl overflow-hidden">
          <button
            onPointerDown={() => setRosterOpen((o) => !o)}
            className="w-full px-4 py-4 flex items-center justify-between text-left"
          >
            <div>
              <p className="font-bold text-lg">Golfer Roster</p>
              <p className="text-gray-400 text-xs">
                {golfers.length} golfer{golfers.length !== 1 ? 's' : ''} — names auto-complete in pairings
              </p>
            </div>
            <span className="text-gray-500 text-sm ml-2">{rosterOpen ? '▲' : '▼'}</span>
          </button>

          {rosterOpen && (
            <div className="border-t border-gray-700 px-4 pb-4 pt-3 flex flex-col gap-3">
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 text-sm"
                  placeholder="Golfer name"
                  value={newGolferName}
                  onChange={(e) => setNewGolferName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGolfer()}
                />
                <button
                  onPointerDown={addGolfer}
                  disabled={golferSaving || !newGolferName.trim()}
                  className="px-4 h-10 bg-green-600 rounded-xl font-semibold text-sm disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {golfers.length === 0 && <p className="text-gray-500 text-sm">No golfers yet.</p>}
              <div className="flex flex-col gap-1.5">
                {golfers.map((g) => (
                  <div key={g.id} className="flex items-center justify-between bg-gray-700 rounded-xl px-3 py-2">
                    <span className="text-sm">{g.name}</span>
                    <button
                      onPointerDown={() => removeGolfer(g.id)}
                      className="text-red-400 text-xs font-medium px-1"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Courses ── */}
        <div className="bg-gray-800 rounded-2xl overflow-hidden">
          <button
            onPointerDown={() => setCoursesOpen((o) => !o)}
            className="w-full px-4 py-4 flex items-center justify-between text-left"
          >
            <div>
              <p className="font-bold text-lg">Golf Courses</p>
              <p className="text-gray-400 text-xs">
                {courses.length} course{courses.length !== 1 ? 's' : ''} — select when creating a round
              </p>
            </div>
            <span className="text-gray-500 text-sm ml-2">{coursesOpen ? '▲' : '▼'}</span>
          </button>

          {coursesOpen && (
            <div className="border-t border-gray-700 px-4 pb-4 pt-3 flex flex-col gap-3">
              {/* Existing courses */}
              {courses.length === 0 && !addingCourse && (
                <p className="text-gray-500 text-sm">No courses yet.</p>
              )}
              {courses.map((c) =>
                editingCourseId === c.id ? (
                  /* ── Inline course edit ── */
                  <div key={c.id} className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-gray-200">Edit Course</p>
                    <input
                      className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                      placeholder="Course name"
                      value={cName}
                      onChange={(e) => setCName(e.target.value)}
                    />
                    <div className="flex items-center gap-3">
                      <label className="text-gray-400 text-xs">Holes:</label>
                      {[9, 18].map((n) => (
                        <button
                          key={n}
                          onPointerDown={() => handleCHolesChange(n)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-semibold
                            ${cHoles === n ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}`}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                    <p className="text-gray-400 text-xs">Tap a hole to cycle par (3 / 4 / 5):</p>
                    <ParEditor par={cPar} holes={cHoles} onCycle={cycleCPar} />
                    <div className="flex gap-2 mt-1">
                      <button
                        onPointerDown={() => saveEditCourse(c.id)}
                        disabled={cSaving || !cName.trim()}
                        className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                      >
                        {cSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onPointerDown={cancelCourseForm}
                        className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Course view row ── */
                  <div key={c.id} className="bg-gray-700 rounded-xl p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-gray-400 text-xs">
                          {c.holes} holes · par {c.par.slice(0, c.holes).reduce((s, v) => s + v, 0)}
                        </p>
                        <p className="text-gray-500 text-xs mt-0.5 font-mono">
                          {c.par.slice(0, c.holes).join('-')}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <button
                          onPointerDown={() => openEditCourse(c)}
                          className="text-blue-400 text-xs font-medium px-1"
                        >
                          Edit
                        </button>
                        <button
                          onPointerDown={() => removeCourse(c.id)}
                          className="text-red-400 text-xs font-medium px-1"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ),
              )}

              {/* Add course form */}
              {addingCourse ? (
                <div className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                  <p className="text-sm font-semibold text-gray-200">New Course</p>
                  <input
                    className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                    placeholder="Course name"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                  />
                  <div className="flex items-center gap-3">
                    <label className="text-gray-400 text-xs">Holes:</label>
                    {[9, 18].map((n) => (
                      <button
                        key={n}
                        onPointerDown={() => handleCHolesChange(n)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-semibold
                          ${cHoles === n ? 'bg-green-600 text-white' : 'bg-gray-600 text-gray-300'}`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                  <p className="text-gray-400 text-xs">Tap a hole to cycle par (3 / 4 / 5):</p>
                  <ParEditor par={cPar} holes={cHoles} onCycle={cycleCPar} />
                  <div className="flex gap-2 mt-1">
                    <button
                      onPointerDown={saveCourse}
                      disabled={cSaving || !cName.trim()}
                      className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                    >
                      {cSaving ? 'Saving…' : 'Save Course'}
                    </button>
                    <button
                      onPointerDown={cancelCourseForm}
                      className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onPointerDown={openAddCourse}
                  className="h-10 bg-gray-700 rounded-xl text-sm text-green-400 font-semibold border border-gray-600"
                >
                  + Add Course
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Add Round form ── */}
        <div className="bg-gray-800 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="font-bold text-lg">Add Round</h2>
          <input
            className="bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500"
            placeholder="Round name (e.g. Friday Wolf)"
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

          {/* Course selector */}
          <select
            className="bg-gray-700 rounded-xl px-3 py-3 text-white"
            value={rCourseId}
            onChange={(e) => handleRCourseChange(e.target.value)}
          >
            <option value="">No course (set par manually)</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.holes} holes, par {c.par.slice(0, c.holes).reduce((s, v) => s + v, 0)})
              </option>
            ))}
          </select>

          {/* Holes toggle (disabled when course is selected) */}
          <div className="flex items-center gap-3">
            <label className="text-gray-400 text-sm">Holes:</label>
            {[9, 18].map((n) => (
              <button
                key={n}
                onPointerDown={() => handleRHolesChange(n)}
                className={`px-4 py-2 rounded-xl font-semibold text-sm
                  ${rHoles === n ? 'bg-green-600 text-white' : 'bg-gray-700 text-gray-300'}`}
              >
                {n}
              </button>
            ))}
            {rCourseId && (
              <span className="text-gray-500 text-xs">from course</span>
            )}
          </div>

          {/* Per-hole par editor */}
          <div>
            <p className="text-gray-400 text-sm mb-2">
              Par per hole — tap to cycle (3 / 4 / 5):
            </p>
            <ParEditor par={rPar} holes={rHoles} onCycle={cycleRPar} />
          </div>

          <button
            onPointerDown={saveRound}
            disabled={rSaving || !rName.trim()}
            className="h-12 bg-green-600 rounded-xl font-bold disabled:opacity-40"
          >
            {rSaving ? 'Saving…' : 'Add Round'}
          </button>
        </div>

        {/* ── Existing rounds ── */}
        {rounds.map((r) => {
          const isExpanded = expandedRound === r.id;
          const roundGroups = groupsByRound[r.id] ?? [];
          const isAddingHere = addingGroupToRound === r.id;
          const courseName = r.courseId ? coursesById[r.courseId]?.name : null;
          const totalPar = r.par.reduce((s, v) => s + v, 0);

            const roundScoreDocs = scoresByRound[r.id] ?? [];
          const groupSummaries = roundGroups.map((g) => computeGroupSummary(g, r, roundScoreDocs));
          const playedSummaries = groupSummaries.filter((s) => s.holesCompleted > 0);
          const winnerGroupId = playedSummaries.length > 0
            ? (r.format === 'wolf'
                ? playedSummaries.reduce((best, s) => s.score >= best.score ? s : best, playedSummaries[0])
                : playedSummaries.reduce((best, s) => s.score <= best.score ? s : best, playedSummaries[0])
              ).groupId
            : null;

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
                      {courseName ? ` · ${courseName}` : ''} · par {totalPar}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onPointerDown={() => setPendingStatusRound(r)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold
                        ${r.status === 'active' ? 'bg-green-700 text-white' :
                          r.status === 'complete' ? 'bg-gray-600 text-gray-300' :
                          'bg-yellow-700 text-white'}`}
                    >
                      {r.status}
                    </button>
                    <button
                      onPointerDown={() => setPendingDeleteRound(r)}
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

                  {roundGroups.map((g) => {
                    const summary = groupSummaries.find((s) => s.groupId === g.id);
                    return editingGroupId === g.id ? (
                      <div key={g.id} className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                        <p className="text-sm font-semibold text-gray-200">Edit Pairing</p>
                        <input
                          className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                          placeholder="Group name (e.g. Group 1)"
                          value={gName}
                          onChange={(e) => setGName(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <input
                            className="flex-1 bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                            placeholder="4-digit PIN"
                            value={gPin}
                            onChange={(e) => setGPin(e.target.value)}
                            maxLength={4}
                            inputMode="numeric"
                          />
                          <button
                            onPointerDown={() => setGPin(randomPin(tournament?.adminPin))}
                            className="px-3 h-10 bg-gray-500 rounded-lg text-xs font-semibold text-gray-200 whitespace-nowrap"
                          >
                            Random PIN
                          </button>
                        </div>
                        <p className="text-gray-400 text-xs">Players (up to 4):</p>
                        {gPlayers.map((name, i) => {
                          const otherNames = new Set(
                            gPlayers.filter((_, j) => j !== i).map((n) => n.trim()).filter(Boolean),
                          );
                          const slotGolfers = availableGolfers.filter((g) => !otherNames.has(g.name));
                          const listId = `edit-slot-${i}`;
                          return (
                            <div key={i}>
                              <datalist id={listId}>
                                {slotGolfers.map((g) => <option key={g.id} value={g.name} />)}
                              </datalist>
                              <input
                                list={listId}
                                className="w-full bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                                placeholder={`Player ${i + 1}`}
                                value={name}
                                onChange={(e) => {
                                  const next = [...gPlayers];
                                  next[i] = e.target.value;
                                  setGPlayers(next);
                                }}
                              />
                            </div>
                          );
                        })}
                        <div className="flex gap-2 mt-1">
                          <button
                            onPointerDown={() => saveEdit(r.id, g)}
                            disabled={gSaving || !gName.trim() || !gPin.trim()}
                            className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                          >
                            {gSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onPointerDown={() => setEditingGroupId(null)}
                            className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={g.id} className="bg-gray-700 rounded-xl p-3 flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            {g.id === winnerGroupId && <span>🥇</span>}
                            <p className="font-medium text-sm">{g.name}</p>
                          </div>
                          <p className="text-gray-400 text-xs">PIN: {g.pin}</p>
                          <div className="flex flex-col gap-0.5 mt-1">
                            {g.players.map((p) => {
                              const ppts = summary?.playerPoints?.find((pp) => pp.playerId === p.id);
                              return (
                                <p key={p.id} className="text-gray-300 text-xs flex items-center justify-between pr-2">
                                  <span>• {p.name}</span>
                                  {ppts && ppts.pts > 0 && <span className="text-yellow-400">{ppts.pts}pts</span>}
                                </p>
                              );
                            })}
                          </div>
                          {summary && summary.holesCompleted > 0 && (
                            <p className="text-gray-400 text-xs mt-1">
                              {r.format === 'wolf'
                                ? `${summary.score} pts`
                                : summary.score === 0 ? 'E'
                                : summary.score > 0 ? `+${summary.score}`
                                : `${summary.score}`
                              }
                              {' · '}{summary.holesCompleted}/{r.holes} holes
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1.5 ml-2">
                          <button
                            onPointerDown={() => openEdit(g)}
                            className="text-blue-400 text-xs font-medium px-1"
                          >
                            Edit
                          </button>
                          <button
                            onPointerDown={() => removeGroup(r.id, g.id)}
                            className="text-red-400 text-xs font-medium px-1"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  {isAddingHere ? (
                    <div className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                      <p className="text-sm font-semibold text-gray-200">New Pairing</p>
                      <input
                        className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Group name (e.g. Group 1)"
                        value={gName}
                        onChange={(e) => setGName(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <input
                          className="flex-1 bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                          placeholder="4-digit PIN"
                          value={gPin}
                          onChange={(e) => setGPin(e.target.value)}
                          maxLength={4}
                          inputMode="numeric"
                        />
                        <button
                          onPointerDown={() => setGPin(randomPin(tournament?.adminPin))}
                          className="px-3 h-10 bg-gray-500 rounded-lg text-xs font-semibold text-gray-200 whitespace-nowrap"
                        >
                          Random PIN
                        </button>
                      </div>
                      <p className="text-gray-400 text-xs">Players (up to 4):</p>
                      {gPlayers.map((name, i) => {
                        const otherNames = new Set(
                          gPlayers.filter((_, j) => j !== i).map((n) => n.trim()).filter(Boolean),
                        );
                        const slotGolfers = availableGolfers.filter((g) => !otherNames.has(g.name));
                        const listId = `add-slot-${i}`;
                        return (
                          <div key={i}>
                            <datalist id={listId}>
                              {slotGolfers.map((g) => <option key={g.id} value={g.name} />)}
                            </datalist>
                            <input
                              list={listId}
                              className="w-full bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                              placeholder={`Player ${i + 1}`}
                              value={name}
                              onChange={(e) => {
                                const next = [...gPlayers];
                                next[i] = e.target.value;
                                setGPlayers(next);
                              }}
                            />
                          </div>
                        );
                      })}
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

      {/* Round delete confirmation modal */}
      {pendingDeleteRound && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
            <p className="text-sm leading-relaxed text-red-300">
              Delete "{pendingDeleteRound.name}"? This cannot be undone and will remove all pairings and scores.
            </p>
            <div className="flex gap-3">
              <button
                onPointerDown={() => setPendingDeleteRound(null)}
                className="flex-1 h-10 bg-gray-600 rounded-xl text-sm text-gray-200"
              >
                Cancel
              </button>
              <button
                onPointerDown={() => { removeRound(pendingDeleteRound.id); setPendingDeleteRound(null); }}
                className="flex-1 h-10 rounded-xl text-sm font-semibold text-white bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Round status confirmation modal */}
      {pendingStatusRound && (() => {
        const r = pendingStatusRound;
        const nextStatus = r.status === 'pending' ? 'active' : r.status === 'active' ? 'complete' : 'pending';
        const isDestructive = r.status === 'active';
        const message =
          r.status === 'pending'
            ? `Start "${r.name}"? Players will be able to enter scores.`
            : r.status === 'active'
              ? `Mark "${r.name}" as complete? Players will lose editing access.`
              : `Reset "${r.name}" to pending? It will be hidden from players.`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
            <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
              <p className={`text-sm leading-relaxed ${isDestructive ? 'text-red-300' : 'text-gray-200'}`}>
                {message}
              </p>
              <div className="flex gap-3">
                <button
                  onPointerDown={() => setPendingStatusRound(null)}
                  className="flex-1 h-10 bg-gray-600 rounded-xl text-sm text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onPointerDown={() => { toggleRoundStatus(r); setPendingStatusRound(null); }}
                  className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white
                    ${isDestructive ? 'bg-red-700' : 'bg-green-700'}`}
                >
                  {nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
