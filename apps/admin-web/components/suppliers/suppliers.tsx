'use client';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  IDENTIFICATION_TYPES_V1,
  createSupplierV1Schema,
  updateSupplierV1Schema,
  supplierIdentificationPair,
  supplierV1Schema,
  supplierListV1Schema,
  itemListV1Schema,
  type SupplierV1,
  type SupplierItemV1,
} from '@ambrosia/contracts';
import { confirmDiscard } from '../../lib/ui/notifications';
import { useSession } from '../auth/session-provider';
import { supplierRequest, SupplierRequestError } from '../../lib/api/suppliers';
import { catalogRequest } from '../../lib/api/catalog';

const labels = {
  code: 'Código interno',
  name: 'Razón social o nombre completo',
  tradeName: 'Nombre comercial',
  identificationType: 'Tipo de identificación',
  identificationNumber: 'Número de identificación',
  contactName: 'Persona de contacto',
  email: 'Correo',
  phone: 'Teléfono',
  address: 'Dirección',
  municipality: 'Municipio',
  department: 'Departamento',
  notes: 'Notas',
};
const identificationLabels: Record<string, string> = {
  NIT: 'NIT',
  CC: 'Cédula de ciudadanía',
  CE: 'Cédula de extranjería',
  PASSPORT: 'Pasaporte',
  OTHER: 'Otro',
};
const displayField = (key: string, value: string | null) =>
  key === 'identificationType' && value
    ? (identificationLabels[value] ?? value)
    : value || '—';
type Field = keyof typeof labels;
type Values = Record<Field, string>;
const limits: Record<Field, number> = {
  code: 40,
  name: 160,
  tradeName: 160,
  identificationType: 20,
  identificationNumber: 40,
  contactName: 120,
  email: 254,
  phone: 40,
  address: 240,
  municipality: 100,
  department: 100,
  notes: 2000,
};
const fields = Object.keys(labels) as Field[];
const valuesOf = (row?: SupplierV1): Values =>
  Object.fromEntries(fields.map((key) => [key, row?.[key] ?? ''])) as Values;
