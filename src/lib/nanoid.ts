// Tiny nanoid-like ID generator (no dependency needed)
export function nanoid(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}

/**
 * Generate an 8-character tournament code using an unambiguous uppercase alphabet.
 * Excludes O, I, 0, 1 to avoid visual confusion when sharing codes verbally or in print.
 * ~380 billion possible combinations (28^8), effectively collision-free.
 */
export function generateTournamentCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars: A-Z minus O,I + 2-9 minus 0,1
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}
