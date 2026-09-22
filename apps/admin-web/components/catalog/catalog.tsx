'use client';
import {
  useState,
  useEffect,
  useRef,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  ITEM_TYPES_V1,
  BASE_UNITS_V1,
  OPERATION_UNITS_V1,
  CAPACITY_UNITS_V1,
  categoryListV1Schema,
  itemListV1Schema,
  categoryV1Schema,
  catalogItemV1Schema,
  createCategoryV1Schema,
  updateCategoryV1Schema,
  createItemV1Schema,
  updateItemV1Schema,
  type CategoryV1,
  type CatalogItemV1,
} from '@ambrosia/contracts';
import { confirmDiscard } from '../../lib/ui/notifications';
import { useSession } from '../auth/session-provider';
import { catalogRequest, CatalogRequestError } from '../../lib/api/catalog';
const names: Record<string, string> = {
  RAW_MATERIAL: 'Materia prima',
  PACKAGING: 'Empaque',
  FINISHED_PRODUCT: 'Producto terminado',
  BYPRODUCT: 'Subproducto',
  SUPPLY: 'Suministro',
  UNIT: 'Unidad',
  GRAM: 'Gramo',
  KILOGRAM: 'Kilogramo',
  MILLILITER: 'Mililitro',
  LITER: 'Litro',
  FLUID_OUNCE: 'Onza fluida',
};
type Row = CategoryV1 | CatalogItemV1;
type Modal = {
  mode: 'edit' | 'archive' | 'restore';
  kind: 'items' | 'categories';
  row?: Row;
};
const options = (values: readonly string[]) =>
  values.map((v) => (
    <option key={v} value={v}>
      {names[v] ?? v}
    </option>
  ));
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      setTimeout(() => {
        if (previous?.isConnected) previous.focus();
        else
          document
            .querySelector<HTMLElement>('.catalog-toolbar button')
            ?.focus();
      }, 0);
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="catalog-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      className="catalog-dialog"
    >
      <h2 id="catalog-dialog-title">{title}</h2>
      {children}
    </dialog>
  );
}
export function Catalog() {
  const { permissions } = useSession(),
    router = useRouter();
  const write = permissions.includes('inventory.write');
  const [kind, setKind] = useState<'items' | 'categories'>('items');
  const [query, setQuery] = useState({
    search: '',
    itemType: '',
    categoryId: '',
    active: 'true',
    inventoryBaseUnit: '',
    sortBy: 'name',
    sortOrder: 'asc',
    page: 1,
  });
  const [result, setResult] = useState<{
    data: Row[];
    pagination: { totalItems: number; totalPages: number };
  } | null>(null);
  const [categories, setCategories] = useState<CategoryV1[]>([]);
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const focusAfterSave = useRef(false);
  useEffect(() => {
    if (!permissions.includes('inventory.read')) router.replace('/forbidden');
  }, [permissions, router]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({
          page: String(query.page),
          pageSize: '20',
          sortBy: query.sortBy,
          sortOrder: query.sortOrder,
        });
        for (const key of [
          'search',
          'active',
          ...(kind === 'items'
            ? ['itemType', 'categoryId', 'inventoryBaseUnit']
            : []),
        ] as const) {
          const value = query[key as keyof typeof query];
          if (value !== '') params.set(key, String(value));
        }
        const data =
          kind === 'items'
            ? await catalogRequest('items?' + params, itemListV1Schema)
            : await catalogRequest(
                'categories?' + params,
                categoryListV1Schema,
              );
        const all: CategoryV1[] = [];
        for (let page = 1; ; page++) {
          const response = await catalogRequest(
            'categories?pageSize=100&page=' + page,
            categoryListV1Schema,
          );
          all.push(...response.data);
          if (page >= response.pagination.totalPages) break;
        }
        if (!cancelled) {
          setResult(data);
          setCategories(all);
        }
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : 'No se pudo cargar el catálogo.',
          );
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (focusAfterSave.current) {
            focusAfterSave.current = false;
            setTimeout(
              () =>
                document
                  .querySelector<HTMLElement>('.catalog-toolbar button')
                  ?.focus(),
              0,
            );
          }
        }
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, kind, revision]);
  const filter = (key: string, value: string) => {
    setLoading(true);
    setQuery((q) => ({ ...q, [key]: value, page: 1 }));
  };
  return (
    <section className="catalog">
      <p className="eyebrow">INVENTARIO</p>
      <h1>Catálogo</h1>
      <p className="muted">
        Organiza los artículos, unidades y presentaciones de tu catálogo.
      </p>
      <div className="catalog-toolbar">
        <div className="catalog-actions">
          <button
            aria-pressed={kind === 'items'}
            onClick={() => {
              setKind('items');
              setQuery((q) => ({ ...q, page: 1, sortBy: 'name' }));
            }}
          >
            Artículos
          </button>
          <button
            aria-pressed={kind === 'categories'}
            onClick={() => {
              setKind('categories');
              setQuery((q) => ({ ...q, page: 1, sortBy: 'name' }));
            }}
          >
            Categorías
          </button>
        </div>
        {write && (
          <button
            className="refresh"
            disabled={
              kind === 'items' &&
              (loading || !!error || !categories.some((c) => c.active))
            }
            onClick={() => setModal({ mode: 'edit', kind })}
          >
            {kind === 'items' ? 'Nuevo artículo' : 'Nueva categoría'}
          </button>
        )}
      </div>
      {write &&
        kind === 'items' &&
        !loading &&
        !error &&
        !categories.some((c) => c.active) && (
          <div className="catalog-empty" role="status">
            <p>
              No hay categorías activas. Crea una categoría para organizar tus
              artículos, por ejemplo, Leche y cultivos o Empaques. También
              puedes restaurar una categoría archivada desde Categorías.
            </p>
            <button
              onClick={() => setModal({ mode: 'edit', kind: 'categories' })}
            >
              Crear categoría
            </button>
          </div>
        )}
      <div className="catalog-filters">
        <label>
          Buscar
          <input
            type="search"
            aria-label="Buscar"
            value={query.search}
            maxLength={120}
            placeholder={
              kind === 'items'
                ? 'Nombre, SKU o código de barras'
                : 'Nombre de categoría'
            }
            onChange={(e) => filter('search', e.target.value)}
          />
        </label>
        {kind === 'items' && (
          <>
            <label>
              Tipo
              <select
                aria-label="Tipo"
                value={query.itemType}
                onChange={(e) => filter('itemType', e.target.value)}
              >
                <option value="">Todos los tipos</option>
                {options(ITEM_TYPES_V1)}
              </select>
            </label>
            <label>
              Categoría
              <select
                aria-label="Categoría"
                value={query.categoryId}
                onChange={(e) => filter('categoryId', e.target.value)}
              >
                <option value="">Todas las categorías</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? '' : ' (archivada)'}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Unidad base
              <select
                aria-label="Unidad base"
                value={query.inventoryBaseUnit}
                onChange={(e) => filter('inventoryBaseUnit', e.target.value)}
              >
                <option value="">Todas las unidades</option>
                {options(BASE_UNITS_V1)}
              </select>
            </label>
          </>
        )}
        <label>
          Estado
          <select
            aria-label="Estado"
            value={query.active}
            onChange={(e) => filter('active', e.target.value)}
          >
            <option value="">Todos los estados</option>
            <option value="true">Activos</option>
            <option value="false">Archivados</option>
          </select>
        </label>
        <label>
          Ordenar por
          <select
            aria-label="Ordenar por"
            value={query.sortBy}
            onChange={(e) => filter('sortBy', e.target.value)}
          >
            <option value="name">Nombre</option>
            {kind === 'items' && <option value="sku">SKU</option>}
            <option value="createdAt">Fecha de creación</option>
            <option value="updatedAt">Última modificación</option>
          </select>
        </label>
        <label>
          Dirección
          <select
            aria-label="Dirección"
            value={query.sortOrder}
            onChange={(e) => filter('sortOrder', e.target.value)}
          >
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
      </div>
      <div aria-live="polite" role="status">
        {loading
          ? 'Cargando catálogo…'
          : error
            ? ''
            : result
              ? result.pagination.totalItems === 1
                ? '1 registro encontrado'
                : result.pagination.totalItems + ' registros encontrados'
              : ''}
      </div>
      {error && (
        <div role="alert" className="form-error">
          {error}{' '}
          <button onClick={() => setRevision((r) => r + 1)}>Reintentar</button>
        </div>
      )}
      {!loading && !error && result && (
        <>
          {!result.data.length ? (
            <p className="catalog-empty">No hay registros con estos filtros.</p>
          ) : (
            <table className="catalog-table">
              <caption className="sr-only">
                {kind === 'items'
                  ? 'Artículos del catálogo'
                  : 'Categorías del catálogo'}
              </caption>
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Detalle</th>
                  <th>Estado</th>
                  {write && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {result.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                      {'sku' in row && <small>{row.sku}</small>}
                    </td>
                    <td>
                      {'sku' in row ? (
                        <>
                          {names[row.itemType]} · {names[row.inventoryBaseUnit]}
                          <small>
                            {
                              categories.find((c) => c.id === row.categoryId)
                                ?.name
                            }
                          </small>
                          {row.nominalCapacityValue && (
                            <small>
                              Capacidad del envase (opcional):{' '}
                              {row.nominalCapacityValue}{' '}
                              {names[row.nominalCapacityUnit!]}
                            </small>
                          )}
                        </>
                      ) : (
                        row.description || 'Sin descripción'
                      )}
                    </td>
                    <td>
                      {row.active ? 'Activo' : 'Archivado'}
                      <small>Versión {row.version}</small>
                    </td>
                    {write && (
                      <td>
                        <div className="catalog-actions">
                          <button
                            onClick={() =>
                              setModal({ mode: 'edit', kind, row })
                            }
                            aria-label={'Editar ' + row.name}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                mode: row.active ? 'archive' : 'restore',
                                kind,
                                row,
                              })
                            }
                            aria-label={
                              (row.active ? 'Archivar ' : 'Restaurar ') +
                              row.name
                            }
                          >
                            {row.active ? 'Archivar' : 'Restaurar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="catalog-pagination">
            <button
              disabled={query.page <= 1}
              onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
            >
              Anterior
            </button>
            <span>
              Página {query.page} de {Math.max(1, result.pagination.totalPages)}
            </span>
            <button
              disabled={query.page >= result.pagination.totalPages}
              onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
            >
              Siguiente
            </button>
          </div>
        </>
      )}
      {modal && (
        <Editor
          modal={modal}
          categories={categories}
          close={() => setModal(null)}
          saved={() => {
            focusAfterSave.current = true;
            setLoading(true);
            setModal(null);
            setRevision((r) => r + 1);
          }}
        />
      )}
    </section>
  );
}
function Editor({
  modal,
  categories,
  close,
  saved,
}: {
  modal: Modal;
  categories: CategoryV1[];
  close: () => void;
  saved: () => void;
}) {
  const row = modal.row,
    item = row && 'sku' in row ? row : undefined;
  const [type, setType] = useState(item?.itemType ?? 'RAW_MATERIAL');
  const [base, setBase] = useState(item?.inventoryBaseUnit ?? 'MILLILITER');
  const [operation, setOperation] = useState(
    item?.defaultOperationUnit ?? 'LITER',
  );
  const [sku, setSku] = useState(item?.sku ?? '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false);
  const [version, setVersion] = useState(row?.version);
  const [latest, setLatest] = useState<Row | null>(null);
  const form = useRef<HTMLFormElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    pending = useRef(false);
  const title =
    modal.mode === 'edit'
      ? (row ? 'Editar ' : 'Crear ') +
        (modal.kind === 'items' ? 'artículo' : 'categoría')
      : (modal.mode === 'archive' ? 'Archivar ' : 'Restaurar ') + row?.name;
  function report(message: string, fields: string[] = []) {
    setError(message);
    setTimeout(() => {
      const first = fields.length
        ? form.current?.elements.namedItem(fields[0]!)
        : null;
      if (first instanceof HTMLElement) first.focus();
      else errorRef.current?.focus();
    }, 0);
  }
  async function dismiss() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      if (
        modal.mode !== 'edit' ||
        (await confirmDiscard(form.current?.closest('dialog')))
      )
        close();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setConflict(false);
    try {
      const data = new FormData(e.currentTarget);
      let body: unknown = { expectedVersion: version };
      if (modal.mode === 'edit') {
        const value = (key: string) => String(data.get(key) ?? '');
        const fields = {
          name: value('name'),
          description: value('description').trim() || null,
          ...(row ? { expectedVersion: version } : {}),
        };
        body =
          modal.kind === 'categories'
            ? fields
            : {
                ...fields,
                ...(!row ? { sku } : {}),
                itemType: type,
                categoryId: value('categoryId'),
                inventoryBaseUnit: base,
                defaultOperationUnit: operation,
                trackInventory: data.get('trackInventory') === 'on',
                minimumStockBase: value('minimumStockBase') || null,
                barcode: value('barcode').trim() || null,
                nominalCapacityValue: value('nominalCapacityValue') || null,
                nominalCapacityUnit: value('nominalCapacityUnit') || null,
              };
        const schema =
          modal.kind === 'categories'
            ? row
              ? updateCategoryV1Schema
              : createCategoryV1Schema
            : row
              ? updateItemV1Schema
              : createItemV1Schema;
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          report(
            'Revisa el formato y la longitud de los campos indicados.',
            parsed.error.issues.map((i) => String(i.path[0] ?? '')),
          );
          return;
        }
        body = parsed.data;
      }
      const path =
        modal.kind +
        (row ? '/' + row.id : '') +
        (modal.mode === 'edit' ? '' : '/' + modal.mode);
      const method = modal.mode === 'edit' && row ? 'PATCH' : 'POST';
      if (modal.kind === 'items')
        await catalogRequest(path, catalogItemV1Schema, method, body);
      else await catalogRequest(path, categoryV1Schema, method, body);
      saved();
    } catch (e) {
      if (e instanceof CatalogRequestError) {
        report(e.message, e.fields);
        setConflict(e.code === 'CONCURRENT_MODIFICATION');
      } else report('No se pudo guardar. Tus datos siguen en el formulario.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function fetchLatest() {
    try {
      setLatest(
        modal.kind === 'items'
          ? await catalogRequest('items/' + row!.id, catalogItemV1Schema)
          : await catalogRequest('categories/' + row!.id, categoryV1Schema),
      );
    } catch {
      report('No se pudo consultar la versión actual. Intenta de nuevo.');
    }
  }
  const changeBase = (value: typeof base) => {
    setBase(value);
    setOperation(value);
  };
  return (
    <Dialog title={title} close={() => void dismiss()}>
      <form ref={form} onSubmit={submit}>
        {modal.mode === 'edit' ? (
          <div className="catalog-form">
            {modal.kind === 'items' && (
              <label>
                SKU
                <input
                  name="sku"
                  aria-label="SKU"
                  aria-describedby="catalog-sku-help"
                  required
                  minLength={3}
                  maxLength={40}
                  pattern="[A-Z0-9][A-Z0-9_-]{2,39}"
                  value={sku}
                  readOnly={!!row}
                  onChange={(e) => setSku(e.target.value.toUpperCase())}
                />
                <small id="catalog-sku-help">
                  Único. Usa letras, números, guion o guion bajo. No se modifica
                  después de crear.
                </small>
              </label>
            )}
            <label>
              Nombre
              <input
                name="name"
                required
                minLength={2}
                maxLength={modal.kind === 'items' ? 120 : 80}
                defaultValue={row?.name}
              />
            </label>
            <label className="catalog-wide">
              Descripción
              <textarea
                name="description"
                maxLength={2000}
                defaultValue={row?.description ?? ''}
              />
            </label>
            {modal.kind === 'items' && (
              <>
                <label>
                  Tipo
                  <select
                    aria-label="Tipo"
                    name="itemType"
                    value={type}
                    onChange={(e) => {
                      const next = e.target.value as typeof type;
                      setType(next);
                      if (next === 'PACKAGING') changeBase('UNIT');
                      if (next === 'BYPRODUCT' && base === 'UNIT')
                        changeBase('GRAM');
                    }}
                  >
                    {options(ITEM_TYPES_V1)}
                  </select>
                </label>
                <label>
                  Categoría
                  <select
                    aria-label="Categoría"
                    name="categoryId"
                    required
                    defaultValue={item?.categoryId ?? ''}
                  >
                    <option value="" disabled>
                      Selecciona una categoría
                    </option>
                    {categories
                      .filter((c) => c.active || c.id === item?.categoryId)
                      .map((c) => (
                        <option
                          key={c.id}
                          value={c.id}
                          disabled={!c.active && item?.active !== false}
                        >
                          {c.name}
                          {c.active ? '' : ' (archivada)'}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Unidad base
                  <select
                    aria-label="Unidad base"
                    name="inventoryBaseUnit"
                    value={base}
                    onChange={(e) => changeBase(e.target.value as typeof base)}
                    disabled={type === 'PACKAGING'}
                  >
                    {options(
                      BASE_UNITS_V1.filter(
                        (u) => type !== 'BYPRODUCT' || u !== 'UNIT',
                      ),
                    )}
                  </select>
                </label>
                <label>
                  Unidad operativa
                  <select
                    aria-label="Unidad operativa"
                    name="defaultOperationUnit"
                    value={operation}
                    onChange={(e) =>
                      setOperation(e.target.value as typeof operation)
                    }
                    disabled={type === 'PACKAGING'}
                  >
                    {options(
                      OPERATION_UNITS_V1.filter((u) =>
                        base === 'UNIT'
                          ? u === 'UNIT'
                          : base === 'GRAM'
                            ? ['GRAM', 'KILOGRAM'].includes(u)
                            : ['MILLILITER', 'LITER'].includes(u),
                      ),
                    )}
                  </select>
                </label>
                <label className="catalog-checkbox">
                  <input
                    name="trackInventory"
                    type="checkbox"
                    defaultChecked={item?.trackInventory ?? true}
                  />
                  Seguimiento de inventario
                </label>
                <label>
                  Existencia mínima futura
                  <input
                    aria-label="Existencia mínima futura"
                    name="minimumStockBase"
                    inputMode="decimal"
                    defaultValue={item?.minimumStockBase ?? ''}
                  />
                  <small>
                    En la unidad base. No representa existencias actuales.
                  </small>
                </label>
                <label>
                  Código de barras
                  <input
                    name="barcode"
                    maxLength={80}
                    defaultValue={item?.barcode ?? ''}
                  />
                </label>
                <label>
                  Capacidad del envase (opcional)
                  <input
                    name="nominalCapacityValue"
                    aria-describedby="catalog-capacity-help"
                    inputMode="decimal"
                    defaultValue={item?.nominalCapacityValue ?? ''}
                    placeholder={
                      type === 'PACKAGING' ? 'Ej. 4 u 8' : 'Opcional'
                    }
                  />
                </label>
                <label>
                  Unidad de esa capacidad
                  <select
                    aria-label="Unidad de esa capacidad"
                    name="nominalCapacityUnit"
                    aria-describedby="catalog-capacity-help"
                    defaultValue={item?.nominalCapacityUnit ?? ''}
                  >
                    <option value="">No aplica</option>
                    {options(CAPACITY_UNITS_V1)}
                  </select>
                </label>
                <p id="catalog-capacity-help" className="muted catalog-wide">
                  La capacidad nominal indica cuánto cabe en el envase según su
                  presentación. Para un recipiente de 4 onzas, escribe 4 y elige
                  Onza fluida; para una botella de 1 litro, escribe 1 y elige
                  Litro. La unidad indica cómo se mide esa cantidad. Si el
                  artículo no tiene una presentación fija, como leche a granel,
                  tapas o etiquetas, deja la capacidad vacía y elige No aplica.
                  Este dato no indica cuántos artículos tienes ni el peso real
                  del yogurt. Para decimales, usa punto: por ejemplo, 1.5.
                </p>
              </>
            )}
          </div>
        ) : (
          <p>
            {modal.mode === 'archive'
              ? 'El registro dejará de estar activo. Se conservará su información.'
              : 'El registro volverá a estar activo.'}
          </p>
        )}
        <p ref={errorRef} tabIndex={-1} role="alert" className="form-error">
          {error}
        </p>
        {conflict && (
          <button type="button" onClick={() => void fetchLatest()}>
            Consultar versión actual
          </button>
        )}
        {latest && (
          <div className="catalog-conflict">
            <p>
              Versión actual: {latest.version}. Revisa los valores guardados
              antes de volver a enviar tus cambios:
            </p>
            <dl>
              {Object.entries(latest)
                .filter(
                  ([k]) =>
                    ![
                      'id',
                      'slug',
                      'createdAt',
                      'updatedAt',
                      'archivedAt',
                    ].includes(k),
                )
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>
                      {(
                        {
                          name: 'Nombre',
                          description: 'Descripción',
                          active: 'Activo',
                          version: 'Versión',
                          sku: 'SKU',
                          slug: 'Identificador',
                          itemType: 'Tipo',
                          categoryId: 'Categoría',
                          inventoryBaseUnit: 'Unidad base',
                          defaultOperationUnit: 'Unidad operativa',
                          nominalCapacityValue: 'Capacidad nominal',
                          nominalCapacityUnit: 'Unidad nominal',
                          trackInventory: 'Seguimiento',
                          minimumStockBase: 'Mínimo futuro',
                          barcode: 'Código de barras',
                        } as Record<string, string>
                      )[k] ?? k}
                    </dt>
                    <dd>
                      {typeof v === 'boolean'
                        ? v
                          ? 'Sí'
                          : 'No'
                        : k === 'categoryId'
                          ? (categories.find((c) => c.id === v)?.name ??
                            'Categoría no disponible')
                          : (names[String(v)] ?? String(v ?? 'Sin valor'))}
                    </dd>
                  </div>
                ))}
            </dl>
            <button
              type="button"
              onClick={() => {
                setVersion(latest.version);
                setLatest(null);
                setConflict(false);
                setError(
                  'Versión actual seleccionada. Revisa tu formulario y pulsa Guardar para enviar tus cambios.',
                );
              }}
            >
              Conservar mis datos y usar esta versión
            </button>
          </div>
        )}
        <div className="catalog-actions">
          <button type="button" disabled={busy} onClick={() => void dismiss()}>
            Cancelar
          </button>
          <button className="refresh" disabled={busy || conflict} type="submit">
            {busy
              ? 'Guardando…'
              : modal.mode === 'edit'
                ? 'Guardar'
                : modal.mode === 'archive'
                  ? 'Confirmar archivado'
                  : 'Confirmar restauración'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
