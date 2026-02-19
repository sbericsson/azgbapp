import { useState } from 'react';
import type { WolfHoleScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';
import { getWolfPlayer, withComputedPoints } from '../../lib/scoring/wolf';
import { ScoreInput } from './ScoreInput';

interface WolfControlsProps {
  hole: WolfHoleScore;
  players: Player[];
  par: number;
  holeIndex: number;
  disabled: boolean;
  carry: number;
  runningPoints?: { playerId: string; pts: number }[];
  onChange: (updated: WolfHoleScore) => void;
}

export function WolfControls({ hole, players, par, holeIndex, disabled, carry, runningPoints, onChange }: WolfControlsProps) {
  const [showPartnerModal, setShowPartnerModal] = useState(false);
  const wolfPlayer = getWolfPlayer(players, holeIndex);
  const partner = players.find((p) => p.id === hole.partnerId);
  const nonWolfPlayers = players.filter((p) => p.id !== wolfPlayer.id);

  const modeLabel =
    hole.loneWolfType === 'pre'
      ? 'Lone Wolf (Pre) +3'
      : hole.loneWolfType === 'post'
      ? 'Lone Wolf (Post) +2'
      : partner
      ? `Partner: ${partner.name}`
      : 'No mode chosen';

  function update(patch: Partial<WolfHoleScore>) {
    onChange(withComputedPoints({ ...hole, ...patch }, players, carry));
  }

  function handleScoreChange(playerId: string, gross: number) {
    const scores = hole.scores.map((s) =>
      s.playerId === playerId ? { ...s, gross } : s,
    );
    update({ scores });
  }

  return (
    <>
      <div className={`space-y-4 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
        {/* Carry banner */}
        {carry > 0 && (
          <div className="bg-amber-900/30 border border-amber-600/40 rounded-xl px-4 py-2 flex items-center gap-2">
            <span className="text-amber-400 text-sm font-semibold">🔄 {carry} pts carrying over to this hole</span>
          </div>
        )}

        {/* Wolf mode controls */}
        <div className="bg-yellow-900/30 border border-yellow-600/40 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-yellow-400 text-lg">🐺</span>
            <div>
              <p className="text-yellow-300 font-bold text-xs uppercase tracking-wide">Wolf</p>
              <p className="text-yellow-200 text-base font-semibold">{wolfPlayer.name}</p>
            </div>
            <p className="ml-auto text-yellow-400 text-xs">{modeLabel}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => update({ loneWolfType: 'pre', partnerId: null })}
              className={`py-3 px-2 rounded-lg text-xs font-bold text-center transition-colors
                ${hole.loneWolfType === 'pre' ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-gray-200 active:bg-gray-600'}`}
            >
              Lone Wolf<br /><span className="font-normal">(Pre) +3</span>
            </button>
            <button
              onClick={() => update({ loneWolfType: 'post', partnerId: null })}
              className={`py-3 px-2 rounded-lg text-xs font-bold text-center transition-colors
                ${hole.loneWolfType === 'post' ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-gray-200 active:bg-gray-600'}`}
            >
              Lone Wolf<br /><span className="font-normal">(Post) +2</span>
            </button>
            <button
              onClick={() => setShowPartnerModal(true)}
              className={`py-3 px-2 rounded-lg text-xs font-bold text-center transition-colors
                ${hole.partnerId && !hole.loneWolfType ? 'bg-green-500 text-gray-900' : 'bg-gray-700 text-gray-200 active:bg-gray-600'}`}
            >
              Pick<br /><span className="font-normal">Partner</span>
            </button>
          </div>
        </div>

        {/* Score inputs with running pts */}
        {players.map((p) => {
          const rpts = runningPoints?.find((r) => r.playerId === p.id)?.pts ?? 0;
          const label = p.name
            + (p.id === wolfPlayer.id ? ' 🐺' : '')
            + (rpts > 0 ? ` · ${rpts}pts` : '');
          return (
            <ScoreInput
              key={p.id}
              playerId={p.id}
              playerName={label}
              value={hole.scores.find((s) => s.playerId === p.id)?.gross ?? 0}
              par={par}
              onChange={handleScoreChange}
              disabled={disabled}
            />
          );
        })}
      </div>

      {/* Full-screen partner picker modal */}
      {showPartnerModal && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4">
          <div className="mb-6 mt-8 text-center">
            <h2 className="text-white text-2xl font-bold">{wolfPlayer.name}, pick your partner</h2>
            <p className="text-gray-400 text-sm mt-1">Best ball: you + partner vs the other two (+1 each if you win)</p>
          </div>
          <div className="flex flex-col gap-4 flex-1">
            {nonWolfPlayers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  update({ loneWolfType: null, partnerId: p.id });
                  setShowPartnerModal(false);
                }}
                className={`flex-1 rounded-2xl text-2xl font-bold transition-colors
                  ${hole.partnerId === p.id ? 'bg-green-500 text-white' : 'bg-gray-800 text-white active:bg-gray-700'}`}
              >
                {p.name}
              </button>
            ))}
          </div>
          <button onClick={() => setShowPartnerModal(false)} className="mt-4 py-4 text-gray-400 text-base font-medium">
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
