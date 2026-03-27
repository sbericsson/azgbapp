import { useState } from 'react';
import { nanoid } from '../lib/nanoid';
import { randomPin } from '../lib/pin';
import {
  createGolfer,
  createCourse,
  createRound,
  createGroup,
} from '../lib/firestore';
import type { Golfer, Round, RoundFormat, RoundStatus } from '../types/tournament';
import { CourseSearchStep, type CourseSearchResult } from '../components/wizard/CourseSearchStep';
import { FORMATS } from '../constants/formats';

const ROUND_DAYS: Array<{ value: Round['day']; label: string }> = [
  { value: 'friday', label: 'Friday' },
  { value: 'saturday_am', label: 'Saturday AM' },
  { value: 'saturday_pm', label: 'Saturday PM' },
  { value: 'sunday', label: 'Sunday' },
];

// ── Step types ────────────────────────────────────────────────────────────────

interface WizardGolfer {
  id: string;
  name: string;
}

interface WizardRound {
  id: string;
  name: string;
  day: Round['day'];
  format: RoundFormat;
  course: CourseSearchResult;
  courseId: string; // Firestore ID for the saved course
}

interface WizardGroup {
  id: string;
  name: string;
  pin: string;
  roundId: string;
  playerIds: string[];
}

interface WizardProps {
  tournamentId: string;
  adminPin: string;
  tournamentName: string;
  /** Initial golfers already saved to Firestore (for re-entry resume) */
  savedGolfers: Golfer[];
  /** Initial rounds already saved to Firestore (for re-entry resume) */
  savedRounds: Round[];
  /** Called when the wizard completes — parent re-fetches data to dismiss wizard */
  onComplete: () => void;
}

type WizardStep = 1 | 2 | 3 | 4;

function initialStep(savedGolfers: Golfer[], savedRounds: Round[]): WizardStep {
  if (savedGolfers.length === 0) return 1;
  if (savedRounds.length === 0) return 2;
  return 3;
}

