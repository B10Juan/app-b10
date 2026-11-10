// APP B10 · Comercial: análisis de la demanda (diario de pedidos de venta de AX, 2023 en adelante)
// Los cálculos se hacen en la base de datos (funciones comercial.demanda_*); aquí solo se pintan.
import { sb, ctx, render, cabecera, nivel } from "../app.js";
import { el, toast, ddMulti, dLong, parseKey, xDate, fmtN, fmtM, sheet, saveXlsx, stamp } from "../util.js";

const DIMS = {
  uen:"UEN", familia:"Familia", producto:"Producto", articulo:"Artículo", config:"Acabado", origen:"Origen",
  zona:"Zona", pais:"País", provincia:"Provincia de envío", delegado:"Delegado", grupo:"Agente / grupo comercial",
  tipo_cliente:"Tipo de cliente", cliente:"Cliente", top:"TOP clientes",
};
const FILTROS = ["zona","pais","delegado","grupo","tipo_cliente","top","cliente","uen","familia","producto","articulo","config"];
const SIGUIENTE = { uen:"familia", familia:"producto", producto:"articulo", articulo:"config", zona:"pais", pais:"provincia", provincia:"cliente",
  delegado:"cliente", grupo:"cliente", tipo_cliente:"cliente", top:"cliente", cliente:"familia", origen:"familia" };
const MEDIDAS = { importe:"Importe", unidades:"Unidades", pedidos:"Pedidos", clientes:"Clientes", lineas:"Líneas", ticket:"Ticket medio", precio:"Precio medio" };
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const COLORES = ["#B9A27A","#7A8C99","#5F7F5A","#2A2927","#C2362B","#0F8A86"];

const F = { anios:null, ytd:true, medida:"importe", gran:"mes", pct:false, tab:"evolucion", dim:"familia", f:{}, ruta:[], lim:200, clienteA:null };
const C = new Map();   // caché de consultas
let INFO = null, infoLoading = false, charts = [];

function rpc(fn, args){ return sb.schema("comercial").rpc(fn, args).then(r => { if (r.error) throw r.error; return r.data; }); }
function cached(key, fn){
  if (C.has(key)) return C.get(key);
  const e = { loading:true, data:null, error:null }; C.set(key, e);
  fn().then(d => { e.data = d; e.loading = false; render(); }).catch(err => { console.error(err); e.error = err; e.loading = false; render(); });
  return e;
}
function limpiarCache(){ C.clear(); INFO = null; }

async function cargarInfo(){
  infoLoading = true;
  try{
    const [i, c] = await Promise.all([
      rpc("demanda_info", {}),
      sb.schema("core").from("cargas").select("tipo,fichero,periodo,cargado_en,fecha_datos").in("tipo",["pedidos_venta","cartera"]).order("cargado_en",{ascending:false}).limit(20),
    ]);
    INFO = { anios: i.map(x => x.anio), porAnio: Object.fromEntries(i.map(x => [x.anio, x])), cargas: c.data || [] };
    const ult = i[i.length-1]; INFO.hasta = ult ? ult.hasta : null;
    if (!F.anios) F.anios = INFO.anios.slice();
  } catch(e){ console.error(e); toast("No se han podido cargar los datos de la demanda."); INFO = { anios:[], porAnio:{}, cargas:[] }; }
  infoLoading = false; render();
}
const hastaMD = () => INFO && INFO.hasta ? INFO.hasta.slice(5) : "";
function params(extra){
  const p = { anios: F.anios, hasta: F.ytd ? hastaMD() : "" };
  for (const k of FILTROS) if (F.f[k] && F.f[k].length) p[k] = F.f[k];
  return Object.assign(p, extra || {});
}
const ultAnio = () => Math.max(...F.anios);
const prevAnio = () => { const a = F.anios.filter(x => x < ultAnio()); return a.length ? Math.max(...a) : null; };

const val = (r, m) => !r ? null : m === "ticket" ? (r.pedidos ? r.importe / r.pedidos : null) : m === "precio" ? (r.unidades ? r.importe / r.unidades : null) : +r[m];
const fmtVal = (v, m) => v == null || !isFinite(v) ? "" : (m === "importe" ? fmtM(v,"EUR",0) : m === "ticket" || m === "precio" ? fmtM(v,"EUR",2) : fmtN(v, m === "unidades" ? 1 : 0));
const pct = (a, b) => (a == null || b == null || !b) ? null : (a - b) / Math.abs(b);
const fmtPct = v => v == null || !isFinite(v) ? "" : (v > 0 ? "+" : "") + (v*100).toLocaleString("es-ES",{maximumFractionDigits:1}) + " %";
const clsPct = v => v == null ? "" : v > 0.0005 ? "up" : v < -0.0005 ? "down" : "";
const num = r => Object.fromEntries(Object.entries(r).map(([k,v]) => [k, (k === "clave" || k === "nombre") ? v : (v == null ? v : +v)]));

