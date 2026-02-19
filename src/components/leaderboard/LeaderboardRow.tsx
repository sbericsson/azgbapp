import type { LeaderboardEntry } from '../../hooks/useLeaderboard';

interface LeaderboardRowProps {
  entry: LeaderboardEntry;
  rank: number;
  format: 'wolf' | 'bestBall' | 'scramble';
  onClick?: () => void;
}

function scoreDisplay(score: number, format: string): string {
  if (format === 'wolf') return `${score} pts`;
  if (score === 0) return 'E';
  return score > 0 ? `+${score}` : `${score}`;
}

function scoreColor(score: number, format: string): string {
  if (format === 'wolf') return score > 0 ? 'text-green-400' : 'text-gray-400';
  if (score < 0) return 'text-red-400';
  if (score === 0) return 'text-white';
  return 'text-blue-400';
}

export function LeaderboardRow({ entry, rank, format, onClick }: LeaderboardRowProps) {
  const rankBadge = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;

  return (
    <div
      className={`bg-gray-800 rounded-xl px-4 py-3 flex items-center gap-3 ${onClick ? 'cursor-pointer active:bg-gray-700' : ''}`}
      onPointerDown={onClick}
    >
      <span className="text-xl min-w-[2rem] text-center">{rankBadge}</span>
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold truncate">{entry.groupName}</p>
        <p className="text-gray-400 text-xs">
          {entry.holesCompleted} hole{entry.holesCompleted !== 1 ? 's' : ''} in
        </p>
        {format === 'wolf' && entry.playerPoints && (
          <div className="flex flex-wrap gap-x-3 mt-1">
            {entry.playerPoints.map((pp) => (
              <span key={pp.playerId} className="text-xs text-gray-400">
                {pp.name.split(' ')[0]}: <span className="text-green-400">{pp.pts}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <span className={`text-2xl font-bold ${scoreColor(entry.score, format)}`}>
        {scoreDisplay(entry.score, format)}
      </span>
    </div>
  );
}
