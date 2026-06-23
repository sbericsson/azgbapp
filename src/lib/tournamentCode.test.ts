import { describe, expect, it } from 'vitest';
import { tournamentCodeCandidates } from './tournamentCode';

describe('tournamentCodeCandidates', () => {
  it('preserves the exact user-entered code first', () => {
    expect(tournamentCodeCandidates(' qaai0622 ')).toEqual(['qaai0622', 'QAAI0622']);
  });

  it('falls back from uppercase user input to lowercase tournament ids', () => {
    expect(tournamentCodeCandidates('QAAI0622')).toEqual(['QAAI0622', 'qaai0622']);
  });

  it('falls back from lowercase user input to uppercase generated ids', () => {
    expect(tournamentCodeCandidates('azgb2026')).toEqual(['azgb2026', 'AZGB2026']);
  });

  it('returns no candidates for blank input', () => {
    expect(tournamentCodeCandidates('   ')).toEqual([]);
  });
});
