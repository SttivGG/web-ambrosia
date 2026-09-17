# ADR-002 — Base de datos por servicio

**Estado:** aceptada, Fase 0.

## Contexto

Cada capacidad debe controlar su persistencia y evolución.

## Problema

Una base con tablas compartidas permite accesos cruzados y acopla migraciones.

## Decisión

Usar una base y un usuario PostgreSQL no privilegiado por servicio. Fase 0 creó tres; Fase 1A agregó `ambrosia_identity`/`identity_user` sin recrearlas. Revocar CONNECT público. Cada servicio mantiene su schema.prisma y cliente generado local. Los servicios de negocio siguen sin entidades ficticias; identidad aplica sus propias migraciones versionadas.

## Alternativas consideradas

Tablas o esquemas compartidos: aislamiento más débil. Un contenedor PostgreSQL por servicio: mayor separación operativa, con mayor consumo inicial.

## Consecuencias positivas

Credenciales limitadas, migraciones independientes y posibilidad de mover cada base a otra instancia.

## Trade-offs

No se permiten joins entre servicios ni transacciones distribuidas. La instancia inicial sigue compartiendo recursos y disponibilidad. Las agregaciones futuras deberán usar APIs o proyecciones de eventos.
