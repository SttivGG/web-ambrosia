# Proveedores (Fase 2B)

El directorio está en /inventario/proveedores. Usa la sesión existente y los permisos inventory.read e inventory.write. OWNER, ADMIN y OPERATOR pueden escribir; VIEWER puede consultar el detalle completo. Swagger conserva su política OWNER/ADMIN.

## Datos y normalización

El código interno admite entre 3 y 40 caracteres ASCII: letras, números, guion y guion bajo; comienza con letra o número. Se recortan espacios exteriores y se convierte a mayúsculas. No cambia después del alta y sigue reservado al archivar.

El nombre requiere entre 2 y 160 caracteres. Nombre comercial: 160; persona de contacto: 120; correo: 254 y formato de correo; teléfono: 40; dirección: 240; municipio y departamento: 100; notas: 2000. Los textos se recortan. Opcionales vacíos se guardan como null; campos omitidos en PATCH se conservan. Se rechazan campos desconocidos.

Identificación opcional: tipo y número juntos o ambos ausentes. Tipos de transporte: NIT, CC, CE, PASSPORT y OTHER. Número: hasta 40 caracteres ASCII alfanuméricos, espacios, puntos y guiones. El valor visible conserva puntuación y letras. Para comparar se eliminan espacios ASCII, puntos y guiones y se usan mayúsculas. No se convierte a número: se conservan ceros iniciales y todos los dígitos, incluido el verificador. Así, 001.234-5 equivale a 0012345 y difiere de 12345 y 0012346. Puntuación y mayúsculas se consideran presentación para todos los tipos. No se consulta un registro externo ni se verifica oficialmente identidad o NIT.

La pareja tipo/número normalizado es única, incluso archivada. Corregir la identificación libera la anterior y reserva la vigente. No existe DELETE en la API.

## API v1

Nginx publica /api/inventory/suppliers y traduce a /api/v1/suppliers.

| Método | Sufijo       | Comportamiento                         |
| ------ | ------------ | -------------------------------------- |
| GET    | /            | Listado y conteo consistente           |
| GET    | /:id         | Todos los campos y artículos asociados |
| POST   | /            | Alta; code y name obligatorios         |
| PATCH  | /:id         | Edición parcial con expectedVersion    |
| POST   | /:id/archive | Archivado con expectedVersion          |
| POST   | /:id/restore | Restauración con expectedVersion       |

Filtros: search (código, nombre, nombre comercial e identificación normalizada), active=true/false, itemId. Paginación: page desde 1, pageSize de 1 a 100 (20 predeterminado). sortBy: name, code, createdAt o updatedAt; sortOrder asc/desc. El desempate usa UUID ascendente. La búsqueda usa contains y la paginación desplazamiento; revisar rendimiento si crece el directorio.

itemIds es una lista de hasta 500 UUID únicos. En PATCH, omitirla conserva las asociaciones; [] las elimina; una lista reemplaza la selección. Solo se agregan artículos activos. Un artículo archivado después de asociarse sigue visible y puede conservarse o quitarse. El selector busca y pagina de diez en diez, sin descargar todo el catálogo. El filtro por artículo también permite artículos archivados.

Las mutaciones por cookie exigen CSRF y origen autorizado. No hay reintentos automáticos de mutaciones. Errores estables: VALIDATION_ERROR, SUPPLIER_NOT_FOUND, SUPPLIER_CODE_ALREADY_EXISTS, SUPPLIER_IDENTIFICATION_ALREADY_EXISTS, ITEM_NOT_FOUND, ITEM_ARCHIVED, CONCURRENT_MODIFICATION y SUPPLIER_UNAVAILABLE. Los errores de autenticación conservan los códigos existentes.

## Conflictos y operación

expectedVersion protege edición, asociaciones y transiciones. Ante 409, el formulario conserva lo escrito, obtiene el registro actual y compara todos los campos y asociaciones. El usuario elige conservar sus valores o cargar los actuales antes de guardar. Esa decisión no envía una mutación por sí sola. Otro cambio posterior puede producir un nuevo conflicto.

Fechas almacenadas y transportadas en UTC; presentación en America/Bogota. El directorio no contiene importes, condiciones comerciales, compras ni existencias.

Antes de migrar una base local con datos:

```sh
node scripts/prepare-suppliers.mjs --migrate
```

El comando exige Docker local y PostgreSQL ya iniciado. Usa pg_dump con inventory_user y la contraseña configurada dentro del contenedor, sin imprimirla. Guarda un dump exclusivo en artifacts/backups, valida su índice y decodifica el archivo completo. Ensaya instalación limpia y actualización desde 2A con datos en dos esquemas aislados de Inventory, repite migrate deploy y elimina únicamente esos esquemas. Solo después aplica la migración al esquema operativo y compara categorías y artículos completos. Un fallo previo detiene la migración operativa. El respaldo incluye datos privados; artifacts permanece ignorado por Git.

Sin --migrate solo genera y verifica el respaldo. Evidencia: artifacts/suppliers-migration.json. Para verificar el stack ya actualizado:

```sh
node scripts/verify-suppliers.mjs
npx --yes pnpm@10.34.5 test:stack
```

Las suites deben ejecutarse secuencialmente. Proveedores crea fixtures F2B con sufijo aleatorio y usuarios fase2b dentro de Identity mediante su cliente propio. Limpia asociaciones antes de proveedores, artículos y categorías. Una prueba instala temporalmente un trigger limitado a un UUID de fixture para verificar rollback después de una escritura; lo elimina en finally. Los informes y capturas quedan en artifacts. Revisar el informe si una ejecución se interrumpe antes de finalizar.
