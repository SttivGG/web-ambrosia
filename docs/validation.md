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

## Validación de Fase 1B — 2026-09-17

Se integró el login y la protección del panel con el Identity existente, sin modificar su código. El repositorio estaba limpio al inicio. La ejecución usó Windows, PowerShell, Node 24.14.0, pnpm 10.34.5 invocado mediante `npx --yes pnpm@10.34.5`, Docker Engine 29.8.0 y Chromium de Playwright 1.58.2. Docker estaba detenido y se inició para verificar el stack.

| Comando                                      | Resultado real                                |
| -------------------------------------------- | --------------------------------------------- |
| `pnpm install --frozen-lockfile`             | Salida 0; lockfile vigente                    |
| `pnpm format:check`                          | Salida 0                                      |
| `pnpm lint`                                  | Salida 0; paquetes y scripts raíz             |
| `pnpm typecheck`                             | Salida 0; nueve tareas                        |
| `pnpm test`                                  | Salida 0; 118 pruebas únicas                  |
| `pnpm build`                                 | Salida 0; siete tareas compilables            |
| Compose base `config --quiet`                | Salida 0                                      |
| Compose base + override dev `config --quiet` | Salida 0                                      |
| `pnpm test:stack`                            | Salida 0; 13 grupos aprobados                 |
| `node scripts/verify-ui.mjs`                 | Salida 0 independiente y dentro de test:stack |
| `node scripts/verify-auth-boundary.mjs`      | Salida 0; tres comprobaciones de exposición   |
| `git diff --check`                           | Salida 0                                      |

El comando Compose completo usa `docker compose --env-file .env -f infrastructure/docker-compose.yml`; el override añade `-f infrastructure/docker-compose.dev.yml`. El archivo Compose está en infrastructure, por lo que ejecutar el comando sin esa ruta desde la raíz no selecciona el stack.

Desglose de pruebas: 60 frontend (5 existentes y 55 nuevas), 29 Identity, 15 health de servicios de negocio y 14 raíz (12 existentes y 2 nuevas). Se conservan las 61 pruebas anteriores. La suite raíz ahora usa `vitest run --dir tests` para evitar contar dos veces los archivos nuevos bajo apps/admin-web/tests.

Playwright comprobó mediante Nginx: redirección anónima sin contenido protegido; error genérico; navegación de teclado; mostrar/ocultar; login y cookies HttpOnly; datos públicos y no-store de /me; usuario/rol; recarga; redirección del login autenticado; returnTo interno/externo; cuatro readiness reales; fechas Colombia; controles de 44px; 375×812 y 812×375 sin scroll; menú móvil; caída y recuperación real de finanzas e Identity; conservación de cookies durante indisponibilidad; producción saludable con Identity detenido; JWT firmado vencido recuperado con un refresh; access ausente; refresh inválido sin bucle; logout; cambio confirmado de contraseña con revocación; ausencia de errores JavaScript, tráfico a puertos internos y datos en Web Storage. El fixture eliminó su usuario temporal y sesiones al finalizar.

La prueba de stack preservó bootstrap, cookies, /me, rotación y reutilización, logout/logout-all, cambio de contraseña, auditoría y JWKS de 1A. También comprobó independencia entre servicios, liveness/readiness durante caídas de PostgreSQL/NATS, recuperación, doce conexiones cruzadas rechazadas y persistencia PostgreSQL/JetStream. Se eliminaron los marcadores y se restauraron los servicios.

Estado final: admin-web, identity-service, inventory-service, production-service, finance-reporting-service, PostgreSQL, NATS y gateway en running/healthy. Solo gateway publica 8080 en IPv4/IPv6. Los puertos 3000–3004, 5432, 4222, 6222 y 8222 no se publican. Los jobs identity-db-provision e identity-migrate terminaron con código 0.

La revisión de exposición analiza archivos rastreados y nuevos no ignorados, bundle .next/static y logs Docker, sin imprimir valores sensibles. No detectó JWT, claves privadas, cookies completas, contraseñas ni tokens CSRF en logs; las variables y URLs privadas no aparecen en el bundle. .env, secrets y artifacts siguen ignorados. Las credenciales de .env.example son ejemplos locales.

Durante la validación se corrigieron una actualización síncrona de estado señalada por lint, referencias a Web Storage en el contexto de navegador del script y la sustitución incompleta de Identity en el gateway local. El primer intento de navegador no encontró Chromium compatible; después de instalarlo, la prueba pasó. La revisión inicial de secretos confundía .env.example con .env; se corrigió el patrón y se repitió satisfactoriamente. Estos intentos fallidos no se contabilizan como aprobados.

El modo local quedó verificado mediante configuración Compose y regresión del generador; no se levantaron simultáneamente aplicaciones del host y contenedores de aplicación. Los controles de aceptación corresponden al stack real por Nginx.

Evidencias locales ignoradas: artifacts/phase1b-{lint,typecheck,test,build}.log, artifacts/ui-verification.json, artifacts/stack-verification.json, artifacts/identity-verification.json, artifacts/auth-boundary-verification.json, artifacts/admin-desktop.png y artifacts/admin-mobile.png. El informe de entrega incluye los archivos y decisiones en delivery.md.

Git conserva cambios locales sin commit ni push. No se modificaron servicios de negocio, seguridad de Identity, permisos PostgreSQL ni NATS. No quedan pruebas de aceptación pendientes.

**FASE 1B COMPLETADA**.

