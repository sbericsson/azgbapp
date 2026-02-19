import { describe, it, expect } from 'vitest';
import { computeWolfPoints, getWolfPlayer, computeCarryForHole, emptyWolfHole, withComputedPoints } from './wolf';
import type { Player } from '../../types/tournament';

const players: Player[] = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
  { id: 'p4', name: 'Dave' },
];

describe('getWolfPlayer', () => {
  it('rotates correctly', () => {
    expect(getWolfPlayer(players, 0).id).toBe('p1');
    expect(getWolfPlayer(players, 1).id).toBe('p2');
    expect(getWolfPlayer(players, 3).id).toBe('p4');
    expect(getWolfPlayer(players, 4).id).toBe('p1'); // wraps
  });
});

describe('computeWolfPoints — lone wolf pre', () => {
  it('wolf wins: +3 for wolf', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 3 },
          { playerId: 'p2', gross: 4 },
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(3);
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(0);
  });

  it('wolf loses: each opponent +1', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 5 },
          { playerId: 'p2', gross: 4 },
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p3')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p4')?.pts).toBe(1);
  });
});

describe('computeWolfPoints — lone wolf post', () => {
  it('wolf wins: +2 for wolf', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p2',
        loneWolfType: 'post',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 4 },
          { playerId: 'p2', gross: 3 },
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(2);
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(0);
  });

  it('wolf loses: each opponent +1', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p2',
        loneWolfType: 'post',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 3 },
          { playerId: 'p2', gross: 5 },
          { playerId: 'p3', gross: 4 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p3')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p4')?.pts).toBe(1);
  });
});

describe('computeWolfPoints — partner', () => {
  it('wolf+partner win: each gets +1', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: null,
        partnerId: 'p3',
        scores: [
          { playerId: 'p1', gross: 4 },
          { playerId: 'p2', gross: 5 },
          { playerId: 'p3', gross: 3 }, // best on team = 3
          { playerId: 'p4', gross: 5 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p3')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p4')?.pts).toBe(0);
  });

  it('opponents win: each gets +1', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: null,
        partnerId: 'p3',
        scores: [
          { playerId: 'p1', gross: 5 },
          { playerId: 'p2', gross: 3 }, // best opponent = 3
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p3')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(1);
    expect(pts.find((p) => p.playerId === 'p4')?.pts).toBe(1);
  });

  it('tie: no points', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: null,
        partnerId: 'p3',
        scores: [
          { playerId: 'p1', gross: 4 },
          { playerId: 'p2', gross: 4 }, // tie
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 5 },
        ],
      },
      players,
    );
    expect(pts.every((p) => p.pts === 0)).toBe(true);
  });
});

describe('computeWolfPoints — incomplete data', () => {
  it('returns empty array if scores are missing', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [{ playerId: 'p1', gross: 3 }],
      },
      players,
    );
    expect(pts).toHaveLength(0);
  });

  it('returns empty array if no wolf mode chosen', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: null,
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 4 },
          { playerId: 'p2', gross: 4 },
          { playerId: 'p3', gross: 4 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
    );
    expect(pts).toHaveLength(0);
  });
});

describe('computeWolfPoints — ties (carry-over)', () => {
  it('lone wolf pre tie: all zeros when wolf ties best opponent', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 4 },
          { playerId: 'p2', gross: 4 }, // ties wolf
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 6 },
        ],
      },
      players,
    );
    expect(pts.every((p) => p.pts === 0)).toBe(true);
    expect(pts).toHaveLength(4);
  });

  it('carry added to wolf win', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 3 },
          { playerId: 'p2', gross: 4 },
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
      3, // carry
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(6); // 3 + 3 carry
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(0);
  });

  it('carry added to opponents when wolf loses', () => {
    const pts = computeWolfPoints(
      {
        wolfPlayerId: 'p1',
        loneWolfType: 'pre',
        partnerId: null,
        scores: [
          { playerId: 'p1', gross: 5 },
          { playerId: 'p2', gross: 4 },
          { playerId: 'p3', gross: 5 },
          { playerId: 'p4', gross: 4 },
        ],
      },
      players,
      2, // carry
    );
    expect(pts.find((p) => p.playerId === 'p1')?.pts).toBe(0);
    expect(pts.find((p) => p.playerId === 'p2')?.pts).toBe(3); // 1 + 2 carry
    expect(pts.find((p) => p.playerId === 'p3')?.pts).toBe(3);
    expect(pts.find((p) => p.playerId === 'p4')?.pts).toBe(3);
  });
});

describe('computeCarryForHole', () => {
  it('returns 0 for hole 0', () => {
    expect(computeCarryForHole([], 0)).toBe(0);
  });

  it('returns 0 when previous hole was decisive', () => {
    const h0 = { ...emptyWolfHole(players, 0), locked: true };
    const withPts = withComputedPoints(
      { ...h0, loneWolfType: 'pre' as const, scores: [
        { playerId: 'p1', gross: 3 },
        { playerId: 'p2', gross: 4 },
        { playerId: 'p3', gross: 5 },
        { playerId: 'p4', gross: 4 },
      ]},
      players,
    );
    expect(computeCarryForHole([withPts], 1)).toBe(0);
  });

  it('accumulates carry from consecutive tied holes', () => {
    // Hole 0: lone pre tie → carry = 3
    const h0 = withComputedPoints(
      { ...emptyWolfHole(players, 0), locked: true, loneWolfType: 'pre' as const,
        scores: [{ playerId: 'p1', gross: 4 }, { playerId: 'p2', gross: 4 }, { playerId: 'p3', gross: 5 }, { playerId: 'p4', gross: 6 }] },
      players, 0,
    );
    // Hole 1: partner tie → carry = 1
    const h1 = withComputedPoints(
      { ...emptyWolfHole(players, 1), locked: true, loneWolfType: null, partnerId: 'p3',
        scores: [{ playerId: 'p1', gross: 4 }, { playerId: 'p2', gross: 4 }, { playerId: 'p3', gross: 4 }, { playerId: 'p4', gross: 4 }] },
      players, 3, // carry from h0
    );
    expect(computeCarryForHole([h0, h1], 2)).toBe(4); // 3 + 1
  });

  it('resets carry after a decisive hole', () => {
    // Hole 0: tied
    const h0 = withComputedPoints(
      { ...emptyWolfHole(players, 0), locked: true, loneWolfType: 'pre' as const,
        scores: [{ playerId: 'p1', gross: 4 }, { playerId: 'p2', gross: 4 }, { playerId: 'p3', gross: 5 }, { playerId: 'p4', gross: 6 }] },
      players, 0,
    );
    // Hole 1: decisive (wolf wins, collecting carry)
    const h1 = withComputedPoints(
      { ...emptyWolfHole(players, 1), locked: true, loneWolfType: 'pre' as const,
        scores: [{ playerId: 'p2', gross: 3 }, { playerId: 'p1', gross: 4 }, { playerId: 'p3', gross: 5 }, { playerId: 'p4', gross: 6 }] },
      players, 3,
    );
    // Hole 2: carry should be 0
    expect(computeCarryForHole([h0, h1], 2)).toBe(0);
  });
});
