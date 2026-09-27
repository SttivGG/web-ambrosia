# ADR-012 — Finanzas, pagos y ventas coordinadas con Inventory

**Estado:** aceptada para Fase 6.

## Contexto

Finance es autoridad de cuentas, dinero, pagos y ventas manuales. Inventory es autoridad de compras, artículos vendibles, existencias y ledger. ADR-002 impide joins entre bases, clientes Prisma compartidos y transacciones distribuidas.

## Decisión

Los importes se almacenan como NUMERIC(24,2) COP y viajan como texto. El servidor redondea cada subtotal de venta con HALF_UP a dos decimales y suma líneas ya redondeadas. Las cantidades vendidas son enteros y solo admiten FINISHED_PRODUCT activo, controlado por UNIT. Los saldos de cuenta se calculan exclusivamente desde movimientos CONFIRMED; no existe un saldo financiero mutable separado.

Un pago obtiene por HTTP interno una instantánea versionada de una compra RECEIVED. Finance bloquea por compra y suma pagos confirmados dentro de una transacción Serializable; un pago que exceda el total se rechaza. Si Inventory cambia o revierte la compra posteriormente, el dinero y la instantánea permanecen. La comprobación marca una discrepancia y el operador registra una nota de regularización; nunca hay reversión automática.

Una venta persiste en Finance su solicitud, líneas calculadas y UUID estable antes de llamar a Inventory. Inventory serializa por venta, bloquea artículos en orden, valida stock y registra SALE_OUT, saldo y resultado idempotente en una transacción local. Finance crea SALE_INCOME y confirma la venta en otra transacción local únicamente después del resultado confirmado. Un fallo de transporte deja PENDING; recuperación automática o manual reutiliza el mismo UUID.

La anulación persiste otro UUID, conserva los hechos originales y solicita a Inventory SALE_RETURN enlazado a las salidas originales. Tras confirmación, Finance registra SALE_REFUND enlazado al ingreso y cambia la venta a CANCELLED. Un rechazo definitivo queda auditado; un fallo transitorio permanece pendiente. No se guardan cookies ni JWT para reintentos.

La API interna utiliza FINANCE_INVENTORY_TOKEN, distinta de Production, rechaza cookies y solo expone instantáneas de compras, artículos vendibles y operaciones de venta. Nginx bloquea toda ruta /internal. Los contratos están en @ambrosia/contracts v1; cada servicio mantiene Prisma y migraciones propios.

## Alternativas descartadas

- Transacción XA/2PC o acceso directo entre bases: contradicen ADR-002.
- Confirmar ingreso antes del stock: permitiría ventas confirmadas sin descuento.
- Reintentar con otro UUID: duplica inventario o dinero.
- Borrar pagos al revertir compras: destruye auditoría y reescribe hechos financieros.

## Consecuencias y límites

Existe consistencia eventual visible. Operaciones pendientes requieren disponibilidad posterior y supervisión. Esta fase no incluye pagos en línea, facturación electrónica, impuestos, crédito a clientes, valoración contable, rentabilidad por lote, informes ni tienda online.
