// APP B10 · Gestión de usuarios (solo administradores)
import { sb, ctx, render, cabecera, INICIO, MODULOS } from "../app.js";
import { el, toast } from "../util.js";

const st = { cargado:false, cargando:false, usuarios:[], permisos:[], modulos:[], form:null, aviso:null, vista:"usuario", uid:null, nodo:null, abiertos:new Set(), q:"", sel:new Set(), copiar:"" };

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

// ---------- Árbol de permisos: área › módulo › submódulo (sale de las carpetas de la pantalla inicial) ----------
const SUBS = { planificador:[["planificador","Revisión de artículos, pedidos y evolución del stock"],["pagos","Previsión de pagos de importaciones"]] };
function arbol(){
  const nom = c => (st.modulos.find(m => m.codigo === c) || {}).nombre || (MODULOS.find(m => m.codigo === c) || {}).titulo || c;
  const usados = new Set(), areas = [];
  const modulo = c => { const m = MODULOS.find(x => x.codigo === c) || { codigo:c, titulo:nom(c) };
    const subs = SUBS[c] || null;   // submódulos con permiso propio (los «también» de otros módulos no lo son)
    const codes = subs ? subs.map(x => x[0]) : [c]; codes.forEach(x => usados.add(x));
    return { id:"m:"+c, nombre:m.titulo || nom(c), codes, subs: subs ? subs.map(([sc, sn]) => ({ id:"s:"+sc, nombre:sn, codes:[sc] })) : null, proximamente: m.listo === false }; };
  for (const it of INICIO){
    if (it.tipo === "modulo"){ const m = modulo(it.codigo); areas.push({ id:"a:"+it.codigo, nombre:m.nombre, codes:m.codes, mods:[m] }); }
    else if (it.tipo === "carpeta"){ const mods = it.hijos.map(modulo); areas.push({ id:"a:"+it.id, nombre:it.titulo, codes:mods.flatMap(m => m.codes), mods }); }
  }
  const otros = st.modulos.filter(m => !usados.has(m.codigo));   // módulos nuevos aún sin carpeta
  if (otros.length){ const mods = otros.map(m => modulo(m.codigo)); areas.push({ id:"a:otros", nombre:"Otros módulos", codes:mods.flatMap(m => m.codes), mods }); }
  return areas;
}
function nodos(){ const out = []; for (const a of arbol()){ out.push(a); for (const m of a.mods){ if (a.mods.length > 1 || m.subs) out.push(m); for (const s2 of (m.subs || [])) out.push(s2); } } return out; }
const nivelDe = (uid, code) => (st.permisos.find(p => p.usuario_id === uid && p.modulo === code) || {}).nivel || "";
function nivelNodo(uid, codes){ const v = new Set(codes.map(c => nivelDe(uid, c))); return v.size === 1 ? [...v][0] : "mixto"; }
async function setNiveles(uids, codes, nivel){
  const q = sb.schema("core").from("permisos");
  const { error } = nivel
    ? await q.upsert(uids.flatMap(u => codes.map(c => ({ usuario_id:u, modulo:c, nivel }))), { onConflict:"usuario_id,modulo" })
    : await q.delete().in("usuario_id", uids).in("modulo", codes);
  if (error){ toast("No se han podido guardar los permisos."); return false; }
  toast(uids.length > 1 ? `Permisos actualizados para ${uids.length} usuarios` : "Permisos actualizados"); await cargar(); return true;
}
async function copiarPermisos(origen, destino){
  const ps = st.permisos.filter(p => p.usuario_id === origen);
  const q = sb.schema("core").from("permisos");
  let r = await q.delete().eq("usuario_id", destino); if (r.error){ toast("No se han podido copiar los permisos."); return; }
  if (ps.length){ r = await sb.schema("core").from("permisos").insert(ps.map(p => ({ usuario_id:destino, modulo:p.modulo, nivel:p.nivel }))); if (r.error){ toast("No se han podido copiar los permisos."); return; } }
  toast("Permisos copiados"); await cargar();
}
// Selector de nivel en tres botones; «mixto» si el área o el módulo tienen niveles distintos dentro
function selNivel(actual, onSet, disabled){
  const w = el("div","seg nivseg" + (actual === "mixto" ? " mixto" : ""));
  for (const [v,l] of [["","Sin acceso"],["ver","Ver"],["editar","Editar"]]){
    const b = el("button",null,l); b.type = "button"; b.disabled = !!disabled; b.setAttribute("aria-pressed", String(actual === v));
    b.addEventListener("click", ev => { ev.stopPropagation(); if (actual !== v) onSet(v); }); w.append(b);
  }
  if (actual === "mixto") w.title = "Hay módulos con niveles distintos dentro: elige uno para igualarlos todos";
  return w;
}
const tagUsuario = u => u.es_admin ? el("span","tag ok","Administrador") : !u.activo ? el("span","tag pend","Inactivo") : null;
const nombreU = u => u.nombre || u.email;

