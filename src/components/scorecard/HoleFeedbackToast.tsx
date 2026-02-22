import { useEffect, useRef, useState } from 'react';

interface Props {
  message: string | null;
  onDismiss: () => void;
}

export function HoleFeedbackToast({ message, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!message) {
      setVisible(false);
      return;
    }
    // Tiny delay so CSS transition fires from the hidden state
    const showTimer = setTimeout(() => setVisible(true), 10);
    const dismissTimer = setTimeout(() => onDismissRef.current(), 10000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(dismissTimer);
    };
  }, [message]);

  if (!message) return null;

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      onClick={onDismiss}
    >
      <div className="bg-gray-900 min-h-[55vh] flex flex-col items-center justify-center px-8 py-10 rounded-t-3xl shadow-2xl border-t border-gray-700">
        <p className="text-white text-3xl font-bold text-center leading-snug">{message}</p>
        <p className="text-gray-500 text-sm mt-8">Tap to dismiss</p>
      </div>
    </div>
  );
}
