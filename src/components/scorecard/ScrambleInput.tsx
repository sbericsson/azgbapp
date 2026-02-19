interface ScrambleInputProps {
  value: number | null;
  par: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}

const MAX_SCORE = 12;

function scoreColor(score: number, par: number): string {
  if (score <= 0) return 'text-gray-400';
  const diff = score - par;
  if (diff <= -2) return 'text-yellow-300';
  if (diff === -1) return 'text-red-400';
  if (diff === 0) return 'text-white';
  if (diff === 1) return 'text-blue-300';
  return 'text-blue-500';
}

export function ScrambleInput({ value, par, onChange, disabled }: ScrambleInputProps) {
  const display = (value ?? 0) > 0 ? (value ?? 0) : par;
  const isDefault = !value || value <= 0;

  const decrement = () => {
    if (disabled) return;
    onChange(Math.max(1, (value || par) - 1));
  };
  const increment = () => {
    if (disabled) return;
    onChange(Math.min(MAX_SCORE, (value || par) + 1));
  };

  return (
    <div className={`flex items-center justify-between py-3 px-4 rounded-xl bg-gray-800 ${disabled ? 'opacity-50' : ''}`}>
      <span className="text-white font-medium text-base flex-1">Team Score</span>
      <div className="flex items-center gap-3">
        <button
          onPointerDown={decrement}
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
          onPointerDown={increment}
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
