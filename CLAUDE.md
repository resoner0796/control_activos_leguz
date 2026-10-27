# Control de Activos — contexto del proyecto

Webapp interna para llevar el inventario de equipos de la empresa (celulares, laptops, etc.)
y saber cuántos hay, cuántos están asignados y a quién (empleado, ruta, IMEI, teléfono).

## Stack
- **HTML + CSS + JavaScript vanilla** (ES modules). Sin frameworks, sin bundler, sin npm.
- **Firebase Firestore** como base de datos, cargado desde el CDN de gstatic
  (`https://www.gstatic.com/firebasejs/13.1.0/...`). Si se sube de versión, cambiarla en
  **todos** los imports (`js/firebase.js` y `js/app.js`) para que coincidan.
- Proyecto Firebase: `control-de-activos-becc3`.

## Estructura
```
index.html        Estructura: topbar, 2 vistas (Inventario / Asignaciones), diálogos
css/styles.css    Estilos. Tokens de color/espaciado en :root
js/firebase.js    initializeApp + getFirestore (exporta `db`)
js/app.js         Toda la lógica: suscripciones, render, formularios, transacciones
firestore.rules   Reglas de seguridad (pegar en consola de Firebase)
```

## Cómo correrlo
Los ES modules no funcionan con `file://`. Servir la carpeta con un servidor local:
- VS Code → extensión **Live Server**, o
- `npx serve .` / `python -m http.server 5500`

## Modelo de datos (Firestore)

### `equipos`
| campo | tipo | nota |
|---|---|---|
| nombre | string | único (se valida con `nombreNorm`) |
| nombreNorm | string | nombre en minúsculas sin acentos |
| tipo | string | Celular, Laptop, Tablet… (texto libre con autocompletado) |
| cantidad | int | total de unidades en existencia |
| asignados | int | contador de asignaciones **activas** |
| creadoEn / actualizadoEn | timestamp | `serverTimestamp()` |

Disponibles = `cantidad - asignados` (se calcula, no se guarda).

### `asignaciones`
| campo | tipo | nota |
|---|---|---|
| equipoId | string | id del doc en `equipos` |
| equipoNombre / equipoTipo | string | copia desnormalizada para mostrar historial |
| ruta | string | |
| empleado | string | |
| imei | string | opcional, 15 dígitos; no se repite entre activas |
| telefono | string | opcional, 10 dígitos |
| estado | `"activa"` \| `"devuelta"` | |
| asignadoEn / devueltoEn | timestamp | `devueltoEn` es null mientras está activa |

## Reglas de negocio (no romper)
1. **Cada asignación = 1 unidad.** Asignar incrementa `equipos.asignados` en 1.
2. Todo movimiento de `asignados` va **dentro de `runTransaction`** junto con el cambio a la
   asignación, para que nunca se asigne más de `cantidad` aunque dos personas asignen a la vez.
3. Devolver → `estado: "devuelta"` + `asignados - 1`. Se conserva el historial.
4. No se puede bajar `cantidad` por debajo de `asignados`.
5. No se puede eliminar un equipo con `asignados > 0`.
6. Eliminar una asignación activa también libera la unidad.

## Convenciones de UI
- Tema claro corporativo, color principal azul marino `--primary: #0f3d6e`, fuente Inter.
- Interfaz limpia: **sin tarjetas de KPIs**. Los totales van como una línea de resumen bajo
  el título (`.summary`). Mantenerlo así.
- Formularios en `<dialog>` nativo; confirmaciones con `confirmar()` en vez de `window.confirm`.
- Notificaciones con `toast(msg, "ok" | "error")`.
- Todo texto de usuario que se inyecta en HTML pasa por `esc()`.
- Textos de la UI en español (México).

## Pendientes / ideas
- **Autenticación** (Firebase Auth) y cambiar las reglas a `request.auth != null`. Ahora mismo
  cualquiera con el proyecto puede escribir.
- Exportar a Excel/CSV.
- Editar una asignación (cambiar empleado/ruta/IMEI).
- Catálogo de empleados y rutas como colecciones propias.