En la comprobación de cierre, el motor Docker dejó de responder después de haber pasado las pruebas. Se inició nuevamente y se ejecutó `docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --no-build`. La revisión posterior confirmó otra vez los ocho contenedores saludables, solo 8080 publicado, cero usuarios temporales y la comprobación de exposición aprobada. No se reconstruyeron imágenes ni se modificaron datos de negocio para esta recuperación.

## Validación de Fase 1C — 2026-09-17

Se conservaron los cambios de Fase 1B presentes al inicio. Se implementó la autenticación distribuida en los tres servicios de negocio y se protegió Swagger en los cuatro. No se realizaron commits ni push, ni se eliminaron volúmenes o usuarios existentes.

Los comandos pnpm se ejecutaron mediante `npx --yes pnpm@10.34.5`.

| Comando                                | Resultado real                                                             |
| -------------------------------------- | -------------------------------------------------------------------------- |
| install --frozen-lockfile              | Salida 0; lockfile final vigente                                           |
| format:check                           | Salida 0; formato final verificado                                         |
| lint                                   | Salida 0                                                                   |
| typecheck                              | Salida 0                                                                   |
| test                                   | Salida 0; 175 pruebas únicas                                               |
| build                                  | Salida 0; ocho tareas compilables                                          |
| test:local                             | Salida 0; cuatro grupos HTTP con dependencias deliberadamente inaccesibles |
| test:stack                             | Salida 0; 14 grupos, reconstrucción y restauración incluidas               |
| Compose base y base+dev config --quiet | Salida 0                                                                   |
| nginx -t y nginx -s reload             | Salida 0                                                                   |
| node scripts/verify-auth-boundary.mjs  | Salida 0                                                                   |
| git diff --check                       | Salida 0                                                                   |

Se conservan las 118 pruebas anteriores y se agregan 57: 54 de nest-auth y tres de readiness con JWKS. Total por área: 60 frontend, 29 Identity, 18 health de negocio, 54 nest-auth y 14 raíz.

Las pruebas nuevas cubren extracción cookie/Bearer, credenciales idénticas y ambiguas, rechazo de query/body, firma, exp/nbf, issuer/audience, algoritmo, kid, claims y permisos inválidos, refresh opaco, caché, rotación, claves retiradas, single-flight, timeout, arranque sin JWKS y recuperación. Una aplicación Nest de prueba escucha en loopback y verifica HTTP real, guards globales, rutas públicas, denegación sin metadatos, permisos acumulativos, contexto inmutable, CSRF, origen/Referer, errores genéricos y correlación. Sus claves y JWKS simulados solo acreditan comportamiento del paquete; no se presentan como infraestructura real.

Playwright se ejecutó mediante Nginx dentro de test:stack en dos suites:

- verify-distributed-auth.mjs: 11 grupos. Login y dashboard con OWNER, ADMIN, OPERATOR y VIEWER; UI/OpenAPI/assets según matriz; cookie y Bearer; ejecución de health con Try it out; JWT firmado expirado, issuer/audience incorrectos, algoritmo inesperado, kid desconocido, token manipulado y refresh usados como access rechazados; CSRF inválido; autenticación de negocio mientras Identity está detenido; logout sin acceso posterior; cero errores JavaScript, tráfico a puertos internos o tokens en URL/Web Storage. Los usuarios se eliminaron al finalizar.
- verify-ui.mjs: 12 grupos. Conserva login, recarga, returnTo, responsive, recuperación single-flight, caídas reales, logout y cambio de contraseña con revocación. El fixture puede convivir con un OWNER existente sin modificarlo.

La prueba de stack verificó ocho contenedores saludables, health anónimo 200, Swagger anónimo 401, independencia de aplicaciones, readiness 503 durante caídas de PostgreSQL/NATS y recuperación posterior. Confirmó doce accesos PostgreSQL cruzados rechazados y persistencia de marcadores PostgreSQL/JetStream después de reiniciar; eliminó los marcadores y restauró los servicios.

La inspección de exposición revisó archivos rastreados y nuevos no ignorados, bundle de navegador y logs Docker. No encontró JWT, claves privadas, valores de cookies, contraseñas ni CSRF. Las claves y secretos locales permanecen ignorados. Ningún servicio de negocio recibe material privado de Identity.

Durante el trabajo se resolvieron estos fallos antes del cierre: el sandbox no iniciaba y las herramientas de terminal se ejecutaron con permisos revisados; Docker Desktop estaba pausado y se reinició sin eliminar volúmenes; Vitest necesitó la transformación de decoradores TypeScript; faltaba el módulo bootstrap-errors importado por cambios previos; lint detectó un import Buffer omitido; una prueba local esperaba el mensaje antiguo de configuración; Prettier señaló dos archivos. Una revisión automática también interrumpió un comando por cuota de uso, que no se ejecutó y se retomó después. Los intentos fallidos no se contabilizan como aprobados.

Evidencias locales ignoradas: artifacts/phase1c-{install,format,lint,typecheck,test,build,local,stack,boundary}.log, artifacts/distributed-auth-verification.json, artifacts/ui-verification.json, artifacts/stack-verification.json y artifacts/auth-boundary-verification.json.

El login se verificó rellenando y enviando el formulario real en Chromium automatizado; no se afirma una sesión manual adicional realizada por una persona. Los límites de revocación hasta exp, caché en memoria y CSRF de negocio basado en double-submit/origen están documentados en ADR-006.

Estado final comprobado: ocho contenedores running/healthy; solamente gateway publica 8080 en IPv4/IPv6. La consulta mediante Prisma propio de Identity devolvió cero usuarios temporales de Fases 1A/1B/1C. Stack restaurado y marcadores eliminados. Los cambios permanecen en el árbol de trabajo junto con los cambios previos, sin commits ni push.

