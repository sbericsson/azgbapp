import type { LeaderboardEntry } from '../../hooks/useLeaderboard';
import { LeaderboardRow } from './LeaderboardRow';

interface WolfLeaderboardProps {
  entries: LeaderboardEntry[];
  onGroupClick?: (groupId: string) => void;
}

export function WolfLeaderboard({ entries, onGroupClick }: WolfLeaderboardProps) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => (
        <LeaderboardRow
          key={entry.groupId}
          entry={entry}
          rank={i + 1}
          format="wolf"
          onClick={onGroupClick ? () => onGroupClick(entry.groupId) : undefined}
        />
      ))}
    </div>
  );
}
