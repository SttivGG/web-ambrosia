# Arquitectura de Ambrosia

Estado: Fase 1 en progreso; 1A y 1B completadas. Cuatro microservicios desplegables y detenibles de forma independiente. Identidad es el único dominio funcional incorporado después de la fundación técnica.

```mermaid
flowchart TD
    Browser[Navegador] --> Gateway[Nginx]
    Gateway --> Web[admin-web · Next.js]
    Gateway --> Identity[identity-service]
    Gateway --> Inventory[inventory-service]
    Gateway --> Production[production-service]
    Gateway --> Finance[finance-reporting-service]
    Identity --> ADB[(ambrosia_identity)]
    Inventory --> IDB[(ambrosia_inventory)]
    Production --> PDB[(ambrosia_production)]
    Finance --> FDB[(ambrosia_finance_reports)]
    Inventory <--> NATS[NATS JetStream]
    Identity <--> NATS
    Production <--> NATS
    Finance <--> NATS
```

Los cuatro nodos de datos residen inicialmente en un servidor PostgreSQL, con usuarios distintos y sin CONNECT público. Cada cuenta posee solamente su base y esquema público. PostgreSQL compartido y NATS son fallos comunes de infraestructura; independencia de aplicaciones no equivale a alta disponibilidad de infraestructura. No hay joins entre bases, transacciones distribuidas ni clientes Prisma compartidos.

`contracts` contiene HealthV1, EventEnvelopeV1 y el contrato versionado de claims/permisos. El mapa rol-permisos, las sesiones, las claves y la persistencia pertenecen exclusivamente a `identity-service`; no se comparten modelos Prisma. `shared-config` contiene únicamente validación técnica. Los adaptadores de infraestructura se mantienen dentro de cada servicio para preservar despliegue y evolución independientes. Su duplicación pequeña es deliberada. El transporte de eventos incluye ID, versión, instante UTC y correlación; no se crean streams de negocio ni consumidores. En fases futuras definir persistencia, retención, deduplicación, consumidores durables e idempotencia antes de emitir eventos.

Identidad emite access tokens RS256 de vida corta y publica solo su clave pública en JWKS. Los refresh tokens son opacos, se guardan mediante SHA-256, rotan en cada uso y mantienen una familia para detectar reutilización. El navegador recibe tokens únicamente mediante cookies: access y refresh son HttpOnly, y el token CSRF legible se enlaza a una cookie HttpOnly firmada. Desde Fase 1C, cada servicio de negocio valida los JWT localmente usando JWKS, sin consultar la base de identidad ni compartir secretos.

Health es independiente de futuros módulos: proceso vivo versus disponibilidad de PostgreSQL y JetStream. Los timeouts están acotados; la conexión NATS inicial se reintenta y la reconexión posterior es automática. La consulta de readiness verifica JetStream, no solo el socket. El proceso cierra Prisma y drena/cierra NATS al recibir señales.

Nginx usa DNS dinámico, sin dependencias de arranque que acoplen los servicios. Una respuesta inválida del upstream se convierte en 503 JSON. Los logs omiten cuerpos, consultas SQL, credenciales y query strings. No se confía en un ID de correlación arbitrario: solo ASCII limitado a 128 caracteres.

La futura tienda y commerce-service tendrán sus propios ciclos de despliegue, datos y contratos; no existen todavía. HTTP interno se reserva para consultas síncronas, NATS para eventos. Moneda futura COP con Decimal; almacenamiento temporal UTC y presentación colombiana.

Fuentes técnicas: [Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output), [Prisma generator](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [NATS JetStream](https://docs.nats.io/nats-concepts/jetstream).

Fase 1B: Next valida cada render protegido con /me mediante una URL privada y solo la cookie access. El cliente renueva por Nginx con CSRF y cookies HttpOnly, sin compartir persistencia ni claves. El binding CSRF solo permite intentar recuperación. Ver [entrega](../delivery.md) para los estados de sesión y reintentos.

## Autenticación distribuida (Fase 1C)

Los tres servicios de negocio incorporan @ambrosia/nest-auth como infraestructura compilada localmente. Esta excepción explícita a compartir solo contratos/configuración no permite compartir dominio ni persistencia. Los guards globales exigen access JWT y permisos; health permanece público. Swagger se protege mediante middleware porque sus handlers no pasan por guards de controladores.

Readiness añade dependencies.jwks: requiere una clave pública vigente o una descarga válida, además de PostgreSQL y JetStream. Liveness sigue comprobando solo el proceso. No hay llamada a Identity en cada petición. El contrato HealthV1 añade jwks opcional para conservar compatibilidad con Identity.

Ver [ADR-006](../adr/ADR-006-distributed-authentication-rbac.md) para la caché, rotación, CSRF, revocación y matriz de permisos. El mapa rol-permisos continúa perteneciendo a Identity; negocio utiliza los permisos del token verificado.
