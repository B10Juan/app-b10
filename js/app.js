// APP B10 · Arranque, inicio de sesión, permisos y navegación
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.56.0/+esm";
import { SUPABASE_URL, SUPABASE_KEY, APP_VERSION } from "./config.js";
import { $, el, toast } from "./util.js";
import { renderCompras, renderComprasRef } from "./modulos/compras.js";
import { renderUsuarios } from "./modulos/usuarios.js";
import { renderDemanda } from "./modulos/demanda.js";
import { renderTesoreria } from "./modulos/tesoreria.js";
import { renderTesoreriaClientes } from "./modulos/tesoreria_clientes.js";
import { renderPlanificador } from "./modulos/planificador.js";
import { renderRrhh, renderDatos } from "./modulos/rrhh.js";
import { renderOrganigrama } from "./modulos/organigrama.js";
import { renderVacaciones } from "./modulos/vacaciones.js";
import { logo, conImagen, icono, MARCA } from "./marca.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado compartido de la sesión
export { conImagen };
export const ctx = { ready:false, session:null, me:null, permisos:{}, modulos:[], ui:{ dd:null, ddq:"" } };

export const isAdmin = () => !!(ctx.me && ctx.me.es_admin && ctx.me.activo);
export function nivel(modulo){ if (isAdmin()) return "editar"; return ctx.permisos[modulo] || null; }
// Usar en cada módulo para activar o desactivar campos, botones y altas.
// La base de datos aplica la misma regla, así que aunque alguien forzara la pantalla no podría guardar.
export const puedeEditar = modulo => nivel(modulo) === "editar";

// Módulos de la pantalla de inicio. Los que aún no están construidos aparecen como «Próximamente».
const MODULOS = [
  { codigo:"compras",      ruta:"compras",  titulo:"Compras", texto:"Dashboard de facturas de proveedores: análisis por proveedor y artículo, unidades, precios medios e importes.", clase:"buy", listo:true },
  { codigo:"planificador", ruta:"planificador", titulo:"Planificador de compras", texto:"Revisión de artículos por proveedor, pedidos lanzados y previsión de pagos de importaciones.", clase:"", listo:true, tambien:"pagos" },
  { codigo:"plan_accion",  ruta:"plan",     titulo:"Plan Estratégico", texto:"Seguimiento del plan estratégico: líneas estratégicas, acciones clave, actividades y tareas, con responsables, estados, calendario y cronograma.", listo:true },
  { codigo:"demanda",      ruta:"demanda",  titulo:"Análisis de la demanda", texto:"Evolución de los pedidos de venta desde 2023: comparativas por año, estacionalidad, clientes, productos, zonas y agentes, cartera pendiente y detalle de líneas.", clase:"buy", listo:true },
  { codigo:"tesoreria_prov", ruta:"tesoreria-proveedores", titulo:"Facturas de proveedores pendientes de pago", texto:"Importes pendientes por proveedor y mes de vencimiento, separando lo vencido de lo que vence más adelante, con el detalle de cada factura.", clase:"pay", listo:true },
  { codigo:"tesoreria_cli", ruta:"tesoreria-clientes", titulo:"Facturas de clientes pendientes de cobro", texto:"Importes pendientes de cobro por mercado, sistema de cobro y cliente, por mes de vencimiento, vencido y no vencido, con la ficha de facturas y saldo acumulado de cada cliente.", clase:"pay", listo:true },
  { codigo:"rrhh",         ruta:"personas-costes", titulo:"Costes de personal", texto:"Coste de empresa por mes, sección y persona (nómina y ETT), previsión del mes siguiente y control de las ETT.", clase:"pay", listo:true },
  { codigo:"vacaciones",   ruta:"vacaciones", titulo:"Vacaciones", texto:"Días de vacaciones por trabajador: del año, pendientes de años anteriores, disfrutados y pendientes, con calendario de festivos e informe en PDF.", listo:true },
  { codigo:"organigrama",  ruta:"organigrama", titulo:"Organigrama", texto:"Estructura de dirección, apoyo a la dirección, pilares y departamentos, vista como organigrama y exportable a PowerPoint.", listo:true },
  { codigo:"datos",        ruta:"datos",    titulo:"Formulario introducción de datos", texto:"Tablas maestras de la empresa: fichas de personas (altas, bajas, ausencias) y estructura de clasificación, departamentos y puestos.", listo:true, tambien:"rrhh" },
  { codigo:"crm",          ruta:null,       titulo:"CRM de clientes", texto:"Información de clientes para los delegados.", listo:false },
];

