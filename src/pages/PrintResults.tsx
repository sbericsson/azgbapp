import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import {
  listRounds,
  listCourses,
  listGroupsByRound,
  listAllScores,
} from '../lib/firestore';
import type { Group, Round, RoundFormat } from '../types/tournament';
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
  playerPoints?: { name: string; pts: number }[];   // wolf
  playerTotals?: { name: string; total: number }[];  // bestBall
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
      // Per-player: iterate full holes array with original index for correct par lookup
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

    // scramble
    const sHoles = lockedHoles.filter(isScrambleHole) as ScrambleHoleScore[];
    return { group, score: scrambleTotalToPar(sHoles, round.par), holesCompleted };
  });
}

export function PrintResults() {
  const { tournament, tournamentId } = useContext(AuthContext);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    (async () => {
      if (!tournamentId) { setLoading(false); return; }
      const [rounds, courses] = await Promise.all([
        listRounds(tournamentId),
        listCourses(tournamentId),
      ]);

      const courseMap = Object.fromEntries(courses.map((c) => [c.id, c.name]));
      const sorted = [...rounds].sort(
        (a, b) => (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99),
      );

      const roundResults: RoundResult[] = await Promise.all(
        sorted.map(async (round) => {
          const [groups, scoreDocs] = await Promise.all([
            listGroupsByRound(tournamentId, round.id),
            listAllScores(tournamentId, round.id),
          ]);

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

      if (!cancelled) {
        setResults(roundResults);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [refreshKey, tournamentId]);

  const dayLabel = (day: string) => {
    if (day === 'saturday_am') return 'Saturday AM';
    if (day === 'saturday_pm') return 'Saturday PM';
    return day.charAt(0).toUpperCase() + day.slice(1);
  };

  const formatLabel = (format: RoundFormat) => {
    if (format === 'bestBall') return 'Best Ball';
    return format.charAt(0).toUpperCase() + format.slice(1);
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white print:bg-white print:text-black">
      {/* Nav — hidden in print */}
      <header className="print:hidden bg-gray-900 px-4 py-4 flex items-center justify-between border-b border-gray-700">
        <a href="/admin" className="text-gray-400 text-sm">← Admin</a>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            className="text-gray-400 text-sm font-medium"
          >
            ↻ Refresh
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-green-600 rounded-xl text-sm font-semibold text-white"
          >
            Print
          </button>
        </div>
      </header>

      <div className="p-4 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6 print:text-3xl">
          AZGB Tournament Results{tournament?.name ? ` — ${tournament.name}` : ''}
        </h1>

        {loading && <p className="text-gray-400">Loading…</p>}

        {!loading && results.length === 0 && (
          <p className="text-gray-400">No rounds found.</p>
        )}

        {results.map((result, idx) => {
          const { round, courseName, entries } = result;
          const isWolf = round.format === 'wolf';
          const isBestBallFmt = round.format === 'bestBall';

          return (
            <section
              key={round.id}
              className={idx > 0 ? 'mt-10 print:break-before-page' : ''}
            >
              <div className="border-b-2 border-gray-600 print:border-gray-400 pb-2 mb-4">
                <h2 className="text-lg font-bold">
                  Round {idx + 1} · {dayLabel(round.day)} · {formatLabel(round.format)}
                  {courseName ? ` · ${courseName}` : ''}
                </h2>
              </div>

              {entries.length === 0 ? (
                <p className="text-gray-500 text-sm">No groups.</p>
              ) : (
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-gray-700 print:border-gray-300 text-gray-400 print:text-gray-600">
                      <th className="text-left py-2 pr-2 w-8 font-semibold">#</th>
                      <th className="text-left py-2 font-semibold">Group</th>
                      <th className="text-right py-2 pl-6 font-semibold">
                        {isWolf ? 'Total pts' : 'Score'}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, rank) => {
                      const playerLine = isWolf
                        ? (entry.playerPoints ?? []).map((pp) => `${pp.name}: ${pp.pts} pts`).join(' · ')
                        : isBestBallFmt
                        ? (entry.playerTotals ?? []).map((pt) => `${pt.name}: ${fmtScore(pt.total, 'bestBall')}`).join(' · ')
                        : entry.group.players.map((p) => p.name).join(' · ');

                      return (
                        <tr
                          key={entry.group.id}
                          className="border-b border-gray-800 print:border-gray-200"
                        >
                          <td className="py-2 pr-2 text-gray-500 align-top">{rank + 1}</td>
                          <td className="py-2 align-top">
                            <span className="font-medium">{entry.group.name}</span>
                            {entry.holesCompleted > 0 && entry.holesCompleted < round.holes && (
                              <span className="text-gray-500 print:text-gray-400 text-xs ml-1.5">
                                ({entry.holesCompleted}/{round.holes})
                              </span>
                            )}
                            {playerLine && (
                              <div className="text-gray-400 print:text-gray-500 text-xs mt-0.5">
                                {playerLine}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pl-6 text-right font-bold align-top">
                            {entry.holesCompleted === 0 ? '—' : fmtScore(entry.score, round.format)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
