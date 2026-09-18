'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { changePassword, logout } from '../../lib/auth/client';
import { safeMessage } from '../../lib/auth/errors';
import { useSession } from './session-provider';
import { PasswordField } from './password-field';
export function UserMenu() {
  const { user } = useSession(),
    router = useRouter();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const running = useRef(false),
    errorRef = useRef<HTMLParagraphElement>(null);
  function showError(message: string) {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  }
  async function exit() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await logout();
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      showError(safeMessage(cause));
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const currentPassword = String(data.get('currentPassword')),
      newPassword = String(data.get('newPassword'));
    if (newPassword !== data.get('confirmation')) {
      showError('Las contraseñas nuevas no coinciden.');
      return;
    }
    if (
      !/\p{L}/u.test(newPassword) ||
      !/\p{N}/u.test(newPassword) ||
      newPassword.trim().toLowerCase() === user?.email.toLowerCase() ||
      newPassword === currentPassword
    ) {
      showError(
        'Usa una contraseña diferente, con una letra y un número, que no sea tu correo.',
      );
      return;
    }
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await changePassword({ currentPassword, newPassword });
      router.replace('/login?reason=password-changed');
      router.refresh();
    } catch (cause) {
      showError(safeMessage(cause));
    } finally {
      form.reset();
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="user-menu">
      <summary>Mi cuenta</summary>
      <div className="account-panel">
        <p>{user?.email}</p>
        <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">
          {error}
        </p>
        <button
          type="button"
          className="refresh"
          disabled={busy}
          onClick={() => void exit()}
        >
          {busy ? 'Procesando…' : 'Cerrar sesión'}
        </button>
        <details>
          <summary>Cambiar contraseña</summary>
          <form onSubmit={change} aria-busy={busy}>
            <p>Usa entre 12 y 128 caracteres, una letra y un número.</p>
            <PasswordField id="currentPassword" label="Contraseña actual" />
            <PasswordField
              id="newPassword"
              label="Contraseña nueva"
              autoComplete="new-password"
              minLength={12}
            />
            <PasswordField
              id="confirmation"
              label="Confirmar contraseña"
              autoComplete="new-password"
              minLength={12}
            />
            <label className="confirm">
              <input type="checkbox" required />
              Confirmo que se cerrarán todas mis sesiones y tendré que iniciar
              sesión nuevamente.
            </label>
            <button className="refresh" disabled={busy}>
              {busy ? 'Procesando…' : 'Guardar contraseña'}
            </button>
          </form>
        </details>
      </div>
    </details>
  );
}
