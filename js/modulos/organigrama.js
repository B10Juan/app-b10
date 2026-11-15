// APP B10 · Personas: organigrama
// Se define la estructura (dirección general, apoyo a DG, direcciones/pilares y departamentos), se ve como organigrama
// y se exporta a PowerPoint con formas editables. Datos en rrhh.organigramas y rrhh.organigrama_nodos (migración 24).
import { sb, render, cabecera, nivel } from "../app.js";
import { el, toast, safe } from "../util.js";

const O = { lista:null, sel:null, nodos:[], loading:false, personas:[] };
const sch = () => sb.schema("rrhh");
const puede = () => nivel("organigrama") === "editar";
const TIPOS = { direccion:"Dirección general", staff:"Apoyo a DG (staff)", pilar:"Dirección / pilar", departamento:"Departamento" };
const C = { dir:"1F3864", pil:"4472C4", dep:"4E9A8F", staff:"C9862B", linea:"8EA0B8", tit:"1F3864", sub:"4472C4", nota:"595959" };
const SW = 13.333, SH = 7.5; // diapositiva panorámica (pulgadas)

async function cargar(){
  O.loading = true;
  try{
    const r = await sch().from("organigramas").select("*").order("id"); if (r.error) throw r.error; O.lista = r.data;
    if (!O.sel || !O.lista.some(x => x.id === O.sel)) O.sel = O.lista.length ? O.lista[0].id : null;
    O.nodos = [];
    if (O.sel){ const n = await sch().from("organigrama_nodos").select("*").eq("organigrama_id", O.sel).order("orden").order("id"); if (n.error) throw n.error; O.nodos = n.data; }
    if (!O.personas.length){ try { const p = await sch().from("personas").select("nombre,fecha_baja"); if (!p.error) O.personas = p.data.filter(x => !x.fecha_baja).map(x => x.nombre).sort(); } catch(e){} }
  } catch(e){ console.error(e); toast("No se ha podido cargar el organigrama."); O.lista = O.lista || []; }
  O.loading = false; render();
}
const recargar = () => { O.lista = null; render(); };

