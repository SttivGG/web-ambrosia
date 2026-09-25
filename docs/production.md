# Producción — Fase 4

## Propiedad y garantías

Production conserva fórmulas, revisiones, lotes y operaciones en su propia base. Inventory es la única autoridad sobre saldos y movimientos. No hay consultas cruzadas, Prisma compartido, 2PC, XA ni transacciones distribuidas. Ver [ADR-010](adr/ADR-010-production-coordination.md).

Dentro de Inventory, existencias y ledger se actualizan atómicamente en la misma transacción. Production e Inventory se coordinan mediante una operación persistente e idempotente, respetando database-per-service. Esta garantía sustituye el requisito original de una transacción global, según la decisión explícita del usuario.

## Operación

1. Crear una fórmula en /produccion/formulas. Seleccionar un producto terminado y sus insumos activos. Las cantidades expresan insumos por una unidad base del producto: gramos, mililitros o unidades. No se realizan conversiones implícitas.
2. Crear un lote en /produccion/lotes, con fórmula, cantidad planificada, fecha de Bogotá y observaciones. Guardar no consume inventario.
3. Iniciar persiste primero una operación de consumo. El lote permanece DRAFT mientras se confirma Inventory; no permite ediciones ni otra transición durante esa espera.
4. Inventory bloquea insumos en orden determinista y valida todos los saldos. Inserta operación, movimientos y actualizaciones de saldo dentro de una transacción Serializable. Un rechazo de negocio también queda registrado, sin movimientos.
5. Production confirma IN_PROGRESS solamente después de recibir el resultado persistido de Inventory. Una respuesta perdida conserva el UUID original.
6. Completar registra el cierre lógico y su fecha. La cantidad planificada es el único resultado cuantitativo de esta fase: no es una medición de rendimiento real ni una entrada de producto terminado en existencias.
7. Cancelar un borrador no genera movimientos. Cancelar un lote iniciado solicita una compensación explícita e idempotente; permanece IN_PROGRESS hasta confirmarla. Un lote COMPLETED no puede cancelarse.

No incluye rendimiento, mermas, envases, presentaciones, unidades empacadas ni Fase 5. No existe borrado de fórmulas, lotes u operaciones por API.

## Versiones e historial

Editar una fórmula crea una revisión inmutable, incluso al activarla o desactivarla. Cada lote referencia una revisión y guarda los insumos calculados. Editar un borrador adopta la revisión vigente de la fórmula seleccionada; no reinterpreta producciones iniciadas. Decimal de precisión 80 calcula cantidades, almacenadas como NUMERIC(24,10) y transportadas como texto. Se rechazan desbordamientos y más de diez decimales, sin redondeo silencioso.

Las ediciones y transiciones requieren expectedVersion. Un conflicto conserva los campos del formulario y ofrece comparar/adoptar la versión vigente. Los UUID de operación no se generan en el navegador.

## Recuperación y compensación

ProductionOperation separa PENDING, CONFIRMED y REJECTED de los estados del lote. El payload persistido contiene UUID, lote, actor, tipo, insumos y motivo; no contiene cookies ni tokens de usuario. Al arrancar y cada 15 segundos se recuperan hasta 20 operaciones pendientes. Los fallos se rotan para no bloquear otros lotes. El botón Reconciliar permite intentar de inmediato con la misma solicitud.

Inventory compara el payload normalizado al reutilizar un UUID. Una solicitud idéntica devuelve el mismo resultado y los mismos IDs de movimiento. Un contenido distinto produce conflicto. Una restricción única adicional impide confirmar dos consumos para el mismo lote aunque se enviaran UUID distintos. Los abortos serializables y fallos técnicos no se consideran rechazo de negocio: Production mantiene la operación pendiente.

La compensación usa su propio UUID persistente y referencia el consumo original. Cada entrada PRODUCTION_RETURN enlaza el movimiento PRODUCTION_OUT mediante reversesId. Todos los movimientos inversos y saldos se confirman juntos; no se borran salidas. Un rechazo definitivo libera la transición para una nueva tentativa explícita, conservando el historial de intentos.

