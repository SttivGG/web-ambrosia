# Operación de Finanzas — Fase 6

## Alcance

/finanzas administra cuentas de caja/banco, movimientos confirmados, ingresos adicionales, gastos, pagos de compras recibidas y ventas manuales. La moneda es COP; la interfaz presenta fechas en America/Bogota y el transporte conserva UTC.

Los importes son Decimal en texto. Ventas: cantidad entera × precio unitario, subtotal por línea redondeado HALF_UP a dos decimales y total como suma de líneas. El cliente no envía subtotal ni total.

Desde Fase 7, el cliente tampoco envía costo. Inventory congela el promedio vigente por producto y devuelve COGS por línea al confirmar existencias. Finance persiste COGS, margen bruto y porcentaje en la misma confirmación local que el ingreso. Una anulación devuelve el costo histórico mediante Inventory y conserva las instantáneas originales para auditoría.

## Preparación y migración

Generar la credencial técnica local:

    pnpm finance:key:generate

Antes de migrar una instalación con datos:

    pnpm infra:up
    pnpm finance:prepare -- --migrate

El procedimiento crea y verifica respaldos de ambrosia_inventory y ambrosia_finance_reports, ensaya instalación limpia y actualización en schemas aislados, repite prisma migrate deploy, ejecuta concurrencia/idempotencia sobre PostgreSQL y compara todas las filas/columnas existentes. Evidencia: artifacts/phase6-migration.json y artifacts/backups/_-before-phase6-_.dump. No usar db push, editar migraciones históricas ni borrar volúmenes.

Migraciones:

- Inventory 202609260001_sales_inventory: tipos de movimiento, operación idempotente y vínculo de ledger.
- Finance 202609260001_finance: cuentas, movimientos, pagos, ventas, líneas y operaciones.

## Recuperación

- PENDING: Inventory pudo haber aplicado el efecto; no crear otra venta ni cambiar el UUID. El proceso reintenta cada 15 segundos.
- REJECTED: rechazo definitivo; no se crea movimiento financiero.
- CONFIRMED: salida de stock e ingreso financiero confirmados.
- CANCELLATION_PENDING: anulación esperando retorno de stock.
- CANCELLED: retorno y devolución financiera confirmados; los hechos originales permanecen.

Usar **Reconciliar ahora** en la venta pendiente. Reiniciar Finance es seguro: la operación y payload están persistidos. Rotar FINANCE_INVENTORY_TOKEN exige actualizar Finance e Inventory coordinadamente; durante la rotación las operaciones quedan pendientes.

Los pagos se comparan con la compra actual al listarlos o al pulsar **Comprobar compra**. Una compra revertida marca discrepancia. Registrar una nota de regularización no mueve dinero.

## Verificación

    pnpm lint
    pnpm typecheck
    pnpm test
    pnpm build
    pnpm format:check
    pnpm finance:verify
    pnpm test:stack

finance:verify usa PostgreSQL, servicios y navegador reales por Nginx; no ejecutarlo contra producción. Crea fixtures con prefijo aleatorio y elimina solo sus UUID.

## Límites expresos

Sin pagos en línea, facturación electrónica, impuestos, crédito, valoración contable del inventario, rentabilidad por lote, paneles de informes ni tienda online. No hay conversión de moneda ni edición/borrado de movimientos confirmados.
