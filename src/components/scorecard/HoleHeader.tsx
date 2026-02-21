
interface HoleHeaderProps {
  holeNumber: number; // 1-indexed display
  par: number;
  groupName: string;
  roundName: string;
  courseName?: string;
  onEditGroupName?: () => void;
}

export function HoleHeader({ holeNumber, par, groupName, roundName, courseName, onEditGroupName }: HoleHeaderProps) {
  return (
    <div className="bg-gray-900 px-4 py-3 border-b border-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">
            {roundName}{courseName ? ` · ${courseName}` : ''}
          </p>
          <div className="flex items-center gap-2">
            <p className="text-white font-semibold">{groupName}</p>
            {onEditGroupName && (
              <button
                onClick={onEditGroupName}
                className="text-gray-500 text-xs px-1 py-0.5 rounded hover:text-gray-300"
                aria-label="Edit group name"
              >
                ✏️
              </button>
            )}
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-400">Hole {holeNumber}</p>
          <p className="text-sm text-gray-400">Par {par}</p>
        </div>
      </div>
    </div>
  );
}
