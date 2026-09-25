// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { Production } from '../components/production/production';
import { productionRequest } from '../lib/api/production';
import { useSession } from '../components/auth/session-provider';
vi.mock('../lib/api/production', () => ({
  productionRequest: vi.fn(),
  ProductionRequestError: class extends Error {},
}));
vi.mock('../components/auth/session-provider', () => ({ useSession: vi.fn() }));
const paging = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(useSession).mockReturnValue({
    permissions: ['production.read'],
  } as ReturnType<typeof useSession>);
  vi.mocked(productionRequest).mockResolvedValue({
    data: [],
    pagination: paging,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it('VIEWER consulta sin controles de escritura', async () => {
  await act(async () => root.render(<Production />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toContain('No hay producciones');
  expect(host.textContent).not.toContain('Nueva producción');
});
it('muestra carga antes de resolver la lista', async () => {
  await act(async () => root.render(<Production />));
  expect(host.textContent).toContain('Cargando…');
  expect(host.textContent).not.toContain('No hay producciones');
});
it('muestra fallo de consulta y permite actualizar', async () => {
  vi.mocked(productionRequest).mockRejectedValue(
    Error('Servicio no disponible'),
  );
  await act(async () => root.render(<Production />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    'Servicio no disponible',
  );
  expect(host.textContent).toContain('Actualizar');
});
it('operación pendiente ofrece reconciliación y bloquea editar/iniciar', async () => {
  vi.mocked(useSession).mockReturnValue({
    permissions: ['production.read', 'production.write'],
  } as ReturnType<typeof useSession>);
  vi.mocked(productionRequest).mockResolvedValue({
    data: [
      {
        id: 'test',
        batch: 'LOTE',
        quantity: '2',
        status: 'DRAFT',
        scheduledAt: '2026-09-24T12:00:00.000Z',
        formula: { name: 'Receta', baseUnit: 'GRAM' },
        operations: [{ status: 'PENDING' }],
      },
    ],
    pagination: { ...paging, totalItems: 1, totalPages: 1 },
  });
  await act(async () => root.render(<Production />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toContain('Reconciliar');
  expect(host.textContent).not.toContain('Editar borrador');
  expect(
    [...host.querySelectorAll('button')].some(
      (b) => b.textContent === 'Iniciar',
    ),
  ).toBe(false);
});
