// APP B10 · Personas: costes de personal (nómina + ETT) y ficha de personas
// Datos en el esquema «rrhh» de Supabase (migración 19). Permiso del módulo: «rrhh».
import { sb, render, cabecera, nivel } from "../app.js";
import { el, toast, sheet, saveXlsx, stamp } from "../util.js";

const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const COL = { ord:"#7A8C99", ind:"#C2362B", ext:"#B9A27A", ett:"#0F8A86" };
const PALETA = ["#2A2927","#B9A27A","#7A8C99","#5F7F5A","#C2362B","#0F8A86","#8E6C8A","#D08C2E","#4E79A7","#9C755F","#76B7B2","#59A14F"];
const CLASIF = ["M.O.D","M.O.I","M.O.E"];
const VINCULOS = ["Nómina","ETT","Externo"];
const CONTRATOS = ["Indefinido","Temporal","Fijo discontinuo","Prácticas","Formación","Puesta a disposición (ETT)"];
const MOTIVOS = ["Despido","Baja voluntaria","Fin de contrato","Jubilación","Fin puesta a disposición","Baja (pendiente motivo)","Otros"];
const OBLIG = [["clasificacion","Clasificación"],["departamento","Departamento"],["tipo_contrato","Tipo de contrato"],["fecha_alta","Fecha de alta"]];

const R = { tab:"resumen", data:null, loading:false, anio:null, agr:"departamento", repartirEtt:false, indem:true, abiertos:new Set(),
  f:{ estado:"activos", vinculo:"", q:"", incompletas:false }, fe:{ q:"", dep:"" }, msg:null };
let charts = [];

const sch = () => sb.schema("rrhh");
const eur = v => { if (v == null || !isFinite(v)) return ""; const n = Math.round(v); if (!n) return "0"; return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); };
const pctf = v => v == null || !isFinite(v) ? "" : (v*100).toLocaleString("es-ES",{maximumFractionDigits:1}) + " %";
const varf = v => v == null || !isFinite(v) ? "" : (v > 0 ? "+" : "") + (v*100).toLocaleString("es-ES",{maximumFractionDigits:1}) + " %";
const fec = k => k ? `${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(0,4)}` : "";
const mesLab = k => `${MES[+k.slice(5,7)-1]} ${k.slice(2,4)}`;
const hoyKey = (() => { const d = new Date(), p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
const finMes = k => { const d = new Date(Date.UTC(+k.slice(0,4), +k.slice(5,7), 0)); return d.toISOString().slice(0,10); };
const sum = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
const puede = () => nivel("rrhh") === "editar";

async function todo(q){ const out = []; for (let i = 0; ; i += 1000){ const { data, error } = await q().range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; }

async function cargar(){
  R.loading = true;
  try{
    const [personas, nomina, deps, periodos, act] = await Promise.all([
      todo(() => sch().from("personas").select("*").order("codigo")),
      todo(() => sch().from("nomina_mensual").select("periodo,codigo,bruto,ss_empresa,coste_empresa,indemnizacion,it_enfermedad,vacaciones_finiquito,paga_extra,coste_total,coste_ordinario,horas_presencia,base_cc,ss_trabajador,irpf,otras_deducciones,liquido,paga_extra_irpf,paga_extra_liquido,prorrata_extra").order("periodo")),
      sch().from("departamentos").select("*").order("orden").then(r => { if (r.error) throw r.error; return r.data; }),
      todo(() => sch().from("ett_periodos").select("*").order("fecha_inicio")),
      todo(() => sch().from("v_ett_activos_mes").select("*")),
    ]);
    let fact = [];
    try { fact = await todo(() => sch().from("v_ett_facturas").select("*").order("fecha_factura")); }
    catch(e){ console.warn("Sin facturas ETT", e); }
    const num = r => { for (const k of ["bruto","ss_empresa","coste_empresa","indemnizacion","it_enfermedad","vacaciones_finiquito","paga_extra","coste_total","coste_ordinario","horas_presencia","base_cc","ss_trabajador","irpf","otras_deducciones","liquido","paga_extra_irpf","paga_extra_liquido","prorrata_extra"]) r[k] = +r[k] || 0; return r; };
    R.data = { personas, nomina: nomina.map(num), deps, periodos, act, fact: fact.map(f => ({ ...f, base_imponible:+f.base_imponible || 0, importe_total:+f.importe_total || 0 })) };
    R.data.porCodigo = new Map(personas.map(p => [p.codigo, p]));
    const anios = [...new Set(nomina.map(n => +n.periodo.slice(0,4)))].sort();
    R.data.anios = anios; if (!R.anio || !anios.includes(R.anio)) R.anio = anios[anios.length - 1] || new Date().getFullYear();
  } catch(e){ console.error(e); toast("No se han podido cargar los datos de personas."); R.data = { personas:[], nomina:[], deps:[], periodos:[], act:[], fact:[], porCodigo:new Map(), anios:[] }; }
  R.loading = false; render();
}
const recargar = () => { R.data = null; render(); };

// ---------- cálculos ----------
function meses(){ const D = R.data; const s = new Set(D.nomina.filter(n => +n.periodo.slice(0,4) === R.anio).map(n => n.periodo)); return [...s].sort(); }
const pendientes = p => OBLIG.filter(([k]) => !p[k]).map(([,l]) => l).concat(p.tipo_vinculo === "ETT" && !p.empresa_ett ? ["Empresa ETT"] : []);
const activa = p => !p.fecha_baja || p.fecha_baja >= hoyKey;

// coste ETT del mes (base imponible) por empresa
function ettMes(m){ const o = {}; for (const f of R.data.fact) if (f.periodo === m) o[f.empresa_ett] = (o[f.empresa_ett] || 0) + f.base_imponible; return o; }
// reparto estimado del coste ETT de cada mes entre sus personas, por días en el mes y empresa
function repartoEtt(m){
  const fac = ettMes(m), act = R.data.act.filter(a => a.periodo === m), out = new Map();
  for (const emp of Object.keys(fac)){
    const A = act.filter(a => a.empresa_ett === emp), dias = sum(A, a => a.dias);
    if (dias) for (const a of A) out.set(a.codigo, (out.get(a.codigo) || 0) + fac[emp] * a.dias / dias);
  }
  return out;
}
function grupoDe(p){ if (!p) return "Sin asignar"; const v = R.agr === "departamento" ? p.departamento : R.agr === "clasificacion" ? p.clasificacion : R.agr === "area" ? ((R.data.deps.find(d => d.nombre === p.departamento) || {}).area) : R.agr === "grupo" ? p.grupo_profesional : p.tipo_vinculo; return v || "Sin asignar"; }

// ---------- pantalla ----------
export function renderRrhh(app){
  document.title = "Personas: costes de personal";
  for (const c of charts) try { c.destroy(); } catch(e){} charts = [];
  cabecera(app, "Costes de personal", "Coste de empresa por mes, sección y persona (nómina y ETT) y ficha de cada persona.", { txt:"Personas", href:"#personas" }, "rrhh");
  const box = el("div","pad rrhh"); box.style.paddingBottom = "32px"; app.append(box);
  if (!R.data){ if (!R.loading) cargar(); box.append(el("div","card empty","Cargando datos…")); return; }

  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  const inc = R.data.personas.filter(p => activa(p) && pendientes(p).length).length;
  for (const [k,t] of [["resumen","Resumen"],["seccion","Por sección"],["empleado","Por empleado"],["personas", "Ficha de personas" + (inc ? ` (${inc} incompletas)` : "")],["ett","ETT"]]){
    const a = el("a",null,t); a.href = "#personas-costes"; if (R.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); R.tab = k; render(); }); nav.append(a); }
  const acc = el("span"); acc.style.marginLeft = "auto"; acc.style.display = "flex"; acc.style.gap = "8px";
  const ex = el("button","btn small","Exportar a Excel"); ex.addEventListener("click", exportar); acc.append(ex);
  if (puede()){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xls"; inp.hidden = true; inp.multiple = true;
    const up = el("button","btn primary small","Cargar nómina (imputación de costes)"); up.title = "Fichero mensual «Imputación de costes» (o el de paga extra)"; up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async () => { for (const f of inp.files) await cargarNomina(f); inp.value = ""; });
    acc.append(up, inp);
  }
  nav.append(acc); box.append(nav);
  if (!R.msg) R.msg = el("p","hint upmsg"); box.append(R.msg);

  if (R.data.anios.length > 1){
    const c = el("div","ctrl"); const s = el("div","seg");
    for (const y of R.data.anios){ const b = el("button",null,String(y)); b.type = "button"; b.setAttribute("aria-pressed", String(y === R.anio)); b.addEventListener("click", () => { R.anio = y; render(); }); s.append(b); }
    const d = el("div","fld"); d.append(el("span",null,"Año"), s); c.append(d); box.append(c);
  }
  if (!R.data.nomina.length && R.tab !== "personas"){ box.append(el("div","card empty","Todavía no hay nóminas cargadas. Usa «Cargar nómina» con el fichero de imputación de costes del mes.")); return; }
  if (R.tab === "resumen") tabResumen(box);
  else if (R.tab === "seccion") tabSeccion(box);
  else if (R.tab === "empleado") tabEmpleado(box);
  else if (R.tab === "personas") tabPersonas(box);
  else tabEtt(box);
}

