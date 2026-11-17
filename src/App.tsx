import { type ReactElement, useContext } from 'react';
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
import { SignIn } from './pages/SignIn';
import { TournamentPicker } from './pages/TournamentPicker';

function Spinner() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <p className="text-gray-400">Loading…</p>
    </div>
  );
}

/** Root: sign-in when signed out; otherwise by role in the open tournament */
function RootRoute() {
  const { signedIn, tournamentId, isAdmin, isAppAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!signedIn) return <Login />;
  if (!tournamentId) return isAppAdmin ? <Navigate to="/app-admin" replace /> : <TournamentPicker />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  return <Home />;
}

function ProtectedAppAdminRoute({ element }: { element: ReactElement }) {
  const { isAppAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!isAppAdmin) return <Navigate to="/" replace />;
  return element;
}

/** Signed in with a tournament open (scorer or organiser) */
function ProtectedGroupRoute({ element }: { element: ReactElement }) {
  const { signedIn, tournamentId, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!signedIn || !tournamentId) return <Navigate to="/" replace />;
  return element;
}

function ProtectedAdminRoute({ element }: { element: ReactElement }) {
  const { isAdmin, loading } = useContext(AuthContext);
  if (loading) return <Spinner />;
  if (!isAdmin) return <Navigate to="/" replace />;
  return element;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/create" element={<CreateTournament />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/" element={<RootRoute />} />
      <Route path="/app-admin" element={<ProtectedAppAdminRoute element={<AppAdmin />} />} />
      <Route path="/admin" element={<ProtectedAdminRoute element={<Admin />} />} />
      <Route path="/admin/results" element={<ProtectedAdminRoute element={<PrintResults />} />} />
      <Route path="/admin/scorecard/:roundId/:groupId" element={<ProtectedAdminRoute element={<Scorecard />} />} />
      <Route path="/scorecard/:roundId/:groupId" element={<ProtectedGroupRoute element={<PublicScorecard />} />} />
      <Route path="/scorecard/:roundId" element={<ProtectedGroupRoute element={<Scorecard />} />} />
      <Route path="/leaderboard/:roundId" element={<ProtectedGroupRoute element={<Leaderboard />} />} />
      <Route path="/results/:tournamentId" element={<PublicResults />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function DevBanner() {
  if (!import.meta.env.DEV) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-500 text-black text-xs font-bold text-center py-1 pointer-events-none">
      DEV
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
