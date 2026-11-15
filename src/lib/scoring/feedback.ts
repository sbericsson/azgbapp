import type { WolfHoleScore } from '../../types/scoring';
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