// Primer nivel de la pantalla inicial: módulos sueltos y carpetas que agrupan módulos
const INICIO = [
  { tipo:"modulo",  codigo:"plan_accion" },
  { tipo:"carpeta", id:"operaciones", titulo:"Operaciones", texto:"Compras y planificación de las compras de importación.", hijos:["compras","planificador"] },
  { tipo:"usuarios" },
  { tipo:"carpeta", id:"tesoreria",   titulo:"Tesorería",   texto:"Pagos y cobros pendientes y previsión de tesorería.", hijos:["tesoreria_prov","tesoreria_cli"] },
  { tipo:"carpeta", id:"personas",    titulo:"Personas",    texto:"Plantilla, ETT y costes de personal.", hijos:["rrhh","organigrama","datos","vacaciones"] },
  { tipo:"carpeta", id:"comercial",   titulo:"Comercial",   texto:"Clientes y equipo comercial.", hijos:["demanda","crm"] },
];
const carpetaDe = codigo => INICIO.find(x => x.tipo === "carpeta" && x.hijos.includes(codigo));
export { INICIO, MODULOS };   // para Gestión de usuarios: árbol de áreas, módulos y submódulos
const visible = m => (m.listo && (nivel(m.codigo) || (m.tambien && nivel(m.tambien)))) || (!m.listo && isAdmin());

