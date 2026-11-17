// Must be a model the OpenRouter workspace's guardrails allow, by its exact (dated) id.
const OPENROUTER_MODEL = (import.meta.env.VITE_OPENROUTER_MODEL as string | undefined) ?? 'deepseek/deepseek-v4.1-flash-20261017';
// Same-origin proxy: nginx adds the key server-side and rate-limits (R15)
const OPENROUTER_API_URL = '/proxy/openrouter/chat/completions';

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
        'That keeps the pressure on everyone else.',
        'That is exactly how you protect position without getting reckless.',
      ], seed);
    }
    return pickStable([
      'That pulls them a little closer and keeps the round alive.',
      'That is a clean bounce-back and a reason to keep swinging.',
      'That gives them something useful to build on right now.',
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

function isTooSimilarToRecent(text: string, recent: string[], names: Set<string> = new Set()): boolean {
  const normalized = normalize(text);
  if (!normalized) return true;

  const firstWords = normalized.split(' ').slice(0, 6).join(' ');
  return recent.some((entry) => {
    const prior = normalize(extractRecentPolish(entry));
    if (!prior) return false;
    if (prior === normalized) return true;
    if (prior.split(' ').slice(0, 6).join(' ') === firstWords) return true;
    return sharesPhrase(normalized, prior, names);
  });
}

// "the team is" and friends are how every line starts: not a repeated joke
const FILLER = new Set([
  'the', 'team', 'is', 'and', 'a', 'an', 'to', 'of', 'on', 'in', 'with', 'it', 'its', 'that', 'like', 'they', 'their',
  // score talk repeats by nature
  'birdie', 'birdies', 'eagle', 'or', 'better', 'worse', 'bogey', 'bogeys', 'par', 'zero', 'no', 'holes', 'hole',
  'straight', 'row', 'stroke', 'strokes', 'up', 'back', 'clear', 'ahead', 'left', 'play', 'all', 'round', 'day',
  'are', 'be', 'been', 'was', 'were', 'has', 'have', 'had', 'just', 'so', 'now', 'this', 'at', 'for', 'but', 'by',
  'as', 'out', 'here', 'them', 'you', 'your', 'if', 'than', 'then', 'from', 'into', 'over', 'still', 'even', 'more',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'already', 'basically', 'officially', 'right',
]);

/**
 * A repeated joke: the same two meaningful words in a row as an earlier line,
 * once filler, score talk and team names are dropped ("treating par like a
 * rumor" and "treating par like a total rumor" both reduce to "treating rumor").
 */
function sharesPhrase(a: string, b: string, names: Set<string>): boolean {
  const pairs = (t: string) => {
    const w = t.split(' ').filter((x) => x.length > 1 && !FILLER.has(x) && !names.has(x));
    const out = new Set<string>();
    for (let i = 0; i + 2 <= w.length; i++) out.add(`${w[i]} ${w[i + 1]}`);
    return out;
  };
  const seen = pairs(b);
  for (const p of pairs(a)) if (seen.has(p)) return true;
  return false;
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

/** 5–28 words, no "we/us/our", at most one dash (the prompt asks for ≤20 words). */
export function isShortThirdPersonLine(sentence: string): boolean {
  const words = sentence.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  if (words < 5 || words > 28) return false;
  if (/\b(we|we're|we've|we'll|us|our|ours)\b/i.test(sentence)) return false;
  const dashes = (sentence.match(/[—–]|\s-\s/g) ?? []).length;
  return dashes <= 1;
}

export function sanitizePolish(text: string, ctx: AIFeedbackContext): string | null {
  const cleaned = stripPreamble(text).replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;

  const firstSentence = splitSentences(cleaned)[0] ?? '';
  if (!firstSentence) return null;
  // A reply cut off by max_tokens has no closing punctuation: never show half a joke
  if (!/[.!]["')\]]?$/.test(firstSentence)) return null;
  if (!isShortThirdPersonLine(firstSentence)) return null;
  if (mentionsUnsupportedDetail(firstSentence, ctx)) return null;
  const names = new Set(ctx.leaderboard.flatMap((e) => normalize(e.groupName).split(' ')));
  if (isTooSimilarToRecent(firstSentence, ctx.recentFeedback, names)) return null;

  return firstSentence;
}

export function buildFallbackFeedback(ctx: AIFeedbackContext): string {
  return `${buildFactSentence(ctx)} ${buildFallbackPolish(ctx)}`;
}

function buildTrendText(ctx: AIFeedbackContext): string {
  const prev = ctx.holeHistory.at(-1);
  const current = resultLabel(ctx.currentHole.rel);
  const previous = prev ? resultLabel(prev.rel) : 'none';
  const momentum =
    prev === undefined
      ? 'opening'
      : ctx.currentHole.rel < prev.rel
        ? 'improving'
        : ctx.currentHole.rel > prev.rel
          ? 'slipping'
          : 'steady';

  if (ctx.currentHole.rel <= -1) {
    if (prev && prev.rel >= 1) return `recovery hype: ${previous} to ${current}; make it mostly celebratory, with at most one tiny jab at the prior hole; do not frame this result as negative`;
    return `hype: ${current}, ${momentum}, make it cocky and celebratory`;
  }

  if (ctx.currentHole.rel === 0) {
    if (ctx.standing === 'leading' || ctx.standing === 'tiedLead') {
      return 'steady praise: par while in front, calm but a little smug';
    }
    return 'light jab: par while chasing, useful but not enough';
  }

  if (prev && prev.rel <= -1) {
    return `warning roast: ${previous} to ${current}, call out the stumble after momentum`;
  }

  return `roast: ${current}, ${momentum}, funny and sharp without being cruel`;
}

/** Every number the model may mention, computed here so it never has to count. */
export function buildCountFacts(ctx: AIFeedbackContext): string {
  const all = [...ctx.holeHistory, ctx.currentHole];
  const facts: string[] = [];
  const left = ctx.totalHoles - ctx.currentHole.holeNum;
  facts.push(left === 0 ? 'round finished' : `${left} hole${left === 1 ? '' : 's'} left`);
  const under = all.filter((h) => h.rel <= -1).length;
  facts.push(`${under} birdie${under === 1 ? '' : 's'} or better this round`);
  const over = all.filter((h) => h.rel >= 1).length;
  facts.push(`${over} bogey${over === 1 ? '' : 's'} or worse this round`);

  let run = 0;
  const good = ctx.currentHole.rel <= -1;
  const bad = ctx.currentHole.rel >= 1;
  if (good || bad) {
    for (let i = all.length - 1; i >= 0 && (good ? all[i].rel <= -1 : all[i].rel >= 1); i--) run++;
    if (run >= 2) facts.push(`${run} ${good ? 'birdies-or-better' : 'bogeys-or-worse'} in a row`);
  }

  const others = ctx.leaderboard.filter((e) => e.groupName !== ctx.ourGroupName);
  if (others.length > 0) {
    const best = others.reduce((a, b) => (b.score < a.score ? b : a));
    const gap = best.score - ctx.runningTotal; // > 0: we lead
    facts.push(
      gap > 0 ? `${gap} stroke${gap === 1 ? '' : 's'} ahead of ${best.groupName}`
        : gap < 0 ? `${-gap} stroke${gap === -1 ? '' : 's'} behind ${best.groupName}`
          : `level with ${best.groupName}`,
    );
  }
  return facts.join('; ');
}

function buildSystemInstruction(format: AIFeedbackContext['format']): string {
  const base =
    'You are the tournament group-chat heckler: hype good trends, roast bad ones. ' +
    'The app already wrote the factual first sentence; write exactly ONE fresh second sentence of at most 20 words. ' +
    'It is read on a phone between shots: short and punchy beats clever and long. ' +
    'Talk about the team in the third person (they, the team, or its name); never we, us or our. ' +
    'A statement, not a question, with at most one dash. ' +
    'Follow the supplied tone target. Sound like a funny golf buddy, not a TV announcer. ' +
    'If the tone target says recovery hype, the current good hole is the point: celebrate the bounce-back more than you roast the mistake before it. ' +
    'PG-13, playful, never cruel. Use only prompt facts; invent no shots, lies, greens, crowds, bars, carts, or player traits. ' +
    'Lead with the joke, not the stats: use at most ONE number, never list stats, and do not open with a count. ' +
    'Never count holes, birdies or strokes yourself: any number you use must appear in the facts. ' +
    'Do not contradict score or standing; when tied, nobody is ahead. This is stroke play: nobody wins or loses a hole. ' +
    'Never reuse a phrase, image or sentence shape from the recent lines. No preamble, bullets or asterisks.';

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
  parts.push(`Tone target: ${buildTrendText(ctx)}.`);
  parts.push(`Optional facts (cite at most one; compute no others): ${buildCountFacts(ctx)}.`);

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
  if (ctx.totalGroups === 2) {
    const rival = ctx.leaderboard.find((e) => e.groupName !== ctx.ourGroupName)?.groupName;
    if (rival) parts.push(`Only one other group is playing: call them ${rival}, never "the field".`);
  }

  if (ctx.recentFeedback.length > 0) {
    const recentLines = ctx.recentFeedback.map(extractRecentPolish).filter(Boolean);
    if (recentLines.length > 0) {
      parts.push(`Recent lines (do not reuse their phrases, images or shape): ${recentLines.join(' || ')}`);
    }
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
  return getOpenRouterFeedback(ctx);
}

async function getOpenRouterFeedback(ctx: AIFeedbackContext): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // A rejected line (repeat, wrong standing, too long) gets one more, livelier try
    for (const temperature of [0.45, 0.9]) {
      const polish = await requestPolish(ctx, temperature, controller.signal);
      if (polish) return `${buildFactSentence(ctx)} ${polish}`;
    }
    return buildFallbackFeedback(ctx);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestPolish(ctx: AIFeedbackContext, temperature: number, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Golf Bender',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: 'system', content: buildSystemInstruction(ctx.format) },
        { role: 'user', content: buildUserPrompt(ctx) },
      ],
      max_tokens: 80,
      temperature,
      // Reasoning models otherwise spend the whole token budget thinking and return no text
      reasoning: { enabled: false },
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('OpenRouter error body:', body);
    throw new Error(`OpenRouter error: ${res.status}`);
  }

  const data = (await res.json()) as {
    choices?: { finish_reason?: string; message?: { content?: string | null } }[];
  };

  const choice = data.choices?.[0];
  const text = choice?.message?.content?.trim();
  if (!text) throw new Error('Empty response from OpenRouter');
  if (choice?.finish_reason === 'length') return null;
  return sanitizePolish(text, ctx);
}
