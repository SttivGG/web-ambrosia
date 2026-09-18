# Entrega de Fases 1B y 1C

**FASE 1C COMPLETADA**. Autenticación distribuida, RBAC y Swagger verificados; 175 pruebas y stack real aprobados. La sección Fase 1C detalla los cambios y límites.

**FASE 1B COMPLETADA**. Fecha: 2026-09-17. Login y sesión del panel administrativo integrados con Identity mediante Nginx. La matriz de ejecución y el estado final se registran en [validation.md](validation.md).

## Implementación y archivos

```text
apps/admin-web/
  app/(auth)/login/page.tsx                 creado
  app/(protected)/{layout.tsx,dashboard/page.tsx} creado
  app/forbidden/page.tsx                   creado
  app/{page.tsx,globals.css,status.ts,service-status.tsx} modificados
  components/auth/{login-form,password-field,session-gate,session-provider,user-menu}.tsx
  components/layout/admin-shell.tsx        creado
  lib/auth/{client,config,errors,return-to,server}.ts creados
  lib/api/authenticated-fetch.ts           creado
  proxy.ts                                creado
  tests/{auth,server}.test.ts              creados
  tests/components.test.tsx                creado
  next.config.ts, package.json             modificados
packages/contracts/src/auth-v1.ts          esquemas de respuestas existentes
scripts/{verify-ui,verify-stack,compose,dev}.mjs modificados
scripts/{dev-gateway,verify-auth-boundary}.mjs creados
tests/dev-gateway.test.ts                  creado
infrastructure/docker-compose.yml          URL privada de Identity para Next
.env.example, turbo.json, package.json, pnpm-lock.yaml
README.md, docs/{roadmap,validation,delivery,dependencies}.md
docs/architecture/{system-overview,deployment}.md
docs/adr/ADR-005-identity-and-session-security.md
```

Los servicios de negocio y el código de Identity permanecen sin modificaciones. No se agregaron contenedores, reglas de dominio, guardias JWT/RBAC ni protección de Swagger.

## Sesión y protección

Las páginas y el layout siguen siendo Server Components. El módulo `server-only` consulta `/api/v1/auth/me` mediante `IDENTITY_INTERNAL_URL`, con timeout de cinco segundos, `cache: no-store`, redirecciones deshabilitadas y solo la cookie access. Valida la respuesta con el esquema compartido y distingue usuario autenticado, ausencia de sesión, expiración, indisponibilidad y respuesta inválida. React cache evita duplicar la consulta dentro del mismo render, sin compartir sesiones entre solicitudes.

`proxy.ts` realiza la comprobación preliminar; el layout y la página protegida confirman la sesión con Identity antes de renderizar contenido. Las páginas autenticadas tienen `Cache-Control: private, no-store`. El proxy permite login, forbidden, health y assets. Las APIs públicas siguen pasando por Nginx; su autorización pertenece a la fase siguiente.

`ambrosia_refresh` conserva `Path=/api/auth`; no llega a `/dashboard`. La presencia del binding CSRF es solo un indicio de una posible sesión recuperable. No autoriza contenido. Un access vencido o ausente con binding muestra “Verificando sesión”. El navegador obtiene CSRF, renueva y consulta `/me`. Un 401 termina en login. Una caída o respuesta inválida muestra un estado temporal con reintento y conserva las cookies.

La recuperación usa un intento por navegación y una marca `sessionChecked` para impedir que una discrepancia posterior del servidor provoque un bucle. El shell elimina esa marca después de una validación correcta; el botón Reintentar inicia una navegación nueva. La cookie binding puede existir después de un login fallido: el único efecto es un intento de refresh rechazado.

El proveedor React contiene usuario, rol, permisos y estado, sin Web Storage. Se inicializa con `/me` del servidor, recibe cambios del cliente central y vuelve a validar al recuperar el foco y cada minuto con la pestaña visible. Si la comprobación queda indisponible, oculta el panel y ofrece reintentar.