function route(){ const h = decodeURIComponent(location.hash.replace(/^#/,"")); return h || "inicio"; }
let rq = false;
export function render(){ if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; draw(); }); }

function draw(){
  // El plan va en un iframe: si ya está abierto no se vuelve a pintar (se recargaría)
  if (ctx.ready && ctx.session && ctx.me && route() === "plan" && planFrame && planFrame.isConnected && !((ctx.session.user.user_metadata || {}).debe_cambiar_password)) return;
  let app = $("#app"); app.classList.remove("con-lateral","menu-plegado","menu-movil");
  const sx = window.scrollX, sy = window.scrollY;
  const gw0 = document.querySelector(".gridwrap"), gx = gw0 ? gw0.scrollLeft : 0, gy = gw0 ? gw0.scrollTop : 0;
  const ae = document.activeElement, aeKey = ae && ae.dataset ? ae.dataset.k : null;
  app.textContent = "";
  if (!ctx.ready){ app.append(el("div","loading","Cargando…")); return; }
  if (!ctx.session) return drawLogin(app);
  if (!ctx.me) return drawSinAlta(app);
  const r = route();
  const md = (ctx.session.user.user_metadata || {});
  if (md.debe_cambiar_password) return drawPassword(app, true);
  if (r === "contrasena") return drawPassword(app, false);
  const esPlan = r === "planificador" || r === "proveedores" || r === "stock" || /^prov-\d+(-pedidos)?$/.test(r);
  // Menú lateral en todas las pantallas; las antiguas carpetas (#tesoreria, #personas…) abren la portada con su grupo desplegado
  const carpeta = INICIO.find(x => x.tipo === "carpeta" && x.id === r);
  if (carpeta){ menuAbrir(carpeta.id); history.replaceState(null, "", location.pathname + location.search); }
  const nsc = document.querySelector(".lat-nav"); const navTop = nsc ? nsc.scrollTop : 0;
  app.classList.add("con-lateral"); app.classList.toggle("menu-plegado", menuPlegado()); app.classList.remove("menu-movil");
  app.append(lateral(carpeta ? "inicio" : r), barraMovil()); const fondo = el("div","lat-fondo"); fondo.addEventListener("click", () => $("#app").classList.remove("menu-movil")); app.append(fondo);
  const m = el("main","contenido"); app.append(m); app = m;
  const nn = document.querySelector(".lat-nav"); if (nn) nn.scrollTop = navTop;
  if (r === "compras" && nivel("compras")) renderCompras(app);
  else if (r === "compras-ref" && nivel("compras")) renderComprasRef(app);
  else if (esPlan && (nivel("planificador") || (r === "planificador" && nivel("pagos")))) renderPlanificador(app, r);
  else if (r === "pagos" && nivel("pagos")) renderPlanificador(app, r);
  else if (r === "usuarios" && isAdmin()) renderUsuarios(app);
  else if (r === "plan" && nivel("plan_accion")) drawPlan(app);
  else if (r === "demanda" && nivel("demanda")) renderDemanda(app);
  else if (r === "tesoreria-proveedores" && nivel("tesoreria_prov")) renderTesoreria(app);
  else if (r === "tesoreria-clientes" && nivel("tesoreria_cli")) renderTesoreriaClientes(app);
  else if (r === "personas-costes" && nivel("rrhh")) renderRrhh(app);
  else if (r === "organigrama" && nivel("organigrama")) renderOrganigrama(app);
  else if (r === "vacaciones" && nivel("vacaciones")) renderVacaciones(app);
  else if (r === "datos" && (nivel("datos") || nivel("rrhh"))) renderDatos(app);
  else drawInicio(app);
  if (aeKey){ const n = document.querySelector(`[data-k="${CSS.escape(aeKey)}"]`); if (n) n.focus(); }
  window.scrollTo(sx, sy);
  const gw = document.querySelector(".gridwrap"); if (gw){ gw.scrollLeft = gx; gw.scrollTop = gy; }
}

export function cabecera(app, titulo, sub, volver, modulo){
  const h = el("header","top pad"), b = el("div","brand");
  // Miga de pan: el área del módulo (la navegación está en el menú lateral)
  if (volver){ const v = typeof volver === "object" ? volver : { txt:"Administración" }; b.append(el("span","miga", v.txt)); }
  const h1 = el("h1",null,titulo); b.append(h1); if (sub) b.append(el("p",null,sub));
  if (modulo && nivel(modulo) === "ver"){ const t = el("span","tag neutral","Solo visualización: puedes consultar y filtrar, pero no modificar datos"); t.style.display = "inline-block"; t.style.marginTop = "6px"; b.append(t); }
  const w = el("div","who"); w.append(el("span",null,(ctx.me.nombre || ctx.session.user.email) + (isAdmin() ? " (administrador)" : "")));
  const pwb = el("a","btn small","Contraseña"); pwb.href = "#contrasena";
  const out = el("button","btn small","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); });
  w.append(pwb, out); h.append(b, w); app.append(h);
}

// ---------- Menú lateral: estructura de áreas y módulos, plegable ----------
// Para añadir un módulo nuevo: añadirlo a MODULOS / INICIO (permisos) y aquí como entrada de su grupo.
const LS_PLEGADO = "b10.menu.plegado", LS_ABIERTOS = "b10.menu.abiertos";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento: el menú funciona igual */ } };
const menuPlegado = () => !!lsGet(LS_PLEGADO, false);
const abiertos = () => new Set(lsGet(LS_ABIERTOS, []));
function menuAbrir(id){ const s = abiertos(); s.add(id); lsSet(LS_ABIERTOS, [...s]); }
function plegarMenu(v){ lsSet(LS_PLEGADO, v); const a = $("#app"); if (a) a.classList.toggle("menu-plegado", v); }

