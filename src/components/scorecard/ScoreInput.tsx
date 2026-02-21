
interface ScoreInputProps {
  playerId: string;
  playerName: string;
  value: number; // 0 = not entered
  par: number;
  disabled?: boolean;
  onChange: (playerId: string, score: number) => void;
}

const MAX_SCORE = 12;

function scoreColor(score: number, par: number): string {
  if (score <= 0) return 'text-gray-400';
  const diff = score - par;
  if (diff <= -2) return 'text-yellow-300'; // eagle or better
  if (diff === -1) return 'text-red-400';   // birdie
  if (diff === 0) return 'text-white';       // par
  if (diff === 1) return 'text-blue-300';    // bogey
  return 'text-blue-500';                    // double+
}

export function ScoreInput({ playerId, playerName, value, par, disabled, onChange }: ScoreInputProps) {
  const decrement = () => {
    if (disabled) return;
    const next = Math.max(1, (value || par) - 1);
    onChange(playerId, next);
  };
  const increment = () => {
    if (disabled) return;
    const next = Math.min(MAX_SCORE, (value || par) + 1);
    onChange(playerId, next);
  };

  const display = value > 0 ? value : par;
  const isDefault = value <= 0;

  return (
    <div className={`flex items-center justify-between py-3 px-4 rounded-xl bg-gray-800 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-white font-medium text-base flex-1">{playerName}</span>
      <div className="flex items-center gap-3">
        <button
          onClick={decrement}
          disabled={disabled}
          aria-label="Decrease score"
          className="w-14 h-14 rounded-xl bg-gray-700 text-white text-2xl font-bold active:bg-gray-600 flex items-center justify-center select-none"
        >
          −
        </button>
        <span className={`w-10 text-center text-2xl font-bold ${isDefault ? 'text-gray-500' : scoreColor(display, par)}`}>
          {display}
        </span>
        <button
          onClick={increment}
          disabled={disabled}
          aria-label="Increase score"
          className="w-14 h-14 rounded-xl bg-gray-700 text-white text-2xl font-bold active:bg-gray-600 flex items-center justify-center select-none"
        >
          +
        </button>
      </div>
    </div>
  );
}
