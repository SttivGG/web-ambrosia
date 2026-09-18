// Serialized by Swagger UI and executed in the browser. Reads the CSRF response, never cookies.
export const swaggerOptions = {
  url: '../docs-json',
  withCredentials: true,
  persistAuthorization: false,
  requestInterceptor: async (request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    credentials?: string;
  }) => {
    const target = new URL(request.url, globalThis.location.origin);
    if (target.origin !== globalThis.location.origin)
      throw new Error('Origen no permitido.');
    request.credentials = 'include';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase())) {
      const response = await fetch('/api/auth/csrf', {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('No se pudo preparar la solicitud.');
      const data = (await response.json()) as { csrfToken: string };
      request.headers['X-CSRF-Token'] = data.csrfToken;
    }
    return request;
  },
};
