// ==========================================================
// Control de Activos — lógica de la app
// Colecciones:  equipos  /  asignaciones
// Los contadores (equipos.asignados) se mueven SIEMPRE dentro
// de transacciones para que nunca se asigne más de lo que hay.
// ==========================================================
import { db } from "./firebase.js";
import {
  collection, doc, onSnapshot, query, orderBy,
  addDoc, runTransaction, serverTimestamp, increment,
} from "https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js";

const colEquipos = collection(db, "equipos");
const colAsignaciones = collection(db, "asignaciones");

// ---------- Estado ----------
const state = {
  equipos: [],
  asignaciones: [],
  editandoEquipoId: null,
  cargado: { equipos: false, asignaciones: false },
};

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat("es-MX");
const fmtFecha = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" });

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const limpiar = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
const normalizar = (v) => limpiar(v).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const fecha = (ts) => (ts?.toDate ? fmtFecha.format(ts.toDate()) : "—");
const disponibles = (e) => Math.max(0, (e.cantidad || 0) - (e.asignados || 0));

const ICON = {
  edit: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  assign: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
};

// ---------- Toast ----------
let toastTimer;
function toast(msg, type = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.dataset.type = type;
  el.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-visible"), 3200);
}

function errorFirebase(err) {
  console.error(err);
  if (err?.code === "permission-denied") return "Sin permisos en Firestore. Revisa las reglas de seguridad.";
  if (err?.code === "unavailable") return "Sin conexión con Firebase. Intenta de nuevo.";
  return err?.message || "Ocurrió un error inesperado.";
}

// ---------- Conexión ----------
function setConn(status, text) {
  const el = $("#conn");
  el.dataset.status = status;
  el.querySelector(".conn__text").textContent = text;
}

// ---------- Confirmación ----------
function confirmar({ titulo, mensaje, accion = "Confirmar", peligro = false }) {
  const dlg = $("#dlgConfirm");
  $("#confirmTitulo").textContent = titulo;
  $("#confirmMensaje").textContent = mensaje;
  const btn = $("#confirmAceptar");
  btn.textContent = accion;
  btn.className = `btn ${peligro ? "btn--danger" : "btn--primary"}`;
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => {
    dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true });
  });
}

// ---------- Botón con carga ----------
async function conCarga(btn, fn) {
  btn.disabled = true;
  btn.classList.add("is-loading");
  try { return await fn(); }
  finally { btn.disabled = false; btn.classList.remove("is-loading"); }
}

// ---------- Validación de formularios ----------
function setError(input, msg) {
  const field = input.closest(".field");
  field.classList.toggle("has-error", !!msg);
  field.querySelector(".field__error").textContent = msg || "";
}
function limpiarErrores(form) {
  form.querySelectorAll(".field").forEach((f) => {
    f.classList.remove("has-error");
    f.querySelector(".field__error").textContent = "";
  });
}

// ==========================================================
// Navegación entre vistas
// ==========================================================
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => {
      t.classList.toggle("is-active", t === tab);
      t.setAttribute("aria-selected", t === tab);
    });
    document.querySelectorAll(".view").forEach((v) =>
      v.classList.toggle("is-active", v.id === `view-${tab.dataset.view}`));
  });
});

// Cerrar diálogos con botones [data-close]
document.querySelectorAll("[data-close]").forEach((b) =>
  b.addEventListener("click", () => b.closest("dialog").close()));

// Solo dígitos en IMEI / teléfono
document.querySelectorAll("[data-digits]").forEach((inp) =>
  inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, ""); }));

// ==========================================================
// Suscripciones en tiempo real
// ==========================================================
onSnapshot(
  query(colEquipos, orderBy("nombre")),
  (snap) => {
    state.equipos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.cargado.equipos = true;
    setConn("online", "En línea");
    renderTodo();
  },
  (err) => { setConn("error", "Sin conexión"); toast(errorFirebase(err), "error"); }
);

onSnapshot(
  query(colAsignaciones, orderBy("asignadoEn", "desc")),
  (snap) => {
    state.asignaciones = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.cargado.asignaciones = true;
    renderTodo();
  },
  (err) => { setConn("error", "Sin conexión"); toast(errorFirebase(err), "error"); }
);

function renderTodo() {
  renderListas();
  renderEquipos();
  renderAsignaciones();
}