// ---------- Cálculo de la disposición (en pulgadas, sobre la diapositiva de 13,33 × 7,5) ----------
function disposicion(org, nodos){
  const by = (t) => nodos.filter(n => n.tipo === t).sort((a,b) => a.orden - b.orden || a.id - b.id);
  const dir = by("direccion")[0] || null, staff = by("staff"), pil = by("pilar");
  const depsDe = p => by("departamento").filter(d => d.padre_id === p.id);
  const huerfanos = by("departamento").filter(d => !pil.some(p => p.id === d.padre_id));
  const M = 0.35, cx = SW / 2, cajas = [], lineas = [], puntos = [];
  const PW = 1.85, DW = 0.92, DG = 0.08, CG = 0.17, POR_FILA = 3;
  let y = 1.3;
  if (dir){ cajas.push({ n:dir, k:"dir", x:cx - 1.3, y, w:2.6, h:0.95 }); }
  const yDirFin = y + 0.95;
  // apoyo a DG a izquierda y derecha de la línea central
  let yStaffFin = yDirFin;
  staff.forEach((s, i) => { const fila = Math.floor(i / 2), izq = i % 2 === 0, w = 2.5, h = 1.05, sy = yDirFin + 0.3 + fila * (h + 0.15);
    const sx = izq ? cx - 0.4 - w : cx + 0.4; cajas.push({ n:s, k:"staff", x:sx, y:sy, w, h });
    lineas.push({ x1: izq ? sx + w : cx, y1: sy + h/2, x2: izq ? cx : sx, y2: sy + h/2, staff:true }); puntos.push({ x:cx, y:sy + h/2 });
    yStaffFin = Math.max(yStaffFin, sy + h); });
  const bus = (staff.length ? yStaffFin : yDirFin) + (staff.length ? 0.25 : 0.35);
  if (dir && pil.length) lineas.push({ x1:cx, y1:yDirFin, x2:cx, y2:bus });
  // columnas de los pilares
  const cols = pil.map(p => { const d = depsDe(p), k = Math.min(d.length, POR_FILA); return { p, d, w: Math.max(PW, k ? k * DW + (k - 1) * DG : 0) }; });
  const total = cols.reduce((s, c) => s + c.w, 0) + Math.max(0, cols.length - 1) * CG, disp = SW - 2 * M;
  const fx = total > disp ? disp / total : 1;
  let x = cx - total * fx / 2; const py = bus + 0.25, ph = 1.55, dy0 = py + ph + 0.15, dh = 0.62;
  let fondo = Math.max(py + ph, bus);
  for (const c of cols){
    const w = c.w * fx, pc = x + w / 2; cajas.push({ n:c.p, k:"pil", x, y:py, w, h:ph }); lineas.push({ x1:pc, y1:bus, x2:pc, y2:py });
    for (let i = 0; i < c.d.length; i += POR_FILA){
      const fila = c.d.slice(i, i + POR_FILA), dw = (w - (fila.length - 1) * DG * fx) / fila.length, yy = dy0 + (i / POR_FILA) * (dh + 0.08);
      fila.forEach((d, j) => { const dx = x + j * (dw + DG * fx); cajas.push({ n:d, k:"dep", x:dx, y:yy, w:dw, h:dh }); if (i === 0) lineas.push({ x1:dx + dw/2, y1:py + ph, x2:dx + dw/2, y2:yy }); fondo = Math.max(fondo, yy + dh); });
    }
    x += w + CG * fx;
  }
  if (cols.length > 1) lineas.push({ x1:cajas.find(b => b.n === cols[0].p).x + cols[0].w * fx / 2, y1:bus, x2:x - CG * fx - cols[cols.length - 1].w * fx / 2, y2:bus });
  // si no cabe en vertical se comprime por debajo de la cabecera
  const lim = 6.7, fy = fondo > lim ? (lim - 1.3) / (fondo - 1.3) : 1;
  if (fy < 1){ const t = v => 1.3 + (v - 1.3) * fy; for (const b of cajas){ b.y = t(b.y); b.h *= fy; } for (const l of lineas){ l.y1 = t(l.y1); l.y2 = t(l.y2); } for (const p of puntos) p.y = t(p.y); }
  return { cajas, lineas, puntos, esc: Math.min(fx, fy), huerfanos, sinDir: !dir };
}
// Tamaños de letra (pt) por tipo de caja
function letras(k, esc){ const f = v => Math.max(6, Math.round(v * esc * 2) / 2);
  return k === "dep" ? { t:f(8.5), r:f(8), d:f(7.5) } : k === "pil" ? { t:f(11.5), r:f(10), d:f(9) } : k === "staff" ? { t:f(11), r:f(10), d:f(9) } : { t:f(12.5), r:f(10.5), d:f(9.5) }; }
const LEYENDA = [["dir","Dirección General"],["staff","Apoyo a DG (staff directivo)"],["pil","Direcciones / Pilares"],["dep","Departamentos"]];

// ---------- Vista en pantalla (misma geometría que la diapositiva) ----------
const pctX = v => (v / SW * 100) + "%", pctY = v => (v / SH * 100) + "%";
const ptCq = pt => `${(pt / 72 / SW * 100).toFixed(3)}cqw`;
function vista(org, nodos, alPulsar){
  const L = disposicion(org, nodos);
  const marco = el("div","org-marco"); const lienzo = el("div","org-lienzo"); marco.append(lienzo);
  const txt = (s, pt, css) => { const d = el("div", null, s); d.style.cssText = `position:absolute;left:3%;right:3%;text-align:center;font-size:${ptCq(pt)};${css}`; return d; };
  lienzo.append(txt(org.titulo || "", 24, `top:${pctY(0.18)};font-weight:700;color:#${C.tit};line-height:1.15`));
  if (org.subtitulo) lienzo.append(txt(org.subtitulo, 15, `top:${pctY(0.62)};font-weight:700;color:#${C.sub}`));
  if (org.nota) lienzo.append(txt(org.nota, 10.5, `top:${pctY(0.95)};color:#${C.nota}`));
  for (const l of L.lineas){ const d = el("div","org-linea" + (l.staff ? " staff" : "")); const hz = Math.abs(l.y1 - l.y2) < 0.001;
    d.style.left = pctX(Math.min(l.x1, l.x2)); d.style.top = pctY(Math.min(l.y1, l.y2)); if (hz) d.style.width = pctX(Math.abs(l.x2 - l.x1)); else d.style.height = pctY(Math.abs(l.y2 - l.y1)); d.classList.add(hz ? "h" : "v"); lienzo.append(d); }
  for (const p of L.puntos){ const d = el("div","org-punto"); d.style.left = pctX(p.x); d.style.top = pctY(p.y); lienzo.append(d); }
  for (const b of L.cajas){ const f = letras(b.k, L.esc); const c = el(alPulsar ? "button" : "div","org-caja " + b.k); if (alPulsar){ c.type = "button"; c.title = "Editar"; c.addEventListener("click", () => alPulsar(b.n)); }
    c.style.left = pctX(b.x); c.style.top = pctY(b.y); c.style.width = pctX(b.w); c.style.height = pctY(b.h);
    const t = el("b", null, b.n.titulo); t.style.fontSize = ptCq(f.t); c.append(t);
    if (b.n.responsable){ const r = el("span", null, b.n.responsable); r.style.fontSize = ptCq(f.r); c.append(r); }
    if (b.n.descripcion && b.k !== "dep"){ const d = el("i", null, b.n.descripcion); d.style.fontSize = ptCq(f.d); c.append(d); }
    lienzo.append(c); }
  const ley = el("div","org-leyenda"); ley.style.top = pctY(6.92); ley.style.fontSize = ptCq(10.5);
  for (const [k, t] of LEYENDA){ const s = el("span"); s.append(el("i","org-muestra " + k), t); ley.append(s); } lienzo.append(ley);
  return { marco, L };
}

