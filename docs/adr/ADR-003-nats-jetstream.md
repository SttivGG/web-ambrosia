# ADR-003 — NATS JetStream

**Estado:** aceptada, Fase 0.

## Contexto

La futura coordinación entre inventario, producción, finanzas y comercio requiere comunicación asíncrona desacoplada.

## Problema

HTTP síncrono para cada actualización propagaría indisponibilidad; NATS Core por sí solo no persiste mensajes.

## Decisión

Habilitar JetStream con almacenamiento en volumen. Implementar conexión, reconexión, cierre y publicación con confirmación. Readiness verifica la API JetStream. Definir solo EventEnvelopeV1; streams y eventos de negocio se definirán cuando exista el caso de uso.

## Alternativas consideradas

NATS Core: simple pero sin persistencia. RabbitMQ: viable con más configuración de colas. Kafka: coste operativo desproporcionado y fuera del alcance solicitado.

## Consecuencias positivas

Persistencia, confirmaciones de publicación y base para consumidores durables. Bus liviano sin compartir bases de datos.

## Trade-offs

La entrega futura requiere idempotencia, políticas de reintento y retención. Un nodo no proporciona alta disponibilidad. La identidad técnica NATS común debe evolucionar a ACL por subjects. El cliente nats 2.29.3 es estable pero npm lo marca deprecado en favor de paquetes modulares; se fija en el lockfile, sin migración automática de API. Planificar esa migración antes de implementar consumidores de negocio.
