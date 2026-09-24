# Compras e inventario — Fase 3

Compras, existencias y movimientos pertenecen exclusivamente a Inventory. El catálogo y los proveedores existentes se reutilizan.

## Operación

1. Asociar artículos activos al proveedor desde Proveedores.
2. Crear una compra en /inventario/compras: proveedor, referencia, fecha de Bogotá y al menos una línea. Cada cantidad usa la unidad base del catálogo.
3. Guardar borrador. No cambia existencias. Puede editarse con su versión vigente.
4. Confirmar recepción. El servidor registra una entrada por línea y actualiza saldos en una sola transacción.
5. Consultar /inventario/existencias y abrir Ver historial para revisar los movimientos.
6. Un ajuste manual exige inventory.write, cantidad positiva, tipo, motivo y confirmación.

No se modifican saldos directamente ni se eliminan movimientos. Cancelar un borrador no mueve inventario. Revertir una compra recibida registra salidas compensatorias; conserva entradas y compra. Si algún saldo es insuficiente, toda la reversión falla.

## API v1

El gateway traduce /api/inventory/ a /api/v1/ en Inventory.

| Método     | Ruta interna                  | Permiso                                         |
| ---------- | ----------------------------- | ----------------------------------------------- |
| GET, POST  | /api/v1/purchases             | purchases.read, purchases.write respectivamente |
| GET, PATCH | /api/v1/purchases/:id         | purchases.read, purchases.write respectivamente |
| POST       | /api/v1/purchases/:id/receive | purchases.write                                 |
| POST       | /api/v1/purchases/:id/cancel  | purchases.write                                 |
| GET        | /api/v1/inventory/stocks      | inventory.read                                  |
| GET        | /api/v1/inventory/stocks/:id  | inventory.read                                  |
| GET        | /api/v1/inventory/movements   | inventory.read                                  |
| POST       | /api/v1/inventory/adjustments | inventory.write                                 |

PATCH reemplaza los campos editables completos y exige expectedVersion. Recibir exige expectedVersion; cancelar además reason (3–500 caracteres). Ajustar exige operationId UUID, itemId, type (ADJUSTMENT_IN/ADJUSTMENT_OUT), quantity y reason. El UUID se conserva al reintentar una operación ambigua.

Compras filtra supplierId, status, reference, from y to. Movimientos filtra itemId, type, origin (PURCHASE/MANUAL), from y to. Existencias filtra search y categoryId. Fechas de API son UTC; todos los listados aceptan page y pageSize (máximo 100, predeterminado 20), con orden estable y conteo en RepeatableRead.

Contratos compartidos: packages/contracts/src/purchase-v1.ts. Swagger deriva sus cuerpos y respuestas de esos schemas. Swagger permanece protegido detrás del gateway; las mutaciones con cookie requieren CSRF y origen autorizado.

## Importes y límites

COP exclusivamente. Cantidades como texto hasta 14 enteros y 10 decimales. Costos/importes como texto hasta 22 enteros y 2 decimales. Decimal de precisión 80 calcula cada subtotal con HALF_UP a dos decimales; el total suma los subtotales redondeados. No se aceptan totales del cliente ni exponentes. Se permiten costos cero. Hasta 50 artículos distintos por compra, compatible con el límite de 16 KiB del gateway.

No hay impuestos, pagos, recepción parcial, conversiones de unidad, producción, eventos NATS ni Outbox. No se permite modificar unidad base o seguimiento del artículo después de generar historial. Archivar un artículo conserva saldo y movimientos, que siguen visibles.

## Conflictos

Versiones obsoletas, carreras serializables, recepción repetida, referencia repetida y operación de ajuste repetida devuelven 409. El cliente conserva lo escrito; ante edición concurrente consulta el documento actual y permite comparar y adoptar su versión explícitamente antes de guardar otra vez.

No se reintentan automáticamente mutaciones de inventario. Ante fallo de red, consultar el estado. La restricción única por detalle/tipo y el estado versionado impiden doble recepción. El ajuste usa un operationId único. Todas las salidas, incluidas reversiones, rechazan stock negativo.

## Migración y respaldo local

Comando: node scripts/prepare-purchases.mjs --migrate. Solo admite Docker local. Inspecciona PostgreSQL activo, crea un pg_dump completo de Inventory en artifacts/backups, comprueba listado y decodificación con pg_restore y registra SHA-256. Guarda una instantánea completa de Category, CatalogItem, Supplier y SupplierItem.

Construye inventory-migrate y ejecuta prepare-purchases-isolated.mjs en esquemas aleatorios: instalación limpia, actualización 2B, deploy repetido y pruebas transaccionales/concurrentes. Elimina únicamente esos esquemas de prueba en finally. Si falla, no aplica la migración a public.

Después ejecuta migrate deploy dos veces y exige igualdad exacta de la instantánea original. El informe es artifacts/purchases-migration.json. No usar migrate reset, db push ni eliminar volúmenes. El respaldo contiene datos del negocio, permanece ignorado por Git y no debe publicarse.

## Pruebas

node scripts/verify-purchases.mjs requiere el stack local actualizado y Chromium. Ejecuta PostgreSQL aislado y API/Playwright reales por Nginx; crea fixtures identificados por un prefijo aleatorio y usuarios temporales dentro de sus respectivos servicios. Limpia únicamente esos datos en finally. Forma parte de pnpm test:stack. No ejecutar suites del stack simultáneamente ni contra producción.

Los resultados reales y cualquier limitación pendiente se registran en validation.md. La decisión de arquitectura está en ADR-009.
