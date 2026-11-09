// APP B10 · Gestión de usuarios (solo administradores)
import { sb, ctx, render, cabecera } from "../app.js";
import { el, toast } from "../util.js";

const st = { cargado:false, cargando:false, usuarios:[], permisos:[], modulos:[], form:null, aviso:null };

// Contraseña temporal legible (sin caracteres confusos)
function generarPassword(){
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(12); crypto.getRandomValues(a);
  return Array.from(a, n => c[n % c.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
}
async function crearUsuario(f){
  const { error } = await sb.schema("core").rpc("crear_usuario", { p_email:f.email, p_nombre:f.nombre, p_password:f.password, p_es_admin:f.admin, p_permisos:f.permisos });
  if (error){ toast(error.message || "No se ha podido crear el usuario."); return false; }
  st.aviso = { email:f.email.trim().toLowerCase(), password:f.password, nuevo:true }; st.form = null; await cargar(); return true;
}
async function nuevaPassword(u){
  if (!confirm(`¿Asignar una contraseña nueva a ${u.email}? La actual dejará de funcionar.`)) return;
  const pw = generarPassword();
  const { error } = await sb.schema("core").rpc("cambiar_password_usuario", { p_uid:u.id, p_password:pw });
  if (error){ toast(error.message || "No se ha podido cambiar la contraseña."); return; }
  st.aviso = { email:u.email, password:pw, nuevo:false }; render();
}
const NIVELES = [["","Sin acceso"],["ver","Visualización"],["editar","Edición"]];

async function cargar(){
  st.cargando = true;
  const [u, p, m] = await Promise.all([
    sb.schema("core").from("usuarios").select("id,email,nombre,es_admin,activo,creado_en").order("email"),
    sb.schema("core").from("permisos").select("usuario_id,modulo,nivel"),
    sb.schema("core").from("modulos").select("codigo,nombre,orden").order("orden"),
  ]);
  if (u.error || p.error || m.error) toast("No se han podido cargar los usuarios.");
  st.usuarios = u.data || []; st.permisos = p.data || []; st.modulos = m.data || [];
  st.cargado = true; st.cargando = false; render();
}

async function setNivel(uid, modulo, nivel){
  const q = sb.schema("core").from("permisos");
  const { error } = nivel
    ? await q.upsert({ usuario_id:uid, modulo, nivel }, { onConflict:"usuario_id,modulo" })
    : await q.delete().eq("usuario_id", uid).eq("modulo", modulo);
  if (error){ toast("No se ha podido guardar el permiso."); return; }
  toast("Permiso actualizado"); await cargar();
}
async function setCampo(uid, campo, valor){
  if (uid === ctx.me.id && (campo === "es_admin" || campo === "activo") && !valor){ toast("No puedes quitarte a ti mismo el acceso de administrador."); render(); return; }
  const { error } = await sb.schema("core").from("usuarios").update({ [campo]:valor }).eq("id", uid);
  if (error){ toast("No se ha podido guardar el cambio."); return; }
  toast("Usuario actualizado"); await cargar();
}

export function renderUsuarios(app){
  document.title = "Gestión de usuarios";
  cabecera(app, "Gestión de usuarios", "Permisos de cada persona en cada módulo de la APP.", true);
  const box = el("div","pad"); box.style.paddingBottom = "32px"; app.append(box);
  if (!st.cargado){ if (!st.cargando) cargar(); box.append(el("div","card empty","Cargando usuarios…")); return; }
  // Aviso con la contraseña recién creada (solo se muestra una vez)
  if (st.aviso){
    const a = st.aviso, av = el("div","ok-msg"); av.style.marginBottom = "14px";
    av.append(el("b",null, a.nuevo ? "Usuario creado. " : "Contraseña cambiada. "), `Comunica a ${a.email} su contraseña temporal: `);
    const code = el("code",null,a.password); code.style.cssText = "font-size:16px;font-weight:700;padding:2px 6px;background:var(--surface);border-radius:4px";
    const cp = el("button","btn small","Copiar"); cp.style.marginLeft = "8px"; cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(a.password); toast("Contraseña copiada"); } catch(e){ toast("No se ha podido copiar; cópiala a mano"); } });
    const ok = el("button","btn small","Hecho"); ok.style.marginLeft = "6px"; ok.addEventListener("click", () => { st.aviso = null; render(); });
    av.append(code, cp, ok, el("div",null,"Al entrar por primera vez tendrá que elegir su propia contraseña. Esta no se volverá a mostrar."));
    box.append(av);
  }
  // Alta de usuario
  if (!st.form){
    const nb = el("button","btn primary","Nuevo usuario"); nb.addEventListener("click", () => { st.form = { nombre:"", email:"", password:generarPassword(), admin:false, permisos:{} }; render(); });
    box.append(nb);
  } else {
    const f = st.form, card = el("div","card"); card.style.cssText = "margin:4px 0 16px;max-width:760px";
    card.append(el("h2","sec","Nuevo usuario"));
    const grid = el("div","f2"); grid.style.marginTop = "10px";
    const campo = (lab, key, type, ph) => { const d = el("div","f"); const l = el("label",null,lab); const i = el("input"); i.type = type; i.placeholder = ph||""; i.value = f[key]; i.dataset.k = "nu-"+key; i.id = "nu-"+key; l.htmlFor = i.id; i.addEventListener("input", () => { f[key] = i.value; }); d.append(l, i); return d; };
    grid.append(campo("Nombre y apellidos","nombre","text","Juana García"), campo("Correo de empresa","email","email","jgarcia@b10bath.com"));
    const pd = el("div","f"); const pl = el("label",null,"Contraseña temporal"); pl.htmlFor = "nu-password";
    const pr = el("div"); pr.style.cssText = "display:flex;gap:6px";
    const pi = el("input"); pi.id = "nu-password"; pi.dataset.k = "nu-password"; pi.value = f.password; pi.style.flex = "1"; pi.addEventListener("input", () => { f.password = pi.value; });
    const gb = el("button","btn small","Generar otra"); gb.type = "button"; gb.addEventListener("click", () => { f.password = generarPassword(); render(); });
    pr.append(pi, gb); pd.append(pl, pr, el("span","hint","Mínimo 8 caracteres. La tendrá que cambiar al entrar."));
    const ad = el("div","f"); const al = el("label"); al.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:22px"; const ac = el("input"); ac.type = "checkbox"; ac.checked = f.admin; ac.addEventListener("change", () => { f.admin = ac.checked; render(); }); al.append(ac, "Administrador (acceso completo a todo)"); ad.append(al);
    grid.append(pd, ad); card.append(grid);
    if (!f.admin){
      card.append(el("p","secsub","Permisos por módulo"));
      const pt = el("div"); pt.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px 16px;margin:8px 0 12px";
      for (const m of st.modulos){ const d = el("label","fld"); d.style.cssText = "display:grid;gap:3px;font-size:13px;color:var(--ink-2);font-weight:600"; const s2 = el("select"); s2.style.cssText = "border:1px solid var(--line-strong);border-radius:6px;padding:6px 8px;background:var(--surface-2)";
        for (const [v,l] of NIVELES){ const o = el("option",null,l); o.value = v; s2.append(o); } s2.value = f.permisos[m.codigo] || ""; s2.addEventListener("change", () => { if (s2.value) f.permisos[m.codigo] = s2.value; else delete f.permisos[m.codigo]; });
        d.append(m.nombre, s2); pt.append(d); }
      card.append(pt);
    }
    const acts = el("div","actions"); acts.style.justifyContent = "flex-start";
    const cr = el("button","btn primary","Crear usuario"); const cn = el("button","btn","Cancelar");
    cn.addEventListener("click", () => { st.form = null; render(); });
    cr.addEventListener("click", async () => {
      if (!f.nombre.trim()){ toast("Escribe el nombre"); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())){ toast("Escribe un correo válido"); return; }
      if (f.password.length < 8){ toast("La contraseña debe tener al menos 8 caracteres"); return; }
      cr.disabled = true; cr.textContent = "Creando…"; const ok = await crearUsuario({ ...f, permisos: f.admin ? {} : f.permisos }); if (!ok){ cr.disabled = false; cr.textContent = "Crear usuario"; }
    });
    acts.append(cr, cn); card.append(acts); box.append(card);
  }
  const lg = el("div","infobox");
  lg.append(el("b",null,"Niveles de permiso por módulo. "), "Sin acceso: el módulo no aparece. Visualización: puede ver, buscar, filtrar y exportar, pero no introducir ni modificar datos (por ejemplo, en el planificador no puede cambiar previsiones, entradas ni pedidos). Edición: puede además introducir y modificar datos. La base de datos aplica estos permisos, no solo la pantalla.");
  box.append(lg);
  const tw = el("div","tblwrap"), t = el("table","tbl");
  const th = el("thead"), hr = el("tr");
  for (const x of ["Usuario", ...st.modulos.map(m => m.nombre), "Administrador", "Activo", ""]) hr.append(el("th",null,x));
  th.append(hr); t.append(th);
  const tb = el("tbody");
  for (const u of st.usuarios){
    const tr = el("tr"); const c0 = el("td"); const pd = el("div","person"); const sp = el("span",null,u.nombre || u.email); sp.append(el("small",null,u.email)); pd.append(sp); c0.append(pd); tr.append(c0);
    for (const m of st.modulos){
      const td = el("td"), s = el("select"); s.setAttribute("aria-label",`Permiso de ${u.email} en ${m.nombre}`); s.disabled = u.es_admin;
      for (const [v,l] of NIVELES){ const o = el("option",null,l); o.value = v; s.append(o); }
      const cur = st.permisos.find(p => p.usuario_id===u.id && p.modulo===m.codigo); s.value = u.es_admin ? "editar" : (cur ? cur.nivel : "");
      s.addEventListener("change", () => setNivel(u.id, m.codigo, s.value)); td.append(s); tr.append(td);
    }
    const ca = el("td"), cba = el("input"); cba.type = "checkbox"; cba.checked = u.es_admin; cba.setAttribute("aria-label","Administrador"); cba.addEventListener("change", () => setCampo(u.id,"es_admin",cba.checked)); ca.append(cba);
    const cv = el("td"), cbv = el("input"); cbv.type = "checkbox"; cbv.checked = u.activo; cbv.setAttribute("aria-label","Activo"); cbv.addEventListener("change", () => setCampo(u.id,"activo",cbv.checked)); cv.append(cbv);
    const cpw = el("td"); const pb = el("button","btn small","Nueva contraseña"); pb.addEventListener("click", () => nuevaPassword(u)); cpw.append(pb);
    tr.append(ca, cv, cpw); tb.append(tr);
  }
  t.append(tb); tw.append(t); box.append(tw);
}
