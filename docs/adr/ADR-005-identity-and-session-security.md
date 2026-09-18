# ADR-005 — Seguridad de identidad y sesiones

**Estado:** aceptada, Fase 1A.

## Contexto

Ambrosia necesita identidades internas sin acoplar contraseñas, sesiones ni la base de usuarios a los servicios de negocio. El navegador usa un único origen público a través de Nginx y las siguientes fases deberán autorizar cada servicio sin una llamada síncrona a identidad por solicitud.

## Decisión

Crear `identity-service` con base, usuario PostgreSQL, cliente Prisma y ciclo de despliegue propios. Es el propietario del mapa rol-permisos y emite access tokens de 15 minutos firmados con RS256. Publica solamente la clave pública mediante JWKS; en Fase 1C cada servicio validará firma, emisor, audiencia y claims de forma local.

Las contraseñas usan Argon2id. El refresh token es opaco, aleatorio y solo se persiste su hash SHA-256. Cada renovación crea un token nuevo dentro de la misma familia, invalida el anterior y permite revocar la familia completa ante reutilización. Las cookies de access y refresh son HttpOnly y SameSite=Lax; producción exige Secure. Un token CSRF legible, enlazado criptográficamente a otra cookie HttpOnly, más la validación de Origin o Referer protege operaciones mutables. No se almacenan tokens en Web Storage.

El primer OWNER se crea mediante un comando interactivo y no existen registro público ni credenciales predeterminadas. Como no hay operaciones de gestión de usuarios en 1A, el único OWNER no puede eliminarse ni desactivarse por la API. Cualquier gestión futura deberá conservar explícitamente ese invariante.

## Alternativas consideradas

- JWT HMAC: obliga a distribuir un secreto capaz de firmar a todos los validadores y aumenta el impacto de una filtración.
- Sesiones opacas para todas las solicitudes: requieren una consulta central y acoplan la disponibilidad de los servicios a identidad.
- Refresh JWT: expone claims innecesarios y complica la revocación; un valor opaco reduce superficie y permite guardar solo un hash.
- Tokens en `localStorage`: quedan disponibles para JavaScript y elevan el impacto de XSS.
- Proveedor externo o registro público: agregan dependencia y capacidades fuera del alcance de identidades internas de esta fase.
- Refresh sin rotación: no permite detectar que un token anterior fue robado y reutilizado.

## Consecuencias y trade-offs

Los servicios pueden validar access tokens sin credenciales privadas ni consultas cruzadas. La revocación de sesiones y los cambios de contraseña se aplican de inmediato dentro de identidad; los servicios de negocio aceptarán un access token ya emitido hasta su expiración, salvo que una fase futura introduzca otra estrategia. Rotar claves exige publicar una ventana JWKS con claves activas y coordinar el retiro de `kid` antiguos.

El rate limit por IP es local al proceso y solo sirve para una instancia de desarrollo; múltiples réplicas requieren un contador distribuido. SameSite=Lax y CSRF reducen riesgo, pero TLS, una lista de orígenes exacta, secretos externos, observabilidad y políticas del proxy siguen siendo obligaciones operativas. PostgreSQL y NATS continúan como dependencias compartidas de infraestructura.

## Trabajo futuro

La Fase 1C agregará validación JWKS independiente, guardias de claims y RBAC en inventario, producción y finanzas, además de protección de Swagger. Gestión de usuarios, recuperación de contraseña, MFA, OAuth, correo y rotación operativa automatizada permanecen fuera del alcance actual.

## Integración del panel, Fase 1B (2026-09-17)

Se reasigna el login y protección del panel a 1B según el alcance aprobado. Next consulta /me desde el servidor con no-store y timeout, sin recibir la cookie refresh, cuyo Path sigue siendo /api/auth. El binding CSRF es un indicio para mostrar recuperación neutral; no acredita autenticación. El navegador renueva por Nginx, vuelve a consultar /me y refresca la navegación. Un intento por navegación evita ciclos y solo GET/HEAD admiten repetición automática tras refresh. Cookies, expiraciones, firma, origen y controles de Identity se conservan.
