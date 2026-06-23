export function tournamentCodeCandidates(input: string): string[] {
  const code = input.trim();
  if (!code) return [];

  return Array.from(new Set([code, code.toLowerCase(), code.toUpperCase()]));
}