**FASE 1C COMPLETADA**. La Fase 1 queda completada en el roadmap; Fase 2 no se inició.

## Validación de Fase 2A — 2026-09-18

Se implementaron categorías y artículos únicamente en Inventory, con contratos v1 y panel en español. No se agregaron dependencias, variables, precios, existencias, proveedores ni eventos. El lockfile permanece sin cambios. Los comandos pnpm se ejecutaron mediante `npx --yes pnpm@10.34.5`.

| Comando                                | Resultado real                                                             |
| -------------------------------------- | -------------------------------------------------------------------------- |
| install --frozen-lockfile              | Salida 0; lockfile vigente                                                 |
| lint                                   | Salida 0                                                                   |
| typecheck                              | Salida 0                                                                   |
| test                                   | Salida 0; 255 pruebas únicas                                               |
| build                                  | Salida 0; ocho tareas, incluida la ruta del catálogo                       |
| test:stack                             | 15 grupos aprobados; informe final del 18 de septiembre a las 12:31:42 UTC |
| Compose base y base+dev config --quiet | Salida 0                                                                   |
| nginx -t                               | Salida 0                                                                   |
| node scripts/verify-auth-boundary.mjs  | Salida 0; tres comprobaciones                                              |

Se conservan las 175 pruebas anteriores y se agregan 80: 73 del catálogo backend y siete del cliente frontend. Total: 67 frontend, 29 Identity, 79 Inventory, seis Production, seis Finance, 54 nest-auth y 14 raíz. Algunas tareas utilizaron la caché de Turbo; no se cuentan ejecuciones duplicadas como pruebas adicionales.

La suite de catálogo aprobó diez grupos contra PostgreSQL y Chromium reales. Aplicó la migración en un esquema aislado con la cuenta propia de Inventory, ejecutó dos veces el seed y confirmó seis categorías, cero artículos y preservación de personalizaciones. Probó unicidad, precisión Decimal, capacidades de 4/8 oz, reglas de unidades, filtros, paginación, edición simultánea y carrera entre archivar categoría y crear artículo. Comprobó persistencia tras reinicio y migrate deploy repetido, respuestas 401/403, CSRF, Bearer, credenciales ambiguas y JWT vencido.

Playwright verificó creación, edición, búsqueda, filtros, conflicto sin perder el formulario, archivado y restauración. OWNER, ADMIN y OPERATOR pudieron escribir; VIEWER solo leer, con rechazo también en llamada manual. Se revisaron escritorio, 375×812 y 812×375, sin desbordamiento horizontal, errores JavaScript, tokens en URL/Web Storage ni tráfico a puertos internos. Las capturas se inspeccionaron visualmente. Las suites anteriores de autenticación distribuida (11 grupos) y panel (12 grupos) también pasaron por Nginx.

El stack aprobó los 15 grupos, incluyendo ocho contenedores saludables, únicamente gateway con puerto publicado, independencia de servicios, caídas y recuperación de NATS/PostgreSQL, doce conexiones cruzadas rechazadas y persistencia PostgreSQL/JetStream. La limpieza del catálogo confirmó la eliminación de registros, esquema aislado y usuarios temporales. El seed no se ejecutó contra el catálogo operativo.

La revisión de exposición comprobó archivos, bundle y logs sin encontrar secretos, cookies completas, JWT ni claves privadas. Los artifacts y secretos locales siguen ignorados. No se realizaron commits ni push.

Durante la validación se corrigieron el default de trackInventory en PATCH, la lectura de metadatos de unicidad del adaptador PostgreSQL, nombres accesibles de filtros y sincronización de las pruebas de navegador. El disco del sistema se llenó durante Docker build; se liberaron cachés regenerables y se recuperó Docker conservando los volúmenes. Los intentos fallidos no se contabilizan como aprobados. Después del último informe satisfactorio, Docker Desktop se detuvo; la comprobación de cierre se registra a continuación por separado.

Evidencias locales ignoradas: artifacts/phase2a-{install,format,lint,typecheck,test,build,stack,boundary}.log, artifacts/catalog-verification.json, artifacts/stack-verification.json, artifacts/distributed-auth-verification.json, artifacts/ui-verification.json y capturas artifacts/catalog-*.png. La entrega y sus límites están documentados en delivery.md; las reglas y operación, en catalog.md y ADR-007.

Comprobación de cierre: Docker Desktop se inició de nuevo y `docker compose --env-file .env -f infrastructure/docker-compose.yml up -d --no-build` terminó con salida 0. Los ocho contenedores permanentes quedaron running/healthy; solamente gateway publica 8080 en IPv4/IPv6. Los jobs identity-db-provision, identity-migrate e inventory-migrate terminaron con código 0. Se conservaron los volúmenes y las imágenes verificadas.

`pnpm format:check` y `git diff --check` terminaron con salida 0 tras actualizar la documentación. La revisión final de exposición volvió a aprobar sus tres comprobaciones con Docker restaurado. El roadmap marca Fase 2 — En progreso: 2A completada; Fase 2B sigue pendiente.

**FASE 2A COMPLETADA**.

## Corrección de categorías y ayuda de capacidad — 2026-09-18

