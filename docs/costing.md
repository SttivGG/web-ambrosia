# Costeo y valoración — Fase 7

## Modelo operativo

Ambrosia usa promedio ponderado móvil por artículo y costeo real acumulado por lote. Inventory conserva cantidad, valor y promedio; Production conserva lote, consumo, rendimiento y mermas; Finance conserva dinero; Reporting solo deriva.

Flujo económico: `compra → inventario valorado → consumo → costo del lote → rendimiento real → granel → envasado → producto terminado → venta → COGS → margen bruto`.

Las cantidades siguen en `NUMERIC(24,10)`. Valor, costo unitario transferido y acumulados usan `NUMERIC(48,18)` y se transportan como texto. Los importes comerciales COP conservan `NUMERIC(24,2)`. Los cálculos usan Decimal con precisión ampliada y solo redondean al persistir la precisión declarada.

## Valoración inicial

La migración deja `UNVALUED` toda existencia positiva anterior a Fase 7; los saldos cero quedan `EMPTY`. No existe backfill desde compras ni precios.

`POST /api/inventory/inventory/valuations/initial` requiere `inventory.write`, `operationId` UUID estable, `itemId`, `quantity` idéntica a la existencia vigente, `unitCost` declarado, `occurredAt` UTC y `reason`. Inventory registra actor, total derivado y fecha de creación. Repetir el mismo UUID y payload devuelve la misma operación; cambiar cualquier dato produce conflicto. Solo se permite una valoración inicial por artículo.

Una existencia positiva sin valor bloquea consumo, venta, producción y entradas con costo. Los ajustes de entrada no aceptan costo arbitrario: si ya existe valoración conservan el promedio; si crean inventario desde cero, queda pendiente de valoración inicial.

## Reglas por operación

- Compra recibida: entra el subtotal confirmado de cada línea y recalcula promedio.
- Salida: congela costo unitario y total al promedio vigente.
- Consumo de lote: acumula exclusivamente consumos confirmados.
- Rendimiento: todo el costo entra con la cantidad real vendible; la merma productiva queda absorbida.
- Envasado: conserva costo de granel y materiales por separado; la merma de envasado aumenta la salida de granel y queda absorbida por las unidades obtenidas.
- Producto terminado: entra con la suma transferida y se promedia con unidades equivalentes.
- Venta: Inventory determina COGS; Finance deriva `ingreso − COGS` y `margen / ingreso × 100`.
- Anulación: crea movimientos inversos con el costo histórico; nunca reescribe hechos confirmados.

## Migración y recuperación

Migraciones aditivas: Inventory `202609260002_inventory_costing`, Production `202609260003_production_cost_snapshots` y Finance `202609260002_sale_cost_reporting`.

Antes de un entorno con datos, ejecutar `node scripts/prepare-production.mjs --migrate` y `pnpm finance:prepare -- --migrate`. Ambos generan respaldos locales ignorados, verifican lectura, ensayan instalación limpia y actualización aislada, aplican dos veces y comparan filas/columnas anteriores. No usar `db push`, `migrate reset` ni borrar volúmenes.

Un fallo entre servicios deja la operación `PENDING`. Restablecer conectividad y reconciliar con el mismo UUID. Nunca crear otro UUID para una respuesta perdida ni corregir costos directamente en bases. `INITIAL_VALUATION_REQUIRED` exige valorar el artículo, no un reintento ciego.

Véase [ADR-013](adr/ADR-013-inventory-costing.md) y [validation.md](validation.md).
