import { type ReactNode, useState, useEffect } from 'react';

// 12:00 PM MST = 19:00 UTC (MST is UTC-7, no DST in February)
const LAUNCH_TIME = new Date('2026-02-20T19:00:00Z');
const BYPASS_KEY = 'azgb_bypass';

function getRemainingMs() {
  return Math.max(0, LAUNCH_TIME.getTime() - Date.now());
}

function isUnlocked() {
  return (
    Date.now() >= LAUNCH_TIME.getTime() ||
    localStorage.getItem(BYPASS_KEY) === 'true' ||
    window.location.pathname === '/bypass' ||
    window.location.pathname.startsWith('/results/')
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function CountdownDisplay() {
  const [ms, setMs] = useState(getRemainingMs);

  useEffect(() => {
    const id = setInterval(() => {
      const remaining = getRemainingMs();
      setMs(remaining);
      if (remaining === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const totalSeconds = Math.floor(ms / 1000);
  const days    = Math.floor(totalSeconds / 86400);
  const hours   = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const units = [
    { label: 'DAYS', value: days },
    { label: 'HRS',  value: hours },
    { label: 'MINS', value: minutes },
    { label: 'SECS', value: seconds },
  ];

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">

        {/* Logo */}
        <div className="bg-white rounded-2xl p-3 shadow-lg">
          <img src="/azgb-logo.png" alt="AZ Golf Bender" className="w-44 h-auto" />
        </div>

        {/* Heading */}
        <div className="text-center">
          <p className="text-gray-400 text-sm uppercase tracking-widest mb-1">Tournament begins in</p>
        </div>

        {/* Countdown */}
        <div className="flex items-start gap-3">
          {units.map(({ label, value }, i) => (
            <div key={label} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="bg-gray-800 rounded-xl px-4 py-3 min-w-[64px] text-center">
                  <span className="text-4xl font-bold text-white tabular-nums">{pad(value)}</span>
                </div>
                <span className="text-gray-500 text-xs mt-1 tracking-widest">{label}</span>
              </div>
              {i < units.length - 1 && (
                <span className="text-3xl font-bold text-gray-600 mt-2">:</span>
              )}
            </div>
          ))}
        </div>

        {/* Launch date */}
        <p className="text-gray-500 text-sm">Feb 20, 2026 · 12:00 PM MST</p>
      </div>
    </div>
  );
}

interface LaunchGateProps {
  children: ReactNode;
}

export function LaunchGate({ children }: LaunchGateProps) {
  const [unlocked, setUnlocked] = useState(isUnlocked);

  useEffect(() => {
    if (unlocked) return;
    const id = setInterval(() => {
      if (isUnlocked()) {
        setUnlocked(true);
        clearInterval(id);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [unlocked]);

  if (unlocked) return <>{children}</>;
  return <CountdownDisplay />;
}
