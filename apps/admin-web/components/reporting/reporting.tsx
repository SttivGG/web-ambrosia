'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '../auth/session-provider';
import { reportingApi } from '../../lib/api/reporting';

type View =
  | 'resumen'
  | 'compras'
  | 'proveedores'
  | 'inventario'
  | 'kardex'
  | 'produccion'
  | 'rendimiento'
  | 'merma'
  | 'envasado';
type Row = Record<string, unknown>;
type Page = {
  data: Row[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
};
type Summary = {
  metrics: Record<string, string | number | null>;
  comparison?: Record<
    string,
    {
      current: string | null;
      previous: string | null;
      changePercent: string | null;
    }
  >;
};
type OperationalOverview = {
  purchases: Summary;
  inventory: Summary;
  production: Summary;
  waste: Summary;
  packagingOperations: number;
  packagingUnits: string | null;
  hasInventoryValue: boolean;
  hasProductionOutput: boolean;
  hasWaste: boolean;
  hasData: boolean;
};
type Filters = {
  from: string;
  to: string;
  search: string;
  supplierId: string;
  itemId: string;
  categoryId: string;
  productId: string;
  status: string;
  movementType: string;
  operationId: string;
  itemType: string;
  valuationStatus: string;
};
const emptyFilters: Filters = {
  from: '',
  to: '',
  search: '',
  supplierId: '',
  itemId: '',
  categoryId: '',
  productId: '',
  status: '',
  movementType: '',
  operationId: '',
  itemType: '',
  valuationStatus: '',
};
const views: { id: View; label: string; description: string }[] = [
  {
    id: 'resumen',
    label: 'Resumen',
    description: 'Indicadores operativos consolidados para el período.',
  },
  {
    id: 'compras',
    label: 'Compras',
    description: 'Detalle de compras por proveedor, artículo y estado.',
  },
  {
    id: 'proveedores',
    label: 'Proveedores',
    description: 'Consolidado de compras, artículos y evolución de precios.',
  },
  {
    id: 'inventario',
    label: 'Inventario',
    description: 'Existencias y valoración actual sin fabricar costos.',
  },
  {
    id: 'kardex',
    label: 'Kardex',
    description: 'Movimientos y snapshots de costo históricos.',
  },
  {
    id: 'produccion',
    label: 'Producción',
    description: 'Lotes, cantidades, merma, rendimiento y costos.',
  },
  {
    id: 'rendimiento',
    label: 'Rendimiento',
    description: 'Hechos observados de entrada, salida y rendimiento.',
  },
  {
    id: 'merma',
    label: 'Merma',
    description: 'Cantidad y porcentaje de merma por lote.',
  },
  {
    id: 'envasado',
    label: 'Envasado',
    description: 'Separación de granel, materiales y costo terminado.',
  },
];
const columns: Record<View, { key: string; label: string }[]> = {
  resumen: [
    { key: 'proyeccion', label: 'Proyección' },
    { key: 'cantidad', label: 'Registros' },
  ],
  compras: [
    { key: 'purchasedAt', label: 'Fecha' },
    { key: 'purchaseReference', label: 'Compra' },
    { key: 'supplierNameSnapshot', label: 'Proveedor' },
    { key: 'itemNameSnapshot', label: 'Artículo' },
    { key: 'quantity', label: 'Cantidad' },
    { key: 'unit', label: 'Unidad' },
    { key: 'unitCost', label: 'Costo unitario' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'status', label: 'Estado' },
  ],
  proveedores: [
    { key: 'supplierName', label: 'Proveedor' },
    { key: 'totalPurchases', label: 'Compras totales' },
    { key: 'purchaseCount', label: 'Compras' },
    { key: 'lastPurchaseAt', label: 'Última compra' },
    { key: 'suppliedItems', label: 'Artículos' },
  ],
  inventario: [
    { key: 'itemNameSnapshot', label: 'Artículo' },
    { key: 'itemType', label: 'Tipo' },
    { key: 'unit', label: 'Unidad' },
    { key: 'onHand', label: 'Existencia' },
    { key: 'valuationStatus', label: 'Valoración' },
    { key: 'weightedAverageCost', label: 'Costo promedio' },
    { key: 'inventoryValue', label: 'Valor' },
  ],
  kardex: [
    { key: 'occurredAt', label: 'Fecha' },
    { key: 'itemNameSnapshot', label: 'Artículo' },
    { key: 'movementType', label: 'Movimiento' },
    { key: 'reference', label: 'Referencia' },
    { key: 'quantityIn', label: 'Entrada' },
    { key: 'quantityOut', label: 'Salida' },
    { key: 'balanceAfter', label: 'Saldo' },
    { key: 'unitCost', label: 'Costo unitario' },
    { key: 'totalCost', label: 'Costo total' },
    { key: 'averageCostAfter', label: 'Promedio posterior' },
    { key: 'operationId', label: 'operationId' },
  ],
  produccion: [
    { key: 'batch', label: 'Lote' },
    { key: 'productNameSnapshot', label: 'Producto' },
    { key: 'startedAt', label: 'Inicio' },
    { key: 'completedAt', label: 'Cierre' },
    { key: 'inputQuantity', label: 'Entrada' },
    { key: 'outputQuantity', label: 'Salida' },
    { key: 'wasteQuantity', label: 'Merma' },
    { key: 'yieldPercentage', label: 'Rendimiento' },
    { key: 'accumulatedCost', label: 'Costo acumulado' },
    { key: 'sellableCost', label: 'Costo vendible' },
    { key: 'status', label: 'Estado' },
  ],
  rendimiento: [
    { key: 'batch', label: 'Lote' },
    { key: 'productNameSnapshot', label: 'Producto' },
    { key: 'inputQuantity', label: 'Entrada' },
    { key: 'outputQuantity', label: 'Salida' },
    { key: 'yieldPercentage', label: 'Rendimiento' },
    { key: 'occurredAt', label: 'Fecha' },
  ],
  merma: [
    { key: 'batch', label: 'Lote' },
    { key: 'productNameSnapshot', label: 'Producto' },
    { key: 'inputQuantity', label: 'Entrada' },
    { key: 'outputQuantity', label: 'Salida' },
    { key: 'wasteQuantity', label: 'Merma' },
    { key: 'wastePercent', label: 'Porcentaje' },
    { key: 'occurredAt', label: 'Fecha' },
  ],
  envasado: [
    { key: 'finishedProductId', label: 'Producto terminado' },
    { key: 'batch', label: 'Lote' },
    { key: 'units', label: 'Unidades' },
    { key: 'netContentTotal', label: 'Contenido neto' },
    { key: 'bulkCost', label: 'Costo granel' },
    { key: 'materialsCost', label: 'Materiales' },
    { key: 'totalCost', label: 'Costo total' },
    { key: 'finishedUnitCost', label: 'Costo unitario' },
  ],
};
const labels: Record<string, string> = {
  totalComprado: 'Total comprado',
  numeroCompras: 'Compras',
  proveedores: 'Proveedores',
  costoPromedioPonderado: 'Costo promedio ponderado',
  valorInventarioValorado: 'Inventario valorado',
  articulosConExistencia: 'Con existencia',
  articulosSinValorar: 'Sin valorar',
  lotes: 'Lotes',
  cantidadProducida: 'Cantidad producida',
  rendimientoPromedio: 'Rendimiento promedio',
  mermaTotal: 'Merma total',
  costoAcumulado: 'Costo acumulado',
  promedio: 'Promedio',
  minimo: 'Mínimo',
  maximo: 'Máximo',
  lotesAnalizados: 'Lotes analizados',
  mermaPromedioPorcentual: 'Merma promedio',
};
const projectionLabels: Record<string, string> = {
  inventoryItems: 'Artículos de inventario',
  inventoryMovements: 'Movimientos',
  productionBatches: 'Lotes de producción',
  saleMargins: 'Registros financieros',
  purchaseItems: 'Líneas de compra',
  packagingOperations: 'Operaciones de envasado',
};
const decimalParts = (value: string) => {
  const [integer = '0', fraction = ''] = value.split('.');
  return { integer, fraction };
};
const addDecimals = (values: string[]) => {
  if (!values.length) return null;
  const scale = Math.max(
    ...values.map((value) => decimalParts(value).fraction.length),
  );
  const total = values.reduce((sum, value) => {
    const { integer, fraction } = decimalParts(value);
    return sum + BigInt(integer + fraction.padEnd(scale, '0'));
  }, 0n);
  const raw = total.toString().padStart(scale + 1, '0');
  if (!scale) return raw;
  const fraction = raw.slice(-scale).replace(/0+$/, '');
  return fraction
    ? raw.slice(0, -scale) + '.' + fraction
    : raw.slice(0, -scale);
};
const isPositiveDecimal = (value: unknown) =>
  typeof value === 'string' &&
  /^\d+(?:\.\d+)?$/.test(value) &&
  BigInt(value.replace('.', '')) > 0n;
const formatDecimal = (value: string | number | null | undefined) => {
  if (value === null || value === undefined || value === '') return 'Sin datos';
  const { integer, fraction } = decimalParts(String(value));
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction ? grouped + ',' + fraction : grouped;
};
const metric = (summary: Summary, key: string) => summary.metrics[key];

function MetricCard({
  label,
  value,
  kind = 'quantity',
  note,
  warning = false,
}: {
  label: string;
  value: string | number | null | undefined;
  kind?: 'currency' | 'quantity' | 'percent';
  note?: string;
  warning?: boolean;
}) {
  const formatted = formatDecimal(value);
  return (
    <article className={warning ? 'is-warning' : undefined}>
      <span>{label}</span>
      <strong>
        {kind === 'currency' && formatted !== 'Sin datos' ? '$ ' : ''}
        {formatted}
        {kind === 'currency' && formatted !== 'Sin datos' ? ' COP' : ''}
        {kind === 'percent' && formatted !== 'Sin datos' ? ' %' : ''}
      </strong>
      {note && <small>{note}</small>}
    </article>
  );
}
const dateValue = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value)
    ? new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'medium',
        timeZone: 'America/Bogota',
      }).format(new Date(value))
    : null;
