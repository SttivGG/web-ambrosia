export type AuthErrorKind =
  | 'unauthorized'
  | 'forbidden'
  | 'rate-limit'
  | 'unavailable'
  | 'invalid-response'
  | 'rejected';
export class AuthError extends Error {
  constructor(
    public readonly kind: AuthErrorKind,
    public readonly status = 0,
  ) {
    super(
      kind === 'unauthorized'
        ? 'Correo o contraseña incorrectos.'
        : kind === 'rate-limit'
          ? 'Demasiados intentos. Espera un momento e inténtalo nuevamente.'
          : kind === 'unavailable'
            ? 'El servicio de acceso no está disponible temporalmente.'
            : 'No fue posible completar la solicitud. Inténtalo nuevamente.',
    );
    this.name = 'AuthError';
  }
  toJSON() {
    return { kind: this.kind, status: this.status, message: this.message };
  }
}
export function responseError(status: number) {
  return new AuthError(
    status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 429
          ? 'rate-limit'
          : status >= 500
            ? 'unavailable'
            : 'rejected',
    status,
  );
}
export function safeMessage(error: unknown) {
  return error instanceof AuthError
    ? error.message
    : 'No fue posible completar la solicitud. Inténtalo nuevamente.';
}
