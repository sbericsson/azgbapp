const GEMMA_API_KEY = import.meta.env.VITE_GEMMA_API_KEY as string | undefined;
const MODEL = 'gemini-3.1-flash-lite-preview';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 5000;

export interface AIFeedbackContext {
  format: 'bestBall' | 'scramble' | 'gauntlet';
  roundName: string;
  totalHoles: number;
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
  standing: 'leading' | 'tiedLead' | 'trailing' | 'solo';
  strokesFromLead: number | null;
  leaderboard: { groupName: string; score: number; holesPlayed: number }[];
  ourGroupName: string;
  recentFeedback: string[];
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
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

function buildStandingText(ctx: AIFeedbackContext): string | null {
  if (ctx.totalGroups <= 1 || ctx.rank === null) return null;

  if (ctx.standing === 'leading') {
    return `${ordinal(ctx.rank)} of ${ctx.totalGroups}`;
  }

  if (ctx.standing === 'tiedLead') {
    return `tied for 1st of ${ctx.totalGroups}`;
  }

  if (ctx.strokesFromLead === null) {
    return `${ordinal(ctx.rank)} of ${ctx.totalGroups}`;
  }

  return `${ordinal(ctx.rank)} of ${ctx.totalGroups}, ${ctx.strokesFromLead} back`;
}

export function buildFactSentence(ctx: AIFeedbackContext): string {
  const standingText = buildStandingText(ctx);
  const standingSuffix = standingText ? `, ${standingText}` : '';
  return `${capitalize(resultLabel(ctx.currentHole.rel))} on hole ${ctx.currentHole.holeNum} puts the team at ${fmtScore(ctx.runningTotal)} through ${ctx.currentHole.holeNum}${standingSuffix}.`;
}

function pickStable<T>(items: T[], seed: number): T {
  return items[Math.abs(seed) % items.length];
}

function buildFallbackPolish(ctx: AIFeedbackContext): string {
  const seed = ctx.currentHole.holeNum + ctx.runningTotal + ctx.totalGroups;
  const rel = ctx.currentHole.rel;

  if (rel <= -2) {
    return pickStable([
      'That is the kind of swing hole that can change a round in a hurry.',
      'That is real forward progress, not just scorecard noise.',
      'That finally looks like a team with a plan.',
    ], seed);
  }

  if (rel === -1) {
    if (ctx.standing === 'leading' || ctx.standing === 'tiedLead') {
      return pickStable([
        'That keeps the pressure on the rest of the field.',
        'That is exactly how you protect position without getting reckless.',
      ], seed);
    }
    return pickStable([
      'That pulls them a little closer and keeps the round alive.',
      'That is at least a step in the right direction.',
      'That gives them something to build on instead of another mess.',
    ], seed);
  }

  if (rel === 0) {
    if (ctx.standing === 'leading' || ctx.standing === 'tiedLead') {
      return pickStable([
        'Steady is fine when the card is still pointed the right way.',
        'Nothing flashy, but no damage either.',
      ], seed);
    }
    return pickStable([
      'Steady helps, but it does not erase what came before it.',
      'A clean par is useful, even if it changes nothing by itself.',
    ], seed);
  }

  if (rel === 1) {
    return pickStable([
      'That gives a shot right back to the field.',
      'That is the sort of bogey that keeps a round from going anywhere.',
      'That is a mistake, not a disaster, but it still hurts.',
    ], seed);
  }

  return pickStable([
    'That is how a decent round starts to come apart.',
    'Big numbers have a way of making the rest of the day feel longer.',
    'That is a lot of damage for one hole to do.',
  ], seed);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function extractRecentPolish(text: string): string {
  const parts = splitSentences(text);
  return parts.length >= 2 ? parts.slice(1).join(' ') : parts[0] ?? '';
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTooSimilarToRecent(text: string, recent: string[]): boolean {
  const normalized = normalize(text);
  if (!normalized) return true;

  const firstWords = normalized.split(' ').slice(0, 6).join(' ');
  return recent.some((entry) => {
    const prior = normalize(extractRecentPolish(entry));
    if (!prior) return false;
    if (prior === normalized) return true;
    return prior.split(' ').slice(0, 6).join(' ') === firstWords;
  });
}

function mentionsUnsupportedDetail(text: string, ctx: AIFeedbackContext): boolean {
  const lower = text.toLowerCase();
  const unsupportedTerms = [
    'fairway',
    'rough',
    'green',
    'tee box',
    'driving range',
    'parking lot',
    'cart fees',
    'bar',
  ];

  if (unsupportedTerms.some((term) => lower.includes(term))) return true;
  if (ctx.currentHole.holeNum < 10 && lower.includes('back nine')) return true;

  const claimsLead = /\b(leading|lead|out front|in front|ahead)\b/.test(lower);
  const claimsTrail = /\b(trailing|behind|chasing|one back|two back|three back|\d+\s+back)\b/.test(lower);

  if (claimsLead && ctx.strokesFromLead !== 0) return true;
  if (claimsTrail && ctx.strokesFromLead === 0) return true;

  return false;
}

function sanitizePolish(text: string, ctx: AIFeedbackContext): string | null {
  const cleaned = stripPreamble(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const firstSentence = splitSentences(cleaned)[0] ?? '';
  if (!firstSentence) return null;
  if (mentionsUnsupportedDetail(firstSentence, ctx)) return null;
  if (isTooSimilarToRecent(firstSentence, ctx.recentFeedback)) return null;

  return firstSentence;
}

export function buildFallbackFeedback(ctx: AIFeedbackContext): string {
  return `${buildFactSentence(ctx)} ${buildFallbackPolish(ctx)}`;
}

function buildSystemInstruction(format: AIFeedbackContext['format']): string {
  const base =
    'You are a dry, brutally honest golf commentator for a private tournament. ' +
    'The app already wrote the factual first sentence. ' +
    'Respond with exactly ONE additional sentence only. ' +
    'No preamble, no meta-commentary, no asterisks, no bullet points. ' +
    "Do not start with 'Ah', 'Well', 'Okay', 'Sure', or any other filler word. " +
    'Use only facts present in the prompt. ' +
    'Do not invent swings, ball flight, fairways, greens, tee boxes, crowds, bars, parking lots, cart fees, or any other unsupported detail. ' +
    'Do not mention front nine, back nine, the turn, or tournament position unless it matches the supplied facts. ' +
    'Do not contradict the supplied standing or score. ' +
    'Vary the phrasing and avoid repeating openings, insults, or joke patterns from recent feedback.';

  if (format === 'bestBall') {
    return (
      base +
      " You can reference a player by first name only when the supplied facts make that relevant."
    );
  }
  return base + ' Do not reference any player by name — the team acts as one unit in this format.';
}

function buildUserPrompt(ctx: AIFeedbackContext): string {
  const fmtName = ctx.format === 'bestBall' ? 'best ball' : ctx.format;
  const parts: string[] = [];

  parts.push(`Format: ${fmtName}. Round: ${ctx.roundName}.`);
  parts.push(`Factual sentence already shown to the user: ${buildFactSentence(ctx)}`);

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
    `Current: hole ${cur.holeNum} of ${ctx.totalHoles}, par ${cur.par}, result ${resultLabel(cur.rel)}.${leadStr} Team running total: ${fmtScore(ctx.runningTotal)}.${streakStr}`,
  );

  const standingText = buildStandingText(ctx);
  if (standingText) {
    parts.push(`Standing now: ${standingText}.`);
  }

  if (ctx.strokesFromLead !== null) {
    parts.push(
      ctx.strokesFromLead === 0
        ? 'Strokes from lead: 0.'
        : `Strokes from lead: ${ctx.strokesFromLead}.`,
    );
  }

  if (ctx.leaderboard.length > 0) {
    const lbStr = ctx.leaderboard
      .slice(0, 4)
      .map((e, i) => {
        const name = e.groupName === ctx.ourGroupName ? 'Our group' : e.groupName;
        return `${i + 1}. ${name} ${fmtScore(e.score)} thru ${e.holesPlayed}`;
      })
      .join(' | ');
    parts.push(`Leaderboard snapshot: ${lbStr}`);
  }

  if (ctx.recentFeedback.length > 0) {
    parts.push(`Avoid echoing these recent lines: ${ctx.recentFeedback.join(' || ')}`);
  }

  parts.push('Write one fresh second sentence only.');

  return parts.join('\n');
}

// Strip common model preamble patterns as a safety net
function stripPreamble(text: string): string {
  return text
    .replace(/^(okay|sure|here('s| is)|commentary|alright)[^:]*:\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

export async function getAIFeedback(ctx: AIFeedbackContext): Promise<string> {
  if (!GEMMA_API_KEY) throw new Error('No Gemma API key configured');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}?key=${GEMMA_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemInstruction(ctx.format) }] },
        contents: [{ parts: [{ text: buildUserPrompt(ctx) }] }],
        generationConfig: { maxOutputTokens: 80, temperature: 0.45 },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('AI error body:', body);
      throw new Error(`AI error: ${res.status}`);
    }

    const data = (await res.json()) as {
      candidates?: { content: { parts: { text: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from AI');
    const polish = sanitizePolish(text, ctx);
    if (!polish) return buildFallbackFeedback(ctx);
    return `${buildFactSentence(ctx)} ${polish}`;
  } finally {
    clearTimeout(timeoutId);
  }
}