// ==========================================================
// Autocompletados y filtros
// ==========================================================
function unicos(valores) {
  const mapa = new Map();
  valores.filter(Boolean).forEach((v) => { const k = normalizar(v); if (!mapa.has(k)) mapa.set(k, limpiar(v)); });
  return [...mapa.values()].sort((a, b) => a.localeCompare(b, "es"));
}

function llenarSelect(sel, valores, etiquetaTodos) {
  const actual = sel.value;
  sel.innerHTML = `<option value="">${etiquetaTodos}</option>` +
    valores.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  if (valores.includes(actual)) sel.value = actual;
}

function renderListas() {
  const tipos = unicos(state.equipos.map((e) => e.tipo));
  const rutas = unicos(state.asignaciones.map((a) => a.ruta));
  const empleados = unicos(state.asignaciones.map((a) => a.empleado));

  $("#listaTipos").innerHTML = tipos.map((v) => `<option value="${esc(v)}">`).join("");
  $("#listaRutas").innerHTML = rutas.map((v) => `<option value="${esc(v)}">`).join("");
  $("#listaEmpleados").innerHTML = empleados.map((v) => `<option value="${esc(v)}">`).join("");

  llenarSelect($("#filtroTipo"), tipos, "Todos los tipos");
  llenarSelect($("#filtroRuta"), rutas, "Todas las rutas");
}

// ==========================================================
// Vista: Inventario
// ==========================================================
function renderEquipos() {
  if (!state.cargado.equipos) return;

  const total = state.equipos.reduce((s, e) => s + (e.cantidad || 0), 0);
  const asignados = state.equipos.reduce((s, e) => s + (e.asignados || 0), 0);
  $("#summaryInventario").innerHTML =
    `<b>${fmt.format(total)}</b> equipos en total<span class="sep">·</span>` +
    `<b>${fmt.format(asignados)}</b> asignados<span class="sep">·</span>` +
    `<b class="ok">${fmt.format(total - asignados)}</b> disponibles`;

  const q = normalizar($("#buscarEquipo").value);
  const tipo = $("#filtroTipo").value;
  const lista = state.equipos.filter((e) =>
    (!tipo || normalizar(e.tipo) === normalizar(tipo)) &&
    (!q || normalizar(`${e.nombre} ${e.tipo}`).includes(q)));

  const tbody = $("#tbodyEquipos");
  const empty = $("#emptyEquipos");

  if (!lista.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = state.equipos.length
      ? "<strong>Sin resultados</strong>Ningún equipo coincide con la búsqueda."
      : `<strong>Aún no hay equipos registrados</strong>Da de alta el primer modelo para empezar a llevar el control.
         <div><button class="btn btn--primary" data-accion="nuevo-equipo">Registrar equipo</button></div>`;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = lista.map((e) => {
    const disp = disponibles(e);
    const pct = e.cantidad ? Math.round(((e.asignados || 0) / e.cantidad) * 100) : 0;
    return `
      <tr>
        <td><div class="cell-main">${esc(e.nombre)}</div><div class="cell-sub">Alta ${fecha(e.creadoEn)}</div></td>
        <td><span class="tag">${esc(e.tipo)}</span></td>
        <td class="num">${fmt.format(e.cantidad || 0)}</td>
        <td class="num">${fmt.format(e.asignados || 0)}</td>
        <td class="num">${disp ? `<span class="badge badge--ok">${fmt.format(disp)}</span>` : '<span class="badge badge--danger">Agotado</span>'}</td>
        <td>
          <div class="usage">
            <div class="usage__bar ${disp === 0 ? "is-full" : ""}"><span style="width:${pct}%"></span></div>
            <span class="usage__pct">${pct}%</span>
          </div>
        </td>
        <td class="actions">
          <button class="icon-btn" data-accion="asignar" data-id="${e.id}" title="Asignar" aria-label="Asignar ${esc(e.nombre)}" ${disp ? "" : "disabled"}>${ICON.assign}</button>
          <button class="icon-btn" data-accion="editar" data-id="${e.id}" title="Editar" aria-label="Editar ${esc(e.nombre)}">${ICON.edit}</button>
          <button class="icon-btn is-danger" data-accion="eliminar-equipo" data-id="${e.id}" title="Eliminar" aria-label="Eliminar ${esc(e.nombre)}">${ICON.trash}</button>
        </td>
      </tr>`;
  }).join("");
}

$("#buscarEquipo").addEventListener("input", renderEquipos);
$("#filtroTipo").addEventListener("change", renderEquipos);

$("#view-inventario").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-accion]");
  if (!btn) return;
  const { accion, id } = btn.dataset;
  if (accion === "nuevo-equipo") abrirEquipo();
  if (accion === "editar") abrirEquipo(id);
  if (accion === "asignar") abrirAsignacion(id);
  if (accion === "eliminar-equipo") eliminarEquipo(id);
});

