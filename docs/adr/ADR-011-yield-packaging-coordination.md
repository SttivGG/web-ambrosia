# ADR-011 — Rendimiento y envasado coordinados con Inventory

**Estado:** aceptada e implementada en Fase 5.

## Contexto

Production es propietario de lotes, rendimiento y operaciones de envasado. Inventory es propietario del catálogo, los saldos y el ledger. El catálogo no tiene una entidad Presentation: una presentación vendible se representa con un artículo `FINISHED_PRODUCT`, unidad base `UNIT` y capacidad nominal explícita. Envases, tapas, etiquetas y sellos son artículos `PACKAGING` independientes.

## Decisión

El rendimiento final se registra únicamente para un lote `COMPLETED`. Production calcula con Decimal cantidad planificada, cantidad real, diferencia, porcentaje de rendimiento, merma y porcentaje de merma. Persiste el resultado, actor, instante UTC, observaciones, motivo y una operación UUID antes de llamar a Inventory. Solo cambia el resultado a `CONFIRMED` cuando Inventory confirma la entrada `PRODUCTION_IN` del producto terminado a granel.

El envasado exige rendimiento confirmado. Cada operación declara explícitamente unidades obtenidas, cantidad de producto a granel por unidad y materiales totales. Inventory verifica que el contenido explícito coincida dimensionalmente con la capacidad nominal del producto vendible; `FLUID_OUNCE` solo se convierte a mililitros mediante la equivalencia exacta del catálogo y nunca a gramos. El recipiente no determina el contenido neto.

En una transacción local Serializable, Inventory bloquea todos los artículos en orden y registra la salida `PRODUCTION_OUT` del granel, una salida `PACKAGING_OUT` por material, la entrada `PACKAGED_PRODUCT_IN` de las unidades vendibles, los saldos y una `ProductionStockOperation` con solicitud y resultado.

Production reutiliza ADR-010: operación persistida, UUID estable, solicitud idempotente, resultado persistido y confirmación local. Mismo UUID y payload devuelve el mismo resultado; payload distinto se rechaza. Una respuesta perdida se recupera con el mismo UUID. Los registros confirmados no se editan ni eliminan; una corrección futura deberá ser compensatoria.

## Estados e invariantes

- Rendimiento y envasado: `PENDING → CONFIRMED | REJECTED`.
- Solo existe un rendimiento pendiente o confirmado por lote; un rechazo queda auditado y permite corregir.
- El envasado pendiente o confirmado no supera el rendimiento del lote.
- Una operación pendiente bloquea transiciones incompatibles.
- Inventory nunca permite saldo negativo y serializa operaciones concurrentes del mismo lote.
- Production no consulta la base de Inventory ni comparte su cliente Prisma.

## Consecuencias y límites

Existe consistencia eventual entre bases, no atomicidad distribuida. La UI muestra pendientes y permite reconciliar. El saldo a granel se agrega por artículo en Inventory; Production conserva la asignación por lote. No se agregan precios, costos, ventas, pagos ni una entidad Presentation.
