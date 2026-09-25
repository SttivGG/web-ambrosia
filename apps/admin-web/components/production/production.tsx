'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  formulaInputV1Schema,
  formulaV1Schema,
  formulaListV1Schema,
  productionInputV1Schema,
  productionV1Schema,
  productionListV1Schema,
  itemListV1Schema,
  catalogItemV1Schema,
  type FormulaV1,
  type ProductionV1,
  type FormulaInputV1,
} from '@ambrosia/contracts';
import { useSession } from '../auth/session-provider';
import {
  productionRequest,
  ProductionRequestError,
} from '../../lib/api/production';
import { confirmDiscard } from '../../lib/ui/notifications';
import {
  Modal,
  ErrorBox,
  Pager,
  useList,
  units,
  day,
  date,
  message,
} from '../purchases/common';
const states = {
  DRAFT: 'Borrador',
  IN_PROGRESS: 'En proceso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};
const operationStates = {
  PENDING: 'Pendiente de confirmación',
  CONFIRMED: 'Confirmada',
  REJECTED: 'Rechazada',
};
function useProductionList<T>(
  path: string,
  schema: { parse(v: unknown): T },
  revision = 0,
) {
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: string;
  }>({ key: '' });
  const key = path + ':' + revision;
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      productionRequest(path, schema)
        .then((data) => {
          if (alive) setResult({ key, data });
        })
        .catch((e) => {
          if (alive) setResult({ key, error: message(e) });
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [path, schema, key]);
  return {
    data: result.key === key ? result.data : undefined,
    error: result.key === key ? result.error : undefined,
    loading: result.key !== key,
  };
}
function ItemName({ id }: { id: string }) {
  const item = useList('catalog/items/' + id, catalogItemV1Schema);
  return (
    <span title={id}>
      {item.data?.name ?? (item.loading ? 'Cargando artículo…' : id)}
    </span>
  );
}
function ItemPicker({
  product,
  choose,
}: {
  product?: boolean;
  choose(item: {
    id: string;
    name: string;
    inventoryBaseUnit: keyof typeof units;
  }): void;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1);
  const list = useList(
    'catalog/items?active=true&page=' +
      page +
      '&search=' +
      encodeURIComponent(search) +
      (product ? '&itemType=FINISHED_PRODUCT' : ''),
    itemListV1Schema,
  );
  return (
    <fieldset>
      <legend>{product ? 'Seleccionar producto' : 'Agregar insumo'}</legend>
      <label>
        Buscar artículo
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <ErrorBox text={list.error} />
      {list.loading ? (
        <p role="status">Buscando artículos…</p>
      ) : (
        <>
          <ul>
            {list.data?.data
              .filter((i) => product || i.trackInventory)
              .map((i) => (
                <li key={i.id}>
                  <button type="button" onClick={() => choose(i)}>
                    {i.name} · {units[i.inventoryBaseUnit]}
                  </button>
                </li>
              ))}
          </ul>
          {!list.data?.data.length && <p>No hay artículos disponibles.</p>}
          <Pager
            page={page}
            pages={list.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
    </fieldset>
  );
}
function FormulaEditor({
  row,
  close,
  saved,
}: {
  row?: FormulaV1;
  close(): void;
  saved(): void;
}) {
  const [name, setName] = useState(row?.name ?? ''),
    [product, setProduct] = useState(row?.productId ?? ''),
    [baseUnit, setUnit] = useState<keyof typeof units>(row?.baseUnit ?? 'GRAM'),
    [active, setActive] = useState(row?.active ?? true),
    [lines, setLines] = useState<FormulaInputV1['ingredients']>(
      row?.ingredients ?? [],
    ),
    [version, setVersion] = useState(row?.version ?? 1),
    [current, setCurrent] = useState<FormulaV1 | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null),
    lock = useRef(false);
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const input = formulaInputV1Schema.safeParse({
        name,
        productId: product,
        baseUnit,
        ingredients: lines,
        active,
      });
      if (!input.success)
        throw Error(
          'Revisa nombre, producto e insumos. Las cantidades deben ser positivas y usar punto decimal.',
        );
      await productionRequest(
        'formulas' + (row ? '/' + row.id : ''),
        formulaV1Schema,
        row ? 'PATCH' : 'POST',
        { ...input.data, ...(row ? { expectedVersion: version } : {}) },
      );
      saved();
    } catch (e) {
      setError(message(e));
      if (
        e instanceof ProductionRequestError &&
        e.code === 'CONCURRENT_MODIFICATION' &&
        row
      ) {
        try {
          setCurrent(
            await productionRequest('formulas/' + row.id, formulaV1Schema),
          );
        } catch {}
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={row ? 'Editar fórmula' : 'Nueva fórmula'}
      close={() => void dismiss()}
    >
      <form ref={form} onSubmit={submit} onChange={() => setDirty(true)}>
        <ErrorBox text={error} />
        <fieldset disabled={busy}>
          <label>
            Nombre
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p>
            Producto: {product ? <ItemName id={product} /> : 'Sin seleccionar'}{' '}
            · {units[baseUnit]}
          </p>
          <ItemPicker
            product
            choose={(i) => {
              setProduct(i.id);
              setUnit(i.inventoryBaseUnit);
              setDirty(true);
            }}
          />
          <p>
            Define los insumos necesarios para producir una unidad base del
            producto ({units[baseUnit]}).
          </p>
          <ItemPicker
            choose={(i) => {
              if (!lines.some((l) => l.itemId === i.id)) {
                setLines([
                  ...lines,
                  {
                    itemId: i.id,
                    quantity: '1',
                    baseUnit: i.inventoryBaseUnit,
                  },
                ]);
                setDirty(true);
              }
            }}
          />
          {lines.map((l, index) => (
            <div className="production-line" key={l.itemId}>
              <label>
                Cantidad del insumo {index + 1}
                <input
                  required
                  inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines(
                      lines.map((v, n) =>
                        n === index ? { ...v, quantity: e.target.value } : v,
                      ),
                    )
                  }
                />
              </label>
              <span>
                <ItemName id={l.itemId} /> · {units[l.baseUnit]}
              </span>
              <button
                type="button"
                onClick={() => {
                  setLines(lines.filter((_, n) => n !== index));
                  setDirty(true);
                }}
              >
                Quitar insumo {index + 1}
              </button>
            </div>
          ))}
          <label>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{' '}
            Fórmula activa
          </label>
          {current && (
            <section role="status">
              <p>
                Versión actual: {current.version}. Nombre: {current.name}.
                Producto: {current.productId}. Tus campos se conservan.
              </p>
              <details>
                <summary>Comparar fórmula vigente</summary>
                <pre>{JSON.stringify(current.ingredients, null, 2)}</pre>
              </details>
              <button
                type="button"
                onClick={() => {
                  setVersion(current.version);
                  setCurrent(null);
                }}
              >
                Adoptar versión actual
              </button>
            </section>
          )}
          <div className="form-actions">
            <button type="button" onClick={() => void dismiss()}>
              Volver
            </button>
            <button type="submit">
              {busy ? 'Guardando…' : 'Guardar fórmula'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function OrderEditor({
  row,
  close,
  saved,
}: {
  row?: ProductionV1;
  close(): void;
  saved(): void;
}) {
  const [batch, setBatch] = useState(row?.batch ?? ''),
    [formulaId, setFormula] = useState(row?.formulaId ?? ''),
    [quantity, setQuantity] = useState(row?.quantity ?? '1'),
    [scheduledDay, setDay] = useState(
      day(row?.scheduledAt ?? new Date().toISOString()),
    ),
    [notes, setNotes] = useState(row?.notes ?? ''),
    [version, setVersion] = useState(row?.version ?? 1),
    [current, setCurrent] = useState<ProductionV1 | null>(null),
    [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const formulas = useProductionList(
      'formulas?active=true&page=' +
        page +
        '&search=' +
        encodeURIComponent(search),
      formulaListV1Schema,
    ),
    form = useRef<HTMLFormElement>(null),
    lock = useRef(false);
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const input = productionInputV1Schema.safeParse({
        batch,
        formulaId,
        quantity,
        scheduledAt: new Date(scheduledDay + 'T00:00:00-05:00').toISOString(),
        notes,
      });
      if (!input.success)
        throw Error(
          'Revisa lote, fórmula, fecha y cantidad positiva con punto decimal.',
        );
      await productionRequest(
        'orders' + (row ? '/' + row.id : ''),
        productionV1Schema,
        row ? 'PATCH' : 'POST',
        { ...input.data, ...(row ? { expectedVersion: version } : {}) },
      );
      saved();
    } catch (e) {
      setError(message(e));
      if (
        e instanceof ProductionRequestError &&
        e.code === 'CONCURRENT_MODIFICATION' &&
        row
      ) {
        try {
          setCurrent(
            await productionRequest('orders/' + row.id, productionV1Schema),
          );
        } catch {}
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={row ? 'Editar borrador' : 'Nueva producción'}
      close={() => void dismiss()}
    >
      <form ref={form} onSubmit={submit} onChange={() => setDirty(true)}>
        <ErrorBox text={error} />
        <fieldset disabled={busy}>
          <label>
            Lote
            <input
              required
              maxLength={80}
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
            />
          </label>
          <label>
            Buscar fórmula
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <ErrorBox text={formulas.error ?? ''} />
          <p>
            Fórmula seleccionada:{' '}
            {formulas.data?.data.find((f) => f.id === formulaId)?.name ??
              (row && row.formulaId === formulaId
                ? row.formula.name
                : undefined) ??
              formulaId ??
              'Ninguna'}
          </p>
          {formulas.loading ? (
            <p role="status">Cargando fórmulas…</p>
          ) : (
            <>
              <ul>
                {formulas.data?.data.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      aria-pressed={formulaId === f.id}
                      onClick={() => {
                        setFormula(f.id);
                        setDirty(true);
                      }}
                    >
                      {f.name} · versión {f.version} · {units[f.baseUnit]}
                    </button>
                  </li>
                ))}
              </ul>
              {!formulas.data?.data.length && <p>No hay fórmulas activas.</p>}
              <Pager
                page={page}
                pages={formulas.data?.pagination.totalPages ?? 0}
                change={setPage}
              />
            </>
          )}
          <label>
            Cantidad planificada
            <input
              required
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          <label>
            Fecha de producción
            <input
              type="date"
              required
              value={scheduledDay}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <label>
            Observaciones
            <textarea
              aria-label="Observaciones"
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {current && (
            <section role="status">
              <p>
                Versión actual: {current.version} · {states[current.status]}.
                Lote: {current.batch}. Cantidad: {current.quantity}.
                Observaciones actuales: {current.notes || 'Sin observaciones'}.
                Tus campos se conservan.
              </p>
              <button
                type="button"
                onClick={() => {
                  setVersion(current.version);
                  setCurrent(null);
                }}
              >
                Adoptar versión actual
              </button>
            </section>
          )}
          <div className="form-actions">
            <button type="button" onClick={() => void dismiss()}>
              Volver
            </button>
            <button type="submit">
              {busy ? 'Guardando…' : 'Guardar borrador'}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
function Detail({ row, close }: { row: ProductionV1; close(): void }) {
  return (
    <Modal title={'Producción ' + row.batch} close={close}>
      <p>
        {states[row.status]} · versión {row.version} · {date(row.scheduledAt)}
      </p>
      <p>
        Fórmula: {row.formula.name}, versión {row.formula.version}. Cantidad
        planificada: {row.quantity} {units[row.formula.baseUnit]}.
      </p>
      <p>{row.notes}</p>
      <p>Responsable: {row.actorId}</p>
      {row.completedAt && (
        <p>
          Resultado lógico registrado el {date(row.completedAt)}. Cantidad
          planificada: {row.quantity} {units[row.formula.baseUnit]}.
        </p>
      )}
      <h3>Insumos previstos</h3>
      <ul>
        {row.ingredients.map((l) => (
          <li key={l.itemId}>
            <ItemName id={l.itemId} />: {l.quantity} {units[l.baseUnit]}
          </li>
        ))}
      </ul>
      <h3>Consumo y trazabilidad</h3>
      {!row.operations.length && <p>No hay operaciones de inventario.</p>}
      {row.operations.map((o) => (
        <section key={o.id}>
          <h4>
            {o.kind === 'CONSUME' ? 'Consumo' : 'Compensación'} ·{' '}
            {operationStates[o.status]}
          </h4>
          <p>
            Operación: {o.id} · {date(o.createdAt)}
          </p>
          {o.error && <p role="status">{o.error}</p>}
          {o.status === 'PENDING' && (
            <p>
              Esperando confirmación de inventario. El sistema volverá a
              consultar sin duplicar el consumo.
            </p>
          )}
          <ul>
            {o.result?.movements.map((m) => (
              <li key={m.id}>
                {m.item.name}: {m.quantity} {units[m.baseUnit]} ·{' '}
                {m.type === 'PRODUCTION_OUT' ? 'Salida' : 'Devolución'}
                <br />
                Movimiento: {m.id}
                {m.reversesId && <span> · Revierte: {m.reversesId}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {row.cancelledAt && (
        <p>
          Cancelada: {date(row.cancelledAt)}. {row.cancellationReason}
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
  row: ProductionV1;
  action: 'start' | 'complete' | 'cancel' | 'reconcile';
  close(): void;
  done(): void;
}) {
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    lock = useRef(false);
  const label = {
    start: 'Iniciar producción',
    complete: 'Completar producción',
    cancel: 'Cancelar producción',
    reconcile: 'Reconciliar inventario',
  }[action];
  return (
    <Modal
      title={label}
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
          try {
            await productionRequest(
              'orders/' + row.id + '/' + action,
              productionV1Schema,
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
        <ErrorBox text={error} />
        <p>
          {row.batch}:{' '}
          {action === 'start'
            ? 'Se descontarán todos los insumos al confirmar inventario.'
            : action === 'cancel' && row.status === 'IN_PROGRESS'
              ? 'Se devolverán los insumos mediante movimientos compensatorios.'
              : action === 'complete'
                ? 'Se registrará el cierre lógico de este lote.'
                : 'Se consultará la operación persistida.'}
        </p>
        {action === 'cancel' && (
          <label>
            Motivo de cancelación
            <textarea
              aria-label="Motivo de cancelación"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <div className="form-actions">
          <button type="button" disabled={busy} onClick={close}>
            Volver
          </button>
          <button disabled={busy}>{busy ? 'Procesando…' : label}</button>
        </div>
      </form>
    </Modal>
  );
}
export function Production({ formulas = false }: { formulas?: boolean }) {
  const { permissions } = useSession(),
    canWrite = permissions.includes('production.write');
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [status, setStatus] = useState(''),
    [revision, setRevision] = useState(0),
    [editor, setEditor] = useState<FormulaV1 | ProductionV1 | 'new' | null>(
      null,
    ),
    [detail, setDetail] = useState<ProductionV1 | null>(null),
    [transition, setTransition] = useState<{
      row: ProductionV1;
      action: 'start' | 'complete' | 'cancel' | 'reconcile';
    } | null>(null);
  const orders = useProductionList(
      'orders?page=' +
        page +
        '&search=' +
        encodeURIComponent(search) +
        (status ? '&status=' + status : ''),
      productionListV1Schema,
      revision,
    ),
    recipes = useProductionList(
      'formulas?page=' + page + '&search=' + encodeURIComponent(search),
      formulaListV1Schema,
      revision,
    );
  const list = formulas ? recipes : orders;
  const done = () => {
    setEditor(null);
    setTransition(null);
    setRevision((n) => n + 1);
  };
  return (
    <section className="suppliers purchases production">
      <header className="page-intro">
        <div>
          <p className="eyebrow">PRODUCCIÓN</p>
          <h1>{formulas ? 'Fórmulas' : 'Lotes de producción'}</h1>
          <p>
            {formulas
              ? 'Recetas versionadas e insumos por unidad de producto.'
              : 'Planificación, consumo de insumos y trazabilidad.'}
          </p>
        </div>
        {canWrite && (
          <button className="supplier-new" onClick={() => setEditor('new')}>
            {formulas ? 'Nueva fórmula' : 'Nueva producción'}
          </button>
        )}
      </header>
      <div className="catalog-toolbar">
        <label>
          {formulas ? 'Buscar fórmula' : 'Buscar lote'}
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {!formulas && (
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
              {Object.entries(states).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        <button onClick={() => setRevision((n) => n + 1)}>Actualizar</button>
      </div>
      <ErrorBox text={list.error ?? ''} />
      {list.loading ? (
        <p role="status">Cargando…</p>
      ) : (
        <>
          {!list.data?.data.length && (
            <p>
              No hay {formulas ? 'fórmulas' : 'producciones'} para esta
              búsqueda.
            </p>
          )}
          <div className="production-cards">
            {formulas
              ? recipes.data?.data.map((f) => (
                  <article key={f.id}>
                    <h2>{f.name}</h2>
                    <p>
                      Versión {f.version} · {f.active ? 'Activa' : 'Inactiva'} ·{' '}
                      {f.ingredients.length} insumos
                    </p>
                    <details>
                      <summary>Ver fórmula</summary>
                      <p>
                        Producto: <ItemName id={f.productId} />. Unidad:{' '}
                        {units[f.baseUnit]}.
                      </p>
                      <ul>
                        {f.ingredients.map((l) => (
                          <li key={l.itemId}>
                            {l.itemId}: {l.quantity} {units[l.baseUnit]}
                          </li>
                        ))}
                      </ul>
                    </details>
                    {canWrite && (
                      <button onClick={() => setEditor(f)}>
                        Editar fórmula
                      </button>
                    )}
                  </article>
                ))
              : orders.data?.data.map((r) => {
                  const pending = r.operations.some(
                    (o) => o.status === 'PENDING',
                  );
                  return (
                    <article key={r.id}>
                      <h2>{r.batch}</h2>
                      <p>
                        {r.formula.name} · {states[r.status]}
                      </p>
                      <p>
                        {r.quantity} {units[r.formula.baseUnit]} ·{' '}
                        {date(r.scheduledAt)}
                      </p>
                      {pending && (
                        <p role="status">
                          Confirmación de inventario pendiente
                        </p>
                      )}
                      {r.operations.at(-1)?.status === 'REJECTED' && (
                        <p role="status">{r.operations.at(-1)?.error}</p>
                      )}
                      <div className="form-actions">
                        <button onClick={() => setDetail(r)}>
                          Ver detalle
                        </button>
                        {canWrite &&
                          (pending ? (
                            <button
                              onClick={() =>
                                setTransition({ row: r, action: 'reconcile' })
                              }
                            >
                              Reconciliar
                            </button>
                          ) : (
                            <>
                              {r.status === 'DRAFT' && (
                                <>
                                  <button onClick={() => setEditor(r)}>
                                    Editar borrador
                                  </button>
                                  <button
                                    onClick={() =>
                                      setTransition({ row: r, action: 'start' })
                                    }
                                  >
                                    Iniciar
                                  </button>
                                </>
                              )}
                              {r.status === 'IN_PROGRESS' && (
                                <button
                                  onClick={() =>
                                    setTransition({
                                      row: r,
                                      action: 'complete',
                                    })
                                  }
                                >
                                  Completar
                                </button>
                              )}
                              {['DRAFT', 'IN_PROGRESS'].includes(r.status) && (
                                <button
                                  onClick={() =>
                                    setTransition({ row: r, action: 'cancel' })
                                  }
                                >
                                  Cancelar
                                </button>
                              )}
                            </>
                          ))}
                      </div>
                    </article>
                  );
                })}
          </div>
          <Pager
            page={page}
            pages={list.data?.pagination.totalPages ?? 0}
            change={setPage}
          />
        </>
      )}
      {editor &&
        (formulas ? (
          <FormulaEditor
            row={editor === 'new' ? undefined : (editor as FormulaV1)}
            close={() => setEditor(null)}
            saved={done}
          />
        ) : (
          <OrderEditor
            row={editor === 'new' ? undefined : (editor as ProductionV1)}
            close={() => setEditor(null)}
            saved={done}
          />
        ))}
      {detail && <Detail row={detail} close={() => setDetail(null)} />}{' '}
      {transition && (
        <Transition
          {...transition}
          close={() => setTransition(null)}
          done={done}
        />
      )}
    </section>
  );
}
