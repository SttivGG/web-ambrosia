// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import Swal, { type SweetAlertResult } from 'sweetalert2';
import { confirmDiscard } from '../lib/ui/notifications';
vi.mock('sweetalert2', () => ({ default: { fire: vi.fn() } }));
afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});
it.each([true, false])(
  'restaura el editor y su foco tras confirmar=%s',
  async (confirmed) => {
    const dialog = document.createElement('dialog');
    const input = document.createElement('input');
    input.value = 'Cambios sin guardar';
    dialog.append(input);
    document.body.append(dialog);
    dialog.open = true;
    input.focus();
    dialog.close = vi.fn(() => {
      dialog.open = false;
    });
    dialog.showModal = vi.fn(() => {
      dialog.open = true;
    });
    let finish!: (value: SweetAlertResult<unknown>) => void;
    vi.mocked(Swal.fire).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }) as ReturnType<typeof Swal.fire>,
    );
    const result = confirmDiscard(dialog);
    expect(dialog.open).toBe(false);
    finish({
      isConfirmed: confirmed,
      isDenied: false,
      isDismissed: !confirmed,
    });
    expect(await result).toBe(confirmed);
    expect(dialog.open).toBe(true);
    expect(input.value).toBe('Cambios sin guardar');
    expect(document.activeElement).toBe(input);
  },
);
it('Escape o cierre sin confirmación nunca autoriza descartar', async () => {
  vi.mocked(Swal.fire).mockResolvedValue({
    isConfirmed: false,
    isDenied: false,
    isDismissed: true,
  });
  expect(await confirmDiscard()).toBe(false);
});
