import { useState, useEffect, useContext } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { useGroup } from '../hooks/useGroup';
import { listRounds, getCourse } from '../lib/firestore';
import type { Round } from '../types/tournament';
import type { WolfHoleScore, BestBallHoleScore, ScrambleHoleScore } from '../types/scoring';
import { HoleHeader } from '../components/scorecard/HoleHeader';
import { HoleNav } from '../components/scorecard/HoleNav';
import { WolfControls } from '../components/scorecard/WolfControls';
import { WolfHoleResult } from '../components/scorecard/WolfHoleResult';
import { BestBallRow } from '../components/scorecard/BestBallRow';
import { ScrambleInput } from '../components/scorecard/ScrambleInput';
import {
  withComputedPoints,
  isWolfHole,
  computeCarryForHole,
  totalWolfPoints,
} from '../lib/scoring/wolf';
import { computeBestScore, isBestBallHole } from '../lib/scoring/bestBall';
import { isScrambleHole } from '../lib/scoring/scramble';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

export function Scorecard() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const { group, updateGroupName } = useContext(AuthContext);

  const [round, setRound] = useState<Round | null>(null);
  const [courseName, setCourseName] = useState<string | undefined>();
  const [currentHole, setCurrentHole] = useState(0);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  const players = group?.players ?? [];
  const { holes, loading, saving, saveHole, setLocalHole } = useGroup(
    TOURNAMENT_ID,
    round,
    group?.id ?? null,
    players,
  );

  useEffect(() => {
    if (!roundId) return;
    listRounds(TOURNAMENT_ID).then((all) => {
      const r = all.find((r) => r.id === roundId) ?? null;
      setRound(r);
      if (r?.courseId) {
        getCourse(TOURNAMENT_ID, r.courseId).then((c) => setCourseName(c?.name));
      }
    });
  }, [roundId]);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Swipe to navigate holes
  useEffect(() => {
    let startX = 0;
    const onTouchStart = (e: TouchEvent) => { startX = e.touches[0].clientX; };
    const onTouchEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 50) return;
      if (dx < 0 && currentHole < (round?.holes ?? 18) - 1) setCurrentHole((h) => h + 1);
      if (dx > 0 && currentHole > 0) setCurrentHole((h) => h - 1);
    };
    window.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchend', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [currentHole, round?.holes]);

  if (!group || !round) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <p className="text-gray-400">{loading ? 'Loading…' : 'Round not found'}</p>
      </div>
    );
  }

  const par = round.par[currentHole] ?? 4;
  const hole = holes[currentHole];
  const lockedHoles = holes.map((h) => h?.locked ?? false);

  // Wolf carry + running points
  const wolfHoles = round.format === 'wolf' ? (holes as WolfHoleScore[]) : [];
  const currentCarry = round.format === 'wolf' ? computeCarryForHole(wolfHoles, currentHole) : 0;
  const runningPoints = round.format === 'wolf'
    ? players.map((p) => ({
        playerId: p.id,
        pts: totalWolfPoints(wolfHoles.filter((h) => h.locked), p.id),
      }))
    : [];
  const runningRelativeToPar = round.format === 'wolf'
    ? players.map((p) => ({
        playerId: p.id,
        relativeToPar: (holes as WolfHoleScore[]).reduce((sum, hole, i) => {
          if (i > currentHole || !hole.locked) return sum;
          const s = hole.scores.find((sc) => sc.playerId === p.id);
          return s && s.gross > 0 ? sum + (s.gross - (round.par[i] ?? 4)) : sum;
        }, 0),
      }))
    : [];

  // Best ball cumulative running total per player through current hole
  const bestBallRunningRelativeToPar = round.format === 'bestBall'
    ? players.map((p) => ({
        playerId: p.id,
        relativeToPar: (holes as BestBallHoleScore[]).reduce((sum, hole, i) => {
          if (i > currentHole || !hole.locked) return sum;
          const s = hole.scores.find((sc) => sc.playerId === p.id);
          return s && s.gross > 0 ? sum + (s.gross - (round.par[i] ?? 4)) : sum;
        }, 0),
      }))
    : [];

  // Scramble cumulative through current hole
  const scrambleCumulative = round.format === 'scramble'
    ? (holes as ScrambleHoleScore[]).reduce((sum, hole, i) => {
        if (i > currentHole || !hole.locked || hole.teamScore === null) return sum;
        return sum + (hole.teamScore - (round.par[i] ?? 4));
      }, 0)
    : null;
  const scrambleHolesLocked = round.format === 'scramble'
    ? (holes as ScrambleHoleScore[]).filter((h, i) => h.locked && i <= currentHole).length
    : 0;

  const handleLockHole = async () => {
    if (!hole) return;
    let locked = { ...hole, locked: true };

    if (isWolfHole(locked)) {
      // Default unset (0) scores to par before computing points
      const wolfLocked = locked as WolfHoleScore;
      const scores = wolfLocked.scores.map((s) =>
        s.gross <= 0 ? { ...s, gross: par } : s,
      );
      locked = withComputedPoints({ ...wolfLocked, scores }, players, currentCarry);
    } else if (isBestBallHole(locked)) {
      const bb = locked as BestBallHoleScore;
      // Default unset scores to par
      const scores = bb.scores.map((s) => s.gross <= 0 ? { ...s, gross: par } : s);
      locked = { ...bb, scores, bestScore: computeBestScore(scores) ?? bb.bestScore };
    } else if (isScrambleHole(locked)) {
      const sc = locked as ScrambleHoleScore;
      if (sc.teamScore === null) locked = { ...sc, teamScore: par };
    }

    await saveHole(currentHole, locked);
    setShowLockConfirm(false);
    if (currentHole < round.holes - 1) setCurrentHole((h) => h + 1);
  };

  const handleUnlockHole = async () => {
    if (!hole) return;
    await saveHole(currentHole, { ...hole, locked: false });
  };

  const handleWolfChange = (updated: WolfHoleScore) => {
    setLocalHole(currentHole, updated);
  };

  const handleBestBallScoreChange = (playerId: string, gross: number) => {
    if (!isBestBallHole(hole)) return;
    const bb = hole as BestBallHoleScore;
    const scores = bb.scores.map((s) =>
      s.playerId === playerId ? { ...s, gross } : s,
    );
    const bestScore = computeBestScore(scores);
    setLocalHole(currentHole, { ...bb, scores, bestScore });
  };

  const handleScrambleChange = (teamScore: number) => {
    if (!isScrambleHole(hole)) return;
    setLocalHole(currentHole, { ...(hole as ScrambleHoleScore), teamScore });
  };

  const handleEditNameSave = async () => {
    const trimmed = nameInput.trim();
    if (trimmed) await updateGroupName(trimmed);
    setEditingName(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Offline banner */}
      {!online && (
        <div className="bg-yellow-900 text-yellow-200 text-xs text-center py-2 px-4">
          Offline — scores will sync when you reconnect
        </div>
      )}

      <HoleHeader
        holeNumber={currentHole + 1}
        par={par}
        groupName={group.name}
        roundName={round.name}
        courseName={courseName}
        onEditGroupName={() => {
          setNameInput(group.name);
          setEditingName(true);
        }}
      />

      <HoleNav
        currentHole={currentHole}
        totalHoles={round.holes}
        lockedHoles={lockedHoles}
        onHoleChange={setCurrentHole}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {hole?.locked && (
          <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-4 py-3 mb-3 border border-gray-700">
            <span className="text-lg">🔒</span>
            <span className="text-gray-300 text-sm flex-1">Hole locked</span>
            <button
              onPointerDown={handleUnlockHole}
              className="text-yellow-400 text-sm font-medium"
            >
              Unlock
            </button>
          </div>
        )}

        {round.format === 'wolf' && isWolfHole(hole) && (
          <>
            <WolfControls
              hole={hole as WolfHoleScore}
              players={players}
              par={par}
              holeIndex={currentHole}
              disabled={hole.locked}
              carry={currentCarry}
              runningPoints={runningPoints}
              runningRelativeToPar={runningRelativeToPar}
              onChange={handleWolfChange}
            />
            {hole.locked && <div className="mt-3"><WolfHoleResult hole={hole as WolfHoleScore} players={players} /></div>}
          </>
        )}

        {round.format === 'bestBall' && isBestBallHole(hole) && (
          <BestBallRow
            players={players}
            scores={(hole as BestBallHoleScore).scores}
            par={par}
            disabled={hole.locked}
            onScoreChange={handleBestBallScoreChange}
            runningRelativeToPar={bestBallRunningRelativeToPar}
          />
        )}

        {round.format === 'scramble' && isScrambleHole(hole) && (
          <ScrambleInput
            value={(hole as ScrambleHoleScore).teamScore}
            par={par}
            disabled={hole.locked}
            onChange={handleScrambleChange}
            cumulativeScore={scrambleCumulative}
            holesLocked={scrambleHolesLocked}
          />
        )}
      </div>

      {/* Bottom action bar */}
      <div className="bg-gray-900 border-t border-gray-700 p-4 flex gap-3 pb-safe">
        <button
          onPointerDown={() => navigate('/')}
          className="h-14 px-4 rounded-xl bg-gray-700 text-gray-300 font-medium"
        >
          ← Rounds
        </button>
        <button
          onPointerDown={() => navigate(`/leaderboard/${round.id}`)}
          className="h-14 px-4 rounded-xl bg-gray-700 text-gray-300 font-medium"
        >
          Leaderboard
        </button>
        <div className="flex-1" />
        {!hole?.locked ? (
          <button
            onPointerDown={() => setShowLockConfirm(true)}
            disabled={saving}
            className="h-14 px-6 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save & Lock 🔒'}
          </button>
        ) : (
          <div className="h-14 px-6 rounded-xl bg-gray-700 text-gray-400 font-medium flex items-center">
            Hole {currentHole + 1} Locked
          </div>
        )}
      </div>

      {/* Lock confirmation modal */}
      {showLockConfirm && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-6">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-xl font-bold text-white mb-2">Lock Hole {currentHole + 1}?</h3>
            <p className="text-gray-400 text-sm mb-6">
              Scores will be saved. Any unset scores default to par. You can unlock if needed.
            </p>
            <div className="flex gap-3">
              <button
                onPointerDown={() => setShowLockConfirm(false)}
                className="flex-1 h-14 rounded-xl bg-gray-700 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onPointerDown={handleLockHole}
                className="flex-1 h-14 rounded-xl bg-green-600 text-white font-bold"
              >
                Lock It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Group name edit modal */}
      {editingName && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-6">
          <div className="bg-gray-800 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-xl font-bold text-white mb-4">Edit Group Name</h3>
            <input
              className="w-full bg-gray-700 rounded-xl px-3 py-3 text-white placeholder-gray-500 mb-4"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEditNameSave()}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onPointerDown={() => setEditingName(false)}
                className="flex-1 h-12 rounded-xl bg-gray-700 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onPointerDown={handleEditNameSave}
                disabled={!nameInput.trim()}
                className="flex-1 h-12 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
