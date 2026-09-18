'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { refreshSession } from '../../lib/auth/client';
import { AuthError } from '../../lib/auth/errors';
import { safeReturnTo } from '../../lib/auth/return-to';
export function SessionGate({ recover = false }: { recover?: boolean }) {
  const router = useRouter();
  const started = useRef(false);
  const [failed, setFailed] = useState(!recover);
  useEffect(() => {
    if (!recover || started.current) return;
    started.current = true;
    if (new URL(window.location.href).searchParams.has('sessionChecked')) {
      queueMicrotask(() => setFailed(true));
      return;
    }
    void refreshSession()
      .then(() => {
        // A marker on this navigation prevents repeated recovery if server validation still fails.
        const url = new URL(window.location.href);
        if (url.searchParams.has('sessionChecked')) {
          setFailed(true);
          return;
        }
        url.searchParams.set('sessionChecked', '1');
        router.replace(safeReturnTo(url.pathname + url.search));
        router.refresh();
      })
      .catch((error: unknown) => {
        if (error instanceof AuthError && error.kind === 'unauthorized') {
          router.replace(
            '/login?reason=expired&returnTo=' +
              encodeURIComponent(
                safeReturnTo(window.location.pathname + window.location.search),
              ),
          );
          router.refresh();
        } else setFailed(true);
      });
  }, [recover, router]);
  return (
    <main id="contenido" className="auth-card" aria-live="polite">
      <p className="brand">ambrosia.</p>
      <h1>
        {failed ? 'No podemos verificar tu sesión' : 'Verificando sesión'}
      </h1>
      <p>
        {failed
          ? 'El servicio de acceso no está disponible temporalmente. Intenta nuevamente.'
          : 'Espera un momento para continuar.'}
      </p>
      {failed && (
        <button
          className="refresh"
          onClick={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete('sessionChecked');
            window.location.replace(url.pathname + url.search);
          }}
        >
          Reintentar
        </button>
      )}
    </main>
  );
}