export function OnboardingWizard({
  tournamentId,
  adminPin,
  tournamentName,
  savedGolfers,
  savedRounds,
  onComplete,
}: WizardProps) {

  // ── Golfer step state ─────────────────────────────────────────────────────
  const [golfers, setGolfers] = useState<WizardGolfer[]>(
    savedGolfers.map((g) => ({ id: g.id, name: g.name })),
  );
  const [newGolferName, setNewGolferName] = useState('');
  const [golferSaving, setGolferSaving] = useState(false);

  // ── Round step state ──────────────────────────────────────────────────────
  const [rounds, setRounds] = useState<WizardRound[]>(
    savedRounds.map((r) => ({
      id: r.id,
      name: r.name,
      day: r.day,
      format: r.format,
      course: { name: '', holes: r.holes, par: r.par },
      courseId: r.courseId ?? '',
    })),
  );
  const [newRound, setNewRound] = useState<{
    name: string;
    day: Round['day'];
    format: RoundFormat;
    course: CourseSearchResult;
  }>({
    name: '',
    day: 'friday',
    format: 'wolf',
    course: { name: '', holes: 18, par: Array(18).fill(4) },
  });
  const [roundSaving, setRoundSaving] = useState(false);

  // ── Group step state ──────────────────────────────────────────────────────
  const [groups, setGroups] = useState<WizardGroup[]>([]);
  const [newGroup, setNewGroup] = useState<{
    name: string;
    pin: string;
    roundId: string;
    playerIds: string[];
  }>({
    name: '',
    pin: randomPin(adminPin),
    roundId: '',
    playerIds: [],
  });
  const [groupSaving, setGroupSaving] = useState(false);

  // ── Step ──────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<WizardStep>(() => initialStep(savedGolfers, savedRounds));
  const [error, setError] = useState('');

  // ── Step 1: Add Golfers ───────────────────────────────────────────────────
  async function addGolfer() {
    const name = newGolferName.trim();
    if (!name) return;
    setGolferSaving(true);
    setError('');
    try {
      const id = nanoid(8);
      await createGolfer(tournamentId, id, { name });
      setGolfers((gs) => [...gs, { id, name }]);
      setNewGolferName('');
    } catch {
      setError('Failed to save golfer. Try again.');
    } finally {
      setGolferSaving(false);
    }
  }

  function removeGolfer(id: string) {
    setGolfers((gs) => gs.filter((g) => g.id !== id));
  }

  // ── Step 2: Add Rounds ────────────────────────────────────────────────────
  async function addRound() {
    if (!newRound.name.trim()) { setError('Round name is required.'); return; }
    if (!newRound.course.name.trim()) { setError('Course name is required.'); return; }
    setRoundSaving(true);
    setError('');
    try {
      // Save course first, then round
      const courseId = nanoid(8);
      await createCourse(tournamentId, courseId, {
        name: newRound.course.name,
        holes: newRound.course.holes,
        par: newRound.course.par,
      });

      const roundId = nanoid(8);
      const status: RoundStatus = 'pending';
      await createRound(tournamentId, roundId, {
        name: newRound.name.trim(),
        day: newRound.day,
        format: newRound.format,
        status,
        holes: newRound.course.holes,
        par: newRound.course.par,
        courseId,
      });

      setRounds((rs) => [...rs, { ...newRound, id: roundId, courseId }]);
      setNewRound({ name: '', day: 'friday', format: 'wolf', course: { name: '', holes: 18, par: Array(18).fill(4) } });
    } catch {
      setError('Failed to save round. Try again.');
    } finally {
      setRoundSaving(false);
    }
  }

  // ── Step 3: Add Groups ────────────────────────────────────────────────────
  async function addGroup() {
    if (!newGroup.name.trim()) { setError('Group name is required.'); return; }
    if (!newGroup.roundId) { setError('Select a round for this group.'); return; }
    if (!/^\d{4}$/.test(newGroup.pin)) { setError('PIN must be 4 digits.'); return; }
    setGroupSaving(true);
    setError('');
    try {
      const groupId = nanoid(8);
      const players = golfers
        .filter((g) => newGroup.playerIds.includes(g.id))
        .map((g) => ({ id: g.id, name: g.name }));

      await createGroup(tournamentId, groupId, {
        name: newGroup.name.trim(),
        pin: newGroup.pin,
        players,
        roundId: newGroup.roundId,
      });

      setGroups((gs) => [...gs, { ...newGroup, id: groupId, name: newGroup.name.trim() }]);
      // Reset with a fresh PIN, clear player selection
      setNewGroup((g) => ({
        name: '',
        pin: randomPin(adminPin),
        roundId: g.roundId, // keep same round selected for convenience
        playerIds: [],
      }));
    } catch {
      setError('Failed to save group. Try again.');
    } finally {
      setGroupSaving(false);
    }
  }

  // ── Step 4: Share ─────────────────────────────────────────────────────────
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);

  function shareMessage(group: WizardGroup): string {
    const round = rounds.find((r) => r.id === group.roundId);
    return [
      `Join ${tournamentName} on Golf Bender!`,
      `Tournament code: ${tournamentId}`,
      `Your group PIN: ${group.pin}`,
      round ? `Round: ${round.name}` : '',
      `Start here: golfbender.app/?code=${tournamentId}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  function copyShare(group: WizardGroup) {
    navigator.clipboard.writeText(shareMessage(group)).then(() => {
      setCopiedGroupId(group.id);
      setTimeout(() => setCopiedGroupId(null), 2000);
    });
  }

  // ── Shared UI helpers ─────────────────────────────────────────────────────

  const stepLabels = ['Golfers', 'Rounds', 'Groups', 'Share'];

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-start px-4 pt-6 pb-12">
      <div className="w-full max-w-lg flex flex-col gap-6">

        {/* Header */}
        <div>
          <h1 className="text-white text-xl font-bold">{tournamentName}</h1>
          <p className="text-gray-500 text-sm">Tournament setup</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-0">
          {stepLabels.map((label, i) => {
            const s = (i + 1) as WizardStep;
            const active = step === s;
            const done = step > s;
            return (
              <div key={label} className="flex items-center flex-1 last:flex-none">
                <button
                  onClick={() => done && setStep(s)}
                  className={[
                    'flex flex-col items-center gap-0.5 min-w-[48px]',
                    done ? 'cursor-pointer' : 'cursor-default',
                  ].join(' ')}
                >
                  <div
                    className={[
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                      active ? 'bg-green-500 text-white' : done ? 'bg-green-800 text-green-300' : 'bg-gray-800 text-gray-500',
                    ].join(' ')}
                  >
                    {done ? '✓' : i + 1}
                  </div>
                  <span className={['text-xs', active ? 'text-white' : 'text-gray-600'].join(' ')}>{label}</span>
                </button>
                {i < stepLabels.length - 1 && (
                  <div className={['flex-1 h-px mb-4', done ? 'bg-green-800' : 'bg-gray-800'].join(' ')} />
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-950/40 border border-red-900 rounded-xl px-4 py-3">{error}</p>
        )}

        {/* ── Step 1: Golfers ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-white text-lg font-semibold">Add golfers</h2>
              <p className="text-gray-500 text-sm">Add everyone playing in the tournament.</p>
            </div>

            {/* Golfer list */}
            {golfers.length > 0 && (
              <ul className="flex flex-col gap-2">
                {golfers.map((g) => (
                  <li key={g.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3">
                    <span className="text-white">{g.name}</span>
                    <button
                      onClick={() => removeGolfer(g.id)}
                      className="text-gray-600 hover:text-red-400 text-sm transition-colors"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {/* Add golfer input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newGolferName}
                onChange={(e) => setNewGolferName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !golferSaving && addGolfer()}
                placeholder="Golfer name"
                className="flex-1 bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={addGolfer}
                disabled={golferSaving || !newGolferName.trim()}
                className="bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium px-5 py-3 rounded-xl transition-colors"
              >
                Add
              </button>
            </div>

            <button
              onClick={() => { setError(''); setStep(2); }}
              disabled={golfers.length === 0}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl transition-colors"
            >
              Next: Rounds →
            </button>
          </div>
        )}

        {/* ── Step 2: Rounds ───────────────────────────────────────────────── */}
        {step === 2 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-white text-lg font-semibold">Set up rounds</h2>
              <p className="text-gray-500 text-sm">Add each round of the tournament.</p>
            </div>

            {/* Round list */}
            {rounds.length > 0 && (
              <ul className="flex flex-col gap-2">
                {rounds.map((r) => (
                  <li key={r.id} className="bg-gray-800 rounded-xl px-4 py-3">
                    <p className="text-white font-medium">{r.name}</p>
                    <p className="text-gray-500 text-xs">{ROUND_DAYS.find((d) => d.value === r.day)?.label} · {FORMATS.find((f) => f.id === r.format)?.label} · {r.course.name || 'No course'}</p>
                  </li>
                ))}
              </ul>
            )}

            {/* Add round form */}
            <div className="bg-gray-900 rounded-2xl p-4 flex flex-col gap-4 border border-gray-800">
              <p className="text-gray-400 text-sm font-medium">New round</p>

              <div className="flex flex-col gap-1.5">
                <label className="text-gray-500 text-xs">Round Name</label>
                <input
                  type="text"
                  value={newRound.name}
                  onChange={(e) => setNewRound((r) => ({ ...r, name: e.target.value }))}
                  placeholder="e.g. Friday Wolf"
                  className="bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>

              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-gray-500 text-xs">Day</label>
                  <select
                    value={newRound.day}
                    onChange={(e) => setNewRound((r) => ({ ...r, day: e.target.value as Round['day'] }))}
                    className="bg-gray-800 text-white rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {ROUND_DAYS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-gray-500 text-xs">Format</label>
                  <select
                    value={newRound.format}
                    onChange={(e) => setNewRound((r) => ({ ...r, format: e.target.value as RoundFormat }))}
                    className="bg-gray-800 text-white rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
                  >
                    {FORMATS.map((f) => (
                      <option key={f.id} value={f.id}>{f.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <CourseSearchStep
                value={newRound.course}
                onChange={(course) => setNewRound((r) => ({ ...r, course }))}
              />

              <button
                onClick={addRound}
                disabled={roundSaving || !newRound.name.trim() || !newRound.course.name.trim()}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {roundSaving ? 'Saving…' : '+ Add Round'}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setError(''); setStep(1); }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium py-4 rounded-2xl transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => { setError(''); setStep(3); }}
                disabled={rounds.length === 0}
                className="flex-[2] bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl transition-colors"
              >
                Next: Groups →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Groups ───────────────────────────────────────────────── */}
        {step === 3 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-white text-lg font-semibold">Create groups</h2>
              <p className="text-gray-500 text-sm">Each group gets a PIN to enter scores.</p>
            </div>

            {/* Group list */}
            {groups.length > 0 && (
              <ul className="flex flex-col gap-2">
                {groups.map((g) => {
                  const round = rounds.find((r) => r.id === g.roundId);
                  return (
                    <li key={g.id} className="bg-gray-800 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-medium">{g.name}</p>
                        <span className="text-green-400 font-mono font-bold tracking-widest">{g.pin}</span>
                      </div>
                      <p className="text-gray-500 text-xs">{round?.name ?? 'Unknown round'} · {g.playerIds.length} player{g.playerIds.length !== 1 ? 's' : ''}</p>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add group form */}
            <div className="bg-gray-900 rounded-2xl p-4 flex flex-col gap-4 border border-gray-800">
              <p className="text-gray-400 text-sm font-medium">New group</p>

              <div className="flex gap-3">
                <div className="flex flex-col gap-1.5 flex-1">
                  <label className="text-gray-500 text-xs">Group Name</label>
                  <input
                    type="text"
                    value={newGroup.name}
                    onChange={(e) => setNewGroup((g) => ({ ...g, name: e.target.value }))}
                    placeholder="e.g. Team A"
                    className="bg-gray-800 text-white placeholder-gray-600 rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <div className="flex flex-col gap-1.5 w-28">
                  <label className="text-gray-500 text-xs">PIN</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="tel"
                      inputMode="numeric"
                      value={newGroup.pin}
                      onChange={(e) => setNewGroup((g) => ({ ...g, pin: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      className="w-full bg-gray-800 text-white rounded-xl px-3 py-3 text-base outline-none focus:ring-2 focus:ring-green-500 font-mono tracking-widest"
                    />
                    <button
                      type="button"
                      onClick={() => setNewGroup((g) => ({ ...g, pin: randomPin(adminPin) }))}
                      className="text-gray-500 hover:text-gray-300 text-xs px-1"
                      title="Randomize PIN"
                    >
                      ↻
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-gray-500 text-xs">Round</label>
                <select
                  value={newGroup.roundId}
                  onChange={(e) => setNewGroup((g) => ({ ...g, roundId: e.target.value }))}
                  className="bg-gray-800 text-white rounded-xl px-4 py-3 text-base outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="">Select a round…</option>
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {golfers.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-gray-500 text-xs">Players (optional)</label>
                  <div className="flex flex-wrap gap-2">
                    {golfers.map((g) => {
                      const selected = newGroup.playerIds.includes(g.id);
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() =>
                            setNewGroup((ng) => ({
                              ...ng,
                              playerIds: selected
                                ? ng.playerIds.filter((id) => id !== g.id)
                                : [...ng.playerIds, g.id],
                            }))
                          }
                          className={[
                            'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
                            selected ? 'bg-green-700 text-white' : 'bg-gray-800 text-gray-400',
                          ].join(' ')}
                        >
                          {g.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button
                onClick={addGroup}
                disabled={groupSaving || !newGroup.name.trim() || !newGroup.roundId}
                className="w-full bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-medium py-3 rounded-xl transition-colors"
              >
                {groupSaving ? 'Saving…' : '+ Add Group'}
              </button>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setError(''); setStep(2); }}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white font-medium py-4 rounded-2xl transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={() => { setError(''); setStep(4); }}
                disabled={groups.length === 0}
                className="flex-[2] bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-bold py-4 rounded-2xl transition-colors"
              >
                Next: Share →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Share ────────────────────────────────────────────────── */}
        {step === 4 && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-white text-lg font-semibold">Share with your group</h2>
              <p className="text-gray-500 text-sm">Send each group their invite message.</p>
            </div>

            {groups.length === 0 ? (
              <p className="text-gray-500 text-sm">No groups to share yet.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {groups.map((g) => {
                  const round = rounds.find((r) => r.id === g.roundId);
                  return (
                    <li key={g.id} className="bg-gray-800 rounded-2xl p-4 flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <p className="text-white font-semibold">{g.name}</p>
                        <span className="text-green-400 font-mono font-bold">{g.pin}</span>
                      </div>
                      {round && <p className="text-gray-500 text-xs">{round.name}</p>}
                      <pre className="text-gray-400 text-xs bg-gray-900 rounded-xl p-3 whitespace-pre-wrap font-sans">{shareMessage(g)}</pre>
                      <button
                        onClick={() => copyShare(g)}
                        className="w-full bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium py-2.5 rounded-xl transition-colors"
                      >
                        {copiedGroupId === g.id ? 'Copied!' : 'Copy Invite Message'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <button
              onClick={onComplete}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-4 rounded-2xl transition-colors"
            >
              Done — Go to Admin Panel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
