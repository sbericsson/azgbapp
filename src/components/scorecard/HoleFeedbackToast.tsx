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
    const dismissTimer = setTimeout(() => onDismissRef.current(), 3500);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(dismissTimer);
    };
  }, [message]);

  if (!message) return null;

  return (
    <div
      className={`fixed left-4 right-4 bottom-20 z-40 transition-transform duration-300 ease-out ${
        visible ? 'translate-y-0' : 'translate-y-full'
      }`}
      onPointerDown={onDismiss}
    >
      <div className="bg-gray-800/95 rounded-2xl px-5 py-4 shadow-xl">
        <p className="text-white text-sm leading-relaxed">{message}</p>
      </div>
    </div>
  );
}
