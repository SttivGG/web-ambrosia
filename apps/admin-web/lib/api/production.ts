import { productionErrorV1Schema } from '@ambrosia/contracts';
import { authenticatedFetch } from './authenticated-fetch';
import { getCsrfToken } from '../auth/client';
export class ProductionRequestError extends Error {
  constructor(
    message: string,
    public readonly code = '',
    public readonly fields: string[] = [],
  ) {
    super(message);
  }
}
export async function productionRequest<T>(
  path: string,
  schema: { parse(value: unknown): T },
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = await getCsrfToken();
  }
  let response: Response;
  try {
    response = await authenticatedFetch('/api/production/production/' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ProductionRequestError(
      'No se pudo conectar. Tus datos siguen en el formulario. Consulta el estado antes de repetir la operación.',
    );
  }
  if (!response.ok) {
    const parsed = productionErrorV1Schema.safeParse(
      await response.json().catch(() => null),
    );
    if (parsed.success)
      throw new ProductionRequestError(
        parsed.data.message,
        parsed.data.code,
        parsed.data.fields,
      );
    throw new ProductionRequestError(
      response.status === 403
        ? 'No tienes permiso o la verificación CSRF expiró.'
        : response.status === 401
          ? 'Tu sesión expiró. Recarga para recuperarla.'
          : 'No se pudo completar la operación. Consulta su estado antes de repetirla.',
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new ProductionRequestError(
      'Respuesta inválida. Consulta el estado antes de repetir la operación.',
    );
  }
}
