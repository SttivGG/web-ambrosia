export function identityOrigin(value: string | undefined): string {
  try {
    const url = new URL(value ?? 'http://127.0.0.1:3004');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new Error('Configuración inválida: IDENTITY_INTERNAL_URL');
  }
}