// ---------- Exportación a PowerPoint (formas editables) ----------
let cargaPptx = null;
function pptxLib(){
  if (window.PptxGenJS) return Promise.resolve();
  const URLS = ["https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js", "https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"];
  const una = u => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = u; s.onload = ok; s.onerror = () => { s.remove(); ko(); }; document.head.append(s); });
  if (!cargaPptx) cargaPptx = una(URLS[0]).catch(() => una(URLS[1])).catch(() => { cargaPptx = null; throw new Error("No se ha podido cargar la librería de PowerPoint"); });
  return cargaPptx;
}
export async function exportarPptx(org, nodos){
  await pptxLib();
  const L = disposicion(org, nodos), pptx = new window.PptxGenJS(); pptx.layout = "LAYOUT_WIDE"; pptx.title = org.titulo || "Organigrama";
  const s = pptx.addSlide(); s.background = { color:"FFFFFF" }; const F = "Calibri";
  s.addText(org.titulo || "", { x:0.3, y:0.12, w:SW - 0.6, h:0.5, fontFace:F, fontSize:24, bold:true, color:C.tit, align:"center", valign:"middle", fit:"shrink" });
  if (org.subtitulo) s.addText(org.subtitulo, { x:0.3, y:0.58, w:SW - 0.6, h:0.36, fontFace:F, fontSize:15, bold:true, color:C.sub, align:"center", valign:"middle" });
  if (org.nota) s.addText(org.nota, { x:0.3, y:0.92, w:SW - 0.6, h:0.3, fontFace:F, fontSize:10.5, color:C.nota, align:"center", valign:"middle" });
  for (const l of L.lineas){ const hz = Math.abs(l.y1 - l.y2) < 0.001;
    s.addShape(pptx.ShapeType.line, { x:Math.min(l.x1, l.x2), y:Math.min(l.y1, l.y2), w:hz ? Math.abs(l.x2 - l.x1) : 0, h:hz ? 0 : Math.abs(l.y2 - l.y1), line:{ color:l.staff ? C.staff : C.linea, width:l.staff ? 1.5 : 1.25, dashType:l.staff ? "dash" : "solid" } }); }
  for (const p of L.puntos) s.addShape(pptx.ShapeType.ellipse, { x:p.x - 0.05, y:p.y - 0.05, w:0.1, h:0.1, fill:{ color:C.staff }, line:{ color:C.staff, width:0.5 } });
  for (const b of L.cajas){ const f = letras(b.k, L.esc), staff = b.k === "staff", col = staff ? C.tit : "FFFFFF";
    const runs = [{ text:b.n.titulo, options:{ bold:true, fontSize:f.t, breakLine:!!(b.n.responsable || (b.n.descripcion && b.k !== "dep")) } }];
    if (b.n.responsable) runs.push({ text:b.n.responsable, options:{ fontSize:f.r, breakLine:!!(b.n.descripcion && b.k !== "dep") } });
    if (b.n.descripcion && b.k !== "dep") runs.push({ text:b.n.descripcion, options:{ italic:true, fontSize:f.d } });
    s.addText(runs, { shape:pptx.ShapeType.roundRect, rectRadius:0.06, x:b.x, y:b.y, w:b.w, h:b.h, fontFace:F, color:col, align:"center", valign:"middle", margin:4, paraSpaceAfter:2, fit:"shrink",
      fill:{ color: staff ? "FFFFFF" : b.k === "dir" ? C.dir : b.k === "pil" ? C.pil : C.dep }, line: staff ? { color:C.staff, width:1.5, dashType:"dash" } : { color: b.k === "dir" ? C.dir : b.k === "pil" ? C.pil : C.dep, width:0.75 },
      shadow: staff ? undefined : { type:"outer", blur:3, offset:1.5, angle:90, color:"000000", opacity:0.18 } }); }
  const xs = [0.9, 3.9, 7.0, 10.1];
  LEYENDA.forEach(([k, t], i) => { const x = xs[i], y = 6.95;
    s.addShape(pptx.ShapeType.roundRect, { x, y, w:0.22, h:0.18, rectRadius:0.03, fill:{ color: k === "staff" ? "FFFFFF" : k === "dir" ? C.dir : k === "pil" ? C.pil : C.dep }, line: k === "staff" ? { color:C.staff, width:1.25, dashType:"dash" } : { color: k === "dir" ? C.dir : k === "pil" ? C.pil : C.dep, width:0.5 } });
    s.addText(t, { x:x + 0.32, y:y - 0.06, w:2.6, h:0.3, fontFace:F, fontSize:10.5, color:"404040", valign:"middle" }); });
  await pptx.writeFile({ fileName: "Organigrama_" + (safe(org.subtitulo || org.titulo || "B10").slice(0, 60) || "B10") + ".pptx" });
  toast("PowerPoint exportado");
}

