'use client';
import { useRef, useState } from 'react';
import {
  purchaseListV1Schema,
  purchaseV1Schema,
  type PurchaseV1,
  type SupplierV1,
} from '@ambrosia/contracts';
import { useSession } from '../auth/session-provider';
import { purchaseRequest } from '../../lib/api/purchases';
import { PurchaseEditor } from './purchase-editor';
import { SupplierPicker } from './supplier-picker';
import {
  useList,
  Pager,
  Modal,
  ErrorBox,
  states,
  units,
  cop,
  date,
  message,
} from './common';
function PurchaseDetail({ row, close }: { row: PurchaseV1; close(): void }) {
  return (
    <Modal title={'Compra ' + row.reference} close={close}>
      <p>
        {row.supplier.name} · {states[row.status]} · Versión {row.version}
      </p>
      <p>{date(row.purchasedAt)}</p>
      <p>{row.notes}</p>
      <ul>
        {row.lines.map((l) => (
          <li key={l.id}>
            {l.item.sku} — {l.item.name}: {l.quantity} {units[l.baseUnit]} ×{' '}
            {cop(l.unitCost)} = {cop(l.subtotal)}
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: {cop(row.total)}</strong>
      </p>
      {row.receivedAt && <p>Recibida: {date(row.receivedAt)}</p>}
      {row.cancelledAt && (
        <p>
          Cancelada: {date(row.cancelledAt)} · {row.cancellationReason}
        </p>
      )}
      <button onClick={close}>Cerrar detalle</button>
    </Modal>
  );
}
function Transition({
  row,
  action,
  close,
  done,
}: {
  row: PurchaseV1;
  action: 'receive' | 'cancel';
  close(): void;
  done(): void;
}) {
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const label =
    action === 'receive'
      ? 'Recibir compra'
      : row.status === 'RECEIVED'
        ? 'Revertir compra'
        : 'Cancelar compra';
  return (
    <Modal
      title={label + ' ' + row.reference}
      close={() => {
        if (!lock.current) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          try {
            await purchaseRequest(
              'purchases/' + row.id + '/' + action,
              purchaseV1Schema,
              'POST',
              {
                expectedVersion: row.version,
                ...(action === 'cancel' ? { reason } : {}),
              },
            );
            done();
          } catch (e) {
            setError(message(e));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <p>
          {action === 'receive'
            ? 'Se registrarán entradas de inventario y el borrador dejará de ser editable.'
            : row.status === 'RECEIVED'
              ? 'Se registrarán salidas que compensan la recepción. La operación completa se rechazará si falta stock.'
              : 'El borrador quedará cancelado, sin modificar existencias.'}
        </p>
        <ul>
          {row.lines.map((l) => (
            <li key={l.id}>
              {l.item.name}:{' '}
              {action === 'receive'
                ? '+'
                : row.status === 'RECEIVED'
                  ? '−'
                  : ''}
              {l.quantity} {units[l.baseUnit]}
            </li>
          ))}
        </ul>
        <ErrorBox text={error} />
        {action === 'cancel' && (
          <label>
            Motivo de cancelación
            <textarea
              aria-label="Motivo de cancelación"
              minLength={3}
              maxLength={500}
              required
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <div className="supplier-actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Procesando…' : 'Confirmar ' + label.toLowerCase()}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Volver sin cambios
          </button>
        </div>
        {error && (
          <p>
            Cierra esta confirmación y actualiza el listado para consultar la
            versión vigente.
          </p>
        )}
      </form>
    </Modal>
  );
}
export function Purchases() {
  const { permissions } = useSession(),
    write = permissions.includes('purchases.write');
  const [reference, setReference] = useState(''),
    [status, setStatus] = useState(''),
    [supplier, setSupplier] = useState<SupplierV1 | null>(null),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<PurchaseV1 | 'new' | null>(null),
    [detail, setDetail] = useState<PurchaseV1 | null>(null),
    [action, setAction] = useState<{
      row: PurchaseV1;
      action: 'receive' | 'cancel';
    } | null>(null),
    [error, setError] = useState('');
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(reference ? { reference } : {}),
    ...(status ? { status } : {}),
    ...(supplier ? { supplierId: supplier.id } : {}),
    ...(from ? { from: new Date(from + 'T00:00:00-05:00').toISOString() } : {}),
    ...(to ? { to: new Date(to + 'T23:59:59.999-05:00').toISOString() } : {}),
  });
  const result = useList('purchases?' + query, purchaseListV1Schema, revision);
  async function open(row: PurchaseV1, edit: boolean) {
    try {
      setError('');
      const fresh = await purchaseRequest(
        'purchases/' + row.id,
        purchaseV1Schema,
      );
      if (edit) setEditor(fresh);
      else setDetail(fresh);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <section className="suppliers purchases">
      <div className="page-intro">
        <p className="eyebrow">INVENTARIO</p>
        <h1>Compras</h1>
        <p>
          Registra compras, revisa borradores y recibe artículos en inventario.
        </p>
      </div>
      <div className="supplier-actions">
        {write && (
          <button onClick={() => setEditor('new')}>Nueva compra</button>
        )}
        <button onClick={() => setRevision(revision + 1)}>
          Actualizar compras
        </button>
      </div>
      <div className="supplier-fields">
        <label>
          Buscar referencia
          <input
            maxLength={80}
            value={reference}
            onChange={(e) => {
              setReference(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(states).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      <details>
        <summary>Filtrar por proveedor</summary>
        <SupplierPicker
          active={false}
          selected={supplier}
          change={(v) => {
            setSupplier(v);
            setPage(1);
          }}
        />
      </details>
      <ErrorBox text={error || result.error} />
      {result.loading ? (
        <p role="status">Cargando compras…</p>
      ) : (
        !result.error && (
          <>
            <ul className="supplier-list">
              {result.data?.data.map((row) => (
                <li key={row.id}>
                  <div>
                    <h2>{row.reference}</h2>
                    <p>
                      {row.supplier.name} · {date(row.purchasedAt)}
                    </p>
                    <p>
                      <span className={'purchase-state state-' + row.status}>
                        {states[row.status]}
                      </span>{' '}
                      · {cop(row.total)}
                    </p>
                  </div>
                  <div className="supplier-actions">
                    <button onClick={() => void open(row, false)}>
                      Ver detalle
                    </button>
                    {write && row.status === 'DRAFT' && (
                      <>
                        <button onClick={() => void open(row, true)}>
                          Editar borrador
                        </button>
                        <button
                          onClick={() => setAction({ row, action: 'receive' })}
                        >
                          Recibir compra
                        </button>
                      </>
                    )}
                    {write && row.status !== 'CANCELLED' && (
                      <button
                        onClick={() => setAction({ row, action: 'cancel' })}
                      >
                        {row.status === 'RECEIVED'
                          ? 'Revertir compra'
                          : 'Cancelar compra'}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!result.data?.data.length && (
              <p>No hay compras para estos filtros.</p>
            )}
            <Pager
              page={page}
              pages={result.data?.pagination.totalPages ?? 0}
              change={setPage}
            />
          </>
        )
      )}
      {editor && (
        <PurchaseEditor
          row={editor === 'new' ? undefined : editor}
          close={() => setEditor(null)}
          saved={() => {
            setEditor(null);
            setRevision(revision + 1);
          }}
        />
      )}
      {detail && <PurchaseDetail row={detail} close={() => setDetail(null)} />}
      {action && (
        <Transition
          {...action}
          close={() => setAction(null)}
          done={() => {
            setAction(null);
            setRevision(revision + 1);
          }}
        />
      )}
    </section>
  );
}
