# Roadmap

| Fase | Alcance                | Estado                         |
| ---- | ---------------------- | ------------------------------ |
| 0    | Fundación técnica      | Completada                     |
| 1    | Autenticación          | **En progreso: 1A completada** |
| 2    | Catálogo y proveedores | Pendiente                      |
| 3    | Compras e inventario   | Pendiente                      |
| 4    | Producción             | Pendiente                      |
| 5    | Rendimiento y envasado | Pendiente                      |
| 6    | Finanzas               | Pendiente                      |
| 7    | Informes               | Pendiente                      |
| 8    | Tienda online          | Pendiente                      |

Fase 1A incorpora identidad, contraseñas Argon2id, sesiones rotativas, JWT RS256/JWKS, cookies, CSRF, rate limiting, roles/permisos y bootstrap del primer propietario. Quedan reservados para 1B la validación local de tokens y los guardias RBAC en servicios de negocio, y para 1C el login del panel, renovación desde frontend y protección del panel/Swagger.
