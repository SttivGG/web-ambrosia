const messages = {
  'invalid-email': 'El correo no es válido.',
  'invalid-name': 'El nombre debe tener entre 1 y 100 caracteres.',
  'invalid-password':
    'La contraseña debe tener entre 12 y 128 caracteres, una letra y un número, y ser distinta del correo.',
  'owner-exists': 'Ya existe un propietario.',
} as const;
export class OwnerBootstrapError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}
export function ownerBootstrapMessage(error: unknown): string {
  return error instanceof OwnerBootstrapError
    ? messages[error.code]
    : 'Revisar la configuración y la disponibilidad de la base de datos.';
}
