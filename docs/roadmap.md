# Roadmap

| Fase | Alcance                      | Estado                      |
| ---- | ---------------------------- | --------------------------- |
| 0    | Fundación técnica            | Completada                  |
| 1    | Autenticación                | **Completada: 1A, 1B y 1C** |
| 2    | Catálogo y proveedores       | **Completada: 2A y 2B**     |
| 3    | Compras e inventario         | **Completada: 3A y 3B**     |
| 4    | Producción                   | **Completada**              |
| 5    | Rendimiento y envasado       | **Completada**              |
| 6    | Finanzas                     | **Completada**              |
| 7    | Costeo e informes            | **Completada**              |
| 8A   | Infraestructura de Reporting | **Completada**              |
| 8B   | Reportes operativos          | **Implementada**            |

Fase 1A incorpora identidad, contraseñas Argon2id, sesiones rotativas, JWT RS256/JWKS, cookies, CSRF, rate limiting, roles/permisos y bootstrap del primer propietario. La Fase 1B integra login, sesión, refresh y protección del panel; su validación local, de navegador y stack está completada. La Fase 1C incorpora validación JWT/JWKS local, guards globales, RBAC por permisos, CSRF y protección de Swagger. Su validación incluye 175 pruebas, Playwright real, test:stack, aislamiento y persistencia. La Fase 2A incorpora categorías y artículos, contratos v1, migración propia de Inventory, control de versiones, permisos e interfaz responsive. Se verificó con 255 pruebas y PostgreSQL/Playwright reales. Fase 2B completada: proveedores y asociaciones con artículos, 325 pruebas, PostgreSQL/Playwright reales y 16 grupos de test:stack aprobados. Ver ADR-008 y validation.md.

Fase 3 completada: compras, recepción y reversión transaccionales, ledger, existencias y ajustes manuales. 389 pruebas (329 heredadas y 60 nuevas), siete grupos reales de compras y 17 de test:stack aprobados. Respaldo verificado y datos originales conservados; ver ADR-009, purchases.md y validation.md.

Fase 4 completada: fórmulas versionadas, lotes, consumo idempotente y compensación explícita. ADR-010 preserva database-per-service: Inventory confirma existencias y ledger en su transacción local; Production se coordina mediante operaciones persistentes recuperables. 428 pruebas (389 heredadas y 39 nuevas), siete grupos reales de Producción y 18 de test:stack aprobados. Datos conservados, fixtures limpios y ocho contenedores saludables. Ver production.md y validation.md. Fase 5 permanece pendiente.

Fase 5 completada: rendimiento físico, merma, entrada de producto terminado a granel y envasado en artículos `FINISHED_PRODUCT` vendibles. Cada envasado consume granel y materiales `PACKAGING` y genera unidades dentro de una transacción local idempotente de Inventory. Production conserva la trazabilidad por lote y reconcilia respuestas perdidas mediante UUID persistidos. Ver ADR-011, production.md y validation.md.

Fase 6 completada: cuentas, movimientos COP, pagos parciales de compras y ventas manuales. Finance persiste cada UUID antes de coordinar; Inventory aplica salida o retorno idempotente y Finance confirma ingreso o devolución después. Las compras revertidas conservan pagos y muestran discrepancias para regularización explícita. Ver ADR-012, finance.md y validation.md.

Fase 7 completada: promedio ponderado móvil en Inventory, valoración inicial explícita, costo real por lote, absorción de merma productiva y de envasado, componentes de envasado separados, producto terminado valorado, COGS y margen bruto. Se mantienen autoridades, bases separadas y coordinación recuperable. Ver ADR-013, costing.md y validation.md.

Fase 8A implementa contratos y subjects v1, stream y consumidor durable, cuatro read models reconstruibles, filtros temporales '[from, to)', paginación, RBAC, reconciliación/reconstrucción de Inventory y una entrada mínima '/reportes'. Fase 8B agrega read models de compras y envasado, reconciliación/rebuild de Inventory y Production, agregaciones Decimal, comparación temporal y las nueve vistas operativas. No incluye dashboards finales ni exportaciones. Ver ADR-014, reporting.md y validation.md.