const tituloArea = id => (INICIO.find(x => x.id === id) || {}).titulo || id;
function estructuraMenu(r){
  const m = (txt, href, ok, on, extra) => ({ txt, href, ok:!!ok, on:!!on, ...(extra || {}) });
  return [
    { id:"inicio", ic:"inicio", ...m("Inicio", "#", true, r === "inicio") },
    { id:"plan", ic:"plan", ...m("Plan Estratégico", "#plan", nivel("plan_accion"), r === "plan") },
    { grupo:"operaciones", ic:"operaciones", txt:tituloArea("operaciones"), items:[
      m("Compras", "#compras", nivel("compras"), r.startsWith("compras")),
      m("Planificador de compras", "#proveedores", nivel("planificador"), r === "proveedores" || r === "planificador" || /^prov-/.test(r)),
      m("Evolución del stock", "#stock", nivel("planificador"), r === "stock"),
      m("Previsión de pagos import.", "#pagos", nivel("pagos"), r === "pagos"),
    ]},
    { grupo:"tesoreria", ic:"tesoreria", txt:tituloArea("tesoreria"), items:[
      m("Pagos a proveedores", "#tesoreria-proveedores", nivel("tesoreria_prov"), r === "tesoreria-proveedores"),
      m("Cobros de clientes", "#tesoreria-clientes", nivel("tesoreria_cli"), r === "tesoreria-clientes"),
    ]},
    { grupo:"personas", ic:"personas", txt:tituloArea("personas"), items:[
      m("Costes de personal", "#personas-costes", nivel("rrhh"), r === "personas-costes"),
      m("Vacaciones", "#vacaciones", nivel("vacaciones"), r === "vacaciones"),
      m("Organigrama", "#organigrama", nivel("organigrama"), r === "organigrama"),
      m("Introducción de datos", "#datos", nivel("datos") || nivel("rrhh"), r === "datos"),
    ]},
    { grupo:"comercial", ic:"comercial", txt:tituloArea("comercial"), items:[
      m("Análisis de la demanda", "#demanda", nivel("demanda"), r === "demanda"),
      m("CRM de clientes", null, isAdmin(), false, { pronto:true }),
    ]},
    { grupo:"admin", ic:"ajustes", txt:"Administración", items:[
      m("Usuarios y permisos", "#usuarios", isAdmin(), r === "usuarios"),
    ]},
  ];
}

