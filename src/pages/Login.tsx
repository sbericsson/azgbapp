import { useState, useEffect, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { getTournament } from '../lib/firestore';

export function Login() {
  const { loginAsGroup, loginAsAdmin, loginAsAppAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [tournamentCode, setTournamentCode] = useState('');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const raw = localStorage.getItem('azgb_session');
    if (!raw) return;
    try {
      const session = JSON.parse(raw);
      if (session.tournamentId) {
        setTournamentCode(session.tournamentId);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const code = tournamentCode.trim().toUpperCase();
    if (!code) { setLogoUrl(null); return; }
    getTournament(code).then((t) => {
      setLogoUrl(t?.logoUrl ?? null);
    }).catch(() => { setLogoUrl(null); });
  }, [tournamentCode]);

  const backspace = () => setPin((p) => p.slice(0, -1));
  const clear = () => setPin('');

  const submit = async (pinValue = pin) => {
    if (pinValue.length < 4) {
      setError('PIN must be 4 digits');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const code = tournamentCode.trim().toUpperCase();

      if (!code) {
        // App admin: blank tournament code
        const ok = await loginAsAppAdmin(pinValue);
        if (ok) {
          navigate('/app-admin');
          return;
        }
        setError('Invalid master PIN.');
        return;
      }

      const isAdmin = await loginAsAdmin(code, pinValue);
      if (isAdmin) {
        navigate('/admin');
        return;
      }
      const isGroup = await loginAsGroup(code, pinValue);
      if (isGroup) {
        navigate('/');
        return;
      }
      setError('Invalid tournament code or PIN. Check with your group.');
    } catch (err) {
      console.error('Login error:', err);
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
      setPin('');
    }
  };

  const append = (digit: string) => {
    if (pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    setError('');
    if (next.length === 4) submit(next);
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <div className="bg-white rounded-2xl p-3 shadow-lg">
            <img src={logoUrl ?? '/azgb-logo.png'} alt="AZ Golf Bender" className="w-44 h-auto" />
          </div>
        </div>

        {/* Tournament code */}
        <div className="mb-5">
          <input
            type="text"
            className="w-full bg-gray-800 rounded-xl px-4 py-3 text-white text-center
                       text-lg placeholder-gray-600 border-2 border-gray-700
                       focus:border-green-500 focus:outline-none tracking-widest"
            placeholder="Tournament code"
            value={tournamentCode}
            onChange={(e) => { setTournamentCode(e.target.value); setError(''); }}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        <p className="text-gray-400 text-center mb-4 text-sm">Enter your group PIN</p>

        {/* PIN display */}
        <div className="flex justify-center gap-3 mb-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className={`w-10 h-12 rounded-lg border-2 flex items-center justify-center text-xl font-bold
                ${i < pin.length
                  ? 'border-green-500 text-white bg-gray-800'
                  : 'border-gray-700 text-transparent bg-gray-900'}`}
            >
              {i < pin.length ? '•' : ''}
            </div>
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-sm text-center mb-4">{error}</p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {digits.map((d) => (
            <button
              key={d}
              onClick={() => append(d)}
              className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-semibold active:bg-gray-700 select-none"
            >
              {d}
            </button>
          ))}
          <button
            onClick={clear}
            className="h-16 rounded-2xl bg-gray-800 text-gray-400 text-lg active:bg-gray-700 select-none"
          >
            CLR
          </button>
          <button
            onClick={() => append('0')}
            className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-semibold active:bg-gray-700 select-none"
          >
            0
          </button>
          <button
            onClick={backspace}
            className="h-16 rounded-2xl bg-gray-800 text-gray-400 text-2xl active:bg-gray-700 select-none"
          >
            ⌫
          </button>
        </div>

        <button
          onClick={() => submit()}
          disabled={loading || pin.length < 4}
          className="w-full mt-6 h-16 rounded-2xl bg-green-600 text-white text-xl font-bold
            active:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed select-none"
        >
          {loading ? 'Checking…' : 'Enter'}
        </button>

        <p className="text-center mt-6 text-gray-600 text-sm">
          Running your own tournament?{' '}
          <a href="/create" className="text-green-500 hover:text-green-400 underline">
            Create one here
          </a>
        </p>
      </div>
    </div>
  );
}
