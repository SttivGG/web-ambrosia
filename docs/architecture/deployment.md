# Despliegue

Cada Dockerfile recibe la raíz del monorepo como contexto. pnpm fetch usa el lockfile y caché BuildKit; install es offline/frozen. Cada build filtra la aplicación y sus paquetes. NestJS se empaqueta con `pnpm deploy --prod`; Next.js usa standalone. Las imágenes finales son Node Alpine con usuario `node`. NATS usa UID 1000 con directorio persistente preparado; Nginx usa una imagen unprivileged.

Compose base no publica PostgreSQL, NATS ni los servicios. Solo Nginx se conecta a la red edge. El override de desarrollo enlaza puertos de diagnóstico a 127.0.0.1 y dirige Nginx a las aplicaciones locales. No aplicar ese override al despliegue externo.

El bootstrap SQL crea usuarios y bases una sola vez en un volumen vacío. Para volúmenes existentes, `identity-db-provision` agrega o actualiza idempotentemente solo `identity_user` y `ambrosia_identity`; después `identity-migrate` aplica `prisma migrate deploy` antes de iniciar identidad. El usuario administrador es para inicialización/operación y ninguna aplicación recibe sus credenciales. PostgreSQL persiste en postgres_data y JetStream en nats_data. Reiniciar o recrear contenedores preserva datos; `down -v` los destruye y no forma parte de los scripts ordinarios.

Las aplicaciones no requieren que otro microservicio esté sano para arrancar. Los health checks Docker usan liveness y no reinician aplicaciones solo por una caída de infraestructura. Readiness sirve al gateway/operador/panel; reinicios se controlan con unless-stopped. Docker Compose no reinicia automáticamente un contenedor únicamente por estar unhealthy.

Los puertos internos en contenedores son fijos; las variables de puertos de servicios corresponden al modo local. GATEWAY_PORT controla la publicación. POSTGRES_HOST/POSTGRES_PORT describen el host local y las URLs deben actualizarse al modificarlos. En contenedores el DNS es postgres:5432 y nats:4222.

Para reconstruir un servicio: `docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --build --no-deps inventory-service`. Identidad usa un job de migración separado y repetible; el proceso HTTP no cambia el esquema durante su arranque. Las otras bases todavía no tienen modelos de negocio ni migraciones.

Antes de operación real: TLS en el borde, un gestor externo para claves/secretos, rotación de claves, backups/restauración probados, límites de recursos y retención de logs. `AUTH_COOKIE_SECURE=true` es obligatorio con `NODE_ENV=production`. El rate limit de login está en memoria y requiere almacenamiento distribuido al desplegar múltiples réplicas. Las imágenes están fijadas por versión, no por digest; actualizar parches mediante revisión deliberada. NATS usa una identidad técnica común; definir ACL por servicio al establecer subjects de negocio.
