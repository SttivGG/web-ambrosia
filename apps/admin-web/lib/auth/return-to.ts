export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) return '/dashboard';
  try {
    const decoded = decodeURIComponent(value);
    if (
      !value.startsWith('/') ||
      /[\\\x00-\x20]/.test(decoded) ||
      decoded.startsWith('//')
    )
      return '/dashboard';
    const url = new URL(value, 'https://ambrosia.invalid');
    if (
      url.origin !== 'https://ambrosia.invalid' ||
      !/^\/(?:dashboard(?:\/|$)|inventario\/(?:catalogo|proveedores|compras|existencias|movimientos)(?:\/|$))/.test(
        url.pathname,
      )
    )
      return '/dashboard';
    return url.pathname + url.search;
  } catch {
    return '/dashboard';
  }
}
