const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY as string | undefined;
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';
const TIMEOUT_MS = 5000;

export interface AIFeedbackContext {
  format: 'bestBall' | 'scramble' | 'gauntlet';
  roundName: string;
  /** Each player's name + running score-to-par. For scramble/gauntlet, runningToPar is ignored. */
  players: { name: string; runningToPar: number }[];
  /** Locked holes preceding the current hole, in order */
  holeHistory: { holeNum: number; par: number; rel: number; leadPlayer?: string }[];
  /** The hole just locked */
  currentHole: { holeNum: number; par: number; rel: number; leadPlayer?: string };
  /** Team cumulative score-to-par through and including currentHole */
  runningTotal: number;
  rank: number | null;
  totalGroups: number;
  leaderboard: { groupName: string; score: number; holesPlayed: number }[];
  ourGroupName: string;
}

function fmtScore(n: number): string {
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : String(n);
}

function resultLabel(rel: number): string {
  if (rel <= -2) return 'eagle';
  if (rel === -1) return 'birdie';
  if (rel === 0) return 'par';
  if (rel === 1) return 'bogey';
  if (rel === 2) return 'double bogey';
  return `+${rel}`;
}

function detectStreak(history: { rel: number }[]): string | null {
  if (history.length < 2) return null;

  let birdieCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].rel <= -1) birdieCount++;
    else break;
  }
  if (birdieCount >= 2) return `on a ${birdieCount}-hole birdie-or-better streak`;

  let bogeyCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].rel >= 1) bogeyCount++;
    else break;
  }
  if (bogeyCount >= 2) return `on a ${bogeyCount}-hole bogey-or-worse streak`;

  return null;
}

function buildPrompt(ctx: AIFeedbackContext): string {
  const fmtName = ctx.format === 'bestBall' ? 'best ball' : ctx.format;
  const parts: string[] = [];

  parts.push(
    `Golf commentary for a private tournament. Format: ${fmtName}. Round: ${ctx.roundName}.`,
  );

  if (ctx.format === 'bestBall') {
    const pStr = ctx.players.map((p) => `${p.name} (${fmtScore(p.runningToPar)})`).join(', ');
    parts.push(`Players: ${pStr}. (individual running totals to par)`);
  } else {
    parts.push(`Players: ${ctx.players.map((p) => p.name).join(', ')}.`);
  }

  const recent = ctx.holeHistory.slice(-6);
  if (recent.length > 0) {
    const histStr = recent
      .map((h) => {
        const label = resultLabel(h.rel);
        return h.leadPlayer ? `H${h.holeNum} ${label} (${h.leadPlayer})` : `H${h.holeNum} ${label}`;
      })
      .join(', ');
    parts.push(`Hole history: ${histStr}.`);
  }

  const cur = ctx.currentHole;
  const allHistory = [...ctx.holeHistory, cur];
  const streak = detectStreak(allHistory);
  const leadStr =
    cur.leadPlayer && ctx.format === 'bestBall' ? ` Best score by ${cur.leadPlayer}.` : '';
  const streakStr = streak
    ? ` ${streak.charAt(0).toUpperCase() + streak.slice(1)}.`
    : '';
  parts.push(
    `Current: hole ${cur.holeNum}, par ${cur.par}, result ${resultLabel(cur.rel)}.${leadStr} Team running total: ${fmtScore(ctx.runningTotal)}.${streakStr}`,
  );

  if (ctx.leaderboard.length > 0) {
    const avgHoles = Math.round(
      ctx.leaderboard.reduce((s, e) => s + e.holesPlayed, 0) / ctx.leaderboard.length,
    );
    const lbStr = ctx.leaderboard
      .map((e, i) => {
        const name = e.groupName === ctx.ourGroupName ? 'Our group' : e.groupName;
        return `${i + 1}. ${name}: ${fmtScore(e.score)}`;
      })
      .join('  ');
    parts.push(
      `Leaderboard (${ctx.leaderboard.length} groups, through ~${avgHoles} holes): ${lbStr}`,
    );
  }

  parts.push('');
  parts.push(
    'Write ONE punchy commentary line (max 2 sentences). Dry, brutally honest, golf-savvy tone.',
  );
  parts.push(
    "Reference a player by first name if relevant. No asterisks, no bullet points, don't start with \"Ah\" or \"Well\".",
  );

  return parts.join('\n');
}

export async function getAIFeedback(ctx: AIFeedbackContext): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('No Gemini API key configured');

  const prompt = buildPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 100, temperature: 0.9 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);

    const data = (await res.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from Gemini');
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}
