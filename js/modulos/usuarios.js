// APP B10 · Gestión de usuarios (solo administradores)
import { sb, ctx, render, cabecera } from "../app.js";
import { el, toast } from "../util.js";

const st = { cargado:false, cargando:false, usuarios:[], permisos:[], modulos:[] };
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
  const ib = el("div","infobox");
  ib.textContent = "Para dar de alta a una persona: en Supabase, Authentication > Users > Add user > Send invitation, con su correo de empresa. En cuanto acepte, aparecerá aquí sin permisos y podrás asignárselos. Los administradores tienen acceso completo a todo.";
  box.append(ib);
  const lg = el("div","infobox");
  lg.append(el("b",null,"Niveles de permiso por módulo. "), "Sin acceso: el módulo no aparece. Visualización: puede ver, buscar, filtrar y exportar, pero no introducir ni modificar datos (por ejemplo, en el planificador no puede cambiar previsiones, entradas ni pedidos). Edición: puede además introducir y modificar datos. La base de datos aplica estos permisos, no solo la pantalla.");
  box.append(lg);
  const tw = el("div","tblwrap"), t = el("table","tbl");
  const th = el("thead"), hr = el("tr");
  for (const x of ["Usuario", ...st.modulos.map(m => m.nombre), "Administrador", "Activo"]) hr.append(el("th",null,x));
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
    tr.append(ca, cv); tb.append(tr);
  }
  t.append(tb); tw.append(t); box.append(tw);
}
