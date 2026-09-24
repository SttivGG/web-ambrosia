// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useList } from '../components/purchases/common';
import { purchaseRequest } from '../lib/api/purchases';
vi.mock('../lib/api/purchases', () => ({ purchaseRequest: vi.fn() }));
const schema = {
  parse(value: unknown) {
    return value as { value: string };
  },
};
function Probe({
  path = 'purchases',
  revision = 0,
}: {
  path?: string;
  revision?: number;
}) {
  const result = useList(path, schema, revision);
  return <p>{result.loading ? 'Cargando' : result.data?.value}</p>;
}
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it('oculta registros obsoletos inmediatamente al invalidar después de guardar', async () => {
  vi.mocked(purchaseRequest)
    .mockResolvedValueOnce({ value: 'Versión antigua' })
    .mockResolvedValueOnce({ value: 'Versión vigente' });
  await act(async () => root.render(<Probe />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toBe('Versión antigua');
  await act(async () => root.render(<Probe revision={1} />));
  expect(host.textContent).toBe('Cargando');
  await act(async () => vi.advanceTimersByTimeAsync(250));
  expect(host.textContent).toBe('Versión vigente');
});
it('una respuesta tardía de filtros anteriores no reemplaza la consulta actual', async () => {
  let oldResolve: (value: { value: string }) => void = () => {};
  vi.mocked(purchaseRequest)
    .mockReturnValueOnce(
      new Promise((resolve) => {
        oldResolve = resolve;
      }),
    )
    .mockResolvedValueOnce({ value: 'Filtro vigente' });
  await act(async () => root.render(<Probe path="purchases?status=DRAFT" />));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  await act(async () =>
    root.render(<Probe path="purchases?status=RECEIVED" />),
  );
  await act(async () => vi.advanceTimersByTimeAsync(250));
  await act(async () => oldResolve({ value: 'Filtro antiguo' }));
  expect(host.textContent).toBe('Filtro vigente');
});
