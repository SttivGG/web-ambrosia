import type { HealthV1 } from '@ambrosia/contracts';
export type Status = 'checking' | 'available' | 'unavailable';
export const services = [
  {
    id: 'inventory',
    name: 'Inventario',
    service: 'inventory-service',
    description: 'Base para insumos, proveedores y compras.',
  },
  {
    id: 'production',
    name: 'Producción',
    service: 'production-service',
    description: 'Base para procesos, lotes y envasado.',
  },
  {
    id: 'finance',
    name: 'Finanzas e informes',
    service: 'finance-reporting-service',
    description: 'Base para costos, ingresos e informes.',
  },
] as const;
export async function checkService(
  id: string,
  expectedService: string,
): Promise<Status> {
  try {
    const response = await fetch('/api/' + id + '/health/ready', {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 'unavailable';
    const data: Partial<HealthV1> = await response.json();
    return data.service === expectedService &&
      data.status === 'ok' &&
      data.dependencies?.database === true &&
      data.dependencies?.nats === true
      ? 'available'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
