# ADR-009 — Compras, movimientos y existencias

Estado: aceptado. Fases 3A y 3B implementadas y validadas el 2026-09-22 (America/Bogota).

## Propiedad y límites

Inventory conserva compras, detalles, movimientos y saldos en su propia base. Reutiliza Supplier, SupplierItem y CatalogItem. No hay pagos, producción, eventos de negocio ni Outbox. No cambia el gateway ni los ocho servicios permanentes.

## Compras y precisión

Estados DRAFT, RECEIVED y CANCELLED. Solo el borrador se edita; no se ofrece borrado físico. La referencia es única por proveedor. Hasta 50 líneas distintas, expresadas en la unidad base del artículo; no se hacen conversiones implícitas. Proveedor y artículos deben estar activos y asociados al guardar/recibir. Solo se compran artículos con seguimiento de inventario en esta fase.

Cantidades NUMERIC(24,10), costos e importes NUMERIC(24,2), moneda COP. El servidor calcula con Decimal de precisión ampliada, redondeo HALF_UP por línea a dos decimales y suma las líneas redondeadas; rechaza desbordamientos. Sin impuestos en esta fase: subtotal igual a total. Los contratos transportan decimales como texto.

## Ledger y proyección

InventoryMovement es la fuente de auditoría. InventoryBalance permite paginar existencias sin sumar todo el historial. La inserción del movimiento y la actualización del saldo ocurren en la misma transacción. Cada movimiento guarda actor UUID del JWT, instante UTC, motivo, unidad base y referencia; compras enlazan también su detalle. No hay API para editar o borrar movimientos ni modificar saldos directamente.

## Atomicidad, concurrencia e idempotencia

Las escrituras usan Serializable y expectedVersion para compras. Bloqueos ordenados de artículos coordinan operaciones de saldo; actualizaciones condicionadas evitan saldos negativos. Abortos serializables y deadlocks se convierten en 409, sin reintentar automáticamente. Recepción y cancelación incrementan la versión mediante compare-and-swap dentro de la misma transacción que los movimientos.

Una restricción única por detalle y tipo impide dos entradas o dos reversiones. Repetir recepción devuelve conflicto y nunca duplica stock. Los ajustes requieren operationId UUID único: repetirlo produce conflicto sin duplicar efectos. El cliente conserva la clave ante un fallo ambiguo.

## Reversión y política de saldo

Cancelar DRAFT no mueve stock. Cancelar RECEIVED exige motivo y crea una salida REVERSAL por cada entrada, enlazada de forma única al movimiento original. Conserva la compra y todas las entradas. Si algún saldo es insuficiente, toda la reversión se rechaza. Ninguna salida puede dejar stock negativo, incluidos ajustes y reversiones.

## Permisos y evolución

Se añaden purchases.read y purchases.write al contrato y a la matriz de Identity; se reutilizan inventory.read/write para saldos, movimientos y ajustes. OWNER/ADMIN/OPERATOR gestionan compras, VIEWER consulta. JWT, guards y CSRF se conservan. Tokens anteriores necesitarán renovación para adquirir los nuevos permisos.

La unidad se conserva en el ledger; una vez existan movimientos, cambiar unidad base o seguimiento del artículo se rechaza para no reinterpretar cantidades históricas. Producción futura deberá usar operaciones transaccionales de Inventory y añadir tipos/orígenes; no acceder a su base. Outbox exige otro ADR antes de emitir eventos.

## Trade-offs

Proyección duplicada a cambio de consultas acotadas; exige escribir exclusivamente por Inventory y verificar reconciliación en integración. Serializable puede devolver conflictos bajo carga. Paginación por desplazamiento y filtros indexados siguen las convenciones actuales. Reversión completa, sin recepción parcial ni impuestos, limita complejidad al alcance de Fase 3.
