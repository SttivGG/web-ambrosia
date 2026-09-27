# ADR-013 — Valoración de inventario y costeo real

**Estado:** aceptada e implementada en Fase 7.

## Contexto

Compras, Producción, Envasado y Ventas ya coordinan efectos físicos mediante operaciones persistentes e idempotentes. Faltaba transferir valor económico sin convertir Production, Finance o Reporting en autoridades paralelas ni introducir transacciones distribuidas.

## Decisión

Inventory mantiene por artículo cantidad, valor acumulado y costo promedio unitario. Una entrada con valor confirmado aplica promedio ponderado móvil: suma cantidad y valor, y deriva el nuevo promedio con `Decimal`. Una salida congela el promedio vigente en el movimiento y transfiere `cantidad × promedio`; si agota el saldo transfiere el valor residual completo para evitar residuos de precisión. Los costos internos usan `NUMERIC(48,18)` y nunca `float`.

Las existencias positivas anteriores a esta migración quedan con valor nulo. No se infiere costo desde compras recientes. `POST /api/v1/inventory/valuations/initial` exige `operationId`, artículo, cantidad exacta vigente, costo unitario declarado, fecha UTC, actor y motivo. La operación es única, auditable e idempotente. Mientras una existencia positiva siga sin valorar, Inventory rechaza consumos económicos y nuevas entradas valoradas.

Las compras recibidas transfieren el subtotal confirmado por línea. Los ajustes de entrada sobre inventario ya valorado conservan el promedio; un ajuste que crea saldo desde cero queda sin valorar hasta la operación inicial. Las salidas usan el promedio vigente. Reversiones y devoluciones transfieren el costo del movimiento original, sin editarlo.

El consumo confirmado de cada lote almacena el costo congelado de sus insumos. Al confirmar rendimiento, Inventory suma esos movimientos y transfiere todo el costo al producto a granel dividido por la cantidad real vendible. La merma productiva no recibe inventario ni costo propio; queda absorbida por esa salida real.

Envasado consume por separado producto a granel y materiales `PACKAGING`. El contenido neto conserva la validación contra la capacidad nominal; la merma de envasado se declara aparte y se suma únicamente a la salida de granel. La entrada de producto terminado recibe la suma de costo de granel —incluida esa merma— y empaques. Inventory vuelve a promediar unidades equivalentes de operaciones o lotes distintos.

Al confirmar una venta, Inventory calcula COGS con el promedio vigente y devuelve una instantánea por línea. Finance persiste esa instantánea, deriva margen bruto y porcentaje, y sigue siendo autoridad de ingreso, devolución y cuentas. Una anulación devuelve exactamente el costo histórico de la venta mediante movimientos compensatorios. El frontend nunca suministra costos de inventario o COGS.

## Consistencia y propiedad

Se conserva `database-per-service`. Inventory es la única autoridad de existencias, ledger y valoración. Production guarda instantáneas no autoritativas de costo por lote, rendimiento y envasado. Finance guarda COGS y margen para reporting. Reporting solo deriva y no modifica ledgers.

Cada efecto entre servicios reutiliza el `operationId`, payload persistido, respuesta persistida, bloqueo ordenado, transacción local Serializable, reintento seguro y reconciliación de ADR-010 a ADR-012. No hay 2PC, XA, joins entre bases ni clientes Prisma compartidos. Las operaciones confirmadas son inmutables; toda corrección es una compensación enlazada al hecho original.

## Consecuencias

El costo sigue el flujo físico real y la disminución de rendimiento aumenta naturalmente el costo unitario. La precisión interna supera dos decimales y COP continúa siendo la moneda de presentación. Electricidad, agua, gas, nómina, arriendo, transporte general, mantenimiento, depreciación, administración y costos financieros permanecen fuera del inventario y pueden registrarse como gastos en Finance.

La consistencia entre servicios sigue siendo eventual y visible. Una existencia histórica positiva debe valorarse explícitamente antes de consumirla. No se implementan contabilidad general, absorción de indirectos ni ERP contable.
