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

const F = { anios:null, ytd:true, medida:"importe", gran:"mes", pct:false, tab:"seguimiento", dim:"familia", f:{}, ruta:[], lim:200, abiertos:new Set() };
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
    if (!F.anios) F.anios = INFO.anios.slice(-3);
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
const fmtVal = (v, m) => v == null || !isFinite(v) ? "" : (m === "importe" ? fmtE0(v) + " €" : m === "ticket" || m === "precio" ? fmtM(v,"EUR",2) : fmtN(v, m === "unidades" ? 1 : 0));
const pct = (a, b) => (a == null || b == null || !b) ? null : (a - b) / Math.abs(b);
const fmtPct = v => v == null || !isFinite(v) ? "" : (v > 0 ? "+" : "") + (v*100).toLocaleString("es-ES",{maximumFractionDigits:1}) + " %";
const clsPct = v => v == null ? "" : v > 0.0005 ? "up" : v < -0.0005 ? "down" : "";
// Miles siempre con punto (también 4 cifras: 4.244), sin decimales
const fmtE0 = v => { if (v == null || !isFinite(v)) return ""; const n = Math.round(v); return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); };
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
  for (const [k,t] of [["seguimiento","Seguimiento de la demanda"],["clientes","Clientes"],["cartera","Cartera pendiente"],["lineas","Detalle de líneas"]]){
    const a = el("a",null,t); a.href = "#demanda"; if (F.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); F.tab = k; render(); }); nav.append(a); }
  if (nivel("demanda") === "editar"){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm"; inp.hidden = true;
    const up = el("button","btn primary small","Actualizar con Excel"); up.title = "Subir el fichero Diario_Demanda_Cartera de un año"; up.style.marginLeft = "auto"; up.addEventListener("click", () => inp.click());
    if (!F.msg) F.msg = el("span","hint upmsg");
    inp.addEventListener("change", () => { if (inp.files[0]) cargarFichero(inp.files[0], F.msg, inp); });
    nav.append(up, inp);
  }
  box.append(nav);
  if (F.msg) box.append(F.msg);
  if (F.tab !== "cartera") controles(box);
  if (F.tab === "seguimiento") tabSeguimiento(box);
  else if (F.tab === "clientes") tabClientes(box);
  else if (F.tab === "cartera") tabCartera(box);
  else tabLineas(box);
}

