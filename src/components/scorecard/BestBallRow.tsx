import type { PlayerScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';
import { ScoreInput } from './ScoreInput';

interface BestBallRowProps {
  players: Player[];
  scores: PlayerScore[];
  par: number;
  disabled: boolean;
  onScoreChange: (playerId: string, gross: number) => void;
}

export function BestBallRow({ players, scores, par, disabled, onScoreChange }: BestBallRowProps) {
  const validScores = scores.filter((s) => s.gross > 0);
  const best = validScores.length === players.length
    ? Math.min(...validScores.map((s) => s.gross))
    : null;
  const diff = best !== null ? best - par : null;

  return (
    <div className="space-y-3">
      {players.map((p) => {
        const s = scores.find((x) => x.playerId === p.id);
        const gross = s?.gross ?? 0;
        const isBest = gross > 0 && gross === best;
        const indivDiff = gross > 0 ? gross - par : null;
        const diffLabel = indivDiff === null ? ''
          : indivDiff === 0 ? ' · E'
          : indivDiff > 0 ? ` · +${indivDiff}`
          : ` · ${indivDiff}`;
        return (
          <div key={p.id} className={`rounded-xl ring-1 transition-all ${isBest ? 'ring-green-500' : 'ring-transparent'}`}>
            <ScoreInput
              playerId={p.id}
              playerName={p.name + (isBest ? ' ⭐' : '') + diffLabel}
              value={gross}
              par={par}
              onChange={onScoreChange}
              disabled={disabled}
            />
          </div>
        );
      })}

      {best !== null && (
        <div className="bg-gray-800 rounded-xl p-3 flex items-center justify-between">
          <p className="text-sm text-gray-400 font-medium">Best Ball</p>
          <div className={`px-4 py-1 rounded-full text-sm font-bold
            ${diff! < 0 ? 'bg-red-900/60 text-red-400' : diff === 0 ? 'bg-gray-700 text-white' : 'bg-blue-900/60 text-blue-400'}`}>
            {best} ({diff! > 0 ? `+${diff}` : diff === 0 ? 'E' : diff})
          </div>
        </div>
      )}
    </div>
  );
}
