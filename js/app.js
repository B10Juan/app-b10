// APP B10 · Arranque, inicio de sesión, permisos y navegación
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.56.0/+esm";
import { SUPABASE_URL, SUPABASE_KEY, APP_VERSION } from "./config.js";
import { $, el, toast } from "./util.js";
import { renderCompras } from "./modulos/compras.js";
import { renderUsuarios } from "./modulos/usuarios.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Estado compartido de la sesión
export const ctx = { ready:false, session:null, me:null, permisos:{}, modulos:[], ui:{ dd:null, ddq:"" } };

export const isAdmin = () => !!(ctx.me && ctx.me.es_admin && ctx.me.activo);
export function nivel(modulo){ if (isAdmin()) return "editar"; return ctx.permisos[modulo] || null; }
// Usar en cada módulo para activar o desactivar campos, botones y altas.
// La base de datos aplica la misma regla, así que aunque alguien forzara la pantalla no podría guardar.
export const puedeEditar = modulo => nivel(modulo) === "editar";

// Módulos de la pantalla de inicio. Los que aún no están construidos aparecen como «Próximamente».
const MODULOS = [
  { codigo:"compras",      ruta:"compras",  titulo:"Compras", texto:"Dashboard de facturas de proveedores: análisis por proveedor y artículo, unidades, precios medios e importes.", clase:"buy", listo:true },
  { codigo:"planificador", ruta:null,       titulo:"Planificador de compras", texto:"Revisión de artículos por proveedor, pedidos lanzados y previsión de pagos de importaciones.", listo:false },
  { codigo:"plan_accion",  ruta:null,       titulo:"Plan de acción", texto:"Seguimiento del plan de acción del plan estratégico.", listo:false },
  { codigo:"crm",          ruta:null,       titulo:"CRM de clientes", texto:"Información de clientes para los delegados.", listo:false },
];

function route(){ const h = decodeURIComponent(location.hash.replace(/^#/,"")); return h || "inicio"; }
let rq = false;
export function render(){ if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; draw(); }); }

function draw(){
  const app = $("#app");
  const sx = window.scrollX, sy = window.scrollY;
  const ae = document.activeElement, aeKey = ae && ae.dataset ? ae.dataset.k : null;
  app.textContent = "";
  if (!ctx.ready){ app.append(el("div","loading","Cargando…")); return; }
  if (!ctx.session) return drawLogin(app);
  if (!ctx.me) return drawSinAlta(app);
  const r = route();
  const md = (ctx.session.user.user_metadata || {});
  if (md.debe_cambiar_password) return drawPassword(app, true);
  if (r === "contrasena") return drawPassword(app, false);
  if (r === "compras" && nivel("compras")) renderCompras(app);
  else if (r === "usuarios" && isAdmin()) renderUsuarios(app);
  else drawInicio(app);
  if (aeKey){ const n = document.querySelector(`[data-k="${CSS.escape(aeKey)}"]`); if (n) n.focus(); }
  window.scrollTo(sx, sy);
}

export function cabecera(app, titulo, sub, volver, modulo){
  const h = el("header","top pad"), b = el("div","brand");
  if (volver){ const bk = el("a","back","‹ APP B10"); bk.href = "#"; b.append(bk); }
  const h1 = el("h1",null,titulo); b.append(h1); if (sub) b.append(el("p",null,sub));
  if (modulo && nivel(modulo) === "ver"){ const t = el("span","tag neutral","Solo visualización: puedes consultar y filtrar, pero no modificar datos"); t.style.display = "inline-block"; t.style.marginTop = "6px"; b.append(t); }
  const w = el("div","who"); w.append(el("span",null,(ctx.me.nombre || ctx.session.user.email) + (isAdmin() ? " (administrador)" : "")));
  const pwb = el("a","btn small","Contraseña"); pwb.href = "#contrasena";
  const out = el("button","btn small","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); });
  w.append(pwb, out); h.append(b, w); app.append(h);
}

function drawInicio(app){
  document.title = "APP B10: Gestión";
  const h = el("header","top pad"), b = el("div","brand"), h1 = el("h1",null,"APP B10"); h1.append(el("span","sub2","Gestión")); b.append(h1);
  const w = el("div","who"); w.append(el("span",null,(ctx.me.nombre || ctx.session.user.email) + (isAdmin() ? " (administrador)" : "")));
  const pwb = el("a","btn small","Contraseña"); pwb.href = "#contrasena"; const out = el("button","btn small","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); }); w.append(pwb, out);
  h.append(b, w); app.append(h);
  const g = el("div","modules pad"); let n = 0;
  for (const m of MODULOS){
    if (m.listo && !nivel(m.codigo)) continue;
    if (!m.listo && !isAdmin()) continue;
    const a = el("a","mod-card"+(m.clase?" "+m.clase:"")+(m.listo?"":" soon")); if (m.listo) a.href = "#"+m.ruta;
    a.append(el("h2",null,m.titulo), el("p",null,m.texto));
    const t = el("div","stats"); t.append(el("span","tag "+(m.listo?"neutral":"pend"), m.listo ? (nivel(m.codigo)==="editar"?"Edición":"Visualización") : "Próximamente")); a.append(t);
    g.append(a); n++;
  }
  if (isAdmin()){ const a = el("a","mod-card usr"); a.href = "#usuarios"; a.append(el("h2",null,"Gestión de usuarios"), el("p",null,"Permisos de consulta o edición de cada persona en cada módulo.")); g.append(a); n++; }
  if (!n) g.append(el("div","card empty","Todavía no tienes acceso a ningún módulo. Pide a un administrador que te dé permisos."));
  app.append(g);
  app.append(el("p","hint pad",`Versión ${APP_VERSION}`));
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
window.addEventListener("hashchange", () => { window.scrollTo(0,0); render(); });

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
