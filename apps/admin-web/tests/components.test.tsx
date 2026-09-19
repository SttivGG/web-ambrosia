// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LoginForm } from '../components/auth/login-form';
import { PasswordField } from '../components/auth/password-field';
import { SessionProvider } from '../components/auth/session-provider';
import { AdminShell } from '../components/layout/admin-shell';
import { SessionGate } from '../components/auth/session-gate';
import { AuthError } from '../lib/auth/errors';
import * as client from '../lib/auth/client';
const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/dashboard',
}));
vi.mock('../lib/auth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof client>();
  return {
    ...actual,
    login: vi.fn(),
    logout: vi.fn(),
    changePassword: vi.fn(),
    refreshSession: vi.fn(),
  };
});
const user = {
  id: 'a1111111-1111-4111-8111-111111111111',
  displayName: 'Ana Pérez',
  email: 'ana@example.test',
  role: 'OWNER' as const,
  permissions: [],
};
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  window.history.replaceState({}, '', '/dashboard');
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(node: ReactNode) {
  await act(async () => root.render(node));
}
async function click(selector: string) {
  await act(async () =>
    (container.querySelector(selector) as HTMLElement).click(),
  );
}
async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('contraseña conserva autocomplete y alterna visibilidad', async () => {
  await render(<PasswordField id="password" label="Contraseña" />);
  expect(container.querySelector('input')?.autocomplete).toBe(
    'current-password',
  );
  expect(container.querySelector('label')?.htmlFor).toBe('password');
  await click('button');
  expect(container.querySelector('input')?.type).toBe('text');
  expect(container.querySelector('button')?.getAttribute('aria-pressed')).toBe(
    'true',
  );
  await click('button');
  expect(container.querySelector('input')?.type).toBe('password');
});
it('login bloquea doble envío y expone estado de carga', async () => {
  let finish!: (value: typeof user) => void;
  vi.mocked(client.login).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(<LoginForm returnTo="/dashboard?view=health" />);
  await submit();
  await submit();
  expect(client.login).toHaveBeenCalledTimes(1);
  expect(
    container
      .querySelector('button[type=submit], button.submit')
      ?.hasAttribute('disabled'),
  ).toBe(true);
  expect(container.textContent).toContain('Iniciando sesión');
  await act(async () => finish(user));
  expect(router.replace).toHaveBeenCalledWith('/dashboard?view=health');
  expect(router.refresh).toHaveBeenCalled();
});
it('login muestra error genérico accesible y permite reintentar', async () => {
  vi.mocked(client.login).mockRejectedValue(new AuthError('unauthorized', 401));
  await render(<LoginForm returnTo="/dashboard" />);
  await submit();
  expect(container.querySelector('[role=alert]')?.textContent).toBe(
    'Correo o contraseña incorrectos.',
  );
  expect(
    container.querySelector('button.submit')?.hasAttribute('disabled'),
  ).toBe(false);
});
it('provider comparte usuario/rol y menú móvil accesible', async () => {
  await render(
    <SessionProvider initialUser={user}>
      <AdminShell>
        <p>Contenido protegido</p>
      </AdminShell>
    </SessionProvider>,
  );
  expect(container.textContent).toContain('Ana Pérez');
  expect(container.textContent).toContain('Propietario');
  expect(
    container.querySelector('.mobile-menu')?.getAttribute('aria-expanded'),
  ).toBe('false');
  await click('.mobile-menu');
  expect(
    container.querySelector('.mobile-menu')?.getAttribute('aria-expanded'),
  ).toBe('true');
  await act(async () => client.publishSession(null));
  expect(container.textContent).not.toContain('Contenido protegido');
});
it('logout exitoso navega al login', async () => {
  vi.mocked(client.logout).mockResolvedValue(undefined);
  await render(
    <SessionProvider initialUser={user}>
      <AdminShell>Panel</AdminShell>
    </SessionProvider>,
  );
  await click('.account-panel > button');
  expect(client.logout).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/login');
});
it('logout caído conserva panel y muestra mensaje seguro', async () => {
  vi.mocked(client.logout).mockRejectedValue(new AuthError('unavailable'));
  await render(
    <SessionProvider initialUser={user}>
      <AdminShell>Panel protegido</AdminShell>
    </SessionProvider>,
  );
  await click('.account-panel > button');
  expect(container.textContent).toContain('Panel protegido');
  expect(container.textContent).toContain('temporalmente');
  expect(router.replace).not.toHaveBeenCalled();
});
it('cambio exige coincidencia y después navega y limpia campos', async () => {
  vi.mocked(client.changePassword).mockResolvedValue(undefined);
  await render(
    <SessionProvider initialUser={user}>
      <AdminShell>Panel</AdminShell>
    </SessionProvider>,
  );
  const field = (id: string) =>
    container.querySelector('#' + id) as HTMLInputElement;
  field('currentPassword').value = 'Anterior prueba 1';
  field('newPassword').value = 'Nueva contraseña 2';
  field('confirmation').value = 'Diferente';
  await submit();
  expect(client.changePassword).not.toHaveBeenCalled();
  expect(container.textContent).toContain('no coinciden');
  field('confirmation').value = field('newPassword').value;
  await submit();
  expect(client.changePassword).toHaveBeenCalledTimes(1);
  expect(router.replace).toHaveBeenCalledWith('/login?reason=password-changed');
  expect(field('newPassword').value).toBe('');
});
it('recuperación muestra pantalla neutral y renueva una sola vez', async () => {
  vi.mocked(client.refreshSession).mockResolvedValue(user);
  await render(<SessionGate recover />);
  expect(container.textContent).toContain('Verificando sesión');
  expect(client.refreshSession).toHaveBeenCalledTimes(1);
  expect(router.refresh).toHaveBeenCalled();
});
it('refresh inválido redirige sin contenido protegido', async () => {
  vi.mocked(client.refreshSession).mockRejectedValue(
    new AuthError('unauthorized', 401),
  );
  await render(<SessionGate recover />);
  expect(router.replace).toHaveBeenCalledWith(
    expect.stringContaining('/login?reason=expired'),
  );
});
it('recuperación fallida por indisponibilidad permite reintentar', async () => {
  vi.mocked(client.refreshSession).mockRejectedValue(
    new AuthError('unavailable'),
  );
  await render(<SessionGate recover />);
  expect(container.textContent).toContain('Reintentar');
  expect(router.replace).not.toHaveBeenCalled();
});
it('marca de navegación impide otro refresh', async () => {
  window.history.replaceState({}, '', '/dashboard?sessionChecked=1');
  await render(<SessionGate recover />);
  expect(client.refreshSession).not.toHaveBeenCalled();
});
