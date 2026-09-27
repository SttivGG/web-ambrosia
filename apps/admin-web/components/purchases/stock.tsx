'use client';
import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  stockListV1Schema,
  movementListV1Schema,
  movementV1Schema,
  adjustmentV1Schema,
  initialValuationInputV1Schema,
  initialValuationV1Schema,
  categoryListV1Schema,
  type SupplierItemV1,
  type StockV1,
} from '@ambrosia/contracts';
import { useSession } from '../auth/session-provider';
import { ItemSelector } from '../suppliers/suppliers';
import { purchaseRequest } from '../../lib/api/purchases';
import {
  ErrorBox,
  Modal,
  Pager,
  useList,
  units,
  date,
  types,
  message,
  cop,
} from './common';
function InitialValuation({
  stock,
  close,
  done,
}: {
  stock: StockV1;
  close(): void;
  done(): void;
}) {
  const [unitCost, setUnitCost] = useState(''),
    [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const operationId = useRef(crypto.randomUUID()),
    lock = useRef(false);
  return (
    <Modal
      title="Valoración inicial de inventario"
      close={() => !lock.current && close()}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const parsed = initialValuationInputV1Schema.safeParse({
            operationId: operationId.current,
            itemId: stock.itemId,
            quantity: stock.quantity,
            unitCost,
            occurredAt: new Date().toISOString(),
            reason,
          });
          if (!parsed.success) {
            setError(
              'Indica un costo unitario Decimal no negativo y un motivo de 3 a 500 caracteres.',
            );
            return;
          }
          if (!confirm) {
            setConfirm(true);
            setError('');
            return;
          }
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          try {
            await purchaseRequest(
              'inventory/valuations/initial',
              initialValuationV1Schema,
              'POST',
              parsed.data,
            );
            done();
          } catch (cause) {
            setError(message(cause));
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <ErrorBox text={error} />
        <p>
          <strong>{stock.item.name}</strong> · {stock.quantity}{' '}
          {units[stock.baseUnit]}
        </p>
        <p>La cantidad se toma del saldo actual y no se modificará.</p>
        <fieldset disabled={busy || confirm} className="supplier-fields">
          <label>
            Costo unitario declarado (COP)
            <input
              inputMode="decimal"
              required
              value={unitCost}
              onChange={(event) => setUnitCost(event.target.value)}
              maxLength={49}
            />
          </label>
          <label>
            Motivo de la valoración
            <textarea
              minLength={3}
              maxLength={500}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </fieldset>
        {confirm && (
          <div className="catalog-conflict" role="status">
            <h3>Confirmar valoración inicial</h3>
            <p>
              {stock.quantity} {units[stock.baseUnit]} a {cop(unitCost)} por
              unidad.
            </p>
            <p>
              Este hecho quedará inmutable y cualquier corrección deberá ser
              compensatoria.
            </p>
          </div>
        )}
        <div className="supplier-actions">
          <button type="submit" disabled={busy}>
            {busy
              ? 'Registrando…'
              : confirm
                ? 'Confirmar valoración'
                : 'Revisar valoración'}
          </button>
          {confirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Volver a editar
            </button>
          )}
          <button type="button" disabled={busy} onClick={close}>
            Cerrar
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Adjustment({ close, done }: { close(): void; done(): void }) {
  const [items, setItems] = useState<SupplierItemV1[]>([]),
    [type, setType] = useState<'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'>(
      'ADJUSTMENT_IN',
    ),
    [quantity, setQuantity] = useState(''),
    [reason, setReason] = useState(''),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const operationId = useRef(crypto.randomUUID()),
    lock = useRef(false);
  return (
    <Modal
      title="Ajuste manual de inventario"
      close={() => {
        if (!lock.current) close();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const parsed = adjustmentV1Schema.safeParse({
            itemId: items[0]?.id,
            type,
            quantity,
            reason,
            operationId: operationId.current,
          });
          if (!parsed.success) {
            setError(
              'Selecciona un artículo, una cantidad mayor que cero (hasta 14 enteros y 10 decimales) y un motivo de 3 a 500 caracteres.',
            );
            return;
          }
          if (!confirm) {
            setConfirm(true);
            setError('');
            return;
          }
          lock.current = true;
          setBusy(true);
          setError('');
          try {
            await purchaseRequest(
              'inventory/adjustments',
              movementV1Schema,
              'POST',
              parsed.data,
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
        <ErrorBox text={error} />
        <fieldset disabled={busy || confirm} className="supplier-fields">
          <div className="catalog-wide">
            <ItemSelector selected={items} change={setItems} single />
          </div>
          <label>
            Tipo de ajuste
            <select
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="ADJUSTMENT_IN">Entrada — ajuste positivo</option>
              <option value="ADJUSTMENT_OUT">Salida — ajuste negativo</option>
            </select>
          </label>
          <label>
            Cantidad en unidad base
            <input
              inputMode="decimal"
              required
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              maxLength={25}
            />
          </label>
          <label className="catalog-wide">
            Motivo del ajuste
            <textarea
              aria-label="Motivo del ajuste"
              minLength={3}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </fieldset>
        {confirm && (
          <div className="catalog-conflict">
            <h3>Confirmar cambio de existencias</h3>
            <p>
              {items[0]?.name}:{' '}
              {type === 'ADJUSTMENT_IN' ? 'Entrada +' : 'Salida −'}
              {quantity} en su unidad base.
            </p>
            <p>{reason}</p>
            <p>
              El ajuste quedará en el historial con tu usuario. No puede
              eliminarse.
            </p>
          </div>
        )}
        <div className="supplier-actions">
          <button type="submit" disabled={busy}>
            {busy
              ? 'Registrando…'
              : confirm
                ? 'Confirmar ajuste'
                : 'Revisar ajuste'}
          </button>
          {confirm && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Volver a editar
            </button>
          )}
          <button type="button" disabled={busy} onClick={close}>
            Cerrar ajuste
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Stocks() {
  const { permissions } = useSession();
  const [search, setSearch] = useState(''),
    [categoryId, setCategory] = useState(''),
    [categorySearch, setCategorySearch] = useState(''),
    [categoryPage, setCategoryPage] = useState(1),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [adjust, setAdjust] = useState(false),
    [valuation, setValuation] = useState<StockV1 | null>(null);
  const result = useList(
    'inventory/stocks?' +
      new URLSearchParams({
        page: String(page),
        pageSize: '10',
        search,
        ...(categoryId ? { categoryId } : {}),
      }),
    stockListV1Schema,
    revision,
  );
  const categories = useList(
    'catalog/categories?' +
      new URLSearchParams({
        search: categorySearch,
        page: String(categoryPage),
        pageSize: '10',
      }),
    categoryListV1Schema,
    revision,
  );
  return (
    <section className="suppliers purchases">
      <div className="page-intro">
        <p className="eyebrow">INVENTARIO</p>
        <h1>Existencias</h1>
        <p>Saldos actuales en la unidad base de cada artículo.</p>
      </div>
      <div className="supplier-actions">
        {permissions.includes('inventory.write') && (
          <button onClick={() => setAdjust(true)}>Nuevo ajuste</button>
        )}
        <button onClick={() => setRevision(revision + 1)}>
          Actualizar existencias
        </button>
      </div>
      <label>
        Buscar existencias por artículo
        <input
          maxLength={120}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <details>
        <summary>Filtrar por categoría</summary>
        <label>
          Buscar categoría
          <input
            value={categorySearch}
            onChange={(e) => {
              setCategorySearch(e.target.value);
              setCategoryPage(1);
            }}
            maxLength={120}
          />
        </label>
        <button
          onClick={() => {
            setCategory('');
            setPage(1);
          }}
        >
          Todas las categorías
        </button>
        {categories.error && <p role="alert">{categories.error}</p>}
        <ul>
          {categories.data?.data.map((c) => (
            <li key={c.id}>
              <button
                aria-pressed={categoryId === c.id}
                onClick={() => {
                  setCategory(c.id);
                  setPage(1);
                }}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        <Pager
          page={categoryPage}
          pages={categories.data?.pagination.totalPages ?? 0}
          change={setCategoryPage}
          disabled={categories.loading}
        />
      </details>
      <ErrorBox text={result.error} />
      {result.loading ? (
        <p role="status">Cargando existencias…</p>
      ) : (
        !result.error && (
          <>
            <ul className="supplier-list">
              {result.data?.data.map((r) => (
                <li key={r.itemId}>
                  <div>
                    <h2>{r.item.name}</h2>
                    <p>
                      {r.item.sku} · {r.category.name}
                      {!r.active && ' · Archivado'}
                    </p>
                    <p>
                      <strong>
                        Existencia: {r.quantity} {units[r.baseUnit]}
                      </strong>
                    </p>
                    {r.valuationStatus === 'VALUED' ? (
                      <p>
                        Valor: <strong>{cop(r.inventoryValue!)}</strong> ·
                        Promedio: {cop(r.averageUnitCost!)} por{' '}
                        {units[r.baseUnit]}
                      </p>
                    ) : r.valuationStatus === 'UNVALUED' ? (
                      <p role="status">Pendiente de valoración inicial</p>
                    ) : (
                      <p>Sin existencias; no requiere valoración.</p>
                    )}
                  </div>
                  <div className="supplier-actions">
                    {permissions.includes('inventory.write') &&
                      r.valuationStatus === 'UNVALUED' && (
                        <button onClick={() => setValuation(r)}>
                          Registrar valoración
                        </button>
                      )}
                    <Link href={'/inventario/movimientos?itemId=' + r.itemId}>
                      Ver historial
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
            {!result.data?.data.length && (
              <p>No hay artículos para estos filtros.</p>
            )}
            <Pager
              page={page}
              pages={result.data?.pagination.totalPages ?? 0}
              change={setPage}
            />
          </>
        )
      )}
      {adjust && (
        <Adjustment
          close={() => setAdjust(false)}
          done={() => {
            setAdjust(false);
            setRevision(revision + 1);
          }}
        />
      )}
      {valuation && (
        <InitialValuation
          stock={valuation}
          close={() => setValuation(null)}
          done={() => {
            setValuation(null);
            setRevision(revision + 1);
          }}
        />
      )}
    </section>
  );
}
export function Movements({ initialItemId = '' }: { initialItemId?: string }) {
  const [itemId, setItemId] = useState(initialItemId),
    [items, setItems] = useState<SupplierItemV1[]>([]),
    [type, setType] = useState(''),
    [origin, setOrigin] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(itemId ? { itemId } : {}),
    ...(type ? { type } : {}),
    ...(origin ? { origin } : {}),
    ...(from ? { from: new Date(from + 'T00:00:00-05:00').toISOString() } : {}),
    ...(to ? { to: new Date(to + 'T23:59:59.999-05:00').toISOString() } : {}),
  });
  const result = useList(
    'inventory/movements?' + query,
    movementListV1Schema,
    revision,
  );
  return (
    <section className="suppliers purchases">
      <div className="page-intro">
        <p className="eyebrow">INVENTARIO</p>
        <h1>Movimientos</h1>
        <p>Historial de entradas y salidas. Fechas en hora de Bogotá.</p>
      </div>
      <div className="supplier-actions">
        <button onClick={() => setRevision(revision + 1)}>
          Actualizar movimientos
        </button>
        <Link href="/inventario/existencias">Volver a existencias</Link>
      </div>
      <details>
        <summary>
          {itemId
            ? 'Filtrado por artículo · Cambiar filtro'
            : 'Filtrar por artículo'}
        </summary>
        <ItemSelector
          single
          selected={items}
          change={(v) => {
            setItems(v);
            setItemId(v[0]?.id ?? '');
            setPage(1);
          }}
        />
        {itemId && (
          <button
            onClick={() => {
              setItemId('');
              setItems([]);
              setPage(1);
            }}
          >
            Ver todos los artículos
          </button>
        )}
      </details>
      <div className="supplier-fields">
        <label>
          Tipo de movimiento
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(types).map(([v, l]) => (
              <option value={v} key={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          Origen
          <select
            value={origin}
            onChange={(e) => {
              setOrigin(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Todos</option>
            <option value="PURCHASE">Compra</option>
            <option value="MANUAL">Ajuste manual</option>
            <option value="PRODUCTION">Producción</option>
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
      <ErrorBox text={result.error} />
      {result.loading ? (
        <p role="status">Cargando movimientos…</p>
      ) : (
        !result.error && (
          <>
            <ul className="supplier-list">
              {result.data?.data.map((r) => {
                const incoming =
                  r.type === 'PURCHASE_IN' ||
                  r.type === 'ADJUSTMENT_IN' ||
                  r.type === 'PRODUCTION_RETURN' ||
                  r.type === 'PRODUCTION_IN' ||
                  r.type === 'PACKAGED_PRODUCT_IN';
                return (
                  <li key={r.id}>
                    <div>
                      <h2>{r.item.name}</h2>
                      <p>
                        {date(r.occurredAt)} · {r.item.sku}
                      </p>
                      <p>
                        <strong>
                          {incoming ? 'Entrada +' : 'Salida −'}
                          {r.quantity} {units[r.baseUnit]}
                        </strong>{' '}
                        · {types[r.type]}
                      </p>
                      <p>
                        Origen:{' '}
                        {r.origin === 'PURCHASE'
                          ? 'Compra'
                          : r.origin === 'PRODUCTION'
                            ? 'Producción'
                            : 'Ajuste manual'}{' '}
                        · Referencia: {r.reference}
                      </p>
                      <p>Motivo: {r.reason}</p>
                      {r.totalCost !== null && (
                        <p>
                          Costo transferido: <strong>{cop(r.totalCost)}</strong>{' '}
                          · Costo unitario: {cop(r.unitCost!)}
                        </p>
                      )}
                      {r.inventoryValueAfter !== null && (
                        <p>
                          Valor posterior: {cop(r.inventoryValueAfter)}
                          {r.averageUnitCostAfter !== null
                            ? ` · Promedio posterior: ${cop(r.averageUnitCostAfter)}`
                            : ''}
                        </p>
                      )}
                      <details>
                        <summary>Trazabilidad</summary>
                        <p>Movimiento: {r.id}</p>
                        <p>Actor: {r.actorId}</p>
                        {r.purchaseId && (
                          <p>
                            Compra: {r.purchaseId} · Detalle: {r.purchaseLineId}
                          </p>
                        )}
                        {r.reversesId && <p>Revierte: {r.reversesId}</p>}
                        <p>Registrado: {date(r.createdAt)}</p>
                      </details>
                    </div>
                  </li>
                );
              })}
            </ul>
            {!result.data?.data.length && (
              <p>No hay movimientos para estos filtros.</p>
            )}
            <Pager
              page={page}
              pages={result.data?.pagination.totalPages ?? 0}
              change={setPage}
            />
          </>
        )
      )}
    </section>
  );
}
