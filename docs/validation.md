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
