import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import {
  getGroupByPin,
  getTournament,
  getGroupById,
  updateGroup,
  updateTournament,
  getAppConfig,
} from '../lib/firestore';
import type { Group, Tournament } from '../types/tournament';

interface AuthState {
  tournamentId: string | null;
  tournament: Tournament | null;
  group: Group | null;
  isAdmin: boolean;
  isAppAdmin: boolean;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  loginAsGroup: (tournamentId: string, pin: string) => Promise<boolean>;
  loginAsAdmin: (tournamentId: string, pin: string) => Promise<boolean>;
  loginAsAppAdmin: (pin: string) => Promise<boolean>;
  enterTournamentAsAdmin: (tournamentId: string) => Promise<void>;
  logout: () => void;
  updateGroupName: (newName: string) => Promise<void>;
  updateTournamentData: (data: Partial<Tournament>) => Promise<void>;
}

const SESSION_KEY = 'azgb_session';

const SESSION_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface StoredSession {
  tournamentId: string | null;
  groupId: string | null;
  isAdmin: boolean;
  isAppAdmin: boolean;
  loginAt: number;
}

const DEFAULT_AUTH_STATE: AuthState = {
  tournamentId: null,
  tournament: null,
  group: null,
  isAdmin: false,
  isAppAdmin: false,
  loading: true,
};

function readStoredSession(): StoredSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw) as StoredSession;
    if (!session.loginAt || Date.now() - session.loginAt > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export const AuthContext = createContext<AuthContextValue>({
  tournamentId: null,
  tournament: null,
  group: null,
  isAdmin: false,
  isAppAdmin: false,
  loading: false,
  loginAsGroup: async () => false,
  loginAsAdmin: async () => false,
  loginAsAppAdmin: async () => false,
  enterTournamentAsAdmin: async () => {},
  logout: () => {},
  updateGroupName: async () => {},
  updateTournamentData: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>(() => {
    const session = readStoredSession();
    return session ? DEFAULT_AUTH_STATE : { ...DEFAULT_AUTH_STATE, loading: false };
  });

  // Restore session on mount
  useEffect(() => {
    const session = readStoredSession();
    if (!session) {
      return;
    }

    (async () => {
      // App admin session
      if (session.isAppAdmin) {
        if (session.tournamentId) {
          // App admin had entered a tournament — restore that context
          const tournament = await getTournament(session.tournamentId).catch(() => null);
          setState({
            tournamentId: session.tournamentId,
            tournament,
            group: null,
            isAdmin: !!tournament,
            isAppAdmin: true,
            loading: false,
          });
        } else {
          setState({
            tournamentId: null,
            tournament: null,
            group: null,
            isAdmin: false,
            isAppAdmin: true,
            loading: false,
          });
        }
        return;
      }

      // Tournament admin or group session — tournamentId required
      if (!session.tournamentId) {
        localStorage.removeItem(SESSION_KEY);
        setState({ ...DEFAULT_AUTH_STATE, loading: false });
        return;
      }
      const tournament = await getTournament(session.tournamentId).catch(() => null);
      if (!tournament) {
        localStorage.removeItem(SESSION_KEY);
        setState({ ...DEFAULT_AUTH_STATE, loading: false });
        return;
      }
      if (session.isAdmin) {
        setState({
          tournamentId: session.tournamentId,
          tournament,
          group: null,
          isAdmin: true,
          isAppAdmin: false,
          loading: false,
        });
        return;
      }
      if (session.groupId) {
        const group = await getGroupById(session.tournamentId, session.groupId).catch(() => null);
        setState({
          tournamentId: session.tournamentId,
          tournament,
          group,
          isAdmin: false,
          isAppAdmin: false,
          loading: false,
        });
      } else {
        setState({ ...DEFAULT_AUTH_STATE, loading: false });
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
        isAppAdmin: false,
        loginAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setState({ tournamentId, tournament, group, isAdmin: false, isAppAdmin: false, loading: false });
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
        isAppAdmin: false,
        loginAt: Date.now(),
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setState({ tournamentId, tournament, group: null, isAdmin: true, isAppAdmin: false, loading: false });
      return true;
    },
    [],
  );

  const loginAsAppAdmin = useCallback(async (pin: string): Promise<boolean> => {
    const config = await getAppConfig();
    if (!config || config.appAdminPin !== pin) return false;
    const session: StoredSession = {
      tournamentId: null,
      groupId: null,
      isAdmin: false,
      isAppAdmin: true,
      loginAt: Date.now(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    setState({
      tournamentId: null,
      tournament: null,
      group: null,
      isAdmin: false,
      isAppAdmin: true,
      loading: false,
    });
    return true;
  }, []);

  const enterTournamentAsAdmin = useCallback(async (tournamentId: string): Promise<void> => {
    const tournament = await getTournament(tournamentId);
    if (!tournament) return;
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const s: StoredSession = JSON.parse(raw);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, tournamentId }));
    }
    setState((prev) => ({ ...prev, tournamentId, tournament, isAdmin: true }));
  }, []);

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

  const updateTournamentData = useCallback(
    async (data: Partial<Tournament>) => {
      if (!state.tournamentId) return;
      await updateTournament(state.tournamentId, data);
      setState((prev) => ({
        ...prev,
        tournament: prev.tournament ? { ...prev.tournament, ...data } : null,
      }));
    },
    [state.tournamentId],
  );

  return {
    ...state,
    loginAsGroup,
    loginAsAdmin,
    loginAsAppAdmin,
    enterTournamentAsAdmin,
    logout,
    updateGroupName,
    updateTournamentData,
  };
}
