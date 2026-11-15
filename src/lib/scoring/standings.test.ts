import { describe, it, expect } from 'vitest';
import type { Group, Player } from '../../types/tournament';
import type {
  BestBallHoleScore,
  GauntletHoleScore,
  GroupScoreDoc,
  ScrambleHoleScore,
  WolfHoleScore,
} from '../../types/scoring';
import {
  computeStandings,
  deriveWolfHoles,
  formatRank,
  teamToPar,
  playerToPar,
  wolfPlayerTotals,
} from './standings';

const players: Player[] = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
  { id: 'p4', name: 'Dave' },
];

function wolfHole(
  i: number,
  gross: [number, number, number, number],
  opts: Partial<WolfHoleScore> = {},
): WolfHoleScore {
  return {
    wolfPlayerId: players[i % 4].id,
    loneWolfType: null,
    partnerId: players[(i + 1) % 4].id,
    scores: players.map((p, k) => ({ playerId: p.id, gross: gross[k] })),
    points: [],
    carry: 0,
    locked: true,
    ...opts,
  };
}

function pts(h: WolfHoleScore, id: string) {
  return h.points.find((p) => p.playerId === id)?.pts ?? 0;
}

describe('deriveWolfHoles', () => {
  it('carries the base stake across consecutive ties', () => {
    // Hole 0: wolf p1 + partner p2 vs p3,p4 → tie (4/4)
    // Hole 1: wolf p2 + partner p3 vs p4,p1 → tie
    // Hole 2: wolf p3 + partner p4 win
    const holes = [
      wolfHole(0, [4, 5, 4, 5]),
      wolfHole(1, [4, 4, 5, 5]),
      wolfHole(2, [5, 5, 3, 5]),
    ];
    const d = deriveWolfHoles(holes, players);
    expect(d[0].carry).toBe(0);
    expect(d[1].carry).toBe(1);
    expect(d[2].carry).toBe(2);
    expect(pts(d[2], 'p3')).toBe(3);
    expect(pts(d[2], 'p4')).toBe(3);
  });

  it('recomputes later holes when an earlier tie is corrected (B3)', () => {
    // Stored values reflect a stale lock: hole 1 was locked with carry 1 and +2 each.
    const stale: WolfHoleScore[] = [
      wolfHole(0, [3, 5, 4, 5]), // now decisive: p1+p2 win
      wolfHole(1, [5, 3, 5, 5], {
        carry: 1,
        points: [
          { playerId: 'p1', pts: 0 },
          { playerId: 'p2', pts: 2 },
          { playerId: 'p3', pts: 2 },
          { playerId: 'p4', pts: 0 },
        ],
      }),
    ];
    const d = deriveWolfHoles(stale, players);
    expect(d[1].carry).toBe(0);
    expect(pts(d[1], 'p2')).toBe(1);
    expect(pts(d[1], 'p3')).toBe(1);
    const totals = wolfPlayerTotals(d, players);
    expect(totals.map((t) => t.pts)).toEqual([1, 2, 1, 0]);
  });

  it('does not let a lone-wolf bonus carry', () => {
    const holes = [
      wolfHole(0, [4, 4, 5, 5], { loneWolfType: 'pre', partnerId: null }), // tie
      wolfHole(1, [5, 3, 5, 5], { loneWolfType: 'pre', partnerId: null }), // p2 wins alone
    ];
    const d = deriveWolfHoles(holes, players);
    expect(d[1].carry).toBe(1);
    expect(pts(d[1], 'p2')).toBe(4);
  });

  it('resets carry at an unlocked hole and gives unlocked holes no points', () => {
    const holes = [
      wolfHole(0, [4, 5, 4, 5]), // tie
      wolfHole(1, [3, 5, 5, 5], { locked: false }),
      wolfHole(2, [5, 5, 3, 5]),
    ];
    const d = deriveWolfHoles(holes, players);
    expect(d[1].carry).toBe(1);
    expect(d[1].points).toEqual([]);
    expect(d[2].carry).toBe(0);
    expect(pts(d[2], 'p3')).toBe(1);
  });
});

describe('stroke-format totals use each hole’s own par (B4)', () => {
  const pars = [5, 3, 4];

  it('scramble: unlocked earlier hole does not shift par', () => {
    const holes: ScrambleHoleScore[] = [
      { teamScore: null, locked: false },
      { teamScore: 3, locked: true },
    ];
    expect(teamToPar(holes, pars)).toBe(0);
  });

  it('ignores values on unlocked holes (B7)', () => {
    const holes: ScrambleHoleScore[] = [
      { teamScore: 4, locked: true },
      { teamScore: 2, locked: false },
    ];
    expect(teamToPar(holes, pars)).toBe(-1);
  });

  it('best ball team and per-player totals', () => {
    const holes: BestBallHoleScore[] = [
      { scores: [{ playerId: 'p1', gross: 6 }, { playerId: 'p2', gross: 4 }], bestScore: 4, locked: false },
      { scores: [{ playerId: 'p1', gross: 3 }, { playerId: 'p2', gross: 4 }], bestScore: 3, locked: true },
      { scores: [{ playerId: 'p1', gross: 5 }, { playerId: 'p2', gross: 3 }], bestScore: 3, locked: true },
    ];
    expect(teamToPar(holes, pars)).toBe(-1);
    expect(playerToPar(holes, pars, 'p1')).toBe(1);
    expect(playerToPar(holes, pars, 'p2')).toBe(0);
  });

  it('gauntlet', () => {
    const holes: GauntletHoleScore[] = [
      { segment: 'bestBall', teamScore: 4, locked: true },
      { segment: 'bestBall', teamScore: 4, locked: true },
      { segment: 'scramble', teamScore: 4, locked: true },
    ];
    expect(teamToPar(holes, pars)).toBe(0);
  });
});

describe('computeStandings', () => {
  const group = (id: string, name: string): Group => ({ id, name, pin: '0000', players: players.slice(0, 2), roundId: 'r' });
  const doc = (groupId: string, scores: (number | null)[]): GroupScoreDoc => ({
    groupId,
    updatedAt: 0,
    holes: scores.map((s) => ({ teamScore: s, locked: s !== null })),
  });

  it('shares ranks on ties and puts groups with no holes last, unranked (B18)', () => {
    const groups = [group('a', 'Alpha'), group('b', 'Bravo'), group('c', 'Charlie'), group('d', 'Delta')];
    const docs = [doc('a', [4, 4]), doc('b', [3, 3]), doc('c', [4, 4])];
    const s = computeStandings({ format: 'scramble', par: [4, 5] }, groups, docs);
    expect(s.map((e) => e.group.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(s.map((e) => formatRank(e.rank, e.tied))).toEqual(['1', 'T2', 'T2', '–']);
    expect(s[0].score).toBe(-3);
  });

  it('ignores a score doc left over from a different format', () => {
    const groups = [group('a', 'Alpha')];
    const s = computeStandings({ format: 'wolf', par: [4] }, groups, [doc('a', [3])]);
    expect(s[0].holesCompleted).toBe(0);
  });
});