export function renderUsuarios(app){
  document.title = "Gestión de usuarios";
  cabecera(app, "Gestión de usuarios", "Altas, contraseñas y permisos por área, módulo y submódulo.", true);
  const box = el("div","pad usr"); box.style.paddingBottom = "32px"; app.append(box);
  if (!st.cargado){ if (!st.cargando) cargar(); box.append(el("div","card empty","Cargando usuarios…")); return; }
  aviso(box);
  // barra superior: vistas y alta
  const top = el("div","usrtop");
  const nav = el("nav","tabs");
  for (const [k,t] of [["usuario","Por usuario"],["modulo","Por módulo"],["tabla","Vista general"]]){ const a = el("a",null,t); a.href = "#usuarios"; if (st.vista === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); st.vista = k; st.sel.clear(); render(); }); nav.append(a); }
  const nb = el("button","btn primary","Nuevo usuario"); nb.addEventListener("click", () => { st.form = { nombre:"", email:"", password:generarPassword(), admin:false, permisos:{}, copiar:"" }; render(); });
  top.append(nav, nb); box.append(top);
  if (st.form) formNuevo(box);
  const lg = el("p","hint"); lg.append(el("b",null,"Niveles: "), "Sin acceso, el módulo no aparece. Ver: consulta, filtra y exporta, pero no modifica. Editar: además introduce y cambia datos. Los administradores tienen acceso completo a todo. Al dar un nivel a un área se aplica a todos sus módulos; los módulos nuevos aparecen aquí solos en cuanto se añaden a la APP."); box.append(lg);
  if (st.vista === "usuario") vistaUsuario(box);
  else if (st.vista === "modulo") vistaModulo(box);
  else vistaTabla(box);
}
function aviso(box){
  if (!st.aviso) return;
  const a = st.aviso, av = el("div","ok-msg"); av.style.marginBottom = "14px";
  av.append(el("b",null, a.nuevo ? "Usuario creado. " : "Contraseña cambiada. "), `Comunica a ${a.email} su contraseña temporal: `);
  const code = el("code",null,a.password); code.style.cssText = "font-size:16px;font-weight:700;padding:2px 6px;background:var(--surface);border-radius:4px";
  const cp = el("button","btn small","Copiar"); cp.style.marginLeft = "8px"; cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(a.password); toast("Contraseña copiada"); } catch(e){ toast("No se ha podido copiar; cópiala a mano"); } });
  const ok = el("button","btn small","Hecho"); ok.style.marginLeft = "6px"; ok.addEventListener("click", () => { st.aviso = null; render(); });
  av.append(code, cp, ok, el("div",null,"Al entrar por primera vez tendrá que elegir su propia contraseña. Esta no se volverá a mostrar."));
  box.append(av);
}
// Árbol de permisos para un usuario (o para el formulario de alta, con «get/set» propios)
function arbolPermisos(get, set, disabled){
  const wrap = el("div","ptree");
  for (const a of arbol()){
    const unico = a.mods.length === 1 && !a.mods[0].subs, abierto = st.abiertos.has(a.id);
    const ra = el("div","prow area"); const ta = el("button","pexp"); ta.type = "button"; ta.textContent = unico ? "" : (abierto ? "▾" : "▸"); ta.disabled = unico;
    ta.addEventListener("click", () => { abierto ? st.abiertos.delete(a.id) : st.abiertos.add(a.id); render(); });
    const na = el("span","pname"); na.append(el("b",null,a.nombre)); if (!unico) na.append(el("small",null,` ${a.mods.length} módulos`));
    ra.append(ta, na, selNivel(get(a.codes), v => set(a.codes, v), disabled)); wrap.append(ra);
    if (unico || !abierto) continue;
    for (const m of a.mods){
      const rm = el("div","prow mod"); const nm = el("span","pname", m.nombre); if (m.proximamente) nm.append(el("small",null," (próximamente)"));
      rm.append(el("span","pexp"), nm, selNivel(get(m.codes), v => set(m.codes, v), disabled)); wrap.append(rm);
      for (const s2 of (m.subs || [])){ const rs = el("div","prow sub"); rs.append(el("span","pexp"), el("span","pname", s2.nombre), selNivel(get(s2.codes), v => set(s2.codes, v), disabled)); wrap.append(rs); }
    }
  }
  return wrap;
}
function vistaUsuario(box){
  const lay = el("div","usrlay");
  // lista de usuarios
  const izq = el("div","usrlist card");
  const q = el("input"); q.type = "search"; q.placeholder = "Buscar usuario"; q.value = st.q; q.dataset.k = "usr-q"; q.addEventListener("input", () => { st.q = q.value; render(); }); izq.append(q);
  const L = st.usuarios.filter(u => !st.q || `${u.nombre} ${u.email}`.toLowerCase().includes(st.q.toLowerCase()));
  if (!st.uid || !st.usuarios.some(u => u.id === st.uid)) st.uid = (L[0] || st.usuarios[0] || {}).id || null;
  for (const u of L){
    const n = st.permisos.filter(p => p.usuario_id === u.id).length;
    const b = el("button","uitem" + (u.id === st.uid ? " on" : "") + (!u.activo ? " off" : "")); b.type = "button";
    const t = el("span","un"); t.append(el("b",null,nombreU(u)), el("small",null,u.email)); b.append(t);
    const tg = tagUsuario(u); b.append(tg || el("span","cnt", n ? `${n} módulos` : "sin permisos"));
    b.addEventListener("click", () => { st.uid = u.id; st.copiar = ""; render(); }); izq.append(b);
  }
  lay.append(izq);
  // permisos del usuario elegido
  const u = st.usuarios.find(x => x.id === st.uid); const der = el("div","usrdet card");
  if (!u){ der.append(el("p","hint","No hay usuarios.")); lay.append(der); box.append(lay); return; }
  const hd = el("div","udhead"); const nm = el("div"); nm.append(el("h2",null,nombreU(u)), el("span","hint",u.email)); hd.append(nm);
  const ops = el("div","udops");
  const chk = (txt, campo, val) => { const l = el("label","chk"); const c = el("input"); c.type = "checkbox"; c.checked = val; c.addEventListener("change", () => setCampo(u.id, campo, c.checked)); l.append(c, " " + txt); return l; };
  const pb = el("button","btn small","Nueva contraseña"); pb.addEventListener("click", () => nuevaPassword(u));
  ops.append(chk("Activo","activo",u.activo), chk("Administrador","es_admin",u.es_admin), pb); hd.append(ops); der.append(hd);
  if (u.es_admin){ der.append(el("div","infobox","Es administrador: tiene acceso completo a todos los módulos, incluida la gestión de usuarios. Para darle permisos concretos, quítale antes la marca de administrador.")); lay.append(der); box.append(lay); return; }
  // copiar permisos de otro usuario
  const cp = el("div","ucopy"); const s2 = el("select"); const o0 = el("option",null,"Copiar los permisos de…"); o0.value = ""; s2.append(o0);
  for (const x of st.usuarios) if (x.id !== u.id && !x.es_admin){ const o = el("option",null,nombreU(x)); o.value = x.id; s2.append(o); }
  s2.value = st.copiar; s2.addEventListener("change", () => { st.copiar = s2.value; render(); });
  const cb = el("button","btn small","Copiar"); cb.disabled = !st.copiar;
  cb.addEventListener("click", () => { const o = st.usuarios.find(x => x.id === st.copiar); if (o && confirm(`¿Sustituir los permisos de ${nombreU(u)} por los de ${nombreU(o)}?`)){ st.copiar = ""; copiarPermisos(o.id, u.id); } });
  cp.append(s2, cb); der.append(cp);
  der.append(arbolPermisos(codes => nivelNodo(u.id, codes), (codes, v) => setNiveles([u.id], codes, v), false));
  lay.append(der); box.append(lay);
}
function vistaModulo(box){
  const lay = el("div","usrlay");
  const N = nodos(); if (!st.nodo || !N.some(n => n.id === st.nodo)) st.nodo = N[0] && N[0].id;
  const izq = el("div","usrlist card");
  for (const a of arbol()){
    const nivelCls = id => "uitem" + (st.nodo === id ? " on" : "");
    const ba = el("button", nivelCls(a.id) + " narea"); ba.type = "button"; ba.append(el("b",null,a.nombre)); ba.addEventListener("click", () => { st.nodo = a.id; st.sel.clear(); render(); }); izq.append(ba);
    if (a.mods.length === 1 && !a.mods[0].subs) continue;
    for (const m of a.mods){
      if (a.mods.length > 1 || m.subs){ const bm = el("button", nivelCls(m.id) + " nmod"); bm.type = "button"; bm.textContent = m.nombre; bm.addEventListener("click", () => { st.nodo = m.id; st.sel.clear(); render(); }); izq.append(bm); }
      for (const s2 of (m.subs || [])){ const bs = el("button", nivelCls(s2.id) + " nsub"); bs.type = "button"; bs.textContent = s2.nombre; bs.addEventListener("click", () => { st.nodo = s2.id; st.sel.clear(); render(); }); izq.append(bs); }
    }
  }
  lay.append(izq);
  const n = N.find(x => x.id === st.nodo); const der = el("div","usrdet card");
  der.append(el("h2",null,n.nombre), el("p","hint", n.codes.length > 1 ? `Incluye ${n.codes.length} permisos. El nivel que elijas se aplica a todos.` : "Permiso de un solo módulo."));
  const us = st.usuarios.filter(u => u.activo || st.sel.has(u.id));
  const conAcc = us.filter(u => !u.es_admin && nivelNodo(u.id, n.codes) !== "");
  der.append(el("p","secsub",`${conAcc.length} usuario${conAcc.length === 1 ? "" : "s"} con acceso (sin contar administradores).`));
  // acciones en bloque
  const bulk = el("div","ubulk"); const tot = el("label","chk"); const ct = el("input"); ct.type = "checkbox";
  const elegibles = us.filter(u => !u.es_admin); ct.checked = elegibles.length > 0 && elegibles.every(u => st.sel.has(u.id));
  ct.addEventListener("change", () => { if (ct.checked) elegibles.forEach(u => st.sel.add(u.id)); else st.sel.clear(); render(); }); tot.append(ct, " Todos");
  bulk.append(tot, el("span","hint",`${st.sel.size} seleccionado${st.sel.size === 1 ? "" : "s"}`));
  for (const [v,l] of [["ver","Dar Ver"],["editar","Dar Editar"],["","Quitar acceso"]]){ const b = el("button","btn small"+(v===""?" danger":""),l); b.disabled = !st.sel.size;
    b.addEventListener("click", async () => { if (!v && !confirm(`¿Quitar el acceso a ${n.nombre} a ${st.sel.size} usuarios?`)) return; if (await setNiveles([...st.sel], n.codes, v)) st.sel.clear(); }); bulk.append(b); }
  der.append(bulk);
  const t = el("div","ulist");
  for (const u of us){
    const r = el("div","prow uline" + (u.es_admin ? " adm" : "")); const c = el("input"); c.type = "checkbox"; c.disabled = u.es_admin; c.checked = st.sel.has(u.id);
    c.addEventListener("change", () => { c.checked ? st.sel.add(u.id) : st.sel.delete(u.id); render(); });
    const nm = el("span","pname"); nm.append(el("b",null,nombreU(u)), el("small",null," " + u.email));
    r.append(c, nm, u.es_admin ? el("span","tag ok","Administrador: acceso completo") : selNivel(nivelNodo(u.id, n.codes), v => setNiveles([u.id], n.codes, v), false));
    t.append(r);
  }
  der.append(t);
  const inact = st.usuarios.filter(u => !u.activo).length; if (inact) der.append(el("p","hint",`${inact} usuario${inact === 1 ? "" : "s"} inactivo${inact === 1 ? "" : "s"} no aparece${inact === 1 ? "" : "n"} en esta lista.`));
  lay.append(der); box.append(lay);
}
function vistaTabla(box){
  const A = arbol(); const cols = A.flatMap(a => a.mods.flatMap(m => m.subs ? m.subs.map(s2 => ({ a:a.nombre, n:s2.nombre, c:s2.codes[0] })) : [{ a:a.nombre, n:m.nombre, c:m.codes[0] }]));
  const tw = el("div","tblwrap usrwrap"), t = el("table","tbl usrtbl");
  const th = el("thead"), h1 = el("tr"), h2 = el("tr");
  const c0 = el("th","fixu","Usuario"); c0.rowSpan = 2; h1.append(c0);
  for (const a of A){ const n = cols.filter(c => c.a === a.nombre).length; const x = el("th","garea",a.nombre); x.colSpan = n; h1.append(x); }
  for (const c of cols) h2.append(el("th",null,c.n));
  th.append(h1, h2); t.append(th);
  const tb = el("tbody");
  for (const u of st.usuarios){
    const tr = el("tr",!u.activo ? "off" : ""); const cu = el("td","fixu"); const pd = el("div","person"); const sp = el("span",null,nombreU(u)); sp.append(el("small",null,u.email)); pd.append(sp); cu.append(pd); tr.append(cu);
    for (const c of cols){ const v = u.es_admin ? "editar" : nivelDe(u.id, c.c); tr.append(el("td","nv " + (v || "no"), v === "editar" ? "Editar" : v === "ver" ? "Ver" : "—")); }
    tr.title = "Pulsa para editar los permisos de este usuario"; tr.addEventListener("click", () => { st.uid = u.id; st.vista = "usuario"; render(); });
    tb.append(tr);
  }
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Solo lectura. Pulsa una fila para editar los permisos de esa persona."));
}
function formNuevo(box){
  const f = st.form, card = el("div","card"); card.style.cssText = "margin:4px 0 16px;max-width:820px";
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
    const cp = el("div","ucopy"); const s2 = el("select"); const o0 = el("option",null,"Partir de los permisos de… (opcional)"); o0.value = ""; s2.append(o0);
    for (const x of st.usuarios) if (!x.es_admin){ const o = el("option",null,nombreU(x)); o.value = x.id; s2.append(o); }
    s2.value = f.copiar || ""; s2.addEventListener("change", () => { f.copiar = s2.value; f.permisos = {}; for (const p of st.permisos.filter(p => p.usuario_id === s2.value)) f.permisos[p.modulo] = p.nivel; render(); });
    cp.append(s2); card.append(el("p","secsub","Permisos"), cp);
    card.append(arbolPermisos(codes => { const v = new Set(codes.map(c => f.permisos[c] || "")); return v.size === 1 ? [...v][0] : "mixto"; },
      (codes, v) => { for (const c of codes){ if (v) f.permisos[c] = v; else delete f.permisos[c]; } render(); }, false));
  }
  const acts = el("div","actions"); acts.style.justifyContent = "flex-start";
  const cr = el("button","btn primary","Crear usuario"); const cn = el("button","btn","Cancelar");
  cn.addEventListener("click", () => { st.form = null; render(); });
  cr.addEventListener("click", async () => {
    if (!f.nombre.trim()){ toast("Escribe el nombre"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())){ toast("Escribe un correo válido"); return; }
    if (f.password.length < 8){ toast("La contraseña debe tener al menos 8 caracteres"); return; }
    if (st.usuarios.some(u => u.email.toLowerCase() === f.email.trim().toLowerCase())){ toast("Ya existe un usuario con ese correo"); return; }
    cr.disabled = true; cr.textContent = "Creando…"; const ok = await crearUsuario({ ...f, permisos: f.admin ? {} : f.permisos }); if (!ok){ cr.disabled = false; cr.textContent = "Crear usuario"; }
  });
  acts.append(cr, cn); card.append(acts); box.append(card);
}