Referencia de implementación: [Proxy de Next.js](https://nextjs.org/docs/app/api-reference/file-conventions/proxy) y [autenticación](https://nextjs.org/docs/app/guides/authentication).

## Flujos

Login obtiene CSRF antes de enviar correo y contraseña, valida la respuesta, consulta `/me`, navega a un destino permitido y refresca Server Components. Un bloqueo de cuenta recibe el mismo mensaje que las credenciales incorrectas porque Identity devuelve el mismo 401: la interfaz no intenta descubrir el estado de la cuenta.

Logout obtiene CSRF, llama al endpoint idempotente, limpia React, navega a login y refresca. Si Identity falla, muestra un error seguro sin afirmar que cerró la sesión. JavaScript no elimina cookies HttpOnly.

El cambio de contraseña usa una sección desplegable con contraseña actual, nueva y confirmación. Aplica la política de 12–128 caracteres, letra y número Unicode, evita reutilizar la actual y exige confirmar la revocación de sesiones. Después del éxito limpia estado/campos, navega al login y pide ingresar nuevamente. No incluye recuperación de contraseña ni una página de perfil.

El cliente también expone `logoutAll()`. No se implementa administración de sesiones.

## CSRF, concurrencia y reintentos

El token CSRF procede exclusivamente de la respuesta validada de `/api/auth/csrf`. Cada mutación solicita uno reciente; solicitudes simultáneas comparten la misma promesa. Se envía en `X-CSRF-Token` y nunca se persiste.

Solo se repite una mutación cuando Identity devuelve 403 de CSRF/origen, antes de sus efectos, y únicamente una vez con CSRF nuevo. No se repiten fallos de red ni respuestas ambiguas.

`authenticatedFetch` admite rutas relativas `/api/`. Ante un 401, GET y HEAD comparten un refresh y repiten la lectura una sola vez. Una revisión de sesión evita otra renovación por respuestas 401 que llegaron tarde. Login, refresh, logout, logout-all y CSRF están excluidos. POST, PUT, PATCH y DELETE no se repiten automáticamente; el usuario debe volver a enviar la operación. Una renovación fallida limpia el estado de usuario y navega al login.

La coordinación single-flight corresponde a una instancia del cliente en una pestaña. La coordinación de renovaciones entre pestañas o dispositivos no forma parte de esta entrega; la detección de reutilización de Identity permanece activa.

## Rutas e interfaz

`/` dirige al login o dashboard según el estado. Un usuario con sesión válida que entra a `/login` va a `/dashboard`. `returnTo` permite el dashboard y sus subrutas con parámetros internos; rechaza protocolos, doble slash, barras invertidas, controles, rutas normalizadas fuera del panel y otros destinos. Una lista acotada evita redirigir a endpoints de mutación.

El shell muestra usuario, rol, sesión activa y cuatro servicios reales. Solo Inicio funciona; Compras, Inventario, Producción, Finanzas e Informes muestran “Próximamente”. Fechas en Colombia, transporte UTC, sin datos simulados ni reglas de permisos reconstruidas.

La interfaz conserva la paleta verde y crema. Incluye labels visibles, gestores de contraseña, controles mostrar/ocultar, foco visible, mensajes accesibles, enlace para saltar al contenido, menú móvil y controles táctiles de 44 px. Los formularios bloquean envíos concurrentes y enfocan el error.

## Configuración y desarrollo

Nueva variable privada: `IDENTITY_INTERNAL_URL`. Ejemplo local: `http://127.0.0.1:3004`; Compose inyecta `http://identity-service:3004`. Su validación rechaza credenciales, rutas, query, fragmentos y protocolos ajenos a HTTP(S). No usa `NEXT_PUBLIC_`.

`pnpm dev` deriva la URL del puerto local de Identity cuando no hay una URL explícita. El generador de gateway ahora reemplaza las cuatro apariciones de Identity; antes solo sustituía una. Una prueba de regresión verifica esa corrección. Si se cambia el puerto y existe una URL explícita, ambos valores deben mantenerse sincronizados.

Se agregan `server-only@0.0.1` y `jsdom@26.1.0` para límites de servidor y pruebas DOM respectivamente. Contracts pasa a dependencias de ejecución del panel. No se actualizan versiones mayores existentes.

## Pruebas y operación

Las pruebas unitarias cubren contratos de sesión, errores seguros, CSRF, single-flight, reintento único, exclusiones, mutaciones no repetibles, configuración, `returnTo`, servidor y sus estados. Las pruebas DOM cubren login, carga, doble envío, visibilidad de contraseña, provider, usuario/rol, menú, logout, cambio y recuperación.

`pnpm test:ui` usa Chromium contra Nginx y crea un OWNER temporal con el bootstrap existente en modo test. Comprueba cookies HttpOnly, sesión después de recarga, expiración con un JWT firmado dentro de Identity, access ausente, refresh inválido, logout, contraseña, redirecciones, teclado, tamaños móviles, almacenamiento y tráfico. También detiene y recupera finanzas e Identity para comprobar estados reales. Borra el usuario y sus sesiones al finalizar. No ejecutar sobre producción ni simultáneamente con otras pruebas de stack; el bootstrap requiere que no exista un OWNER.

`pnpm test:stack` conserva las comprobaciones previas de aislamiento, persistencia, readiness y doce accesos PostgreSQL rechazados; añade panel protegido y ejecución de Playwright. Los reportes y capturas quedan en `artifacts/`, ignorado por Git.

No se realizaron commits ni push. La Fase 1C queda reservada para validación JWT/JWKS y RBAC dentro de servicios de negocio y protección de Swagger. TLS externo, gestión de secretos, rotación operativa y rate limiting distribuido siguen siendo tareas de despliegue.

## Resultado de cierre

Instalación frozen, formato, lint, typecheck, 118 pruebas y build aprobados. Se conservaron las 61 pruebas anteriores y se añadieron 57: 36 de cliente/errores/redirecciones, 11 de componentes, 8 de sesión servidor y 2 del gateway local.

Playwright pasó contra http://localhost:8080, sin interceptar ni simular respuestas: 12 grupos de comprobaciones, incluida limpieza. `test:stack` pasó sus 13 grupos, mantuvo los doce rechazos PostgreSQL cruzados y restauró el stack. La comprobación final muestra ocho contenedores saludables, exclusivamente Nginx publicado en 8080 y jobs de provisión/migración terminados con código 0.

`node scripts/verify-auth-boundary.mjs` pasó: Git excluye secretos y artifacts, el bundle no contiene URLs ni variables privadas y los logs revisados no contienen cookies completas, contraseñas, CSRF, JWT o material privado local. No se modificó Identity. Los cambios permanecen locales, sin commits ni push. No quedan criterios de aceptación bloqueados; los límites operativos y de coordinación entre pestañas descritos arriba se mantienen.

## Entrega de Fase 1C: autenticación distribuida

Cada servicio de negocio valida access JWT mediante `@ambrosia/nest-auth`, sin consultar /me ni compartir claves privadas o persistencia de Identity. La validación de firma RS256, issuer, audience, expiración y claims utiliza jose y UserClaimsV1. El contexto de petición es inmutable y no contiene el JWT.

El paquete exporta NestAuthModule, JwtVerifier, AuthenticationGuard, PermissionsGuard, CsrfGuard, @Public(), @RequirePermissions() y @CurrentAuth(). Los guards globales deniegan una ruta privada sin permisos explícitos. Solo liveness y readiness son públicos en negocio. Identity mantiene los flujos de sesión existentes; su Swagger queda protegido mediante el mismo verificador.

La política completa, la matriz futura de operaciones y los riesgos están en [ADR-006](adr/ADR-006-distributed-authentication-rbac.md). Los criterios y resultados de ejecución están en [validation.md](validation.md).

### Archivos de Fase 1C

| Archivo o grupo                                                                                                                            | Cambio                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| packages/nest-auth/package.json, tsconfig.json, eslint.config.mjs                                                                          | Paquete compilable de infraestructura de autenticación                        |
| packages/nest-auth/src/config.ts                                                                                                           | Variables y límites del verificador                                           |
| packages/nest-auth/src/verifier.ts                                                                                                         | JWKS, caché, single-flight, timeout y JWT                                     |
| packages/nest-auth/src/credentials.ts                                                                                                      | Cookie/Bearer, ambigüedad y AuthContext                                       |
| packages/nest-auth/src/index.ts                                                                                                            | Decoradores, guards, módulo y middleware Swagger                              |
| packages/nest-auth/src/errors.ts                                                                                                           | Errores y eventos sanitizados                                                 |
| packages/nest-auth/src/swagger.ts                                                                                                          | Cookies existentes y preparación CSRF en Try it out                           |
| packages/nest-auth/src/auth.test.ts, vitest.config.ts                                                                                      | Pruebas unitarias y HTTP Nest; decoradores compilados como en producción      |
| services/{inventory,production,finance-reporting}-service/src/{app.module,health.controller,health.test,http,main}.ts                      | Guards globales, readiness JWKS, errores y Swagger                            |
| services/identity-service/src/{main,common/http}.ts                                                                                        | Protección técnica de Swagger; contratos de sesión conservados                |
| services/identity-service/src/users/bootstrap-errors.ts                                                                                    | Completa el módulo faltante que importaban cambios previos de bootstrap       |
| services/*/package.json, pnpm-lock.yaml                                                                                                    | Dependencia interna nest-auth; versiones mayores conservadas                  |
| packages/contracts/src/index.ts                                                                                                            | Campo opcional dependencies.jwks en HealthV1, compatible con Identity y panel |
| infrastructure/{docker-compose.yml,nginx/nginx.conf}                                                                                       | JWKS interno, cabeceras, proxy sin caché y rutas Swagger                      |
| scripts/{auth-test-fixture,verify-distributed-auth}.mjs                                                                                    | Usuarios temporales, cuatro roles, JWT negativos y navegador real             |
| scripts/{verify-stack,verify-ui,verify-identity,verify-local}.mjs                                                                          | Regresiones, limpieza y compatibilidad con un OWNER existente                 |
| scripts/dev.mjs, turbo.json, .env.example                                                                                                  | Configuración local y variables permitidas por Turborepo                      |
| README.md, docs/{delivery,dependencies,validation,roadmap}.md, docs/architecture/*.md, docs/adr/ADR-006-distributed-authentication-rbac.md | Operación, decisión arquitectónica y evidencias                               |

Los cambios de admin-web y otros archivos de Fase 1B ya estaban presentes al comenzar. No se reemplazaron ni se atribuyen a Fase 1C. No se añadieron enlaces de navegación opcionales ni funcionalidades de negocio.

### Variables y compatibilidad

| Variable                    | Valor o regla                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AUTH_JWKS_URL               | Compose: http://identity-service:3004/.well-known/jwks.json; local: URL privada de Identity más /.well-known/jwks.json |
| AUTH_ISSUER                 | Usa JWT_ISSUER si no se define                                                                                         |
| AUTH_AUDIENCE               | Usa JWT_AUDIENCE si no se define                                                                                       |
| AUTH_ALLOWED_ALGORITHM      | RS256 exclusivamente                                                                                                   |
| AUTH_JWKS_TIMEOUT_MS        | 2000, entre 1 y 10000                                                                                                  |
| AUTH_JWKS_CACHE_TTL_SECONDS | 300, entre 1 y 3600                                                                                                    |
| ACCESS_COOKIE_NAME          | ambrosia_access, nombre fijado por compatibilidad                                                                      |
| CSRF_COOKIE_NAME            | ambrosia_csrf, nombre fijado por compatibilidad                                                                        |
| CSRF_HEADER_NAME            | x-csrf-token                                                                                                           |
| AUTH_ALLOWED_ORIGINS        | Lista exacta separada por comas; usa CORS_ALLOWED_ORIGINS si se omite                                                  |

Compose entrega solamente configuración pública del verificador a negocio. AUTH_CSRF_SECRET y las claves privadas permanecen en Identity. No cambia el formato del JWT, de las cookies o de los permisos. El campo JWKS de health es opcional; Identity conserva database y nats.

### Caché, CSRF y Swagger

La caché por proceso dura cinco minutos por defecto. Una descarga concurrente se comparte y reemplaza el conjunto anterior. Un kid desconocido provoca una renovación controlada, con un segundo de separación entre descargas. Una clave retirada puede aceptarse hasta el vencimiento de la caché. Durante una caída, claves vigentes permiten autenticar; sin una clave vigente, autenticación y readiness fallan con 503. Liveness no depende de Identity.

Bearer exclusivo no necesita CSRF. Cualquier access cookie, incluso acompañada de un Bearer idéntico, exige double-submit y origen exacto en mutaciones. Identity conserva su firma HMAC y binding; negocio verifica formato, igualdad constante y origen sin compartir ese secreto. Swagger prepara la cabecera CSRF mediante el endpoint existente.

| Rol                    | Swagger Identity | Swagger negocio |
| ---------------------- | ---------------- | --------------- |
| OWNER                  | 200              | 200             |
| ADMIN                  | 403              | 200             |
| OPERATOR               | 403              | 403             |
| VIEWER                 | 403              | 403             |
| Anónimo o JWT inválido | 401              | 401             |

La protección cubre UI, JSON, YAML y assets. Las rutas siguen siendo /api/auth/docs/, /api/inventory/docs/, /api/production/docs/ y /api/finance/docs/. Cookie y Bearer se declaran como mecanismos alternativos; los endpoints de sesión de Identity conservan sus requisitos específicos de cookies. Las APIs no redirigen al login.

### Límites operativos y trabajo reservado

Los access emitidos siguen siendo válidos hasta expirar aunque una sesión se revoque. Logout elimina el acceso del navegador al borrar cookies, pero no invalida copias robadas inmediatamente en los servicios de negocio. La caché no persiste entre reinicios. Un arranque en frío necesita JWKS disponible. La rotación operativa de varias claves exige coordinación y no se automatiza en esta fase.

Catálogo, proveedores, compras, lotes, producción, ventas, gastos e informes siguen pendientes. No se añadieron endpoints ficticios de negocio, tokens de máquina, gestión de usuarios, Redis ni Kubernetes. Los controladores de integración solo se compilan para pruebas. No se realizaron commits ni push.