function display(row: Row, key: string) {
  if (key === 'productNameSnapshot' && !row[key])
    return String(row.productId ?? '—');
  if (key === 'wastePercent') {
    const input = Number(row.inputQuantity);
    return input > 0
      ? ((Number(row.wasteQuantity ?? 0) / input) * 100).toLocaleString(
          'es-CO',
          { maximumFractionDigits: 4 },
        ) + ' %'
      : '—';
  }
  if (
    row.valuationStatus === 'UNVALUED' &&
    ['weightedAverageCost', 'inventoryValue'].includes(key)
  )
    return 'Sin valorar';
  const value = row[key];
  if (value === null || value === undefined || value === '') return '—';
  return dateValue(value) ?? String(value);
}

export function ReportingInfrastructure() {
  const { permissions } = useSession();
  const allowed = permissions.includes('reports.read');
  const canViewFinance = permissions.includes('reports.finance');
  const [view, setView] = useState<View>('resumen');
  const [pageNumber, setPageNumber] = useState(1);
  const [draftFilters, setDraftFilters] = useState<Filters>(emptyFilters);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [state, setState] = useState<{
    status: 'loading' | 'forbidden' | 'error' | 'ready';
    page?: Page;
    summary?: Summary;
    overview?: OperationalOverview;
  }>({ status: 'loading' });
  const selected = useMemo(
    () => views.find((entry) => entry.id === view)!,
    [view],
  );
  const load = useCallback(async () => {
    if (!allowed) {
      setState({ status: 'forbidden' });
      return;
    }
    setState({ status: 'loading' });
    const params = new URLSearchParams({
      page: String(pageNumber),
      pageSize: '20',
    });
    if (filters.from)
      params.set(
        'from',
        new Date(filters.from + 'T00:00:00-05:00').toISOString(),
      );
    if (filters.to)
      params.set('to', new Date(filters.to + 'T00:00:00-05:00').toISOString());
    if (view === 'compras') {
      if (filters.supplierId) params.set('supplierId', filters.supplierId);
      if (filters.itemId) params.set('itemId', filters.itemId);
      if (filters.categoryId) params.set('categoryId', filters.categoryId);
      if (filters.status) params.set('status', filters.status);
    }
    if (view === 'inventario') {
      if (filters.itemType) params.set('itemType', filters.itemType);
      if (filters.valuationStatus)
        params.set('valuationStatus', filters.valuationStatus);
    }
    if (view === 'kardex') {
      if (filters.itemId) params.set('itemId', filters.itemId);
      if (filters.movementType)
        params.set('movementType', filters.movementType);
      if (filters.operationId) params.set('operationId', filters.operationId);
    }
    if (['produccion', 'rendimiento', 'merma'].includes(view)) {
      if (filters.productId) params.set('productId', filters.productId);
      if (filters.status) params.set('status', filters.status);
    }
    if (view === 'envasado') {
      if (filters.productId) params.set('productId', filters.productId);
      if (filters.status) params.set('status', filters.status);
    }
    try {
      let page: Page, summary: Summary | undefined;
      let overview: OperationalOverview | undefined;
      if (view === 'resumen') {
        const overviewParams = new URLSearchParams(params);
        overviewParams.set('page', '1');
        overviewParams.set('pageSize', '100');
        const [
          health,
          purchases,
          inventory,
          production,
          waste,
          inventoryPage,
          productionPage,
          packagingPage,
        ] = await Promise.all([
          reportingApi.health(),
          reportingApi.purchaseSummary(overviewParams),
          reportingApi.inventorySummary(overviewParams),
          reportingApi.productionSummary(overviewParams),
          reportingApi.wasteSummary(overviewParams),
          reportingApi.inventory(overviewParams),
          reportingApi.production(overviewParams),
          reportingApi.packaging(overviewParams),
        ]);
        const remainingPages = async <T,>(
          first: { data: T[]; pagination: { totalPages: number } },
          request: (values: URLSearchParams) => Promise<{
            data: T[];
            pagination: { totalPages: number };
          }>,
        ) => {
          if (first.pagination.totalPages <= 1) return first.data;
          const pages = await Promise.all(
            Array.from(
              { length: first.pagination.totalPages - 1 },
              (_, index) => {
                const values = new URLSearchParams(overviewParams);
                values.set('page', String(index + 2));
                return request(values);
              },
            ),
          );
          return [...first.data, ...pages.flatMap((entry) => entry.data)];
        };
        const [inventoryRows, productionRows, packagingRows] =
          await Promise.all([
            remainingPages(inventoryPage, reportingApi.inventory),
            remainingPages(productionPage, reportingApi.production),
            remainingPages(packagingPage, reportingApi.packaging),
          ]);
        const purchaseCount = Number(metric(purchases, 'numeroCompras') ?? 0);
        const stockItems = Number(
          metric(inventory, 'articulosConExistencia') ?? 0,
        );
        const batches = Number(metric(production, 'lotes') ?? 0);
        overview = {
          purchases,
          inventory,
          production,
          waste,
          packagingOperations: packagingPage.pagination.totalItems,
          packagingUnits: addDecimals(
            packagingRows.map((entry) => entry.units),
          ),
          hasInventoryValue: inventoryRows.some(
            (entry) =>
              isPositiveDecimal(entry.onHand) && entry.inventoryValue !== null,
          ),
          hasProductionOutput: productionRows.some(
            (entry) => entry.outputQuantity !== null,
          ),
          hasWaste: productionRows.some(
            (entry) => entry.wasteQuantity !== null,
          ),
          hasData:
            purchaseCount > 0 ||
            stockItems > 0 ||
            batches > 0 ||
            packagingPage.pagination.totalItems > 0,
        };
        page = {
          data: Object.entries(health.projections).map(
            ([proyeccion, cantidad]) => ({
              proyeccion: projectionLabels[proyeccion] ?? 'Otra proyección',
              cantidad,
            }),
          ),
          pagination: {
            page: 1,
            pageSize: 20,
            totalItems: Object.keys(health.projections).length,
            totalPages: 1,
          },
        };
      } else if (view === 'compras')
        [page, summary] = await Promise.all([
          reportingApi.purchases(params),
          reportingApi.purchaseSummary(params),
        ]);
      else if (view === 'proveedores') {
        if (filters.search) params.set('search', filters.search);
        page = await reportingApi.suppliers(params);
      } else if (view === 'inventario') {
        if (filters.search) params.set('search', filters.search);
        [page, summary] = await Promise.all([
          reportingApi.inventory(params),
          reportingApi.inventorySummary(params),
        ]);
      } else if (view === 'kardex') {
        if (filters.search) params.set('reference', filters.search);
        page = await reportingApi.movements(params);
      } else if (view === 'produccion')
        [page, summary] = await Promise.all([
          reportingApi.production(params),
          reportingApi.productionSummary(params),
        ]);
      else if (view === 'rendimiento')
        [page, summary] = await Promise.all([
          reportingApi.yield(params),
          reportingApi.yieldSummary(params),
        ]);
      else if (view === 'merma')
        [page, summary] = await Promise.all([
          reportingApi.waste(params),
          reportingApi.wasteSummary(params),
        ]);
      else page = await reportingApi.packaging(params);
      setState({ status: 'ready', page, summary, overview });
    } catch (error) {
      setState({
        status:
          error instanceof Error && error.message === 'forbidden'
            ? 'forbidden'
            : 'error',
      });
    }
  }, [allowed, filters, pageNumber, view]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);
  const changeView = (next: View) => {
    setView(next);
    setPageNumber(1);
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
  };
  const overview = state.overview;
  return (
    <section className="reports" aria-labelledby="reports-title">
      <header className="page-intro">
        <p className="eyebrow">REPORTES OPERATIVOS · FASE 8B</p>
        <h1 id="reports-title">Reportes</h1>
        <p>
          Lecturas derivadas y eventualmente consistentes. Los dominios
          operativos siguen siendo la fuente de verdad.
        </p>
      </header>
      <nav className="reports-nav" aria-label="Reportes operativos">
        {views.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-current={view === entry.id ? 'page' : undefined}
            onClick={() => changeView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="reports-heading">
        <div>
          <p className="eyebrow">{selected.label.toUpperCase()}</p>
          <h2>{selected.label}</h2>
          <p>{selected.description}</p>
        </div>
      </div>
      {view === 'resumen' && (
        <form
          className="reports-filters reports-period-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setPageNumber(1);
            setFilters(draftFilters);
          }}
        >
          <label>
            Desde
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) =>
                setDraftFilters((value) => ({
                  ...value,
                  from: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Hasta (exclusivo)
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) =>
                setDraftFilters((value) => ({
                  ...value,
                  to: event.target.value,
                }))
              }
            />
          </label>
          <button type="submit">Aplicar filtros</button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setDraftFilters(emptyFilters);
              setFilters(emptyFilters);
              setPageNumber(1);
            }}
          >
            Limpiar
          </button>
        </form>
      )}
      {view !== 'resumen' && (
        <form
          className="reports-filters"
          onSubmit={(event) => {
            event.preventDefault();
            setPageNumber(1);
            setFilters(draftFilters);
          }}
        >
          <label>
            Desde
            <input
              type="date"
              value={draftFilters.from}
              onChange={(event) =>
                setDraftFilters((value) => ({
                  ...value,
                  from: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Hasta (exclusivo)
            <input
              type="date"
              value={draftFilters.to}
              onChange={(event) =>
                setDraftFilters((value) => ({
                  ...value,
                  to: event.target.value,
                }))
              }
            />
          </label>
          {['proveedores', 'inventario', 'kardex'].includes(view) && (
            <label>
              Buscar
              <input
                value={draftFilters.search}
                onChange={(event) =>
                  setDraftFilters((value) => ({
                    ...value,
                    search: event.target.value,
                  }))
                }
                placeholder={view === 'kardex' ? 'Referencia' : 'Nombre'}
              />
            </label>
          )}
          {view === 'compras' && (
            <>
              <label>
                ID proveedor
                <input
                  value={draftFilters.supplierId}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      supplierId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                ID artículo
                <input
                  value={draftFilters.itemId}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      itemId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                ID categoría
                <input
                  value={draftFilters.categoryId}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      categoryId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Estado
                <select
                  value={draftFilters.status}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      status: event.target.value,
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="DRAFT">Borrador</option>
                  <option value="RECEIVED">Recibida</option>
                  <option value="CANCELLED">Cancelada</option>
                </select>
              </label>
            </>
          )}
          {view === 'inventario' && (
            <>
              <label>
                Tipo
                <select
                  value={draftFilters.itemType}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      itemType: event.target.value,
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="RAW_MATERIAL">Materia prima</option>
                  <option value="PACKAGING">Empaque</option>
                  <option value="FINISHED_PRODUCT">Producto terminado</option>
                  <option value="BYPRODUCT">Subproducto</option>
                  <option value="SUPPLY">Insumo</option>
                </select>
              </label>
              <label>
                Valoración
                <select
                  value={draftFilters.valuationStatus}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      valuationStatus: event.target.value,
                    }))
                  }
                >
                  <option value="">Todas</option>
                  <option value="VALUED">Valorado</option>
                  <option value="UNVALUED">Sin valorar</option>
                  <option value="EMPTY">Sin existencia</option>
                </select>
              </label>
            </>
          )}
          {view === 'kardex' && (
            <>
              <label>
                ID artículo
                <input
                  value={draftFilters.itemId}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      itemId: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Tipo de movimiento
                <select
                  value={draftFilters.movementType}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      movementType: event.target.value,
                    }))
                  }
                >
                  <option value="">Todos</option>
                  <option value="PURCHASE_IN">Entrada por compra</option>
                  <option value="ADJUSTMENT_IN">Ajuste de entrada</option>
                  <option value="ADJUSTMENT_OUT">Ajuste de salida</option>
                  <option value="REVERSAL">Reversión</option>
                  <option value="PRODUCTION_OUT">Salida a producción</option>
                  <option value="PRODUCTION_RETURN">
                    Retorno de producción
                  </option>
                  <option value="PRODUCTION_IN">Entrada de producción</option>
                  <option value="PACKAGING_OUT">Salida a envasado</option>
                  <option value="PACKAGED_PRODUCT_IN">Producto envasado</option>
                  <option value="SALE_OUT">Salida por venta</option>
                  <option value="SALE_RETURN">Retorno de venta</option>
                </select>
              </label>
              <label>
                operationId
                <input
                  value={draftFilters.operationId}
                  onChange={(event) =>
                    setDraftFilters((value) => ({
                      ...value,
                      operationId: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          )}
          {['produccion', 'rendimiento', 'merma', 'envasado'].includes(
            view,
          ) && (
            <label>
              ID producto
              <input
                value={draftFilters.productId}
                onChange={(event) =>
                  setDraftFilters((value) => ({
                    ...value,
                    productId: event.target.value,
                  }))
                }
              />
            </label>
          )}
          {['produccion', 'rendimiento', 'merma'].includes(view) && (
            <label>
              Estado
              <select
                value={draftFilters.status}
                onChange={(event) =>
                  setDraftFilters((value) => ({
                    ...value,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">Todos</option>
                <option value="DRAFT">Borrador</option>
                <option value="IN_PROGRESS">En proceso</option>
                <option value="COMPLETED">Completado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </label>
          )}
          {view === 'envasado' && (
            <label>
              Estado
              <select
                value={draftFilters.status}
                onChange={(event) =>
                  setDraftFilters((value) => ({
                    ...value,
                    status: event.target.value,
                  }))
                }
              >
                <option value="">Todos</option>
                <option value="PENDING">Pendiente</option>
                <option value="CONFIRMED">Confirmado</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </label>
          )}
          <button type="submit">Aplicar filtros</button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setDraftFilters(emptyFilters);
              setFilters(emptyFilters);
              setPageNumber(1);
            }}
          >
            Limpiar
          </button>
        </form>
      )}
      {state.status === 'loading' && (
        <div className="reports-state" role="status" aria-live="polite">
          <span className="reports-loader" aria-hidden="true" />
          <div>
            <h2>Consultando Reporting</h2>
            <p>Cargando la proyección solicitada.</p>
          </div>
        </div>
      )}
      {state.status === 'forbidden' && (
        <div className="reports-state" role="alert">
          <p className="eyebrow">ACCESO RESTRINGIDO</p>
          <h2>No tienes permiso para consultar reportes</h2>
          <p>Solicita el permiso reports.read a un administrador.</p>
        </div>
      )}
      {state.status === 'error' && (
        <div className="reports-state" role="alert">
          <p className="eyebrow">SERVICIO NO DISPONIBLE</p>
          <h2>No pudimos consultar Reporting</h2>
          <p>Las operaciones de origen continúan disponibles.</p>
          <button type="button" onClick={() => void load()}>
            Reintentar
          </button>
        </div>
      )}
      {state.status === 'ready' && (
        <>
          {view === 'resumen' && overview ? (
            <div className="reports-overview">
              <section
                className="reports-overview-content"
                aria-labelledby="operational-summary-title"
              >
                <header className="reports-overview-intro">
                  <p className="eyebrow">PANORAMA DEL PERÍODO</p>
                  <h3 id="operational-summary-title">Resumen operativo</h3>
                  <p>
                    Compras, existencias y transformación consolidadas desde
                    Reporting.
                  </p>
                </header>
                {!overview.hasData ? (
                  <div className="reports-state reports-state-compact">
                    <p className="eyebrow">SIN RESULTADOS</p>
                    <h3>No hay actividad operativa para estos filtros</h3>
                    <p>Ajusta el período o espera la próxima reconciliación.</p>
                  </div>
                ) : (
                  <div className="reports-kpi-sections">
                    <section aria-labelledby="purchases-kpis-title">
                      <h3 id="purchases-kpis-title">Compras</h3>
                      <div className="reports-summary">
                        {canViewFinance && (
                          <MetricCard
                            label="Total comprado del período"
                            value={
                              Number(
                                metric(overview.purchases, 'numeroCompras'),
                              ) > 0
                                ? metric(overview.purchases, 'totalComprado')
                                : null
                            }
                            kind="currency"
                          />
                        )}
                        <MetricCard
                          label="Número de compras"
                          value={
                            Number(
                              metric(overview.purchases, 'numeroCompras'),
                            ) > 0
                              ? metric(overview.purchases, 'numeroCompras')
                              : null
                          }
                        />
                        <MetricCard
                          label="Proveedores utilizados"
                          value={
                            Number(
                              metric(overview.purchases, 'numeroCompras'),
                            ) > 0
                              ? metric(overview.purchases, 'proveedores')
                              : null
                          }
                        />
                      </div>
                    </section>
                    <section aria-labelledby="inventory-kpis-title">
                      <h3 id="inventory-kpis-title">Inventario</h3>
                      <div className="reports-summary">
                        {canViewFinance && (
                          <MetricCard
                            label="Valor del inventario valorado"
                            value={
                              overview.hasInventoryValue
                                ? metric(
                                    overview.inventory,
                                    'valorInventarioValorado',
                                  )
                                : null
                            }
                            kind="currency"
                            note={
                              !overview.hasInventoryValue &&
                              Number(
                                metric(
                                  overview.inventory,
                                  'articulosConExistencia',
                                ),
                              ) > 0
                                ? 'La existencia disponible no tiene valoración.'
                                : undefined
                            }
                          />
                        )}
                        <MetricCard
                          label="Artículos con existencia"
                          value={
                            Number(
                              metric(
                                overview.inventory,
                                'articulosConExistencia',
                              ),
                            ) > 0
                              ? metric(
                                  overview.inventory,
                                  'articulosConExistencia',
                                )
                              : null
                          }
                        />
                        <MetricCard
                          label="Artículos sin valorar"
                          value={
                            Number(
                              metric(
                                overview.inventory,
                                'articulosConExistencia',
                              ),
                            ) > 0
                              ? metric(
                                  overview.inventory,
                                  'articulosSinValorar',
                                )
                              : null
                          }
                          note="UNVALUED · sin costo ni valor inventado"
                          warning={
                            Number(
                              metric(overview.inventory, 'articulosSinValorar'),
                            ) > 0
                          }
                        />
                      </div>
                    </section>
                    <section aria-labelledby="production-kpis-title">
                      <h3 id="production-kpis-title">Producción</h3>
                      <div className="reports-summary">
                        <MetricCard
                          label="Lotes producidos"
                          value={
                            Number(metric(overview.production, 'lotes')) > 0
                              ? metric(overview.production, 'lotes')
                              : null
                          }
                        />
                        <MetricCard
                          label="Producción total"
                          value={
                            overview.hasProductionOutput
                              ? metric(overview.production, 'cantidadProducida')
                              : null
                          }
                        />
                        <MetricCard
                          label="Rendimiento promedio"
                          value={metric(
                            overview.production,
                            'rendimientoPromedio',
                          )}
                          kind="percent"
                        />
                        <MetricCard
                          label="Merma total"
                          value={
                            overview.hasWaste
                              ? metric(overview.waste, 'mermaTotal')
                              : null
                          }
                        />
                        <MetricCard
                          label="Merma promedio"
                          value={metric(
                            overview.waste,
                            'mermaPromedioPorcentual',
                          )}
                          kind="percent"
                        />
                      </div>
                    </section>
                    {overview.packagingOperations > 0 && (
                      <section aria-labelledby="packaging-kpis-title">
                        <h3 id="packaging-kpis-title">Envasado</h3>
                        <div className="reports-summary">
                          <MetricCard
                            label="Operaciones de envasado"
                            value={overview.packagingOperations}
                          />
                          <MetricCard
                            label="Unidades envasadas"
                            value={overview.packagingUnits}
                          />
                        </div>
                      </section>
                    )}
                  </div>
                )}
              </section>
              <details className="reports-sync-state">
                <summary>
                  <span>Estado de sincronización</span>
                  <small>Conteo técnico de proyecciones</small>
                </summary>
                <div className="reports-table-card">
                  <div className="reports-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Proyección</th>
                          <th scope="col">Registros</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.page?.data.map((row, index) => (
                          <tr key={String(row.proyeccion ?? index)}>
                            <td data-label="Proyección">
                              {display(row, 'proyeccion')}
                            </td>
                            <td data-label="Registros">
                              {display(row, 'cantidad')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </details>
            </div>
          ) : (
            <>
              {state.summary && (
                <div className="reports-summary" aria-label="Indicadores">
                  {Object.entries(state.summary.metrics).map(([key, value]) => (
                    <article key={key}>
                      <span>{labels[key] ?? key}</span>
                      <strong>{value ?? 'Restringido'}</strong>
                      {state.summary?.comparison?.[key] && (
                        <small>
                          Anterior:{' '}
                          {state.summary.comparison[key]!.previous ?? '—'} ·
                          Cambio:{' '}
                          {state.summary.comparison[key]!.changePercent ?? '—'}%
                        </small>
                      )}
                    </article>
                  ))}
                </div>
              )}
              {!state.page?.data.length ? (
                <div className="reports-state">
                  <p className="eyebrow">SIN RESULTADOS</p>
                  <h2>No hay datos para estos filtros</h2>
                  <p>Ajusta el período o espera la próxima reconciliación.</p>
                </div>
              ) : (
                <div className="reports-table-card">
                  <div className="reports-table-scroll">
                    <table>
                      <thead>
                        <tr>
                          {columns[view].map((column) => (
                            <th key={column.key} scope="col">
                              {column.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {state.page.data.map((row, index) => (
                          <tr
                            key={String(
                              row.sourceEntityId ?? row.supplierId ?? index,
                            )}
                          >
                            {columns[view].map((column) => (
                              <td key={column.key} data-label={column.label}>
                                {display(row, column.key)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="reports-pagination">
                    <span>
                      Página {state.page.pagination.page} de{' '}
                      {Math.max(1, state.page.pagination.totalPages)} ·{' '}
                      {state.page.pagination.totalItems} registros
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={state.page.pagination.page <= 1}
                        onClick={() => setPageNumber((value) => value - 1)}
                      >
                        Anterior
                      </button>
                      <button
                        type="button"
                        disabled={
                          state.page.pagination.page >=
                          state.page.pagination.totalPages
                        }
                        onClick={() => setPageNumber((value) => value + 1)}
                      >
                        Siguiente
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
