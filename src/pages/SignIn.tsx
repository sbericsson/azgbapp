import { useEffect, useContext, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthContext } from '../hooks/useAuth';
import { ApiError } from '../lib/api';
import { verifySignInToken } from '../lib/data';

/** Landing page for the emailed link: /signin?token=… */
export function SignIn() {
  const { completeSignIn } = useContext(AuthContext);
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    verifySignInToken(token)
      .then(async (me) => {
        await completeSignIn(me);
        navigate('/', { replace: true });
      })
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 0
          ? 'No connection. Open the link again when you have signal.'
          : 'This sign-in link is invalid or has expired. Request a new one.');
      });
  }, [completeSignIn, navigate]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6 text-center">
      {error ? (
        <>
          <p className="text-red-400 mb-6">{error}</p>
          <Link to="/" className="px-6 h-12 rounded-xl bg-green-600 text-white font-bold flex items-center">Sign in</Link>
        </>
      ) : (
        <p className="text-gray-400">Signing you in…</p>
      )}
    </div>
  );
}
