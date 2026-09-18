# ADR-006: Autenticación distribuida y RBAC

Estado: aceptado para Fase 1C.

## Decisión

Inventario, producción y finanzas verifican access JWT localmente mediante `@ambrosia/nest-auth`. El paquete contiene infraestructura de autenticación Nest; esta es una excepción explícita a la restricción previa de compartir solamente contratos y configuración. No contiene dominio, Prisma, usuarios, sesiones, claves privadas ni refresh. Cada servicio lo compila y despliega con su aplicación.

El verificador obtiene claves de `http://identity-service:3004/.well-known/jwks.json`. Acepta únicamente RS256 con kid y valida firma, issuer, audience, exp, nbf cuando existe y el contrato UserClaimsV1. Los permisos y roles conservan los nombres y formato de Fase 1A. No consulta /me ni ninguna base ajena.

## Caché y rotación

Cada proceso indexa claves por kid. El TTL predeterminado es 300 segundos (configurable entre 1 y 3600); el timeout es 2000 ms (máximo 10000). Una sola promesa comparte la descarga concurrente. Un kid desconocido solicita una renovación; durante el segundo posterior a una descarga se utiliza ese resultado y se rechazan claves desconocidas sin otra consulta. Esto limita la amplificación por kids aleatorios. Una rotación recién publicada puede requerir reintento después de ese segundo.

La renovación reemplaza el conjunto completo. Las claves retiradas dejan de aceptarse cuando vence el TTL o una renovación descubre el retiro. Se rechazan conjuntos vacíos, duplicados, material privado, algoritmos ajenos, claves RSA menores de 2048 bits y respuestas superiores a 64 KiB. Identity sigue emitiendo RSA de al menos 3072 bits.

Una caída corta de Identity permite usar claves cuya caché sigue vigente. Al vencer, el servicio falla cerrado: autenticación 503 y readiness 503; liveness permanece 200. Un proceso sin claves tampoco está ready hasta obtenerlas. No se sirve caché vencida indefinidamente. Publicar claves antiguas y nuevas durante al menos la vida del access más el TTL antes de retirar las anteriores. La publicación de varias claves es una operación de Identity; su automatización queda fuera de esta fase.

## Autenticación y autorización

Las rutas Nest de negocio son privadas por defecto. AuthenticationGuard, PermissionsGuard y CsrfGuard son globales, en ese orden. Solo los dos métodos health tienen @Public(). Una ruta autenticada sin permisos explícitos devuelve 403. @RequirePermissions exige todos los permisos y solo admite PermissionV1. @CurrentAuth entrega un contexto y array de permisos congelados, sin JWT.

Se acepta Bearer o ambrosia_access. Valores diferentes, cookies duplicadas, otros esquemas y tokens en query se rechazan. El cuerpo no se usa como fuente de credenciales. Si cookie y Bearer coinciden, el método es cookie y se mantiene CSRF. No hay jerarquías de roles implícitas ni comparaciones de rol en controladores de negocio.

## CSRF

Identity conserva su HMAC sobre nonce y binding HttpOnly y la verificación de origen. Los servicios de negocio no reciben AUTH_CSRF_SECRET. Usan double-submit con el mismo formato nonce.firma (43 caracteres base64url por parte), comparación constante y Origin exacto, con Referer como alternativa solo si Origin falta. La firma HMAC no se verifica en negocio: la seguridad depende del origen permitido y de exigir una cabecera que un formulario externo no puede adjuntar. Un cliente Bearer exclusivo no requiere CSRF. GET, HEAD y OPTIONS son seguros.

Esta alternativa evita distribuir un secreto capaz de fabricar CSRF. Exige controlar estrictamente los orígenes, no permitir subdominios comodín y proteger contra XSS en el origen autorizado. Compartir HMAC extendería el impacto de comprometer un servicio; cambiar CSRF a firma asimétrica requeriría migrar un contrato que ya funciona. Las pruebas cubren origen, formato, ausencia, discrepancia y credenciales mixtas.

## Swagger y proxy

Swagger se monta fuera de los controladores Nest: un middleware previo protege /docs y sus variantes, JSON, YAML y assets. Identity exige users.manage, exclusivo de OWNER en la matriz actual. Negocio permite OWNER y ADMIN mediante una política técnica centralizada; OPERATOR y VIEWER reciben 403. No se añade un permiso de dominio artificial para documentación.

OpenAPI declara cookieAuth y bearerAuth como alternativas. Swagger usa cookies existentes y prepara CSRF para mutaciones leyendo /api/auth/csrf, sin leer cookies HttpOnly. Los endpoints de sesión de Identity conservan sus mecanismos existentes. Nginx propaga las cabeceras originales y correlación; no delega autorización con auth_request. El middleware y los guards devuelven private, no-store; el proxy tiene caché deshabilitada.

## Errores y observabilidad

401: credenciales ausentes o inválidas. 403: identidad válida sin permiso o CSRF rechazado. 503: no se puede obtener la clave necesaria. Los códigos son AUTHENTICATION_REQUIRED, ACCESS_DENIED y AUTHENTICATION_UNAVAILABLE. Incluyen mensaje genérico y correlationId. Los logs de autenticación solo incluyen nombres de eventos; HTTP registra método, ruta sin query, estado y requestId. No se registran JWT, cookies, CSRF, cuerpos ni errores criptográficos.

## Riesgos y alternativas

Los access emitidos siguen siendo válidos hasta expirar aunque la sesión se revoque. Logout elimina las cookies del navegador; no invalida instantáneamente copias robadas de access en negocio. La revocación inmediata requeriría otro mecanismo y más dependencia operativa. El caché acota tanto disponibilidad ante caídas como retiro de claves. Un proceso reiniciado durante una caída no dispone de caché persistente.

Consultar /me por petición acoplaría disponibilidad y latencia. HMAC JWT distribuiría capacidad de firma. Autorizar solamente en Nginx permitiría omisiones al acceder por red privada. Se eligió verificación local.

No hay tokens de máquina: aún no existe una operación HTTP síncrona real entre servicios de negocio. Se diseñarán al implementar la primera comunicación producción-inventario. NATS conserva su autenticación e aislamiento de red. Un JWT de usuario no será identidad permanente de un servicio.

## Matriz preparada para Fase 2 y posteriores

| Servicio   | Operaciones futuras                                               | Permiso          |
| ---------- | ----------------------------------------------------------------- | ---------------- |
| Inventario | Consultar artículos, existencias y proveedores                    | inventory.read   |
| Inventario | Crear/editar artículos, compras y ajustes                         | inventory.write  |
| Producción | Consultar lotes y rendimiento                                     | production.read  |
| Producción | Crear lotes, actualizar proceso, finalizar fermentación y envasar | production.write |
| Finanzas   | Consultar movimientos                                             | finance.read     |
| Finanzas   | Registrar ingresos, gastos y ventas                               | finance.write    |
| Informes   | Consultar y exportar informes                                     | reports.read     |

No se crean estos endpoints. Los controladores usados para probar permisos están exclusivamente en archivos de prueba, excluidos del build.
