import { type ReactElement, useContext, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, useAuthProvider } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Admin } from './pages/Admin';
import { Home } from './pages/Home';
import { Scorecard } from './pages/Scorecard';
import { Leaderboard } from './pages/Leaderboard';
import { PublicScorecard } from './pages/PublicScorecard';
import { LaunchGate } from './components/LaunchGate';

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Loading…</p>
    </div>
  );
}

/** Root: Login when not auth'd; redirect admin → /admin; group → Home */
function RootRoute() {
  const { group, isAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (group) return <Home />;
  return <Login />;
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
    <LaunchGate>
      <Routes>
        <Route path="/bypass" element={<BypassRoute />} />
        <Route path="/" element={<RootRoute />} />
        <Route path="/admin" element={<ProtectedAdminRoute element={<Admin />} />} />
        <Route path="/scorecard/:roundId/:groupId" element={<ProtectedGroupRoute element={<PublicScorecard />} />} />
        <Route path="/scorecard/:roundId" element={<ProtectedGroupRoute element={<Scorecard />} />} />
        <Route path="/leaderboard/:roundId" element={<ProtectedGroupRoute element={<Leaderboard />} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LaunchGate>
  );
}

export default function App() {
  const auth = useAuthProvider();
  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