// ---------- Resumen ----------
// Coste devengado de una nómina: coste de empresa ordinario + prorrata de la paga extra de verano
// (la de Navidad ya va prorrateada en cada nómina; la de junio se reparte con la «prorrata pagas extras» de cada mes).
// Las indemnizaciones se incluyen o no según el selector.
const indemn = n => R.indem ? n.indemnizacion : 0;
const costeDev = n => n.coste_empresa - n.indemnizacion + indemn(n) + n.prorrata_extra;
const ORDEN_CLAS = ["M.O.E","M.O.I","M.O.D","ETT"];
const clasDe = p => !p ? "Sin clasificar" : p.tipo_vinculo === "ETT" ? "ETT" : (p.clasificacion || "Sin clasificar");
function serieMensual(){
  const M = meses(), D = R.data;
  return M.map(m => {
    const N = D.nomina.filter(n => n.periodo === m), ett = sum(Object.values(ettMes(m)), x => x);
    const ord = sum(N, n => n.coste_empresa - n.indemnizacion), ind = sum(N, n => indemn(n)), ext = sum(N, n => n.prorrata_extra);
    const pers = new Set(N.filter(n => n.bruto || n.coste_empresa).map(n => n.codigo)).size;
    const ettN = new Set(D.act.filter(a => a.periodo === m).map(a => a.codigo)).size;
    return { m, ord, ind, ext, nom: ord + ind + ext, ett, tot: ord + ind + ext + ett, pers, ettN };
  });
}
function ctrlIndem(box){
  const c = el("div","ctrl"); const s = el("div","seg");
  for (const [k,l] of [[true,"Incluir"],[false,"No incluir"]]){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(R.indem === k)); b.addEventListener("click", () => { R.indem = k; render(); }); s.append(b); }
  const d = el("div","fld"); d.append(el("span",null,"Indemnizaciones"), s); c.append(d);
  c.append(el("span","hint","La paga extra de junio se reparte mes a mes (prorrata de la nómina), igual que la de Navidad."));
  box.append(c);
}
function tablaMeses(box, titulo, filas, M){
  if (titulo) box.append(el("h3",null,titulo));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"Concepto")); for (const m of M) hr.append(el("th","n",mesLab(m))); hr.append(el("th","n","Total")); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const f of filas){ const tr = el("tr", f.b ? "wk" : null); tr.append(el("td",null,f.lab)); for (const v of f.v) tr.append(el("td","n", f.n ? String(Math.round(v || 0)) : eur(v || 0)));
    tr.append(el("td","n", f.n ? "" : eur(sum(f.v, x => x)))); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
}
function tabResumen(box){
  ctrlIndem(box);
  const S = serieMensual(); if (!S.length){ box.append(el("div","card empty","No hay datos de este año.")); return; }
  const M = S.map(s => s.m);
  const filas = [ { lab:"Personas con nómina", v:S.map(s => s.pers), n:true }, { lab:"Nómina ordinaria", v:S.map(s => s.ord) } ];
  if (R.indem) filas.push({ lab:"Indemnizaciones", v:S.map(s => s.ind) });
  filas.push({ lab:"Paga extra de verano (prorrata)", v:S.map(s => s.ext) }, { lab:"Total nómina", v:S.map(s => s.nom), b:true },
    { lab:"ETT (base imponible)", v:S.map(s => s.ett) }, { lab:"Coste total personal", v:S.map(s => s.tot), b:true });
  tablaMeses(box, null, filas, M);
  // por clasificación: M.O.E, M.O.I, M.O.D y ETT
  const D = R.data, G = {};
  for (const n of D.nomina) if (M.includes(n.periodo)){ const g = clasDe(D.porCodigo.get(n.codigo)); (G[g] = G[g] || {})[n.periodo] = (G[g][n.periodo] || 0) + costeDev(n); }
  G.ETT = Object.fromEntries(M.map(m => [m, sum(Object.values(ettMes(m)), x => x)]));
  const grupos = [...ORDEN_CLAS, ...Object.keys(G).filter(g => !ORDEN_CLAS.includes(g))].filter(g => G[g]);
  const F2 = grupos.map(g => ({ lab:g, v:M.map(m => G[g][m] || 0) }));
  F2.push({ lab:"Coste total personal", v:M.map((m,i) => sum(F2, f => f.v[i])), b:true });
  tablaMeses(box, "Coste por clasificación", F2, M);
  const P2 = grupos.map(g => ({ lab:g, n:true, v:M.map(m => g === "ETT" ? new Set(D.act.filter(a => a.periodo === m).map(a => a.codigo)).size
    : new Set(D.nomina.filter(n => n.periodo === m && (n.bruto || n.coste_empresa) && clasDe(D.porCodigo.get(n.codigo)) === g).map(n => n.codigo)).size) }));
  tablaMeses(box, "Personas por clasificación", P2, M);
  const avisos = avisosEtt(S); if (avisos.length){ const c = el("div","card"); c.append(el("h3",null,"A revisar")); const ul = el("ul"); for (const a of avisos) ul.append(el("li",null,a)); c.append(ul); box.append(c); }
  box.append(el("p","hint","Nómina ordinaria = coste de empresa del mes sin indemnizaciones. Paga extra de verano = la prorrata mensual que calcula la nómina (la paga se cobra en junio pero se devenga todo el año; su Seguridad Social ya va en la cotización de cada mes). ETT = facturas de las ETT en Tesorería, por mes de la factura y sin IVA. Personas ETT según los contratos de cada ficha."));
}
function avisosEtt(S){
  const out = [], emp = [...new Set(R.data.fact.map(f => f.empresa_ett))];
  for (const e of emp){ const sin = S.filter(s => !R.data.fact.some(f => f.empresa_ett === e && f.periodo === s.m) && R.data.act.some(a => a.periodo === s.m && a.empresa_ett === e)); if (sin.length) out.push(`${e}: sin factura en Tesorería en ${sin.map(s => mesLab(s.m)).join(", ")}, con personas en activo según contratos.`); }
  const alto = S.filter(s => s.ettD && s.ett / s.ettD > 150); if (alto.length) out.push(`Coste ETT por día-persona alto en ${alto.map(s => `${mesLab(s.m)} (${Math.round(s.ett / s.ettD)} €)`).join(", ")}: probablemente faltan personas de ETT o periodos en la ficha.`);
  const sinBaja = R.data.personas.filter(p => p.tipo_vinculo === "Nómina" && activa(p) && ultimoMes(p.codigo) && ultimoMes(p.codigo) < (S[S.length-1] || {}).m);
  if (sinBaja.length) out.push(`${sinBaja.length} personas sin nómina en ${mesLab(S[S.length-1].m)} y sin fecha de baja: ${sinBaja.map(p => p.nombre).join(", ")}.`);
  return out;
}
const ultimoMes = c => { let u = null; for (const n of R.data.nomina) if (n.codigo === c && (n.bruto || n.coste_total) && (!u || n.periodo > u)) u = n.periodo; return u; };

