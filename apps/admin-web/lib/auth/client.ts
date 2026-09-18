import {
  authSuccessV1Schema,
  csrfV1Schema,
  publicUserV1Schema,
  type LoginV1,
  type ChangePasswordV1,
  type PublicUserV1,
} from '@ambrosia/contracts';
import { AuthError, responseError } from './errors';
type Schema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};
export async function authRequest<T>(
  path: string,
  schema: Schema<T>,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/auth/' + path, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AuthError('unavailable');
  }
  if (!response.ok) throw responseError(response.status);
  try {
    const result = schema.safeParse(await response.json());
    if (result.success) return result.data;
  } catch {
    /* Reject malformed responses without their content. */
  }
  throw new AuthError('invalid-response');
}
let csrfFlight: Promise<string> | undefined;
export function getCsrfToken(): Promise<string> {
  if (!csrfFlight)
    csrfFlight = authRequest('csrf', csrfV1Schema)
      .then((data) => data.csrfToken)
      .finally(() => {
        csrfFlight = undefined;
      });
  return csrfFlight;
}
async function mutate<T>(
  path: string,
  schema: Schema<T>,
  body?: unknown,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const csrf = await getCsrfToken();
    try {
      return await authRequest(path, schema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      // CSRF is checked before side effects; only that rejection is safe to retry.
      if (!(
        error instanceof AuthError &&
        error.kind === 'forbidden' &&
        attempt === 0
      ))
        throw error;
    }
  }
  throw new AuthError('forbidden');
}
type SessionListener = (user: PublicUserV1 | null) => void;
const listeners = new Set<SessionListener>();
export function subscribeSession(listener: SessionListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function publishSession(user: PublicUserV1 | null) {
  listeners.forEach((listener) => listener(user));
}
export async function getCurrentUser() {
  const user = await authRequest('me', publicUserV1Schema);
  publishSession(user);
  return user;
}
export async function login(credentials: LoginV1) {
  await mutate('login', publicUserV1Schema, credentials);
  return getCurrentUser();
}
let refreshFlight: Promise<PublicUserV1> | undefined;
let revision = 0;
export function sessionRevision() {
  return revision;
}
export function refreshSession(): Promise<PublicUserV1> {
  if (!refreshFlight)
    refreshFlight = mutate('refresh', publicUserV1Schema)
      .then(async () => {
        const user = await getCurrentUser();
        revision++;
        return user;
      })
      .finally(() => {
        refreshFlight = undefined;
      });
  return refreshFlight;
}
export async function logout() {
  await mutate('logout', authSuccessV1Schema);
  publishSession(null);
}
export async function logoutAll() {
  await mutate('logout-all', authSuccessV1Schema);
  publishSession(null);
}
export async function changePassword(credentials: ChangePasswordV1) {
  await mutate('change-password', authSuccessV1Schema, credentials);
  publishSession(null);
}
