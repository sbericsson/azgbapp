import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import {
  getTournament,
  listRounds,
  listCourses,
  listGroupsByRound,
  listAllScores,
  subscribeAllScores,
} from '../lib/firestore';
import type { Unsubscribe } from 'firebase/firestore';
import type { Group, Round, RoundFormat, Tournament } from '../types/tournament';
import type { GroupScoreDoc, WolfHoleScore, BestBallHoleScore, ScrambleHoleScore, GauntletHoleScore } from '../types/scoring';
import { totalWolfPoints, isWolfHole } from '../lib/scoring/wolf';
import { bestBallTotalToPar, isBestBallHole } from '../lib/scoring/bestBall';
import { scrambleTotalToPar, isScrambleHole } from '../lib/scoring/scramble';
import { gauntletTotalToPar, isGauntletHole } from '../lib/scoring/gauntlet';

const DAY_ORDER: Record<string, number> = {
  friday: 0,
  saturday_am: 1,
  saturday_pm: 2,
  sunday: 3,
};

function fmtScore(n: number, format: RoundFormat): string {
  if (format === 'wolf') return `${n} pts`;
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}

interface RoundEntry {
  group: Group;
  score: number;
  holesCompleted: number;
  playerPoints?: { name: string; pts: number }[];
  playerTotals?: { name: string; total: number }[];
  scoreDoc?: GroupScoreDoc;
}

interface RoundResult {
  round: Round;
  courseName?: string;
  entries: RoundEntry[];
}

function computeRoundEntries(
  round: Round,
  groups: Group[],
  scoreDocs: GroupScoreDoc[],
): RoundEntry[] {
  return groups.map((group) => {
    const scoreDoc = scoreDocs.find((d) => d.groupId === group.id);
    if (!scoreDoc) return { group, score: 0, holesCompleted: 0 };

    const lockedHoles = scoreDoc.holes.filter((h) => h.locked);
    const holesCompleted = lockedHoles.length;

    if (round.format === 'wolf') {
      const wolfHoles = lockedHoles.filter(isWolfHole) as WolfHoleScore[];
      const playerPoints = group.players.map((p) => ({
        name: p.name,
        pts: totalWolfPoints(wolfHoles, p.id),
      }));
      return {
        group,
        score: playerPoints.reduce((s, p) => s + p.pts, 0),
        holesCompleted,
        playerPoints,
        scoreDoc,
      };
    }

    if (round.format === 'bestBall') {
      const bbHoles = lockedHoles.filter(isBestBallHole) as BestBallHoleScore[];
      const teamScore = bestBallTotalToPar(bbHoles, round.par);
      const playerTotals = group.players.map((p) => {
        const total = (scoreDoc.holes as BestBallHoleScore[]).reduce((sum, h, i) => {
          if (!h.locked) return sum;
          const s = h.scores?.find((sc) => sc.playerId === p.id);
          return s && s.gross > 0 ? sum + (s.gross - (round.par[i] ?? 4)) : sum;
        }, 0);
        return { name: p.name, total };
      });
      return { group, score: teamScore, holesCompleted, playerTotals, scoreDoc };
    }

    if (round.format === 'gauntlet') {
      const gHoles = lockedHoles.filter(isGauntletHole) as GauntletHoleScore[];
      return { group, score: gauntletTotalToPar(gHoles, round.par), holesCompleted, scoreDoc };
    }

    const sHoles = lockedHoles.filter(isScrambleHole) as ScrambleHoleScore[];
    return { group, score: scrambleTotalToPar(sHoles, round.par), holesCompleted, scoreDoc };
  });
}

function dayLabel(day: string) {
  if (day === 'saturday_am') return 'Saturday AM';
  if (day === 'saturday_pm') return 'Saturday PM';
  return day.charAt(0).toUpperCase() + day.slice(1);
}

function formatLabel(format: RoundFormat) {
  if (format === 'bestBall') return 'Best Ball';
  return format.charAt(0).toUpperCase() + format.slice(1);
}

interface SelectedDetail {
  entry: RoundEntry;
  round: Round;
}

