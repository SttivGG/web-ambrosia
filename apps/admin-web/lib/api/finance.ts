import { financeErrorV1Schema } from '@ambrosia/contracts';
import { authenticatedFetch } from './authenticated-fetch';
import { getCsrfToken } from '../auth/client';
export class FinanceRequestError extends Error {
  constructor(
    message: string,
    public readonly code = '',
    public readonly fields: string[] = [],
  ) {
    super(message);
  }
}
export async function financeRequest<T>(
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
    response = await authenticatedFetch('/api/finance/' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new FinanceRequestError(
      'No se pudo conectar. Tus datos siguen en el formulario; consulta el estado antes de repetir.',
    );
  }
  if (!response.ok) {
    const parsed = financeErrorV1Schema.safeParse(
      await response.json().catch(() => null),
    );
    if (parsed.success)
      throw new FinanceRequestError(
        parsed.data.message,
        parsed.data.code,
        parsed.data.fields,
      );
    throw new FinanceRequestError(
      response.status === 403
        ? 'No tienes permiso o la verificación CSRF expiró.'
        : response.status === 401
          ? 'Tu sesión expiró.'
          : 'No se pudo completar la operación. Consulta su estado antes de repetir.',
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new FinanceRequestError(
      'Respuesta inválida. Consulta el estado antes de repetir la operación.',
    );
  }
}
