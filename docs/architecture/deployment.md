# Despliegue

Cada Dockerfile recibe la raíz del monorepo como contexto. pnpm fetch usa el lockfile y caché BuildKit; install es offline/frozen. Cada build filtra la aplicación y sus paquetes. NestJS se empaqueta con `pnpm deploy --prod`; Next.js usa standalone. Las imágenes finales son Node Alpine con usuario `node`. NATS usa UID 1000 con directorio persistente preparado; Nginx usa una imagen unprivileged.

Compose base no publica PostgreSQL, NATS ni los servicios. Solo Nginx se conecta a la red edge. El override de desarrollo enlaza puertos de diagnóstico a 127.0.0.1 y dirige Nginx a las aplicaciones locales. No aplicar ese override al despliegue externo.

El bootstrap SQL crea usuarios y bases una sola vez en un volumen vacío. Para volúmenes existentes, `identity-db-provision` agrega o actualiza idempotentemente solo `identity_user` y `ambrosia_identity`; después `identity-migrate` aplica `prisma migrate deploy` antes de iniciar identidad. El usuario administrador es para inicialización/operación y ninguna aplicación recibe sus credenciales. PostgreSQL persiste en postgres_data y JetStream en nats_data. Reiniciar o recrear contenedores preserva datos; `down -v` los destruye y no forma parte de los scripts ordinarios.

Las aplicaciones no requieren que otro microservicio esté sano para arrancar. Los health checks Docker usan liveness y no reinician aplicaciones solo por una caída de infraestructura. Readiness sirve al gateway/operador/panel; reinicios se controlan con unless-stopped. Docker Compose no reinicia automáticamente un contenedor únicamente por estar unhealthy.

Los puertos internos en contenedores son fijos; las variables de puertos de servicios corresponden al modo local. GATEWAY_PORT controla la publicación. POSTGRES_HOST/POSTGRES_PORT describen el host local y las URLs deben actualizarse al modificarlos. En contenedores el DNS es postgres:5432 y nats:4222.

Para reconstruir un servicio: `docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build --no-deps inventory-service`. Identidad usa un job de migración separado y repetible; el proceso HTTP no cambia el esquema durante su arranque. Las otras bases todavía no tienen modelos de negocio ni migraciones.

Antes de operación real: TLS en el borde, un gestor externo para claves/secretos, rotación de claves, backups/restauración probados, límites de recursos y retención de logs. `AUTH_COOKIE_SECURE=true` es obligatorio con `NODE_ENV=production`. El rate limit de login está en memoria y requiere almacenamiento distribuido al desplegar múltiples réplicas. Las imágenes están fijadas por versión, no por digest; actualizar parches mediante revisión deliberada. NATS usa una identidad técnica común; definir ACL por servicio al establecer subjects de negocio.

El servidor admin-web recibe IDENTITY_INTERNAL_URL=http://identity-service:3004. El navegador utiliza el mismo origen por Nginx. No se agregan contenedores ni puertos públicos. El modo local deriva la URL del puerto Identity si no existe un valor explícito; el gateway sustituye todas las rutas Identity por host.docker.internal.

## Operación JWT/JWKS (Fase 1C)

Cada servicio recibe AUTH_JWKS_URL, AUTH_ISSUER, AUTH_AUDIENCE, AUTH_ALLOWED_ALGORITHM, AUTH_JWKS_TIMEOUT_MS, AUTH_JWKS_CACHE_TTL_SECONDS y AUTH_ALLOWED_ORIGINS. Los nombres de cookies y cabecera se fijan por compatibilidad; los valores predeterminados están en .env.example y [delivery.md](../delivery.md).

Compose utiliza la red privada para JWKS. El modo local deriva AUTH_JWKS_URL de IDENTITY_INTERNAL_URL; una URL explícita debe actualizarse al cambiar el puerto Identity. Turborepo permite estas variables durante pnpm dev.

Una caída menor al TTL no interrumpe la validación con claves vigentes. Al caducar la caché, readiness y autenticación responden 503 hasta recuperar JWKS. Un servicio reiniciado no conserva claves anteriores. No se añade dependencia de arranque entre aplicaciones ni puertos publicados.

Para rotar, publicar la clave nueva junto a la anterior, comenzar a emitir con el nuevo kid y mantener la anterior durante la vida máxima de access más TTL antes de retirarla. El verificador admite ese conjunto; Identity todavía publica una clave y la automatización de publicación/rotación requiere una tarea operativa aparte.

Nginx debe recargarse después de editar su configuración montada: ejecutar nginx -t y luego nginx -s reload dentro del gateway. Try it out utiliza el gateway, cookies existentes y CSRF; no debe llamar a puertos internos.
