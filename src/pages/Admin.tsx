import { useState, useEffect, useContext, useRef } from 'react';
import { Link } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import {
  createGolfer, listGolfers, deleteGolfer,
  createCourse, listCourses, updateCourse, deleteCourse,
  createGroup, updateGroup, deleteGroupWithScores, listGroupsByRound, inviteScorer,
  createRound, listRounds, deleteRound, updateRound,
  listAllScores, clearRoundScores,
} from '../lib/data';
import type { Golfer, Course, Group, Round, RoundFormat, Player } from '../types/tournament';
import type { GroupScoreDoc } from '../types/scoring';
import { DEFAULT_PAR } from '../constants/wolf';
import { computeGroupStanding } from '../lib/scoring/standings';
import { nanoid } from '../lib/nanoid';
import { exportTournament, downloadJson, getTournament, setTournamentAdmins } from '../lib/data';
import { CourseSearchStep, type CourseSearchResult } from '../components/wizard/CourseSearchStep';

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
  const s = computeGroupStanding(round, group, scoreDocs.find((d) => d.groupId === group.id));
  return { groupId: group.id, score: s.score, holesCompleted: s.holesCompleted, playerPoints: s.playerPoints };
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
              onClick={() => onCycle(hole)}
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

/** Players required per format; null means any count from 1 to 4. */
const REQUIRED_PLAYERS: Partial<Record<RoundFormat, number>> = { wolf: 4, gauntlet: 2 };

/**
 * Validate a pairing before saving: an optional scorer email that looks like
 * one (R13) and a player count the format supports (B19).
 */
function validatePairing(scorerEmail: string, format: RoundFormat | undefined, playerCount: number): string | null {
  if (scorerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(scorerEmail)) return 'That scorer email does not look right.';
  if (playerCount === 0) return 'Add at least one player.';
  const required = format ? REQUIRED_PLAYERS[format] : undefined;
  if (required && playerCount !== required) {
    return `${format === 'wolf' ? 'Wolf' : 'Gauntlet'} needs exactly ${required} players.`;
  }
  return null;
}

// ── Organisers ────────────────────────────────────────────────────────────────

