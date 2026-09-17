# Ambrosia

Sistema de control de producción de yogurt griego. La Fase 0 estableció la infraestructura y la Fase 1A agrega identidad y sesiones por API. El panel de login, los guardias de los servicios de negocio y la lógica de inventario, producción, finanzas o comercio aún no forman parte del sistema.

## Arquitectura

El navegador accede a Nginx. Este sirve Next.js y enruta a cuatro aplicaciones NestJS independientes. Cada servicio tiene un esquema y cliente Prisma propios y una base PostgreSQL con usuario exclusivo. `identity-service` posee usuarios, roles, contraseñas, sesiones, auditoría y claves JWT. NATS JetStream proporciona transporte asíncrono persistente; todavía no se definen eventos de negocio ni streams permanentes.

```text
apps/admin-web/                  Next.js App Router, Tailwind, estado de servicios
services/inventory-service/      NestJS + Prisma propios
services/production-service/     NestJS + Prisma propios
services/finance-reporting-service/
services/identity-service/       NestJS, Prisma, Argon2id, JWT RS256 y sesiones
packages/contracts/             contratos de transporte versionados
packages/shared-config/         validación Zod sin dominio
packages/eslint-config/          configuración ESLint
packages/typescript-config/      configuración TypeScript
infrastructure/                  Compose, Nginx, PostgreSQL, NATS
scripts/                        ejecución y verificación multiplataforma
tests/                          configuración e infraestructura
docs/                           arquitectura, ADR, roadmap y validación
```

## Requisitos e instalación

Node.js **24 LTS**, pnpm **10.34.5**, Docker Engine/Desktop con Compose v2 y contenedores Linux. En Windows iniciar Docker Desktop antes de ejecutar infraestructura. No se requiere PostgreSQL/NATS instalado en el host.

```sh
npm install --global pnpm@10.34.5
pnpm install --frozen-lockfile
```

Si no se desea instalar pnpm globalmente: `npx --yes pnpm@10.34.5 install --frozen-lockfile`; reemplazar `pnpm` por `npx --yes pnpm@10.34.5` en los demás comandos. Un único lockfile fija las dependencias; no actualizar mayores automáticamente.

Crear configuración en Bash:

```sh
cp .env.example .env
```

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Los valores de ejemplo son **solo para desarrollo local**. Configurar puertos, contraseñas distintas de PostgreSQL, las cuatro URLs, NATS, CORS y logging. Mantener cada contraseña y su URL sincronizadas. En Compose las URLs internas se construyen usando el DNS `postgres` y las credenciales del servicio; las URLs de `.env` apuntan al host para desarrollo local. Los passwords interpolados en URLs deben estar URL-encoded y compatibles con las variables de inicialización; para evitar ambigüedades utilizar claves alfanuméricas largas. `DATABASE_URL` y `PORT` son variables privadas por servicio en despliegues independientes. `NATS_USER`, `NATS_PASSWORD`, `NATS_URL`, `CORS_ALLOWED_ORIGINS` y `LOG_LEVEL` son comunes. Ningún secreto tiene prefijo público ni se transmite al navegador.

Generar material criptográfico local antes del primer arranque:

```sh
pnpm auth:keys:generate
```

El comando crea `secrets/auth.local.env`, ignorado por Git, con RSA 3072 y el secreto CSRF. No imprime las claves. En un entorno real cargar `JWT_PRIVATE_KEY_BASE64`, `JWT_PUBLIC_KEY_BASE64` y `AUTH_CSRF_SECRET` desde el gestor de secretos; no copiar el archivo local. La regeneración con `--force` invalida tokens existentes y debe tratarse como una rotación planificada.

## Desarrollo local

```sh
pnpm infra:up
pnpm gateway:up
pnpm dev
```

Abrir **http://localhost:8080**. `infra:up` inicia PostgreSQL y NATS con puertos enlazados a loopback, aprovisiona la base de identidad de forma idempotente y aplica su migración. `gateway:up` ejecuta Nginx apuntando a las aplicaciones del host mediante `host.docker.internal`. `dev` carga `.env` y `secrets/auth.local.env` y ejecuta las cinco aplicaciones. Los servicios se pueden desarrollar independientemente con `pnpm --filter @ambrosia/inventory-service dev` después de exportar sus variables. El panel se abre por el gateway, incluso durante desarrollo. Abrirlo directamente en 3000 no permite consultar las rutas API.

