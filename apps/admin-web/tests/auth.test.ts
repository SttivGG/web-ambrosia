import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { safeReturnTo } from '../lib/auth/return-to';
import { AuthError, responseError, safeMessage } from '../lib/auth/errors';
import { identityOrigin } from '../lib/auth/config';
const user = {
  id: 'a1111111-1111-4111-8111-111111111111',
  displayName: 'Ana',
  email: 'ana@example.test',
  role: 'OWNER',
  permissions: ['users.manage'],
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
describe('returnTo', () => {
  it.each([
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    '/%2f%2fevil.test',
    '/dashboard%0aevil',
    '/dashboard/../../login',
    '/login',
    '/api/auth/logout',
    'javascript:alert(1)',
    '/%ZZ',
    undefined,
  ])('rechaza %s', (value) => expect(safeReturnTo(value)).toBe('/dashboard'));
  it('conserva ruta y parámetros locales', () =>
    expect(safeReturnTo('/dashboard?view=health')).toBe(
      '/dashboard?view=health',
    ));
});
it('serializa errores sin detalles internos', () => {
  expect(JSON.parse(JSON.stringify(responseError(500)))).toEqual({
    kind: 'unavailable',
    status: 500,
    message: 'El servicio de acceso no está disponible temporalmente.',
  });
  expect(safeMessage(new Error('secret'))).not.toContain('secret');
});
it.each([401, 403, 429, 500, 400])('tipa error %i', (status) =>
  expect(responseError(status)).toBeInstanceOf(AuthError),
);
it('valida origen exclusivamente interno de servidor', () => {
  expect(identityOrigin('http://identity-service:3004')).toBe(
    'http://identity-service:3004',
  );
  expect(() => identityOrigin('http://user:secret@host')).toThrow(
    'IDENTITY_INTERNAL_URL',
  );
});
it('CSRF comparte solicitudes simultáneas y no persiste el token', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({ csrfToken: 'test-csrf' }));
  vi.stubGlobal('fetch', fetcher);
  const { getCsrfToken } = await import('../lib/auth/client');
  expect(await Promise.all([getCsrfToken(), getCsrfToken()])).toEqual([
    'test-csrf',
    'test-csrf',
  ]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('login obtiene CSRF antes de credenciales y consulta me', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ csrfToken: 'test-csrf' }))
    .mockResolvedValueOnce(json(user))
    .mockResolvedValueOnce(json(user));
  vi.stubGlobal('fetch', fetcher);
  const { login } = await import('../lib/auth/client');
  expect(await login({ email: user.email, password: 'test-only' })).toEqual(
    user,
  );
  expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
    '/api/auth/csrf',
    '/api/auth/login',
    '/api/auth/me',
  ]);
  expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
    credentials: 'include',
    headers: { 'X-CSRF-Token': 'test-csrf' },
  });
});
it('credenciales incorrectas producen error genérico sin refresh', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ csrfToken: 'test' }))
    .mockResolvedValueOnce(json({ detail: 'private' }, 401));
  vi.stubGlobal('fetch', fetcher);
  const { login } = await import('../lib/auth/client');
  await expect(login({ email: user.email, password: 'bad' })).rejects.toThrow(
    'Correo o contraseña incorrectos.',
  );
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('rechaza respuestas inválidas y caídas de servicio', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'unexpected' }))
      .mockRejectedValueOnce(new Error('private')),
  );
  const { getCurrentUser } = await import('../lib/auth/client');
  await expect(getCurrentUser()).rejects.toMatchObject({
    kind: 'invalid-response',
  });
  await expect(getCurrentUser()).rejects.toMatchObject({ kind: 'unavailable' });
});
it('refresh single-flight valida me y notifica usuario', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ csrfToken: 'test' }))
    .mockResolvedValueOnce(json(user))
    .mockResolvedValueOnce(json(user));
  vi.stubGlobal('fetch', fetcher);
  const { refreshSession, subscribeSession } =
    await import('../lib/auth/client');
  const listener = vi.fn();
  subscribeSession(listener);
  await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
  expect(
    fetcher.mock.calls.filter((call) => call[0] === '/api/auth/refresh'),
  ).toHaveLength(1);
  expect(listener).toHaveBeenCalledWith(user);
});
it.each(['logout', 'logoutAll', 'changePassword'] as const)(
  '%s limpia el estado después del éxito',
  async (method) => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ csrfToken: 'test' }))
        .mockResolvedValueOnce(json({ ok: true })),
    );
    const client = await import('../lib/auth/client');
    const listener = vi.fn();
    client.subscribeSession(listener);
    await client[method]({
      currentPassword: 'test',
      newPassword: 'different-test',
    });
    expect(listener).toHaveBeenCalledWith(null);
  },
);
it('logout no limpia estado si el servicio está caído', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error()));
  const client = await import('../lib/auth/client');
  const listener = vi.fn();
  client.subscribeSession(listener);
  await expect(client.logout()).rejects.toMatchObject({ kind: 'unavailable' });
  expect(listener).not.toHaveBeenCalled();
});
it('403 renueva CSRF una sola vez', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('csrf') ? json({ csrfToken: 'test' }) : json({}, 403),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { logout } = await import('../lib/auth/client');
  await expect(logout()).rejects.toMatchObject({ kind: 'forbidden' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('solicitudes 401 simultáneas comparten refresh y reintentan una vez', async () => {
  const counts = new Map<string, number>();
  const fetcher = vi.fn().mockImplementation((path: string) => {
    counts.set(path, (counts.get(path) ?? 0) + 1);
    return Promise.resolve(
      path.endsWith('/csrf')
        ? json({ csrfToken: 'test' })
        : path.endsWith('/refresh') || path.endsWith('/me')
          ? json(user)
          : json({}, counts.get(path) === 1 ? 401 : 200),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const { authenticatedFetch } = await import('../lib/api/authenticated-fetch');
  const responses = await Promise.all([
    authenticatedFetch('/api/read-a'),
    authenticatedFetch('/api/read-b'),
  ]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(counts.get('/api/auth/refresh')).toBe(1);
});
it('un segundo 401 termina la sesión sin bucle', async () => {
  const fetcher = vi
    .fn()
    .mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/csrf')
          ? json({ csrfToken: 'test' })
          : path.endsWith('/refresh') || path.endsWith('/me')
            ? json(user)
            : json({}, 401),
      ),
    );
  vi.stubGlobal('fetch', fetcher);
  const { authenticatedFetch } = await import('../lib/api/authenticated-fetch');
  expect((await authenticatedFetch('/api/read')).status).toBe(401);
  expect(
    fetcher.mock.calls.filter((call) => call[0] === '/api/read'),
  ).toHaveLength(2);
  expect(
    fetcher.mock.calls.filter((call) => call[0] === '/api/auth/refresh'),
  ).toHaveLength(1);
});
it.each([
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/csrf',
])('no renueva %s', async (path) => {
  const fetcher = vi.fn().mockResolvedValue(json({}, 401));
  vi.stubGlobal('fetch', fetcher);
  const { authenticatedFetch } = await import('../lib/api/authenticated-fetch');
  await authenticatedFetch(path);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('no repite mutaciones ni permite orígenes externos', async () => {
  const fetcher = vi.fn().mockResolvedValue(json({}, 401));
  vi.stubGlobal('fetch', fetcher);
  const { authenticatedFetch } = await import('../lib/api/authenticated-fetch');
  await authenticatedFetch('/api/write', { method: 'POST' });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    authenticatedFetch('https://evil.test/api/read'),
  ).rejects.toMatchObject({ kind: 'rejected' });
});
