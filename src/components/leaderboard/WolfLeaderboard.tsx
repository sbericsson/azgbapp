import type { LeaderboardEntry } from '../../hooks/useLeaderboard';
import { LeaderboardRow } from './LeaderboardRow';

interface WolfLeaderboardProps {
  entries: LeaderboardEntry[];
}

export function WolfLeaderboard({ entries }: WolfLeaderboardProps) {
  return (
    <div className="flex flex-col gap-2">
      {entries.map((entry, i) => (
        <LeaderboardRow key={entry.groupId} entry={entry} rank={i + 1} format="wolf" />
      ))}
    </div>
  );
}