// ---------- Alta / edición de equipo ----------
$("#btnNuevoEquipo").addEventListener("click", () => abrirEquipo());

function abrirEquipo(id = null) {
  const form = $("#formEquipo");
  form.reset();
  limpiarErrores(form);
  state.editandoEquipoId = id;
  const e = id ? state.equipos.find((x) => x.id === id) : null;

  $("#dlgEquipoTitulo").textContent = e ? "Editar equipo" : "Nuevo equipo";
  $("#btnGuardarEquipo").textContent = e ? "Guardar cambios" : "Registrar equipo";
  $("#hintCantidad").textContent = e?.asignados ? `Mínimo ${e.asignados} (unidades asignadas).` : "";

  if (e) {
    form.nombre.value = e.nombre;
    form.tipo.value = e.tipo;
    form.cantidad.value = e.cantidad;
  }
  $("#dlgEquipo").showModal();
  form.nombre.focus();
}

$("#formEquipo").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  limpiarErrores(form);

  const nombre = limpiar(form.nombre.value);
  const tipo = limpiar(form.tipo.value);
  const cantidad = Number(form.cantidad.value);
  const id = state.editandoEquipoId;
  const actual = id ? state.equipos.find((x) => x.id === id) : null;
  let ok = true;

  if (!nombre) { setError(form.nombre, "Escribe el nombre del equipo."); ok = false; }
  else {
    const dup = state.equipos.find((x) => x.id !== id && normalizar(x.nombre) === normalizar(nombre));
    if (dup) { setError(form.nombre, "Ya existe un equipo con ese nombre. Edítalo para ajustar la cantidad."); ok = false; }
  }
  if (!tipo) { setError(form.tipo, "Indica el tipo."); ok = false; }
  if (!Number.isInteger(cantidad) || cantidad < 1) { setError(form.cantidad, "Cantidad entera mayor a 0."); ok = false; }
  else if (actual && cantidad < (actual.asignados || 0)) {
    setError(form.cantidad, `No puede ser menor a ${actual.asignados} asignados.`); ok = false;
  }
  if (!ok) return;

  await conCarga($("#btnGuardarEquipo"), async () => {
    try {
      if (id) {
        const ref = doc(db, "equipos", id);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) throw new Error("El equipo ya no existe.");
          if (cantidad < (snap.data().asignados || 0)) throw new Error("La cantidad es menor a las unidades asignadas.");
          tx.update(ref, { nombre, nombreNorm: normalizar(nombre), tipo, cantidad, actualizadoEn: serverTimestamp() });
        });
        toast("Equipo actualizado");
      } else {
        await addDoc(colEquipos, {
          nombre, nombreNorm: normalizar(nombre), tipo, cantidad,
          asignados: 0, creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp(),
        });
        toast("Equipo registrado");
      }
      $("#dlgEquipo").close();
    } catch (err) { toast(errorFirebase(err), "error"); }
  });
});

async function eliminarEquipo(id) {
  const e = state.equipos.find((x) => x.id === id);
  if (!e) return;
  if (e.asignados > 0) {
    toast(`No se puede eliminar: tiene ${e.asignados} unidad(es) asignada(s). Devuélvelas primero.`, "error");
    return;
  }
  const ok = await confirmar({
    titulo: "Eliminar equipo",
    mensaje: `Se eliminará "${e.nombre}" del inventario. El historial de asignaciones devueltas se conserva.`,
    accion: "Eliminar", peligro: true,
  });
  if (!ok) return;
  try {
    const ref = doc(db, "equipos", id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      if ((snap.data().asignados || 0) > 0) throw new Error("El equipo tiene unidades asignadas.");
      tx.delete(ref);
    });
    toast("Equipo eliminado");
  } catch (err) { toast(errorFirebase(err), "error"); }
}