export function PublicResults() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [selected, setSelected] = useState<SelectedDetail | null>(null);
  const requestKey = tournamentId ?? 'missing';
  const [pageState, setPageState] = useState<{
    requestKey: string;
    tournament: Tournament | null;
    results: RoundResult[];
    notFound: boolean;
  }>({
    requestKey: '',
    tournament: null,
    results: [],
    notFound: false,
  });

  // Stable refs for live-update callbacks to avoid stale closures
  const groupsByRoundRef = useRef<Record<string, Group[]>>({});
  const subscriptionsRef = useRef<Unsubscribe[]>([]);

  useEffect(() => {
    if (!tournamentId) {
      return;
    }
    let cancelled = false;

    (async () => {
      const t = await getTournament(tournamentId).catch(() => null);
      if (!t) {
        if (!cancelled) {
          setPageState({
            requestKey,
            tournament: null,
            results: [],
            notFound: true,
          });
        }
        return;
      }

      const [rounds, courses] = await Promise.all([
        listRounds(tournamentId),
        listCourses(tournamentId),
      ]);

      const courseMap = Object.fromEntries(courses.map((c) => [c.id, c.name]));
      const visibleRounds = rounds
        .filter((r) => r.status === 'complete' || r.status === 'active')
        .sort((a, b) => (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99));

      const roundResults: RoundResult[] = await Promise.all(
        visibleRounds.map(async (round) => {
          const [groups, scoreDocs] = await Promise.all([
            listGroupsByRound(tournamentId, round.id),
            listAllScores(tournamentId, round.id),
          ]);
          groupsByRoundRef.current[round.id] = groups;
          const entries = computeRoundEntries(round, groups, scoreDocs);
          const sortedEntries = [...entries].sort((a, b) =>
            round.format === 'wolf' ? b.score - a.score : a.score - b.score,
          );
          return {
            round,
            courseName: round.courseId ? courseMap[round.courseId] : undefined,
            entries: sortedEntries,
          };
        }),
      );

      if (cancelled) return;
      setPageState({
        requestKey,
        tournament: t,
        results: roundResults,
        notFound: false,
      });

      // Subscribe to live score updates for active rounds
      visibleRounds
        .filter((r) => r.status === 'active')
        .forEach((round) => {
          const unsub = subscribeAllScores(tournamentId, round.id, (scoreDocs) => {
            const groups = groupsByRoundRef.current[round.id] ?? [];
            const entries = computeRoundEntries(round, groups, scoreDocs);
            const sortedEntries = [...entries].sort((a, b) =>
              round.format === 'wolf' ? b.score - a.score : a.score - b.score,
            );
            setPageState((prev) =>
              prev.requestKey !== requestKey
                ? prev
                : {
                    ...prev,
                    results: prev.results.map((r) =>
                      r.round.id === round.id ? { ...r, entries: sortedEntries } : r,
                    ),
                  },
            );
          });
          subscriptionsRef.current.push(unsub);
        });
    })();

    return () => {
      cancelled = true;
      subscriptionsRef.current.forEach((unsub) => unsub());
      subscriptionsRef.current = [];
    };
  }, [requestKey, tournamentId]);

  const loading = Boolean(tournamentId) && pageState.requestKey !== requestKey;
  const tournament = pageState.requestKey === requestKey ? pageState.tournament : null;
  const results = pageState.requestKey === requestKey ? pageState.results : [];
  const notFound = !tournamentId || (pageState.requestKey === requestKey && pageState.notFound);

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">⛳</p>
          <p className="text-gray-300 font-medium">Tournament not found.</p>
          <p className="text-gray-500 text-sm mt-1">Check the link and try again.</p>
        </div>
      </div>
    );
  }

  const logoSrc = tournament?.logoUrl || '/azgb-logo.png';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 px-4 py-4 border-b border-gray-700 flex items-center gap-3">
        <img
          src={logoSrc}
          alt={tournament?.name ?? 'Tournament'}
          className="h-10 w-auto bg-white rounded-lg p-0.5"
          onError={(e) => { (e.target as HTMLImageElement).src = '/azgb-logo.png'; }}
        />
        <div>
          <h1 className="text-lg font-bold">{tournament?.name ?? 'Tournament Results'}</h1>
          <p className="text-gray-400 text-xs">Tournament Results</p>
        </div>
      </header>

      <div className="p-4 max-w-2xl mx-auto">
        {loading && (
          <p className="text-gray-400 text-center py-8">Loading results…</p>
        )}

        {!loading && results.length === 0 && (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🏌️</p>
            <p className="text-gray-400">No results yet.</p>
            <p className="text-gray-500 text-sm mt-1">Check back when rounds are underway.</p>
          </div>
        )}

        <div className="flex flex-col gap-8">
          {results.map((result, idx) => {
            const { round, courseName, entries } = result;
            const isWolf = round.format === 'wolf';
            const isBestBallFmt = round.format === 'bestBall';

            return (
              <div key={round.id} className="bg-gray-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between gap-2">
                  <p className="font-bold">
                    Round {idx + 1} · {dayLabel(round.day)} · {formatLabel(round.format)}
                    {courseName ? ` · ${courseName}` : ''}
                  </p>
                  {round.status === 'active' && (
                    <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full font-medium shrink-0">Live</span>
                  )}
                </div>

                {entries.length === 0 ? (
                  <p className="text-gray-500 text-sm px-4 py-3">No groups.</p>
                ) : (
                  <div className="divide-y divide-gray-700">
                    {entries.map((entry, rank) => {
                      const playerLine = isWolf
                        ? (entry.playerPoints ?? []).map((pp) => `${pp.name}: ${pp.pts} pts`).join(' · ')
                        : isBestBallFmt
                        ? (entry.playerTotals ?? []).map((pt) => `${pt.name}: ${fmtScore(pt.total, 'bestBall')}`).join(' · ')
                        : entry.group.players.map((p) => p.name).join(' · ');

                      const hasScores = entry.holesCompleted > 0 && !!entry.scoreDoc;
                      return (
                        <button
                          key={entry.group.id}
                          onClick={() => hasScores ? setSelected({ entry, round }) : undefined}
                          disabled={!hasScores}
                          className={`w-full px-4 py-3 flex items-start justify-between gap-3 text-left ${hasScores ? 'active:bg-gray-700/50' : ''}`}
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="text-gray-500 text-sm w-5 shrink-0 mt-0.5">{rank + 1}</span>
                            <div className="min-w-0">
                              <p className={`font-medium text-sm ${hasScores ? 'text-white' : 'text-gray-400'}`}>{entry.group.name}</p>
                              {playerLine && (
                                <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{playerLine}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex items-center gap-2">
                            <div>
                              <span className="font-bold text-sm block">
                                {entry.holesCompleted === 0 ? '—' : fmtScore(entry.score, round.format)}
                              </span>
                              {round.status === 'active' && entry.holesCompleted > 0 && entry.holesCompleted < round.holes && (
                                <span className="text-gray-500 text-xs">thru {entry.holesCompleted}</span>
                              )}
                            </div>
                            {hasScores && <span className="text-gray-600 text-xs">›</span>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {selected && (
        <HoleDetailModal
          entry={selected.entry}
          round={selected.round}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface HoleDetailModalProps {
  entry: RoundEntry;
  round: Round;
  onClose: () => void;
}

function scoreColor(gross: number, par: number) {
  if (gross < par) return 'text-red-400';
  if (gross === par) return 'text-white';
  return 'text-blue-400';
}

function HoleDetailModal({ entry, round, onClose }: HoleDetailModalProps) {
  const { group, scoreDoc } = entry;
  const holes = scoreDoc?.holes ?? [];
  const lockedHoles = holes.filter((h) => h.locked);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-gray-900 rounded-t-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-4 border-b border-gray-700 flex items-center justify-between shrink-0">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide">{round.name}</p>
            <h2 className="text-lg font-bold">{group.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl p-2 -mr-2">✕</button>
        </div>

        {/* Wolf running totals */}
        {round.format === 'wolf' && entry.playerPoints && (
          <div className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex gap-4 flex-wrap shrink-0">
            {entry.playerPoints.map((pp) => (
              <div key={pp.name} className="text-center">
                <p className="text-gray-400 text-xs">{pp.name.split(' ')[0]}</p>
                <p className={`font-bold ${pp.pts > 0 ? 'text-green-400' : 'text-gray-500'}`}>{pp.pts}</p>
              </div>
            ))}
          </div>
        )}

        {/* Hole list */}
        <div className="overflow-y-auto flex-1 p-4 flex flex-col gap-3">
          {lockedHoles.length === 0 && (
            <p className="text-gray-400 text-center py-8">No holes locked yet.</p>
          )}

          {holes.map((hole, i) => {
            if (!hole.locked) return null;
            const par = round.par[i] ?? 4;

            return (
              <div key={i} className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="font-bold text-sm">Hole {i + 1}</p>
                  <p className="text-gray-400 text-xs">Par {par}</p>
                </div>

                {round.format === 'wolf' && isWolfHole(hole) && (() => {
                  const wolfHole = hole as WolfHoleScore;
                  const isTied = wolfHole.points.every((p) => p.pts === 0);
                  return (
                    <div className="flex flex-col gap-2">
                      <div className="grid grid-cols-2 gap-2">
                        {group.players.map((p) => {
                          const s = wolfHole.scores.find((sc) => sc.playerId === p.id);
                          const pts = wolfHole.points.find((pt) => pt.playerId === p.id)?.pts ?? 0;
                          const isWolf = wolfHole.wolfPlayerId === p.id;
                          return (
                            <div key={p.id} className="bg-gray-700/50 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-between">
                                <span className="text-gray-200 text-xs">{p.name.split(' ')[0]}{isWolf ? ' 🐺' : ''}</span>
                                <span className={`font-bold text-sm ${pts > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                                  {pts > 0 ? `+${pts}` : '—'}
                                </span>
                              </div>
                              {s && s.gross > 0 && (
                                <span className={`text-xs ${scoreColor(s.gross, par)}`}>{s.gross}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {isTied && (
                        <p className="text-amber-300 text-xs text-center">Tied — carry {wolfHole.carry + 1}→next</p>
                      )}
                    </div>
                  );
                })()}

                {round.format === 'bestBall' && isBestBallHole(hole) && (() => {
                  const bbHole = hole as BestBallHoleScore;
                  return (
                    <div className="flex flex-col gap-1">
                      {bbHole.scores.map((s) => {
                        const name = group.players.find((p) => p.id === s.playerId)?.name ?? s.playerId;
                        return (
                          <div key={s.playerId} className="flex justify-between">
                            <span className="text-gray-300 text-sm">{name}</span>
                            <span className={`text-sm font-bold ${scoreColor(s.gross, par)}`}>{s.gross || '—'}</span>
                          </div>
                        );
                      })}
                      {bbHole.bestScore !== null && (
                        <div className="mt-1 pt-1 border-t border-gray-700 flex justify-between">
                          <span className="text-gray-400 text-xs">Best</span>
                          <span className={`text-sm font-bold ${scoreColor(bbHole.bestScore, par)}`}>{bbHole.bestScore}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {(round.format === 'scramble' || round.format === 'gauntlet') && isScrambleHole(hole) && (() => {
                  const sHole = hole as ScrambleHoleScore;
                  return (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300 text-sm">Team score</span>
                      <span className={`font-bold ${sHole.teamScore !== null ? scoreColor(sHole.teamScore, par) : 'text-gray-500'}`}>
                        {sHole.teamScore ?? '—'}
                      </span>
                    </div>
                  );
                })()}

                {round.format === 'gauntlet' && isGauntletHole(hole) && (() => {
                  const gHole = hole as GauntletHoleScore;
                  return (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-300 text-sm">
                        {gHole.segment === 'bestBall' ? 'Best Ball' : gHole.segment === 'scramble' ? 'Scramble' : 'Alt Shot'}
                      </span>
                      <span className={`font-bold ${gHole.teamScore !== null ? scoreColor(gHole.teamScore, par) : 'text-gray-500'}`}>
                        {gHole.teamScore ?? '—'}
                      </span>
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