const date = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'America/Bogota',
      }).format(new Date(value))
    : '—';
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'No se pudo completar la operación.';
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      setTimeout(() => {
        if (previous?.isConnected) previous.focus();
        else document.querySelector<HTMLElement>('.supplier-new')?.focus();
      }, 0);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="catalog-dialog supplier-dialog"
      aria-labelledby="supplier-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="supplier-title">{title}</h2>
      {children}
    </dialog>
  );
}
export function ItemSelector({
  selected,
  change,
  disabled = false,
  single = false,
}: {
  selected: SupplierItemV1[];
  change(items: SupplierItemV1[]): void;
  disabled?: boolean;
  single?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{
    data: SupplierItemV1[];
    pagination: { totalPages: number };
  } | null>(null);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const data = await catalogRequest(
          'items?' +
            new URLSearchParams({
              search,
              page: String(page),
              pageSize: '10',
              ...(single ? {} : { active: 'true' }),
            }),
          itemListV1Schema,
        );
        if (!cancelled) setResult(data);
      } catch (error) {
        if (!cancelled) setError(message(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, page, retry, single]);
  return (
    <fieldset disabled={disabled} className="supplier-selector">
      <legend>
        {single
          ? 'Filtrar por artículo relacionado'
          : 'Artículos suministrados'}
      </legend>
      <label>
        Buscar artículo por nombre, SKU o código de barras
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          maxLength={120}
        />
      </label>
      <p>Seleccionados: {selected.length}</p>
      <ul>
        {selected.map((item) => (
          <li key={item.id}>
            {item.sku} — {item.name}
            {!item.active && ' (Archivado)'}{' '}
            <button
              type="button"
              aria-label={'Quitar ' + item.sku}
              onClick={() =>
                change(selected.filter((row) => row.id !== item.id))
              }
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
      {loading ? (
        <p role="status">Cargando artículos…</p>
      ) : error ? (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry(retry + 1)}>
            Reintentar artículos
          </button>
        </p>
      ) : (
        <>
          {!result?.data.length && <p>No hay artículos para esta búsqueda.</p>}
          <ul>
            {result?.data.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.some((row) => row.id === item.id)}
                    onChange={(e) =>
                      change(
                        e.target.checked
                          ? single
                            ? [item]
                            : [...selected, item]
                          : selected.filter((row) => row.id !== item.id),
                      )
                    }
                  />{' '}
                  {item.sku} — {item.name}
                  {!item.active && ' (Archivado)'}
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="supplier-actions">
        <button
          type="button"
          disabled={page <= 1 || loading}
          onClick={() => setPage(page - 1)}
        >
          Artículos anteriores
        </button>
        <span>
          Página de artículos {page} de{' '}
          {Math.max(1, result?.pagination.totalPages ?? 1)}
        </span>
        <button
          type="button"
          disabled={loading || page >= (result?.pagination.totalPages ?? 1)}
          onClick={() => setPage(page + 1)}
        >
          Artículos siguientes
        </button>
      </div>
    </fieldset>
  );
}
function Detail({ row }: { row: SupplierV1 }) {
  return (
    <>
      <dl className="supplier-detail">
        {fields.map((key) => (
          <div key={key}>
            <dt>{labels[key]}</dt>
            <dd>{displayField(key, row[key])}</dd>
          </div>
        ))}
        <div>
          <dt>Estado</dt>
          <dd>{row.active ? 'Activo' : 'Archivado'}</dd>
        </div>
        <div>
          <dt>Versión</dt>
          <dd>{row.version}</dd>
        </div>
        <div>
          <dt>Creación (Bogotá)</dt>
          <dd>{date(row.createdAt)}</dd>
        </div>
        <div>
          <dt>Actualización (Bogotá)</dt>
          <dd>{date(row.updatedAt)}</dd>
        </div>
        <div>
          <dt>Archivado (Bogotá)</dt>
          <dd>{date(row.archivedAt)}</dd>
        </div>
      </dl>
      <h3>Artículos suministrados</h3>
      <ul>
        {row.items.map((item) => (
          <li key={item.id}>
            {item.sku} — {item.name} · {item.active ? 'Activo' : 'Archivado'}
          </li>
        ))}
      </ul>
      {!row.items.length && <p>Sin artículos asociados.</p>}
    </>
  );
}
type Mode = 'detail' | 'edit' | 'archive' | 'restore';
export function SupplierDialog({
  row,
  mode,
  close,
  saved,
}: {
  row?: SupplierV1;
  mode: Mode;
  close(): void;
  saved(): void;
}) {
  const [values, setValues] = useState(() => valuesOf(row)),
    [selected, setSelected] = useState<SupplierItemV1[]>(row?.items ?? []);
  const [version, setVersion] = useState(row?.version ?? 1),
    [error, setError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false),
    [current, setCurrent] = useState<SupplierV1 | null>(null);
  const saving = useRef(false),
    form = useRef<HTMLFormElement>(null);
  const dirty =
    JSON.stringify(values) !== JSON.stringify(valuesOf(row)) ||
    JSON.stringify(selected.map((item) => item.id).sort()) !==
      JSON.stringify((row?.items ?? []).map((item) => item.id).sort());
  const dismiss = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      if (!dirty || (await confirmDiscard(form.current?.closest('dialog'))))
        close();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty || saving.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function fetchCurrent() {
    if (!row || saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      setCurrent(await supplierRequest('/' + row.id, supplierV1Schema));
    } catch (error) {
      setError(message(error));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current || conflict) return;
    setError('');
    setErrors({});
    let body: unknown;
    if (mode === 'edit') {
      const { code, ...rest } = values;
      const raw = {
        ...rest,
        identificationType: values.identificationType || null,
        identificationNumber: values.identificationNumber || null,
        itemIds: selected.map((item) => item.id),
        ...(row ? { expectedVersion: version } : { code }),
      };
      const result = (
        row ? updateSupplierV1Schema : createSupplierV1Schema
      ).safeParse(raw);
      if (!result.success || !supplierIdentificationPair(raw)) {
        const next = !result.success
          ? Object.fromEntries(
              result.error.issues.map((issue) => [
                issue.path[0] ?? '',
                'Revisa este campo: formato o longitud inválidos.',
              ]),
            )
          : {
              identificationNumber:
                'Indica tipo y número juntos, o deja ambos vacíos.',
            };
        setErrors(next);
        setError('Revisa los campos indicados.');
        setTimeout(
          () =>
            form.current
              ?.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus(),
          0,
        );
        return;
      }
      body = result.data;
    } else body = { expectedVersion: version };
    saving.current = true;
    setBusy(true);
    try {
      await supplierRequest(
        row ? '/' + row.id + (mode === 'edit' ? '' : '/' + mode) : '',
        supplierV1Schema,
        row && mode === 'edit' ? 'PATCH' : 'POST',
        body,
      );
      saved();
    } catch (error) {
      setError(message(error));
      if (error instanceof SupplierRequestError) {
        setErrors(
          Object.fromEntries(
            error.fields.map((field) => [field, error.message]),
          ),
        );
        if (error.code === 'CONCURRENT_MODIFICATION') {
          setConflict(true);
          setCurrent(null);
        }
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const title =
    mode === 'detail'
      ? 'Detalle del proveedor'
      : mode === 'edit'
        ? row
          ? 'Editar proveedor'
          : 'Nuevo proveedor'
        : mode === 'archive'
          ? 'Archivar proveedor'
          : 'Restaurar proveedor';
  return (
    <Dialog title={title} close={dismiss}>
      {mode === 'detail' && row ? (
        <>
          <Detail row={row} />
          <button onClick={dismiss}>Cerrar</button>
        </>
      ) : (
        <form ref={form} onSubmit={submit} noValidate>
          {mode === 'edit' ? (
            <fieldset disabled={busy} className="supplier-fields">
              <legend>Identificación y contacto</legend>
              {fields.map((key) => (
                <div key={key} className="supplier-field">
                  <label htmlFor={'supplier-' + key}>
                    {labels[key]}
                    {(key === 'code' || key === 'name') && ' *'}
                  </label>
                  {key === 'identificationType' ? (
                    <select
                      id={'supplier-' + key}
                      value={values[key]}
                      aria-invalid={!!errors[key]}
                      aria-describedby={
                        errors[key] ? key + '-error' : undefined
                      }
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                    >
                      <option value="">Sin identificación</option>
                      {IDENTIFICATION_TYPES_V1.map((type) => (
                        <option key={type} value={type}>
                          {identificationLabels[type]}
                        </option>
                      ))}
                    </select>
                  ) : key === 'notes' ? (
                    <textarea
                      id={'supplier-' + key}
                      value={values[key]}
                      maxLength={limits[key]}
                      aria-invalid={!!errors[key]}
                      aria-describedby={
                        errors[key] ? key + '-error' : undefined
                      }
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                    />
                  ) : (
                    <input
                      id={'supplier-' + key}
                      value={values[key]}
                      maxLength={limits[key]}
                      readOnly={key === 'code' && !!row}
                      required={key === 'code' || key === 'name'}
                      type={key === 'email' ? 'email' : 'text'}
                      aria-invalid={!!errors[key]}
                      aria-describedby={
                        errors[key] ? key + '-error' : undefined
                      }
                      onChange={(e) =>
                        setValues({ ...values, [key]: e.target.value })
                      }
                    />
                  )}
                  {errors[key] && (
                    <span id={key + '-error'} className="field-error">
                      {errors[key]}
                    </span>
                  )}
                </div>
              ))}
            </fieldset>
          ) : (
            <p>
              ¿Confirmas {mode === 'archive' ? 'archivar' : 'restaurar'} a{' '}
              {row?.name}? Sus artículos conservarán su estado.
            </p>
          )}
          {mode === 'edit' && (
            <>
              <p>
                La identificación es opcional. El formato no constituye
                verificación oficial de identidad o NIT.
              </p>
              <ItemSelector
                selected={selected}
                change={setSelected}
                disabled={busy}
              />
              {errors.itemIds && <p role="alert">{errors.itemIds}</p>}
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {conflict && (
            <section aria-label="Conflicto de versiones">
              <h3>Revisa los cambios antes de continuar</h3>
              <p>Tus valores y selecciones se conservan.</p>
              <button type="button" disabled={busy} onClick={fetchCurrent}>
                Obtener versión actual
              </button>
              {current && (
                <>
                  <div className="supplier-comparison">
                    {fields.map((key) => (
                      <div key={key}>
                        <strong>{labels[key]}</strong>
                        <p>Tu formulario: {displayField(key, values[key])}</p>
                        <p>Actual: {displayField(key, current[key])}</p>
                      </div>
                    ))}
                    <div>
                      <strong>Artículos suministrados</strong>
                      <p>
                        Tu selección:{' '}
                        {selected
                          .map((item) => item.sku + ' — ' + item.name)
                          .join(', ') || 'Ninguno'}
                      </p>
                      <p>
                        Actual:{' '}
                        {current.items
                          .map(
                            (item) =>
                              item.sku +
                              ' — ' +
                              item.name +
                              (item.active ? '' : ' (Archivado)'),
                          )
                          .join(', ') || 'Ninguno'}
                      </p>
                    </div>
                    <div>
                      <strong>Estado y versión actuales</strong>
                      <p>
                        {current.active ? 'Activo' : 'Archivado'} ·{' '}
                        {current.version} · {date(current.updatedAt)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setVersion(current.version);
                      setConflict(false);
                      setCurrent(null);
                      setError(
                        'Comparación aceptada. Revisa y pulsa Guardar para enviar tus valores.',
                      );
                    }}
                  >
                    Conservar mis valores y usar esta versión
                  </button>
                  {mode === 'edit' && (
                    <button
                      type="button"
                      onClick={() => {
                        setValues(valuesOf(current));
                        setSelected(current.items);
                        setVersion(current.version);
                        setConflict(false);
                        setCurrent(null);
                        setError('Versión actual cargada.');
                      }}
                    >
                      Usar los valores actuales
                    </button>
                  )}
                </>
              )}
            </section>
          )}
          <div className="supplier-actions">
            <button type="submit" disabled={busy || conflict}>
              {busy ? 'Guardando…' : mode === 'edit' ? 'Guardar' : 'Confirmar'}
            </button>
            <button type="button" disabled={busy} onClick={dismiss}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
export function Suppliers() {
  const { permissions } = useSession();
  const write = permissions.includes('inventory.write');
  const [query, setQuery] = useState({
    search: '',
    active: 'true',
    sortBy: 'name',
    sortOrder: 'asc',
    page: 1,
  });
  const [filterItems, setFilterItems] = useState<SupplierItemV1[]>([]),
    [filterOpen, setFilterOpen] = useState(false);
  const [result, setResult] = useState<{
    data: SupplierV1[];
    pagination: { totalPages: number; totalItems: number };
  } | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<{ row?: SupplierV1; mode: Mode } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        ...query,
        page: String(query.page),
        pageSize: '20',
      });
      if (!query.active) params.delete('active');
      if (filterItems[0]) params.set('itemId', filterItems[0].id);
      try {
        const data = await supplierRequest('?' + params, supplierListV1Schema);
        if (!cancelled) setResult(data);
      } catch (error) {
        if (!cancelled) setError(message(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, filterItems, revision]);
  async function open(id: string, mode: Mode) {
    try {
      const row = await supplierRequest('/' + id, supplierV1Schema);
      setModal({ row, mode });
    } catch (error) {
      setError(message(error));
    }
  }
  return (
    <section className="suppliers">
      <header className="catalog-toolbar">
        <div>
          <p className="eyebrow">INVENTARIO</p>
          <h1>Proveedores</h1>
          <p className="muted">Directorio interno y artículos suministrados.</p>
        </div>
        {write && (
          <button
            className="supplier-new"
            onClick={() => setModal({ mode: 'edit' })}
          >
            Nuevo proveedor
          </button>
        )}
      </header>
      <div className="supplier-filters">
        <label>
          Buscar proveedores
          <input
            value={query.search}
            maxLength={120}
            aria-describedby="supplier-search-help"
            onChange={(e) =>
              setQuery({ ...query, search: e.target.value, page: 1 })
            }
          />
        </label>
        <p id="supplier-search-help">
          Busca por código, razón social, nombre comercial o identificación.
        </p>
        <label>
          Estado
          <select
            aria-label="Estado"
            value={query.active}
            onChange={(e) =>
              setQuery({ ...query, active: e.target.value, page: 1 })
            }
          >
            <option value="true">Activos</option>
            <option value="false">Archivados</option>
            <option value="">Todos</option>
          </select>
        </label>
        <label>
          Ordenar por
          <select
            aria-label="Ordenar por"
            value={query.sortBy}
            onChange={(e) =>
              setQuery({ ...query, sortBy: e.target.value, page: 1 })
            }
          >
            <option value="name">Nombre</option>
            <option value="code">Código</option>
            <option value="createdAt">Creación</option>
            <option value="updatedAt">Actualización</option>
          </select>
        </label>
        <label>
          Dirección del orden
          <select
            aria-label="Dirección del orden"
            value={query.sortOrder}
            onChange={(e) =>
              setQuery({ ...query, sortOrder: e.target.value, page: 1 })
            }
          >
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          aria-expanded={filterOpen}
        >
          Filtrar por artículo{filterItems[0] ? ': ' + filterItems[0].sku : ''}
        </button>
        {filterOpen && (
          <ItemSelector
            single
            selected={filterItems}
            change={(items) => {
              setFilterItems(items);
              setQuery({ ...query, page: 1 });
            }}
          />
        )}
      </div>
      {loading ? (
        <p role="status">Cargando proveedores…</p>
      ) : error ? (
        <p role="alert">
          {error}{' '}
          <button onClick={() => setRevision(revision + 1)}>Reintentar</button>
        </p>
      ) : (
        <>
          {!result?.data.length && (
            <p>No hay proveedores para estos filtros.</p>
          )}
          <ul className="supplier-list">
            {result?.data.map((row) => (
              <li key={row.id}>
                <div>
                  <h2>{row.name}</h2>
                  <p>
                    {row.code} · {row.active ? 'Activo' : 'Archivado'}
                  </p>
                  <p>
                    {row.tradeName ||
                      row.identificationNumber ||
                      'Sin identificación registrada'}
                  </p>
                  <p>
                    {row.items.length} artículos · Actualizado{' '}
                    {date(row.updatedAt)}
                  </p>
                </div>
                <div className="supplier-actions">
                  <button onClick={() => open(row.id, 'detail')}>
                    Ver detalle
                  </button>
                  {write && (
                    <>
                      <button onClick={() => open(row.id, 'edit')}>
                        Editar
                      </button>
                      <button
                        onClick={() =>
                          open(row.id, row.active ? 'archive' : 'restore')
                        }
                      >
                        {row.active ? 'Archivar' : 'Restaurar'}
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="supplier-actions">
        <button
          disabled={loading || query.page <= 1}
          onClick={() => setQuery({ ...query, page: query.page - 1 })}
        >
          Anterior
        </button>
        <span>
          Página {query.page} de{' '}
          {Math.max(1, result?.pagination.totalPages ?? 1)} ·{' '}
          {result?.pagination.totalItems ?? 0} proveedores
        </span>
        <button
          disabled={
            loading || query.page >= (result?.pagination.totalPages ?? 1)
          }
          onClick={() => setQuery({ ...query, page: query.page + 1 })}
        >
          Siguiente
        </button>
      </div>
      {modal && (
        <SupplierDialog
          {...modal}
          close={() => setModal(null)}
          saved={() => {
            setModal(null);
            setRevision(revision + 1);
          }}
        />
      )}
    </section>
  );
}