/** Emails that can manage this tournament. Each signs in with an emailed link. */
function OrganisersEditor({ tournamentId, initial, me }: { tournamentId: string; initial: string[]; me: string | null }) {
  const [admins, setAdmins] = useState<string[]>(initial);
  const [adding, setAdding] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getTournament(tournamentId).then((t) => { if (t?.admins) setAdmins(t.admins); }).catch(() => {});
  }, [tournamentId]);

  const save = async (next: string[]) => {
    setSaving(true);
    setError('');
    try {
      setAdmins(await setTournamentAdmins(tournamentId, next));
      setAdding('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5 border-t border-gray-700 pt-3">
      <label className="text-gray-400 text-xs font-medium">Organisers</label>
      <p className="text-gray-500 text-xs">These people can manage the tournament. They sign in with their email.</p>
      {admins.map((a) => (
        <div key={a} className="flex items-center justify-between bg-gray-700 rounded-lg px-3 py-2 text-sm">
          <span className="truncate">{a}{a === me ? ' (you)' : ''}</span>
          {a !== me && (
            <button
              onClick={() => { if (window.confirm(`Remove ${a} as an organiser?`)) void save(admins.filter((x) => x !== a)); }}
              disabled={saving}
              className="text-red-400 text-xs ml-2"
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <input
          type="email"
          className="flex-1 min-w-0 bg-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 text-sm"
          placeholder="co-organiser@example.com"
          value={adding}
          onChange={(e) => { setAdding(e.target.value); setError(''); }}
          autoCapitalize="none"
        />
        <button
          onClick={() => save([...admins, adding.trim()])}
          disabled={saving || !adding.includes('@')}
          className="px-4 bg-green-600 rounded-xl text-sm font-semibold disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}

// ── Admin page ────────────────────────────────────────────────────────────────

export function Admin() {
  const { tournament, logout, tournamentId, isAppAdmin, updateTournamentData, email, myTournamentIds, selectTournament } = useContext(AuthContext);
  // tournamentId is always set by the time Admin renders (route guard + loginAsAdmin/enterTournamentAsAdmin)
  const tId = tournamentId ?? '';

  // Tournament Settings
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tName, setTName] = useState(tournament?.name ?? '');
  const [tLogoUrl, setTLogoUrl] = useState(tournament?.logoUrl ?? '');
  const [tSettingsSaving, setTSettingsSaving] = useState(false);
  const [tLogoUploading, setTLogoUploading] = useState(false);
  const [settingsCopied, setSettingsCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

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
  const [cSearch, setCSearch] = useState<CourseSearchResult>({ name: '', holes: 18, par: defaultPar(18) });
  const [cSaving, setCSaving] = useState(false);

  // Rounds
  const [rounds, setRounds] = useState<Round[]>([]);
  const [groupsByRound, setGroupsByRound] = useState<Record<string, Group[]>>({});
  const [scoresByRound, setScoresByRound] = useState<Record<string, GroupScoreDoc[]>>({});
  const [expandedRound, setExpandedRound] = useState<string | null>(null);
  const [addingGroupToRound, setAddingGroupToRound] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);

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
  const [gEmail, setGEmail] = useState('');
  const [invite, setInvite] = useState<{ groupId: string; state: 'sending' | 'sent' | 'error'; text?: string } | null>(null);
  const [gPlayers, setGPlayers] = useState(['', '', '', '']);
  const [gSaving, setGSaving] = useState(false);
  const [pairingError, setPairingError] = useState('');

  // Status-change confirmation
  const [pendingStatusRound, setPendingStatusRound] = useState<Round | null>(null);
  // Delete confirmation
  const [pendingDeleteRound, setPendingDeleteRound] = useState<Round | null>(null);

  // Inline round field editing (format/course, pending rounds only)
  const [editingRoundFieldId, setEditingRoundFieldId] = useState<string | null>(null);
  const [rEditFormat, setREditFormat] = useState<RoundFormat>('wolf');
  const [rEditCourseId, setREditCourseId] = useState('');
  const [rEditSaving, setREditSaving] = useState(false);

  useEffect(() => {
    if (!tId) return;
    listGolfers(tId).then((gs) =>
      setGolfers(gs.sort((a, b) => a.name.localeCompare(b.name))),
    );
    listCourses(tId).then((cs) =>
      setCourses(cs.sort((a, b) => a.name.localeCompare(b.name))),
    );
    listRounds(tId).then(setRounds);
  }, [tId]);

  // ── Roster ────────────────────────────────────────────────────────────────────

  const addGolfer = async () => {
    const name = newGolferName.trim();
    if (!name) return;
    setGolferSaving(true);
    const id = nanoid();
    await createGolfer(tId, id, { name });
    setGolfers((gs) =>
      [...gs, { id, name }].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setNewGolferName('');
    setGolferSaving(false);
  };

  const removeGolfer = async (id: string) => {
    const name = golfers.find((g) => g.id === id)?.name ?? 'this golfer';
    if (!window.confirm(`Remove ${name} from the roster?`)) return;
    await deleteGolfer(tId, id);
    setGolfers((gs) => gs.filter((g) => g.id !== id));
  };

  // ── Courses ───────────────────────────────────────────────────────────────────

  const openAddCourse = () => {
    setEditingCourseId(null);
    setCSearch({ name: '', holes: 18, par: defaultPar(18) });
    setAddingCourse(true);
  };

  const openEditCourse = (c: Course) => {
    setAddingCourse(false);
    setEditingCourseId(c.id);
    setCSearch({ name: c.name, holes: c.holes, par: [...c.par] });
  };

  const cancelCourseForm = () => {
    setAddingCourse(false);
    setEditingCourseId(null);
  };

  const cycleCPar = (i: number) =>
    setCSearch((s) => ({ ...s, par: s.par.map((v, idx) => (idx === i ? cyclePar(v) : v)) }));

  const saveCourse = async () => {
    if (!cSearch.name.trim()) return;
    setCSaving(true);
    const { name, holes, par } = cSearch;
    const id = nanoid();
    await createCourse(tId, id, { name: name.trim(), holes, par: par.slice(0, holes) });
    const course: Course = { id, name: name.trim(), holes, par: par.slice(0, holes) };
    setCourses((cs) => [...cs, course].sort((a, b) => a.name.localeCompare(b.name)));
    setAddingCourse(false);
    setCSaving(false);
  };

  const saveEditCourse = async (courseId: string) => {
    if (!cSearch.name.trim()) return;
    setCSaving(true);
    const { name, holes, par } = cSearch;
    const trimmedPar = par.slice(0, holes);
    await updateCourse(tId, courseId, { name: name.trim(), holes, par: trimmedPar });
    setCourses((cs) =>
      cs
        .map((c) =>
          c.id === courseId ? { ...c, name: name.trim(), holes, par: trimmedPar } : c,
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setEditingCourseId(null);
    setCSaving(false);
  };

  const removeCourse = async (id: string) => {
    const name = courses.find((c) => c.id === id)?.name ?? 'this course';
    if (!window.confirm(`Delete ${name}? Rounds already created keep their pars.`)) return;
    await deleteCourse(tId, id);
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
      listGroupsByRound(tId, roundId),
      listAllScores(tId, roundId),
    ]);
    setGroupsByRound((prev) => ({ ...prev, [roundId]: grps }));
    setScoresByRound((prev) => ({ ...prev, [roundId]: scoreDocs }));
  };

  const openAddPairing = (roundId: string) => {
    setEditingGroupId(null);
    setAddingGroupToRound(roundId);
    setGName('');
    setGEmail('');
    setGPlayers(['', '', '', '']);
    setPairingError('');
  };

  const cancelAddPairing = () => setAddingGroupToRound(null);

  const openEdit = (group: Group) => {
    setAddingGroupToRound(null);
    setEditingGroupId(group.id);
    setGName(group.name);
    setGEmail(group.scorerEmail ?? '');
    setPairingError('');
    const names = group.players.map((p) => p.name);
    while (names.length < 4) names.push('');
    setGPlayers(names);
  };

  const saveEdit = async (roundId: string, group: Group) => {
    if (!gName.trim()) return;
    // Player IDs stay with their slot, so removing player 2 does not move
    // players 3 and 4 onto other IDs and mis-attribute their scores (B10).
    const players: Player[] = gPlayers
      .map((name, i) => ({ id: group.players[i]?.id ?? nanoid(), name: name.trim() }))
      .filter((p) => p.name);
    const format = rounds.find((r) => r.id === roundId)?.format;
    const invalid = validatePairing(gEmail.trim(), format, players.length);
    if (invalid) {
      setPairingError(invalid);
      return;
    }
    setGSaving(true);
    try {
      setPairingError('');
      const scorerEmail = gEmail.trim().toLowerCase() || undefined;
      await updateGroup(tId, group.id, {
        name: gName.trim(),
        scorerEmail,
        players,
      });
      setGroupsByRound((prev) => ({
        ...prev,
        [roundId]: (prev[roundId] ?? []).map((g) =>
          g.id === group.id ? { ...g, name: gName.trim(), scorerEmail, players } : g,
        ),
      }));
      setEditingGroupId(null);
    } catch (err) {
      console.error('saveEdit error', err);
      setPairingError('Could not save. Check your connection and try again.');
    } finally {
      setGSaving(false);
    }
  };

  const savePairing = async (roundId: string) => {
    if (!gName.trim()) return;
    const players: Player[] = gPlayers
      .filter((n) => n.trim())
      .map((name) => ({ id: nanoid(), name: name.trim() }));
    const format = rounds.find((r) => r.id === roundId)?.format;
    const invalid = validatePairing(gEmail.trim(), format, players.length);
    if (invalid) {
      setPairingError(invalid);
      return;
    }
    setGSaving(true);
    try {
      setPairingError('');
      const id = nanoid();
      const scorerEmail = gEmail.trim().toLowerCase() || undefined;
      await createGroup(tId, id, {
        name: gName.trim(),
        scorerEmail,
        players,
        roundId,
      });
      const newGroup: Group = { id, name: gName.trim(), scorerEmail, players, roundId };
      setGroupsByRound((prev) => ({
        ...prev,
        [roundId]: [...(prev[roundId] ?? []), newGroup],
      }));
      setAddingGroupToRound(null);
    } catch (err) {
      console.error('savePairing error', err);
      setPairingError('Could not save. Check your connection and try again.');
    } finally {
      setGSaving(false);
    }
  };

  const sendInvite = async (g: Group) => {
    setInvite({ groupId: g.id, state: 'sending' });
    try {
      const to = await inviteScorer(tId, g.id);
      setInvite({ groupId: g.id, state: 'sent', text: to });
    } catch (err) {
      setInvite({ groupId: g.id, state: 'error' });
      window.alert(err instanceof Error ? err.message : 'Could not send the sign-in link.');
    }
  };

  const removeGroup = async (roundId: string, groupId: string) => {
    const name = groupsByRound[roundId]?.find((g) => g.id === groupId)?.name ?? 'this pairing';
    if (!window.confirm(`Delete ${name}? Its scorer loses access and any scores for this round are deleted.`)) return;
    await deleteGroupWithScores(tId, roundId, groupId);
    setScoresByRound((prev) => ({
      ...prev,
      [roundId]: (prev[roundId] ?? []).filter((d) => d.groupId !== groupId),
    }));
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
    await createRound(tId, id, {
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
    // Cascades to the round's groups and scores (B6)
    await deleteRound(tId, id);
    setRounds((rs) => rs.filter((r) => r.id !== id));
    setGroupsByRound((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (expandedRound === id) setExpandedRound(null);
  };

  /**
   * Change a round's status. Scores are only deleted when explicitly asked
   * (reset to pending); reopening a completed round keeps them (B9).
   */
  const setRoundStatus = async (round: Round, next: Round['status'], clearScores = false) => {
    await updateRound(tId, round.id, { status: next });
    if (clearScores) {
      await clearRoundScores(tId, round.id);
      setScoresByRound((s) => ({ ...s, [round.id]: [] }));
    }
    setRounds((rs) => rs.map((r) => (r.id === round.id ? { ...r, status: next } : r)));
  };

  const saveRoundFields = async () => {
    if (!editingRoundFieldId) return;
    setREditSaving(true);
    try {
      const currentRound = rounds.find((r) => r.id === editingRoundFieldId);
      const data: Partial<Omit<Round, 'id'>> = { format: rEditFormat, courseId: rEditCourseId || undefined };
      // A new course brings its own pars and hole count (B15)
      const newCourse = rEditCourseId && rEditCourseId !== currentRound?.courseId
        ? courses.find((c) => c.id === rEditCourseId)
        : undefined;
      if (newCourse) {
        data.holes = newCourse.holes;
        data.par = newCourse.par.slice(0, newCourse.holes);
      }
      await updateRound(tId, editingRoundFieldId, data);
      // If the format or hole count changed, old score docs have the wrong hole structure —
      // clear them so useGroup rebuilds fresh holes on next load.
      if (currentRound && (currentRound.format !== rEditFormat || (data.holes && data.holes !== currentRound.holes))) {
        await clearRoundScores(tId, editingRoundFieldId);
        setScoresByRound((s) => ({ ...s, [editingRoundFieldId]: [] }));
      }
      setRounds((rs) => rs.map((r) => r.id === editingRoundFieldId ? { ...r, ...data } : r));
      setEditingRoundFieldId(null);
    } catch (err) {
      console.error('saveRoundFields error', err);
      window.alert('Could not save the round. Check your connection and try again.');
    } finally {
      setREditSaving(false);
    }
  };

  // ── Tournament Settings ───────────────────────────────────────────────────────

  const uploadLogo = (file: File) => {
    setTLogoUploading(true);
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 512;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      setTLogoUrl(canvas.toDataURL('image/jpeg', 0.85));
      setTLogoUploading(false);
    };
    img.src = objectUrl;
  };

  const saveTournamentSettings = async () => {
    if (!tName.trim()) return;
    setTSettingsSaving(true);
    try {
      await updateTournamentData({ name: tName.trim(), logoUrl: tLogoUrl || undefined });
    } catch (err) {
      console.error('saveTournamentSettings error', err);
      window.alert('Could not save settings. Check your connection and try again.');
    } finally {
      setTSettingsSaving(false);
    }
  };

  const exportBackup = async () => {
    setExporting(true);
    try {
      const backup = await exportTournament(tId);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      downloadJson(`${tId}-backup-${stamp}.json`, backup);
    } catch (err) {
      console.error('exportBackup error', err);
      window.alert('Export failed. Check your connection and try again.');
    } finally {
      setExporting(false);
    }
  };

  const copyPublicUrl = async () => {
    const url = `${window.location.origin}/results/${tId}`;
    await navigator.clipboard.writeText(url);
    setSettingsCopied(true);
    setTimeout(() => setSettingsCopied(false), 2000);
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
        <div className="flex items-center gap-4">
          {isAppAdmin ? (
            <a href="/app-admin" className="text-blue-400 text-sm">All Tournaments</a>
          ) : myTournamentIds.length > 1 && (
            <button onClick={() => { void selectTournament(null).then(() => { window.location.href = '/'; }); }} className="text-blue-400 text-sm">
              Switch
            </button>
          )}
          <a href="/admin/results" className="text-gray-400 text-sm">Results</a>
          <button onClick={logout} className="text-red-400 text-sm font-medium">
            Logout
          </button>
        </div>
      </header>

      <div className="p-4 max-w-lg mx-auto flex flex-col gap-4">

        {/* ── Tournament Settings ── */}
        <div className="bg-gray-800 rounded-2xl overflow-hidden">
          <button
            onClick={() => setSettingsOpen((o) => !o)}
            className="w-full px-4 py-4 flex items-center justify-between text-left"
          >
            <div>
              <p className="font-bold text-lg">Tournament Settings</p>
              <p className="text-gray-400 text-xs">Name, logo, and public results link</p>
            </div>
            <span className="text-gray-500 text-sm ml-2">{settingsOpen ? '▲' : '▼'}</span>
          </button>

          {settingsOpen && (
            <div className="border-t border-gray-700 px-4 pb-4 pt-3 flex flex-col gap-4">
              {/* Tournament name */}
              <div className="flex flex-col gap-1.5">
                <label className="text-gray-400 text-xs font-medium">Tournament Name</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-gray-700 rounded-xl px-3 py-2 text-white placeholder-gray-500 text-sm"
                    placeholder="Tournament name"
                    value={tName}
                    onChange={(e) => setTName(e.target.value)}
                  />
                </div>
              </div>

              {/* Logo upload */}
              <div className="flex flex-col gap-2">
                <label className="text-gray-400 text-xs font-medium">Tournament Logo (optional)</label>
                <div className="flex items-center gap-3">
                  {tLogoUrl && (
                    <img
                      src={tLogoUrl}
                      alt="Logo preview"
                      className="h-14 w-auto rounded-lg bg-white p-1 shrink-0"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => logoFileInputRef.current?.click()}
                    disabled={tLogoUploading}
                    className="flex-1 py-2.5 bg-gray-700 rounded-xl text-sm font-medium disabled:opacity-40"
                  >
                    {tLogoUploading ? 'Uploading…' : tLogoUrl ? 'Replace Logo' : 'Upload Logo'}
                  </button>
                </div>
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadLogo(file);
                    e.target.value = '';
                  }}
                />
                {tLogoUrl && (
                  <button
                    type="button"
                    onClick={() => setTLogoUrl('')}
                    className="text-red-400 text-xs self-start"
                  >
                    Remove logo
                  </button>
                )}
              </div>

              <button
                onClick={saveTournamentSettings}
                disabled={tSettingsSaving || !tName.trim()}
                className="w-full py-2.5 bg-green-600 rounded-xl font-semibold text-sm disabled:opacity-40"
              >
                {tSettingsSaving ? 'Saving…' : 'Save Settings'}
              </button>

              {/* Public results link */}
              <div className="flex flex-col gap-1.5 border-t border-gray-700 pt-3">
                <label className="text-gray-400 text-xs font-medium">Public Results Link</label>
                <p className="text-gray-500 text-xs">Share this URL — no PIN required. Shows active and completed rounds.</p>
                <div className="flex gap-2 items-center">
                  <span className="flex-1 bg-gray-700 rounded-xl px-3 py-2 text-gray-300 text-xs truncate select-all">
                    {window.location.origin}/results/{tId}
                  </span>
                  <button
                    onClick={copyPublicUrl}
                    className="px-3 py-2 bg-gray-600 rounded-xl text-xs font-medium shrink-0"
                  >
                    {settingsCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {tId && <OrganisersEditor tournamentId={tId} initial={tournament?.admins ?? []} me={email} />}

              {/* Backup */}
              <div className="flex flex-col gap-1.5 border-t border-gray-700 pt-3">
                <label className="text-gray-400 text-xs font-medium">Backup</label>
                <p className="text-gray-500 text-xs">
                  Download every round, pairing, and score as a JSON file. Do this before and after each round.
                </p>
                <button
                  onClick={exportBackup}
                  disabled={exporting}
                  className="w-full py-2.5 bg-gray-700 rounded-xl font-semibold text-sm disabled:opacity-40"
                >
                  {exporting ? 'Exporting…' : 'Download backup (.json)'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Golfer Roster ── */}
        <div className="bg-gray-800 rounded-2xl overflow-hidden">
          <button
            onClick={() => setRosterOpen((o) => !o)}
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
                  onClick={addGolfer}
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
                      onClick={() => removeGolfer(g.id)}
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
            onClick={() => setCoursesOpen((o) => !o)}
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
                    <CourseSearchStep value={cSearch} onChange={setCSearch} />
                    <p className="text-gray-400 text-xs">Tap a hole to cycle par (3 / 4 / 5):</p>
                    <ParEditor par={cSearch.par} holes={cSearch.holes} onCycle={cycleCPar} />
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => saveEditCourse(c.id)}
                        disabled={cSaving || !cSearch.name.trim()}
                        className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                      >
                        {cSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={cancelCourseForm}
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
                          onClick={() => openEditCourse(c)}
                          className="text-blue-400 text-xs font-medium px-1"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeCourse(c.id)}
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
                  <CourseSearchStep value={cSearch} onChange={setCSearch} />
                  <p className="text-gray-400 text-xs">Tap a hole to cycle par (3 / 4 / 5):</p>
                  <ParEditor par={cSearch.par} holes={cSearch.holes} onCycle={cycleCPar} />
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={saveCourse}
                      disabled={cSaving || !cSearch.name.trim()}
                      className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                    >
                      {cSaving ? 'Saving…' : 'Save Course'}
                    </button>
                    <button
                      onClick={cancelCourseForm}
                      className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={openAddCourse}
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
              <option value="monday">Monday</option>
              <option value="tuesday">Tuesday</option>
              <option value="wednesday">Wednesday</option>
              <option value="thursday">Thursday</option>
              <option value="friday">Friday</option>
              <option value="saturday">Saturday</option>
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
              <option value="gauntlet">Gauntlet</option>
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
                onClick={() => handleRHolesChange(n)}
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
            onClick={saveRound}
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
                    onClick={() => toggleExpand(r.id)}
                    className="flex-1 text-left"
                  >
                    <p className="font-semibold">{r.name}</p>
                    <p className="text-gray-400 text-xs capitalize">
                      {r.day.charAt(0).toUpperCase() + r.day.slice(1)} · {r.format} · {r.holes} holes
                      {courseName ? ` · ${courseName}` : ''} · par {totalPar}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => setPendingStatusRound(r)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold
                        ${r.status === 'active' ? 'bg-green-700 text-white' :
                          r.status === 'complete' ? 'bg-gray-600 text-gray-300' :
                          'bg-yellow-700 text-white'}`}
                    >
                      {r.status}
                    </button>
                    <button
                      onClick={() => setPendingDeleteRound(r)}
                      className="text-red-400 text-xs font-medium px-1"
                    >
                      Delete
                    </button>
                    <span className="text-gray-500 text-sm">{isExpanded ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Inline format/course editor — pending rounds only */}
                {r.status === 'pending' && editingRoundFieldId !== r.id && (
                  <button
                    onClick={() => {
                      setEditingRoundFieldId(r.id);
                      setREditFormat(r.format);
                      setREditCourseId(r.courseId ?? '');
                    }}
                    className="mt-1.5 text-blue-400 text-xs font-medium"
                  >
                    Edit format/course
                  </button>
                )}
                {r.status === 'pending' && editingRoundFieldId === r.id && (
                  <div className="mt-3 flex flex-col gap-2">
                    <div className="flex gap-2">
                      <select
                        value={rEditFormat}
                        onChange={(e) => setREditFormat(e.target.value as RoundFormat)}
                        className="flex-1 bg-gray-700 rounded-lg px-2 py-2 text-white text-sm"
                      >
                        <option value="wolf">Wolf</option>
                        <option value="bestBall">Best Ball</option>
                        <option value="scramble">Scramble</option>
                        <option value="gauntlet">Gauntlet</option>
                      </select>
                      <select
                        value={rEditCourseId}
                        onChange={(e) => setREditCourseId(e.target.value)}
                        className="flex-1 bg-gray-700 rounded-lg px-2 py-2 text-white text-sm"
                      >
                        <option value="">No course</option>
                        {courses.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveRoundFields}
                        disabled={rEditSaving}
                        className="flex-1 h-9 bg-blue-600 rounded-lg text-sm text-white font-semibold disabled:opacity-50"
                      >
                        {rEditSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        onClick={() => setEditingRoundFieldId(null)}
                        className="flex-1 h-9 bg-gray-600 rounded-lg text-sm text-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
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
                        <input
                          type="email"
                          className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                          placeholder="Scorer email (gets the sign-in link)"
                          value={gEmail}
                          onChange={(e) => { setGEmail(e.target.value); setPairingError(''); }}
                          autoCapitalize="none"
                          autoCorrect="off"
                        />
                        {pairingError && <p className="text-red-400 text-xs">{pairingError}</p>}
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
                            onClick={() => saveEdit(r.id, g)}
                            disabled={gSaving || !gName.trim() || !gEmail.trim()}
                            className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                          >
                            {gSaving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={() => setEditingGroupId(null)}
                            className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div key={g.id} className="bg-gray-700 rounded-xl p-3 flex flex-col gap-2">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              {g.id === winnerGroupId && <span>🥇</span>}
                              <p className="font-medium text-sm">{g.name}</p>
                            </div>
                            <p className="text-gray-400 text-xs break-all">
                              Scorer: {g.scorerEmail ?? <span className="text-yellow-500">none yet (Edit to add)</span>}
                            </p>
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
                            <Link
                              to={`/admin/scorecard/${r.id}/${g.id}`}
                              className="text-green-400 text-xs font-medium px-1"
                            >
                              Scores
                            </Link>
                            <button
                              onClick={() => openEdit(g)}
                              className="text-blue-400 text-xs font-medium px-1"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeGroup(r.id, g.id)}
                              className="text-red-400 text-xs font-medium px-1"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 border-t border-gray-600 pt-2">
                          {(() => {
                            const players = g.players.map((p) => p.name).join(', ');
                            const msg =
                              `🏌️ ${tournament?.name ?? 'Golf Tournament'}\n` +
                              `Round: ${r.name}\n` +
                              `Group: ${g.name}\n` +
                              `Players: ${players}\n\n` +
                              `Tournament code: ${tId}\n` +
                              (g.scorerEmail ? `Scorer: ${g.scorerEmail} (check your email for the sign-in link)\n` : '') +
                              `\nLive results: ${window.location.origin}/results/${tId}`;
                            return (
                              <>
                                {g.scorerEmail && (
                                  <button
                                    onClick={() => sendInvite(g)}
                                    disabled={invite?.groupId === g.id && invite.state === 'sending'}
                                    className="flex items-center gap-1 text-green-400 text-xs font-medium active:text-green-200 disabled:opacity-50"
                                  >
                                    {invite?.groupId === g.id
                                      ? invite.state === 'sending' ? 'Sending…'
                                        : invite.state === 'sent' ? '✓ Link sent'
                                        : 'Retry link'
                                      : '✉️ Send sign-in link'}
                                  </button>
                                )}
                                <a
                                  href={`sms:?body=${encodeURIComponent(msg)}`}
                                  className="flex items-center gap-1 text-gray-400 text-xs font-medium active:text-gray-200"
                                >
                                  💬 Text
                                </a>
                                {typeof navigator.share === 'function' && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await navigator.share({ title: `${tournament?.name ?? 'Golf Tournament'} — ${g.name}`, text: msg });
                                      } catch {
                                        // user cancelled or API failed — silent
                                      }
                                    }}
                                    className="flex items-center gap-1 text-gray-400 text-xs font-medium active:text-gray-200"
                                  >
                                    📤 Share
                                  </button>
                                )}
                                <button
                                  onClick={async () => {
                                    await navigator.clipboard.writeText(msg);
                                    setCopiedGroupId(g.id);
                                    setTimeout(() => setCopiedGroupId((id) => id === g.id ? null : id), 2000);
                                  }}
                                  className="flex items-center gap-1 text-xs font-medium active:text-gray-200 text-gray-400"
                                >
                                  {copiedGroupId === g.id ? <span className="text-green-400">✓ Copied!</span> : '📋 Copy'}
                                </button>
                              </>
                            );
                          })()}
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
                      <input
                        type="email"
                        className="bg-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-400 text-sm"
                        placeholder="Scorer email (gets the sign-in link)"
                        value={gEmail}
                        onChange={(e) => { setGEmail(e.target.value); setPairingError(''); }}
                        autoCapitalize="none"
                        autoCorrect="off"
                      />
                      {pairingError && <p className="text-red-400 text-xs">{pairingError}</p>}
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
                          onClick={() => savePairing(r.id)}
                          disabled={gSaving || !gName.trim() || !gEmail.trim()}
                          className="flex-1 h-10 bg-green-600 rounded-lg font-bold text-sm disabled:opacity-40"
                        >
                          {gSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={cancelAddPairing}
                          className="px-4 h-10 bg-gray-600 rounded-lg text-sm text-gray-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openAddPairing(r.id)}
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
                onClick={() => setPendingDeleteRound(null)}
                className="flex-1 h-10 bg-gray-600 rounded-xl text-sm text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => { removeRound(pendingDeleteRound.id); setPendingDeleteRound(null); }}
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
        const close = () => setPendingStatusRound(null);
        const message =
          r.status === 'pending'
            ? `Start "${r.name}"? Players will be able to enter scores.`
            : r.status === 'active'
              ? `Mark "${r.name}" as complete? Players will lose editing access.`
              : `"${r.name}" is complete. Reopen it so players can correct scores, or reset it to pending and delete every score.`;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
            <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm flex flex-col gap-4">
              <p className={`text-sm leading-relaxed ${r.status === 'active' ? 'text-red-300' : 'text-gray-200'}`}>
                {message}
              </p>
              {r.status === 'complete' ? (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => { setRoundStatus(r, 'active'); close(); }}
                    className="h-10 rounded-xl text-sm font-semibold text-white bg-green-700"
                  >
                    Reopen (keep scores)
                  </button>
                  <button
                    onClick={() => {
                      if (!window.confirm(`Delete every score in "${r.name}"? This cannot be undone.`)) return;
                      setRoundStatus(r, 'pending', true);
                      close();
                    }}
                    className="h-10 rounded-xl text-sm font-semibold text-white bg-red-700"
                  >
                    Reset to pending (delete scores)
                  </button>
                  <button onClick={close} className="h-10 bg-gray-600 rounded-xl text-sm text-gray-200">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button onClick={close} className="flex-1 h-10 bg-gray-600 rounded-xl text-sm text-gray-200">
                    Cancel
                  </button>
                  <button
                    onClick={() => { setRoundStatus(r, r.status === 'pending' ? 'active' : 'complete'); close(); }}
                    className={`flex-1 h-10 rounded-xl text-sm font-semibold text-white
                      ${r.status === 'active' ? 'bg-red-700' : 'bg-green-700'}`}
                  >
                    {r.status === 'pending' ? 'Active' : 'Complete'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