/* ================= Pantalla ================= */
export function renderDemanda(app){
  document.title = "Comercial: análisis de la demanda";
  for (const ch of charts) try { ch.destroy(); } catch(e){} charts = [];
  cabecera(app, "Análisis de la demanda", "Evolución de los pedidos de venta a partir del diario de pedidos de AX.", { txt:"Comercial", href:"#comercial" }, "demanda");
  const box = el("div","pad dem"); box.style.paddingBottom = "32px"; app.append(box);
  if (!INFO){ if (!infoLoading) cargarInfo(); box.append(el("div","card empty","Cargando datos…")); return; }
  if (!INFO.anios.length){ box.append(el("div","card empty","Todavía no hay pedidos cargados.")); cargaBox(box); return; }

  const info = el("p","hint"); info.textContent = `Datos de ${INFO.anios[0]} a ${INFO.anios[INFO.anios.length-1]}, último pedido el ${dLong(parseKey(INFO.hasta))}. Importes en euros; las líneas negativas (anulaciones y modificaciones) restan.`;
  box.append(info);
  // pestañas
  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  for (const [k,t] of [["evolucion","Evolución"],["desglose","Desglose"],["clientes","Clientes"],["cartera","Cartera pendiente"],["lineas","Detalle de líneas"]]){
    const a = el("a",null,t); a.href = "#demanda"; if (F.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); F.tab = k; render(); }); nav.append(a); }
  box.append(nav);
  if (F.tab !== "cartera") controles(box);
  if (F.tab === "evolucion") tabEvolucion(box);
  else if (F.tab === "desglose") tabDesglose(box);
  else if (F.tab === "clientes") tabClientes(box);
  else if (F.tab === "cartera") tabCartera(box);
  else tabLineas(box);
  cargaBox(box);
}

/* ---------------- Controles comunes ---------------- */
function seg(opts, v, on){ const s = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(k === v)); b.addEventListener("click", () => on(k)); s.append(b); } return s; }
function opcionesDim(dim){
  const e = cached("opt|"+dim, () => rpc("demanda_desglose", { p:{ anios: INFO.anios }, dim }));
  if (!e.data) return [];
  const m = new Map(); for (const r of e.data){ if (r.clave == null) continue; const x = m.get(r.clave) || { v:r.clave, nombre:r.nombre, imp:0 }; x.imp += +r.importe || 0; if (r.nombre) x.nombre = r.nombre; m.set(r.clave, x); }
  return [...m.values()].sort((a,b) => b.imp - a.imp).map(x => ({ v:x.v, l: dim === "top" ? (x.v === "1" ? "Clientes TOP" : "Resto de clientes") : (x.nombre ? (dim === "articulo" ? `${x.v}` : `${x.nombre}`) : x.v), sub: dim === "cliente" ? x.v : dim === "articulo" ? x.nombre : fmtM(x.imp,"EUR",0) }));
}
function controles(box){
  const c = el("div","ctrl");
  const fld = (lab, node) => { const d = el("div","fld"); d.append(el("span",null,lab), node); return d; };
  const an = el("div","seg"); for (const y of INFO.anios){ const b = el("button",null,String(y)); b.type = "button"; b.setAttribute("aria-pressed", String(F.anios.includes(y)));
    b.addEventListener("click", () => { const s = new Set(F.anios); s.has(y) ? s.delete(y) : s.add(y); if (!s.size) return; F.anios = [...s].sort(); render(); }); an.append(b); }
  c.append(fld("Años", an));
  c.append(fld("Comparar", seg([["ytd",`Hasta el ${hastaMD().split("-").reverse().join("/")}`],["full","Año completo"]], F.ytd ? "ytd" : "full", v => { F.ytd = v === "ytd"; render(); })));
  c.append(fld("Medida", seg(Object.entries(MEDIDAS), F.medida, v => { F.medida = v; render(); })));
  if (F.tab === "evolucion") c.append(fld("Periodo", seg([["mes","Mes"],["trimestre","Trimestre"],["semana","Semana"]], F.gran, v => { F.gran = v; render(); })));
  box.append(c);
  // filtros
  const fb = el("div","ctrl fil");
  for (const k of FILTROS){
    const opts = opcionesDim(k);
    fb.append(ddMulti(ctx.ui, "dem-"+k, DIMS[k], opts, F.f[k] || [], n => { F.f[k] = n; F.ruta = F.ruta.filter(r => r.dim !== k); render(); }, render));
  }
  const act = FILTROS.filter(k => F.f[k] && F.f[k].length);
  if (act.length){ const cl = el("button","btn small","Quitar filtros"); cl.addEventListener("click", () => { F.f = {}; F.ruta = []; render(); }); fb.append(cl); }
  box.append(fb);
}

/* ---------------- KPI ---------------- */
function kpis(box){
  const e = cached("serie|anio|"+JSON.stringify(params()), () => rpc("demanda_serie", { p: params(), gran:"anio" }));
  if (!e.data) return;
  const by = Object.fromEntries(e.data.map(r => [r.anio, num(r)])), a = ultAnio(), b = prevAnio();
  const k = el("div","kpis");
  for (const m of ["importe","unidades","pedidos","clientes","ticket","precio"]){
    const va = val(by[a], m), vb = b ? val(by[b], m) : null, d = pct(va, vb);
    const x = el("div","kpi"); x.append(el("small",null,`${MEDIDAS[m]} ${a}`), el("b",null,fmtVal(va,m) || "0"));
    if (b){ const s = el("span","delta "+clsPct(d), d == null ? "" : `${fmtPct(d)} vs ${b}`); x.append(s); }
    k.append(x);
  }
  box.append(k);
}