// ==========================================================
// Vista: Asignaciones
// ==========================================================
function renderAsignaciones() {
  if (!state.cargado.asignaciones) return;

  const activas = state.asignaciones.filter((a) => a.estado === "activa");
  const empleados = new Set(activas.map((a) => normalizar(a.empleado))).size;
  const rutas = new Set(activas.map((a) => normalizar(a.ruta))).size;
  $("#summaryAsignaciones").innerHTML =
    `<b>${fmt.format(activas.length)}</b> asignaciones activas<span class="sep">·</span>` +
    `<b>${fmt.format(empleados)}</b> empleados<span class="sep">·</span>` +
    `<b>${fmt.format(rutas)}</b> rutas`;

  const q = normalizar($("#buscarAsignacion").value);
  const ruta = $("#filtroRuta").value;
  const estado = $("#filtroEstado").value;
  const lista = state.asignaciones.filter((a) =>
    (!estado || a.estado === estado) &&
    (!ruta || normalizar(a.ruta) === normalizar(ruta)) &&
    (!q || normalizar(`${a.empleado} ${a.imei} ${a.telefono} ${a.equipoNombre} ${a.ruta}`).includes(q)));

  const tbody = $("#tbodyAsignaciones");
  const empty = $("#emptyAsignaciones");

  if (!lista.length) {
    tbody.innerHTML = "";
    empty.hidden = false;
    empty.innerHTML = state.asignaciones.length
      ? "<strong>Sin resultados</strong>Ninguna asignación coincide con los filtros."
      : `<strong>Aún no hay asignaciones</strong>Asigna un equipo a un empleado y ruta para empezar.
         <div><button class="btn btn--primary" data-accion="nueva-asignacion">Asignar equipo</button></div>`;
    return;
  }
  empty.hidden = true;

  tbody.innerHTML = lista.map((a) => {
    const activa = a.estado === "activa";
    return `
      <tr class="${activa ? "" : "is-dim"}">
        <td><div class="cell-main">${esc(a.empleado)}</div></td>
        <td>${esc(a.ruta)}</td>
        <td><div>${esc(a.equipoNombre)}</div><div class="cell-sub">${esc(a.equipoTipo)}</div></td>
        <td>${a.imei ? `<span class="mono">${esc(a.imei)}</span>` : '<span class="dash">—</span>'}</td>
        <td>${a.telefono ? `<span class="mono">${esc(a.telefono)}</span>` : '<span class="dash">—</span>'}</td>
        <td>${fecha(a.asignadoEn)}</td>
        <td>${activa
          ? '<span class="badge badge--ok badge--dot">Activa</span>'
          : `<span class="badge badge--muted" title="Devuelto ${fecha(a.devueltoEn)}">Devuelta</span>`}</td>
        <td class="actions">
          ${activa ? `<button class="icon-btn" data-accion="devolver" data-id="${a.id}" title="Registrar devolución" aria-label="Registrar devolución">${ICON.undo}</button>` : ""}
          <button class="icon-btn is-danger" data-accion="eliminar-asignacion" data-id="${a.id}" title="Eliminar registro" aria-label="Eliminar registro">${ICON.trash}</button>
        </td>
      </tr>`;
  }).join("");
}

$("#buscarAsignacion").addEventListener("input", renderAsignaciones);
$("#filtroRuta").addEventListener("change", renderAsignaciones);
$("#filtroEstado").addEventListener("change", renderAsignaciones);

$("#view-asignaciones").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-accion]");
  if (!btn) return;
  const { accion, id } = btn.dataset;
  if (accion === "nueva-asignacion") abrirAsignacion();
  if (accion === "devolver") devolverAsignacion(id);
  if (accion === "eliminar-asignacion") eliminarAsignacion(id);
});

// ---------- Nueva asignación ----------
$("#btnNuevaAsignacion").addEventListener("click", () => abrirAsignacion());

function abrirAsignacion(equipoId = "") {
  const conStock = state.equipos.filter((e) => disponibles(e) > 0);
  if (!conStock.length) {
    toast(state.equipos.length ? "No hay unidades disponibles para asignar." : "Primero registra un equipo en el inventario.", "error");
    return;
  }
  const form = $("#formAsignacion");
  form.reset();
  limpiarErrores(form);

  form.equipoId.innerHTML = '<option value="">Selecciona un equipo</option>' +
    conStock.map((e) =>
      `<option value="${e.id}">${esc(e.nombre)} · ${esc(e.tipo)} — ${disponibles(e)} disp.</option>`).join("");
  form.equipoId.value = conStock.some((e) => e.id === equipoId) ? equipoId : "";

  $("#dlgAsignacion").showModal();
  (form.equipoId.value ? form.ruta : form.equipoId).focus();
}