- Diagnóstico local: Inventory tenía cero categorías activas. Se ejecutó el seed existente, que incorpora las seis categorías iniciales sin sobrescribir registros.
- El panel bloquea Nuevo artículo durante la carga, ante error o sin categorías activas; en el último caso explica cómo crear/restaurar categorías y ofrece Crear categoría.
- Se aclararon los campos de capacidad con ejemplos de 4 onzas y 1 litro, la opción No aplica y ayuda asociada mediante aria-describedby.
- Validaciones ejecutadas: pnpm lint, pnpm typecheck, pnpm test y pnpm build mediante npx pnpm@10.34.5; todas terminaron con código 0. ESLint del script de verificación también pasó después de actualizarlo.
- Se reconstruyó y levantó admin-web en Docker. node scripts/verify-catalog.mjs terminó con código 0, incluido el nuevo escenario de categorías vacías simulado en el navegador, selección de categorías y guardado real de leche y empaques de 4/8 oz. Los fixtures temporales se eliminaron.
- Evidencia: artifacts/catalog-verification.json. El login y readiness de Inventory respondieron HTTP 200 tras las pruebas.

## Validación de Fase 2B, 2026-09-19

**FASE 2B COMPLETADA**. Directorio de proveedores, asociaciones y panel verificados con PostgreSQL y Chromium reales. No se hicieron commits, push, merge ni despliegues externos.

Inicio: rama feature/fase-1b-panel-auth, HEAD a33d556 (catálogo 2A), origin https://github.com/SttivGG/web-ambrosia.git y árbol limpio. No se cambió de rama ni se hizo pull. La línea base confirmó 255 pruebas (Turbo reutilizó caché; las 14 raíz se ejecutaron de nuevo), además de formato, lint, tipos y build con salida 0. Primero se instalaron las dependencias frozen y se generaron los cuatro clientes Prisma.

Todos los comandos pnpm usaron npx --yes pnpm@10.34.5.

| Comando                                                   | Resultado real                                            |
| --------------------------------------------------------- | --------------------------------------------------------- |
| install --frozen-lockfile                                 | Salida 0; lockfile intacto                                |
| -r --if-present generate                                  | Salida 0; cuatro clientes propios                         |
| format:check                                              | Salida 0                                                  |
| lint                                                      | Salida 0                                                  |
| typecheck                                                 | Salida 0                                                  |
| test                                                      | Salida 0; 325 pruebas                                     |
| build                                                     | Salida 0; ocho tareas compilables                         |
| --filter @ambrosia/inventory-service exec prisma validate | Salida 0                                                  |
| git diff --check                                          | Salida 0                                                  |
| node scripts/prepare-suppliers.mjs --migrate              | Salida 0; respaldo, ensayo aislado, deploy y conservación |
| Migrador: node scripts/prepare-suppliers-isolated.mjs     | Salida 0; repetido con el script ESM final                |
| node scripts/verify-suppliers.mjs                         | Salida 0; seis grupos, también dentro del stack           |
| test:stack                                                | Salida 0; 16 grupos, cierre a las 21:16:43 UTC            |
| node scripts/verify-auth-boundary.mjs                     | Salida 0; tres comprobaciones                             |

Se conservan las 255 pruebas anteriores y se agregan 70: 59 de contratos/servicio y 11 web (siete de cliente, cuatro DOM). Totales: Inventory 138, frontend 78, Identity 29, nest-auth 54, Production seis, Finance seis y raíz 14. Las pruebas con dobles verifican contratos y comportamiento unitario; no se cuentan como PostgreSQL o navegador reales. Algunas tareas reutilizaron la caché de Turbo.

### Migración y conservación

Docker estuvo detenido al retomar y se solicitó iniciarlo. Después se confirmó el contexto local desktop-linux, ocho contenedores saludables y solo gateway publicando 8080.

Respaldo previo a la primera migración: artifacts/backups/inventory-before-2b-2026-09-19T14-31-33-666Z.dump, ignorado por Git. pg_restore pudo listar y decodificar el archivo completo. SHA-256: c13e1bfc3d29600d852269ad823643c6a5e5bdeb4097649e82a13f18086679e6. Las credenciales configuradas se utilizaron dentro del contenedor sin imprimirlas.

El ensayo aislado aprobó instalación limpia, actualización desde 2A con categoría y artículo existentes y migrate deploy repetido. Se aplicó 202609190001_suppliers y se repitió deploy sin migraciones pendientes. La comparación completa de Category y CatalogItem antes/después fue idéntica y se repitió después de todas las suites: SHA-256 c5ae5048984896af9d6499f13892f59567eb6825fdb8a4f516d8a24d7cd58004. No se editaron migraciones anteriores ni se borraron datos existentes o volúmenes.

### API, concurrencia y navegador

La suite de proveedores aprobó validación estricta, unicidad también archivada, PATCH parcial, conservación de asociaciones omitidas, filtros, orden/paginación, estado y versiones obsoletas. PostgreSQL real verificó carreras de edición, asociación y archivado. Un trigger temporal limitado al UUID de un fixture provocó un fallo SQL después de escribir el proveedor; la transacción revirtió el registro y sus asociaciones completos. El trigger se eliminó en finally.

Playwright verificó creación, errores por campo, selección paginada conservada, conflicto sin pérdida de notas o selecciones, comparación de campos y artículos, decisión explícita, cancelación, archivado/restauración y detalle de consulta. OWNER, ADMIN y OPERATOR escriben; VIEWER consulta y recibe rechazo al intentar escribir. Las pruebas DOM adicionales comprobaron bloqueo de doble envío y cierre durante guardado, errores asociados y confirmación de descarte.

Se inspeccionaron capturas de 1440×1000, 375×812 y 812×375. Las comprobaciones no encontraron desbordamiento horizontal, errores JavaScript, tokens en URL/Web Storage ni peticiones del navegador a puertos internos. Tras traducir los nombres de identificación, se reconstruyó admin-web, se confirmó la traducción en el bundle servido y se repitieron los seis grupos de proveedores sobre la imagen final.