// ---------- Por sección: clasificación › departamento › puesto › persona ----------
function tabSeccion(box){
  ctrlIndem(box);
  const M = meses(), D = R.data, hojas = [];
  const by = new Map(); for (const n of D.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = (x[n.periodo] || 0) + costeDev(n); by.set(n.codigo, x); }
  const ruta = p => [clasDe(p), (p && p.departamento) || "Sin departamento", (p && (p.puesto || p.categoria)) || "Sin puesto"];
  for (const [cod, x] of by){ const p = D.porCodigo.get(cod); hojas.push({ ruta:ruta(p), nombre:(p ? p.nombre : cod), cod, v:x }); }
  // ETT: coste de las facturas repartido entre sus personas por días de contrato en el mes (estimación)
  const ettPers = new Map(); let sinAsig = {};
  for (const m of M){ const rp = repartoEtt(m), fac = sum(Object.values(ettMes(m)), x => x); let asig = 0;
    for (const [cod, v] of rp){ const x = ettPers.get(cod) || {}; x[m] = (x[m] || 0) + v; ettPers.set(cod, x); asig += v; }
    if (Math.abs(fac - asig) > 0.5) sinAsig[m] = fac - asig; }
  for (const [cod, x] of ettPers){ const p = D.porCodigo.get(cod); hojas.push({ ruta:ruta(p), nombre:p.nombre, cod, v:x, est:true }); }
  if (Object.keys(sinAsig).length) hojas.push({ ruta:["ETT","Sin asignar","—"], nombre:"Facturas ETT sin personas en contrato ese mes", v:sinAsig, est:true });
  // árbol
  const raiz = { hijos:new Map(), v:{} };
  for (const h of hojas){ let nodo = raiz; const add = n => { for (const m of M) n.v[m] = (n.v[m] || 0) + (h.v[m] || 0); };
    add(nodo); h.ruta.forEach((k, i) => { if (!nodo.hijos.has(k)) nodo.hijos.set(k, { k, nivel:i, id:h.ruta.slice(0,i+1).join("›"), hijos:new Map(), v:{}, pers:[] }); nodo = nodo.hijos.get(k); add(nodo); }); nodo.pers.push(h); }
  const tot = n => sum(M, m => n.v[m]);
  const ordenar = (arr, nivel) => arr.sort((a,b) => nivel === 0 ? ((ORDEN_CLAS.indexOf(a.k) + 99) % 99) - ((ORDEN_CLAS.indexOf(b.k) + 99) % 99) : tot(b) - tot(a));
  const c = el("div","ctrl"); const ab = el("button","btn small","Desplegar todo"); ab.addEventListener("click", () => { const marca = n => { for (const h of n.hijos.values()){ R.abiertos.add(h.id); marca(h); } }; marca(raiz); render(); });
  const cb = el("button","btn small","Plegar todo"); cb.addEventListener("click", () => { R.abiertos.clear(); render(); }); c.append(ab, cb); box.append(c);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"Clasificación › departamento › puesto › persona")); for (const m of M) hr.append(el("th","n",mesLab(m))); for (const h of ["Total","Media mes","% s/total"]) hr.append(el("th","n",h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody"), TT = tot(raiz);
  const fila = (lab, v, nivel, opts) => { const tr = el("tr", opts.cls || null); const td = el("td"); td.style.paddingLeft = (10 + nivel * 18) + "px"; td.style.whiteSpace = "nowrap";
    if (opts.toggle){ td.append(el("span","chev", opts.open ? "▾ " : "▸ ")); tr.style.cursor = "pointer"; tr.addEventListener("click", opts.toggle); }
    if (opts.bold) td.append(el("b",null,lab)); else td.append(lab); if (opts.est) td.append(el("small",null," (estimado)")); tr.append(td);
    for (const m of M) tr.append(el("td","n",eur(v[m] || 0))); const tt = sum(M, m => v[m]); tr.append(el("td","n",eur(tt)), el("td","n",eur(tt / (M.length || 1))), el("td","n",pctf(TT ? tt / TT : null)));
    if (opts.click) { tr.style.cursor = "pointer"; tr.title = "Abrir la ficha"; tr.addEventListener("click", opts.click); } tb.append(tr); };
  const pinta = (nodo) => { for (const h of ordenar([...nodo.hijos.values()], nodo.nivel == null ? 0 : nodo.nivel + 1)){
      const open = R.abiertos.has(h.id);
      fila(h.k, h.v, h.nivel, { bold: h.nivel === 0, cls: h.nivel === 0 ? "wk" : null, open, toggle: () => { open ? R.abiertos.delete(h.id) : R.abiertos.add(h.id); render(); } });
      if (!open) continue;
      if (h.hijos.size) pinta(h);
      else for (const p of h.pers.sort((a,b) => sum(M, m => b.v[m]) - sum(M, m => a.v[m]))) fila(p.nombre, p.v, 3, { est:p.est, click: p.cod && D.porCodigo.get(p.cod) ? () => ficha(D.porCodigo.get(p.cod)) : null });
    } };
  pinta(raiz);
  fila("Coste total personal", raiz.v, 0, { bold:true, cls:"wk" });
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa una fila para desplegarla; en el último nivel, pulsa una persona para abrir su ficha. Coste = nómina de empresa con la paga extra de verano prorrateada" + (R.indem ? " e indemnizaciones" : ", sin indemnizaciones") + ". La ETT se reparte entre sus personas según los días de contrato de cada mes: es una estimación. «Sin departamento» / «Sin puesto» = datos pendientes en la ficha."));
}

// ---------- Por empleado ----------
function tabEmpleado(box){
  ctrlIndem(box);
  const M = meses(), D = R.data;
  const c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre o código"; q.value = R.fe.q; q.dataset.k = "rr-eq"; q.addEventListener("input", () => { R.fe.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const dd = el("div","fld"); const s = el("select"); s.append(new Option("Todos","")); for (const g of [...new Set(D.personas.map(p => p.departamento || "Sin asignar"))].sort()) s.append(new Option(g, g)); s.value = R.fe.dep; s.addEventListener("change", () => { R.fe.dep = s.value; render(); }); dd.append(el("span",null,"Departamento"), s); c.append(dd);
  box.append(c);
  const by = new Map(); for (const n of D.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = n; by.set(n.codigo, x); }
  const qq = R.fe.q.trim().toLowerCase();
  const L = [...by.entries()].map(([cod, x]) => ({ cod, x, p: D.porCodigo.get(cod) || { codigo:cod, nombre:"(sin ficha)" } }))
    .filter(r => (!qq || `${r.p.nombre} ${r.cod}`.toLowerCase().includes(qq)) && (!R.fe.dep || (r.p.departamento || "Sin asignar") === R.fe.dep))
    .map(r => ({ ...r, tot: sum(M, m => r.x[m] ? costeDev(r.x[m]) : 0), ord: sum(M, m => r.x[m] ? r.x[m].coste_empresa - r.x[m].indemnizacion + r.x[m].prorrata_extra : 0), nm: M.filter(m => r.x[m] && (r.x[m].bruto || r.x[m].coste_total)).length }))
    .sort((a,b) => b.tot - a.tot);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr");
  for (const h of ["Código","Nombre","Departamento"]) hr.append(el("th",null,h)); for (const m of M) hr.append(el("th","n",mesLab(m))); for (const h of ["Total","Ordinario medio/mes","Meses"]) hr.append(el("th","n",h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const r of L){ const tr = el("tr"); tr.style.cursor = "pointer"; tr.title = "Abrir la ficha"; tr.addEventListener("click", () => { if (R.data.porCodigo.get(r.cod)) ficha(R.data.porCodigo.get(r.cod)); });
    tr.append(el("td",null,r.cod), el("td",null,r.p.nombre), el("td",null,r.p.departamento || "—"));
    for (const m of M){ const n = r.x[m]; const td = el("td","n", n ? eur(costeDev(n)) : ""); if (n && R.indem && n.indemnizacion){ td.title = `Incluye indemnización ${eur(n.indemnizacion)} €`; td.style.fontWeight = "700"; } tr.append(td); }
    tr.append(el("td","n",eur(r.tot)), el("td","n",eur(r.nm ? r.ord / r.nm : 0)), el("td","n",String(r.nm))); tb.append(tr); }
  const tr = el("tr","wk"); tr.append(el("td"), el("td",null,`Total (${L.length} personas)`), el("td")); for (const m of M) tr.append(el("td","n",eur(sum(L, r => r.x[m] ? costeDev(r.x[m]) : 0)))); tr.append(el("td","n",eur(sum(L, r => r.tot))), el("td"), el("td")); tb.append(tr);
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Coste de empresa de cada mes con la paga extra de verano prorrateada" + (R.indem ? "; en negrita, los meses con indemnización." : ", sin indemnizaciones.") + " Pulsa una fila para abrir la ficha."));
}

// ---------- Ficha de personas ----------
function tabPersonas(box){
  const D = R.data, F = R.f;
  const c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre, código, puesto"; q.value = F.q; q.dataset.k = "rr-pq"; q.addEventListener("input", () => { F.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const seg = (lab, key, opts) => { const s = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(F[key] === k)); b.addEventListener("click", () => { F[key] = k; render(); }); s.append(b); } const d = el("div","fld"); d.append(el("span",null,lab), s); return d; };
  c.append(seg("Situación","estado",[["activos","Activas"],["bajas","Bajas"],["todos","Todas"]]), seg("Vínculo","vinculo",[["","Todos"],["Nómina","Nómina"],["ETT","ETT"],["Externo","Externo"]]));
  const lb = el("label","chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = F.incompletas; cb.addEventListener("change", () => { F.incompletas = cb.checked; render(); }); lb.append(cb, " Solo fichas incompletas"); c.append(lb);
  if (puede()){ const a = el("div","acc"); const nb = el("button","btn primary","Nueva persona"); nb.addEventListener("click", () => ficha(null)); a.append(nb); c.append(a); }
  box.append(c);
  const qq = F.q.trim().toLowerCase();
  const L = D.personas.filter(p => (F.estado === "todos" || (F.estado === "activos" ? activa(p) : !activa(p))) && (!F.vinculo || p.tipo_vinculo === F.vinculo)
    && (!F.incompletas || pendientes(p).length) && (!qq || `${p.nombre} ${p.codigo} ${p.puesto || ""} ${p.categoria || ""} ${p.departamento || ""}`.toLowerCase().includes(qq)))
    .sort((a,b) => (a.tipo_vinculo > b.tipo_vinculo ? 1 : a.tipo_vinculo < b.tipo_vinculo ? -1 : a.codigo < b.codigo ? -1 : 1));
  const k = el("div","kpis"); const act = D.personas.filter(activa); const kp = (t, v, s) => { const d = el("div","kpi"); d.append(el("small",null,t), el("b",null,v)); if (s) d.append(el("span","delta",s)); return d; };
  k.append(kp("Personas activas", String(act.length), `${act.filter(p => p.tipo_vinculo === "Nómina").length} en nómina · ${act.filter(p => p.tipo_vinculo === "ETT").length} de ETT`),
    kp("Fichas incompletas", String(act.filter(p => pendientes(p).length).length), "faltan datos obligatorios"),
    kp("% temporal", pctf(act.length ? act.filter(p => p.tipo_vinculo === "ETT" || p.tipo_contrato === "Temporal").length / act.length : null), "ETT + contrato temporal"));
  box.append(k);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Código","Nombre","Vínculo","Clasif.","Grupo prof.","Departamento","Puesto / categoría","Contrato","Alta","Baja","Pendiente"]) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const p of L){ const tr = el("tr", activa(p) ? null : "paid"); tr.style.cursor = "pointer"; tr.addEventListener("click", () => ficha(p));
    const pend = pendientes(p); const tp = el("td"); for (const x of pend) { tp.append(el("span","tag warn",x), " "); }
    tr.append(el("td",null,p.codigo), el("td",null,p.nombre), el("td",null,p.tipo_vinculo + (p.empresa_ett ? " · " + p.empresa_ett : "")), el("td",null,p.clasificacion || ""), el("td",null,p.grupo_profesional || ""), el("td",null,p.departamento || ""), el("td",null,p.puesto || p.categoria || ""), el("td",null,p.tipo_contrato || ""), el("td",null,fec(p.fecha_alta)), el("td",null,fec(p.fecha_baja) + (p.motivo_baja ? ` (${p.motivo_baja})` : "")), tp);
    tb.append(tr); }
  if (!L.length){ const tr = el("tr"); const td = el("td","empty","No hay personas con estos filtros."); td.colSpan = 11; tr.append(td); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa una persona para ver o editar su ficha. Para guardar basta con el nombre y el código (y la empresa si es de ETT); el resto se puede completar después. Las fichas a las que les falten clasificación, departamento, contrato o fecha de alta salen como incompletas."));
}

// Diálogo de ficha (alta, edición, baja y periodos ETT)
async function ficha(p){
  const nueva = !p, ed = puede(), D = R.data;
  let dlg = document.getElementById("dlgPersona"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgPersona"; dlg.style.maxWidth = "680px"; document.body.append(dlg);
  const f = el("form"); f.method = "dialog"; f.noValidate = true; dlg.append(f);
  f.append(el("h2",null, nueva ? "Nueva persona" : p.nombre), el("p","sub", nueva ? "Puedes guardar con el nombre y el código y completar el resto después. Los campos con * hacen falta para que la ficha esté completa." : `${p.codigo} · ${p.tipo_vinculo}${p.empresa_ett ? " · " + p.empresa_ett : ""}`));
  const v = Object.assign({ tipo_vinculo:"Nómina", empleador:"B10" }, p || {});
  const I = {};
  const campo = (k, lab, tipo, opts, req) => { const d = el("div","f"); d.dataset.f = k; const l = el("label",null,lab + (req ? " *" : "")); let i;
    if (tipo === "select"){ i = el("select"); i.append(new Option("—","")); for (const o of opts) i.append(new Option(o, o)); if (k === "departamento" && ed) i.append(new Option("+ Nuevo departamento…","__nuevo")); }
    else if (tipo === "area"){ i = el("textarea"); i.rows = 2; i.style.cssText = "border:1px solid var(--line-strong);border-radius:6px;padding:7px 10px;background:var(--surface-2);font:inherit;color:inherit"; }
    else { i = el("input"); i.type = tipo || "text"; i.autocomplete = "off"; }
    i.value = v[k] || ""; i.disabled = !ed; I[k] = i; d.append(l, i, el("span","hint","")); return d; };
  const fila = (...xs) => { const g = el("div","f2"); g.append(...xs); return g; };
  f.append(fila(campo("nombre","Nombre y apellidos","text",null,true), campo("tipo_vinculo","Vínculo","select",VINCULOS,true)));
  const blkEtt = fila(campo("empresa_ett","Empresa ETT","select",[...new Set(["Noawork","Interim", ...D.personas.map(x => x.empresa_ett).filter(Boolean)])],true), campo("codigo","Código","text",null,false));
  const blkNom = fila(campo("codigo","Código de nómina","text",null,true), campo("empleador","Empleador","text",null,false));
  f.append(blkEtt, blkNom);
  f.append(fila(campo("clasificacion","Clasificación","select",CLASIF,true), campo("departamento","Departamento / sección","select",D.deps.filter(d => d.activo !== false).map(d => d.nombre),true)));
  f.append(fila(campo("grupo_profesional","Grupo profesional","text"), campo("puesto","Puesto","text")));
  f.append(campo("categoria","Categoría","text"));
  { const dl = el("datalist"); dl.id = "dlGrupos"; for (const g of [...new Set(D.personas.map(x => x.grupo_profesional).filter(Boolean))].sort()) dl.append(new Option(g)); f.append(dl); I.grupo_profesional.setAttribute("list","dlGrupos"); }
  f.append(fila(campo("tipo_contrato","Tipo de contrato","select",CONTRATOS,true), campo("fecha_alta","Fecha de alta","date",null,true)));
  let finPrev = null;
  if (nueva){ const d = el("div","f"); d.dataset.f = "fin"; finPrev = el("input"); finPrev.type = "date"; d.append(el("label",null,"Fin previsto del contrato (ETT)"), finPrev, el("span","hint","")); blkEtt.append(d); }
  f.append(fila(campo("fecha_baja","Fecha de baja","date"), campo("motivo_baja","Motivo de la baja","select",MOTIVOS)));
  f.append(campo("observaciones","Observaciones","area"));
  // código de nómina vs ETT
  const syncV = () => { const ett = I.tipo_vinculo.value === "ETT"; blkEtt.hidden = !ett; blkNom.hidden = ett; if (ett && nueva && !I.codigo.value){ const sc = sigCodigoEtt(); for (const x of f.querySelectorAll('[data-f="codigo"] input')) x.value = sc; } if (ett && !I.tipo_contrato.value) I.tipo_contrato.value = "Puesta a disposición (ETT)"; if (!ett && nueva && (!I.tipo_contrato.value || I.tipo_contrato.value === "Puesta a disposición (ETT)")) I.tipo_contrato.value = "Indefinido"; };
  // los dos bloques tienen un input «codigo»: dejar uno solo
  const cods = f.querySelectorAll('[data-f="codigo"] input'); I.codigo = cods[1]; cods[0].addEventListener("input", () => { I.codigo.value = cods[0].value; }); I.codigo.addEventListener("input", () => { cods[0].value = I.codigo.value; }); cods[0].value = I.codigo.value; cods[0].disabled = !ed || !nueva; I.codigo.disabled = !ed || !nueva;
  I.tipo_vinculo.addEventListener("change", syncV); syncV(); if (!nueva) I.tipo_vinculo.disabled = true;
  I.departamento.addEventListener("change", async () => { if (I.departamento.value !== "__nuevo") return; const n = (prompt("Nombre del nuevo departamento o sección:") || "").trim(); if (!n){ I.departamento.value = v.departamento || ""; return; }
    const area = (prompt("Área (Producción, Logística, Oficina, Comercial, Dirección…):", "Producción") || "").trim() || null;
    const r = await sch().from("departamentos").insert({ nombre:n, area, orden:900 }); if (r.error && r.error.code !== "23505"){ toast("No se ha podido crear el departamento"); return; }
    D.deps.push({ nombre:n, area, orden:900, activo:true }); const o = new Option(n, n); I.departamento.insertBefore(o, I.departamento.lastChild); I.departamento.value = n; });

  // periodos ETT y movimientos
  if (!nueva){
    if (p.tipo_vinculo === "ETT"){
      const per = D.periodos.filter(x => x.persona_id === p.id);
      const d = el("div","card"); d.style.margin = "4px 0 12px"; d.append(el("b",null,"Contratos de puesta a disposición"));
      const ul = el("ul"); for (const x of per) ul.append(el("li",null,`${fec(x.fecha_inicio)} – ${x.fecha_fin ? fec(x.fecha_fin) : "sin fin"} · ${x.empresa_ett}${x.comentario ? " · " + x.comentario : ""}`)); d.append(ul);
      if (ed){ const g = el("div","f2"); const a = el("input"); a.type = "date"; const b = el("input"); b.type = "date"; const ad = el("button","btn small","Añadir contrato o prórroga"); ad.type = "button";
        ad.addEventListener("click", async () => { if (!a.value){ a.focus(); return; } const r = await sch().from("ett_periodos").insert({ persona_id:p.id, empresa_ett:p.empresa_ett, fecha_inicio:a.value, fecha_fin:b.value || null }); if (r.error){ toast("No se ha podido guardar el contrato"); return; }
          if (I.fecha_baja.value && b.value && b.value > I.fecha_baja.value){ await sch().from("personas").update({ fecha_baja:null, motivo_baja:null }).eq("id", p.id); }
          toast("Contrato añadido"); dlg.close(); recargar(); });
        const da = el("div","f"); da.append(el("label",null,"Inicio"), a); const db = el("div","f"); db.append(el("label",null,"Fin"), b); g.append(da, db); d.append(g, ad); }
      f.append(d);
    }
    const mv = await sch().from("movimientos").select("fecha,tipo,valor_anterior,valor_nuevo").eq("persona_id", p.id).order("fecha");
    if (mv.data && mv.data.length){ const det = el("details"); det.style.margin = "0 0 10px"; det.append(el("summary",null,`Historial (${mv.data.length})`)); const ul = el("ul"); for (const m of mv.data) ul.append(el("li",null,`${fec(m.fecha)} · ${m.tipo}${m.valor_anterior ? ": " + m.valor_anterior + " →" : ""}${m.valor_nuevo ? " " + m.valor_nuevo : ""}`)); det.append(ul); f.append(det); }
    const rt = retribucion(p.codigo); if (rt) f.append(tarjetaRetribucion(rt));
  }
  const err = el("span","err"); f.append(err);
  const acts = el("div","actions"); const cn = el("button","btn", ed ? "Cancelar" : "Cerrar"); cn.type = "button"; cn.addEventListener("click", () => dlg.close()); acts.append(cn);
  if (ed){ const ok = el("button","btn primary", nueva ? "Dar de alta" : "Guardar"); acts.append(ok); }
  f.append(acts);
  f.addEventListener("submit", async e => { e.preventDefault(); if (!ed) return;
    const val = {}; for (const k of Object.keys(I)) val[k] = (I[k].value || "").trim() || null; if (val.departamento === "__nuevo") val.departamento = null;
    const ett = val.tipo_vinculo === "ETT"; for (const d of f.querySelectorAll(".f")) d.classList.remove("miss");
    const marcar = (ks, txt) => { for (const k of ks){ for (const d of f.querySelectorAll(`[data-f="${k}"]`)){ d.classList.add("miss"); d.querySelector(".hint").textContent = txt; } } };
    // imprescindible para guardar: nombre, vínculo, código y, en ETT, la empresa
    const minimo = ["nombre","tipo_vinculo","codigo"].concat(ett ? ["empresa_ett"] : []).filter(k => !val[k]);
    if (minimo.length){ marcar(minimo, "Necesario para guardar"); err.textContent = "Para guardar hace falta al menos el nombre y el código" + (ett ? " y la empresa ETT." : "."); return; }
    // el resto puede quedar pendiente: se guarda igual y la ficha sale como incompleta
    const pend = ["clasificacion","departamento","tipo_contrato","fecha_alta"].filter(k => !val[k]);
    if (val.fecha_baja && !val.motivo_baja) val.motivo_baja = "Baja (pendiente motivo)";
    if (val.fecha_baja && val.fecha_alta && val.fecha_baja < val.fecha_alta){ err.textContent = "La baja no puede ser anterior al alta."; return; }
    const row = { nombre:val.nombre, tipo_vinculo:val.tipo_vinculo, empleador: ett ? val.empresa_ett : (val.empleador || "B10"), empresa_ett: ett ? val.empresa_ett : null, clasificacion:val.clasificacion, departamento:val.departamento,
      grupo_profesional:val.grupo_profesional, puesto:val.puesto, categoria:val.categoria, tipo_contrato:val.tipo_contrato, fecha_alta:val.fecha_alta, fecha_baja:val.fecha_baja, motivo_baja: val.fecha_baja ? val.motivo_baja : null, observaciones:val.observaciones };
    let r;
    if (nueva){ row.codigo = val.codigo; r = await sch().from("personas").insert(row).select("id").single();
      if (!r.error && ett && val.fecha_alta) await sch().from("ett_periodos").insert({ persona_id:r.data.id, empresa_ett:val.empresa_ett, fecha_inicio:val.fecha_alta, fecha_fin:finPrev.value || null }); }
    else r = await sch().from("personas").update(row).eq("id", p.id);
    if (r.error){ console.error(r.error); err.textContent = r.error.code === "23505" ? "Ya existe una persona con ese código." : "No se ha podido guardar: " + r.error.message; return; }
    const etq = { clasificacion:"clasificación", departamento:"departamento", tipo_contrato:"contrato", fecha_alta:"fecha de alta" };
    toast((nueva ? "Persona dada de alta" : "Ficha guardada") + (pend.length ? ". Pendiente: " + pend.map(k => etq[k]).join(", ") : "")); dlg.close(); recargar();
  });
  dlg.showModal();
}
// Retribución de una persona de nómina: estimación anual con el último mes «limpio» y real del año
const TOPE_BASE = 5101.2;
function retribucion(codigo){
  const N = R.data.nomina.filter(n => n.codigo === codigo && n.base_cc > 0).sort((a,b) => a.periodo < b.periodo ? -1 : 1); if (!N.length) return null;
  const limpio = N.filter(n => n.bruto > 0 && !n.it_enfermedad && !n.indemnizacion && !n.vacaciones_finiquito);
  const ref = (limpio.length ? limpio : N)[(limpio.length ? limpio : N).length - 1];
  const tipoIrpf = ref.bruto ? ref.irpf / ref.bruto : 0;
  const a = { bruto: (ref.bruto + ref.prorrata_extra) * 12, base: ref.base_cc * 12, ssEmp: ref.ss_empresa * 12, ss: ref.ss_trabajador * 12 };
  a.coste = a.bruto + a.ssEmp; a.irpf = a.bruto * tipoIrpf; a.liq = a.bruto - a.ss - a.irpf;
  const anio = ref.periodo.slice(0,4), Y = R.data.nomina.filter(n => n.codigo === codigo && n.periodo.startsWith(anio));
  const real = { bruto: sum(Y, n => n.bruto + n.paga_extra), ssEmp: sum(Y, n => n.ss_empresa), ss: sum(Y, n => n.ss_trabajador), irpf: sum(Y, n => n.irpf + n.paga_extra_irpf),
    liq: sum(Y, n => n.liquido + n.paga_extra_liquido), otras: sum(Y, n => n.otras_deducciones), coste: sum(Y, n => n.coste_total),
    desde: Y.length ? Y[0].periodo : null, hasta: Y.length ? Y[Y.length-1].periodo : null };
  return { ref, a, real, tipoIrpf, tope: ref.base_cc >= TOPE_BASE - 0.5 && (ref.bruto + ref.prorrata_extra) > ref.base_cc + 1, limpio: !!limpio.length };
}
function tarjetaRetribucion(r){
  const c = el("div","card"); c.style.margin = "4px 0 12px";
  c.append(el("b",null,"Retribución"));
  const t = el("table","tbl"); const hr = el("tr"); for (const h of ["","Mensual (12 pagas)","Anual estimado",`Real ${mesLab(r.real.desde)} – ${mesLab(r.real.hasta)}`]) hr.append(el("th", h ? "n" : null, h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody"); const fila = (lab, a, real, b) => { const tr = el("tr", b ? "wk" : null); tr.append(el("td",null,lab), el("td","n",eur(a / 12) + " €"), el("td","n",eur(a) + " €"), el("td","n",real == null ? "" : eur(real) + " €")); tb.append(tr); };
  fila("Bruto", r.a.bruto, r.real.bruto);
  fila("+ Seguridad Social empresa", r.a.ssEmp, r.real.ssEmp);
  fila("Coste empresa", r.a.coste, r.real.coste, true);
  fila("– Seguridad Social trabajador", r.a.ss, r.real.ss);
  fila(`– IRPF (${(r.tipoIrpf*100).toLocaleString("es-ES",{maximumFractionDigits:1})} %)`, r.a.irpf, r.real.irpf);
  if (r.real.otras) fila("– Otras deducciones (embargos, anticipos…)", 0, r.real.otras);
  fila("Líquido", r.a.liq, r.real.liq, true);
  t.append(tb); c.append(t);
  c.append(el("p","hint",`Estimación con la nómina de ${mesLab(r.ref.periodo)}${r.limpio ? "" : " (con incidencias: IT, finiquito o indemnización)"}: bruto anual = 12 × (bruto de la nómina, que ya lleva la paga de Navidad prorrateada + prorrata de la paga de verano); coste = bruto + Seguridad Social de empresa; IRPF al tipo efectivo de ese mes.${r.tope ? ` Su base de cotización está en el tope (${eur(r.a.base)} € al año): cotiza por menos de lo que cobra.` : ""}${r.real.ssEmp < 0 ? " La Seguridad Social de empresa real sale negativa por los meses de IT: la empresa adelanta la prestación y la descuenta de sus cotizaciones (pago delegado)." : ""} «Real» suma lo pagado en el año, incluida la paga extra.`));
  return c;
}
function sigCodigoEtt(){ const n = R.data.personas.map(p => /^ETT(\d+)$/.exec(p.codigo)).filter(Boolean).map(m => +m[1]); return "ETT" + String((n.length ? Math.max(...n) : 0) + 1).padStart(3,"0"); }

// ---------- ETT ----------
function tabEtt(box){
  const M = meses(), D = R.data, emp = [...new Set([...D.fact.map(f => f.empresa_ett), ...D.act.map(a => a.empresa_ett)])].sort();
  box.append(el("p","hint","Facturas leídas de Tesorería (hoja Proveedores), por mes de la factura y sin IVA. Las personas y días salen de los contratos de cada ficha de ETT."));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"ETT"), el("th",null,"Dato")); for (const m of M) hr.append(el("th","n",mesLab(m))); hr.append(el("th","n","Total")); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const e of emp){
    const c = m => sum(D.fact.filter(f => f.empresa_ett === e && f.periodo === m), f => f.base_imponible), n = m => new Set(D.act.filter(a => a.empresa_ett === e && a.periodo === m).map(a => a.codigo)).size, d = m => sum(D.act.filter(a => a.empresa_ett === e && a.periodo === m), a => a.dias);
    const filas = [["Coste (sin IVA)", m => eur(c(m)), eur(sum(M, c))], ["Personas", m => String(n(m) || ""), ""], ["Días-persona", m => String(d(m) || ""), String(sum(M, d))], ["€ por día-persona", m => d(m) && c(m) ? Math.round(c(m) / d(m)) + " €" : "", sum(M,d) ? Math.round(sum(M,c) / sum(M,d)) + " €" : ""]];
    filas.forEach(([lab, fn, tot], i) => { const tr = el("tr", i === 0 ? "wk" : null); tr.append(el("td",null,i === 0 ? e : ""), el("td",null,lab));
      for (const m of M){ const td = el("td","n",fn(m)); if (i === 0 && !c(m) && n(m)) { td.textContent = "sin factura"; td.style.color = "var(--red)"; } if (i === 3 && d(m) && c(m) / d(m) > 150) td.style.color = "var(--red)"; tr.append(td); }
      tr.append(el("td","n",tot)); tb.append(tr); });
  }
  t.append(tb); tw.append(t); box.append(tw);
  // personas ETT por departamento y mes
  const deps = [...new Set(D.act.map(a => a.departamento))].sort();
  if (deps.length){ box.append(el("h3",null,"Personas de ETT por departamento"));
    const tw2 = el("div","tblwrap"); const t2 = el("table","tbl"); const h2 = el("tr"); h2.append(el("th",null,"Departamento")); for (const m of M) h2.append(el("th","n",mesLab(m))); t2.append(el("thead")); t2.tHead.append(h2); const b2 = el("tbody");
    for (const g of deps){ const tr = el("tr"); tr.append(el("td",null,g)); for (const m of M) tr.append(el("td","n",String(new Set(D.act.filter(a => a.departamento === g && a.periodo === m).map(a => a.codigo)).size || ""))); b2.append(tr); }
    t2.append(b2); tw2.append(t2); box.append(tw2); }
  box.append(el("p","hint","Un coste por día-persona muy alto (en rojo) indica que faltan personas o contratos de ETT en las fichas para ese mes. Para dar de alta a una persona de ETT: Ficha de personas › Nueva persona › Vínculo ETT."));
}

// ---------- Carga del fichero «Imputación de costes» ----------
const txt = v => v == null ? "" : String(v).trim();
async function cargarNomina(file){
  const set = t => { R.msg.textContent = t; };
  try{
    set(`Leyendo ${file.name}…`);
    const wb = XLSX.read(await file.arrayBuffer(), { type:"array" }); const ws = wb.Sheets[wb.SheetNames[0]];
    const A = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, raw:true });
    const titulo = txt((A.find(r => r && txt(r[0])) || [])[0]);
    const hi = A.findIndex(r => r && r.some(c => txt(c) === "Total")); if (hi < 0) throw new Error("No encuentro la fila de códigos (con la columna «Total»).");
    const H = A[hi], ti = H.findIndex(c => txt(c) === "Total"); const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt(H[0]) || A.slice(0, hi + 1).map(r => (r || []).map(txt).join(" ")).join(" "));
    if (!m) throw new Error("No encuentro el periodo («Del dd/mm/aaaa…»).");
    const periodo = `${m[3]}-${m[2]}-01`, extra = /paga extra/i.test(titulo);
    const ids = H.slice(4, ti).map(c => txt(c).padStart(6, "0"));
    const nom = ids.map((_, i) => [A[hi+1], A[hi+2], A[hi+3]].map(r => txt((r || [])[4 + i])).filter(Boolean).join(" "));
    const acc = ids.map(() => ({ bruto:0, ss_empresa:0, coste_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0, base_cc:0, ss_trabajador:0, irpf:0, liquido:0, deducciones:0, prorrata_extra:0 }));
    for (const r of A.slice(hi + 4)){ if (!r) continue; const lab = txt(r[2]) || txt(r[1]); if (!lab) continue;
      const k = lab === "TOTAL BRUTO" ? "bruto" : lab === "SEGURIDAD SOCIAL EMPRESA" ? "ss_empresa" : lab === "COSTE EMPRESA" ? "coste_empresa" : /^Indemnizaci/i.test(lab) ? "indemnizacion"
        : lab === "HORAS PRESENCIA" ? "horas_presencia" : /^(Enfermedad|Prest\.Enfermedad|Complemento I\.T|Complemento Enfermedad)/i.test(lab) ? "it_enfermedad" : /^Parte Proporcional Vacaciones/i.test(lab) ? "vacaciones_finiquito" : lab === "BASE CONTINGENCIAS COMUNES" ? "base_cc" : /^Cotización/i.test(lab) ? "ss_trabajador"
        : /^Tributación IRPF/i.test(lab) ? "irpf" : lab === "TOTAL LIQUIDO" ? "liquido" : lab === "TOTAL DEDUCCIONES" ? "deducciones" : lab === "PRORRATA PAGAS EXTRAS" ? "prorrata_extra" : null;
      if (!k) continue; ids.forEach((_, i) => { const v = +r[4 + i]; if (isFinite(v)) acc[i][k] += v; }); }
    const round = x => Math.round(x * 100) / 100;
    const total = acc.reduce((s, a) => s + a.coste_empresa, 0);
    const nuevos = ids.map((c, i) => ({ c, n: nom[i] })).filter(x => !R.data.porCodigo.has(x.c));
    const msg = extra ? `Fichero de PAGA EXTRA de ${mesLab(periodo)}: ${ids.length} personas, ${eur(total)} €. Se guarda como paga extra del mes (no toca la nómina ordinaria).`
      : `Nómina ordinaria de ${mesLab(periodo)}: ${ids.length} personas, coste de empresa ${eur(total)} €. Si ya estaba cargada, se sustituye.\n\nOjo: si es el fichero de «totales» (nómina + paga extra), no lo cargues: sube la nómina ordinaria y la paga extra por separado.`;
    if (!confirm(msg + (nuevos.length ? `\n\n${nuevos.length} personas nuevas se darán de alta con ficha incompleta: ${nuevos.map(x => x.n).join(", ")}.` : "") + "\n\n¿Continuar?")){ set(""); return; }
    if (nuevos.length){ const r = await sch().from("personas").insert(nuevos.map(x => ({ codigo:x.c, nombre: x.n.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()), tipo_vinculo:"Nómina", empleador:"B10", tipo_contrato:"Indefinido", observaciones:`Alta automática al cargar la nómina de ${mesLab(periodo)}` }))); if (r.error) throw r.error; }
    const c = await sb.schema("core").from("cargas").insert({ tipo:"rrhh_nomina", fichero:file.name, periodo:periodo.slice(0,7) + (extra ? " extra" : ""), filas:ids.length, importe_total:round(total), notas:"Carga desde la app" }).select("id").single();
    if (c.error) throw c.error;
    const rows = ids.map((cod, i) => extra ? { periodo, codigo:cod, paga_extra:round(acc[i].coste_empresa), paga_extra_irpf:round(acc[i].irpf), paga_extra_liquido:round(acc[i].liquido) }
      : (({ deducciones, ...a }) => Object.assign({ periodo, codigo:cod, carga_id:c.data.id, otras_deducciones:round(deducciones - a.ss_trabajador - a.irpf) }, Object.fromEntries(Object.entries(a).map(([k,v]) => [k, round(v)]))))(acc[i]));
    if (!extra){ const del = await sch().from("nomina_mensual").update({ coste_empresa:0, bruto:0, ss_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0, base_cc:0, ss_trabajador:0, irpf:0, otras_deducciones:0, liquido:0, prorrata_extra:0 }).eq("periodo", periodo).not("codigo","in",`(${ids.map(x => `"${x}"`).join(",")})`); if (del.error) throw del.error; }
    const up = await sch().from("nomina_mensual").upsert(rows, { onConflict:"periodo,codigo" }); if (up.error) throw up.error;
    set(`Hecho: ${extra ? "paga extra" : "nómina"} de ${mesLab(periodo)} cargada (${ids.length} personas${nuevos.length ? `, ${nuevos.length} altas nuevas: completa su ficha` : ""}).`);
    toast("Nómina cargada"); if (nuevos.length){ R.tab = "personas"; R.f.incompletas = true; } recargar();
  } catch(e){ console.error(e); set("No se ha podido cargar: " + (e.message || "error")); }
}

