# Validación de Fase 0

Fecha: 2026-09-16. Entorno: Windows, PowerShell, Node 24.14.0. Workspace inicialmente vacío, sin repositorio Git. No se hicieron commits ni pushes.

## Validación inicial (histórica, antes de instalar Docker)

| Validación                | Resultado                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `node --version`          | v24.14.0                                                                                     |
| `pnpm --version`          | 10.34.5 mediante npm exec, no instalado globalmente                                          |
| `pnpm install`            | Correcto; después se verificó frozen-lockfile                                                |
| Lockfile                  | Un único lockfile de código fuente: pnpm-lock.yaml raíz                                      |
| `pnpm lint`               | Correcto                                                                                     |
| `pnpm typecheck`          | Correcto                                                                                     |
| `pnpm test`               | 32 pruebas: 15 health, 5 cliente del panel, 12 configuración                                 |
| `pnpm build`              | Correcto: dos paquetes compilables, tres servicios, Next.js                                  |
| `pnpm format:check`       | Verificado al cierre                                                                         |
| Compose base y desarrollo | `config --quiet` correcto con Compose standalone 2.39.4                                      |
| Motor Docker              | Ausente: no existe el pipe docker_engine                                                     |
| HTTP local real           | Tres servicios: live 200, ready 503 sin dependencias y Swagger 200                           |
| CORS y correlación        | Origen permitido/denegado, ID válido/inválido y logs JSON comprobados                        |
| Configuración incompleta  | Arranque rechazado con salida distinta de cero y nombres de variables                        |
| Aislamiento local         | Detener finanzas deja producción viva; detener producción deja inventario vivo               |
| Paquete de producción     | pnpm deploy de inventario y arranque del paquete independiente correctos                     |
| Navegador Chromium        | Panel servido con Next.js, tres estados y actualización comprobados                          |
| Responsive                | 375×812 y 812×375 sin scroll horizontal, botón ≥44px, movimiento reducido                    |
| Credenciales              | Solo ejemplos locales creados; búsqueda de patrones de tokens/claves privadas sin hallazgos  |
| Exclusión de `.env`       | Verificada con git check-ignore usando repositorio temporal en caché; .env.example permitido |

Se corrigieron durante la validación: un enlace de Next.js que debía usar Link, la validación Zod que lanzaba `Invalid URL` en un CORS inválido y declaraciones de globals del tooling. Se excluyó de Prettier `next-env.d.ts`, regenerado por Next.js. Después se repitieron los controles afectados, incluyendo un build completo sin caché. Un ensayo offline de deploy con store relativo falló; con store absoluto el deploy offline de finanzas pasó y los Dockerfiles usan esa configuración.

También se comprobó Swagger interactivo: Chromium cargó OpenAPI y ejecutó liveness de inventario con HTTP 200.

El comando `docker compose ... config` no pudo invocarse inicialmente porque Docker no existe en PATH. Se descargó el binario oficial standalone a `.cache/tools/docker-compose.exe` y **ambas configuraciones pasaron con ese binario**, sin necesitar daemon. `compose ps` confirmó que el motor no existe. No se instaló software del sistema.

Las pruebas del panel de disponibilidad saludable interceptan HTTP con respuestas simuladas; prueban la interfaz, no la infraestructura. Las pruebas HTTP locales usan PostgreSQL y NATS deliberadamente inaccesibles. No se presentan como readiness saludable ni aislamiento Docker.

## Evidencias locales

- `artifacts/local-verification.json`: resultados HTTP reales.
- `artifacts/ui-verification.json`: resultados de navegador.
- `artifacts/admin-desktop.png`, `artifacts/admin-mobile.png`: capturas, estados saludables simulados.
- `artifacts/final-validation.json` y logs individuales: ejecución de controles de cierre.
- `pnpm-lock.yaml`: resolución determinista; [dependencias](dependencies.md) describe versiones y utilidad.

Los artifacts, herramientas temporales y `.env` están ignorados por Git. La raíz sigue sin repositorio Git; el repositorio temporal de prueba está exclusivamente en `.cache/ignore-audit`.