test:stack conservó las regresiones de identidad, autenticación distribuida (11 grupos), catálogo (11 grupos) y panel. Aprobó independencia de servicios, caída y recuperación de PostgreSQL/NATS, doce accesos cruzados rechazados y persistencia PostgreSQL/JetStream. La suite de proveedores también reinició Inventory y comprobó persistencia del registro completo.

### Cierre

La revisión de exposición aprobó archivos, bundle y logs sin detectar claves privadas, JWT, cookies completas, contraseñas o CSRF. El respaldo y artifacts permanecen ignorados. El lockfile no cambió y no se agregaron dependencias, servicios ni puertos.

Comprobación final a las 21:20:29 UTC: ocho contenedores running/healthy (admin-web, Identity, Inventory, Production, Finance, PostgreSQL, NATS y gateway). Solo gateway publica 8080 en IPv4/IPv6. Los jobs de provisión y migración terminaron con código 0. Cero proveedores, artículos, categorías, esquemas, triggers y usuarios temporales de 2B; stack restaurado.

Durante el trabajo se corrigieron la admisión de fixtures fase2b, sincronización de búsqueda en Playwright, nombres accesibles de etiquetas/filtros, estilos de botones/casillas y traducción de identificaciones. El ejecutor aislado no iniciaba y se usó ejecución revisada; hubo interrupciones por cuota del revisor automático. Los intentos fallidos no cuentan como aprobados. No se eliminaron pruebas anteriores ni se redujeron sus aserciones; la prueba de migración de catálogo ahora espera las dos migraciones aplicadas.

Evidencias: artifacts/phase2b-*.log, suppliers-migration.json, suppliers-verification.json, stack-verification.json, catalog-verification.json, distributed-auth-verification.json, ui-verification.json, auth-boundary-verification.json y phase2b-final-state.json dentro de artifacts, junto con suppliers-{1440,375,812}.png.

No quedan verificaciones operativas pendientes. Los límites de 500 asociaciones, búsqueda contains, paginación por desplazamiento, revisión manual de conflictos y normalización sin verificación oficial están en suppliers.md y ADR-008.

## DakaDesing con Steep — 2026-09-20

Aplicado al frontend existente: acceso, navegación, inicio, catálogo y proveedores. SweetAlert2 11.26.25 reemplaza las tres llamadas a window.confirm para descartar cambios. Se mantienen formularios, permisos, conflictos y beforeunload nativo. Sistema visual y decisiones en [design.md](design.md).

Validación final completada el 2026-09-20 a las 02:31 UTC:

| Comando                        | Resultado                                     | Evidencia                          |
| ------------------------------ | --------------------------------------------- | ---------------------------------- |
| pnpm lint                      | Aprobado                                      | artifacts/dakadesing/lint.log      |
| pnpm typecheck                 | Aprobado                                      | artifacts/dakadesing/typecheck.log |
| pnpm test                      | Aprobado; 82 pruebas de frontend y 14 de raíz | artifacts/dakadesing/test.log      |
| pnpm build                     | Aprobado                                      | artifacts/dakadesing/build.log     |
| node scripts/verify-design.mjs | Cuatro grupos aprobados                       | artifacts/dakadesing/results.json  |

Turbo reutilizó resultados de paquetes sin cambios; frontend se verificó nuevamente. Las pruebas de notificaciones comprueban conservación del DOM y foco tras ambas respuestas, y bloqueo de envíos mientras la confirmación está pendiente. Las pruebas de raíz se ejecutaron sin caché de Turbo.

Playwright ejecutó la interfaz compilada con un servidor de identidad local ficticio y respuestas interceptadas: sin bases de datos ni credenciales reales. Login comprobado a 1440 y 375 px; inicio, catálogo y proveedores a 1440, 768 y 375 px, sin desbordamiento horizontal. SweetAlert2 comprobó foco inicial en Seguir editando, cancelación, Escape, preservación de valores y descarte sin solicitudes de mutación. No hubo errores JavaScript ni diálogos nativos inesperados. Capturas PNG en artifacts/dakadesing, ignorado por Git.

Se inspeccionaron visualmente las capturas del inicio de escritorio, login de escritorio, catálogo móvil y confirmación móvil. Se corrigió el fondo de la confirmación y la codificación UTF-8 de textos durante la revisión; después se repitieron los cuatro comandos y la prueba visual. Los intentos previos fallidos no cuentan como aprobados.

Límite: esta revisión visual utiliza fixtures y no reemplaza las verificaciones de integración con servicios reales registradas para fases anteriores. No se desplegó ni reconstruyó el stack Docker, no se alteraron bases de datos y no se realizaron commits ni push. El ejecutor visual usa el script start de Next.js; emite una advertencia por output standalone, aunque la ejecución local y sus aserciones completaron correctamente.

## Fase 3 — Compras e inventario, 2026-09-22

Estado: COMPLETADA, Fases 3A y 3B. Cierre el 2026-09-22 a las 23:43 America/Bogota (2026-09-23T04:43Z).

Inicio: rama main, HEAD 2ec5923, árbol limpio; se leyó README, arquitectura, ADR-001 a ADR-008, roadmap, entrega, validación, esquemas, contratos, gateway, Compose, pruebas y panel existentes. No se cambió de rama ni se ejecutó Git de escritura.

### Migración, respaldo y datos