Los scripts Node son iguales en Bash y PowerShell. Para cambiar puertos locales, editar `.env` y repetir `pnpm gateway:up`. No ejecutar el stack completo y desarrollo local simultáneamente.

## Stack completo en contenedores

```sh
pnpm stack:up
pnpm compose:config
```

El Compose base publica únicamente Nginx en 8080. PostgreSQL, NATS y aplicaciones están en una red privada. Las imágenes de aplicaciones usan builds multietapa y usuarios no root, health checks de liveness y dependencias de producción. No hay dependencias de arranque entre aplicaciones: un servicio puede iniciar antes de su infraestructura y reportar readiness 503 hasta recuperarse.

| Componente                | Puerto local/interno                      | Base propia              |
| ------------------------- | ----------------------------------------- | ------------------------ |
| admin-web                 | 3000                                      | —                        |
| inventory-service         | 3001                                      | ambrosia_inventory       |
| production-service        | 3002                                      | ambrosia_production      |
| finance-reporting-service | 3003                                      | ambrosia_finance_reports |
| identity-service          | 3004                                      | ambrosia_identity        |
| PostgreSQL                | 5432 (solo loopback en desarrollo)        | cuatro bases             |
| NATS / monitor            | 4222 / 8222 (solo loopback en desarrollo) | JetStream persistente    |
| Nginx                     | 8080                                      | —                        |

Para un despliegue externo, configurar TLS en el borde, DNS, secretos reales y backups antes de abrir el acceso. Producción exige `AUTH_COOKIE_SECURE=true`. El panel todavía no consume identidad ni está protegido; esa integración corresponde a la Fase 1C.

## Health y Swagger

En el gateway (`http://localhost:8080`):

| Servicio   | Liveness                    | Readiness                    | Swagger               |
| ---------- | --------------------------- | ---------------------------- | --------------------- |
| Inventario | /api/inventory/health/live  | /api/inventory/health/ready  | /api/inventory/docs/  |
| Producción | /api/production/health/live | /api/production/health/ready | /api/production/docs/ |
| Finanzas   | /api/finance/health/live    | /api/finance/health/ready    | /api/finance/docs/    |
| Identidad  | /api/auth/health/live       | /api/auth/health/ready       | /api/auth/docs/       |

Directamente en el puerto de cada servicio: `/api/v1/health/live`, `/api/v1/health/ready`, `/docs/` y `/docs-json`. Liveness solo comprueba el proceso. Readiness ejecuta `SELECT 1` mediante el Prisma propio y consulta la cuenta JetStream con timeout. Dependencias caídas producen 503 sin exponer errores internos. Nginx genera/preserva `X-Request-ID`; cada servicio lo incluye en respuestas y logs JSON. La interfaz muestra los resultados reales y la última comprobación en `America/Bogota`; el transporte usa UTC.

## Identidad y sesiones

Nginx ofrece una ruta pública limpia y conserva el versionado interno: `/api/auth/<acción>` se reescribe a `/api/v1/auth/<acción>`. JWKS queda en `/api/auth/.well-known/jwks.json`.

| Método | Ruta                              | Requisito                                 |
| ------ | --------------------------------- | ----------------------------------------- |
| GET    | `/api/auth/csrf`                  | Emite token y cookies CSRF                |
| POST   | `/api/auth/login`                 | CSRF, Origin/Referer, correo y contraseña |
| POST   | `/api/auth/refresh`               | Cookie refresh y CSRF                     |
| GET    | `/api/auth/me`                    | Cookie access                             |
| POST   | `/api/auth/logout`                | CSRF; idempotente                         |
| POST   | `/api/auth/logout-all`            | Access y CSRF                             |
| POST   | `/api/auth/change-password`       | Access, CSRF y contraseñas                |
| GET    | `/api/auth/.well-known/jwks.json` | Público; solo material RSA público        |

Access y refresh se entregan en cookies HttpOnly, SameSite=Lax. Access usa `Path=/`; refresh usa `Path=/api/auth`. La cookie `ambrosia_csrf` es legible por el cliente y se valida en tiempo constante junto con su binding HttpOnly y el origen. El JWT RS256 dura 15 minutos por defecto; el refresh opaco dura siete días, solo se almacena como hash y rota en cada uso. Reutilizar uno rotado revoca toda su familia. El rate limit por IP está en memoria y una instalación con múltiples réplicas necesitará almacenamiento distribuido.

Después de que el stack esté saludable, crear el primer propietario desde Bash o PowerShell:

