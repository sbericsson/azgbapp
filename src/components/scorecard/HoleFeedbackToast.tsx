import { useEffect, useRef, useState } from 'react';

interface Props {
  message: string | null;
  loading?: boolean;
  autoDismiss?: boolean;
  onDismiss: () => void;
}

export function HoleFeedbackToast({ message, loading = false, autoDismiss = true, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const isOpen = message !== null || loading;

  // Slide in when open, slide out when closed
  useEffect(() => {
    if (!isOpen) {
      setVisible(false);
      return;
    }
    const showTimer = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(showTimer);
  }, [isOpen]);

  // 10s auto-dismiss — only starts once message arrives, and only when requested
  useEffect(() => {
    if (!message || !autoDismiss) return;
    const dismissTimer = setTimeout(() => onDismissRef.current(), 10000);
    return () => clearTimeout(dismissTimer);
  }, [message, autoDismiss]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      onClick={loading ? undefined : onDismiss}
    >
      <div className="bg-gray-900 min-h-[55vh] flex flex-col items-center justify-center px-8 py-10 rounded-t-3xl shadow-2xl border-t border-gray-700">
        {loading && !message ? (
          <p className="text-white text-4xl font-bold text-center animate-pulse">· · ·</p>
        ) : (
          <p className="text-white text-3xl font-bold text-center leading-snug">{message}</p>
        )}
        {!loading && <p className="text-gray-500 text-sm mt-8">Tap to dismiss</p>}
      </div>
    </div>
  );
}
