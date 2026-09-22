import { supplierErrorV1Schema } from '@ambrosia/contracts';
import { authenticatedFetch } from './authenticated-fetch';
import { getCsrfToken } from '../auth/client';
type Schema<T> = { parse(value: unknown): T };
export class SupplierRequestError extends Error {
  constructor(
    message: string,
    public readonly code = '',
    public readonly fields: string[] = [],
  ) {
    super(message);
  }
}
export async function supplierRequest<T>(
  path: string,
  schema: Schema<T>,
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
    response = await authenticatedFetch('/api/inventory/suppliers' + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new SupplierRequestError(
      'No se pudo conectar. Tus datos siguen en el formulario.',
    );
  }
  if (!response.ok) {
    const parsed = supplierErrorV1Schema.safeParse(
      await response.json().catch(() => null),
    );
    if (parsed.success)
      throw new SupplierRequestError(
        parsed.data.message,
        parsed.data.code,
        parsed.data.fields,
      );
    throw new SupplierRequestError(
      response.status === 403
        ? 'No tienes permiso o la verificación CSRF expiró. Intenta de nuevo.'
        : response.status === 401
          ? 'Tu sesión expiró. Recarga la página para recuperarla antes de volver a enviar.'
          : 'No se pudo completar la operación. Consulta el listado antes de repetirla.',
    );
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new SupplierRequestError(
      'La respuesta no tiene el formato esperado. Consulta el listado antes de repetir la operación.',
    );
  }
}
