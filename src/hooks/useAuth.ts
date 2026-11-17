import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { isNetworkError, clearCache } from '../lib/api';
import {
  fetchMe,
  getTournament,
  signOut,
  updateTournament,
  type Me,
  type ScorerGroupRef,
} from '../lib/data';
import type { Tournament } from '../types/tournament';

/**
 * Who is signed in (R13). The session is an httpOnly cookie set by the server
 * after a sign-in link or code (emailed, or shared by an organiser); it lasts
 * 60 days from last use. A phone signed in by a group's shared link has no
 * email, only that group (and any other group links opened on it). The server's
 * answer to /auth/me (organiser of which tournaments, scorer of which groups)
 * is cached on the phone so the app opens offline. The tournament being
 * viewed is remembered per device.
 */

interface AuthState {
  me: Me | null;
  tournamentId: string | null;
  tournament: Tournament | null;
  loading: boolean;
}

export interface AuthContextValue extends AuthState {
  /** Signed in by email or by a shared group link */
  signedIn: boolean;
  email: string | null;
  isAppAdmin: boolean;
  /** Organiser of the current tournament (or app admin inside it) */
  isAdmin: boolean;
  /** Groups this person scores for in the current tournament */
  scorerGroups: ScorerGroupRef[];
  /** Tournament codes this person organises or scores in */
  myTournamentIds: string[];
  groupForRound: (roundId: string) => ScorerGroupRef | null;
  /** After /auth/verify: remember who signed in and open their tournament */
  completeSignIn: (me: Me & { tournamentId?: string | null }) => Promise<void>;
  selectTournament: (id: string | null) => Promise<boolean>;
  refreshMe: () => Promise<void>;
  logout: () => void;
  updateTournamentData: (data: Partial<Pick<Tournament, 'name' | 'logoUrl'>>) => Promise<void>;
}

const ME_KEY = 'azgb_me';
const TOURNAMENT_KEY = 'azgb_tournament';

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable
  }
}

function tournamentIdsOf(me: Me | null): string[] {
  if (!me) return [];
  return [...new Set([...me.admin, ...me.groups.map((g) => g.tournamentId)])];
}

const noop = async () => {};

export const AuthContext = createContext<AuthContextValue>({
  me: null,
  tournamentId: null,
  tournament: null,
  loading: false,
  signedIn: false,
  email: null,
  isAppAdmin: false,
  isAdmin: false,
  scorerGroups: [],
  myTournamentIds: [],
  groupForRound: () => null,
  completeSignIn: noop,
  selectTournament: async () => false,
  refreshMe: noop,
  logout: () => {},
  updateTournamentData: noop,
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>(() => {
    const me = readJson<Me>(ME_KEY);
    return {
      me: me?.signedIn ? me : null,
      tournamentId: readJson<string>(TOURNAMENT_KEY),
      tournament: null,
      loading: true,
    };
  });

  // Bumped by every sign-in or refresh, so a slower, older answer (the start-up
  // check racing an emailed link) cannot overwrite a newer identity
  const generation = useRef(0);

  const loadTournament = useCallback(async (id: string | null): Promise<Tournament | null> => {
    if (!id) return null;
    try {
      return await getTournament(id);
    } catch (err) {
      if (isNetworkError(err)) return null;
      throw err;
    }
  }, []);

  const applyMe = useCallback(async (me: Me | null, preferred: string | null, gen: number) => {
    if (gen !== generation.current) return;
    writeJson(ME_KEY, me?.signedIn ? me : null);
    const ids = tournamentIdsOf(me);
    let tournamentId = preferred;
    // Only one tournament to choose from: open it
    if (!tournamentId && me?.signedIn && !me.appAdmin && ids.length === 1) tournamentId = ids[0];
    if (!me?.signedIn) tournamentId = null;
    writeJson(TOURNAMENT_KEY, tournamentId);
    const tournament = await loadTournament(tournamentId).catch(() => null);
    if (gen !== generation.current) return;
    setState({ me: me?.signedIn ? me : null, tournamentId, tournament, loading: false });
  }, [loadTournament]);

  // Restore on start: ask the server who we are; offline, trust the cached answer
  useEffect(() => {
    let cancelled = false;
    const gen = generation.current;
    (async () => {
      const cached = readJson<Me>(ME_KEY);
      const preferred = readJson<string>(TOURNAMENT_KEY);
      let me: Me | null = cached;
      try {
        me = await fetchMe();
      } catch (err) {
        if (!isNetworkError(err)) me = null;
      }
      if (!cancelled) await applyMe(me, preferred, gen);
    })();
    return () => { cancelled = true; };
  }, [applyMe]);

  const refreshMe = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const me = await fetchMe();
      await applyMe(me, readJson<string>(TOURNAMENT_KEY), gen);
    } catch {
      // Keep what we have
    }
  }, [applyMe]);

  const completeSignIn = useCallback(async (me: Me & { tournamentId?: string | null }) => {
    const gen = ++generation.current;
    const { tournamentId, ...rest } = me;
    await applyMe(rest, tournamentId ?? readJson<string>(TOURNAMENT_KEY), gen);
  }, [applyMe]);

  const selectTournament = useCallback(async (id: string | null): Promise<boolean> => {
    if (!id) {
      writeJson(TOURNAMENT_KEY, null);
      setState((s) => ({ ...s, tournamentId: null, tournament: null }));
      return true;
    }
    const tournament = await loadTournament(id);
    if (!tournament) return false;
    writeJson(TOURNAMENT_KEY, tournament.id);
    setState((s) => ({ ...s, tournamentId: tournament.id, tournament }));
    return true;
  }, [loadTournament]);

  const logout = useCallback(() => {
    void signOut().catch(() => {}).finally(() => {
      writeJson(ME_KEY, null);
      writeJson(TOURNAMENT_KEY, null);
      clearCache();
      window.location.replace('/');
    });
  }, []);

  const updateTournamentData = useCallback(async (data: Partial<Pick<Tournament, 'name' | 'logoUrl'>>) => {
    if (!state.tournamentId) return;
    await updateTournament(state.tournamentId, data);
    setState((prev) => ({ ...prev, tournament: prev.tournament ? { ...prev.tournament, ...data } : null }));
  }, [state.tournamentId]);

  const derived = useMemo(() => {
    const me = state.me;
    const isAppAdmin = !!me?.appAdmin;
    const isAdmin = !!state.tournamentId && (isAppAdmin || !!me?.admin.includes(state.tournamentId));
    const scorerGroups = me?.groups.filter((g) => g.tournamentId === state.tournamentId) ?? [];
    return {
      signedIn: !!me?.signedIn,
      email: me?.email ?? null,
      isAppAdmin,
      isAdmin,
      scorerGroups,
      myTournamentIds: tournamentIdsOf(me),
      groupForRound: (roundId: string) => scorerGroups.find((g) => g.roundId === roundId) ?? null,
    };
  }, [state.me, state.tournamentId]);

  return {
    ...state,
    ...derived,
    completeSignIn,
    selectTournament,
    refreshMe,
    logout,
    updateTournamentData,
  };
}
