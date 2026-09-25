# Roadmap

| Fase | Alcance                | Estado                      |
| ---- | ---------------------- | --------------------------- |
| 0    | Fundación técnica      | Completada                  |
| 1    | Autenticación          | **Completada: 1A, 1B y 1C** |
| 2    | Catálogo y proveedores | **Completada: 2A y 2B**     |
| 3    | Compras e inventario   | **Completada: 3A y 3B**     |
| 4    | Producción             | **Completada**              |
| 5    | Rendimiento y envasado | Pendiente                   |
| 6    | Finanzas               | Pendiente                   |
| 7    | Informes               | Pendiente                   |
| 8    | Tienda online          | Pendiente                   |

Fase 1A incorpora identidad, contraseñas Argon2id, sesiones rotativas, JWT RS256/JWKS, cookies, CSRF, rate limiting, roles/permisos y bootstrap del primer propietario. La Fase 1B integra login, sesión, refresh y protección del panel; su validación local, de navegador y stack está completada. La Fase 1C incorpora validación JWT/JWKS local, guards globales, RBAC por permisos, CSRF y protección de Swagger. Su validación incluye 175 pruebas, Playwright real, test:stack, aislamiento y persistencia. La Fase 2A incorpora categorías y artículos, contratos v1, migración propia de Inventory, control de versiones, permisos e interfaz responsive. Se verificó con 255 pruebas y PostgreSQL/Playwright reales. Fase 2B completada: proveedores y asociaciones con artículos, 325 pruebas, PostgreSQL/Playwright reales y 16 grupos de test:stack aprobados. Ver ADR-008 y validation.md.

Fase 3 completada: compras, recepción y reversión transaccionales, ledger, existencias y ajustes manuales. 389 pruebas (329 heredadas y 60 nuevas), siete grupos reales de compras y 17 de test:stack aprobados. Respaldo verificado y datos originales conservados; ver ADR-009, purchases.md y validation.md.

Fase 4 completada: fórmulas versionadas, lotes, consumo idempotente y compensación explícita. ADR-010 preserva database-per-service: Inventory confirma existencias y ledger en su transacción local; Production se coordina mediante operaciones persistentes recuperables. 428 pruebas (389 heredadas y 39 nuevas), siete grupos reales de Producción y 18 de test:stack aprobados. Datos conservados, fixtures limpios y ocho contenedores saludables. Ver production.md y validation.md. Fase 5 permanece pendiente.