function lateral(r){
  const a = el("aside","lateral"); a.setAttribute("aria-label","Menú de la APP B10");
  // Cabecera: logo + lema y botón de plegar
  const top = el("div","lat-top");
  const lk = el("a","lat-logo"); lk.href = "#"; lk.title = "APP B10: inicio"; lk.append(logo("logo-lat"), el("span","lat-lema","gestión"));
  const pl = el("button","lat-plegar"); pl.type = "button";
  const setPl = () => { const p = menuPlegado(); pl.title = p ? "Mostrar el menú" : "Ocultar el menú"; pl.setAttribute("aria-label", pl.title); pl.setAttribute("aria-expanded", String(!p)); };
  pl.append(icono("panel")); setPl();
  pl.addEventListener("click", () => { if (window.matchMedia("(max-width:720px)").matches){ $("#app").classList.remove("menu-movil"); return; } plegarMenu(!menuPlegado()); setPl(); });
  top.append(lk, pl); a.append(top);

  const nav = el("nav","lat-nav"), ul = el("ul","lat-lista"); const ab = abiertos();
  for (const it of estructuraMenu(r)){
    if (!it.grupo){
      if (!it.ok) continue;
      const li = el("li"), x = el("a","lat-item" + (it.on ? " on" : "")); x.href = it.href; x.title = it.txt;
      if (it.on) x.setAttribute("aria-current","page");
      x.append(icono(it.ic), el("span","lat-txt",it.txt)); li.append(x); ul.append(li); continue;
    }
    const hijos = it.items.filter(h => h.ok); if (!hijos.length) continue;
    const activo = hijos.some(h => h.on), abierto = activo || ab.has(it.grupo);
    const li = el("li","lat-grupo" + (abierto ? " abierto" : "") + (activo ? " activo" : ""));
    const b = el("button","lat-item lat-cab"); b.type = "button"; b.title = it.txt; b.setAttribute("aria-expanded", String(abierto));
    const sid = "lat-g-" + it.grupo; b.setAttribute("aria-controls", sid);
    b.append(icono(it.ic), el("span","lat-txt",it.txt), icono("flecha"));
    b.addEventListener("click", () => {
      // Con el menú plegado, pulsar un área lo despliega con esa área abierta
      if ($("#app").classList.contains("menu-plegado")){ plegarMenu(false); setPl(); li.classList.add("abierto"); b.setAttribute("aria-expanded","true"); menuAbrir(it.grupo); return; }
      const ab2 = abiertos(), abre = !li.classList.contains("abierto");
      li.classList.toggle("abierto", abre); b.setAttribute("aria-expanded", String(abre));
      if (abre) ab2.add(it.grupo); else ab2.delete(it.grupo); lsSet(LS_ABIERTOS, [...ab2]);
    });
    const sub = el("ul","lat-sub"); sub.id = sid;
    for (const h of hijos){
      const sl = el("li");
      if (h.pronto){ const s = el("span","lat-subitem pronto", h.txt); s.append(el("small",null,"próximamente")); sl.append(s); }
      else { const x = el("a","lat-subitem" + (h.on ? " on" : ""), h.txt); x.href = h.href; if (h.on) x.setAttribute("aria-current","page"); sl.append(x); }
      sub.append(sl);
    }
    li.append(b, sub); ul.append(li);
  }
  nav.append(ul); a.append(nav);

  // Pie: usuario, contraseña y salir
  const pie = el("div","lat-pie");
  const nombre = ctx.me.nombre || ctx.session.user.email;
  const ini = nombre.split(/[\s@.]+/).filter(Boolean).slice(0,2).map(x => x[0].toUpperCase()).join("");
  const us = el("div","lat-user"); us.title = nombre;
  const txt = el("div","lat-txt"); txt.append(el("strong",null,nombre), el("small",null, isAdmin() ? "Administrador" : ctx.session.user.email));
  us.append(el("span","lat-av",ini), txt); pie.append(us);
  const acc = el("div","lat-acc");
  const pw = el("a","lat-item lat-mini"); pw.href = "#contrasena"; pw.title = "Cambiar contraseña"; pw.append(icono("clave"), el("span","lat-txt","Contraseña"));
  const out = el("button","lat-item lat-mini"); out.type = "button"; out.title = "Salir"; out.append(icono("salir"), el("span","lat-txt","Salir"));
  out.addEventListener("click", async () => { await sb.auth.signOut(); });
  acc.append(pw, out); pie.append(acc, el("span","lat-ver","v" + APP_VERSION)); a.append(pie);
  return a;
}

// Móvil: barra superior con el botón del menú
function barraMovil(){
  const h = el("header","barra-movil");
  const b = el("button","btn-menu"); b.type = "button"; b.setAttribute("aria-label","Abrir el menú"); b.append(icono("menu"));
  b.addEventListener("click", () => $("#app").classList.add("menu-movil"));
  const lk = el("a"); lk.href = "#"; lk.append(logo("logo-movil"));
  h.append(b, lk); return h;
}