/* ---------------- Controles comunes ---------------- */
function seg(opts, v, on){ const s = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(k === v)); b.addEventListener("click", () => on(k)); s.append(b); } return s; }
function opcionesDim(dim){
  const e = cached("opt|"+dim, () => rpc("demanda_opciones", { dim }));
  if (!e.data) return e.loading ? [{ v:"__", l:"Cargando…", sub:"" }] : [];
  return e.data.filter(x => x.clave != null).map(x => ({ v:x.clave,
    l: dim === "top" ? (x.clave === "1" ? "Clientes TOP" : "Resto de clientes") : dim === "articulo" ? x.clave : (x.nombre || x.clave),
    sub: dim === "cliente" ? x.clave : dim === "articulo" ? (x.nombre || "") : fmtN(+x.importe, 0) }));
}
function controles(box){
  const c = el("div","ctrl");
  const fld = (lab, node) => { const d = el("div","fld"); d.append(el("span",null,lab), node); return d; };
  const an = el("div","seg"); for (const y of INFO.anios){ const b = el("button",null,String(y)); b.type = "button"; b.setAttribute("aria-pressed", String(F.anios.includes(y)));
    b.addEventListener("click", () => { const s = new Set(F.anios); s.has(y) ? s.delete(y) : s.add(y); if (!s.size) return; F.anios = [...s].sort(); render(); }); an.append(b); }
  c.append(fld("Años", an));
  c.append(fld("Comparar", seg([["ytd",`Hasta el ${hastaMD().split("-").reverse().join("/")}`],["full","Año completo"]], F.ytd ? "ytd" : "full", v => { F.ytd = v === "ytd"; render(); })));
  c.append(fld("Medida", seg(Object.entries(F.tab === "seguimiento" ? { importe:"Importe", unidades:"Unidades", pedidos:"Pedidos", clientes:"Clientes" } : MEDIDAS), F.medida, v => { F.medida = v; render(); })));

  box.append(c);
  // filtros
  const fb = el("div","ctrl fil");
  for (const k of FILTROS){
    const abierto = ctx.ui.dd === "dem-"+k;
    const opts = abierto ? opcionesDim(k) : (F.f[k] || []).map(v => ({ v, l: etiquetaFiltro(k, v) }));
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

/* ---------------- Seguimiento de la demanda (paneles) ---------------- */
const MESES_L = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS_L = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
// Paneles: cada uno es una jerarquía desplegable
const PANELES = [
  { id:"uen",   titulo:"UEN",              niveles:["uen","familia","producto","articulo","config"] },
  { id:"mes",   titulo:"Mes",              niveles:["mes","semana","dow"] },
  { id:"pais",  titulo:"País",             niveles:["pais","provincia","cliente"] },
  { id:"tipo",  titulo:"Tipo de cliente",  niveles:["tipo_cliente","cliente"] },
  { id:"deleg", titulo:"Delegado",         niveles:["delegado","cliente"] },
  { id:"grupo", titulo:"Agente / grupo comercial", niveles:["grupo","cliente"] },
];
function etiquetaFiltro(k, v){
  if (k === "top") return v === "1" ? "Clientes TOP" : "Resto de clientes";
  const e = C.get("opt|"+k); const x = e && e.data && e.data.find(o => o.clave === v);
  return x && x.nombre && k !== "articulo" ? x.nombre : v;
}
// Filas de un nivel: [{clave, nombre, y:{anio:fila}}]
function datosNivel(dim, extra){
  const p = params(extra);
  if (["mes","semana","dow"].includes(dim)){
    const e = cached("ser|"+dim+"|"+JSON.stringify(p), () => rpc("demanda_serie", { p, gran: dim }));
    if (!e.data) return e;
    const m = new Map(); for (const r0 of e.data){ const r = num(r0); const k = String(r.periodo); const x = m.get(k) || { clave:k, y:{} }; x.y[r.anio] = r; m.set(k, x); }
    const filas = [...m.values()].sort((x,y) => +x.clave - +y.clave);
    for (const f of filas) f.nombre = dim === "mes" ? MESES_L[+f.clave-1] : dim === "semana" ? "Semana " + f.clave : DIAS_L[+f.clave-1];
    return { data: filas };
  }
  const e = cached("des|"+dim+"|"+JSON.stringify(p), () => rpc("demanda_desglose", { p, dim }));
  if (!e.data) return e;
  const m = new Map(); for (const r0 of e.data){ const r = num(r0); const k = r.clave ?? ""; const x = m.get(k) || { clave:k, nombre:r.nombre, y:{} }; x.y[r.anio] = r; if (r.nombre) x.nombre = r.nombre; m.set(k, x); }
  const a = ultAnio(), b = prevAnio(), mm = F.medida;
  const filas = [...m.values()].sort((x,y) => (val(y.y[a], mm) || 0) - (val(x.y[a], mm) || 0) || (val(y.y[b], mm) || 0) - (val(x.y[b], mm) || 0));
  for (const f of filas){ if (dim === "top") f.nombre = f.clave === "1" ? "Clientes TOP" : "Resto de clientes"; else if (dim === "cliente") f.nombre = `${f.nombre || ""} (${f.clave})`; else if (dim === "articulo") f.nombre = `${f.clave} · ${f.nombre || ""}`; else if (dim === "grupo") f.nombre = f.nombre || f.clave; else f.nombre = f.clave || "(sin dato)"; }
  return { data: filas };
}

const fmtP2 = v => v == null || !isFinite(v) ? "" : (v*100).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}) + " %";
function tabSeguimiento(box){
  kpis(box);
  const act = FILTROS.filter(k => F.f[k] && F.f[k].length);
  box.append(el("p","hint", "Pulsa ⊞ para desplegar un nivel y el nombre de una fila para filtrar todo el panel de control por ella (vuelve a pulsar para quitar el filtro)." + (act.length ? "" : "")));
  const g = el("div","panels");
  for (const P of PANELES) g.append(panel(P));
  box.append(g);
  F._export = () => { const out = {}; for (const P of PANELES){ const d = datosNivel(P.niveles[0]); if (d.data) out[P.titulo] = filasExport(P, d.data); } return out; };
  exportar(box);
}
function columnas(){ const ys = F.anios.slice().sort((x,y) => y-x); const a = ys[0]; return { ys, a, comp: ys.slice(1) }; }
function filasExport(P, filas){
  const { ys, a, comp } = columnas(), m = F.medida;
  const H = [P.titulo, ...ys.map(String)]; for (const b of comp) H.push(`${a} − ${b}`, `% ${a} vs ${b}`);
  return [H, ...filas.map(f => { const r = [f.nombre]; for (const y of ys) r.push(Math.round(val(f.y[y], m) || 0)); for (const b of comp){ const va = val(f.y[a], m) || 0, vb = val(f.y[b], m) || 0; r.push(Math.round(va - vb), vb ? (va - vb)/Math.abs(vb) : ""); } return r; })];
}
function panel(P){
  const card = el("section","dpanel"); const h = el("header",null); h.append(el("span",null,"Seguimiento demanda"), el("b",null,P.titulo)); card.append(h);
  const { ys, a, comp } = columnas(), m = F.medida;
  const wrap = el("div","dwrap"); const t = el("table","dtbl");
  const th = el("thead"), hr = el("tr"); hr.append(el("th","dl",P.titulo));
  for (const y of ys) hr.append(el("th",null,String(y)));
  for (const b of comp){ hr.append(el("th",null,`${a} − ${b}`), el("th",null,`% ${a} vs ${b}`)); }
  th.append(hr); t.append(th);
  const tb = el("tbody");
  const pintar = (dim, extra, nivel, ruta) => {
    const d = datosNivel(dim, extra);
    if (!d.data){ const tr = el("tr"); const td = el("td","dl",d.error ? "No se ha podido calcular" : "Cargando…"); td.style.paddingLeft = (10 + nivel*18) + "px"; td.colSpan = 1 + ys.length + comp.length*2; tr.append(td); tb.append(tr); return; }
    const sig = P.niveles[nivel+1];
    for (const f of d.data){
      const key = P.id + "|" + ruta.concat(f.clave).join("¦"); const abierto = F.abiertos.has(key);
      const tr = el("tr", "n"+nivel); const td = el("td","dl"); td.style.paddingLeft = (8 + nivel*18) + "px";
      if (sig){ const bt = el("button","exp", abierto ? "⊟" : "⊞"); bt.type = "button"; bt.title = abierto ? "Plegar" : "Desplegar"; bt.addEventListener("click", ev => { ev.stopPropagation(); abierto ? F.abiertos.delete(key) : F.abiertos.add(key); render(); }); td.append(bt); }
      else td.append(el("span","exp sp",""));
      const dimF = dim === "mes" ? null : dim === "semana" || dim === "dow" ? null : dim;
      const lab = el(dimF ? "button" : "span", "lab" + (dimF && F.f[dimF] && F.f[dimF].includes(f.clave) ? " on" : ""), f.nombre);
      if (dimF){ lab.type = "button"; lab.title = "Filtrar todo por " + f.nombre; lab.addEventListener("click", () => { const cur = F.f[dimF] || []; F.f[dimF] = cur.includes(f.clave) ? cur.filter(x => x !== f.clave) : [...cur, f.clave]; render(); }); }
      td.append(lab); tr.append(td);
      for (const y of ys) tr.append(el("td",null, fmtE0(val(f.y[y], m))));
      for (const b of comp){ const va = val(f.y[a], m), vb = val(f.y[b], m); const dif = (va || 0) - (vb || 0); const pc = vb ? dif / Math.abs(vb) : null;
        tr.append(el("td", dif < 0 ? "neg" : "", fmtE0(dif)), el("td", "pc " + (pc == null ? "" : pc < 0 ? "neg" : "pos"), vb ? fmtP2(pc) : (va ? "nuevo" : ""))); }
      tb.append(tr);
      if (abierto && sig){ const ex = Object.assign({}, extra); const fk = dim === "mes" ? "meses" : dim === "semana" ? "semanas" : dim; ex[fk] = [dim === "mes" || dim === "semana" ? +f.clave : f.clave]; pintar(sig, ex, nivel+1, ruta.concat(f.clave)); }
    }
  };
  pintar(P.niveles[0], {}, 0, []);
  t.append(tb);
  // total
  const e = cached("serie|anio|"+JSON.stringify(params()), () => rpc("demanda_serie", { p: params(), gran:"anio" }));
  if (e.data){ const by = Object.fromEntries(e.data.map(r => [r.anio, num(r)])); const tf = el("tfoot"), fr = el("tr"); fr.append(el("td","dl","Total"));
    for (const y of ys) fr.append(el("td",null,fmtE0(val(by[y], m))));
    for (const b of comp){ const va = val(by[a], m), vb = val(by[b], m); const dif = (va||0) - (vb||0); fr.append(el("td", dif < 0 ? "neg" : "", fmtE0(dif)), el("td","pc " + (dif < 0 ? "neg" : "pos"), vb ? fmtP2(dif/Math.abs(vb)) : "")); }
    tf.append(fr); t.append(tf); }
  wrap.append(t); card.append(wrap);
  return card;
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
