import { describe, it, expect } from 'vitest';
import { computeWolfPoints, getWolfPlayer } from './wolf';
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
});