// Portada: imagen de la web b10bath.com (vídeo de la colección, con foto fija de respaldo)
function drawInicio(app){
  document.title = "APP B10: Gestión";
  const s = el("section","portada");
  const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (MARCA.portadaVideo && !quieto){
    const v = document.createElement("video"); v.className = "portada-media"; v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
    v.setAttribute("muted",""); v.setAttribute("playsinline",""); v.setAttribute("aria-hidden","true"); v.poster = MARCA.portada; v.preload = "auto";
    v.src = MARCA.portadaVideo; v.onerror = () => { const i = new Image(); i.className = "portada-media"; i.alt = ""; i.onerror = () => i.remove(); i.src = MARCA.portada; v.replaceWith(i); };
    s.append(v);
  } else { const i = new Image(); i.className = "portada-media"; i.alt = ""; i.onerror = () => i.remove(); i.src = MARCA.portada; s.append(i); }
  s.append(el("div","portada-velo"));
  const t = el("div","portada-txt");
  const lema = new Image(); lema.className = "portada-lema"; lema.alt = "be bath, b10"; lema.src = MARCA.lema; lema.onerror = () => lema.replaceWith(el("span","portada-lema txt","be bath, b10"));
  const h = new Date().getHours(), saludo = h < 14 ? "Buenos días" : h < 21 ? "Buenas tardes" : "Buenas noches";
  const nombre = (ctx.me.nombre || "").trim().split(/\s+/)[0];
  let hoy = new Date().toLocaleDateString("es-ES", { weekday:"long", day:"numeric", month:"long", year:"numeric" }); hoy = hoy[0].toUpperCase() + hoy.slice(1);
  t.append(lema, el("h1",null, saludo + (nombre ? ", " + nombre : "")), el("p",null,"Gestión interna de B10. Elige un módulo en el menú lateral."), el("p","portada-fecha", hoy));
  if (!MODULOS.some(visible) && !isAdmin()) t.append(el("p","portada-aviso","Todavía no tienes acceso a ningún módulo. Pide a un administrador que te dé permisos."));
  s.append(t); app.append(s);
}

// Plan de Acción del P.E.: la app de seguimiento va incrustada y comparte la sesión de APP B10
let planFrame = null;
function drawPlan(app){
  document.title = "Plan de Acción del P.E.";
  if (!planFrame){ planFrame = el("iframe","plan-frame"); planFrame.title = "Plan de Acción del P.E."; planFrame.src = "plan/index.html?v=" + APP_VERSION; }
  app.append(planFrame);
}

function drawLogin(app){
  document.title = "Acceso: APP B10";
  const box = el("div","login");
  box.append(el("h1",null,"APP B10"), el("p",null,"Entra con tu correo de empresa y tu contraseña."));
  const msg = el("div"); box.append(msg);
  const i = el("input"); i.type = "email"; i.placeholder = "nombre@b10bath.com"; i.autocomplete = "username"; i.setAttribute("aria-label","Correo electrónico");
  const pw = el("input"); pw.type = "password"; pw.placeholder = "Contraseña"; pw.autocomplete = "current-password"; pw.setAttribute("aria-label","Contraseña");
  const bt = el("button","btn primary","Entrar");
  const go = async () => {
    const email = i.value.trim(), password = pw.value;
    if (!email){ i.focus(); return; } if (!password){ pw.focus(); return; }
    bt.disabled = true; bt.textContent = "Entrando…";
    const { error } = await sb.auth.signInWithPassword({ email, password });
    bt.disabled = false; bt.textContent = "Entrar";
    if (error){ msg.className = "err-msg"; msg.textContent = "Correo o contraseña incorrectos. Si no la recuerdas, pide al administrador una contraseña nueva."; pw.select(); }
  };
  bt.addEventListener("click", go);
  for (const n of [i, pw]) n.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  box.append(i, pw, bt);
  // Acceso alternativo por enlace (útil para el primer acceso del administrador)
  const alt = el("p","hint"); alt.style.marginTop = "16px";
  const lk = el("button","btn small","Recibir un enlace de acceso por correo");
  lk.addEventListener("click", async () => {
    const email = i.value.trim(); if (!email){ msg.className = "err-msg"; msg.textContent = "Escribe primero tu correo."; i.focus(); return; }
    const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:false, emailRedirectTo: location.origin + location.pathname } });
    msg.className = error ? "err-msg" : "ok-msg";
    msg.textContent = error ? "No hemos podido enviar el enlace. Pide al administrador una contraseña." : `Te hemos enviado un enlace a ${email}. Ábrelo desde este mismo navegador y después crea tu contraseña.`;
  });
  alt.append(lk); box.append(alt);
  app.append(box); setTimeout(() => i.focus(), 30);
}

