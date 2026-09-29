# HelpPeople Mejoras

Userscript para [Violentmonkey](https://violentmonkey.github.io/) (compatible con Tampermonkey)
que agrega funcionalidades a la aplicación web de HelpPeople
(`https://univalleapp.helppeoplecloud.com/`).

El objetivo es mejorar la experiencia de trabajo diario: recordar el estado de la interfaz,
mantener una lista persistente de tickets abiertos, organizarlos por pestañas y etiquetas, y
ampliar la lectura de las Órdenes de Trabajo.

## Funcionalidades

- **Recordar el módulo y la vista.** Recuerda si estabas en *Dashboard* o *Solicitudes* y qué
  vista tenías activa (*grilla*, *detallada* u *órdenes de trabajo*) entre recargas.
- **Ampliar la Descripción de una OT.** Quita el límite de altura (`max-height: 120px`) del
  contenido enriquecido del cajón de Órdenes de Trabajo.
- **Widget de tickets (todo).** Panel flotante anclado abajo a la izquierda que:
  - Agrega automáticamente el ticket al abrir su detalle y resalta el que está abierto.
  - Muestra prioridad, etiquetas y botón de eliminar por ticket.
  - Reordena arrastrando y suelta (drag & drop) los elementos.
  - Permite seleccionar varios tickets con `Ctrl`/`Cmd`+clic y `Shift`+clic para rangos, y
    arrastrarlos en conjunto a una pestaña.
  - Se puede redimensionar (ancho y alto) y minimizar.
  - Busca por código, asunto o etiqueta; con un código numérico abre el ticket directamente.
- **Pestañas.** Barra de pestañas para organizar los tickets. Se pueden crear, renombrar
  (doble clic), eliminar y arrastrar tickets entre ellas. La primera pestaña es la de respaldo.
- **Etiquetas.** Registro de etiquetas con color, asignables por ticket y editables en línea.
- **Exportar / Importar.** Descarga un JSON con tickets, etiquetas y pestañas, y lo vuelve a
  importar combinando por código.
- **Tutorial interactivo.** Recorrido guiado y práctico que enseña a usar el widget paso a paso.
- **Respaldo automático.** Copia todos los datos a IndexedDB para sobrevivir al cierre de sesión
  (la app borra `localStorage` al cerrar la sesión).

## Instalación

1. Instala [Violentmonkey](https://violentmonkey.github.io/) (o Tampermonkey) en tu navegador.
2. Instala el script desde:
   `https://raw.githubusercontent.com/nijamaDev/hp-scripts/main/helppeople.user.js`
   o crea un nuevo script y pega el contenido de `helppeople.user.js`.
3. Recarga la página de HelpPeople. El widget aparecerá en la esquina inferior izquierda.

## Configuración

Al inicio de `helppeople.user.js` está el objeto `CONFIG`, donde puedes activar o desactivar
funciones (poniendo `false`):

| Opción | Descripción |
|---|---|
| `persistModule` | Recuerda Dashboard vs. Solicitudes entre recargas. |
| `persistView` | Recuerda la vista de Solicitudes (grilla / detallada / órdenes). |
| `tallerDescription` | Amplía la Descripción de una Orden de Trabajo. |
| `todoWidget` | Muestra el widget flotante de tickets (activa también el respaldo en IndexedDB). |

## Almacenamiento de datos

El script usa `localStorage` para funcionar y respalda todo en IndexedDB (base de datos
`hp_mejoras`). Claves principales:

- `hp_ui_state` — módulo y vista activos.
- `hp_todo` — lista de tickets.
- `hp_tags` — registro de etiquetas.
- `hp_todo_tabs` — lista de pestañas.
- `hp_todo_tab_active` — pestaña seleccionada.
- `hp_todo_open`, `hp_todo_width`, `hp_todo_height` — estado del panel.

El respaldo en IndexedDB permite restaurar los datos cuando la aplicación borra `localStorage`
al cerrar sesión.

## Requisitos

- Navegador basado en Chromium o Firefox.
- Extensiones de usuarios (Violentmonkey / Tampermonkey) con el permiso para ejecutar
  usuarioscripts (en Chrome, el interruptor "Permitir scripts de usuario" en `chrome://extensions`).

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).
