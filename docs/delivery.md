# Entrega — Servicio de identidad y sesiones

**FASE 1A COMPLETADA** el 2026-09-16. Esta entrega agrega autenticación por API sin implementar el formulario de login ni guardias en los servicios de negocio.

## Implementación

`identity-service` es un NestJS independiente con Prisma, PostgreSQL y NATS propios. Incluye configuración Zod, health, Swagger, logging JSON, correlación, límite de cuerpo, cierre ordenado y una imagen multietapa no root. La migración `20260916170000_identity_sessions` crea `User`, `RefreshSession`, `AuthAuditLog` y sus enums/índices en `ambrosia_identity`.

Archivos principales creados:

```text
services/identity-service/
  prisma/{schema.prisma,migrations/20260916170000_identity_sessions/}
  src/{auth,users,sessions,authorization,audit,config,database,event-bus,health,common}/
  Dockerfile, package.json, prisma.config.ts, tsconfig.json
packages/contracts/src/auth-v1.ts
infrastructure/postgres/provision-identity.sh
scripts/{generate-auth-keys,bootstrap-owner,verify-identity}.mjs
docs/adr/ADR-005-identity-and-session-security.md
```

La base `ambrosia_identity` pertenece a `identity_user`. El job idempotente `identity-db-provision` soporta volúmenes existentes sin recrearlos y `identity-migrate` ejecuta migraciones antes del servicio HTTP. Los doce intentos cruzados entre las cuatro cuentas PostgreSQL fueron rechazados.

## API y seguridad

El gateway traduce `/api/auth/<acción>` a `/api/v1/auth/<acción>` y mantiene JWKS en `/api/auth/.well-known/jwks.json`, health en `/api/auth/health/*` y Swagger en `/api/auth/docs/`. Endpoints creados: `csrf`, `login`, `refresh`, `me`, `logout`, `logout-all` y `change-password`. No existe registro público.

Las contraseñas usan Argon2id con 64 MiB, tres iteraciones y paralelismo uno. La política exige entre 12 y 128 caracteres, al menos una letra y un número, conserva espacios y caracteres especiales, y rechaza equivalencia con el correo normalizado. Cinco fallos bloquean la cuenta durante 15 minutos por defecto. Login tiene rate limit en memoria por IP, configurable; múltiples réplicas requerirán almacenamiento distribuido.

Los access tokens usan RS256, `kid`, `iss`, `aud`, `sub`, `jti`, `iat`, `exp`, `typ=user`, `sid`, rol y permisos. Duran 15 minutos por defecto. JWKS contiene únicamente parámetros públicos. Los refresh tokens son 32 bytes aleatorios codificados en Base64URL, se persisten como SHA-256, duran siete días, rotan en cada renovación y revocan su familia cuando se reutiliza un token anterior.

Cookies:

| Cookie               | HttpOnly | SameSite | Path        | Vigencia       |
| -------------------- | -------- | -------- | ----------- | -------------- |
| `ambrosia_access`    | Sí       | Lax      | `/`         | Access JWT     |
| `ambrosia_refresh`   | Sí       | Lax      | `/api/auth` | Sesión refresh |
| `ambrosia_csrf`      | No       | Lax      | `/`         | Sesión refresh |
| binding CSRF interno | Sí       | Lax      | `/`         | Sesión refresh |

Producción exige `Secure=true`. Las operaciones mutables verifican `X-CSRF-Token` en tiempo constante, el binding firmado y un Origin o Referer permitido. Los tokens nunca se devuelven en el cuerpo ni se almacenan en Web Storage.

El servicio posee el mapa rol-permisos. OWNER tiene los ocho permisos; ADMIN excluye `users.manage`; OPERATOR incluye lectura/escritura de inventario y producción más informes; VIEWER solo lectura de inventario, producción, finanzas e informes. `packages/contracts` comparte identificadores y claims versionados, sin Prisma, repositorios ni claves.

## Configuración y operación

Variables nuevas: `IDENTITY_SERVICE_PORT`, `IDENTITY_DATABASE_URL`, `IDENTITY_DATABASE_NAME`, `IDENTITY_DATABASE_USER`, `IDENTITY_DATABASE_PASSWORD`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_ACCESS_TTL_SECONDS`, `JWT_KEY_ID`, `JWT_PRIVATE_KEY_BASE64`, `JWT_PUBLIC_KEY_BASE64`, `AUTH_CSRF_SECRET`, `AUTH_REFRESH_TTL_SECONDS`, `AUTH_MAX_FAILED_ATTEMPTS`, `AUTH_LOCKOUT_MINUTES`, `AUTH_LOGIN_RATE_LIMIT`, `AUTH_LOGIN_RATE_WINDOW_SECONDS`, `AUTH_COOKIE_SECURE` y `AUTH_REFRESH_COOKIE_PATH`.

Preparación e inicio:

```sh
cp .env.example .env                    # PowerShell: Copy-Item .env.example .env
pnpm auth:keys:generate
pnpm install --frozen-lockfile
pnpm stack:up
pnpm auth:bootstrap-owner
```

El generador crea RSA 3072 y el secreto CSRF en `secrets/auth.local.env`, ignorado, sin imprimir material privado. El bootstrap solicita correo, nombre y contraseña de forma interactiva, crea un único OWNER y audita el evento. Su modo no interactivo solo funciona con `NODE_ENV=test`.

## Validación y estado final

La prueba real de identidad verificó migración, bootstrap único, indistinguibilidad de credenciales incorrectas, cookies, JWT/claims, `/me`, CSRF inválido, rotación, reutilización, bloqueo, cuenta inactiva, logout idempotente, logout-all, cambio de contraseña, JWKS, ausencia de registro, hashes y auditoría sanitizada. `test:stack` confirmó los cuatro Swagger/health, fallas y recuperación de PostgreSQL/NATS, independencia entre identidad y producción, doce conexiones cruzadas rechazadas y persistencia PostgreSQL/JetStream.

Los ocho contenedores quedaron `running (healthy)`. Solo Nginx publica 8080; 3000–3004, 5432, 4222 y 8222 permanecen privados. Los jobs de provisión y migración terminaron con código 0. La raíz del workspace no es un repositorio Git, por lo que no existe un estado Git raíz que reportar; no se hicieron commits ni pushes. Resultados y comandos exactos: [validation.md](validation.md).

## Alcance posterior y riesgos

El panel todavía no inicia sesión y Swagger sigue público. Inventario, producción y finanzas aún no validan JWT ni aplican RBAC. Esos cambios corresponden a Fases 1B y 1C. También quedan para operación real TLS, gestor de secretos, rotación coordinada de claves, rate limiting distribuido, backups probados y observabilidad de alertas. No se implementaron recuperación, correo, MFA, OAuth, gestión de usuarios, Redis ni lógica funcional futura.

Decisión completa: [ADR-005](adr/ADR-005-identity-and-session-security.md).
