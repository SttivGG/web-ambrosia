# ADR-010 — Producción y coordinación recuperable con Inventory

**Estado:** aceptada e implementada en Fase 4; validación completada el 2026-09-24.

## Contexto

Producción posee fórmulas, lotes y operaciones en ambrosia_production. Inventory conserva catálogo, existencias y ledger en ambrosia_inventory. ADR-002 prohíbe compartir clientes, consultar bases ajenas y usar transacciones distribuidas.

## Problema

Un fallo después del consumo pero antes de confirmar el lote no debe duplicar salidas ni afirmar que la producción inició sin confirmación.

## Decisión

Dentro de Inventory, existencias y ledger se actualizan atómicamente en la misma transacción. Production e Inventory se coordinan mediante una operación persistente e idempotente, respetando database-per-service. No existe atomicidad global ni se emplean 2PC o XA.

Production persiste la solicitud y un UUID antes de contactar Inventory. El lote permanece DRAFT mientras su consumo está pendiente; se bloquean ediciones y otras transiciones. Inventory conserva el UUID, el contenido de la solicitud y su resultado en la misma transacción serializable que todos los movimientos y saldos. Un duplicado idéntico devuelve el resultado persistido; reutilizar el UUID con otro contenido se rechaza. Se bloquean artículos en orden determinista y nunca se permiten saldos negativos.

Production solo cambia a IN_PROGRESS tras confirmar el resultado. Un proceso periódico recupera operaciones pendientes después de reinicios; también existe reconciliación explícita. Los errores de transporte y conflictos serializables conservan el UUID y permiten reintento. Los rechazos definitivos se persisten en Inventory y liberan el borrador al reconciliar. No se conservan JWT ni cookies para recuperación.

La cancelación de un lote iniciado crea otra operación persistente. Inventory registra movimientos inversos, enlazados al consumo y a sus movimientos originales, de forma atómica e idempotente. El lote no pasa a CANCELLED hasta confirmar la compensación. Un lote completado no se cancela. No se borran movimientos históricos.

HTTP interno autenticado conecta los adaptadores locales; solo se comparten contratos versionados. La credencial técnica tiene alcance exclusivo en las operaciones de producción de Inventory; no concede acceso a otras APIs. Las rutas internas no se publican en el gateway. Las rutas de usuario conservan JWT, permisos y CSRF.

Las fórmulas conservan revisiones inmutables. El lote guarda una instantánea de fórmula e insumos calculados con Decimal y unidades base, sin conversiones implícitas. Completar registra únicamente el resultado lógico y la cantidad planificada; no registra entrada de producto terminado, rendimiento real, mermas ni envasado (Fase 5).

## Alternativas consideradas

Una transacción global contradice ADR-002. Compartir tablas o clientes vulnera propiedad y aislamiento. Reintentar con UUID nuevo duplica consumo. Una compensación no equivale a rollback global: es un nuevo hecho auditable.

## Consecuencias positivas

Se conserva el aislamiento, la atomicidad local, la trazabilidad y la recuperación ante respuestas perdidas y reinicios.

## Trade-offs

Hay consistencia eventual: temporalmente Inventory puede haber consumido mientras Production sigue pendiente. La interfaz debe mostrar esa incertidumbre y permitir reconciliar. La recuperación requiere disponibilidad posterior de ambos servicios, una credencial técnica y supervisión de operaciones pendientes. No se promete entrega exactamente una vez; la persistencia e idempotencia garantizan efectos únicos.
