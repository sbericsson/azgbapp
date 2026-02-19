
interface HoleHeaderProps {
  holeNumber: number; // 1-indexed display
  par: number;
  groupName: string;
  roundName: string;
}

export function HoleHeader({ holeNumber, par, groupName, roundName }: HoleHeaderProps) {
  return (
    <div className="bg-gray-900 px-4 py-3 border-b border-gray-700">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wide">{roundName}</p>
          <p className="text-white font-semibold">{groupName}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-green-400">Hole {holeNumber}</p>
          <p className="text-sm text-gray-400">Par {par}</p>
        </div>
      </div>
    </div>
  );
}
