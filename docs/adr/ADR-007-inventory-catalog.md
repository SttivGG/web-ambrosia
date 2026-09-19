# ADR-007 — Catálogo interno de inventario

Estado: aceptado para Fase 2A.

## Propiedad y alcance

Inventory es propietario de Category y CatalogItem, de sus reglas y de su cliente Prisma. Las tablas viven en ambrosia_inventory. Ningún otro servicio consulta esa base. Contracts expone solamente transporte v1, enums, filtros y validación estructural; la compatibilidad entre dimensiones y el archivado se deciden dentro de Inventory.

Nginx conserva su configuración: /api/inventory/catalog/* se traduce a /api/v1/catalog/*. No se agregan puertos ni servicios permanentes. Un job inventory-migrate aplica prisma migrate deploy antes del proceso HTTP; los ocho contenedores permanentes se conservan. El job también forma parte de infra:up para desarrollo local.

## Identidad y cantidades

El SKU se normaliza a mayúsculas, se reserva incluso archivado y no se acepta en PATCH. Corregirlo necesitará una decisión explícita posterior; no hay renombrado implícito. El nombre de categoría se compara después de trim, normalización Unicode NFKC y minúsculas. El slug se genera al crear, incluye el UUID y no cambia al editar el nombre: dos nombres distintos que transliteren igual no colisionan.

Unidades base: UNIT, GRAM y MILLILITER. Unidades operativas: UNIT, GRAM, KILOGRAM, MILLILITER y LITER. Las dimensiones deben coincidir. PACKAGING utiliza UNIT; BYPRODUCT permite masa o volumen. FINISHED_PRODUCT puede controlarse por unidades o a granel.

Las cantidades persistidas son NUMERIC(24,10). El contrato acepta strings decimales no negativos, sin exponentes, hasta 14 dígitos enteros y 10 decimales. El backend devuelve strings canónicos sin ceros fraccionarios innecesarios. Rechaza valores fuera de precisión antes de PostgreSQL; no redondea ni convierte con Number/float.

La capacidad nominal necesita valor positivo y unidad, o ambos campos nulos. FLUID_OUNCE es volumen: **1 fluid ounce = 29.5735295625 milliliters**. Esa equivalencia documenta una presentación; no se aplica automáticamente ni permite inferir el peso neto del yogurt. Un recipiente de 4 u 8 oz y un yogurt terminado pueden tener presentación nominal; tapas y etiquetas pueden omitirla. minimumStockBase es un umbral futuro, nunca una existencia actual.

## Concurrencia e integridad

Version inicia en 1. PATCH, archive y restore exigen expectedVersion. Toda escritura comprueba id y version y aumenta version. Un conflicto devuelve 409 CONCURRENT_MODIFICATION. No se reintentan mutaciones automáticamente.

Las mutaciones se ejecutan en transacciones PostgreSQL serializables. Leer la categoría antes de activar un artículo y contar artículos activos antes de archivar una categoría permite que PostgreSQL rechace una carrera que violaría la regla. Un aborto serializable P2034 se presenta como conflicto para que el usuario revise el estado actual. Los listados usan RepeatableRead para mantener consistencia entre filas y conteo y siempre ordenan también por id.

Las categorías no se borran. Archivar con artículos activos devuelve CATEGORY_HAS_ACTIVE_ITEMS. Restaurar una categoría ya activa con su versión vigente devuelve el mismo registro; una versión obsoleta sigue fallando. Las transiciones repetidas de artículos devuelven ITEM_ALREADY_ACTIVE o ITEM_ALREADY_ARCHIVED. Crear/restaurar artículos exige categoría activa. Es posible editar un artículo archivado conservando su categoría archivada; restaurarlo exige restaurar primero la categoría.

PostgreSQL impone unicidad de nombre normalizado, SKU, barcode no nulo y slug, foreign key restrictiva, dimensiones, capacidad positiva, mínimo no negativo y coherencia de estado/archivedAt. Las reglas entre tablas se coordinan en las transacciones del servicio. No se admiten escrituras externas a las tablas de catálogo. Las fechas se almacenan como timestamptz y se transportan en UTC.

## API, permisos y observabilidad

Los guards existentes verifican JWT/JWKS, inventory.read, inventory.write y CSRF. Cookies HttpOnly, refresh y single-flight permanecen en el cliente autenticado existente. Swagger conserva su política OWNER/ADMIN; las mutaciones por cookie requieren X-CSRF-Token y origen permitido. OPERATOR puede modificar catálogo sin poder abrir Swagger; VIEWER solo consulta.

Los errores tienen código estable, mensaje seguro, campos afectados y correlación. P2002 no expone Prisma ni SQL. Los logs de mutaciones incluyen únicamente acción, recurso, subject, correlación y resultado. No se registra el cuerpo, descripciones, JWT ni cookies.

## Eventos y límites

No se publican eventos de catálogo todavía. Antes de que otro servicio dependa de ellos se introducirá Outbox transaccional. Los nombres reservados para esa decisión son:

- catalog.category.created.v1
- catalog.category.updated.v1
- catalog.item.created.v1
- catalog.item.updated.v1
- catalog.item.archived.v1
- catalog.item.restored.v1

No hay proveedores, precios, existencias, movimientos, lotes, compras, producción ni ventas en esta fase. La siguiente fase de catálogo/proveedores deberá respetar estas fronteras.
