import { describe, expect, it } from 'vitest';
import { buildCountFacts, isShortThirdPersonLine, sanitizePolish, type AIFeedbackContext } from './feedbackAI';

function ctx(over: Partial<AIFeedbackContext> = {}): AIFeedbackContext {
  return {
    format: 'scramble',
    roundName: 'Sunday',
    totalHoles: 18,
    players: [],
    holeHistory: [
      { holeNum: 1, par: 4, rel: -1 },
      { holeNum: 2, par: 4, rel: 0 },
      { holeNum: 3, par: 5, rel: -1 },
    ],
    currentHole: { holeNum: 4, par: 4, rel: -1 },
    runningTotal: -3,
    rank: 2,
    totalGroups: 2,
    standing: 'trailing',
    strokesFromLead: 1,
    leaderboard: [
      { groupName: 'Team Phoenix', score: -4, holesPlayed: 4 },
      { groupName: 'VK Sons', score: -3, holesPlayed: 4 },
    ],
    ourGroupName: 'VK Sons',
    recentFeedback: [],
    ...over,
  };
}

describe('AI commentary checks', () => {
  it('counts the facts the model may cite', () => {
    expect(buildCountFacts(ctx())).toBe(
      '14 holes left; 3 birdies or better this round; 0 bogeys or worse this round; 2 birdies-or-better in a row; 1 stroke behind Team Phoenix',
    );
    expect(buildCountFacts(ctx({ runningTotal: -4, currentHole: { holeNum: 18, par: 4, rel: -1 } }))).toContain('round finished');
    expect(buildCountFacts(ctx({ runningTotal: -4 }))).toContain('level with Team Phoenix');
  });

  it('accepts a short third-person line', () => {
    expect(isShortThirdPersonLine('The team is stacking birdies like par is a rumor.')).toBe(true);
  });

  it('rejects first person, long lines, dash chains and fragments', () => {
    expect(isShortThirdPersonLine('We are coming for Team Phoenix and nobody can stop it.')).toBe(false);
    expect(isShortThirdPersonLine(Array(30).fill('word').join(' ') + '.')).toBe(false);
    expect(isShortThirdPersonLine('Birdies — more birdies — and still more birdies for them.')).toBe(false);
    expect(isShortThirdPersonLine('One back now.')).toBe(false);
  });

  it('drops a reply cut off mid-sentence or ending in a question', () => {
    expect(sanitizePolish('One back with ten holes left means the only', ctx())).toBeNull();
    expect(sanitizePolish('One back with ten holes left, who is sweating now?', ctx())).toBeNull();
    expect(sanitizePolish('Team Phoenix can hear the footsteps getting louder now.', ctx())).toBe(
      'Team Phoenix can hear the footsteps getting louder now.',
    );
  });

  it('drops a repeated joke but not repeated score talk', () => {
    const recent = ['Birdie on hole 3 puts the team at -2 through 3. The team is treating par like a rumor on this course.'];
    expect(sanitizePolish('Somehow they keep treating par like a rumor out here.', ctx({ recentFeedback: recent }))).toBeNull();
    const statRecent = ['Birdie on hole 3 puts the team at -2 through 3. Two birdies or better in a row has Team Phoenix nervous.'];
    expect(sanitizePolish('Three birdies or better in a row and the footsteps are getting loud.', ctx({ recentFeedback: statRecent }))).not.toBeNull();
  });
});
