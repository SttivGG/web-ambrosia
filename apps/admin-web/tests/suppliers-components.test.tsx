// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SupplierDialog } from '../components/suppliers/suppliers';
import { confirmDiscard } from '../lib/ui/notifications';
vi.mock('../lib/ui/notifications', () => ({ confirmDiscard: vi.fn() }));
import { supplierRequest } from '../lib/api/suppliers';
import { catalogRequest } from '../lib/api/catalog';
import type { SupplierV1 } from '@ambrosia/contracts';
vi.mock('../lib/api/suppliers', async (original) => ({
  ...(await original<object>()),
  supplierRequest: vi.fn(),
}));
vi.mock('../lib/api/catalog', () => ({ catalogRequest: vi.fn() }));
vi.mock('../components/auth/session-provider', () => ({
  useSession: () => ({ permissions: ['inventory.read'] }),
}));
const row: SupplierV1 = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'PROV-001',
  name: 'Proveedor',
  tradeName: null,
  identificationType: null,
  identificationNumber: null,
  contactName: 'Contacto visible',
  email: null,
  phone: null,
  address: null,
  municipality: null,
  department: null,
  notes: 'Notas visibles',
  active: true,
  version: 1,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
  archivedAt: null,
  items: [],
};
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLDialogElement.prototype.showModal = vi.fn();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.mocked(catalogRequest).mockResolvedValue({
    data: [],
    pagination: { page: 1, pageSize: 10, totalItems: 0, totalPages: 0 },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
const click = async (text: string) => {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  )!;
  await act(async () => button.click());
};
async function input(id: string, value: string) {
  await act(async () => {
    const field = host.querySelector<HTMLInputElement>(id)!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}
it('detalle de consulta muestra contactos y notas sin controles de edición', async () => {
  await act(async () =>
    root.render(
      <SupplierDialog
        row={row}
        mode="detail"
        close={vi.fn()}
        saved={vi.fn()}
      />,
    ),
  );
  expect(host.textContent).toContain('Contacto visible');
  expect(host.textContent).toContain('Notas visibles');
  expect(host.querySelector('form')).toBeNull();
  expect(host.textContent).not.toContain('Guardar');
});
it('campos inválidos impiden enviar y muestran errores asociados', async () => {
  await act(async () =>
    root.render(<SupplierDialog mode="edit" close={vi.fn()} saved={vi.fn()} />),
  );
  await submit();
  expect(supplierRequest).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[aria-invalid=true]').length).toBeGreaterThan(
    0,
  );
  expect(
    host.querySelector('[aria-invalid=true]')?.getAttribute('aria-describedby'),
  ).toBeTruthy();
});
it('bloquea doble envío y cierre incluso con Escape mientras guarda', async () => {
  let complete!: (value: SupplierV1) => void;
  vi.mocked(supplierRequest).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const close = vi.fn(),
    saved = vi.fn();
  await act(async () =>
    root.render(
      <SupplierDialog row={row} mode="edit" close={close} saved={saved} />,
    ),
  );
  await submit();
  await submit();
  await act(async () => {
    host
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  expect(supplierRequest).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(
    [...host.querySelectorAll('button')].find(
      (b) => b.textContent === 'Cancelar',
    )?.disabled,
  ).toBe(true);
  await act(async () => complete(row));
  expect(saved).toHaveBeenCalledOnce();
});
it('cancelar cambios requiere confirmación y conserva formulario al rechazar', async () => {
  const close = vi.fn();
  const confirm = vi.mocked(confirmDiscard).mockResolvedValue(false);
  await act(async () =>
    root.render(
      <SupplierDialog row={row} mode="edit" close={close} saved={vi.fn()} />,
    ),
  );
  await input('#supplier-name', 'Nombre pendiente');
  await click('Cancelar');
  expect(confirm).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLInputElement>('#supplier-name')?.value).toBe(
    'Nombre pendiente',
  );
  confirm.mockResolvedValue(true);
  await click('Cancelar');
  expect(close).toHaveBeenCalledOnce();
});

it('espera una única confirmación sin enviar ni cerrar mientras está pendiente', async () => {
  let resolve!: (confirmed: boolean) => void;
  vi.mocked(confirmDiscard).mockImplementation(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  const close = vi.fn();
  await act(async () =>
    root.render(
      <SupplierDialog row={row} mode="edit" close={close} saved={vi.fn()} />,
    ),
  );
  await input('#supplier-name', 'Cambio pendiente');
  await click('Cancelar');
  await act(async () =>
    host
      .querySelector('dialog')!
      .dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  await submit();
  expect(confirmDiscard).toHaveBeenCalledOnce();
  expect(supplierRequest).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  await act(async () => resolve(false));
  expect(host.querySelector<HTMLInputElement>('#supplier-name')?.value).toBe(
    'Cambio pendiente',
  );
  expect(close).not.toHaveBeenCalled();
});
