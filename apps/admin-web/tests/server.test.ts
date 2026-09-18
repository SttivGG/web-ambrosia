import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const jar = vi.hoisted(() => ({ getAll: vi.fn(), has: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ cookies: async () => jar }));
const user = {
  id: 'a1111111-1111-4111-8111-111111111111',
  displayName: 'Ana',
  email: 'ana@example.test',
  role: 'OWNER',
  permissions: [],
};
beforeEach(() => {
  vi.resetModules();
  jar.getAll.mockReturnValue([{ value: 'test-access' }]);
  jar.has.mockReturnValue(false);
});
afterEach(() => vi.unstubAllGlobals());
it('servidor solo reenvía access sin cache y con timeout', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(user)));
  vi.stubGlobal('fetch', fetcher);
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: 'authenticated', user });
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    headers: { Cookie: 'ambrosia_access=test-access' },
    cache: 'no-store',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
});
it('cookie ausente sin binding es anónima', async () => {
  jar.getAll.mockReturnValue([]);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: 'anonymous' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('binding solo permite intentar recuperación, nunca autentica', async () => {
  jar.getAll.mockReturnValue([]);
  jar.has.mockReturnValue(true);
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: 'expired' });
});
it.each([
  [401, 'expired'],
  [503, 'unavailable'],
  [200, 'invalid-response'],
])('distingue respuesta %i: %s', async (status, expected) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: Number(status) })),
  );
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: expected });
});
it('error de red no destruye cookies', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockRejectedValue(new Error('internal network')),
  );
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: 'unavailable' });
});
it('cookies access duplicadas no se reenvían', async () => {
  jar.getAll.mockReturnValue([{ value: 'first' }, { value: 'second' }]);
  vi.stubGlobal('fetch', vi.fn());
  const { getServerSession } = await import('../lib/auth/server');
  expect(await getServerSession()).toEqual({ status: 'anonymous' });
});