// ---------- Exportar ----------
function exportar(){
  const wb = XLSX.utils.book_new(), M = meses(), S = serieMensual();
  const A = [["Mes","Personas nómina","Nómina ordinaria", ...(R.indem ? ["Indemnizaciones"] : []),"Paga extra verano (prorrata)","Total nómina","ETT sin IVA","Coste total","Personas ETT"]];
  for (const s of S) A.push([mesLab(s.m), s.pers, Math.round(s.ord), ...(R.indem ? [Math.round(s.ind)] : []), Math.round(s.ext), Math.round(s.nom), Math.round(s.ett), Math.round(s.tot), s.ettN]);
  XLSX.utils.book_append_sheet(wb, sheet(A, [10,10,14,14,12,14,12,14,8,10]), "Resumen");
  const B = [["Código","Nombre","Vínculo","Empresa ETT","Clasificación","Grupo profesional","Departamento","Puesto","Categoría","Contrato","Alta","Baja","Motivo baja","Pendiente","Mes de referencia","Bruto anual","Coste empresa anual","SS trabajador anual","IRPF anual","Líquido anual","Líquido mensual"]];
  for (const p of R.data.personas) B.push([p.codigo, p.nombre, p.tipo_vinculo, p.empresa_ett || "", p.clasificacion || "", p.grupo_profesional || "", p.departamento || "", p.puesto || "", p.categoria || "", p.tipo_contrato || "", p.fecha_alta || "", p.fecha_baja || "", p.motivo_baja || "", pendientes(p).join(", "), ...(r => r ? [mesLab(r.ref.periodo), Math.round(r.a.bruto), Math.round(r.a.coste), Math.round(r.a.ss), Math.round(r.a.irpf), Math.round(r.a.liq), Math.round(r.a.liq / 12)] : [])(retribucion(p.codigo))]);
  XLSX.utils.book_append_sheet(wb, sheet(B, [9,32,9,12,10,14,20,18,14,22,11,11,20,30,10,14,14,14,12,14,12]), "Personas");
  const C = [["Código","Nombre","Clasificación","Departamento", ...M.map(mesLab), "Total"]];
  const by = new Map(); for (const n of R.data.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = costeDev(n); by.set(n.codigo, x); }
  for (const [cod, x] of by){ const p = R.data.porCodigo.get(cod) || {}; C.push([cod, p.nombre || "", p.clasificacion || "", p.departamento || "", ...M.map(m => Math.round((x[m] || 0) * 100) / 100), Math.round(sum(M, m => x[m]) * 100) / 100]); }
  XLSX.utils.book_append_sheet(wb, sheet(C, [9,32,10,20, ...M.map(() => 11), 12]), "Coste por empleado");
  saveXlsx(wb, `Costes_personal_${stamp()}.xlsx`);
}
