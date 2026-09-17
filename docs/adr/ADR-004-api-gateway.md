# ADR-004 — Nginx como gateway

**Estado:** aceptada, Fase 0.

## Contexto

El navegador necesita una entrada única que no exponga bases, credenciales ni direcciones internas.

## Problema

Conectar directamente el frontend a puertos de cada servicio acopla configuración y orígenes.

## Decisión

Enrutar / al panel y /api/inventory, /api/production, /api/finance y /api/auth a los servicios. Traducir rutas a /api/v1, preservar Swagger y JWKS, propagar cabeceras forwarded y normalizar X-Request-ID. Usar resolución DNS dinámica para que upstreams ausentes no impidan arrancar el gateway. Timeouts y 503 JSON para fallos de conexión.

## Alternativas consideradas

Gateway NestJS propio: más código de infraestructura. Traefik: descubrimiento dinámico útil, innecesario para tres servicios. Acceso directo: contradice el límite de entrada requerido.

## Consecuencias positivas

Mismo origen para el navegador, configuración explícita y aislamiento de puertos privados. Gateway local también enruta a aplicaciones fuera de Docker.

## Trade-offs

Configuración estática de rutas, otro componente a operar y un punto de entrada único. TLS y autorización quedan para configuración operativa/Fase 1. No confiar en forwarded headers de clientes para decisiones de seguridad sin definir proxies confiables.
