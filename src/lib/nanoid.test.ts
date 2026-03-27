import { describe, it, expect } from 'vitest';
import { generateTournamentCode } from './nanoid';

const VALID_CHARS = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
const AMBIGUOUS_CHARS = new Set(['O', 'I', '0', '1']);

describe('generateTournamentCode', () => {
  it('produces exactly 8 characters', () => {
    expect(generateTournamentCode()).toHaveLength(8);
  });

  it('only uses the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTournamentCode();
      for (const char of code) {
        expect(VALID_CHARS.has(char), `unexpected char "${char}" in code "${code}"`).toBe(true);
      }
    }
  });

  it('never contains ambiguous characters O, I, 0, 1', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateTournamentCode();
      for (const char of code) {
        expect(AMBIGUOUS_CHARS.has(char), `ambiguous char "${char}" in code "${code}"`).toBe(false);
      }
    }
  });

  it('produces uppercase only', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateTournamentCode();
      expect(code).toBe(code.toUpperCase());
    }
  });

  it('produces distinct codes across many calls', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateTournamentCode()));
    // At 380B combinations, 500 calls should all be unique
    expect(codes.size).toBe(500);
  });
});
