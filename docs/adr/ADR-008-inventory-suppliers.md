# ADR-008: Directorio de proveedores

Estado: aceptado para implementación de Fase 2B; cierre operativo registrado en validation.md.

## Propiedad

Supplier y SupplierItem pertenecen a Inventory y ambrosia_inventory. La migración 202609190001_suppliers agrega tablas, índices, claves foráneas restrictivas y checks. Las migraciones anteriores permanecen intactas. Contracts comparte transporte v1 y normalización estructural de identificación; no expone persistencia ni repositorios.

Se reutilizan JWT/JWKS, guards, CSRF, cliente autenticado y permisos. No hay nuevos servicios, puertos, dependencias ni eventos NATS. HTTP registra método, ruta y resultado; el módulo no registra cuerpos, contactos, notas o identificaciones.

## Identificación

Código inmutable y único, reservado también al archivar. La identificación es opcional como pareja y única por tipo/número normalizado. Se conservan ceros y todos los dígitos; únicamente se ignoran espacios ASCII, puntos, guiones y diferencias de mayúsculas. Esto permite comparar presentaciones comunes sin interpretar números como enteros ni quitar verificadores. Los detalles y límites están en [suppliers.md](../suppliers.md). El formato no acredita identidad oficial.

## Transacciones y carreras

Las escrituras usan Serializable, leen la versión y actualizan por id más expectedVersion. Cada edición incrementa version, incluso si solo cambian asociaciones. El reemplazo de asociaciones y el proveedor se confirman juntos. Una excepción revierte toda la transacción. Los listados usan RepeatableRead para que filas, asociaciones y conteo pertenezcan a la misma instantánea.

Al agregar artículos, Inventory bloquea sus filas con SELECT FOR SHARE, ordenadas por UUID, y exige que estén activos. El UPDATE existente de catálogo coordina con ese bloqueo: si el archivado gana, la asociación observa el estado archivado o recibe un aborto serializable; si la asociación gana, el artículo puede archivarse después y la relación se conserva. No se modifica catálogo para imponer una condición permanente de actividad.

Los conflictos de versión, abortos serializables y deadlocks se traducen a 409. No hay reintentos automáticos. Archivar/restaurar un proveedor en el estado pedido es idempotente con versión vigente; una versión obsoleta siempre falla.

La transacción garantiza consistencia de esa operación dentro de Inventory. No bloquea ediciones después del commit, no ofrece una instantánea permanente entre páginas y no coordina otros servicios. Las escrituras de negocio deben pasar por Inventory; los checks SQL no implementan por sí solos la regla temporal de agregar solo artículos activos.

## Interfaz y límites

El detalle completo está disponible para consulta. Los permisos controlan los formularios y también la API. El selector consulta páginas de diez artículos y conserva selección fuera de la página actual. Un conflicto muestra campos y asociaciones actuales junto al formulario; una decisión explícita adopta la versión y un segundo envío guarda.

Hasta 500 asociaciones por proveedor; las listas devuelven sus resúmenes para mostrar artículos archivados sin solicitudes individuales. Búsqueda contains y paginación por desplazamiento son suficientes para el directorio inicial; no se introduce un motor de búsqueda. No hay borrado físico, precios, compras, cuentas bancarias, existencias ni Outbox.
