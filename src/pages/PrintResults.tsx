import { useState, useEffect, useContext } from 'react';
import { AuthContext } from '../hooks/useAuth';
import {
  listRounds,
  listCourses,
  listGroupsByRound,
  listAllScores,
} from '../lib/data';
import type { Round, RoundFormat } from '../types/tournament';
import { computeStandings, formatRank, formatScore, type StandingEntry } from '../lib/scoring/standings';

const DAY_ORDER: Record<string, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const fmtScore = formatScore;

interface RoundResult {
  round: Round;
  courseName?: string;
  entries: StandingEntry[];
}

export function PrintResults() {
  const { tournament, tournamentId } = useContext(AuthContext);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestKey = `${tournamentId ?? 'none'}:${refreshKey}`;
  const [resultState, setResultState] = useState<{
    requestKey: string;
    results: RoundResult[];
  }>({
    requestKey: '',
    results: [],
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!tournamentId) return;
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

          const sortedEntries = computeStandings(round, groups, scoreDocs);

          return {
            round,
            courseName: round.courseId ? courseMap[round.courseId] : undefined,
            entries: sortedEntries,
          };
        }),
      );

      if (!cancelled) {
        setResultState({ requestKey, results: roundResults });
      }
    })();

    return () => { cancelled = true; };
  }, [requestKey, tournamentId]);

  const loading = Boolean(tournamentId) && resultState.requestKey !== requestKey;
  const results = resultState.requestKey === requestKey ? resultState.results : [];

  const dayLabel = (day: string) => day.charAt(0).toUpperCase() + day.slice(1);

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
                  {round.name} · {dayLabel(round.day)} · {formatLabel(round.format)}
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
                    {entries.map((entry) => {
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
                          <td className="py-2 pr-2 text-gray-500 align-top">{formatRank(entry.rank, entry.tied)}</td>
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