## Cierre de validación Docker — 2026-09-16

Docker Engine 29.8.0 y Compose 5.5.1 disponibles. Se ejecutó `node scripts/verify-stack.mjs`, equivalente al script `pnpm test:stack`, con salida 0. El script construye/levanta las imágenes y ejecutó estas nueve comprobaciones:

1. Gateway, panel, Swagger, liveness y readiness saludables en los tres servicios.
2. Finanzas detenida no detiene producción.
3. Producción detenida no detiene inventario.
4. NATS caído: readiness 503 y liveness 200.
5. Recuperación de NATS: readiness vuelve a 200.
6. PostgreSQL caído: readiness 503 y liveness 200.
7. Recuperación de PostgreSQL: readiness vuelve a 200.
8. Tres identidades propias sin privilegios elevados y seis conexiones cruzadas rechazadas.
9. Persistencia de un marcador PostgreSQL y un mensaje JetStream tras reiniciar contenedores.

Todas pasaron. Los servicios quedaron restaurados y los siete contenedores terminaron `healthy`. Además:

- Compose base y desarrollo: `config --quiet` correcto con la instalación actual.
- `nginx -t` dentro del contenedor: correcto.
- Chromium contra `http://localhost:8080`: tres servicios disponibles y actualización real, sin interceptar respuestas.
- Swagger de los tres servicios: assets cargados y ejecución interactiva de readiness con HTTP 200 a través de Nginx, sin errores JavaScript.
- Red `ambrosia_private` con `internal=true`; PostgreSQL, NATS y aplicaciones sin puertos publicados. Solo gateway publica 8080.
- Aplicaciones con usuario `node`, NATS con UID 1000 y gateway con UID 101.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (32 pruebas) y `pnpm build` repetidos correctamente.

Evidencias de esta revisión: `artifacts/stack-verification.json`, `artifacts/docker-browser-verification.json`, `artifacts/docker-panel.png` y `artifacts/docker-review-{lint,typecheck,test,build}.log`. El reporte conserva arriba las limitaciones históricas de la primera ejecución; ya no son bloqueos actuales.

En una máquina con Docker iniciado, desde la raíz:

```sh
pnpm install --frozen-lockfile
docker compose --env-file .env -f infrastructure/docker-compose.yml config --quiet
pnpm test:stack
```

Crear `.env` desde `.env.example` si no existe (PowerShell: `Copy-Item .env.example .env`; Bash: `cp .env.example .env`). El script inicia/construye el stack y genera `artifacts/stack-verification.json`. Su objetivo es el stack local de desarrollo, nunca producción.

Para repetir la validación standalone en este workspace Windows:

```powershell
.cache/tools/docker-compose.exe --env-file .env -f infrastructure/docker-compose.yml config --quiet
.cache/tools/docker-compose.exe --env-file .env -f infrastructure/docker-compose.yml -f infrastructure/docker-compose.dev.yml config --quiet
```

**FASE 0 COMPLETADA**: aceptación local y Docker comprobadas. No se inició Fase 1 ni se realizaron commits o pushes.

## Validación de Fase 1A — 2026-09-16

Entorno: Windows, PowerShell, Node 24.14.0, Docker Engine 29.8.0 y Compose 5.5.1. Se conservaron los volúmenes existentes. La cuarta base se agregó con un job idempotente y la migración se aplicó con `prisma migrate deploy`; no se usó `db push`.

`node scripts/verify-identity.mjs` terminó con salida 0 y limpió únicamente el usuario temporal `fase1a.owner@ambrosia.test` y sus registros asociados. Resultados:

