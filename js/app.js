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
  const out = el("button","btn small","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); });
  w.append(out); h.append(b, w); app.append(h);
}

function drawInicio(app){
  document.title = "APP B10: Gestión";
  const h = el("header","top pad"), b = el("div","brand"), h1 = el("h1",null,"APP B10"); h1.append(el("span","sub2","Gestión")); b.append(h1);
  const w = el("div","who"); w.append(el("span",null,(ctx.me.nombre || ctx.session.user.email) + (isAdmin() ? " (administrador)" : "")));
  const out = el("button","btn small","Salir"); out.addEventListener("click", async () => { await sb.auth.signOut(); }); w.append(out);
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
  box.append(el("h1",null,"APP B10"), el("p",null,"Escribe tu correo de empresa y te enviaremos un enlace para entrar, sin contraseña."));
  const msg = el("div"); box.append(msg);
  const i = el("input"); i.type = "email"; i.placeholder = "nombre@b10bath.com"; i.autocomplete = "email"; i.setAttribute("aria-label","Correo electrónico");
  const bt = el("button","btn primary","Enviarme el enlace");
  const go = async () => {
    const email = i.value.trim(); if (!email){ i.focus(); return; }
    bt.disabled = true; bt.textContent = "Enviando…";
    const { error } = await sb.auth.signInWithOtp({ email, options:{ shouldCreateUser:false, emailRedirectTo: location.origin + location.pathname } });
    bt.disabled = false; bt.textContent = "Enviarme el enlace";
    msg.className = error ? "err-msg" : "ok-msg";
    msg.textContent = error ? "No hemos podido enviar el enlace. Comprueba que el correo está dado de alta en la APP." : `Te hemos enviado un enlace a ${email}. Ábrelo desde este mismo navegador.`;
  };
  bt.addEventListener("click", go); i.addEventListener("keydown", e => { if (e.key==="Enter") go(); });
  box.append(i, bt); app.append(box); setTimeout(() => i.focus(), 30);
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
    ctx.ready = true;
    render();
  }, 0);
});