// ---------- Pantalla ----------
export function renderOrganigrama(app){
  document.title = "Personas: organigrama";
  cabecera(app, "Organigrama", "Define la estructura de dirección, pilares y departamentos, y descárgala como organigrama en PowerPoint.", { txt:"Personas", href:"#personas" }, "organigrama");
  const box = el("div","pad org"); box.style.paddingBottom = "32px"; app.append(box);
  if (!O.lista){ if (!O.loading) cargar(); box.append(el("div","card empty","Cargando organigrama…")); return; }
  const ed = puede(), org = O.lista.find(x => x.id === O.sel);
  const c = el("div","ctrl");
  if (O.lista.length){ const d = el("div","fld"); const s = el("select"); for (const x of O.lista) s.append(new Option(x.subtitulo ? `${x.subtitulo} · ${x.titulo}` : x.titulo, x.id)); s.value = String(O.sel);
    s.addEventListener("change", () => { O.sel = +s.value; recargar(); }); d.append(el("span",null,"Organigrama"), s); c.append(d); }
  const acc = el("div","acc"); acc.style.display = "flex"; acc.style.gap = "8px"; acc.style.flexWrap = "wrap";
  const bt = (t, cls, fn) => { const b = el("button","btn " + cls, t); b.type = "button"; b.addEventListener("click", fn); acc.append(b); return b; };
  if (org) bt("Exportar a PowerPoint","primary", async () => { try { await exportarPptx(org, O.nodos); } catch(e){ console.error(e); toast(e.message || "No se ha podido exportar"); } });
  if (ed){ if (org){ bt("Título y textos","", () => editarOrg(org)); bt("Duplicar","", () => duplicar(org)); }
    bt("Nuevo organigrama","", () => editarOrg(null)); if (org) bt("Eliminar","", () => eliminarOrg(org)); }
  c.append(acc); box.append(c);
  if (!org){ box.append(el("div","card empty", ed ? "Todavía no hay ningún organigrama. Pulsa «Nuevo organigrama» para empezar." : "Todavía no hay ningún organigrama.")); return; }

  if (ed) box.append(barraAnadir());
  const { marco, L } = vista(org, O.nodos, ed ? n => editarNodo(n, null) : null);
  const card = el("div","card"); card.style.padding = "10px"; card.append(marco); box.append(card);
  const avisos = [];
  if (L.sinDir) avisos.push("Falta la caja de Dirección General.");
  if (L.huerfanos.length) avisos.push(`Departamentos sin dirección/pilar asignado (no se dibujan): ${L.huerfanos.map(n => n.titulo).join(", ")}.`);
  for (const a of avisos){ const w = el("p","hint", a); w.style.color = "var(--red)"; box.append(w); }
  box.append(el("p","hint", ed ? "Pulsa una caja para editarla. La diapositiva de PowerPoint sale con la misma disposición y con formas y textos editables." : "La diapositiva de PowerPoint sale con la misma disposición y con formas y textos editables."));
  tablaEstructura(box, ed);
}