$("#formAsignacion").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const form = ev.currentTarget;
  limpiarErrores(form);

  const equipoId = form.equipoId.value;
  const ruta = limpiar(form.ruta.value);
  const empleado = limpiar(form.empleado.value);
  const imei = form.imei.value.trim();
  const telefono = form.telefono.value.trim();
  let ok = true;

  if (!equipoId) { setError(form.equipoId, "Selecciona el equipo."); ok = false; }
  if (!ruta) { setError(form.ruta, "Indica la ruta."); ok = false; }
  if (!empleado) { setError(form.empleado, "Escribe el nombre del empleado."); ok = false; }
  if (imei && !/^\d{15}$/.test(imei)) { setError(form.imei, "El IMEI debe tener 15 dígitos."); ok = false; }
  else if (imei && state.asignaciones.some((a) => a.estado === "activa" && a.imei === imei)) {
    setError(form.imei, "Este IMEI ya está asignado actualmente."); ok = false;
  }
  if (telefono && !/^\d{10}$/.test(telefono)) { setError(form.telefono, "El teléfono debe tener 10 dígitos."); ok = false; }
  if (!ok) return;

  await conCarga($("#btnGuardarAsignacion"), async () => {
    try {
      const equipoRef = doc(db, "equipos", equipoId);
      const nuevaRef = doc(colAsignaciones);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(equipoRef);
        if (!snap.exists()) throw new Error("El equipo ya no existe.");
        const e = snap.data();
        if ((e.asignados || 0) >= e.cantidad) throw new Error(`"${e.nombre}" ya no tiene unidades disponibles.`);
        tx.update(equipoRef, { asignados: increment(1), actualizadoEn: serverTimestamp() });
        tx.set(nuevaRef, {
          equipoId, equipoNombre: e.nombre, equipoTipo: e.tipo,
          ruta, empleado, imei, telefono,
          estado: "activa", asignadoEn: serverTimestamp(), devueltoEn: null,
        });
      });
      $("#dlgAsignacion").close();
      toast(`Equipo asignado a ${empleado}`);
    } catch (err) { toast(errorFirebase(err), "error"); }
  });
});

// ---------- Devolución ----------
async function devolverAsignacion(id) {
  const a = state.asignaciones.find((x) => x.id === id);
  if (!a) return;
  const ok = await confirmar({
    titulo: "Registrar devolución",
    mensaje: `${a.empleado} devuelve "${a.equipoNombre}". La unidad vuelve a quedar disponible.`,
    accion: "Registrar devolución",
  });
  if (!ok) return;
  try {
    await runTransaction(db, async (tx) => {
      const asigRef = doc(db, "asignaciones", id);
      const equipoRef = doc(db, "equipos", a.equipoId);
      const asig = await tx.get(asigRef);
      const eq = await tx.get(equipoRef);
      if (!asig.exists() || asig.data().estado !== "activa") throw new Error("La asignación ya no está activa.");
      tx.update(asigRef, { estado: "devuelta", devueltoEn: serverTimestamp() });
      if (eq.exists() && (eq.data().asignados || 0) > 0) {
        tx.update(equipoRef, { asignados: increment(-1), actualizadoEn: serverTimestamp() });
      }
    });
    toast("Devolución registrada");
  } catch (err) { toast(errorFirebase(err), "error"); }
}

// ---------- Eliminar registro ----------
async function eliminarAsignacion(id) {
  const a = state.asignaciones.find((x) => x.id === id);
  if (!a) return;
  const activa = a.estado === "activa";
  const ok = await confirmar({
    titulo: "Eliminar registro",
    mensaje: activa
      ? `Se eliminará la asignación de ${a.empleado} y la unidad volverá a estar disponible. Si fue una devolución, mejor usa "Registrar devolución" para conservar el historial.`
      : `Se eliminará del historial la asignación de ${a.empleado}.`,
    accion: "Eliminar", peligro: true,
  });
  if (!ok) return;
  try {
    await runTransaction(db, async (tx) => {
      const asigRef = doc(db, "asignaciones", id);
      const equipoRef = doc(db, "equipos", a.equipoId);
      const asig = await tx.get(asigRef);
      const eq = await tx.get(equipoRef);
      if (!asig.exists()) return;
      if (asig.data().estado === "activa" && eq.exists() && (eq.data().asignados || 0) > 0) {
        tx.update(equipoRef, { asignados: increment(-1), actualizadoEn: serverTimestamp() });
      }
      tx.delete(asigRef);
    });
    toast("Registro eliminado");
  } catch (err) { toast(errorFirebase(err), "error"); }
}
