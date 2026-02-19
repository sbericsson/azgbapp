import type { WolfHoleScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';
import { wolfHoleResultDescription } from '../../lib/scoring/wolf';

interface WolfHoleResultProps {
  hole: WolfHoleScore;
  players: Player[];
}

export function WolfHoleResult({ hole, players }: WolfHoleResultProps) {
  if (!hole.locked || hole.points.length === 0) return null;
  const description = wolfHoleResultDescription(hole, players);
  const isTied = hole.points.every((p) => p.pts === 0);

  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
      <p className={`font-semibold text-sm mb-3 ${isTied ? 'text-amber-300' : 'text-green-300'}`}>{description}</p>
      <div className="grid grid-cols-2 gap-2">
        {players.map((p) => {
          const pts = hole.points.find((pt) => pt.playerId === p.id)?.pts ?? 0;
          return (
            <div key={p.id} className="flex items-center justify-between bg-gray-700/50 px-3 py-2 rounded-lg">
              <span className="text-gray-200 text-sm">{p.name}</span>
              <span className={`font-bold text-sm ${pts > 0 ? 'text-green-400' : 'text-gray-500'}`}>
                {pts > 0 ? `+${pts}` : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
