# Versiones y propósito

## Herramientas personales de Codex

Se instalaron en `~/.codex/skills` tres habilidades de [every-app/open-seo](https://github.com/every-app/open-seo), fijadas al commit `7b9ee0e4fa800e5bae9ca76f49cb273a9c677204`:

- `deslop`: revisión de textos para eliminar relleno y expresiones artificiales; incluye sus referencias.
- `simple-issue-description`: redacción breve de problemas y comportamiento esperado.
- `papercuts`: registro de dificultades recurrentes que el repositorio puede corregir.

Son herramientas opcionales del agente, instaladas en el perfil personal; no son dependencias de ejecución de Ambrosia ni se instalan con `pnpm install`. Se copiaron con `skill-installer` desde `.agents/skills/<nombre>` del commit indicado. Pueden invocarse como `$deslop`, `$simple-issue-description` y `$papercuts`.

La integración SEO queda sin configurar: sus flujos requieren una cuenta o instancia de OpenSEO y conexión MCP. No se incorporaron los flujos específicos de Cloudflare/OpenSEO ni `merge-ready`, que prescribe commits y push automáticos incompatibles con las instrucciones locales sin autorización explícita.

Validación de esta instalación: archivos `SKILL.md` y referencias presentes; `lint`, `typecheck`, `test` y `build` ejecutados mediante `npx --yes pnpm@10.34.5`, con resultados satisfactorios y reutilización de caché de Turborepo. La suite raíz ejecutó 12 pruebas correctamente. No se verificó una conexión MCP de OpenSEO.

### Auditorías de seguridad

Se instaló `security-audit` de [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill) en `~/.codex/skills/security-audit`, mediante `skill-installer`, desde `skills/security-audit` del commit revisado `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`. Incluye las guías por dominio, el esquema JSON y los validadores Node.js sin dependencias externas.

Invocación: `$security-audit`. Para comenzar con un alcance concreto: «Audita la seguridad de identity-service y la configuración Nginx; informa la cobertura y los hallazgos». La auditoría completa usa subagentes y verificación independiente; distingue hallazgos confirmados, pendientes de validación y descartados. Describe correcciones sin modificar el código auditado.

No requiere una cuenta de Cloudflare. Las reproducciones requieren aislamiento del sistema operativo, red externa deshabilitada, entorno permitido explícitamente y límites de recursos; si no se pueden garantizar, se mantiene la revisión de código y se documenta la validación pendiente. La instalación no inicia una auditoría ni acredita la seguridad de Ambrosia.

Verificación de instalación: 20 archivos presentes, sintaxis de ambos validadores comprobada con `node --check` y esquema JSON leído correctamente. No se ejecutó una auditoría ni la suite propia de la habilidad.

Validación del workspace tras incorporar la habilidad: `lint`, `typecheck`, `test` y `build` terminaron con código 0 mediante `npx --yes pnpm@10.34.5`; Turborepo reutilizó la caché y la suite raíz ejecutó sus 12 pruebas correctamente.

## Dependencias de la aplicación

Versiones fijadas en manifests y pnpm-lock.yaml. No se migraron dependencias a otra versión mayor después de generar el lockfile.

| Tecnología                          | Versión        | Propósito                                                  |
| ----------------------------------- | -------------- | ---------------------------------------------------------- |
| Node.js                             | 24.14.0        | Runtime local y base Docker LTS                            |
| pnpm                                | 10.34.5        | Workspaces, lockfile y empaquetado de producción           |
| TypeScript                          | 5.9.3          | Comprobación estricta y metadatos de DI Nest               |
| Turborepo                           | 2.10.13        | Grafo de tareas y caché local                              |
| Next.js                             | 16.3.5         | App Router y aplicación administrativa                     |
| React / React DOM                   | 19.3.0         | Renderizado e interacción del estado                       |
| Tailwind CSS / PostCSS plugin       | 4.3.3          | Estilos responsive                                         |
| NestJS core/common/platform-express | 11.2.5         | HTTP, DI, lifecycle y versionado                           |
| @nestjs/config                      | 4.0.4          | Configuración validada por servicio                        |
| @nestjs/swagger                     | 11.4.7         | OpenAPI y documentación interactiva                        |
| Prisma / client / adapter-pg        | 7.10.0         | Clientes propios sin modelos ficticios                     |
| pg                                  | 8.23.0         | Driver PostgreSQL y timeouts del pool                      |
| Zod                                 | 4.6.5          | Validación segura de variables                             |
| Argon2                              | 0.45.1         | Hash Argon2id de contraseñas                               |
| jose                                | 6.2.12         | Firma/verificación RS256 y publicación JWK/JWKS            |
| nats                                | 2.29.3         | Cliente Core/JetStream, confirmación y reconexión          |
| Helmet                              | 8.3.0          | Cabeceras HTTP de protección                               |
| class-validator / class-transformer | 0.15.1 / 0.5.1 | ValidationPipe global preparado para DTO futuros           |
| reflect-metadata / RxJS             | 0.2.2 / 7.8.2  | Integración requerida por NestJS                           |
| ESLint / @eslint/js                 | 9.39.5         | Lint del workspace y compatibilidad con configuración Next |
| typescript-eslint                   | 8.70.0         | Reglas TypeScript sin any explícito                        |
| Prettier                            | 3.9.7          | Formato uniforme                                           |
| Vitest                              | 4.1.11         | Pruebas de health, configuración e interfaz                |
| Playwright                          | 1.58.2         | Comprobación real de navegador, solo desarrollo            |
| PostgreSQL (imagen)                 | 17.6-alpine    | Servidor relacional con cuatro bases aisladas              |
| NATS (imagen)                       | 2.11.8-alpine  | JetStream persistente                                      |
| Nginx unprivileged (imagen)         | 1.28.0-alpine  | Proxy sin root                                             |

Los paquetes @types corresponden a las bibliotecas utilizadas; @types/node se fija a la rama 24. Los paquetes internos contienen contratos o configuración, no lógica del dominio.

El registro npm advierte que `nats@2.29.3` y `eslint@9.39.5` están deprecados. Las versiones elegidas son releases estables y pasaron compilación/pruebas; se conserva el lockfile solicitado. Revisar deliberadamente cliente NATS modular y ESLint 10 en una tarea de mantenimiento, sin cambios mayores automáticos. Los scripts de instalación de @scarf/scarf y unrs-resolver no fueron autorizados; las validaciones funcionaron sin ellos.