/* ---------------- Evolución ---------------- */
function etiquetaPeriodo(g, p){ return g === "mes" ? MES[p-1] : g === "trimestre" ? "T"+p : "S"+String(p).padStart(2,"0"); }
function tabEvolucion(box){
  kpis(box);
  const e = cached("serie|"+F.gran+"|"+JSON.stringify(params()), () => rpc("demanda_serie", { p: params(), gran:F.gran }));
  if (e.loading){ box.append(el("div","card empty","Calculando…")); return; }
  if (e.error){ box.append(el("div","card empty","No se ha podido calcular la serie.")); return; }
  const rows = e.data.map(num), m = F.medida;
  const periodos = [...new Set(rows.map(r => r.periodo))].sort((x,y) => x-y);
  const anios = F.anios.filter(y => rows.some(r => r.anio === y));
  const get = (y,p) => rows.find(r => r.anio === y && r.periodo === p);
  const totAnio = y => rows.filter(r => r.anio === y).reduce((s,r) => s + (val(r, m === "ticket" || m === "precio" ? "importe" : m) || 0), 0);
  const v = (y,p) => { const x = val(get(y,p), m); return F.pct && !["ticket","precio"].includes(m) && x != null ? x / (totAnio(y) || 1) : x; };
  const opt = el("label","chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = F.pct; cb.addEventListener("change", () => { F.pct = cb.checked; render(); }); opt.append(cb, " Ver cada periodo como % del total del año (estacionalidad)"); box.append(opt);
  // gráficos
  const g = el("div","charts");
  const c1 = el("div","card chartcard"); c1.append(el("h3",null, `${MEDIDAS[m]} por ${F.gran === "mes" ? "mes" : F.gran}`)); const cv1 = el("canvas"); c1.append(cv1); g.append(c1);
  const c2 = el("div","card chartcard"); c2.append(el("h3",null,"Acumulado del año")); const cv2 = el("canvas"); c2.append(cv2); g.append(c2);
  box.append(g);
  const labels = periodos.map(p => etiquetaPeriodo(F.gran, p));
  const ds = (fn) => anios.map((y,i) => ({ label:String(y), data: periodos.map(p => fn(y,p)), borderColor:COLORES[(anios.length-1-i)%COLORES.length], backgroundColor:COLORES[(anios.length-1-i)%COLORES.length], borderWidth: y === ultAnio() ? 3 : 1.6, pointRadius: F.gran === "semana" ? 0 : 2.5, tension:.25 }));
  const fmtT = x => F.pct ? fmtPct(x).replace("+","") : fmtVal(x, m);
  setTimeout(() => {
    if (!window.Chart) return;
    const opts = { responsive:true, maintainAspectRatio:false, interaction:{ mode:"index", intersect:false }, plugins:{ legend:{ position:"bottom" }, tooltip:{ callbacks:{ label: c => `${c.dataset.label}: ${fmtT(c.parsed.y)}` } } }, scales:{ y:{ ticks:{ callback: x => fmtT(x) } } } };
    charts.push(new Chart(cv1, { type:"line", data:{ labels, datasets: ds(v) }, options: opts }));
    if (!["ticket","precio"].includes(m)){
      const acum = (y,p) => periodos.filter(q => q <= p).reduce((s,q) => s + (val(get(y,q), m) || 0), 0);
      charts.push(new Chart(cv2, { type:"line", data:{ labels, datasets: ds(acum) }, options: Object.assign({}, opts, { plugins:{ legend:{ position:"bottom" }, tooltip:{ callbacks:{ label: c => `${c.dataset.label}: ${fmtVal(c.parsed.y, m)}` } } }, scales:{ y:{ ticks:{ callback: x => fmtVal(x, m) } } } }) }));
    } else c2.remove();
  }, 0);
  // tabla
  const a = ultAnio(), b = prevAnio();
  const tw = el("div","tblwrap"); const t = el("table","tbl pivot");
  const hr = el("tr"); hr.append(el("th",null,"Periodo")); for (const y of anios) hr.append(el("th","n",String(y))); if (b) hr.append(el("th","n",`${a} vs ${b}`));
  const th = el("thead"); th.append(hr); t.append(th);
  const tb = el("tbody");
  for (const p of periodos){ const tr = el("tr"); tr.append(el("td",null,etiquetaPeriodo(F.gran,p))); for (const y of anios) tr.append(el("td","n", F.pct ? fmtPct(v(y,p)).replace("+","") : fmtVal(v(y,p), m)));
    if (b){ const d = pct(val(get(a,p),m), val(get(b,p),m)); tr.append(el("td","n "+clsPct(d), fmtPct(d))); } tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  F._export = () => { const A = [["Periodo", ...anios.map(String)]]; for (const p of periodos) A.push([etiquetaPeriodo(F.gran,p), ...anios.map(y => { const x = v(y,p); return x == null ? "" : Math.round(x*100)/100; })]); return { "Evolución": A }; };
  exportar(box);
}

/* ---------------- Desglose ---------------- */
function tabDesglose(box){
  kpis(box);
  const c = el("div","ctrl");
  const s = el("select"); for (const [k,l] of Object.entries(DIMS)){ const o = el("option",null,l); o.value = k; s.append(o); } s.value = F.dim;
  s.addEventListener("change", () => { F.dim = s.value; render(); });
  const lb = el("label","fld"); lb.append("Agrupar por", s); c.append(lb);
  if (F.ruta.length){ const r = el("div","ruta"); r.append(el("span",null,"Camino: "));
    F.ruta.forEach((x,i) => { const a = el("button","btn small", `${DIMS[x.dim]}: ${x.label}`); a.title = "Volver a este nivel"; a.addEventListener("click", () => { for (const y of F.ruta.slice(i)) delete F.f[y.dim]; F.dim = x.dim; F.ruta = F.ruta.slice(0,i); render(); }); r.append(a); });
    c.append(r); }
  box.append(c);
  box.append(el("p","hint","Pulsa una fila para filtrar por ella y bajar al siguiente nivel (por ejemplo, UEN › Familia › Producto › Artículo › Acabado, o Zona › País › Provincia › Cliente)."));
  const e = cached("des|"+F.dim+"|"+JSON.stringify(params()), () => rpc("demanda_desglose", { p: params(), dim: F.dim }));
  if (e.loading){ box.append(el("div","card empty","Calculando…")); return; }
  if (e.error){ box.append(el("div","card empty","No se ha podido calcular el desglose.")); return; }
  const m = F.medida, a = ultAnio(), b = prevAnio(), anios = F.anios;
  const map = new Map(); for (const r0 of e.data){ const r = num(r0); const k = r.clave ?? "(sin dato)"; const x = map.get(k) || { clave:k, nombre:r.nombre, y:{} }; x.y[r.anio] = r; if (r.nombre) x.nombre = r.nombre; map.set(k, x); }
  const filas = [...map.values()].sort((x,y) => (val(y.y[a], m) || 0) - (val(x.y[a], m) || 0) || (val(y.y[b], m) || 0) - (val(x.y[b], m) || 0));
  const total = filas.reduce((s,f) => s + (val(f.y[a], m === "ticket" || m === "precio" ? "importe" : m) || 0), 0);
  // gráfico de barras (15 primeros)
  const cc = el("div","card chartcard"); cc.append(el("h3",null, `${MEDIDAS[m]} por ${DIMS[F.dim].toLowerCase()}: ${b ? b+" y " : ""}${a} (15 primeros)`)); const cv = el("canvas"); cc.append(cv); cc.style.height = "360px"; box.append(cc);
  const top = filas.slice(0,15), lab = f => (f.nombre && F.dim !== "articulo" ? f.nombre : f.clave) + (F.dim === "articulo" && f.nombre ? " · " + f.nombre.slice(0,28) : "");
  setTimeout(() => { if (!window.Chart) return; charts.push(new Chart(cv, { type:"bar", data:{ labels: top.map(lab), datasets: [b,a].filter(Boolean).map((y,i) => ({ label:String(y), data: top.map(f => val(f.y[y], m)), backgroundColor: i ? "#B9A27A" : "#C9C3B8" })) },
    options:{ indexAxis:"y", responsive:true, maintainAspectRatio:false, plugins:{ legend:{ position:"bottom" }, tooltip:{ callbacks:{ label: c => `${c.dataset.label}: ${fmtVal(c.parsed.x, m)}` } } }, scales:{ x:{ ticks:{ callback: x => fmtVal(x, m) } } } } })); }, 0);
  // tabla
  const tw = el("div","tblwrap"); tw.style.maxHeight = "70vh"; const t = el("table","tbl pivot");
  const hr = el("tr"); hr.append(el("th","code",DIMS[F.dim])); if (["cliente","articulo","grupo"].includes(F.dim)) hr.append(el("th",null,"Nombre"));
  for (const y of anios) hr.append(el("th","n",String(y))); if (b) hr.append(el("th","n",`${a} vs ${b}`)); hr.append(el("th","n",`% ${a}`), el("th","n","% acumulado"));
  const th = el("thead"); th.append(hr); t.append(th);
  const tb = el("tbody"); let acum = 0; const sig = SIGUIENTE[F.dim];
  for (const f of filas){
    const tr = el("tr"); const va = val(f.y[a], m === "ticket" || m === "precio" ? "importe" : m) || 0; acum += va;
    tr.append(el("td","code", F.dim === "top" ? (f.clave === "1" ? "Clientes TOP" : "Resto") : (["cliente","articulo","grupo"].includes(F.dim) ? f.clave : (f.nombre || f.clave))));
    if (["cliente","articulo","grupo"].includes(F.dim)) tr.append(el("td",null,f.nombre || ""));
    for (const y of anios) tr.append(el("td","n",fmtVal(val(f.y[y], m), m)));
    if (b){ const d = pct(val(f.y[a],m), val(f.y[b],m)); tr.append(el("td","n "+clsPct(d), f.y[b] && !f.y[a] ? "−100 %" : !f.y[b] && f.y[a] ? "nuevo" : fmtPct(d))); }
    tr.append(el("td","n", total ? fmtPct(va/total).replace("+","") : ""), el("td","n", total ? fmtPct(acum/total).replace("+","") : ""));
    if (FILTROS.includes(F.dim) || F.dim === "provincia" || F.dim === "origen"){
      tr.title = sig ? `Filtrar por esta fila y ver ${DIMS[sig].toLowerCase()}` : "Filtrar por esta fila"; tr.style.cursor = "pointer";
      tr.addEventListener("click", () => { F.f[F.dim] = [f.clave]; F.ruta.push({ dim:F.dim, label: (F.dim === "cliente" || F.dim === "grupo") ? (f.nombre || f.clave) : F.dim === "top" ? (f.clave === "1" ? "TOP" : "Resto") : (f.nombre && F.dim !== "articulo" ? f.nombre : f.clave) }); if (sig) F.dim = sig; render(); });
    }
    tb.append(tr);
  }
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint",`${filas.length} ${DIMS[F.dim].toLowerCase()}${filas.length === 1 ? "" : "s"}. «% acumulado» muestra la concentración: hasta qué fila se alcanza el 80 % de ${MEDIDAS[m].toLowerCase()}.`));
  F._export = () => { const A = [[DIMS[F.dim], "Nombre", ...anios.map(String), b ? `${a} vs ${b}` : ""]]; for (const f of filas) A.push([f.clave, f.nombre || "", ...anios.map(y => { const x = val(f.y[y], m); return x == null ? "" : Math.round(x*100)/100; }), b ? (pct(val(f.y[a],m), val(f.y[b],m)) ?? "") : ""]); return { [DIMS[F.dim]]: A }; };
  exportar(box);
}

/* ---------------- Clientes ---------------- */
function tabClientes(box){
  kpis(box);
  const a = ultAnio(), b = prevAnio();
  if (!b){ box.append(el("div","card empty","Elige al menos dos años para comparar clientes.")); return; }
  const p = params({ anios:[b, a] });
  const e = cached("cli|"+JSON.stringify(p), () => rpc("demanda_desglose", { p, dim:"cliente" }));
  if (e.loading){ box.append(el("div","card empty","Calculando…")); return; }
  if (e.error){ box.append(el("div","card empty","No se ha podido calcular.")); return; }
  const map = new Map(); for (const r0 of e.data){ const r = num(r0); const x = map.get(r.clave) || { clave:r.clave, nombre:r.nombre, a:0, b:0, pa:0, pb:0 }; if (r.anio === a){ x.a = r.importe; x.pa = r.pedidos; } else { x.b = r.importe; x.pb = r.pedidos; } if (r.nombre) x.nombre = r.nombre; map.set(r.clave, x); }
  const L = [...map.values()];
  const grupos = [
    ["nuevos", "Nuevos", "Compran en "+a+" y no en "+b, L.filter(x => x.a > 0 && x.b <= 0).sort((x,y) => y.a - x.a)],
    ["perdidos", "Perdidos", "Compraron en "+b+" y no en "+a, L.filter(x => x.b > 0 && x.a <= 0).sort((x,y) => y.b - x.b)],
    ["crecen", "Crecen", "Compran más que en "+b, L.filter(x => x.a > 0 && x.b > 0 && x.a > x.b).sort((x,y) => (y.a-y.b) - (x.a-x.b))],
    ["caen", "Caen", "Compran menos que en "+b, L.filter(x => x.a > 0 && x.b > 0 && x.a < x.b).sort((x,y) => (x.a-x.b) - (y.a-y.b))],
  ];
  const ta = L.reduce((s,x) => s + x.a, 0), tb = L.reduce((s,x) => s + x.b, 0);
  const k = el("div","kpis");
  for (const [id,t,sub,arr] of grupos){ const dif = arr.reduce((s,x) => s + x.a - x.b, 0); const d = el("div","kpi"); d.append(el("small",null,`${t} (${arr.length})`), el("b",null,fmtM(dif,"EUR",0)), el("span","delta "+clsPct(dif), sub)); k.append(d); }
  box.append(k);
  box.append(el("p","hint",`Puente de ${b} a ${a} (${F.ytd ? "mismo periodo" : "año completo"}): ${fmtM(tb,"EUR",0)} + nuevos + crecen − caen − perdidos = ${fmtM(ta,"EUR",0)}.`));
  // concentración
  const ord = L.filter(x => x.a > 0).sort((x,y) => y.a - x.a); const sh = n => ta ? ord.slice(0,n).reduce((s,x) => s + x.a, 0) / ta : 0;
  box.append(el("p","hint",`Concentración ${a}: los 10 primeros clientes suman el ${fmtPct(sh(10)).replace("+","")}, los 20 primeros el ${fmtPct(sh(20)).replace("+","")} y los 50 primeros el ${fmtPct(sh(50)).replace("+","")} de la facturación de pedidos.`));
  const g = el("div","grid2");
  for (const [id,t,sub,arr] of grupos){
    const card = el("div","card"); card.append(el("h3",null,`${t}: ${arr.length} clientes`));
    const tw = el("div","tblwrap"); tw.style.maxHeight = "360px"; const tbl = el("table","tbl");
    const hr = el("tr"); for (const [x,cl] of [["Cliente",""],[String(b),"n"],[String(a),"n"],["Diferencia","n"]]) hr.append(el("th",cl,x)); const th = el("thead"); th.append(hr); tbl.append(th);
    const bd = el("tbody"); for (const x of arr.slice(0,100)){ const tr = el("tr"); tr.style.cursor = "pointer"; tr.title = "Ver el desglose de este cliente";
      tr.addEventListener("click", () => { F.f.cliente = [x.clave]; F.ruta = [{ dim:"cliente", label:x.nombre || x.clave }]; F.dim = "familia"; F.tab = "desglose"; render(); });
      tr.append(el("td",null,`${x.nombre || ""} (${x.clave})`), el("td","n",fmtM(x.b,"EUR",0)), el("td","n",fmtM(x.a,"EUR",0)), el("td","n "+clsPct(x.a-x.b),fmtM(x.a-x.b,"EUR",0))); bd.append(tr); }
    tbl.append(bd); tw.append(tbl); card.append(tw); g.append(card);
  }
  box.append(g);
  F._export = () => { const out = {}; for (const [id,t,sub,arr] of grupos) out[t] = [["Cliente","Código",String(b),String(a),"Diferencia"], ...arr.map(x => [x.nombre || "", x.clave, x.b, x.a, x.a - x.b])]; return out; };
  exportar(box);
}

/* ---------------- Cartera pendiente ---------------- */
let CART = null, cartLoading = false;
const CF = { agrupar:"semana", q:"" };
async function cargarCartera(){
  cartLoading = true; const out = [];
  try { for (let i = 0; ; i += 1000){ const { data, error } = await sb.schema("ax").from("cartera_pendiente").select("*").range(i, i+999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } CART = out; }
  catch(e){ console.error(e); toast("No se ha podido cargar la cartera."); CART = []; }
  cartLoading = false; render();
}
function lunesISO(d){ const x = new Date(d); const wd = (x.getUTCDay()+6)%7; x.setUTCDate(x.getUTCDate()-wd); return x.toISOString().slice(0,10); }
function tabCartera(box){
  if (!CART){ if (!cartLoading) cargarCartera(); box.append(el("div","card empty","Cargando la cartera pendiente…")); return; }
  const c = INFO.cargas.find(x => x.tipo === "cartera");
  box.append(el("p","hint", c ? `Foto de la cartera pendiente de servir del fichero «${c.fichero}»${c.fecha_datos ? ", " + dLong(parseKey(c.fecha_datos.slice(0,10))) : ""}.` : "Cartera pendiente de servir."));
  const hoy = new Date().toISOString().slice(0,10);
  const L = CART.filter(r => (!CF.q || (`${r.cliente_nombre} ${r.cliente_id} ${r.articulo_id} ${r.descripcion} ${r.pedido}`).toLowerCase().includes(CF.q.toLowerCase())));
  const imp = L.reduce((s,r) => s + (+r.importe_pendiente || 0), 0), uds = L.reduce((s,r) => s + (+r.pendiente || 0), 0);
  const atr = L.filter(r => r.fecha_entrega_solicitada && r.fecha_entrega_solicitada < hoy);
  const k = el("div","kpis"); const kp = (t,v,cl) => { const d = el("div","kpi"+(cl?" "+cl:"")); d.append(el("small",null,t), el("b",null,v)); return d; };
  k.append(kp("Importe pendiente", fmtM(imp,"EUR",0)), kp("Unidades pendientes", fmtN(uds)), kp("Pedidos", String(new Set(L.map(r => r.pedido)).size)), kp("Clientes", String(new Set(L.map(r => r.cliente_id)).size)),
    kp("Con fecha solicitada vencida", `${fmtM(atr.reduce((s,r) => s + (+r.importe_pendiente || 0), 0),"EUR",0)} (${atr.length} líneas)`, atr.length ? "bad" : ""));
  box.append(k);
  const ctl = el("div","ctrl"); const q = el("input"); q.type = "search"; q.placeholder = "Buscar cliente, artículo o pedido"; q.value = CF.q; q.dataset.k = "cart-q"; q.addEventListener("input", () => { CF.q = q.value; render(); });
  const fq = el("div","fld"); fq.append(el("span",null,"Buscar"), q); ctl.append(fq);
  const fg = el("div","fld"); fg.append(el("span",null,"Agrupar por"), seg([["semana","Semana de entrega solicitada"],["cliente","Cliente"],["familia","Familia"],["articulo","Artículo"],["delegado","Agente"]], CF.agrupar, v => { CF.agrupar = v; render(); })); ctl.append(fg);
  box.append(ctl);
  const key = r => CF.agrupar === "semana" ? (r.fecha_entrega_solicitada ? lunesISO(r.fecha_entrega_solicitada) : "sin fecha") : CF.agrupar === "cliente" ? r.cliente_id : CF.agrupar === "familia" ? (r.familia || "(sin familia)") : CF.agrupar === "articulo" ? r.articulo_id : (r.grupo_comercial_nombre || r.grupo_comercial || "");
  const lab = (k0, r) => CF.agrupar === "semana" ? (k0 === "sin fecha" ? "Sin fecha" : `Semana del ${dLong(parseKey(k0))}${k0 < lunesISO(hoy) ? " (vencida)" : ""}`) : CF.agrupar === "cliente" ? `${r.cliente_nombre} (${k0})` : CF.agrupar === "articulo" ? `${k0} · ${r.descripcion || ""}` : k0;
  const m = new Map(); for (const r of L){ const k0 = key(r); const x = m.get(k0) || { k:k0, lab:lab(k0, r), imp:0, uds:0, n:0, ped:new Set() }; x.imp += +r.importe_pendiente || 0; x.uds += +r.pendiente || 0; x.n++; x.ped.add(r.pedido); m.set(k0, x); }
  const rows = [...m.values()].sort((x,y) => CF.agrupar === "semana" ? (x.k < y.k ? -1 : 1) : y.imp - x.imp);
  const tw = el("div","tblwrap"); tw.style.maxHeight = "60vh"; const t = el("table","tbl");
  const hr = el("tr"); for (const [x,cl] of [["Grupo",""],["Pedidos","n"],["Líneas","n"],["Unidades","n"],["Importe pendiente","n"]]) hr.append(el("th",cl,x)); const th = el("thead"); th.append(hr); t.append(th);
  const tb = el("tbody"); for (const x of rows){ const tr = el("tr", x.lab.includes("vencida") ? "late" : ""); tr.append(el("td",null,x.lab), el("td","n",String(x.ped.size)), el("td","n",String(x.n)), el("td","n",fmtN(x.uds)), el("td","n",fmtM(x.imp,"EUR",0))); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  F._export = () => ({ "Cartera pendiente": [["Pedido","Cliente","Código cliente","Línea","Artículo","Acabado","Descripción","Familia","Cantidad","Pendiente","Precio","Importe pendiente","Fecha pedido","Entrega solicitada","Agente","Pedido cliente"],
    ...L.map(r => [r.pedido, r.cliente_nombre, r.cliente_id, r.linea, r.articulo_id, r.config_id, r.descripcion, r.familia, +r.cantidad, +r.pendiente, +r.precio, +r.importe_pendiente, r.fecha_pedido ? xDate(parseKey(r.fecha_pedido.slice(0,10))) : "", r.fecha_entrega_solicitada ? xDate(parseKey(r.fecha_entrega_solicitada)) : "", r.grupo_comercial_nombre || "", r.pedido_cliente || ""])] });
  exportar(box);
}

/* ---------------- Detalle de líneas ---------------- */
function tabLineas(box){
  kpis(box);
  const p = params(); const e = cached("lin|"+F.lim+"|"+JSON.stringify(p), () => rpc("demanda_lineas", { p, lim:F.lim, off:0 }));
  if (e.loading){ box.append(el("div","card empty","Cargando líneas…")); return; }
  if (e.error){ box.append(el("div","card empty","No se han podido cargar las líneas.")); return; }
  const tw = el("div","tblwrap"); tw.style.maxHeight = "70vh"; const t = el("table","tbl det");
  const H = [["Fecha",""],["Pedido",""],["Cliente",""],["Artículo",""],["Acabado",""],["Descripción",""],["Familia",""],["Cantidad","n"],["Importe","n"],["Agente",""],["País",""]];
  const hr = el("tr"); for (const [x,cl] of H) hr.append(el("th",cl,x)); const th = el("thead"); th.append(hr); t.append(th);
  const tb = el("tbody");
  for (const r of e.data){ const tr = el("tr", +r.cantidad < 0 || +r.importe < 0 ? "neg" : "");
    tr.append(el("td",null,dLong(parseKey(r.fecha.slice(0,10)))), el("td",null,r.pedido), el("td",null,`${r.cliente_nombre || ""} (${r.cliente_id || ""})`), el("td",null,r.articulo_id || ""), el("td",null,r.config_id || ""),
      el("td",null,r.descripcion || ""), el("td",null,r.familia || ""), el("td","n",fmtN(+r.cantidad)), el("td","n",fmtM(+r.importe,"EUR",2)), el("td",null,r.grupo_comercial_nombre || ""), el("td",null,r.pais || ""));
    tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  const more = el("div","prow"); more.style.marginTop = "8px"; more.append(el("span","hint",`${e.data.length} líneas más recientes con los filtros actuales.`));
  if (e.data.length >= F.lim && F.lim < 2000){ const b = el("button","btn small","Ver más"); b.addEventListener("click", () => { F.lim = Math.min(2000, F.lim + 400); render(); }); more.append(b); }
  box.append(more);
  F._export = () => ({ "Líneas": [["Fecha","Pedido","Línea","Cliente","Código cliente","Artículo","Acabado","Descripción","UEN","Familia","Producto","Cantidad","Importe","Agente","Delegado","Zona","País","Provincia envío","Tipo cliente"],
    ...e.data.map(r => [xDate(parseKey(r.fecha.slice(0,10))), r.pedido, +r.linea, r.cliente_nombre, r.cliente_id, r.articulo_id, r.config_id, r.descripcion, r.uen, r.familia, r.producto, +r.cantidad, +r.importe, r.grupo_comercial_nombre, r.delegado, r.zona, r.pais, r.provincia_envio, r.tipo_cliente])] });
  exportar(box);
}

/* ---------------- Exportar y cargar ---------------- */
function exportar(box){
  const b = el("button","btn","Exportar a Excel"); b.style.marginTop = "12px";
  b.addEventListener("click", () => { if (!F._export) return; const wb = XLSX.utils.book_new(); for (const [n, A] of Object.entries(F._export())) XLSX.utils.book_append_sheet(wb, sheet(A), n.slice(0,31)); saveXlsx(wb, `Demanda_${F.tab}_${stamp()}.xlsx`); });
  box.append(b);
}
function cargaBox(box){
  if (nivel("demanda") !== "editar") return;
  const d = el("details","card cargas"); d.style.marginTop = "18px"; const s = el("summary",null,"Actualizar datos (fichero Diario_Demanda_Cartera de AX)"); d.append(s);
  d.append(el("p","hint","Elige el Excel de un año. Se sustituyen todas las líneas de ese año y, si el fichero trae la hoja CarteraPendiente, también la cartera pendiente. El fichero es grande: la lectura puede tardar unos segundos."));
  const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm";
  const msg = el("p","hint");
  inp.addEventListener("change", () => { if (inp.files[0]) cargarFichero(inp.files[0], msg, inp); });
  d.append(inp, msg);
  if (INFO && INFO.cargas.length){ const ul = el("ul"); ul.style.cssText = "font-size:13px;color:var(--ink-2)"; for (const c of INFO.cargas.slice(0,6)) ul.append(el("li",null,`${c.tipo === "cartera" ? "Cartera" : "Pedidos " + c.periodo}: ${c.fichero}, cargado el ${dLong(parseKey(c.cargado_en.slice(0,10)))}`)); d.append(ul); }
  box.append(d);
}
const S = v => { if (v == null) return null; const s = String(v).trim(); return s && !["nan","Error","#N/A","None"].includes(s) ? s : null; };
const N = v => { if (v == null || v === "") return null; const x = typeof v === "number" ? v : Number(String(v).replace(",", ".")); return isFinite(x) ? x : null; };
const TS = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return null; const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
async function cargarFichero(file, msg, inp){
  const set = t => { msg.textContent = t; };
  try{
    set("Leyendo el fichero…"); inp.disabled = true;
    const wb = XLSX.read(await file.arrayBuffer(), { type:"array", cellDates:true, cellFormula:false });
    const ws = wb.Sheets["AC.Pedidos"]; if (!ws) throw new Error("El fichero no tiene la hoja AC.Pedidos.");
    const R = XLSX.utils.sheet_to_json(ws, { defval:null, raw:true }).filter(r => r.CREATEDDATETIME);
    const anios = [...new Set(R.map(r => new Date(r.CREATEDDATETIME).getFullYear()))];
    const y = Math.max(...anios);
    const rows = R.map(r => ({ anio_fichero:y, fecha:TS(r.CREATEDDATETIME), pedido:S(r.SALESID), linea:N(r.LINENUM), articulo_id:S(r.ITEMID), config_id:S(r.CONFIGID), talla_id:S(r.INVENTSIZEID),
      ancho:N(r.BANWIDTH), alto:N(r.BANHEIGHT), descripcion:S(r.NAME), cliente_id:S(r.CUSTACCOUNT), cliente_nombre:S(r.SALESNAME), cantidad:N(r.QTYORDERED), importe:N(r.LINEAMOUNT), moneda:S(r.CURRENCYCODE),
      grupo_comercial:S(r.SALESGROUP), grupo_comercial_nombre:S(r["Desc. SALESGROUP"]), pedido_cliente:S(r.PURCHORDERFORMNUM), modo_entrega:S(r.DLVMODE), provincia_envio_cod:S(r.DELIVERYCOUNTY),
      pais_envio_cod:S(r.DELIVERYCOUNTRYREGIONID), uen:S(r.UEN), familia:S(r.FAMILIA), producto:S(r.PRODUCTO), articulo_nombre:S(r.ITEMNAME), origen:S(r.ORIGEN), zona:S(r.Zona),
      pais:S(r.PAIS) ? S(r.PAIS).toUpperCase() : null, provincia_envio:S(r["PROVINCIA ENVIO"]), tipo_cliente:S(r.SHOPGROUPID), cliente_alta:TS(r["DATECREATED CUSTOMER"]), delegado:S(r.Delegado),
      provincia_cliente:S(r["PROVINCIA cliente"]), top:String(r.TOP) === "1" }));
    const imp = Math.round(rows.reduce((s,r) => s + (r.importe || 0), 0)*100)/100;
    if (!confirm(`El fichero tiene ${rows.length.toLocaleString("es-ES")} líneas de ${y} (${fmtM(imp,"EUR",0)}). Se sustituirán los datos de ${y}. ¿Continuar?`)){ set(""); inp.disabled = false; inp.value = ""; return; }
    const c = await sb.schema("core").from("cargas").insert({ tipo:"pedidos_venta", fichero:file.name, periodo:String(y), filas:rows.length, importe_total:imp, notas:"Carga desde la app" }).select("id").single(); if (c.error) throw c.error;
    set("Borrando los datos anteriores de " + y + "…");
    const del = await sb.schema("ax").from("pedidos_venta_diario").delete().eq("anio_fichero", y); if (del.error) throw del.error;
    for (let i = 0; i < rows.length; i += 1000){ set(`Guardando líneas ${i+1}–${Math.min(i+1000, rows.length)} de ${rows.length}…`);
      const r = await sb.schema("ax").from("pedidos_venta_diario").insert(rows.slice(i, i+1000).map(x => Object.assign({ carga_id:c.data.id }, x))); if (r.error) throw r.error; }
    const wc = wb.Sheets["CarteraPendiente"];
    if (wc){
      const K = XLSX.utils.sheet_to_json(wc, { defval:null, raw:true }).filter(r => r.SALESID);
      const kr = K.map(r => ({ lote:S(r.INVENTTRANSID), pedido:S(r.SALESID), cliente_nombre:S(r.SALESNAME), cliente_id:S(r.CUSTACCOUNT), linea:N(r.LINENUM), articulo_id:S(r.ITEMID), config_id:S(r.CONFIGID), talla_id:S(r.INVENTSIZEID),
        descripcion:S(r.NAME), almacen:S(r.INVENTLOCATIONID), cantidad:N(r.SALESQTY), pendiente:N(r.REMAINSALESPHYSICAL), precio:N(r.SALESPRICE), dto:N(r.LINEDISC), dto_pct:N(r.LINEPERCENT), importe:N(r.LINEAMOUNT),
        moneda:S(r.CURRENCYCODE), fecha_pedido:TS(r.CREATEDDATETIME), fecha_entrega_solicitada: r.RECEIPTDATEREQUESTED ? TS(r.RECEIPTDATEREQUESTED).slice(0,10) : null, grupo_comercial:S(r.SALESGROUP),
        grupo_comercial_nombre:S(r["Desc. SALESGROUP"]), pedido_cliente:S(r.PURCHORDERFORMNUM), provincia_envio_cod:S(r.DELIVERYCOUNTY), pais_envio_cod:S(r.DELIVERYCOUNTRYREGIONID),
        importe_pendiente:N(r["REMAIN LINEAMOUNT"]), uen:S(r.UEN), familia:S(r.FAMILIA), producto:S(r.PRODUCTO), articulo_nombre:S(r.ITEMNAME), origen:S(r.Origen) }));
      set("Actualizando la cartera pendiente…");
      const cc = await sb.schema("core").from("cargas").insert({ tipo:"cartera", fichero:file.name, periodo:String(y), filas:kr.length, fecha_datos:new Date(file.lastModified || Date.now()).toISOString(), notas:"Carga desde la app" }).select("id").single(); if (cc.error) throw cc.error;
      const dc = await sb.schema("ax").from("cartera_pendiente").delete().gte("id", 0); if (dc.error) throw dc.error;
      for (let i = 0; i < kr.length; i += 1000){ const r = await sb.schema("ax").from("cartera_pendiente").insert(kr.slice(i, i+1000).map(x => Object.assign({ carga_id:cc.data.id }, x))); if (r.error) throw r.error; }
      CART = null;
    }
    set(`Hecho: ${rows.length.toLocaleString("es-ES")} líneas de ${y} cargadas${wc ? " y cartera pendiente actualizada" : ""}.`); toast("Datos de la demanda actualizados");
    limpiarCache(); render();
  } catch(e){ console.error(e); set("No se ha podido cargar: " + (e.message || "error")); }
  inp.disabled = false; inp.value = "";
}
