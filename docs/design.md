# DakaDesing — Steep en Ambrosia

Referencia seleccionada por el usuario: Steep. Aplicación al acceso, inicio, navegación administrativa, catálogo y proveedores existentes; no agrega módulos de negocio.

## Sistema visual

Los tokens están en `apps/admin-web/app/globals.css`: blanco #ffffff, tinta #17191c, superficies #f2f2f3 y #fafafb, durazno #fbe1d1 y texto sobre durazno #5d2a1a. El gris funcional #626670 adapta la referencia para mejorar contraste. Una superficie editorial durazno por página; formularios y tablas conservan densidad operativa.

Georgia es la alternativa serif autorizada por Steep; Segoe UI/system-ui cubre controles y cuerpo sin descargar fuentes ni depender de licencias comerciales. Títulos serif de peso 400, tamaños adaptables, tarjetas de 24 px, campos de 16 px y botones píldora. Sombras reservadas para menús y diálogos; foco visible y movimiento reducido.

UI UX Pro Max se consultó para sistema visual y foco en modales. Sus propuestas generales de paleta/marketing no se trasladaron: prevalecen Steep y las tareas administrativas existentes. De claude-webkit se adaptó el flujo de sistema visual, componentes y revisión de escritorio/móvil.

## Confirmaciones

`apps/admin-web/lib/ui/notifications.ts` centraliza SweetAlert2 para descartar cambios del catálogo y proveedores. Las tres llamadas a window.confirm fueron reemplazadas por un resultado asíncrono. Cancelar o Escape conserva el formulario; confirmar descarta sin enviar una mutación. Se bloquea guardar/cerrar repetidamente mientras la decisión está pendiente.

Los editores HTML dialog ocupan la capa superior del navegador: se cierra temporalmente su presentación, sin desmontar ni reiniciar su DOM, antes de mostrar SweetAlert2. Después se restaura el editor y el foco. Esto evita ocultar la confirmación detrás del diálogo nativo. El fondo de SweetAlert2 se define explícitamente incluso con animaciones desactivadas.

La validación sigue asociada a los formularios; archivado/restauración mantiene sus diálogos y gestión de conflictos. Beforeunload sigue siendo nativo por ser una restricción del navegador. No se cambiaron API, permisos, sesiones ni persistencia.

## Verificación reproducible

Ejecutar `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm build`. Después, `node scripts/verify-design.mjs` inicia una instancia local aislada con respuestas ficticias, sin acceder a bases de datos ni requerir credenciales. Usa Chromium de Playwright; admite PLAYWRIGHT_EXECUTABLE_PATH.

La revisión cubre login, inicio, catálogo y proveedores a tamaños móviles y de escritorio, y confirmaciones con foco, Escape y conservación de valores. Genera capturas y resultados en `artifacts/dakadesing/`, ignorado por Git. Es una prueba de interfaz con fixtures, no una validación de servicios reales. Consultar docs/validation.md para resultados de ejecución.
