import type { HoleScore, WolfHoleScore } from '../../types/scoring';
import type { Player, RoundFormat } from '../../types/tournament';
import {
  deriveWolfHoles,
  formatScore,
  parFor,
  playerToPar,
  teamToPar,
  wolfPlayerTotals,
} from '../../lib/scoring/standings';

interface RoundReviewProps {
  format: RoundFormat;
  par: number[];
  players: Player[];
  /** Every hole as it will be saved, with the hole being locked included. */
  holes: HoleScore[];
  onGoToHole: (index: number) => void;
}

function scoreClass(gross: number | null | undefined, par: number): string {
  if (!gross) return 'text-gray-500';
  if (gross < par) return 'text-red-400 font-bold';
  if (gross > par) return 'text-blue-400';
  return 'text-white';
}

/**
 * Whole-round check shown before the last hole is locked (R11): every hole's
 * scores and the totals, with a tap on a hole to go back and fix it.
 */
export function RoundReview({ format, par, players, holes, onGoToHole }: RoundReviewProps) {
  const perPlayer = format === 'wolf' || format === 'bestBall';
  const columns = perPlayer
    ? players.map((p) => ({ id: p.id, label: p.name.split(' ')[0] }))
    : [{ id: 'team', label: 'Team' }];

  const cell = (hole: HoleScore, columnId: string): number | null => {
    if (!perPlayer) return 'teamScore' in hole ? hole.teamScore : null;
    if (!('scores' in hole)) return null;
    return hole.scores.find((s) => s.playerId === columnId)?.gross ?? null;
  };

  const wolfTotals = format === 'wolf'
    ? wolfPlayerTotals(deriveWolfHoles(holes as WolfHoleScore[], players), players)
    : [];

  const total = (columnId: string): string => {
    if (format === 'wolf') return `${wolfTotals.find((t) => t.playerId === columnId)?.pts ?? 0} pts`;
    if (!perPlayer) return formatScore(teamToPar(holes, par), format);
    return formatScore(playerToPar(holes, par, columnId), format);
  };

  return (
    <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-gray-700" data-no-swipe>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-gray-900 text-gray-400 text-xs">
          <tr>
            <th className="text-left font-medium px-2 py-1.5">Hole</th>
            <th className="font-medium px-1 py-1.5">Par</th>
            {columns.map((c) => (
              <th key={c.id} className="font-medium px-1 py-1.5 truncate max-w-[4rem]">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holes.map((hole, i) => {
            const p = parFor(par, i);
            return (
              <tr
                key={i}
                onClick={() => onGoToHole(i)}
                className="border-t border-gray-800 active:bg-gray-700 cursor-pointer"
              >
                <td className="px-2 py-1.5 text-gray-300">{i + 1}</td>
                <td className="px-1 py-1.5 text-center text-gray-500">{p}</td>
                {columns.map((c) => {
                  const v = cell(hole, c.id);
                  return (
                    <td key={c.id} className={`px-1 py-1.5 text-center ${scoreClass(v, p)}`}>
                      {v || '–'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-gray-900">
          <tr className="border-t border-gray-600">
            <td className="px-2 py-1.5 font-bold" colSpan={2}>Total</td>
            {columns.map((c) => (
              <td key={c.id} className="px-1 py-1.5 text-center font-bold">{total(c.id)}</td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
