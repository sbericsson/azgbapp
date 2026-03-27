import { type ReactElement, useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Admin } from './pages/Admin';
import { AppAdmin } from './pages/AppAdmin';
import { Home } from './pages/Home';
import { Scorecard } from './pages/Scorecard';
import { Leaderboard } from './pages/Leaderboard';
import { PublicScorecard } from './pages/PublicScorecard';
import { PrintResults } from './pages/PrintResults';
import { PublicResults } from './pages/PublicResults';
import { CreateTournament } from './pages/CreateTournament';

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Loading…</p>
    </div>
  );
}

/** Root: Login when not auth'd; redirect by role */
function RootRoute() {
  const { group, isAdmin, isAppAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (isAppAdmin && !isAdmin) return <Navigate to="/app-admin" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (group) return <Home />;
  return <Login />;
}

function ProtectedAppAdminRoute({ element }: { element: ReactElement }) {
  const { isAppAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!isAppAdmin) return <Navigate to="/" replace />;
  return element;
}

function ProtectedGroupRoute({ element }: { element: ReactElement }) {
  const { group, isAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!group && !isAdmin) return <Navigate to="/" replace />;
  return element;
}

function ProtectedAdminRoute({ element }: { element: ReactElement }) {
  const { isAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return element;
}

function BypassRoute() {
  useEffect(() => {
    localStorage.setItem('azgb_bypass', 'true');
    window.location.replace('/');
  }, []);
  return null;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/bypass" element={<BypassRoute />} />
      <Route path="/create" element={<CreateTournament />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/app-admin" element={<ProtectedAppAdminRoute element={<AppAdmin />} />} />
      <Route path="/admin" element={<ProtectedAdminRoute element={<Admin />} />} />
      <Route path="/admin/results" element={<ProtectedAdminRoute element={<PrintResults />} />} />
      <Route path="/scorecard/:roundId/:groupId" element={<ProtectedGroupRoute element={<PublicScorecard />} />} />
      <Route path="/scorecard/:roundId" element={<ProtectedGroupRoute element={<Scorecard />} />} />
      <Route path="/leaderboard/:roundId" element={<ProtectedGroupRoute element={<Leaderboard />} />} />
      <Route path="/results/:tournamentId" element={<PublicResults />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DevBanner() {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
  if (!projectId?.includes('-dev')) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-xs font-bold text-center py-1 pointer-events-none">
      DEV — {projectId}
    </div>
  );
}

export default function App() {
  const auth = useAuthProvider();
  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <DevBanner />
        <AppRoutes />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
