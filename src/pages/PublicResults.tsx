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
      return { group, score: teamScore, holesCompleted, playerTotals };
    }

    if (round.format === 'gauntlet') {
      const gHoles = lockedHoles.filter(isGauntletHole) as GauntletHoleScore[];
      return { group, score: gauntletTotalToPar(gHoles, round.par), holesCompleted };
    }

    const sHoles = lockedHoles.filter(isScrambleHole) as ScrambleHoleScore[];
    return { group, score: scrambleTotalToPar(sHoles, round.par), holesCompleted };
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

export function PublicResults() {
  const { tournamentId } = useParams<{ tournamentId: string }>();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Stable refs for live-update callbacks to avoid stale closures
  const groupsByRoundRef = useRef<Record<string, Group[]>>({});
  const subscriptionsRef = useRef<Unsubscribe[]>([]);

  useEffect(() => {
    if (!tournamentId) { setNotFound(true); setLoading(false); return; }
    let cancelled = false;

    (async () => {
      const t = await getTournament(tournamentId).catch(() => null);
      if (!t) { if (!cancelled) { setNotFound(true); setLoading(false); } return; }
      if (!cancelled) setTournament(t);

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
      setResults(roundResults);
      setLoading(false);

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
            setResults((prev) =>
              prev.map((r) => r.round.id === round.id ? { ...r, entries: sortedEntries } : r),
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
  }, [tournamentId]);

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

                      return (
                        <div key={entry.group.id} className="px-4 py-3 flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <span className="text-gray-500 text-sm w-5 shrink-0 mt-0.5">{rank + 1}</span>
                            <div className="min-w-0">
                              <p className="font-medium text-sm">{entry.group.name}</p>
                              {playerLine && (
                                <p className="text-gray-400 text-xs mt-0.5 leading-relaxed">{playerLine}</p>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="font-bold text-sm block">
                              {entry.holesCompleted === 0 ? '—' : fmtScore(entry.score, round.format)}
                            </span>
                            {round.status === 'active' && entry.holesCompleted > 0 && entry.holesCompleted < round.holes && (
                              <span className="text-gray-500 text-xs">thru {entry.holesCompleted}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
