import { describe, it, expect } from 'vitest';
import { parseBackup, BACKUP_VERSION } from './backupFormat';

const valid = {
  version: BACKUP_VERSION,
  exportedAt: 1,
  tournamentId: 'abc',
  tournament: { name: 'T', adminPin: '1234', createdAt: 1 },
  rounds: [{ id: 'r1', data: { name: 'R1' }, scores: [{ id: 'g1', data: { holes: [] } }] }],
  groups: [{ id: 'g1', data: { name: 'G1' } }],
  golfers: [],
  courses: [],
};

describe('parseBackup', () => {
  it('accepts a valid backup', () => {
    expect(parseBackup(JSON.parse(JSON.stringify(valid))).tournamentId).toBe('abc');
  });

  it('rejects other versions', () => {
    expect(() => parseBackup({ ...valid, version: 99 })).toThrow(/version/);
  });

  it('rejects malformed lists', () => {
    expect(() => parseBackup({ ...valid, groups: [{ id: 1 }] })).toThrow(/groups/);
    expect(() => parseBackup({ ...valid, rounds: [{ id: 'r', data: {} }] })).toThrow(/scores/);
    expect(() => parseBackup(null)).toThrow();
  });
});