SQL revisado: services/inventory-service/prisma/migrations/202609220001_purchases_inventory/migration.sql. Solo agrega Purchase, PurchaseLine, InventoryBalance, InventoryMovement, enums, índices, claves foráneas restrictivas y checks en tablas nuevas. No contiene DROP, TRUNCATE, conversión de columnas ni eliminación de datos.

Comando aplicado: node scripts/prepare-purchases.mjs --migrate. Comprueba Docker local/PostgreSQL activo, genera pg_dump -Fc --no-owner --no-acl con la cuenta de Inventory dentro del contenedor, verifica pg_restore --list y pg_restore --file=/dev/null, registra SHA-256 y obtiene instantánea de Category, CatalogItem, Supplier y SupplierItem. No imprime credenciales.

Respaldo anterior a la migración real: artifacts/backups/inventory-before-3-2026-09-22T18-18-08-081Z.dump. SHA-256 a0767922ffd33d957820e310859c06465aae2965f8a46e9db8f54cdeead4a1c2. El informe artifacts/purchases-migration.json confirma readable, isolated, migrated y preserved en true. Instantánea de datos originales: SHA-256 e49d78cafd9ce02a646247829fb0120e009e7394057eae02c1fed8c3931bdd9c.

El migrador ensayó instalación limpia y actualización desde ambas migraciones 2A/2B en esquemas aleatorios de Inventory, repitió deploy y verificó conservación. Después de aprobar el ensayo aplicó migrate deploy al esquema operativo y lo repitió sin migraciones pendientes. Los esquemas temporales se eliminaron en finally. No se eliminaron volúmenes ni se usó migrate reset.

### PostgreSQL real

prepare-purchases-isolated.mjs ejecuta servicios compilados con Prisma propio sobre esquemas PostgreSQL reales. Pasó creación/edición de compra, cálculo decimal y dígitos por encima de MAX_SAFE_INTEGER; carreras de edición y doble recepción con un único éxito; carrera de dos descuentos de 8 sobre saldo 10 con saldo final 2; rechazo de reversión insuficiente; reposición, idempotencia de ajuste y reversión completa; cancelación de borrador sin movimientos; filtros/paginación; constraint contra saldo negativo y reconciliación.

Un trigger temporal falla al insertar el movimiento del segundo artículo: ningún cambio de estado, movimiento o saldo persiste. Se elimina en finally. Esto valida rollback después de efectos parciales dentro de la transacción, no únicamente validación previa.

### API y Playwright reales

node scripts/verify-purchases.mjs aprobó siete grupos en ejecución independiente. No intercepta respuestas. Comprueba API por Nginx, validación, IDs, proveedor ausente, Decimal, referencias únicas, CSRF, versiones, estados, recepción repetida, unidad histórica protegida, ajustes, reversión, filtros, enlace inequívoco a compra/detalle y Swagger generado de contratos.

Playwright inició sesión, seleccionó proveedor y artículo, guardó borrador, provocó una edición concurrente real, comprobó preservación de observaciones, comparó/adoptó versión, guardó, recibió, consultó existencias y abrió el movimiento. Después confirmó un ajuste y comprobó el nuevo saldo.

OWNER, ADMIN y OPERATOR gestionaron compras; VIEWER consultó y recibió 403 en compras/ajustes, con controles ocultos en interfaz. Se reinició Inventory y se verificó persistencia y reconciliación. Cero errores JavaScript, tokens en URL/Web Storage o tráfico a puertos internos.

Capturas reales 1440×1000, 375×812 y 812×375, sin desbordamiento horizontal. Se inspeccionaron escritorio, móvil y formulario de conflicto. Fixtures propios de compras, ledger, saldos, artículos, proveedores, categorías y usuarios se eliminaron. Evidencia: artifacts/purchases-verification.json y artifacts/phase3/stocks-*.png.

### Matriz de cierre

| Comando                                                                                      | Resultado                                              |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| pnpm install --frozen-lockfile                                                               | Aprobado; lockfile vigente                             |
| pnpm lint                                                                                    | Aprobado; salida 0                                     |
| pnpm typecheck                                                                               | Aprobado; salida 0                                     |
| pnpm test                                                                                    | Aprobado; 389 pruebas: 329 heredadas y 60 nuevas       |
| pnpm build                                                                                   | Aprobado; ocho tareas, incluidas las tres rutas nuevas |
| pnpm format:check                                                                            | Aprobado; todos los archivos cumplen Prettier          |
| pnpm --filter @ambrosia/inventory-service exec prisma validate                               | Aprobado                                               |
| docker compose --env-file .env -f infrastructure/docker-compose.yml config --quiet           | Aprobado                                               |
| docker compose --env-file .env -f infrastructure/docker-compose.yml exec -T gateway nginx -t | Aprobado                                               |
| node scripts/prepare-purchases.mjs --migrate                                                 | Aprobado: respaldo, ensayo, migración y conservación   |
| node scripts/verify-purchases.mjs                                                            | Aprobado: siete grupos reales                          |
| pnpm test:stack                                                                              | Aprobado; 17 grupos, salida 0                          |
| node scripts/verify-auth-boundary.mjs                                                        | Aprobado; tres comprobaciones                          |
| node scripts/verify-purchases-state.mjs                                                      | Aprobado; integridad, limpieza y salud final           |
| git diff --check                                                                             | Aprobado tras el cierre documental                     |

Totales unitarios finales: Inventory 184, frontend 96, Identity 29, nest-auth 54, Production seis, Finance seis y raíz 14. Se agregaron 46 backend y 14 frontend, sin eliminar pruebas heredadas. Algunas tareas reutilizaron la caché de Turbo; no se cuentan ejecuciones repetidas como pruebas adicionales. Los grupos PostgreSQL/Playwright se registran por separado.