// Botones para añadir cajas (encima del dibujo y de la tabla)
function barraAnadir(){
  const N = O.nodos, a = el("div","org-anadir"); a.append(el("b",null,"Añadir caja:"));
  const b = (t, tipo, tit) => { const x = el("button","btn small", t); x.type = "button"; x.title = tit; x.addEventListener("click", () => editarNodo(null, tipo)); a.append(x); };
  if (!N.some(n => n.tipo === "direccion")) b("+ Dirección general","direccion","Caja superior (azul oscuro)");
  b("+ Apoyo a DG (staff)","staff","Cajas con borde naranja a los lados de la Dirección General");
  b("+ Dirección / pilar","pilar","Cajas azules de la fila principal, debajo de la Dirección General");
  if (N.some(n => n.tipo === "pilar")) b("+ Departamento","departamento","Cajas verdes debajo de cada dirección / pilar");
  else a.append(el("span","hint","Los departamentos se cuelgan de una dirección / pilar: crea primero los pilares."));
  return a;
}

// Lista editable de la estructura
function tablaEstructura(box, ed){
  box.append(el("h3",null,"Estructura"));
  const N = O.nodos, ord = (a,b) => a.orden - b.orden || a.id - b.id;
  const dir = N.filter(n => n.tipo === "direccion").sort(ord), staff = N.filter(n => n.tipo === "staff").sort(ord), pil = N.filter(n => n.tipo === "pilar").sort(ord);
  if (ed) box.append(barraAnadir());
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Nivel","Nombre","Responsable","Descripción", ed ? "" : null].filter(x => x !== null)) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  const fila = (n, grupo, sangria) => { const tr = el("tr"); const tn = el("td"); tn.style.paddingLeft = (10 + sangria * 22) + "px"; tn.append(el("b",null,n.titulo));
    tr.append(el("td",null,TIPOS[n.tipo]), tn, el("td",null,n.responsable || ""), el("td",null,n.descripcion || ""));
    if (ed){ const td = el("td"); td.style.whiteSpace = "nowrap"; const i = grupo.indexOf(n);
      const b = (txt, tit, fn, dis) => { const x = el("button","btn small", txt); x.type = "button"; x.title = tit; x.disabled = !!dis; x.addEventListener("click", fn); td.append(x, " "); };
      b("↑","Subir", () => mover(grupo, i, -1), i === 0); b("↓","Bajar", () => mover(grupo, i, 1), i === grupo.length - 1);
      if (n.tipo === "pilar") b("+ Dpto.","Añadir departamento", () => editarNodo({ tipo:"departamento", padre_id:n.id }, "departamento"));
      b("Editar","Editar", () => editarNodo(n, null)); b("Eliminar","Eliminar", () => eliminarNodo(n)); tr.append(td); }
    tb.append(tr); };
  for (const n of dir) fila(n, dir, 0);
  for (const n of staff) fila(n, staff, 1);
  for (const p of pil){ fila(p, pil, 1); const d = N.filter(x => x.tipo === "departamento" && x.padre_id === p.id).sort(ord); for (const n of d) fila(n, d, 2); }
  for (const n of N.filter(x => x.tipo === "departamento" && !pil.some(p => p.id === x.padre_id))) fila(n, [n], 1);
  if (!N.length){ const tr = el("tr"); const td = el("td","empty","Sin cajas todavía."); td.colSpan = ed ? 5 : 4; tr.append(td); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
}

async function mover(grupo, i, d){
  const g = grupo.slice(); const [x] = g.splice(i, 1); g.splice(i + d, 0, x);
  const r = await Promise.all(g.map((n, k) => sch().from("organigrama_nodos").update({ orden:(k + 1) * 10 }).eq("id", n.id)));
  if (r.some(x => x.error)) toast("No se ha podido cambiar el orden"); recargar();
}

function dialogo(id, titulo){ let dlg = document.getElementById(id); if (dlg) dlg.remove(); dlg = el("dialog"); dlg.id = id; dlg.style.maxWidth = "560px"; document.body.append(dlg);
  const f = el("form"); f.method = "dialog"; f.noValidate = true; dlg.append(f); f.append(el("h2",null,titulo)); return { dlg, f }; }
