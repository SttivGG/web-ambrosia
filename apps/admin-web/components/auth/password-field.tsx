'use client';
import { useState } from 'react';
export function PasswordField({
  id,
  label,
  autoComplete = 'current-password',
  minLength = 1,
}: {
  id: string;
  label: string;
  autoComplete?: string;
  minLength?: number;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          required
          minLength={minLength}
          maxLength={128}
        />
        <button
          type="button"
          aria-controls={id}
          aria-pressed={visible}
          aria-label={(visible ? 'Ocultar ' : 'Mostrar ') + label.toLowerCase()}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </div>
  );
}
