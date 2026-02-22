import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import { getGroupByPin, getTournament, getGroupById, updateGroup } from '../lib/firestore';
import type { Group, Tournament } from '../types/tournament';

interface AuthState {
  tournamentId: string | null;
  tournament: Tournament | null;
  group: Group | null;
  isAdmin: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  loginAsGroup: (tournamentId: string, pin: string) => Promise<boolean>;
  loginAsAdmin: (tournamentId: string, pin: string) => Promise<boolean>;
  logout: () => void;
  updateGroupName: (newName: string) => Promise<void>;
}

const SESSION_KEY = 'azgb_session';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface StoredSession {
  tournamentId: string;
  groupId: string | null;
  isAdmin: boolean;
  loginAt: number;
}

export const AuthContext = createContext<AuthContextValue>({
  tournamentId: null,
  tournament: null,
  group: null,
  isAdmin: false,
  loading: false,
  loginAsGroup: async () => false,
  loginAsAdmin: async () => false,
  logout: () => {},
  updateGroupName: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>({
    tournamentId: null,
    tournament: null,
    group: null,
    isAdmin: false,
    loading: true,
  });

  // Restore session on mount
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const session: StoredSession = JSON.parse(raw);
    if (!session.loginAt || Date.now() - session.loginAt > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    (async () => {
      const tournament = await getTournament(session.tournamentId).catch(
        () => null,
      );
      if (!tournament) {
        localStorage.removeItem(SESSION_KEY);
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      if (session.isAdmin) {
        setState({
          tournamentId: session.tournamentId,
          tournament,
          group: null,
          isAdmin: true,
          loading: false,
        });
        return;
      }
      // Load group from Firestore if we have a groupId
      if (session.groupId) {
        const group = await getGroupById(session.tournamentId, session.groupId).catch(() => null);
        setState({
          tournamentId: session.tournamentId,
          tournament,
          group,
          isAdmin: false,
          loading: false,
        });
      } else {
        setState((s) => ({ ...s, loading: false }));
      }
    })();
  }, []);

  const loginAsGroup = useCallback(
    async (tournamentId: string, pin: string): Promise<boolean> => {
      const tournament = await getTournament(tournamentId);
      if (!tournament) return false;
      const group = await getGroupByPin(tournamentId, pin);
      if (!group) return false;
      const session: StoredSession = {
        tournamentId,
        groupId: group.id,
        isAdmin: false,
        loginAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setState({ tournamentId, tournament, group, isAdmin: false, loading: false });
      return true;
    },
    [],
  );

  const loginAsAdmin = useCallback(
    async (tournamentId: string, pin: string): Promise<boolean> => {
      const tournament = await getTournament(tournamentId);
      if (!tournament) return false;
      if (tournament.adminPin !== pin) return false;
      const session: StoredSession = {
        tournamentId,
        groupId: null,
        isAdmin: true,
        loginAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setState({ tournamentId, tournament, group: null, isAdmin: true, loading: false });
      return true;
    },
    [],
  );

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    // Full page reload: re-initializes Firestore from scratch, clearing any
    // stale IndexedDB state from the previous session.
    window.location.replace('/');
  }, []);

  const updateGroupName = useCallback(
    async (newName: string) => {
      if (!state.group || !state.tournamentId) return;
      await updateGroup(state.tournamentId, state.group.id, { name: newName });
      setState((prev) => ({
        ...prev,
        group: prev.group ? { ...prev.group, name: newName } : null,
      }));
    },
    [state.group, state.tournamentId],
  );

  return { ...state, loginAsGroup, loginAsAdmin, logout, updateGroupName };
}
