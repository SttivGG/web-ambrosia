import {
  publishSession,
  refreshSession,
  sessionRevision,
} from '../auth/client';
import { AuthError } from '../auth/errors';
import { safeReturnTo } from '../auth/return-to';
export function expireSession() {
  publishSession(null);
  if (typeof window !== 'undefined')
    window.location.replace(
      '/login?reason=expired&returnTo=' +
        encodeURIComponent(
          safeReturnTo(window.location.pathname + window.location.search),
        ),
    );
}
export async function authenticatedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith('/api/') || /[\\\x00-\x20]/.test(path))
    throw new AuthError('rejected');
  const method = (init.method ?? 'GET').toUpperCase();
  const excluded =
    /^\/api\/auth\/(?:login|refresh|logout(?:-all)?|csrf)(?:[/?]|$)/.test(path);
  const version = sessionRevision();
  const send = () =>
    fetch(path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(8000),
    });
  const response = await send();
  if (
    response.status !== 401 ||
    excluded ||
    (method !== 'GET' && method !== 'HEAD')
  )
    return response;
  try {
    if (sessionRevision() === version) await refreshSession();
  } catch (error) {
    expireSession();
    throw error;
  }
  const retried = await send();
  if (retried.status === 401) expireSession();
  return retried;
}
