
interface HoleNavProps {
  currentHole: number; // 0-indexed
  totalHoles: number;
  lockedHoles: boolean[];
  onHoleChange: (holeIndex: number) => void;
}

export function HoleNav({ currentHole, totalHoles, lockedHoles, onHoleChange }: HoleNavProps) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 px-2 scrollbar-hide">
      {Array.from({ length: totalHoles }, (_, i) => {
        const isLocked = lockedHoles[i];
        const isCurrent = i === currentHole;
        return (
          <button
            key={i}
            onClick={() => onHoleChange(i)}
            className={`min-w-[2.5rem] h-10 rounded-lg text-sm font-bold flex-shrink-0 transition-colors
              ${isCurrent
                ? 'bg-green-500 text-white'
                : isLocked
                ? 'bg-gray-600 text-gray-300'
                : 'bg-gray-800 text-gray-200 hover:bg-gray-700'
              }`}
          >
            {isLocked ? '🔒' : i + 1}
          </button>
        );
      })}
    </div>
  );
}
