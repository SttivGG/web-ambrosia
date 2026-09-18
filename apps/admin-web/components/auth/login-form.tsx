'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '../../lib/auth/client';
import { safeMessage } from '../../lib/auth/errors';
import { safeReturnTo } from '../../lib/auth/return-to';
import { PasswordField } from './password-field';
export function LoginForm({
  returnTo,
  notice,
}: {
  returnTo: string;
  notice?: string;
}) {
  const router = useRouter(),
    running = useRef(false),
    errorRef = useRef<HTMLParagraphElement>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const form = event.currentTarget,
      data = new FormData(form);
    try {
      await login({
        email: String(data.get('email')),
        password: String(data.get('password')),
      });
      form.reset();
      router.replace(safeReturnTo(returnTo));
      router.refresh();
    } catch (cause) {
      setError(safeMessage(cause));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} aria-busy={busy}>
      <h1>Inicia sesión</h1>
      <p className="muted">Accede a tu panel de Ambrosia.</p>
      {notice && <p role="status">{notice}</p>}
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={254}
        />
      </div>
      <PasswordField id="password" label="Contraseña" />
      <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">
        {error}
      </p>
      <button className="refresh submit" disabled={busy}>
        {busy ? 'Iniciando sesión…' : 'Iniciar sesión'}
      </button>
    </form>
  );
}