const campo = (lab, node, hint) => { const x = el("div","f"); x.append(el("label",null,lab), node); if (hint) x.append(el("span","hint",hint)); return x; };
function botones(f, dlg, txt){ const a = el("div","actions"); const cn = el("button","btn","Cancelar"); cn.type = "button"; cn.addEventListener("click", () => dlg.close()); const ok = el("button","btn primary", txt || "Guardar"); a.append(cn, ok); f.append(a); }

function editarNodo(n, tipoNuevo){
  const nuevo = !n || !n.id, base = n || {}, { dlg, f } = dialogo("dlgOrgNodo", nuevo ? "Nueva caja" : "Editar caja");
  const tipo = el("select"); for (const [k, v] of Object.entries(TIPOS)) tipo.append(new Option(v, k)); tipo.value = base.tipo || tipoNuevo || "pilar";
  const tit = el("input"); tit.value = base.titulo || ""; tit.placeholder = "Ej.: OPERACIONES";
  const resp = el("input"); resp.value = base.responsable || ""; resp.setAttribute("list","orgPersonas"); resp.placeholder = "Nombre (o varios separados por «y» o «·»)";
  const dl = el("datalist"); dl.id = "orgPersonas"; for (const p of O.personas) dl.append(new Option(p));
  const des = el("textarea"); des.rows = 2; des.value = base.descripcion || "";
  const padre = el("select"); const pil = O.nodos.filter(x => x.tipo === "pilar").sort((a,b) => a.orden - b.orden); for (const p of pil) padre.append(new Option(p.titulo, p.id)); if (base.padre_id) padre.value = String(base.padre_id);
  const fPadre = campo("Depende de (dirección / pilar)", padre), fDes = campo("Descripción / mandato", des, "En los departamentos no se muestra en el organigrama.");
  const sync = () => { fPadre.style.display = tipo.value === "departamento" ? "" : "none"; }; tipo.addEventListener("change", sync); sync();
  f.append(campo("Nivel", tipo), campo("Nombre de la caja", tit), campo("Responsable", resp), dl, fDes, fPadre);
  const err = el("span","err"); f.append(err); botones(f, dlg);
  f.addEventListener("submit", async e => { e.preventDefault(); err.textContent = "";
    if (!tit.value.trim()) { err.textContent = "Pon el nombre de la caja."; return; }
    if (tipo.value === "departamento" && !padre.value){ err.textContent = "Elige de qué dirección o pilar depende (crea antes un pilar)."; return; }
    if (tipo.value === "direccion" && O.nodos.some(x => x.tipo === "direccion" && x.id !== base.id)){ err.textContent = "Ya hay una Dirección General en este organigrama."; return; }
    const dirN = O.nodos.find(x => x.tipo === "direccion");
    const reg = { tipo:tipo.value, titulo:tit.value.trim(), responsable:resp.value.trim() || null, descripcion:des.value.trim() || null,
      padre_id: tipo.value === "departamento" ? +padre.value : (tipo.value === "direccion" ? null : (dirN && dirN.id !== base.id ? dirN.id : null)) };
    let r;
    if (nuevo){ const herm = O.nodos.filter(x => x.tipo === reg.tipo && (reg.tipo !== "departamento" || x.padre_id === reg.padre_id)); reg.orden = (herm.reduce((m, x) => Math.max(m, x.orden), 0)) + 10; reg.organigrama_id = O.sel;
      r = await sch().from("organigrama_nodos").insert(reg); }
    else r = await sch().from("organigrama_nodos").update(reg).eq("id", base.id);
    if (r.error){ console.error(r.error); err.textContent = "No se ha podido guardar."; return; }
    dlg.close(); toast("Guardado"); recargar(); });
  if (!nuevo && (base.tipo === "direccion" || base.tipo === "pilar")){ const ad = el("div"); ad.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:6px";
    const b = (t, fn) => { const x = el("button","btn small", t); x.type = "button"; x.addEventListener("click", () => { dlg.close(); fn(); }); ad.append(x); };
    if (base.tipo === "direccion"){ b("+ Dirección / pilar debajo", () => editarNodo(null, "pilar")); b("+ Apoyo a DG al lado", () => editarNodo(null, "staff")); }
    else b("+ Departamento debajo", () => editarNodo({ tipo:"departamento", padre_id:base.id }, "departamento"));
    f.insertBefore(ad, err); }
  if (!nuevo){ const del = el("button","btn small","Eliminar caja"); del.type = "button"; del.style.marginTop = "6px"; del.addEventListener("click", () => { dlg.close(); eliminarNodo(base); }); f.insertBefore(del, err); }
  dlg.showModal(); tit.focus();
}
async function eliminarNodo(n){
  const hijos = O.nodos.filter(x => x.padre_id === n.id && n.tipo === "pilar");
  if (!confirm(`¿Eliminar «${n.titulo}»?` + (hijos.length ? ` También se eliminarán sus ${hijos.length} departamentos.` : ""))) return;
  // los nodos de staff y pilares cuelgan de la dirección: al borrar la dirección se desenganchan, no se borran
  if (n.tipo === "direccion"){ const r0 = await sch().from("organigrama_nodos").update({ padre_id:null }).eq("padre_id", n.id).neq("tipo","departamento"); if (r0.error){ toast("No se ha podido eliminar"); return; } }
  const r = await sch().from("organigrama_nodos").delete().eq("id", n.id); if (r.error){ toast("No se ha podido eliminar"); return; } toast("Eliminado"); recargar();
}

