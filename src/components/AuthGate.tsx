import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Music, User } from 'lucide-react';
import {
  AuthUser,
  UNAUTHORIZED_EVENT,
  EMAIL_MAX,
  isValidEmail,
  sanitizeEmailInput,
  apiFetch,
  authApi,
  readCachedUser,
  writeCachedUser,
} from '../utils/auth';

interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthGate>');
  return ctx;
}

/** Shows the login screen until there is a session; renders the app (children) once signed in. */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);

  const setSession = useCallback((next: AuthUser | null) => {
    setUser(next);
    writeCachedUser(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/auth/me')
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setSession(data.user ?? null);
        } else if (res.status >= 500) {
          // Server unavailable: keep the offline-first app usable with the last signed-in user
          setUser(readCachedUser());
        } else {
          setSession(null);
        }
      })
      .catch(() => {
        if (!cancelled) setUser(readCachedUser()); // no connection
      })
      .finally(() => !cancelled && setChecking(false));
    return () => {
      cancelled = true;
    };
  }, [setSession]);

  // Any 401 from the API means the session ended (expired, deactivated, signed out elsewhere)
  useEffect(() => {
    const onUnauthorized = () => setSession(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [setSession]);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // offline: still drop the local session
    }
    setSession(null);
  }, [setSession]);

  if (checking) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-[color:var(--page)] text-[color:var(--ink)]">
        <Loader2 className="w-6 h-6 animate-spin opacity-60" />
      </div>
    );
  }

  if (!user) return <LoginScreen onLoggedIn={setSession} />;

  return <AuthContext.Provider value={{ user, logout }}>{children}</AuthContext.Provider>;
}

// Shared account for "Ingresa sin cuenta": everyone who uses it sees and edits the same songs.
const GUEST_USERNAME = import.meta.env.VITE_GUEST_USERNAME as string | undefined;
const GUEST_PASSWORD = import.meta.env.VITE_GUEST_PASSWORD as string | undefined;
const REQUEST_ACCOUNT_URL = `https://wa.me/51924486717?text=${encodeURIComponent('Hola, quiero solicitar una cuenta en Lirika')}`;

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const signIn = async (user: string, pass: string) => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      onLoggedIn(await authApi.login(user, pass));
    } catch (err: any) {
      setError(err?.message === 'Failed to fetch' ? 'Sin conexión con el servidor' : err?.message || 'No se pudo iniciar sesión');
      setLoading(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail(username)) {
      setError('Ingresa un correo electrónico válido');
      return;
    }
    signIn(username, password);
  };

  const guestSignIn = () => {
    if (!GUEST_USERNAME || !GUEST_PASSWORD) {
      setError('El acceso sin cuenta no está disponible');
      return;
    }
    signIn(GUEST_USERNAME, GUEST_PASSWORD);
  };

  const INPUT =
    'w-full h-[52px] px-5 rounded-full bg-white/[0.08] border border-white/15 text-[15px] font-medium outline-none focus:border-[oklch(0.82_0.14_75)] transition-colors placeholder:text-[#8b8b96]';

  return (
    <div className="relative h-[100dvh] flex items-center justify-center p-5 overflow-hidden bg-[color:var(--page)] text-[color:var(--ink)]">
      <div className="pointer-events-none absolute -left-28 -top-16 w-[340px] h-[340px] rounded-full opacity-40 blur-[80px] bg-[oklch(0.72_0.15_70)]" />
      <div className="pointer-events-none absolute -right-36 bottom-0 w-[360px] h-[360px] rounded-full opacity-40 blur-[90px] bg-[oklch(0.62_0.17_300)]" />

      <div className="relative w-full max-w-sm rounded-[32px] p-6 pt-8 bg-[color:var(--sheet)] border border-white/[0.18] backdrop-blur-3xl shadow-[0_24px_70px_rgba(0,0,0,0.5)]">
        <div className="flex flex-col items-center text-center gap-2.5 mb-6">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-[oklch(0.82_0.14_75_/_0.18)] text-[oklch(0.82_0.14_75)]">
            <Music className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Lirika</h1>
          <p className="text-[13px] opacity-70">Inicia sesión para ver tus letras</p>
        </div>

        <form onSubmit={submit} noValidate>
          <div className="space-y-3">
            <label htmlFor="login-email" className="sr-only">
              Correo electrónico
            </label>
            <input
              id="login-email"
              className={INPUT}
              type="email"
              inputMode="email"
              maxLength={EMAIL_MAX}
              placeholder="Correo electrónico"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(sanitizeEmailInput(e.target.value));
                setError(null);
              }}
              autoFocus
            />
            <label htmlFor="login-password" className="sr-only">
              Contraseña
            </label>
            <div className="relative">
              <input
                id="login-password"
                className={`${INPUT} pr-14`}
                type={showPassword ? 'text' : 'password'}
                placeholder="Contraseña"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-1 top-1 w-11 h-11 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 transition-opacity"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <p role="alert" className={`mt-3 text-center text-[12px] font-bold text-[oklch(0.7_0.19_22)] ${error ? '' : 'hidden'}`}>
            {error}
          </p>

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="mt-5 w-full h-[52px] rounded-full text-[15px] font-extrabold flex items-center justify-center gap-2.5 bg-[oklch(0.82_0.14_75)] text-[#17130a] shadow-[0_8px_24px_oklch(0.72_0.15_70_/_0.35)] active:scale-95 transition-transform disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-[18px] h-[18px] animate-spin" /> : <LogIn className="w-[18px] h-[18px]" />}
            Entrar
          </button>
        </form>

        <div className="mt-5 flex items-center gap-3.5 text-xs font-semibold opacity-60">
          <div className="flex-1 h-px bg-white/15" />
          <span>o</span>
          <div className="flex-1 h-px bg-white/15" />
        </div>

        <button
          type="button"
          onClick={guestSignIn}
          disabled={loading}
          className="mt-3 w-full h-[52px] rounded-full text-sm font-extrabold flex items-center justify-center gap-2.5 bg-white/10 active:scale-95 transition-transform disabled:opacity-50"
        >
          <User className="w-[18px] h-[18px]" />
          Ingresa sin cuenta
        </button>
        <p className="mt-3 text-center text-xs font-medium leading-snug opacity-60">
          Cuenta compartida: las canciones son de todos los que ingresan sin cuenta.
        </p>

        <p className="mt-6 text-center text-[13px] font-medium opacity-80">
          ¿No tienes cuenta?{' '}
          <a
            href={REQUEST_ACCOUNT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-extrabold text-[oklch(0.82_0.14_75)] hover:underline"
          >
            Solicítala aquí
          </a>
        </p>
      </div>
    </div>
  );
}