La consistencia entre servicios es eventual. Ante indisponibilidad persistente, revisar salud de ambos servicios, configuración técnica y operaciones pendientes en el detalle; restaurar conectividad y reconciliar. No crear manualmente otro consumo ni cambiar saldos para resolver una respuesta perdida.

## API y permisos

El gateway agrega /api/production a las rutas siguientes; internamente se usa /api/v1.

| Método      | Ruta relativa                   | Permiso                            |
| ----------- | ------------------------------- | ---------------------------------- |
| GET / POST  | production/formulas             | production.read / production.write |
| GET / PATCH | production/formulas/:id         | production.read / production.write |
| GET / POST  | production/orders               | production.read / production.write |
| GET / PATCH | production/orders/:id           | production.read / production.write |
| POST        | production/orders/:id/start     | production.write                   |
| POST        | production/orders/:id/complete  | production.write                   |
| POST        | production/orders/:id/cancel    | production.write                   |
| POST        | production/orders/:id/reconcile | production.write                   |

Listados: page, pageSize (máximo 100), search; lotes aceptan status y fórmulas active. Orden estable y lecturas RepeatableRead. Swagger deriva contratos v1 e incluye errores. OWNER/ADMIN/OPERATOR escriben; VIEWER consulta. Los permisos ya existían; no se modifica JWT/JWKS ni el mapa RBAC. Cookies requieren CSRF y origen válido.

Inventory ofrece /api/v1/internal/production/{operations,operations/:id,items/:id} exclusivamente para el adaptador técnico. Exige PRODUCTION_INVENTORY_TOKEN, rechaza cookies y el gateway bloquea esas rutas, incluidas rutas con prefijo api/v1. El secreto no permite usar otras APIs. No se exponen endpoints internos en Swagger.

## Configuración y migración

Ejecutar node scripts/generate-production-key.mjs para crear secrets/production.local.env, ignorado por Git. No imprime ni reemplaza una clave existente. Inventory y Production reciben solamente esta credencial técnica; no reciben claves privadas de Identity. INVENTORY_INTERNAL_URL apunta a http://inventory-service:3001 dentro del stack. En desarrollo usa loopback; ajustar al puerto de Inventory si cambia.

Para un entorno externo, suministrar la credencial mediante el gestor de secretos y proteger el transporte interno de acuerdo con su red. La configuración local conserva la red privada de Compose y solo publica gateway:8080. Rotar coordinadamente ambos servicios; los IDs persistidos permiten recuperar operaciones después de la rotación.

Antes de actualizar datos locales: node scripts/prepare-production.mjs --migrate. Respalda Inventory y Production con pg_dump, verifica listado y decodificación de ambos dumps, ensaya instalación limpia y actualización desde Fase 3 en esquemas aislados, ejecuta pruebas PostgreSQL de concurrencia y rollback, aplica deploy dos veces y compara todas las columnas preexistentes de todas las tablas de negocio. No modifica migraciones históricas ni borra volúmenes. production-migrate es un job temporal; se conservan ocho contenedores permanentes.

Inventory agrega los tipos PRODUCTION_OUT/PRODUCTION_RETURN y ProductionStockOperation, con vínculo opcional desde movimientos y ampliación de su check de origen conservando combinaciones históricas. Production agrega Formula, FormulaRevision, ProductionOrder y ProductionOperation. Los checks y únicos parciales protegen estados, cantidades, operación pendiente y consumo confirmado único.

## Pruebas

node scripts/verify-production.mjs ejecuta recuperación contra PostgreSQL y HTTP reales, API y Playwright por gateway; usa fixtures temporales y los elimina al finalizar. Está integrado en test:stack. No ejecutar suites de stack simultáneamente ni contra producción.

El ensayo transaccional independiente usa scripts/verify-production-isolated.mjs dentro del migrador correspondiente. scripts/verify-production-recovery.mjs inyecta fallos antes del consumo, pérdida de respuesta y un trigger PostgreSQL en Production después del commit de Inventory. Un nuevo coordinador recupera el mismo UUID; también prueba compensación con respuesta perdida.

Evidencias locales ignoradas por Git: artifacts/production-migration.json, artifacts/production-verification.json, artifacts/phase4 y respaldos en artifacts/backups. El estado de cierre y comandos efectivamente ejecutados se registran en validation.md.
