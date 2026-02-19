import { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';

const TOURNAMENT_ID = import.meta.env.VITE_TOURNAMENT_ID ?? 'default';

export function Login() {
  const { loginAsGroup, loginAsAdmin } = useContext(AuthContext);
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const append = (digit: string) => {
    if (pin.length >= 6) return;
    setPin((p) => p + digit);
    setError('');
  };
  const backspace = () => setPin((p) => p.slice(0, -1));
  const clear = () => setPin('');

  const submit = async () => {
    if (pin.length < 4) {
      setError('PIN must be at least 4 digits');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const isAdmin = await loginAsAdmin(TOURNAMENT_ID, pin);
      if (isAdmin) {
        navigate('/admin');
        return;
      }
      const isGroup = await loginAsGroup(TOURNAMENT_ID, pin);
      if (isGroup) {
        navigate('/');
        return;
      }
      setError('Invalid PIN. Check with your group.');
    } catch (err) {
      console.error('Login error:', err);
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
      setPin('');
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-3">⛳</div>
          <h1 className="text-3xl font-bold text-white">AZGB</h1>
          <p className="text-gray-400 mt-1">Enter your group PIN</p>
        </div>

        {/* PIN display */}
        <div className="flex justify-center gap-3 mb-6">
          {Array.from({ length: 6 }, (_, i) => (
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
              onPointerDown={() => append(d)}
              className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-semibold active:bg-gray-700 select-none"
            >
              {d}
            </button>
          ))}
          <button
            onPointerDown={clear}
            className="h-16 rounded-2xl bg-gray-800 text-gray-400 text-lg active:bg-gray-700 select-none"
          >
            CLR
          </button>
          <button
            onPointerDown={() => append('0')}
            className="h-16 rounded-2xl bg-gray-800 text-white text-2xl font-semibold active:bg-gray-700 select-none"
          >
            0
          </button>
          <button
            onPointerDown={backspace}
            className="h-16 rounded-2xl bg-gray-800 text-gray-400 text-2xl active:bg-gray-700 select-none"
          >
            ⌫
          </button>
        </div>

        <button
          onPointerDown={submit}
          disabled={loading || pin.length < 4}
          className="w-full mt-6 h-16 rounded-2xl bg-green-600 text-white text-xl font-bold
            active:bg-green-500 disabled:opacity-40 disabled:cursor-not-allowed select-none"
        >
          {loading ? 'Checking…' : 'Enter'}
        </button>
      </div>
    </div>
  );
}
