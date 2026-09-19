# Catálogo — Fase 2A

Abrir [el catálogo local](http://localhost:8080/inventario/catalogo) después de iniciar el stack. Inventario → Catálogo permite consultar artículos y administrar categorías. OWNER, ADMIN y OPERATOR pueden crear, editar, archivar y restaurar; VIEWER consulta, busca, filtra y pagina. Sin inventory.read, el panel dirige a /forbidden.

## Puesta en marcha

```sh
npx --yes pnpm@10.34.5 install --frozen-lockfile
npx --yes pnpm@10.34.5 stack:up
```

inventory-migrate aplica la migración versionada 202609170001_catalog tanto sobre la base existente de Fase 1 como en una instalación nueva. No usa db push ni borra datos. Prisma genera el cliente exclusivo de Inventory durante build. No se agregan variables de entorno ni dependencias externas.

Para repetir solamente las migraciones:

```sh
docker compose --env-file .env -f infrastructure/docker-compose.yml run --rm inventory-migrate
```

Para cargar **opcionalmente** seis categorías iniciales:

```sh
npx --yes pnpm@10.34.5 inventory:seed-catalog
```

Crea Leche y cultivos, Ingredientes, Empaques, Productos terminados, Subproductos y Suministros. Puede repetirse: conserva categorías existentes, incluidas las archivadas o personalizadas, y no crea artículos. No se ejecuta al arrancar ni automáticamente en producción. El comando usa el contenedor Inventory y su propia conexión.

## Rutas y contratos

Prefijo público: **/api/inventory/catalog**. Prefijo interno: **/api/v1/catalog**.

| Método | Ruta relativa                                    | Permiso         |
| ------ | ------------------------------------------------ | --------------- |
| GET    | /categories, /categories/:id                     | inventory.read  |
| POST   | /categories                                      | inventory.write |
| PATCH  | /categories/:id                                  | inventory.write |
| POST   | /categories/:id/archive, /categories/:id/restore | inventory.write |
| GET    | /items, /items/:id                               | inventory.read  |
| POST   | /items                                           | inventory.write |
| PATCH  | /items/:id                                       | inventory.write |
| POST   | /items/:id/archive, /items/:id/restore           | inventory.write |

No existe DELETE. PATCH y transiciones reciben expectedVersion. Crear devuelve 201; lecturas, edición y transiciones devuelven 200. No encontrado: 404; entrada inválida: 400; duplicados, reglas de archivado y versión obsoleta: 409; anónimo: 401; permiso o CSRF: 403.

Contratos: packages/contracts/src/catalog-v1.ts. No incluyen modelos Prisma ni campos normalizados internos. Swagger documenta cuerpos, enums, decimales, filtros, respuestas y errores en /api/inventory/docs/. Conserva cookies/Bearer como alternativas y acceso exclusivo OWNER/ADMIN.

Listados: page (desde 1), pageSize (20 por defecto, máximo 100), search, active, sortBy y sortOrder. Artículos agregan itemType, categoryId e inventoryBaseUnit; la búsqueda incluye nombre, SKU y barcode, sin distinguir mayúsculas. Las claves de orden son name, createdAt y updatedAt; artículos agregan sku e itemType. Se ordena también por id. Las respuestas contienen data y pagination con page, pageSize, totalItems y totalPages.

## Uso de unidades

| Artículo           | Tipo             | Base       | Operación | Presentación opcional |
| ------------------ | ---------------- | ---------- | --------- | --------------------- |
| Leche              | RAW_MATERIAL     | MILLILITER | LITER     | —                     |
| Azúcar             | RAW_MATERIAL     | GRAM       | KILOGRAM  | —                     |
| Recipiente de 4 oz | PACKAGING        | UNIT       | UNIT      | "4" / FLUID_OUNCE     |
| Recipiente de 8 oz | PACKAGING        | UNIT       | UNIT      | "8" / FLUID_OUNCE     |
| Tapa               | PACKAGING        | UNIT       | UNIT      | —                     |
| Yogurt empacado    | FINISHED_PRODUCT | UNIT       | UNIT      | "4" / FLUID_OUNCE     |
| Suero              | BYPRODUCT        | MILLILITER | LITER     | —                     |

Son ejemplos de documentación; no se insertan como datos de producción. Una onza fluida equivale a 29.5735295625 mililitros. Capacidad nominal no equivale a peso neto: ese dato corresponderá a producción/envasado. No se convierte masa a volumen. Los números decimales se envían como strings con punto decimal.

## Edición y conflictos

El formulario normaliza visualmente el SKU y lo conserva después de crear. Las unidades dependen del tipo; los empaques fuerzan UNIT. Los campos numéricos usan texto para no perder precisión. Un envío bloquea otro hasta terminar.

Si otra persona editó el registro, se muestra el conflicto sin borrar el formulario. Consultar versión actual permite comparar los valores guardados. Conservar mis datos y usar esta versión es una decisión explícita; todavía requiere pulsar Guardar. Cancelar o Escape pide confirmar antes de descartar un formulario.

El archivado siempre exige confirmación. Los registros se mantienen, incluyendo SKU/barcode únicos. Las categorías con artículos activos no se archivan. La vista móvil presenta cada fila como tarjeta; los diálogos nativos administran foco y teclado. La interfaz muestra estados de carga, error y vacío sin inventar existencias.

## Verificación y límites

```sh
node scripts/verify-catalog.mjs
npx --yes pnpm@10.34.5 test:stack
```

La verificación de catálogo usa PostgreSQL y Chromium reales por Nginx, con usuarios y registros temporales de prefijo aleatorio. La migración limpia se prueba en un esquema aislado de ambrosia_inventory con su propia cuenta. La limpieza directa de fixtures está limitada al script de pruebas; no es una operación de la API. No ejecutar contra producción ni simultáneamente con otras suites del stack.

La evidencia real queda en artifacts/catalog-verification.json y capturas catalog-*.png. Los resultados de cierre están en [validation.md](validation.md). Véase [ADR-007](adr/ADR-007-inventory-catalog.md) para transacciones, precisión y eventos reservados para Outbox.

## Categorías y capacidad en el formulario

Si no hay categorías activas, el panel explica cómo crear o restaurar una y deshabilita Nuevo artículo hasta que haya una disponible. El botón Crear categoría permite registrar la primera desde la vista de artículos. Durante la carga o si falla la consulta, tampoco se abre un formulario con un selector vacío.

La capacidad se presenta como «Capacidad del envase (opcional)» y «Unidad de esa capacidad». Por ejemplo: 4 y Onza fluida para un recipiente de 4 onzas; 1 y Litro para una botella de 1 litro. Para leche a granel, tapas o etiquetas, dejar el valor vacío y seleccionar No aplica. No representa existencias ni el peso real del contenido.
