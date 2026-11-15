import { useEffect, useRef } from 'react';

interface Props {
  message: string | null;
  loading?: boolean;
  autoDismiss?: boolean;
  onDismiss: () => void;
}

export function HoleFeedbackToast({ message, loading = false, autoDismiss = true, onDismiss }: Props) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const isOpen = message !== null || loading;

  // 10s auto-dismiss — only starts once message arrives, and only when requested
  useEffect(() => {
    if (!message || !autoDismiss) return;
    const dismissTimer = setTimeout(() => onDismissRef.current(), 10000);
    return () => clearTimeout(dismissTimer);
  }, [message, autoDismiss]);

  if (!isOpen) return null;

  // Sits above the bottom action bar and can be dismissed at any time, including
  // while AI commentary is still loading, so it never blocks score entry (B11).
  return (
    <div className="fixed inset-x-0 bottom-[6.5rem] z-40 px-3 pointer-events-none">
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss commentary"
        className="pointer-events-auto w-full max-w-lg mx-auto bg-gray-900/95 backdrop-blur flex flex-col items-center justify-center px-6 py-6 rounded-2xl shadow-2xl border border-gray-700 text-center"
      >
        {loading && !message ? (
          <p className="text-white text-3xl font-bold animate-pulse" aria-live="polite">· · ·</p>
        ) : (
          <p className="text-white text-xl font-bold leading-snug" aria-live="polite">{message}</p>
        )}
        <p className="text-gray-500 text-xs mt-4">Tap to dismiss</p>
      </button>
    </div>
  );
}