### Incidencias corregidas y límites

El primer ensayo PostgreSQL detectó que el DTO estricto del detalle recibía purchaseId interno. El procedimiento bloqueó la migración operativa; se corrigió la serialización, se añadió regresión unitaria y se repitió satisfactoriamente el ensayo. No se contabiliza el intento fallido como aprobado.

Playwright detectó una etiqueta de textarea cuyo nombre incluía el texto escrito: el formulario conservaba datos, pero el selector exacto dejaba de encontrarlo. Se estabilizó su nombre accesible. También se impide mostrar acciones sobre listas obsoletas mientras se recargan y se probaron respuestas tardías. La repetición real pasó.

El ejecutor aislado no inicia procesos; se utilizó ejecución revisada. Una revisión automática rechazó un comando por cuota y no se ejecutó; tras la instrucción de continuar se retomó desde los archivos existentes. Docker Desktop estuvo detenido y se inició desde su instalación vigente por usuario, sin eliminar datos. Se corrigieron referencias de entorno de lint y argumentos de formateo; los fallos iniciales no cuentan como validaciones aprobadas.

No se hizo commit, push, merge, rebase ni despliegue a producción. Solo se reconstruyó el stack local autorizado para validación.

### Cierre integral

La ejecución final de pnpm test:stack terminó con salida 0 y 17 grupos aprobados, incluida la suite de siete grupos de compras sobre las imágenes finales. Conserva autenticación, catálogo, proveedores y panel; verifica caídas/recuperación de NATS y PostgreSQL, independencia de servicios, doce conexiones cruzadas rechazadas y persistencia PostgreSQL/JetStream. La especificación Swagger final incluye errores de autenticación y un ejemplo de creación con decimales como texto, comprobados por API real.

La regresión heredada de proveedores esperaba window.confirm, sustituido por SweetAlert2 en el rediseño anterior. Se actualizó únicamente la prueba para comprobar Seguir editando, conservación del valor, Descartar cambios y ausencia de persistencia del descarte. La repetición integral aprobó sus seis grupos. Un intento posterior falló al ejecutar compose up; una reconstrucción directa terminó correctamente y la repetición completa pasó. No se atribuye una causa no comprobada ni se contabilizan esos intentos como éxitos.

La revisión de seguridad aprobó exclusiones Git, fuentes, bundle y logs: sin claves privadas, JWT, cookies completas, contraseñas ni CSRF expuestos. El gateway rechazó con 413 una solicitud anónima de 17 000 bytes a compras. No se añadieron servicios ni puertos; las credenciales locales y respaldos permanecen ignorados.

Comprobación final a las 2026-09-23T04:43:52.989Z: Category, CatalogItem, Supplier y SupplierItem idénticos a la instantánea previa, SHA-256 e49d78cafd9ce02a646247829fb0120e009e7394057eae02c1fed8c3931bdd9c. Cero compras/usuarios/esquemas temporales de Fase 3, ningún contenedor temporal en ejecución y ledger reconciliado. Ocho servicios running/healthy; solo gateway publica 8080 en IPv4/IPv6. No quedan verificaciones pendientes.

Evidencias: artifacts/phase3/{lint,typecheck,test,build,format,stack,security,state}-final.log, compose-final.log y final-state.json; artifacts/{purchases-migration,purchases-verification,stack-verification,auth-boundary-verification}.json; capturas artifacts/phase3/stocks-{1440,375,812}.png. Los archivos de evidencia y el respaldo no están rastreados por Git. Los límites de alcance y operación están en purchases.md y ADR-009.

## Fase 4 — Producción completada (2026-09-24)

Baseline: main e1a2db5cc2eb1902fb8737677636dc962fac5d41, árbol limpio; 389 pruebas heredadas aprobadas (375 sin caché y 14 de raíz), ocho contenedores saludables y solo gateway:8080 publicado. El usuario confirmó preservar ADR-002 y sustituir atomicidad global por coordinación persistente e idempotente.

prepare-production.mjs --migrate aprobó respaldo legible de ambas bases, ensayos limpios y de actualización, deploy repetido y conservación exacta de filas/columnas preexistentes. PostgreSQL aislado aprobó solicitudes duplicadas, payload distinto, compensación idempotente, rechazos persistentes, rollback tras primera línea, dos consumos concurrentes de ocho sobre saldo diez, saldo final dos, constraint no negativo y reconciliación del ledger. Evidencia: artifacts/production-migration.json y artifacts/phase4-migration.log.

### Matriz de cierre

| Comando                                          | Resultado                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| pnpm install --frozen-lockfile                   | Aprobado; sin actualización de versiones                                         |
| pnpm lint                                        | Aprobado                                                                         |
| pnpm typecheck                                   | Aprobado                                                                         |
| pnpm test                                        | Aprobado: 428 pruebas, 389 heredadas y 39 nuevas                                 |
| pnpm build                                       | Aprobado: ocho tareas                                                            |
| pnpm format:check                                | Aprobado                                                                         |
| prisma validate en Inventory y Production        | Ambos esquemas válidos                                                           |
| docker compose config --quiet y gateway nginx -t | Aprobados                                                                        |
| node scripts/prepare-production.mjs --migrate    | Dos respaldos verificados, ensayos aislados, deploy repetido y datos conservados |
| node scripts/verify-production.mjs               | Siete grupos aprobados con PostgreSQL, HTTP y Playwright reales                  |
| pnpm test:stack                                  | 18 grupos aprobados, salida 0                                                    |
| node scripts/verify-production-state.mjs         | Datos intactos, ledger reconciliado, limpieza y salud final                      |
| node scripts/verify-auth-boundary.mjs            | Tres grupos aprobados; credencial técnica ausente de fuentes, bundle y logs      |
| git diff --check                                 | Aprobado                                                                         |

