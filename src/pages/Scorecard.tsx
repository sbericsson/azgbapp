import { useState, useEffect, useContext, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { useGroup } from '../hooks/useGroup';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { subscribeRound, getCourse, subscribeGroupsByRound } from '../lib/firestore';
import type { Round, Group } from '../types/tournament';
import type { WolfHoleScore, BestBallHoleScore, ScrambleHoleScore, GauntletHoleScore, HoleScore } from '../types/scoring';
import { HoleHeader } from '../components/scorecard/HoleHeader';
import { HoleNav } from '../components/scorecard/HoleNav';
import { WolfControls } from '../components/scorecard/WolfControls';
import { WolfHoleResult } from '../components/scorecard/WolfHoleResult';
import { BestBallRow } from '../components/scorecard/BestBallRow';
import { ScrambleInput } from '../components/scorecard/ScrambleInput';
import { HoleFeedbackToast } from '../components/scorecard/HoleFeedbackToast';
import { withComputedPoints, isWolfHole } from '../lib/scoring/wolf';
import {
  deriveWolfHoles,
  wolfPlayerTotals,
  playerToPar,
  teamToPar,
  lockedCount,
} from '../lib/scoring/standings';
import { computeBestScore, isBestBallHole } from '../lib/scoring/bestBall';
import { isScrambleHole } from '../lib/scoring/scramble';
import { isGauntletHole, getAltShotTeeOffIndex } from '../lib/scoring/gauntlet';
import { generateWolfFeedback } from '../lib/scoring/feedback';
import { buildFallbackFeedback, getAIFeedback } from '../lib/scoring/feedbackAI';
import type { AIFeedbackContext } from '../lib/scoring/feedbackAI';
import type { LeaderboardEntry } from '../hooks/useLeaderboard';

export function Scorecard() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const { group, updateGroupName, tournamentId } = useContext(AuthContext);

  const [round, setRound] = useState<Round | null>(null);
  const [roundLoaded, setRoundLoaded] = useState(false);
  const [courseName, setCourseName] = useState<string | undefined>();
  const [currentHole, setCurrentHole] = useState(0);
  const [showLockConfirm, setShowLockConfirm] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackAutoDismiss, setFeedbackAutoDismiss] = useState(true);
  const [allGroups, setAllGroups] = useState<Group[]>([]);
  const feedbackHistoryRef = useRef<string[]>([]);
  // Guards against a double tap on "Lock It" (B8) and tracks the pending auto-advance
  const lockingRef = useRef(false);
  const advanceTimerRef = useRef<number | null>(null);

  const players = group?.players ?? [];
  const hasJumpedToCurrentHole = useRef(false);
  const { holes, loading, pendingSync, saveError, saveHole, setLocalHole } = useGroup(
    tournamentId,
    round,
    group?.id ?? null,
    players,
  );

  // Live round subscription so status changes (e.g. complete) reach the phone (B13)
  useEffect(() => {
    if (!roundId || !tournamentId) return;
    return subscribeRound(tournamentId, roundId, (r) => {
      setRound((prev) => {
        // Keep the same object when nothing relevant changed so useGroup does not resubscribe
        if (prev && r && JSON.stringify(prev) === JSON.stringify(r)) return prev;
        return r;
      });
      setRoundLoaded(true);
    });
  }, [roundId, tournamentId]);

  const courseId = round?.courseId;
  useEffect(() => {
    if (!tournamentId || !courseId) return;
    getCourse(tournamentId, courseId).then((c) => setCourseName(c?.name)).catch(() => {});
  }, [tournamentId, courseId]);

  // Cancel a pending auto-advance on unmount
  useEffect(() => () => {
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
  }, []);

  const goToHole = (i: number) => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    setCurrentHole(i);
  };

  // On first load, jump to the first unlocked hole so returning players land on their active hole
  useEffect(() => {
    if (hasJumpedToCurrentHole.current || loading || holes.length === 0) return;
    hasJumpedToCurrentHole.current = true;
    const firstUnlocked = holes.findIndex((h) => !h.locked);
    if (firstUnlocked > 0) {
      const timer = window.setTimeout(() => setCurrentHole(firstUnlocked), 0);
      return () => window.clearTimeout(timer);
    }
  }, [loading, holes]);

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

  // Subscribe to all groups in this round (for leaderboard rank — bestBall/scramble only)
  useEffect(() => {
    if (!roundId || !round || round.format === 'wolf' || !tournamentId) return;
    return subscribeGroupsByRound(tournamentId, roundId, setAllGroups);
  }, [roundId, round, tournamentId]);

  const leaderboardRound = round?.format !== 'wolf' ? round : null;
  const { entries: lbEntries } = useLeaderboard(tournamentId, leaderboardRound, allGroups);
  // Swipe to navigate holes. Ignores mostly-vertical gestures and swipes that
  // start inside the hole strip (which scrolls horizontally on its own) (B16).
  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let ignore = false;
    const onTouchStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      ignore = e.target instanceof Element && e.target.closest('[data-no-swipe]') !== null;
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (ignore) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      const clear = () => {
        if (advanceTimerRef.current !== null) {
          window.clearTimeout(advanceTimerRef.current);
          advanceTimerRef.current = null;
        }
      };
      if (dx < 0 && currentHole < (round?.holes ?? 18) - 1) { clear(); setCurrentHole((h) => h + 1); }
      if (dx > 0 && currentHole > 0) { clear(); setCurrentHole((h) => h - 1); }
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
        <p className="text-gray-400">{loading || !roundLoaded ? 'Loading…' : 'Round not found'}</p>
      </div>
    );
  }

  const activeGroup = group;
  const isComplete = round.status === 'complete';
  const par = round.par[currentHole] ?? 4;
  const hole = holes[currentHole];
  const lockedHoles = holes.map((h) => h?.locked ?? false);

  // Wolf holes require a mode (lone wolf or partner) before locking
  const canLock = !(
    hole && isWolfHole(hole) &&
    (hole as WolfHoleScore).loneWolfType === null &&
    (hole as WolfHoleScore).partnerId === null
  );

  // Wolf carry and points are derived from the stored inputs for the whole
  // round, so unlocking and correcting an earlier hole updates later ones (B3).
  const derivedWolfHoles = round.format === 'wolf' && holes.every(isWolfHole)
    ? deriveWolfHoles(holes as WolfHoleScore[], players)
    : [];
  const currentCarry = derivedWolfHoles[currentHole]?.carry ?? 0;
  const runningPoints = round.format === 'wolf'
    ? wolfPlayerTotals(derivedWolfHoles, players).map(({ playerId, pts }) => ({ playerId, pts }))
    : [];
  const perPlayerToPar = (round.format === 'wolf' || round.format === 'bestBall')
    ? players.map((p) => ({
        playerId: p.id,
        relativeToPar: playerToPar(holes, round.par, p.id, currentHole),
      }))
    : [];
  const runningRelativeToPar = round.format === 'wolf' ? perPlayerToPar : [];
  const bestBallRunningRelativeToPar = round.format === 'bestBall' ? perPlayerToPar : [];

  // Team running total through the current hole (scramble / gauntlet)
  const teamCumulative = teamToPar(holes, round.par, currentHole);
  const teamHolesLocked = lockedCount(holes, currentHole);
  const scrambleCumulative = round.format === 'scramble' ? teamCumulative : null;
  const scrambleHolesLocked = round.format === 'scramble' ? teamHolesLocked : 0;
  const gauntletCumulative = round.format === 'gauntlet' ? teamCumulative : null;
  const gauntletHolesLocked = round.format === 'gauntlet' ? teamHolesLocked : 0;

  function buildAIContext(
    locked: BestBallHoleScore | ScrambleHoleScore | GauntletHoleScore,
    holeIndex: number,
    allHoles: HoleScore[],
    lbEntriesSnap: LeaderboardEntry[],
    groupName: string,
  ): AIFeedbackContext {
    const format = round!.format as 'bestBall' | 'scramble' | 'gauntlet';
    const roundPar = round!.par;

    // All holes with the current index replaced by the locked version
    const mergedHoles = allHoles.map((h, i) => (i === holeIndex ? locked : h));

    // Per-player running totals for bestBall
    const playerRunning = players.map((p) => {
      let total = 0;
      if (format === 'bestBall') {
        for (let i = 0; i <= holeIndex; i++) {
          const h = mergedHoles[i];
          if (!h?.locked || !isBestBallHole(h)) continue;
          const s = (h as BestBallHoleScore).scores.find((sc) => sc.playerId === p.id);
          if (s && s.gross > 0) total += s.gross - (roundPar[i] ?? 4);
        }
      }
      return { name: p.name, runningToPar: total };
    });

    // Helper: find the player with the best (lowest) score on a bestBall hole
    function getBestBallLeadPlayer(bb: BestBallHoleScore): string | undefined {
      let best: { playerId: string; gross: number } | null = null;
      for (const s of bb.scores) {
        if (s.gross > 0 && (!best || s.gross < best.gross)) best = s;
      }
      return best ? players.find((p) => p.id === best!.playerId)?.name : undefined;
    }

    // Hole history: locked holes before holeIndex, in order
    const holeHistory: AIFeedbackContext['holeHistory'] = [];
    for (let i = 0; i < holeIndex; i++) {
      const h = mergedHoles[i];
      if (!h?.locked) continue;
      const p = roundPar[i] ?? 4;
      if (isBestBallHole(h)) {
        const bb = h as BestBallHoleScore;
        holeHistory.push({ holeNum: i + 1, par: p, rel: (bb.bestScore ?? p) - p, leadPlayer: getBestBallLeadPlayer(bb) });
      } else if (isScrambleHole(h)) {
        holeHistory.push({ holeNum: i + 1, par: p, rel: ((h as ScrambleHoleScore).teamScore ?? p) - p });
      } else if (isGauntletHole(h)) {
        holeHistory.push({ holeNum: i + 1, par: p, rel: ((h as GauntletHoleScore).teamScore ?? p) - p });
      }
    }

    // Current hole result
    const curPar = roundPar[holeIndex] ?? 4;
    let currentHoleCtx: AIFeedbackContext['currentHole'];
    if (isBestBallHole(locked)) {
      const bb = locked as BestBallHoleScore;
      currentHoleCtx = { holeNum: holeIndex + 1, par: curPar, rel: (bb.bestScore ?? curPar) - curPar, leadPlayer: getBestBallLeadPlayer(bb) };
    } else if (isScrambleHole(locked)) {
      currentHoleCtx = { holeNum: holeIndex + 1, par: curPar, rel: ((locked as ScrambleHoleScore).teamScore ?? curPar) - curPar };
    } else {
      currentHoleCtx = { holeNum: holeIndex + 1, par: curPar, rel: ((locked as GauntletHoleScore).teamScore ?? curPar) - curPar };
    }

    // Team running total through holeIndex
    let runningTotal = 0;
    for (let i = 0; i <= holeIndex; i++) {
      const h = mergedHoles[i];
      if (!h?.locked) continue;
      const p = roundPar[i] ?? 4;
      if (isBestBallHole(h)) runningTotal += ((h as BestBallHoleScore).bestScore ?? p) - p;
      else if (isScrambleHole(h)) runningTotal += ((h as ScrambleHoleScore).teamScore ?? p) - p;
      else if (isGauntletHole(h)) runningTotal += ((h as GauntletHoleScore).teamScore ?? p) - p;
    }

    const leaderboard = lbEntriesSnap.map((e) => ({
      groupId: e.groupId,
      groupName: e.groupName,
      score: e.score,
      holesPlayed: e.holesCompleted,
    }));

    const ourHolesCompleted = mergedHoles.filter((h) => h?.locked).length;
    const groupsForBoard = allGroups.length > 0
      ? allGroups
      : [{ ...activeGroup, name: groupName }];
    const boardWithCurrent = groupsForBoard
      .map((g) => {
        if (g.id === activeGroup.id) {
          return {
            groupId: g.id,
            groupName,
            score: runningTotal,
            holesPlayed: ourHolesCompleted,
          };
        }

        const existing = leaderboard.find((entry) => entry.groupId === g.id);
        return {
          groupId: g.id,
          groupName: existing?.groupName ?? g.name,
          score: existing?.score ?? 0,
          holesPlayed: existing?.holesPlayed ?? 0,
        };
      })
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
        return a.groupName.localeCompare(b.groupName);
      });

    const ourIndex = boardWithCurrent.findIndex((entry) => entry.groupId === activeGroup.id);
    const rank = ourIndex >= 0 ? ourIndex + 1 : null;
    const leaderScore = boardWithCurrent[0]?.score ?? runningTotal;
    const strokesFromLead = boardWithCurrent.length > 0 ? runningTotal - leaderScore : null;
    const teamsAtLead = boardWithCurrent.filter((entry) => entry.score === leaderScore).length;
    const standing: AIFeedbackContext['standing'] =
      boardWithCurrent.length <= 1
        ? 'solo'
        : strokesFromLead === 0
          ? (teamsAtLead > 1 ? 'tiedLead' : 'leading')
          : 'trailing';

    return {
      format,
      roundName: round!.name,
      totalHoles: round!.holes,
      players: playerRunning,
      holeHistory,
      currentHole: currentHoleCtx,
      runningTotal,
      rank,
      totalGroups: boardWithCurrent.length,
      standing,
      strokesFromLead,
      leaderboard: boardWithCurrent.map(({ groupName: name, score, holesPlayed }) => ({
        groupName: name,
        score,
        holesPlayed,
      })),
      ourGroupName: groupName,
      recentFeedback: feedbackHistoryRef.current.slice(-3),
    };
  }

  const handleLockHole = () => {
    if (!hole || hole.locked || lockingRef.current) return;
    if (isWolfHole(hole)) {
      const w = hole as WolfHoleScore;
      if (w.loneWolfType === null && w.partnerId === null) return;
    }
    lockingRef.current = true;
    const lockedHoleIndex = currentHole;
    // Close the confirmation immediately; the save is local-first and does not
    // wait for the network (B1).
    setShowLockConfirm(false);
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
    } else if (isGauntletHole(locked)) {
      const g = locked as GauntletHoleScore;
      if (g.teamScore === null) locked = { ...g, teamScore: par };
    }

    saveHole(lockedHoleIndex, locked);

    // Generate post-lock commentary
    if (isWolfHole(locked)) {
      // Wolf: synchronous static feedback, auto-dismiss
      setFeedbackAutoDismiss(true);
      const message = generateWolfFeedback(locked as WolfHoleScore, players, par);
      feedbackHistoryRef.current = [...feedbackHistoryRef.current.slice(-4), message];
      setFeedbackMessage(message);
    } else {
      // bestBall / scramble / gauntlet: async AI feedback with static fallback
      setFeedbackLoading(true);
      setFeedbackMessage(null);
      const aiCtx = buildAIContext(
        locked as BestBallHoleScore | ScrambleHoleScore | GauntletHoleScore,
        lockedHoleIndex,
        holes,
        lbEntries,
        activeGroup.name,
      );
      let aiSucceeded = false;
      getAIFeedback(aiCtx)
        .then((msg): string => { aiSucceeded = true; return msg; })
        .catch((): string => buildFallbackFeedback(aiCtx))
        .then((msg) => {
          setFeedbackAutoDismiss(!aiSucceeded);
          feedbackHistoryRef.current = [...feedbackHistoryRef.current.slice(-4), msg];
          setFeedbackMessage(msg);
          setFeedbackLoading(false);
        });
    }
    // Delay auto-advance 1.5 s so users can read the toast. Advance to the
    // hole after the one just locked, and cancel if the golfer navigates first.
    if (lockedHoleIndex < round.holes - 1) {
      if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        setCurrentHole(lockedHoleIndex + 1);
      }, 1500);
    }
  };

  const handleUnlockHole = () => {
    if (!hole) return;
    saveHole(currentHole, { ...hole, locked: false });
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

  const handleGauntletChange = (teamScore: number) => {
    if (!isGauntletHole(hole)) return;
    setLocalHole(currentHole, { ...(hole as GauntletHoleScore), teamScore });
  };

  const handleEditNameSave = async () => {
    const trimmed = nameInput.trim();
    if (trimmed) await updateGroupName(trimmed);
    setEditingName(false);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Sync status */}
      {saveError ? (
        <div className="bg-red-900 text-red-200 text-xs text-center py-2 px-4" role="alert">
          Save rejected by the server. Unlock and lock the hole again, or ask the organiser.
        </div>
      ) : !online ? (
        <div className="bg-yellow-900 text-yellow-200 text-xs text-center py-2 px-4" role="status">
          Offline. Scores are saved on this phone and will sync when you reconnect.
        </div>
      ) : pendingSync ? (
        <div className="bg-gray-800 text-gray-300 text-xs text-center py-1.5 px-4" role="status">
          Saved on this phone · syncing…
        </div>
      ) : null}

      <HoleHeader
        holeNumber={currentHole + 1}
        par={par}
        groupName={group.name}
        roundName={round.name}
        courseName={courseName}
        onEditGroupName={isComplete ? undefined : () => {
          setNameInput(group.name);
          setEditingName(true);
        }}
      />

      <HoleNav
        currentHole={currentHole}
        totalHoles={round.holes}
        lockedHoles={lockedHoles}
        onHoleChange={goToHole}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {hole?.locked && (
          <div className="flex items-center gap-2 bg-gray-800 rounded-xl px-4 py-3 mb-3 border border-gray-700">
            <span className="text-lg">🔒</span>
            <span className="text-gray-300 text-sm flex-1">Hole locked</span>
            {!isComplete && (
              <button
                onClick={handleUnlockHole}
                className="text-yellow-400 text-sm font-medium"
              >
                Unlock
              </button>
            )}
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
            {hole.locked && derivedWolfHoles[currentHole] && (
              <div className="mt-3"><WolfHoleResult hole={derivedWolfHoles[currentHole]} players={players} /></div>
            )}
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

        {round.format === 'gauntlet' && isGauntletHole(hole) && (
          <>
            <div className="bg-gray-800 rounded-xl px-4 py-2.5 mb-3 text-center border border-gray-700">
              {(hole as GauntletHoleScore).segment === 'bestBall' && (
                <p className="text-gray-300 text-sm font-medium">Best Ball · Holes 1–6</p>
              )}
              {(hole as GauntletHoleScore).segment === 'scramble' && (
                <p className="text-gray-300 text-sm font-medium">Scramble · Holes 7–12</p>
              )}
              {(hole as GauntletHoleScore).segment === 'altShot' && (
                <>
                  <p className="text-gray-300 text-sm font-medium">Alternate Shot · Holes 13–18</p>
                  <p className="text-blue-400 text-xs mt-0.5 font-medium">
                    {players[getAltShotTeeOffIndex(currentHole, round.holes)]?.name ?? 'Player 1'} tees off
                  </p>
                </>
              )}
            </div>
            <ScrambleInput
              value={(hole as GauntletHoleScore).teamScore}
              par={par}
              disabled={hole.locked}
              onChange={handleGauntletChange}
              cumulativeScore={gauntletCumulative}
              holesLocked={gauntletHolesLocked}
            />
          </>
        )}
      </div>

      {/* Bottom action bar */}
      <div className="bg-gray-900 border-t border-gray-700 p-4 flex gap-3 pb-safe">
        <button
          onClick={() => navigate('/')}
          className="h-14 px-4 rounded-xl bg-gray-700 text-gray-300 font-medium"
        >
          ← Rounds
        </button>
        <button
          onClick={() => navigate(`/leaderboard/${round.id}`)}
          className="h-14 px-4 rounded-xl bg-gray-700 text-gray-300 font-medium"
        >
          Leaderboard
        </button>
        <div className="flex-1" />
        {isComplete ? (
          <div className="h-14 px-6 rounded-xl bg-gray-800 border border-gray-700 text-gray-400 font-medium flex items-center gap-2">
            <span>🏁</span> Round Complete
          </div>
        ) : !hole?.locked ? (
          canLock ? (
            <button
              onClick={() => { lockingRef.current = false; setShowLockConfirm(true); }}
              className="h-14 px-6 rounded-xl bg-green-600 text-white font-bold disabled:opacity-40 flex items-center justify-center"
            >
              Save & Lock 🔒
            </button>
          ) : (
            <div className="h-14 px-6 rounded-xl bg-green-600/40 text-white/40 font-bold flex items-center justify-center">
              Save & Lock 🔒
            </div>
          )
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
                onClick={() => setShowLockConfirm(false)}
                className="flex-1 h-14 rounded-xl bg-gray-700 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleLockHole}
                className="flex-1 h-14 rounded-xl bg-green-600 text-white font-bold"
              >
                Lock It
              </button>
            </div>
          </div>
        </div>
      )}

      <HoleFeedbackToast
        message={feedbackMessage}
        loading={feedbackLoading}
        autoDismiss={feedbackAutoDismiss}
        onDismiss={() => { setFeedbackMessage(null); setFeedbackLoading(false); setFeedbackAutoDismiss(true); }}
      />

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
                onClick={() => setEditingName(false)}
                className="flex-1 h-12 rounded-xl bg-gray-700 text-gray-300 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleEditNameSave}
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