1. Migración versionada aplicada.
2. Bootstrap crea un OWNER, audita y rechaza el segundo.
3. Login inexistente e incorrecto devuelven el mismo error genérico.
4. Login correcto establece cookies HttpOnly/SameSite y JWT RS256 con claims mínimos, sin tokens en el cuerpo.
5. `/me` devuelve solo datos públicos; CSRF inválido produce 403.
6. Refresh rota; reutilizar el anterior revoca la familia.
7. Cinco fallos bloquean temporalmente; una cuenta inactiva no ingresa.
8. Logout es idempotente, logout-all revoca todas las sesiones y cambiar contraseña revoca las anteriores.
9. JWKS solo contiene parámetros RSA públicos y `/register` no existe.
10. Todos los refresh persistidos tienen hash hexadecimal de 64 caracteres y la auditoría no contiene nombres de campos sensibles.

`node scripts/verify-stack.mjs` también terminó con salida 0. Construyó el stack y comprobó:

- Ocho contenedores `running (healthy)` y solo el gateway con puerto publicado.
- Panel, Swagger, liveness y readiness de inventario, producción, finanzas e identidad por Nginx.
- El flujo integral anterior usando cookie jar real.
- Finanzas detenida no afecta producción; producción detenida no afecta identidad; identidad detenida no afecta producción.
- Con NATS o PostgreSQL detenidos, los cuatro readiness responden 503 y los liveness 200; todos se recuperan al reiniciar la dependencia.
- Las cuatro cuentas carecen de privilegios elevados, acceden a su propia base y los doce accesos cruzados son rechazados.
- Un marcador PostgreSQL y un mensaje JetStream sobreviven al reinicio. Ambos marcadores se eliminan al finalizar.

Compose base y desarrollo pasaron `config --quiet`. El aprovisionamiento de identidad se ejecutó de nuevo sobre el mismo volumen y terminó correctamente (`ALTER ROLE`, revocaciones y grants), lo que verifica su idempotencia. El stack final conserva ocho contenedores saludables; los jobs `identity-db-provision` e `identity-migrate` concluyeron con salida 0.

Pruebas unitarias nuevas cubren normalización, política y Argon2id, claims, rol-permisos, estados/rotación/reutilización de sesión, bloqueo, rate limit, CSRF, configuración y health. La matriz final terminó así:

| Comando                                    | Resultado real                                 |
| ------------------------------------------ | ---------------------------------------------- |
| `pnpm install --frozen-lockfile`           | Correcto; lockfile vigente, sin cambios        |
| `pnpm format:check`                        | Correcto                                       |
| `pnpm lint`                                | Correcto; nueve paquetes y scripts raíz        |
| `pnpm typecheck`                           | Correcto; nueve paquetes, Prisma generado      |
| `pnpm test`                                | Correcto; 61 pruebas en total, 29 de identidad |
| `pnpm build`                               | Correcto; siete tareas compilables             |
| Compose base y desarrollo `config --quiet` | Correcto                                       |
| `pnpm test:stack`                          | Correcto; todas las comprobaciones anteriores  |

Evidencias ignoradas localmente: `artifacts/identity-verification.json` y `artifacts/stack-verification.json`. El material RSA/CSRF local está en `secrets/auth.local.env`, también ignorado. No se imprimieron claves ni tokens en estos reportes.

## Punto de recuperación Git — 2026-09-17

Se verificó el índice antes del commit de cierre de las fases 0 y 1A: `.env`, `secrets/`, `artifacts/`, dependencias, cachés y clientes Prisma generados quedan excluidos. `.env.example` contiene únicamente ejemplos locales. La revisión de patrones de credenciales y la comparación con secretos locales no encontraron coincidencias en el índice.

Se ejecutaron `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build` mediante `npx --yes pnpm@10.34.5`; los cuatro terminaron con código 0. Turbo reutilizó la caché de las tareas de los paquetes; las 12 pruebas raíz se ejecutaron correctamente. Evidencias locales: `artifacts/git-checkpoint-{lint,typecheck,test,build}.log`. No se repitieron las verificaciones Docker ni de navegador en este cierre.

El repositorio remoto ya contenía el commit inicial `1b7736a`, con un README mínimo; se conservó como base del historial. `git diff --cached --check` señaló líneas vacías al final de siete archivos preexistentes; se conservaron sin cambios en este punto de recuperación.
