# ADR-001 — Microservicios de grano grueso

**Estado:** aceptada, Fase 0.

## Contexto

La operación interna de Ambrosia debe continuar cuando la futura tienda se despliegue o detenga.

## Problema

Evitar acoplamiento operativo sin fragmentar cada entidad en un servicio.

## Decisión

Crear inventory-service, production-service y finance-reporting-service. La Fase 1A agrega identity-service como capacidad independiente según ADR-005. El panel es otra aplicación; tienda y comercio se reservan para fases futuras. Contratos explícitos HTTP/eventos delimitan la colaboración.

## Alternativas consideradas

Monolito modular: menor coste operativo, pero un único ciclo de despliegue. Microservicio por entidad: mayor aislamiento con complejidad excesiva para el tamaño del negocio.

## Consecuencias positivas

Despliegues independientes, propiedad clara y separación de la futura tienda. La caída de finanzas no detiene el proceso de producción.

## Trade-offs

Más procesos, observabilidad y pruebas distribuidas. Consistencia eventual futura; ninguna transacción distribuida. PostgreSQL y NATS aún son puntos comunes de fallo.
