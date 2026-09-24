'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createPurchaseV1Schema,
  purchaseV1Schema,
  supplierV1Schema,
  catalogItemV1Schema,
  type PurchaseV1,
  type SupplierV1,
  type CreatePurchaseV1,
} from '@ambrosia/contracts';
import { purchaseRequest, PurchaseRequestError } from '../../lib/api/purchases';
import { confirmDiscard } from '../../lib/ui/notifications';
import { SupplierPicker } from './supplier-picker';
import {
  Modal,
  ErrorBox,
  day,
  cop,
  preview,
  message,
  units,
  states,
} from './common';
type Line = CreatePurchaseV1['lines'][number] & {
  name: string;
  baseUnit: keyof typeof units;
};
export function PurchaseEditor({
  row,
  close,
  saved,
}: {
  row?: PurchaseV1;
  close(): void;
  saved(row: PurchaseV1): void;
}) {
  const [supplier, setSupplier] = useState<SupplierV1 | null>(null),
    [reference, setReference] = useState(row?.reference ?? ''),
    [purchasedDay, setPurchasedDay] = useState(
      day(row?.purchasedAt ?? new Date().toISOString()),
    ),
    [notes, setNotes] = useState(row?.notes ?? ''),
    [lines, setLines] = useState<Line[]>(
      row?.lines.map((l) => ({ ...l, name: l.item.name })) ?? [],
    );
  const [expectedVersion, setVersion] = useState(row?.version ?? 1),
    [current, setCurrent] = useState<PurchaseV1 | null>(null),
    [error, setError] = useState(''),
    [fields, setFields] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [itemSearch, setItemSearch] = useState(''),
    [itemPage, setItemPage] = useState(1);
  const lock = useRef(false),
    form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let mounted = true;
    if (row)
      purchaseRequest('suppliers/' + row.supplierId, supplierV1Schema)
        .then((v) => {
          if (mounted) setSupplier(v);
        })
        .catch((e) => {
          if (mounted) setError(message(e));
        });
    return () => {
      mounted = false;
    };
  }, [row]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function dismiss() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (!dirty || (await confirmDiscard(form.current?.closest('dialog'))))
        close();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function add(itemId: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const item = await purchaseRequest(
        'catalog/items/' + itemId,
        catalogItemV1Schema,
      );
      if (!item.trackInventory)
        throw Error('Este artículo no controla inventario.');
      setLines((v) => [
        ...v,
        {
          itemId,
          quantity: '1',
          unitCost: '0.00',
          name: item.name,
          baseUnit: item.inventoryBaseUnit,
        },
      ]);
      setDirty(true);
    } catch (e) {
      setError(message(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    const dateValue = purchasedDay
      ? new Date(purchasedDay + 'T00:00:00-05:00')
      : null;
    const candidate = {
      supplierId: supplier?.id,
      reference,
      purchasedAt:
        dateValue && !Number.isNaN(dateValue.getTime())
          ? dateValue.toISOString()
          : '',
      notes: notes || null,
      lines: lines.map(({ itemId, quantity, unitCost }) => ({
        itemId,
        quantity,
        unitCost,
      })),
    };
    const parsed = createPurchaseV1Schema.safeParse(candidate);
    if (!parsed.success) {
      setFields(parsed.error.issues.map((i) => i.path.join('.')));
      setError(parsed.error.issues.map((i) => i.message).join(' '));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setFields([]);
    try {
      const value = await purchaseRequest(
        'purchases' + (row ? '/' + row.id : ''),
        purchaseV1Schema,
        row ? 'PATCH' : 'POST',
        { ...parsed.data, ...(row ? { expectedVersion } : {}) },
      );
      setDirty(false);
      saved(value);
    } catch (e) {
      setError(message(e));
      if (e instanceof PurchaseRequestError) {
        setFields(e.fields);
        if (e.code === 'CONCURRENT_MODIFICATION' && row) {
          try {
            setCurrent(
              await purchaseRequest('purchases/' + row.id, purchaseV1Schema),
            );
          } catch {
            setError(
              'No se pudo consultar la versión actual. Conserva tus cambios y vuelve a intentar.',
            );
          }
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const available = (supplier?.items ?? []).filter(
    (i) =>
      i.active &&
      !lines.some((l) => l.itemId === i.id) &&
      (i.name + ' ' + i.sku).toLowerCase().includes(itemSearch.toLowerCase()),
  );
  const total = preview(lines);
  const invalid = (name: string) =>
    fields.some((f) => f === name || f.startsWith(name + '.'));
  return (
    <Modal
      title={row ? 'Editar borrador' : 'Nueva compra'}
      close={() => void dismiss()}
    >
      <form ref={form} onSubmit={submit} onChange={() => setDirty(true)}>
        <ErrorBox text={error} />
        {current && (
          <section className="catalog-conflict">
            <h3>La compra cambió</h3>
            <p>
              Tus datos siguen en el formulario. Versión actual{' '}
              {current.version}: {states[current.status]}.
            </p>
            <dl>
              <dt>Referencia actual</dt>
              <dd>{current.reference}</dd>
              <dt>Proveedor actual</dt>
              <dd>{current.supplier.name}</dd>
              <dt>Fecha actual</dt>
              <dd>{day(current.purchasedAt)}</dd>
              <dt>Observaciones actuales</dt>
              <dd>{current.notes ?? 'Sin observaciones'}</dd>
              <dt>Total actual</dt>
              <dd>{cop(current.total)}</dd>
            </dl>
            <ul>
              {current.lines.map((l) => (
                <li key={l.id}>
                  {l.item.name}: {l.quantity} {units[l.baseUnit]} ×{' '}
                  {cop(l.unitCost)}
                </li>
              ))}
            </ul>
            {current.status === 'DRAFT' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setVersion(current.version);
                  setCurrent(null);
                  setError(
                    'Versión adoptada. Revisa tus datos y pulsa Guardar borrador para enviarlos.',
                  );
                }}
              >
                Conservar mis cambios y adoptar versión actual
              </button>
            )}
          </section>
        )}
        <fieldset disabled={busy} className="supplier-fields">
          <div className="catalog-wide">
            <SupplierPicker
              selected={supplier}
              change={(s) => {
                setSupplier(s);
                setDirty(true);
                setItemPage(1);
              }}
            />
            {invalid('supplierId') && (
              <p role="alert" id="purchase-supplier-error">
                Selecciona un proveedor válido.
              </p>
            )}
          </div>
          <label>
            Referencia
            <input
              required
              maxLength={80}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              aria-invalid={invalid('reference')}
              aria-describedby={
                invalid('reference') ? 'purchase-reference-error' : undefined
              }
            />
          </label>
          {invalid('reference') && (
            <p id="purchase-reference-error" role="alert">
              Indica una referencia de 1 a 80 caracteres.
            </p>
          )}
          <label>
            Fecha de compra (Bogotá)
            <input
              type="date"
              required
              value={purchasedDay}
              onChange={(e) => setPurchasedDay(e.target.value)}
              aria-invalid={invalid('purchasedAt')}
              aria-describedby={
                invalid('purchasedAt') ? 'purchase-date-error' : undefined
              }
            />
          </label>
          {invalid('purchasedAt') && (
            <p id="purchase-date-error" role="alert">
              Indica una fecha válida.
            </p>
          )}
          <label className="catalog-wide">
            Observaciones
            <textarea
              aria-label="Observaciones"
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </fieldset>
        <fieldset disabled={busy} className="supplier-selector">
          <legend>Artículos de la compra</legend>
          <p>
            Las cantidades se registran en la unidad base. Máximo 50 artículos
            distintos.
          </p>
          {invalid('lines') && (
            <p role="alert" id="purchase-lines-error">
              Revisa cantidades, costos y artículos. Cantidad mayor que cero;
              costo con máximo dos decimales.
            </p>
          )}
          {lines.map((l, index) => (
            <div className="purchase-line" key={l.itemId}>
              <strong>{l.name}</strong>
              <label>
                Cantidad — {l.name} ({units[l.baseUnit]})
                <input
                  inputMode="decimal"
                  required
                  maxLength={25}
                  value={l.quantity}
                  aria-invalid={invalid('lines.' + index + '.quantity')}
                  aria-describedby={
                    invalid('lines') ? 'purchase-lines-error' : undefined
                  }
                  onChange={(e) =>
                    setLines(
                      lines.map((r, i) =>
                        i === index ? { ...r, quantity: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <label>
                Costo unitario — {l.name} (COP)
                <input
                  inputMode="decimal"
                  required
                  maxLength={25}
                  value={l.unitCost}
                  aria-invalid={invalid('lines.' + index + '.unitCost')}
                  aria-describedby={
                    invalid('lines') ? 'purchase-lines-error' : undefined
                  }
                  onChange={(e) =>
                    setLines(
                      lines.map((r, i) =>
                        i === index ? { ...r, unitCost: e.target.value } : r,
                      ),
                    )
                  }
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setLines(lines.filter((_, i) => i !== index));
                  setDirty(true);
                }}
              >
                Quitar {l.name}
              </button>
            </div>
          ))}
          {supplier ? (
            <>
              <label>
                Buscar artículo del proveedor
                <input
                  value={itemSearch}
                  onChange={(e) => {
                    setItemSearch(e.target.value);
                    setItemPage(1);
                  }}
                />
              </label>
              <ul>
                {available
                  .slice((itemPage - 1) * 10, itemPage * 10)
                  .map((i) => (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={lines.length >= 50}
                        onClick={() => void add(i.id)}
                      >
                        Agregar {i.sku} — {i.name}
                      </button>
                    </li>
                  ))}
              </ul>
              {!available.length && (
                <p>
                  No hay más artículos asociados para agregar. Puedes asociarlos
                  desde Proveedores.
                </p>
              )}
              <div className="supplier-actions">
                <button
                  type="button"
                  disabled={itemPage <= 1}
                  onClick={() => setItemPage(itemPage - 1)}
                >
                  Artículos anteriores
                </button>
                <span>Página {itemPage}</span>
                <button
                  type="button"
                  disabled={itemPage * 10 >= available.length}
                  onClick={() => setItemPage(itemPage + 1)}
                >
                  Artículos siguientes
                </button>
              </div>
            </>
          ) : (
            <p>Selecciona primero el proveedor.</p>
          )}
        </fieldset>
        <p>
          <strong>
            Total estimado: {total === null ? 'Revisa los valores' : cop(total)}
          </strong>
        </p>
        <p>
          El servidor confirma los importes al guardar. Redondeo por línea a dos
          decimales.
        </p>
        <div className="supplier-actions">
          <button type="submit" disabled={busy || Boolean(current)}>
            {busy ? 'Guardando…' : 'Guardar borrador'}
          </button>
          <button type="button" disabled={busy} onClick={() => void dismiss()}>
            Cerrar editor
          </button>
        </div>
      </form>
    </Modal>
  );
}
