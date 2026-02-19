// Points tables for Wolf format
// loneWolfType='pre'  win: +3, lose: each opponent +1
// loneWolfType='post' win: +2, lose: each opponent +1
// partner             win pair each: +1, lose: 0 all, tie: 0 all

export const WOLF_LONE_PRE_WIN = 3;
export const WOLF_LONE_POST_WIN = 2;
export const WOLF_LONE_LOSE_EACH = 1; // each of the other 3 players gets this
export const WOLF_PARTNER_WIN_EACH = 1;
export const DEFAULT_PAR = [4,4,3,4,5,4,3,4,5, 4,4,3,4,5,4,3,4,5] as const;
