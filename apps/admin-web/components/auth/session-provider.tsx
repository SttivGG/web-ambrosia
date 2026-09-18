'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { publicUserV1Schema, type PublicUserV1 } from '@ambrosia/contracts';
import { subscribeSession, publishSession } from '../../lib/auth/client';
import { authenticatedFetch } from '../../lib/api/authenticated-fetch';
const SessionContext = createContext<{
  user: PublicUserV1 | null;
  role: PublicUserV1['role'] | null;
  permissions: PublicUserV1['permissions'];
  status: 'authenticated' | 'anonymous' | 'unavailable';
  isLoading: boolean;
  isAuthenticated: boolean;
} | null>(null);
export function SessionProvider({
  initialUser,
  children,
}: {
  initialUser: PublicUserV1;
  children: ReactNode;
}) {
  const [user, setUser] = useState<PublicUserV1 | null>(initialUser);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => subscribeSession(setUser), []);
  useEffect(() => {
    let active = true,
      pending = false;
    const check = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await authenticatedFetch('/api/auth/me');
        if (!response.ok) throw new Error();
        const data = publicUserV1Schema.parse(await response.json());
        if (active) {
          publishSession(data);
          setUnavailable(false);
        }
      } catch {
        if (active) setUnavailable(true);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void check(), 60000);
    window.addEventListener('focus', check);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, []);
  const status = unavailable
    ? 'unavailable'
    : user
      ? 'authenticated'
      : 'anonymous';
  return (
    <SessionContext.Provider
      value={{
        user,
        role: user?.role ?? null,
        permissions: user?.permissions ?? [],
        status,
        isLoading: false,
        isAuthenticated: status === 'authenticated',
      }}
    >
      {unavailable ? (
        <main className="auth-card">
          <h1>Sesión sin verificar</h1>
          <p>El servicio de acceso no está disponible temporalmente.</p>
          <button onClick={() => window.location.reload()}>Reintentar</button>
        </main>
      ) : user ? (
        children
      ) : (
        <p role="status">Cerrando sesión…</p>
      )}
    </SessionContext.Provider>
  );
}
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider requerido');
  return value;
}
