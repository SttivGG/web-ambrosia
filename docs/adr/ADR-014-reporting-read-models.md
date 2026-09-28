# ADR-014 — Arquitectura de Reporting y Read Models

**Estado:** aceptada e implementada en Fases 8A y 8B.

## Contexto

Inventory es autoridad del catálogo, existencias, ledger y valoración; Production es autoridad de lotes, rendimiento y envasado; Finance es autoridad de ventas, COGS e ingresos históricos. Las consultas de informes necesitan combinar esas perspectivas sin violar database-per-service ni convertir Reporting en una nueva autoridad operacional.

## Decisión

'finance-reporting-service' conserva Finance y añade un módulo lógico 'reporting/' con proyecciones propias: artículos de inventario, movimientos para Kardex, líneas de compra, lotes de producción, operaciones de envasado y líneas de venta con margen. Son datos derivados, reconstruibles y nunca se escriben de vuelta a los dominios origen. Las vistas de proveedores se agregan desde líneas de compra sin crear una autoridad paralela.

Los dominios publican snapshots versionados en 'inventory.reporting.v1', 'production.reporting.v1' y 'finance.reporting.v1'. Un publicador repetible recorre únicamente la base propia de cada servicio y vuelve a emitir snapshots con 'eventId' determinista. La publicación es posterior e independiente de las transacciones operativas: una indisponibilidad de NATS o Reporting se registra y se reintenta, pero nunca invalida una compra, movimiento, lote o venta ya confirmados.

JetStream mantiene el stream 'AMBROSIA_REPORTING' con almacenamiento de archivos y un consumidor durable 'finance-reporting-v1'. Reporting confirma el mensaje después de su transacción local. 'ReportProcessedEvent.eventId' es único y cada read model también conserva 'sourceEntityId', 'sourceVersion', 'operationId', 'eventId', 'occurredAt' y 'processedAt'. Una versión menor, o la misma versión con un instante no posterior, se registra como procesada pero no reemplaza la proyección vigente. La entrega es al menos una vez; los efectos son idempotentes.

Los importes y cantidades viajan como strings Decimal y se persisten como 'NUMERIC'. Reporting no usa 'number' para cálculos monetarios. Inventory emite costo unitario, costo total, promedio y valor ya congelados. Production emite los costos confirmados que conserva. Finance emite COGS y margen por línea desde sus snapshots históricos. Reporting no consulta costos actuales para reinterpretar hechos anteriores. 'UNVALUED' exige costo promedio y valor nulos; los movimientos históricos anteriores a 8A pueden declarar 'balanceAfter: null', distinto de cero.

## Reconciliación y reconstrucción

Inventory expone una API interna paginada y autenticada con la credencial técnica Finance–Inventory. Production expone otra API interna con una credencial Reporting–Production independiente. Ninguna ruta se publica en Nginx; ambas rechazan cookies y entregan contratos v1, no modelos Prisma. Reporting puede reaplicar todos los snapshots; repetir la reconciliación no duplica filas.

La reconstrucción administrativa elimina únicamente 'ReportInventoryItem', 'ReportInventoryMovement' y sus marcadores de eventos de Inventory, y luego consume de nuevo la API autoritativa. No modifica tablas ni operaciones de Inventory. Las rutas de reconciliación y reconstrucción requieren 'reports.manage'.

## API, tiempo y permisos

Las listas usan 'page' y 'pageSize', con máximo 100, y rangos UTC semiabiertos '[from, to)'. La persistencia permanece normalizada en UTC. La futura agrupación por día, semana o mes deberá convertir límites desde 'America/Bogota' a instantes UTC una sola vez antes de consultar; 8A no implementa agrupaciones.

'reports.read' habilita cantidades y hechos de todos los reportes operativos y health de Reporting. Los endpoints operativos inspeccionan además 'reports.finance' y sustituyen por null costos, valores y subtotales si el claim no está presente; márgenes continúan exigiendo ambos permisos. 'reports.manage' protege reconciliación y reconstrucción y se asigna inicialmente a OWNER y ADMIN. 'reports.export' queda reservado exclusivamente para futuras exportaciones; 8A no genera PDF, XLSX ni CSV.

## Consecuencias

La lectura queda desacoplada y optimizada, a cambio de consistencia eventual y almacenamiento duplicado. Los snapshots repetibles recuperan publicaciones perdidas y JetStream conserva mensajes durante caídas del consumidor. La reconciliación de Inventory cubre recuperación explícita y reconstrucción; reconciliadores autoritativos equivalentes para Production y Finance no forman parte de 8A.

No hay joins entre bases, clientes Prisma compartidos, 2PC, XA ni transacciones distribuidas. Reporting no cambia el modelo de costeo de ADR-013 ni se convierte en fuente de verdad.