```sh
pnpm auth:bootstrap-owner
```

El comando solicita correo, nombre y contraseña; oculta la contraseña cuando la terminal lo permite y se niega si ya existe un OWNER. No hay registro público ni contraseña predeterminada. La contraseña debe tener entre 12 y 128 caracteres, una letra y un número, puede contener espacios o caracteres especiales y no puede equivaler al correo.

## Validación

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
docker compose --env-file .env -f infrastructure/docker-compose.yml config --quiet
pnpm test:stack
```

Pruebas adicionales después de `pnpm build`: `pnpm test:local` verifica HTTP real con dependencias deliberadamente inaccesibles; `pnpm exec playwright install chromium` seguido de `pnpm test:ui` verifica el panel en navegador. Playwright se utiliza solo en desarrollo. Si ya existe Chromium, puede indicarse `PLAYWRIGHT_EXECUTABLE_PATH` (Bash: `export PLAYWRIGHT_EXECUTABLE_PATH=/ruta/chrome`; PowerShell: `$env:PLAYWRIGHT_EXECUTABLE_PATH='C:/ruta/chrome.exe'`). Las respuestas saludables de la prueba UI son simuladas y no reemplazan `test:stack`.

`test:stack` necesita Docker y el workspace local: construye/levanta el stack, comprueba ocho contenedores, endpoints, Swagger y los flujos reales de identidad; detiene finanzas, producción e identidad por separado; simula caídas de PostgreSQL/NATS; comprueba recuperación; rechaza doce conexiones cruzadas de las cuatro cuentas y verifica persistencia con marcadores temporales. Restaura los servicios y limpia tanto marcadores como el OWNER temporal al finalizar. Escribe resultados reales en `artifacts/stack-verification.json` y `artifacts/identity-verification.json`. No ejecutar contra producción. No elimina volúmenes.

Para una comprobación manual en Bash: `curl -i http://localhost:8080/api/production/health/ready`. En PowerShell usar `curl.exe -i http://localhost:8080/api/production/health/ready` o `Invoke-WebRequest`.

```sh
docker compose --env-file .env -f infrastructure/docker-compose.yml stop finance-reporting-service
curl -i http://localhost:8080/api/production/health/ready
docker compose --env-file .env -f infrastructure/docker-compose.yml start finance-reporting-service
docker compose --env-file .env -f infrastructure/docker-compose.yml stop production-service
curl -i http://localhost:8080/api/inventory/health/ready
docker compose --env-file .env -f infrastructure/docker-compose.yml start production-service
```

En PowerShell reemplazar `curl` por `curl.exe`. Los resultados de esta implementación se registran en [docs/validation.md](docs/validation.md); las pruebas pendientes no se consideran aprobadas.

## Operación y solución de problemas

- Logs de infraestructura: `pnpm infra:logs`. Logs completos: `docker compose --env-file .env -f infrastructure/docker-compose.yml logs -f`.
- Detener infraestructura local: `pnpm infra:down`. Detener todo conservando datos: `pnpm stack:down`. No usar `down -v` salvo que se quiera borrar datos explícitamente.
- `Configuración inválida`: revisar los nombres indicados, CORS como orígenes sin slash final, puertos válidos y credenciales. Los servicios no cargan `.env` implícitamente: `pnpm dev` centraliza la carga y Docker inyecta variables.
- Readiness 503: comprobar PostgreSQL/NATS y URLs; liveness debe seguir en 200. Un servicio caído no impide que Nginx resuelva los demás.
- Cambiar las claves en `.env` no modifica usuarios en un volumen PostgreSQL existente. Rotar contraseñas por SQL y actualizar URLs de forma coordinada; no borrar el volumen para resolverlo en entornos con datos.
- Prisma sin modelos en los tres servicios de negocio sigue siendo intencional. Identidad sí tiene modelos y aplica migraciones versionadas mediante `identity-migrate`.
- Puerto ocupado: detener el proceso anterior o cambiar el puerto y regenerar el gateway local.
- Scripts de inicialización Linux requieren LF; `.gitattributes` lo fija para futuros clones.
- La skill UI disponible contenía referencias a scripts inexistentes. Se aplicaron directamente sus reglas de contraste, foco, estados con texto, tamaño táctil y responsive.

Ver [arquitectura](docs/architecture/system-overview.md), [despliegue](docs/architecture/deployment.md), [ADR de identidad](docs/adr/ADR-005-identity-and-session-security.md) y [roadmap](docs/roadmap.md).