// Cambio de contraseña: obligatorio si el administrador la ha asignado, y disponible siempre desde «Contraseña»
function drawPassword(app, obligatorio){
  document.title = "Contraseña: APP B10";
  const box = el("div","login");
  box.append(el("h1",null, obligatorio ? "Crea tu contraseña" : "Cambiar contraseña"),
    el("p",null, obligatorio ? "Es tu primer acceso o el administrador te ha dado una contraseña temporal. Elige una contraseña personal para continuar." : "Elige una contraseña nueva de al menos 8 caracteres."));
  const msg = el("div"); box.append(msg);
  const p1 = el("input"); p1.type = "password"; p1.placeholder = "Contraseña nueva (mínimo 8 caracteres)"; p1.autocomplete = "new-password"; p1.setAttribute("aria-label","Contraseña nueva");
  const p2 = el("input"); p2.type = "password"; p2.placeholder = "Repite la contraseña"; p2.autocomplete = "new-password"; p2.setAttribute("aria-label","Repite la contraseña");
  const bt = el("button","btn primary","Guardar contraseña");
  const go = async () => {
    if (p1.value.length < 8){ msg.className = "err-msg"; msg.textContent = "La contraseña debe tener al menos 8 caracteres."; p1.focus(); return; }
    if (p1.value !== p2.value){ msg.className = "err-msg"; msg.textContent = "Las dos contraseñas no coinciden."; p2.focus(); return; }
    bt.disabled = true;
    const { error } = await sb.auth.updateUser({ password: p1.value, data:{ debe_cambiar_password:false } });
    bt.disabled = false;
    if (error){ msg.className = "err-msg"; msg.textContent = error.message && error.message.includes("different") ? "La contraseña nueva debe ser distinta de la anterior." : "No se ha podido guardar la contraseña. Prueba con otra más larga."; return; }
    toast("Contraseña guardada"); location.hash = ""; render();
  };
  bt.addEventListener("click", go); for (const n of [p1, p2]) n.addEventListener("keydown", e => { if (e.key === "Enter") go(); });
  box.append(p1, p2, bt);
  if (!obligatorio){ const c = el("a","back","‹ Volver"); c.href = "#"; c.style.display = "block"; c.style.marginTop = "14px"; box.append(c); }
  else { const out = el("button","btn small","Salir"); out.style.marginTop = "14px"; out.addEventListener("click", async () => { await sb.auth.signOut(); }); box.append(out); }
  app.append(box); setTimeout(() => p1.focus(), 30);
}

function drawSinAlta(app){
  const box = el("div","login");
  box.append(el("h1",null,"Sin acceso"), el("p",null,"Tu usuario existe, pero no está activo en la APP B10. Pide a un administrador que te dé de alta."));
  const out = el("button","btn","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); }); box.append(out); app.append(box);
}

async function cargarPerfil(){
  ctx.me = null; ctx.permisos = {};
  if (!ctx.session) return;
  const uid = ctx.session.user.id;
  const [u, p] = await Promise.all([
    sb.schema("core").from("usuarios").select("id,email,nombre,es_admin,activo").eq("id", uid).maybeSingle(),
    sb.schema("core").from("permisos").select("modulo,nivel").eq("usuario_id", uid),
  ]);
  if (u.error) toast("No se ha podido leer tu perfil.");
  if (u.data && u.data.activo) ctx.me = u.data;
  for (const r of (p.data || [])) ctx.permisos[r.modulo] = r.nivel;
}

document.addEventListener("click", () => { if (ctx.ui.dd){ ctx.ui.dd = null; render(); } });
document.addEventListener("keydown", e => { if (e.key === "Escape" && ctx.ui.dd){ ctx.ui.dd = null; render(); } });
window.addEventListener("hashchange", () => { window.scrollTo(0,0); const a = $("#app"); if (a) a.classList.remove("menu-movil"); render(); });

// Las llamadas a Supabase se hacen fuera del aviso de sesión para no bloquearlo
sb.auth.onAuthStateChange((_ev, session) => {
  setTimeout(async () => {
    const changed = (session && session.user.id) !== (ctx.session && ctx.session.user.id) || !ctx.ready;
    ctx.session = session;
    if (changed) await cargarPerfil();
    if (_ev === "USER_UPDATED") ctx.session = session;
    ctx.ready = true;
    render();
  }, 0);
});
