# Reporting operativo

Fase 8B convierte la infraestructura derivada de Fase 8A en nueve vistas: Resumen, Compras, Proveedores, Inventario, Kardex, Producción, Rendimiento, Merma y Envasado. Reporting sigue sin ser fuente de verdad y nunca escribe en Inventory o Production.

## Proyecciones y consistencia

`ReportPurchaseItem` conserva una fila por línea de compra con snapshots del proveedor, artículo y categoría. `ReportPackagingOperation` conserva una operación de envasado y mantiene separados costo de granel, materiales, total y costo unitario terminado. Se mantienen `ReportInventoryItem`, `ReportInventoryMovement`, `ReportProductionBatch` y `ReportSaleMargin`.

Inventory y Production publican contratos v1 por JetStream con `eventId` determinista, `sourceVersion`, `operationId` e instante UTC. La entrega es al menos una vez; la transacción local de Reporting deduplica y rechaza versiones antiguas. La actualización puede demorarse hasta el siguiente ciclo de publicación o reconciliación.

La reconciliación usa APIs internas paginadas y credenciales técnicas separadas. Inventory entrega artículos, movimientos y compras. Production entrega lotes y envasados. El rebuild protegido elimina solo esas tablas derivadas y sus marcadores del servicio origen antes de reaplicar snapshots; repetir reconciliación no duplica filas.

## Campos, filtros y KPIs

- Compras: fecha, referencia, proveedor, artículo, cantidad, unidad, costo unitario, subtotal y estado. Filtra por período `[from,to)`, proveedor, artículo, categoría y estado. El costo promedio es ponderado por cantidad.
- Proveedores: total y número de compras, última compra, artículos suministrados, costo promedio ponderado por artículo y dataset histórico de precios.
- Inventario: artículo, tipo, unidad, existencia, valoración, costo promedio y valor. `UNVALUED` siempre devuelve costos nulos y la UI muestra “Sin valorar”.
- Kardex: fecha, artículo, tipo, referencia, entradas, salidas, saldo, costos congelados, promedio posterior y `operationId`. No recalcula historia.
- Producción: lote, identificador de producto, inicio, cierre, entrada, salida, merma, rendimiento, costos y estado. No fabrica nombres de producto ausentes.
- Rendimiento y merma: hechos por lote y agregados promedio, mínimo, máximo, total y porcentaje. Una entrada cero no se divide.
- Envasado: producto terminado, lote, unidades, contenido neto y los cuatro componentes de costo separados.

Todas las listas usan `page` y `pageSize` con máximo 100. Las comparaciones de compras, producción y merma usan el período inmediatamente anterior de la misma duración cuando se proporcionan ambos límites.

## RBAC

`reports.read` permite consultar cantidades y hechos operativos. Si el JWT no contiene `reports.finance`, la API sustituye por `null` todos los costos y valores económicos de los reportes operativos; no depende de ocultamiento en el navegador. `reports.manage` protege reconciliación y rebuild. `reports.export` continúa reservado y no existen exportaciones en 8B.

## Límites

No se incluyen PDF, XLSX, CSV, dashboard ejecutivo final, reporting financiero 8C, forecasting, IA, contabilidad ni tienda online. Los importes se presentan en COP y todos los cálculos económicos usan Decimal.
