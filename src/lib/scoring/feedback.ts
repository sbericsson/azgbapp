import type { WolfHoleScore, BestBallHoleScore, ScrambleHoleScore } from '../../types/scoring';
import type { Player } from '../../types/tournament';

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateWolfFeedback(
  hole: WolfHoleScore,
  players: Player[],
  par: number,
): string {
  const wolfPts = hole.points.find((p) => p.playerId === hole.wolfPlayerId)?.pts ?? 0;
  const isTie = hole.points.length > 0 && hole.points.every((p) => p.pts === 0);
  const wolfWon = wolfPts > 0;
  const wolfScore = hole.scores.find((s) => s.playerId === hole.wolfPlayerId)?.gross ?? par;
  const relToPar = wolfScore - par;
  const wolfName = players.find((p) => p.id === hole.wolfPlayerId)?.name ?? 'The wolf';
  const isLone = hole.loneWolfType !== null;
  const isPre = hole.loneWolfType === 'pre';
  const carryNote = hole.carry > 0 && !isTie ? ` (${hole.carry} pts carried into this)` : '';

  if (isLone && isPre) {
    if (isTie) {
      return `${wolfName} went lone pre and... tied. The carry grows.`;
    }
    if (wolfWon) {
      if (relToPar <= -2) {
        return pick([
          `Eagle! ${wolfName} called it solo before swinging. Absolute scenes.${carryNote}`,
          `${wolfName} eagled it lone wolf (pre). That's borderline unfair.${carryNote}`,
        ]);
      }
      if (relToPar === -1) {
        return pick([
          `${wolfName} birdied it lone wolf (pre). Bold call, perfect delivery.${carryNote}`,
          `Birdie, lone pre, bankable. ${wolfName} doesn't miss.${carryNote}`,
        ]);
      }
      if (relToPar === 0) {
        return pick([
          `Par alone wins it for ${wolfName}. The field handed those points over.${carryNote}`,
          `${wolfName} pars it lone wolf (pre). Sometimes that's all it takes.${carryNote}`,
        ]);
      }
      if (relToPar === 1) {
        return pick([
          `${wolfName} won lone wolf pre... with a bogey. The bar was underground.${carryNote}`,
          `Bogey wins for ${wolfName}? Bold strategy, somehow paying off.${carryNote}`,
        ]);
      }
      // relToPar >= 2
      return pick([
        `${wolfName} lone wolfed (pre) with a ${wolfScore} and STILL won. Dire out there.${carryNote}`,
        `${wolfScore} lone pre and it WORKS for ${wolfName}? The field is cooked.${carryNote}`,
      ]);
    } else {
      const oppPts = hole.points.find((p) => p.playerId !== hole.wolfPlayerId)?.pts ?? 1;
      return pick([
        `Pre-declared lone wolf and fed everyone ${oppPts} pt${oppPts !== 1 ? 's' : ''} each. The field thanks you, ${wolfName}.`,
        `${wolfName} went lone pre and folded. Three happy opponents.`,
      ]);
    }
  }

  if (isLone && !isPre) {
    if (isTie) {
      return `${wolfName} went lone post and... tied. Carry grows.`;
    }
    if (wolfWon) {
      if (relToPar <= -2) {
        return pick([
          `Eagle! ${wolfName} went lone post and delivered. Massive.${carryNote}`,
          `${wolfName} eagle, lone wolf post. Saw the scores and went for it — and it paid.${carryNote}`,
        ]);
      }
      if (relToPar === -1) {
        return pick([
          `Birdie lone post for ${wolfName}. Had intel and used it.${carryNote}`,
          `${wolfName} went lone post with a birdie. Smart play, clean result.${carryNote}`,
        ]);
      }
      if (relToPar === 0) {
        return pick([
          `${wolfName} goes lone post, cards par. Still gets the job done.${carryNote}`,
          `Par is enough lone post for ${wolfName}. The others couldn't beat it.${carryNote}`,
        ]);
      }
      if (relToPar === 1) {
        return pick([
          `Bogey lone post and ${wolfName} wins? Must've seen some big numbers out there.${carryNote}`,
          `${wolfName} wins lone post with a bogey. Low bar, still cleared it.${carryNote}`,
        ]);
      }
      // relToPar >= 2
      return pick([
        `${wolfName} lone wolfed (post) with a ${wolfScore} and took it. Make it make sense.${carryNote}`,
        `${wolfScore} lone post wins for ${wolfName}. The field collapsed.${carryNote}`,
      ]);
    } else {
      const oppPts = hole.points.find((p) => p.playerId !== hole.wolfPlayerId)?.pts ?? 1;
      return pick([
        `${wolfName} saw the scores, went lone post, and still lost. Rough.`,
        `Lone post, had all the information, and ${wolfName} fed the field ${oppPts} pt${oppPts !== 1 ? 's' : ''} each.`,
      ]);
    }
  }

  // Partner mode
  const partnerName = players.find((p) => p.id === hole.partnerId)?.name ?? 'partner';
  if (isTie) {
    return pick([
      `Teams level. Carry moves forward.`,
      `${wolfName} and ${partnerName} tie with the other pair. Carry grows.`,
    ]);
  }
  if (wolfWon) {
    if (relToPar <= -2) {
      return pick([
        `Eagle! ${wolfName} + ${partnerName} win the hole in style.${carryNote}`,
        `${wolfName} eagles it, ${partnerName} along for the ride. Dominant.${carryNote}`,
      ]);
    }
    if (relToPar === -1) {
      return pick([
        `${wolfName} + ${partnerName} birdie wins the hole.${carryNote}`,
        `Birdie for ${wolfName}'s team. ${partnerName} nodding along.${carryNote}`,
      ]);
    }
    if (relToPar === 0) {
      return pick([
        `${wolfName} and ${partnerName} par it out and win.${carryNote}`,
        `Par wins for ${wolfName} + ${partnerName}. Opponents had worse.${carryNote}`,
      ]);
    }
    return pick([
      `${wolfName}'s team takes it despite the score. Opponents stumbled.${carryNote}`,
      `${wolfName} + ${partnerName} win the hole. Not pretty, but it counts.${carryNote}`,
    ]);
  } else {
    return pick([
      `The other pair beats ${wolfName}'s team this hole.`,
      `Opponents take it — ${wolfName} and ${partnerName} cough it up.`,
    ]);
  }
}