function editarOrg(org){
  const { dlg, f } = dialogo("dlgOrg", org ? "Título y textos" : "Nuevo organigrama");
  const t = el("input"); t.value = org ? org.titulo : ""; t.placeholder = "Ej.: BAÑOS 10, S.L.";
  const s = el("input"); s.value = org ? org.subtitulo || "" : ""; s.placeholder = "Ej.: Estructura organizativa 2027";
  const n = el("input"); n.value = org ? org.nota || "" : ""; n.placeholder = "Línea pequeña bajo el subtítulo (opcional)";
  f.append(campo("Título (empresa)", t), campo("Subtítulo", s), campo("Nota", n)); const err = el("span","err"); f.append(err); botones(f, dlg, org ? "Guardar" : "Crear");
  f.addEventListener("submit", async e => { e.preventDefault(); if (!t.value.trim()){ err.textContent = "Pon un título."; return; }
    const reg = { titulo:t.value.trim(), subtitulo:s.value.trim() || null, nota:n.value.trim() || null, actualizado:new Date().toISOString() };
    if (org){ const r = await sch().from("organigramas").update(reg).eq("id", org.id); if (r.error){ err.textContent = "No se ha podido guardar."; return; } }
    else { const r = await sch().from("organigramas").insert(reg).select("id").single(); if (r.error){ err.textContent = "No se ha podido crear."; return; } O.sel = r.data.id;
      await sch().from("organigrama_nodos").insert({ organigrama_id:O.sel, tipo:"direccion", titulo:"DIRECCIÓN GENERAL", orden:0 }); }
    dlg.close(); toast("Guardado"); recargar(); });
  dlg.showModal(); t.focus();
}
async function duplicar(org){
  const r = await sch().from("organigramas").insert({ titulo:org.titulo, subtitulo:(org.subtitulo || "") + " (copia)", nota:org.nota }).select("id").single(); if (r.error){ toast("No se ha podido duplicar"); return; }
  const nuevo = r.data.id, mapa = new Map();
  try{
    for (const tipos of [["direccion"],["staff","pilar"],["departamento"]]){
      for (const n of O.nodos.filter(x => tipos.includes(x.tipo))){
        const q = await sch().from("organigrama_nodos").insert({ organigrama_id:nuevo, padre_id: n.padre_id ? (mapa.get(n.padre_id) || null) : null, tipo:n.tipo, titulo:n.titulo, responsable:n.responsable, descripcion:n.descripcion, orden:n.orden }).select("id").single();
        if (q.error) throw q.error; mapa.set(n.id, q.data.id); } }
  } catch(e){ console.error(e); toast("La copia ha quedado incompleta"); }
  O.sel = nuevo; toast("Organigrama duplicado: cambia el subtítulo en «Título y textos»"); recargar();
}
async function eliminarOrg(org){
  if (!confirm(`¿Eliminar el organigrama «${org.subtitulo || org.titulo}» con todas sus cajas? No se puede deshacer.`)) return;
  const r = await sch().from("organigramas").delete().eq("id", org.id); if (r.error){ toast("No se ha podido eliminar"); return; }
  O.sel = null; toast("Organigrama eliminado"); recargar();
}
