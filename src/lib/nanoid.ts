// Tiny nanoid-like ID generator (no dependency needed)
export function nanoid(size = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = new Uint8Array(size);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join('');
}
