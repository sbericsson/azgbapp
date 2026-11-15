import { describe, it, expect } from 'vitest';
import type { HoleScore, ScrambleHoleScore, WolfHoleScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';
import { completeHoles, holesFromDoc, mergeRemoteHoles } from './holes';

const players: Player[] = [
  { id: 'p1', name: 'A' },
  { id: 'p2', name: 'B' },
  { id: 'p3', name: 'C' },
  { id: 'p4', name: 'D' },
];
const sc = (teamScore: number | null, locked = true): ScrambleHoleScore => ({ teamScore, locked });

describe('holesFromDoc', () => {
  it('reads a legacy holes array', () => {
    expect(holesFromDoc({ holes: [sc(4), sc(5)] })).toEqual([sc(4), sc(5)]);
  });

  it('reads a sparse holeMap, leaving gaps as null', () => {
    expect(holesFromDoc({ holeMap: { '2': sc(3) } })).toEqual([null, null, sc(3)]);
  });

  it('prefers holeMap entries over the legacy array', () => {
    const holes = holesFromDoc({ holes: [sc(4), sc(5)], holeMap: { '1': sc(6) } });
    expect(holes).toEqual([sc(4), sc(6)]);
  });

  it('ignores keys that are not hole indexes', () => {
    expect(holesFromDoc({ holeMap: { x: sc(3), '-1': sc(3) } })).toEqual([]);
  });
});

describe('completeHoles', () => {
  it('fills gaps and pads to the round length', () => {
    const holes = completeHoles({ format: 'scramble', holes: 3 }, players, [null, sc(3)]);
    expect(holes).toEqual([sc(null, false), sc(3), sc(null, false)]);
  });

  it('builds wolf holes with the right wolf for each index', () => {
    const holes = completeHoles({ format: 'wolf', holes: 2 }, players, []) as WolfHoleScore[];
    expect(holes.map((h) => h.wolfPlayerId)).toEqual(['p1', 'p2']);
  });

  it('returns null for holes from another format', () => {
    expect(completeHoles({ format: 'wolf', holes: 2 }, players, [sc(3)])).toBeNull();
  });
});

describe('mergeRemoteHoles (B2)', () => {
  it('keeps dirty local holes and takes remote for the rest', () => {
    const local: HoleScore[] = [sc(4), sc(2, false), sc(5)];
    const remote: HoleScore[] = [sc(3), sc(6), sc(5, false)];
    expect(mergeRemoteHoles(local, remote, new Set([1]))).toEqual([sc(3), sc(2, false), sc(5, false)]);
  });

  it('accepts a remote unlock of a hole not being edited here', () => {
    const local: HoleScore[] = [sc(4)];
    const remote: HoleScore[] = [sc(4, false)];
    expect(mergeRemoteHoles(local, remote, new Set())).toEqual([sc(4, false)]);
  });
});
