import type { LeaderboardEntry } from '../../hooks/useLeaderboard';
import { LeaderboardRow } from './LeaderboardRow';
import type { RoundFormat } from '../../types/tournament';

interface TeamLeaderboardProps {
  entries: LeaderboardEntry[];
  format: RoundFormat;
}

export function TeamLeaderboard({ entries, format }: TeamLeaderboardProps) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => (
        <LeaderboardRow
          key={entry.groupId}
          entry={entry}
          rank={i + 1}
          format={format}
        />
      ))}
    </div>
  );
}