Totales unitarios: Inventory 191, Production 26, frontend 108, Identity 29, nest-auth 54, Finance seis y raíz 14. Son 27 pruebas backend y 12 frontend nuevas; no se eliminaron pruebas heredadas. Algunas tareas reutilizaron caché de Turbo; las repeticiones no suman pruebas. PostgreSQL/Playwright y test:stack se contabilizan por separado.

### Migraciones y conservación

Tres migraciones aditivas: Inventory 202609240001_production_types y 202609240002_production_operations; Production 202609240001_production. Las migraciones históricas permanecen intactas. Se verificó instalación limpia, actualización desde Fase 3 y repetición de deploy sin cambios adicionales.

Respaldos locales ignorados por Git, comprobados mediante listado y decodificación completos:

- artifacts/backups/inventory-before-phase4-1790262563954.dump; SHA-256 09a602b28fedc88e07cc83281217d64cdeae9b1132d820b7fa47e4bf961e5f5d.
- artifacts/backups/production-before-phase4-1790262569645.dump; SHA-256 8a6df84cb4de91cb785332edf4fca8e8d4ebe71433571ec8c5743f24d6e5bc2b.

La comparación posterior a la migración conservó todas las filas y columnas preexistentes. La comparación después de todas las suites, a las 2026-09-24T19:38:47.654Z, confirmó los datos de negocio de Inventory y Production idénticos a la instantánea anterior a las pruebas: SHA-256 b041e6716a324ebaf807988035cfbfdebc978a0cc25c7549a54487a45a908995. Sin fixtures ni esquemas temporales y con ledger reconciliado.

### PostgreSQL y recuperación entre servicios

Las pruebas ejecutan los servicios reales con sus propios clientes y bases. Cubren UUID duplicado concurrente, UUID equivalente en mayúsculas, reutilización con payload distinto, rechazo persistente antes del consumo y prevención de otro consumo del mismo lote con un UUID alternativo. Dos lotes compiten por ocho unidades sobre saldo diez: solo uno consume y el saldo final es dos. Un trigger que falla al insertar el segundo movimiento revierte operación, primera línea y todos los saldos. El constraint rechaza saldo negativo y el ledger coincide con la proyección.

La suite de recuperación inyecta un fallo de red antes del consumo, pérdida de respuesta después del commit de Inventory y un fallo PostgreSQL al actualizar Production después de ese commit. El lote conserva una operación pendiente y un nuevo coordinador recupera el mismo UUID sin duplicar movimientos. También verifica pérdida de respuesta durante compensación, movimientos inversos trazables e idempotencia. No usa transacciones distribuidas.

### API, interfaz y regresiones

Playwright utiliza el gateway real, sin respuestas interceptadas. Crea fórmulas y lotes, provoca un conflicto de edición con una petición concurrente real, comprueba conservación de campos y comparación/adopción de versión, inicia producción y abre detalle/ledger. Valida compensación y cierre lógico desde la interfaz, revisiones históricas y desactivación/reactivación de fórmulas. Capturas de 1440, 768 y 375 píxeles sin desbordamiento horizontal; escritorio y móvil inspeccionados. Cero errores JavaScript.

OWNER, ADMIN y OPERATOR escriben; VIEWER consulta y recibe 403 al escribir, con controles ocultos. Se comprueban anónimos, CSRF, Swagger protegido, rutas internas bloqueadas por gateway y persistencia tras reiniciar servicios. Los fixtures propios y usuarios se eliminan al terminar.

La ejecución completa de test:stack finalizó a las 2026-09-24T19:25:02.267Z con 18 grupos aprobados. Conserva autenticación, catálogo, proveedores, compras y panel; incluye producción, independencia de servicios, caída/recuperación de NATS y PostgreSQL, doce conexiones cruzadas rechazadas y persistencia PostgreSQL/JetStream. Tras un último ajuste de texto en el selector de fórmulas, se repitieron typecheck y las 108 pruebas del panel, build, lint y la suite completa de siete grupos de Producción sobre su imagen final. No quedan verificaciones pendientes.

### Seguridad, alcance y evidencias

La revisión enfocada comprobó guards, permisos, CSRF, credencial técnica exclusiva, comparación de longitud en bytes y autenticación constante en tiempo, bloqueo de rutas internas y ausencia del secreto en fuentes, bundle y logs. No se realizó una auditoría externa. Se mantienen ocho servicios running/healthy y únicamente gateway:8080 publicado. production-migrate es un job temporal. No se comparten clientes Prisma ni se consultan bases ajenas desde los servicios.

Los ensayos detectaron y se corrigieron la normalización de UUID, el retorno seguro a las rutas nuevas y la aplicación de estilos compartidos al panel. Las repeticiones pasaron; los intentos fallidos no se contabilizan como éxitos.

Evidencias locales: artifacts/phase4-{install,lint,typecheck,test,build,format-check,migration,api-ui,stack,security,state}.log; artifacts/{production-migration,production-verification,stack-verification,auth-boundary-verification}.json; artifacts/phase4/{before-tests,final-state}.json y production-{1440,768,375}.png. Los artefactos, respaldos y secretos permanecen ignorados por Git.

Fase 4 completada. Fase 5 permanece pendiente. Sin commit, push ni despliegue externo.