function getRankQuip(rank: number, totalGroups: number): string {
  if (rank === 1) {
    return pick([
      " Still leading. Don't look back.",
      " Out front with holes to play — hold on.",
    ]);
  }
  if (rank === 2) {
    return pick([
      " One spot back. In striking distance.",
      " Second. Close enough to catch the leader.",
    ]);
  }
  if (rank === totalGroups) {
    return pick([
      " Back of the pack — only way is up.",
      " Last place, but plenty of holes left.",
    ]);
  }
  return pick([
    " Mid-pack. A birdie run could change everything.",
    " Still in the mix.",
  ]);
}

export function generateBestBallFeedback(
  hole: BestBallHoleScore,
  par: number,
  rank: number | null,
  totalGroups: number,
  holeIndex: number,
): string {
  const rel = (hole.bestScore ?? par) - par;
  let scoreLine: string;

  if (rel <= -2) {
    scoreLine = pick([
      "Eagle! That's the kind of hole that wins leaderboards.",
      "Two under. Absolutely filthy.",
    ]);
  } else if (rel === -1) {
    scoreLine = pick([
      "Birdie. Picking up strokes.",
      "One under. That'll help.",
      "Birdie — nice work.",
    ]);
  } else if (rel === 0) {
    scoreLine = pick([
      "Par. Nothing wrong with that.",
      "Clean par. Stay steady.",
    ]);
  } else if (rel === 1) {
    scoreLine = pick([
      "Bogey. You had help and still couldn't.",
      "One over. The hole felt sorry for you.",
      "A bogey. As a team. Impressive — not in a good way.",
      "Dropped a shot. Regroup, or at least try to look like you are.",
      "Bogey. At least you're consistent — consistently disappointing.",
      "One over. The ball went everywhere except the cup.",
    ]);
  } else if (rel === 2) {
    scoreLine = pick([
      "Double bogey. Just... wow.",
      "Two over. Were you actively trying to make it harder?",
      "Double. That hole dismantled you completely.",
      "Two over. A moment of silence for your scorecard.",
      "Double bogey as a team. Both of you should be ashamed.",
      "That was a double bogey. There is no defending that.",
      "Two over. The course sends its regards.",
    ]);
  } else {
    scoreLine = pick([
      "Oof. Let's never speak of that hole again.",
      "Big number. Forget it exists.",
      "That was a disaster. Move on quickly.",
    ]);
  }

  if (holeIndex >= 9 && rank !== null && totalGroups > 0) {
    return `${scoreLine}${getRankQuip(rank, totalGroups)}`;
  }

  return scoreLine;
}

export function generateScrambleFeedback(
  hole: ScrambleHoleScore,
  par: number,
  rank: number | null,
  totalGroups: number,
  holeIndex: number,
): string {
  const rel = (hole.teamScore ?? par) - par;
  let scoreLine: string;

  if (rel <= -2) {
    scoreLine = pick([
      "Eagle! That's the kind of hole that wins leaderboards.",
      "Two under. Absolutely filthy.",
    ]);
  } else if (rel === -1) {
    scoreLine = pick([
      "Birdie. Picking up strokes.",
      "One under. That'll help.",
      "Birdie — nice work.",
    ]);
  } else if (rel === 0) {
    scoreLine = pick([
      "Par. Nothing wrong with that.",
      "Clean par. Stay steady.",
    ]);
  } else if (rel === 1) {
    scoreLine = pick([
      "Bogey. You had help and still couldn't.",
      "One over. The hole felt sorry for you.",
      "A bogey. As a team. Impressive — not in a good way.",
      "Dropped a shot. Regroup, or at least try to look like you are.",
      "Bogey. At least you're consistent — consistently disappointing.",
      "One over. The ball went everywhere except the cup.",
    ]);
  } else if (rel === 2) {
    scoreLine = pick([
      "Double bogey. Just... wow.",
      "Two over. Were you actively trying to make it harder?",
      "Double. That hole dismantled you completely.",
      "Two over. A moment of silence for your scorecard.",
      "Double bogey as a team. Both of you should be ashamed.",
      "That was a double bogey. There is no defending that.",
      "Two over. The course sends its regards.",
    ]);
  } else {
    scoreLine = pick([
      "Oof. Let's never speak of that hole again.",
      "Big number. Forget it exists.",
      "That was a disaster. Move on quickly.",
    ]);
  }

  if (holeIndex >= 9 && rank !== null && totalGroups > 0) {
    return `${scoreLine}${getRankQuip(rank, totalGroups)}`;
  }

  return scoreLine;
}
