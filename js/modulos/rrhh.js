// APP B10 · Personas: costes de personal (nómina + ETT) y formulario de introducción de datos (personas y estructura)
// Datos en el esquema «rrhh» de Supabase (migraciones 19 a 23).
// Permisos: «rrhh» para los costes; «datos» (o «rrhh») para las fichas de personas y la estructura de departamentos.
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

const R = { tab:"resumen", tabD:"personas", data:null, loading:false, anio:null, agr:"departamento", repartirEtt:false, indem:true, abiertos:new Set(),
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
const puede = () => nivel("rrhh") === "editar" || nivel("datos") === "editar";
const puedeCostes = () => nivel("rrhh") === "editar";

async function todo(q){ const out = []; for (let i = 0; ; i += 1000){ const { data, error } = await q().range(i, i + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; } return out; }

async function cargar(){
  R.loading = true;
  try{
    const [personas, nomina, deps, periodos, act, puestos, aus] = await Promise.all([
      todo(() => sch().from("personas").select("*").order("codigo")),
      todo(() => sch().from("nomina_mensual").select("periodo,codigo,bruto,ss_empresa,coste_empresa,indemnizacion,it_enfermedad,vacaciones_finiquito,paga_extra,coste_total,coste_ordinario,horas_presencia,base_cc,ss_trabajador,irpf,otras_deducciones,liquido,paga_extra_irpf,paga_extra_liquido,prorrata_extra").order("periodo")),
      sch().from("departamentos").select("*").order("orden").then(r => { if (r.error) throw r.error; return r.data; }),
      todo(() => sch().from("ett_periodos").select("*").order("fecha_inicio")),
      todo(() => sch().from("v_ett_activos_mes").select("*")),
      sch().from("puestos").select("*").order("orden").then(r => { if (r.error) throw r.error; return r.data; }),
      todo(() => sch().from("ausencias").select("*").order("fecha_inicio")),
    ]);
    let fact = [];
    try { fact = await todo(() => sch().from("v_ett_facturas").select("*").order("fecha_factura")); }
    catch(e){ console.warn("Sin facturas ETT", e); }
    const num = r => { for (const k of ["bruto","ss_empresa","coste_empresa","indemnizacion","it_enfermedad","vacaciones_finiquito","paga_extra","coste_total","coste_ordinario","horas_presencia","base_cc","ss_trabajador","irpf","otras_deducciones","liquido","paga_extra_irpf","paga_extra_liquido","prorrata_extra"]) r[k] = +r[k] || 0; return r; };
    R.data = { personas, nomina: nomina.map(num), deps, periodos, act, puestos, aus, fact: fact.map(f => ({ ...f, base_imponible:+f.base_imponible || 0, importe_total:+f.importe_total || 0 })) };
    R.data.porCodigo = new Map(personas.map(p => [p.codigo, p]));
    const anios = [...new Set(nomina.map(n => +n.periodo.slice(0,4)))].sort();
    R.data.anios = anios; if (!R.anio || !anios.includes(R.anio)) R.anio = anios[anios.length - 1] || new Date().getFullYear();
  } catch(e){ console.error(e); toast("No se han podido cargar los datos de personas."); R.data = { personas:[], nomina:[], deps:[], periodos:[], act:[], puestos:[], aus:[], fact:[], porCodigo:new Map(), anios:[] }; }
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
  cabecera(app, "Costes de personal", "Coste de empresa por mes, sección y persona (nómina y ETT). Las fichas de personas y la estructura están en el Formulario de introducción de datos.", { txt:"Personas", href:"#personas" }, "rrhh");
  const box = el("div","pad rrhh"); box.style.paddingBottom = "32px"; app.append(box);
  if (!R.data){ if (!R.loading) cargar(); box.append(el("div","card empty","Cargando datos…")); return; }

  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  if (!["resumen","seccion","empleado","ett"].includes(R.tab)) R.tab = "resumen";
  for (const [k,t] of [["resumen","Resumen"],["seccion","Por sección"],["empleado","Por empleado"],["ett","ETT"]]){
    const a = el("a",null,t); a.href = "#personas-costes"; if (R.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); R.tab = k; render(); }); nav.append(a); }
  const acc = el("span"); acc.style.marginLeft = "auto"; acc.style.display = "flex"; acc.style.gap = "8px";
  if (nivel("datos") || nivel("rrhh")){ const fd = el("a","btn small","Fichas y estructura ›"); fd.href = "#datos"; fd.title = "Formulario de introducción de datos"; acc.append(fd); }
  const ex = el("button","btn small","Exportar a Excel"); ex.addEventListener("click", exportar); acc.append(ex);
  if (puedeCostes()){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xls"; inp.hidden = true; inp.multiple = true;
    const up = el("button","btn primary small","Cargar nómina (imputación de costes)"); up.title = "Fichero mensual «Imputación de costes» (o el de paga extra)"; up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", async () => { await cargarNominas([...inp.files]); inp.value = ""; });
    acc.append(up, inp);
  }
  nav.append(acc); box.append(nav);
  if (!R.msg) R.msg = el("p","hint upmsg"); box.append(R.msg);

  if (R.data.anios.length > 1){
    const c = el("div","ctrl"); const s = el("div","seg");
    for (const y of R.data.anios){ const b = el("button",null,String(y)); b.type = "button"; b.setAttribute("aria-pressed", String(y === R.anio)); b.addEventListener("click", () => { R.anio = y; render(); }); s.append(b); }
    const d = el("div","fld"); d.append(el("span",null,"Año"), s); c.append(d); box.append(c);
  }
  if (!R.data.nomina.length){ box.append(el("div","card empty","Todavía no hay nóminas cargadas. Usa «Cargar nómina» con el fichero de imputación de costes del mes.")); return; }
  if (R.tab === "resumen") tabResumen(box);
  else if (R.tab === "seccion") tabSeccion(box);
  else if (R.tab === "empleado") tabEmpleado(box);
  else tabEtt(box);
}

// ---------- Formulario de introducción de datos: fichas de personas y estructura de departamentos ----------
export function renderDatos(app){
  document.title = "Formulario introducción de datos";
  const mod = nivel("datos") ? "datos" : "rrhh";
  cabecera(app, "Formulario introducción de datos", "Tablas maestras: fichas de personas (nómina, ETT y externos) y estructura de clasificación, departamentos y puestos.", { txt:"Personas", href:"#personas" }, nivel("datos") === "editar" || nivel("rrhh") === "editar" ? null : mod);
  const box = el("div","pad rrhh"); box.style.paddingBottom = "32px"; app.append(box);
  if (!R.data){ if (!R.loading) cargar(); box.append(el("div","card empty","Cargando datos…")); return; }
  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  const inc = R.data.personas.filter(p => activa(p) && pendientes(p).length).length;
  for (const [k,t] of [["personas", "Personas" + (inc ? ` (${inc} incompletas)` : "")],["estructura","Estructura de departamentos"]]){
    const a = el("a",null,t); a.href = "#datos"; if (R.tabD === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); R.tabD = k; render(); }); nav.append(a); }
  if (nivel("rrhh")){ const acc = el("span"); acc.style.marginLeft = "auto"; const cl = el("a","btn small","Costes de personal ›"); cl.href = "#personas-costes"; acc.append(cl); nav.append(acc); }
  box.append(nav);
  if (R.tabD === "estructura") tabEstructura(box); else tabPersonas(box);
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
function tablaMeses(box, titulo, filas, M, kPrev){
  if (titulo) box.append(el("h3",null,titulo));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"Concepto")); for (const m of M) hr.append(el("th","n",mesLab(m)));
  if (kPrev){ const th = el("th","n prev",`Previsión ${mesLab(kPrev)}`); th.style.background = "var(--pend-soft)"; hr.append(th); } hr.append(el("th","n","Total")); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const f of filas){ const tr = el("tr", f.b ? "wk" : null); tr.append(el("td",null,f.lab)); for (const v of f.v) tr.append(el("td","n", f.n ? String(Math.round(v || 0)) : eur(v || 0)));
    if (kPrev){ const td = el("td","n", f.p == null ? "" : f.n ? String(Math.round(f.p)) : eur(f.p)); td.style.fontStyle = "italic"; td.style.background = "var(--pend-soft)"; tr.append(td); }
    tr.append(el("td","n", f.n ? "" : eur(sum(f.v, x => x)))); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
}
function tabResumen(box){
  ctrlIndem(box);
  const S = serieMensual(); if (!S.length){ box.append(el("div","card empty","No hay datos de este año.")); return; }
  const M = S.map(s => s.m), PV = R.anio === +(ultimoPeriodo() || "0").slice(0,4) ? prevision() : null, kp = PV ? PV.k : null;
  const filas = [ { lab:"Personas con nómina", v:S.map(s => s.pers), n:true, p:PV && PV.pers }, { lab:"Nómina ordinaria", v:S.map(s => s.ord), p:PV && PV.nom } ];
  if (R.indem) filas.push({ lab:"Indemnizaciones", v:S.map(s => s.ind), p:PV && 0 });
  filas.push({ lab:"Paga extra de verano (prorrata)", v:S.map(s => s.ext), p:PV && PV.ext }, { lab:"Total nómina", v:S.map(s => s.nom), b:true, p:PV && PV.nom + PV.ext },
    { lab:"ETT (base imponible)", v:S.map(s => s.ett), p:PV && PV.ett }, { lab:"Coste total personal", v:S.map(s => s.tot), b:true, p:PV && PV.tot });
  tablaMeses(box, null, filas, M, kp);
  if (PV){ const c = el("div","card"); c.style.margin = "-8px 0 16px"; c.append(el("b",null,`Previsión de ${mesLab(PV.k)}`));
    c.append(el("p","hint",`Nómina: coste de ${mesLab(ultimoPeriodo())} de cada persona (sin indemnizaciones), por los días que seguirá en la empresa según su fecha de baja, fin de contrato o excedencia. ETT: ${PV.tarifa ? `${Math.round(PV.tarifa)} € por día-persona (facturas de ${mesLab(PV.mtarifa)}) × ${PV.ettDias} días de contrato previstos` : "sin datos de facturas"}.`));
    if (PV.avisos.length){ const ul = el("ul"); for (const a of PV.avisos) ul.append(el("li",null,a)); c.append(el("p",null,"Contratos que terminan ese mes:"), ul); }
    box.append(c); }
  // por clasificación: M.O.E, M.O.I, M.O.D y ETT
  const D = R.data, G = {};
  for (const n of D.nomina) if (M.includes(n.periodo)){ const g = clasDe(D.porCodigo.get(n.codigo)); (G[g] = G[g] || {})[n.periodo] = (G[g][n.periodo] || 0) + costeDev(n); }
  G.ETT = Object.fromEntries(M.map(m => [m, sum(Object.values(ettMes(m)), x => x)]));
  const grupos = [...ORDEN_CLAS, ...Object.keys(G).filter(g => !ORDEN_CLAS.includes(g))].filter(g => G[g]);
  const F2 = grupos.map(g => ({ lab:g, v:M.map(m => G[g][m] || 0), p: PV ? (PV.porClas[g] || 0) : null }));
  F2.push({ lab:"Coste total personal", v:M.map((m,i) => sum(F2, f => f.v[i])), b:true, p: PV ? PV.tot : null });
  tablaMeses(box, "Coste por clasificación", F2, M, kp);
  const P2 = grupos.map(g => ({ lab:g, n:true, v:M.map(m => g === "ETT" ? new Set(D.act.filter(a => a.periodo === m).map(a => a.codigo)).size
    : new Set(D.nomina.filter(n => n.periodo === m && (n.bruto || n.coste_empresa) && clasDe(D.porCodigo.get(n.codigo)) === g).map(n => n.codigo)).size), p: PV ? (PV.persClas[g] || 0) : null }));
  tablaMeses(box, "Personas por clasificación", P2, M, kp);
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
const MEDIDAS_EMP = { coste:"Coste empresa", bruto:"Bruto", liquido:"Líquido" };
const valEmp = n => R.fe.medida === "bruto" ? n.bruto - n.indemnizacion + indemn(n) + n.prorrata_extra : R.fe.medida === "liquido" ? n.liquido + n.paga_extra_liquido : costeDev(n);
function tabEmpleado(box){
  ctrlIndem(box);
  { const c = box.lastChild, s = el("div","seg"); R.fe.medida = R.fe.medida || "coste";
    for (const [k,l] of Object.entries(MEDIDAS_EMP)){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(R.fe.medida === k)); b.addEventListener("click", () => { R.fe.medida = k; render(); }); s.append(b); }
    const d = el("div","fld"); d.append(el("span",null,"Ver"), s); c.insertBefore(d, c.firstChild); }
  const M = meses(), D = R.data;
  const c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre o código"; q.value = R.fe.q; q.dataset.k = "rr-eq"; q.addEventListener("input", () => { R.fe.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const dd = el("div","fld"); const s = el("select"); s.append(new Option("Todos","")); for (const g of [...new Set(D.personas.map(p => p.departamento || "Sin asignar"))].sort()) s.append(new Option(g, g)); s.value = R.fe.dep; s.addEventListener("change", () => { R.fe.dep = s.value; render(); }); dd.append(el("span",null,"Departamento"), s); c.append(dd);
  box.append(c);
  const by = new Map(); for (const n of D.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = n; by.set(n.codigo, x); }
  const qq = R.fe.q.trim().toLowerCase();
  const L = [...by.entries()].map(([cod, x]) => ({ cod, x, p: D.porCodigo.get(cod) || { codigo:cod, nombre:"(sin ficha)" } }))
    .filter(r => (!qq || `${r.p.nombre} ${r.cod}`.toLowerCase().includes(qq)) && (!R.fe.dep || (r.p.departamento || "Sin asignar") === R.fe.dep))
    .map(r => ({ ...r, tot: sum(M, m => r.x[m] ? valEmp(r.x[m]) : 0), ord: sum(M, m => r.x[m] ? valEmp(r.x[m]) : 0), nm: M.filter(m => r.x[m] && (r.x[m].bruto || r.x[m].coste_total)).length }))
    .sort((a,b) => b.tot - a.tot);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr");
  for (const h of ["Código","Nombre","Departamento"]) hr.append(el("th",null,h)); for (const m of M) hr.append(el("th","n",mesLab(m))); for (const h of ["Total","Media mes","Meses"]) hr.append(el("th","n",h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const r of L){ const tr = el("tr"); const abre = td => { td.style.cursor = "pointer"; td.title = "Abrir la ficha"; td.addEventListener("click", () => { if (R.data.porCodigo.get(r.cod)) ficha(R.data.porCodigo.get(r.cod)); }); return td; };
    tr.append(abre(el("td",null,r.cod)), abre(el("td",null,r.p.nombre)), abre(el("td",null,r.p.departamento || "—")));
    for (const m of M){ const n = r.x[m]; const td = el("td","n", n ? eur(valEmp(n)) : ""); if (n){ td.style.cursor = "pointer"; td.title = "Ver el desglose de la nómina" + (R.indem && n.indemnizacion ? ` (incluye indemnización ${eur(n.indemnizacion)} €)` : ""); td.addEventListener("click", () => desglose(r.cod, m)); if (R.indem && n.indemnizacion) td.style.fontWeight = "700"; } tr.append(td); }
    tr.append(el("td","n",eur(r.tot)), el("td","n",eur(r.nm ? r.ord / r.nm : 0)), el("td","n",String(r.nm))); tb.append(tr); }
  const tr = el("tr","wk"); tr.append(el("td"), el("td",null,`Total (${L.length} personas)`), el("td")); for (const m of M) tr.append(el("td","n",eur(sum(L, r => r.x[m] ? valEmp(r.x[m]) : 0)))); tr.append(el("td","n",eur(sum(L, r => r.tot))), el("td"), el("td")); tb.append(tr);
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint",(R.fe.medida === "liquido" ? "Líquido cobrado cada mes (en junio incluye la paga extra; no se le quitan las indemnizaciones)." : (R.fe.medida === "bruto" ? "Bruto" : "Coste de empresa") + " de cada mes con la paga extra de verano prorrateada" + (R.indem ? "; en negrita, los meses con indemnización." : ", sin indemnizaciones.")) + " Pulsa un importe para ver el desglose de esa nómina hasta el líquido, o el nombre para abrir la ficha."));
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
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Código","Nombre","Situación","Vínculo","Clasif.","Grupo prof.","Departamento","Puesto / categoría","Contrato","Alta","Baja","Pendiente"]) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const p of L){ const tr = el("tr", activa(p) ? null : "paid"); tr.style.cursor = "pointer"; tr.addEventListener("click", () => ficha(p));
    const pend = pendientes(p); const tp = el("td"); for (const x of pend) { tp.append(el("span","tag warn",x), " "); }
    const st = situacion(p), tst = el("td"); tst.append(el("span","tag " + st.cls, st.t));
    tr.append(el("td",null,p.codigo), el("td",null,p.nombre), tst, el("td",null,p.tipo_vinculo + (p.empresa_ett ? " · " + p.empresa_ett : "")), el("td",null,p.clasificacion || ""), el("td",null,p.grupo_profesional || ""), el("td",null,p.departamento || ""), el("td",null,p.puesto || p.categoria || ""), el("td",null,p.tipo_contrato || ""), el("td",null,fec(p.fecha_alta)), el("td",null,fec(p.fecha_baja) + (p.motivo_baja ? ` (${p.motivo_baja})` : "")), tp);
    tb.append(tr); }
  if (!L.length){ const tr = el("tr"); const td = el("td","empty","No hay personas con estos filtros."); td.colSpan = 12; tr.append(td); tb.append(tr); }
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
  { const d = el("div","f"); d.dataset.f = "puesto_id"; const sp = selectPuesto(v.puesto_id); sp.disabled = !ed; I.puesto_id = sp; d.append(el("label",null,"Puesto"), sp, el("span","hint", D.puestos.length ? "Al elegir el puesto se rellenan el departamento y la clasificación." : "Crea los puestos en la pestaña Estructura."));
    f.append(fila(d, campo("grupo_profesional","Grupo profesional","text"))); }
  f.append(fila(campo("clasificacion","Clasificación","select",CLASIF,true), campo("departamento","Departamento","select",D.deps.filter(d => d.activo !== false).map(d => d.nombre),true)));
  f.append(campo("categoria","Categoría","text"));
  const syncP = () => { const pu = D.puestos.find(x => String(x.id) === I.puesto_id.value); if (pu){ I.clasificacion.value = pu.clasificacion; I.departamento.value = pu.departamento; } I.clasificacion.disabled = I.departamento.disabled = !ed || !!pu; };
  I.puesto_id.addEventListener("change", syncP); syncP();
  { const dl = el("datalist"); dl.id = "dlGrupos"; for (const g of [...new Set(D.personas.map(x => x.grupo_profesional).filter(Boolean))].sort()) dl.append(new Option(g)); f.append(dl); I.grupo_profesional.setAttribute("list","dlGrupos"); }
  f.append(fila(campo("tipo_contrato","Tipo de contrato","select",CONTRATOS,true), campo("fecha_fin_contrato","Fin de contrato (temporales)","date")));
  f.append(fila(campo("fecha_alta","Fecha de alta","date",null,true), el("div")));
  let finPrev = null;
  if (nueva){ const d = el("div","f"); d.dataset.f = "fin"; finPrev = el("input"); finPrev.type = "date"; d.append(el("label",null,"Fin previsto del contrato (ETT)"), finPrev, el("span","hint","")); blkEtt.append(d); }
  f.append(fila(campo("fecha_baja","Baja definitiva en la empresa","date"), campo("motivo_baja","Motivo de la baja definitiva","select",MOTIVOS)));
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
    f.append(tarjetaAusencias(p, ed, () => dlg.close()));
    const mv = await sch().from("movimientos").select("fecha,tipo,valor_anterior,valor_nuevo").eq("persona_id", p.id).order("fecha");
    if (mv.data && mv.data.length){ const det = el("details"); det.style.margin = "0 0 10px"; det.append(el("summary",null,`Historial (${mv.data.length})`)); const ul = el("ul"); for (const m of mv.data) ul.append(el("li",null,`${fec(m.fecha)} · ${m.tipo}${m.valor_anterior ? ": " + m.valor_anterior + " →" : ""}${m.valor_nuevo ? " " + m.valor_nuevo : ""}`)); det.append(ul); f.append(det); }
    const rt = retribucion(p.codigo); if (rt) f.append(tarjetaRetribucion(rt));
  }
  const err = el("span","err"); f.append(err);
  const acts = el("div","actions"); const cn = el("button","btn", ed ? "Cancelar" : "Cerrar"); cn.type = "button"; cn.addEventListener("click", () => dlg.close()); acts.append(cn);
  if (ed){ const ok = el("button","btn primary", nueva ? "Dar de alta" : "Guardar"); acts.append(ok); }
  f.append(acts);
  f.addEventListener("submit", async e => { e.preventDefault(); if (!ed) return;
    const val = {}; for (const k of Object.keys(I)) val[k] = (I[k].value || "").trim() || null; if (val.puesto_id){ const pu = D.puestos.find(x => String(x.id) === val.puesto_id); if (pu){ val.clasificacion = pu.clasificacion; val.departamento = pu.departamento; } } if (val.departamento === "__nuevo") val.departamento = null;
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
      grupo_profesional:val.grupo_profesional, puesto_id: val.puesto_id ? +val.puesto_id : null, categoria:val.categoria, tipo_contrato:val.tipo_contrato, fecha_fin_contrato:val.fecha_fin_contrato, fecha_alta:val.fecha_alta, fecha_baja:val.fecha_baja, motivo_baja: val.fecha_baja ? val.motivo_baja : null, observaciones:val.observaciones };
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
  box.append(el("p","hint","Un coste por día-persona muy alto (en rojo) indica que faltan personas o contratos de ETT en las fichas para ese mes. Para dar de alta a una persona de ETT: Formulario introducción de datos › Personas › Nueva persona › Vínculo ETT."));
}

// ---------- Situación de la persona (activa, IT, excedencia, vacaciones, baja definitiva) ----------
const TIPOS_AUS = ["IT enfermedad común","IT accidente de trabajo","Excedencia","Vacaciones","Permiso","Otra"];
const CLAS_LAB = { "M.O.E":"M.O.E · mano de obra de estructura", "M.O.I":"M.O.I · mano de obra indirecta", "M.O.D":"M.O.D · mano de obra directa" };
function ultimoPeriodo(){ let u = null; for (const n of R.data.nomina) if (!u || n.periodo > u) u = n.periodo; return u; }
function situacion(p, dia){
  dia = dia || hoyKey;
  if (p.fecha_baja && p.fecha_baja < dia) return { t:"Baja definitiva", cls:"neutral" };
  if (!p.fecha_baja && p.motivo_baja) return { t:"Baja definitiva (falta la fecha)", cls:"neutral" };
  const a = R.data.aus.find(x => x.persona_id === p.id && x.fecha_inicio <= dia && (!x.fecha_fin || x.fecha_fin >= dia));
  if (a) return { t:a.tipo, cls: a.tipo.startsWith("IT") ? "bad" : "warn", a };
  if (p.tipo_vinculo === "Nómina"){ const u = ultimoPeriodo(), n = R.data.nomina.find(x => x.codigo === p.codigo && x.periodo === u);
    if (n && n.it_enfermedad && !R.data.aus.some(x => x.persona_id === p.id && x.tipo.startsWith("IT"))) return { t:`IT en la nómina de ${mesLab(u)} (sin registrar)`, cls:"pend" }; }
  return { t:"Activa", cls:"ok" };
}
const diasMes = k => +finMes(k).slice(8,10);
const sigMes = k => { const y = +k.slice(0,4), m = +k.slice(5,7); return m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,"0")}-01`; };
// días de [ini, fin] (fin vacío = abierto) que caen en el mes k
function diasEnMes(ini, fin, k){ const a = k, b = finMes(k); const i = ini && ini > a ? ini : a, f = fin && fin < b ? fin : b; if (f < i) return 0; return Math.round((Date.parse(f) - Date.parse(i)) / 86400000) + 1; }

// ---------- Previsión del mes siguiente ----------
// Nómina: coste del último mes cargado (sin indemnizaciones) de cada persona, por la parte del mes que seguirá en la empresa
// (fecha de baja, fin de contrato temporal o excedencia). ETT: coste por día-persona del último mes con factura × días de contrato previstos.
function prevision(){
  const D = R.data, L = ultimoPeriodo(); if (!L) return null;
  const k = sigMes(L), dm = diasMes(k), fin = [], out = { k, nom:0, ext:0, pers:0, porClas:{}, persClas:{}, ett:0, ettN:0, ettDias:0, avisos:[] };
  for (const n of D.nomina.filter(x => x.periodo === L && (x.bruto || x.coste_empresa))){
    const p = D.porCodigo.get(n.codigo); if (!p) continue;
    const hasta = [p.fecha_baja, p.fecha_fin_contrato].filter(Boolean).sort()[0] || null;
    let dias = diasEnMes(p.fecha_alta, hasta, k);
    for (const a of D.aus.filter(a => a.persona_id === p.id && a.tipo === "Excedencia")) dias -= diasEnMes(a.fecha_inicio, a.fecha_fin, k);
    dias = Math.max(0, dias); const fr = dias / dm;
    if (hasta && hasta <= finMes(k) && hasta >= k) out.avisos.push(`${p.nombre}: ${p.fecha_baja === hasta ? "baja" : "fin de contrato"} el ${fec(hasta)}`);
    if (!fr) continue;
    const ord = (n.coste_empresa - n.indemnizacion) * fr, ext = n.prorrata_extra * fr, g = clasDe(p);
    out.nom += ord; out.ext += ext; out.pers++; out.porClas[g] = (out.porClas[g] || 0) + ord + ext; out.persClas[g] = (out.persClas[g] || 0) + 1;
  }
  // ETT: tarifa por día-persona del último mes con factura y personas
  const meses = [...new Set(D.fact.map(f => f.periodo))].sort().reverse(); let tarifa = null, mt = null;
  for (const m of meses){ const c = sum(D.fact.filter(f => f.periodo === m), f => f.base_imponible), d = sum(D.act.filter(a => a.periodo === m), a => a.dias); if (c && d){ tarifa = c / d; mt = m; break; } }
  const ettP = new Set();
  for (const r of D.periodos){ const d = diasEnMes(r.fecha_inicio, r.fecha_fin, k); if (d > 0){ out.ettDias += d; ettP.add(r.persona_id); }
    if (r.fecha_fin && r.fecha_fin >= k && r.fecha_fin <= finMes(k)){ const p = D.personas.find(x => x.id === r.persona_id); if (p) out.avisos.push(`${p.nombre} (ETT ${p.empresa_ett || ""}): fin de contrato el ${fec(r.fecha_fin)}`); } }
  out.ettN = ettP.size; out.ett = tarifa ? tarifa * out.ettDias : 0; out.tarifa = tarifa; out.mtarifa = mt;
  out.porClas.ETT = out.ett; out.persClas.ETT = out.ettN; out.tot = out.nom + out.ext + out.ett;
  return out;
}

// ---------- Desglose de una nómina (por conceptos) ----------
async function desglose(codigo, periodo){
  const D = R.data, p = D.porCodigo.get(codigo) || { nombre:codigo }, n = D.nomina.find(x => x.codigo === codigo && x.periodo === periodo);
  let dlg = document.getElementById("dlgNomina"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgNomina"; dlg.style.maxWidth = "620px"; dlg.style.maxHeight = "90vh"; dlg.style.overflow = "auto"; document.body.append(dlg);
  const box = el("div"); dlg.append(box);
  const cab = el("div"); cab.style.cssText = "display:flex;align-items:center;gap:8px;justify-content:space-between";
  const meses = D.nomina.filter(x => x.codigo === codigo).map(x => x.periodo).sort(), i = meses.indexOf(periodo);
  const nav = (j, t) => { const b = el("button","btn small",t); b.type = "button"; b.disabled = j < 0 || j >= meses.length; b.addEventListener("click", () => desglose(codigo, meses[j])); return b; };
  const h = el("h2",null,`${p.nombre} · nómina de ${mesLab(periodo)}`); h.style.margin = "0";
  const nv = el("span"); nv.append(nav(i-1,"‹"), nav(i+1,"›")); cab.append(h, nv); box.append(cab);
  box.append(el("p","sub",`${codigo}${p.departamento ? " · " + p.departamento : ""}${p.puesto ? " · " + p.puesto : ""}`));
  const cont = el("div"); cont.append(el("p","hint","Cargando…")); box.append(cont);
  const acts = el("div","actions"); const cl = el("button","btn","Cerrar"); cl.type = "button"; cl.addEventListener("click", () => dlg.close()); acts.append(cl); box.append(acts);
  dlg.showModal();
  const r = await sch().from("nomina_conceptos").select("tipo_nomina,orden,cod_concepto,concepto,grupo,importe").eq("codigo", codigo).eq("periodo", periodo).order("tipo_nomina").order("orden");
  cont.textContent = "";
  const t = el("table","tbl"); const tb = el("tbody"); t.append(tb);
  const fila = (lab, v, o) => { o = o || {}; const tr = el("tr", o.b ? "wk" : null); const td = el("td",null,lab); if (o.sub) td.style.paddingLeft = "22px"; if (o.small) { tr.style.color = "var(--ink-3)"; tr.style.fontSize = "12.5px"; }
    tr.append(td, el("td","n", v == null ? "" : (o.h ? String(Math.round(v)) : eur2(v) + (o.h ? "" : " €")))); tb.append(tr); };
  const titulo = s => { const tr = el("tr"); const td = el("td",null,s); td.colSpan = 2; td.style.cssText = "font-weight:700;color:var(--ink-2);padding-top:12px;border-bottom:1px solid var(--line-strong)"; tr.append(td); tb.append(tr); };
  const C = (r.data || []).map(x => ({ ...x, importe:+x.importe }));
  if (C.length){
    for (const tipo of ["ordinaria","extra"]){
      const X = C.filter(x => x.tipo_nomina === tipo); if (!X.length) continue;
      if (tipo === "extra") titulo("PAGA EXTRA (pagada este mes)");
      const tot = lab => (X.find(x => x.concepto === lab) || {}).importe;
      titulo("Devengos"); for (const x of X.filter(x => x.grupo === "devengo")) fila(x.concepto, x.importe, { sub:true }); fila("Total bruto", tot("TOTAL BRUTO"), { b:true });
      const ded = X.filter(x => x.grupo === "deduccion"); if (ded.length){ titulo("Deducciones del trabajador"); for (const x of ded) fila(x.concepto, -x.importe, { sub:true }); fila("Total deducciones", -(tot("TOTAL DEDUCCIONES") || 0), { b:true }); }
      fila("LÍQUIDO A PERCIBIR", tot("TOTAL LIQUIDO"), { b:true });
      const emp = X.filter(x => x.grupo === "empresa");
      if (tipo === "ordinaria"){
        titulo("Coste para la empresa");
        fila("Total bruto", tot("TOTAL BRUTO"), { sub:true }); fila("+ Seguridad Social a cargo de la empresa", tot("SEGURIDAD SOCIAL EMPRESA"), { sub:true });
        fila("Coste empresa del mes", tot("COSTE EMPRESA"), { b:true });
        const pr = tot("PRORRATA PAGAS EXTRAS"); if (pr) fila("+ Paga extra de verano devengada este mes (prorrata)", pr, { sub:true });
        if (n) fila("Coste del mes con la paga de verano prorrateada", n.coste_empresa + n.prorrata_extra, { b:true });
        for (const x of emp.filter(x => /^BASE|^HORAS/.test(x.concepto))) fila(x.concepto.charAt(0) + x.concepto.slice(1).toLowerCase(), x.importe, { small:true, h: /^HORAS/.test(x.concepto) });
      }
    }
  } else if (n){
    cont.append(el("p","hint","Esta nómina se cargó antes de guardar el detalle por conceptos: vuelve a cargar el fichero de imputación de costes de ese mes para verlo completo. Resumen:"));
    titulo("Trabajador"); fila("Total bruto", n.bruto, { b:true }); fila("– Seguridad Social del trabajador", -n.ss_trabajador, { sub:true }); fila("– IRPF", -n.irpf, { sub:true });
    if (n.otras_deducciones) fila("– Otras deducciones", -n.otras_deducciones, { sub:true }); fila("LÍQUIDO A PERCIBIR", n.liquido, { b:true });
    titulo("Empresa"); fila("+ Seguridad Social empresa", n.ss_empresa, { sub:true }); fila("Coste empresa del mes", n.coste_empresa, { b:true });
    if (n.prorrata_extra) fila("+ Paga extra de verano devengada (prorrata)", n.prorrata_extra, { sub:true }); fila("Coste del mes con la paga de verano prorrateada", n.coste_empresa + n.prorrata_extra, { b:true });
    if (n.paga_extra){ titulo("Paga extra pagada este mes"); fila("Bruto", n.paga_extra); fila("– IRPF", -n.paga_extra_irpf, { sub:true }); fila("Líquido", n.paga_extra_liquido, { b:true }); }
  } else cont.append(el("p","hint","No hay nómina de este mes."));
  if (tb.childNodes.length) cont.append(t);
}
const eur2 = v => { if (v == null || !isFinite(v)) return ""; const [e, d] = Math.abs(v).toFixed(2).split("."); return (v < 0 ? "-" : "") + e.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + "," + d; };

// ---------- Estructura: clasificación › departamento › puesto ----------
function tabEstructura(box){
  const D = R.data, ed = puede();
  const activos = D.personas.filter(activa);
  const nPu = id => activos.filter(p => p.puesto_id === id).length;
  box.append(el("p","hint","Cada puesto pertenece a un departamento y tiene su clasificación (M.O.E, M.O.I o M.O.D). Al asignar un puesto a una persona, su ficha toma el departamento y la clasificación del puesto."));
  if (ed){
    const c = el("div","ctrl");
    const fld = (lab, node) => { const d = el("div","fld"); d.append(el("span",null,lab), node); return d; };
    const dn = el("input"); dn.placeholder = "Nombre del departamento"; const da = el("input"); da.placeholder = "Área (opcional)"; da.style.width = "140px";
    const db = el("button","btn","Crear departamento"); db.type = "button";
    db.addEventListener("click", async () => { const n = dn.value.trim(); if (!n){ dn.focus(); return; } const r = await sch().from("departamentos").insert({ nombre:n, area:da.value.trim() || null, orden:900 }); if (r.error){ toast(r.error.code === "23505" ? "Ese departamento ya existe" : "No se ha podido crear"); return; } toast("Departamento creado"); recargar(); });
    c.append(fld("Nuevo departamento", dn), fld("Área", da), db); box.append(c);
    const c2 = el("div","ctrl");
    const pn = el("input"); pn.placeholder = "Nombre del puesto";
    const pd = el("select"); pd.append(new Option("Departamento…","")); for (const d of D.deps) pd.append(new Option(d.nombre, d.nombre));
    const pc = el("select"); pc.append(new Option("Clasificación…","")); for (const k of ["M.O.E","M.O.I","M.O.D"]) pc.append(new Option(CLAS_LAB[k], k));
    const pb = el("button","btn primary","Crear puesto"); pb.type = "button";
    pb.addEventListener("click", async () => { if (!pn.value.trim()) return pn.focus(); if (!pd.value) return pd.focus(); if (!pc.value) return pc.focus();
      const r = await sch().from("puestos").insert({ nombre:pn.value.trim(), departamento:pd.value, clasificacion:pc.value }); if (r.error){ toast(r.error.code === "23505" ? "Ese puesto ya existe en el departamento" : "No se ha podido crear"); return; } toast("Puesto creado"); recargar(); });
    c2.append(fld("Nuevo puesto", pn), fld("Depende de", pd), fld("Clasificación", pc), pb); box.append(c2);
  }
  // árbol
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Clasificación › departamento › puesto","Personas activas",""]) hr.append(el("th", h === "Personas activas" ? "n" : null, h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  const btn = (txt, fn) => { const b = el("button","btn small",txt); b.type = "button"; b.addEventListener("click", e => { e.stopPropagation(); fn(); }); return b; };
  for (const k of ["M.O.E","M.O.I","M.O.D"]){
    const P = D.puestos.filter(x => x.clasificacion === k); const tr = el("tr","wk"); tr.append(el("td",null,CLAS_LAB[k]), el("td","n",String(sum(P, x => nPu(x.id)))), el("td")); tb.append(tr);
    for (const dep of [...new Set(P.map(x => x.departamento))].sort()){
      const Pd = P.filter(x => x.departamento === dep); const tr2 = el("tr"); const td = el("td",null,dep); td.style.paddingLeft = "28px"; td.style.fontWeight = "600";
      const ac = el("td"); if (ed) ac.append(btn("Renombrar", async () => { const n = (prompt("Nuevo nombre del departamento:", dep) || "").trim(); if (!n || n === dep) return; const r = await sch().from("departamentos").update({ nombre:n }).eq("nombre", dep); if (r.error){ toast("No se ha podido renombrar"); return; } toast("Departamento renombrado"); recargar(); }));
      tr2.append(td, el("td","n",String(sum(Pd, x => nPu(x.id)))), ac); tb.append(tr2);
      for (const pu of Pd.sort((a,b) => a.nombre < b.nombre ? -1 : 1)){
        const tr3 = el("tr"); const td3 = el("td",null,pu.nombre + (pu.activo ? "" : " (inactivo)")); td3.style.paddingLeft = "52px";
        const ac3 = el("td"); if (ed){ ac3.append(btn("Editar", () => editarPuesto(pu)), " "); if (!D.personas.some(p => p.puesto_id === pu.id)) ac3.append(btn("Eliminar", async () => { if (!confirm(`¿Eliminar el puesto «${pu.nombre}»?`)) return; const r = await sch().from("puestos").delete().eq("id", pu.id); if (r.error){ toast("No se ha podido eliminar"); return; } recargar(); })); }
        tr3.append(td3, el("td","n",String(nPu(pu.id))), ac3); tb.append(tr3);
      }
    }
  }
  const sinPu = D.deps.filter(d => !D.puestos.some(x => x.departamento === d.nombre));
  if (sinPu.length){ const tr = el("tr","wk"); tr.append(el("td",null,"Departamentos sin puestos"), el("td"), el("td")); tb.append(tr);
    for (const d of sinPu){ const tr2 = el("tr"); const td = el("td",null,d.nombre + (d.area ? ` · ${d.area}` : "")); td.style.paddingLeft = "28px"; const n = activos.filter(p => p.departamento === d.nombre).length;
      const ac = el("td"); if (ed){ ac.append(btn("Renombrar", async () => { const nn = (prompt("Nuevo nombre del departamento:", d.nombre) || "").trim(); if (!nn || nn === d.nombre) return; const r = await sch().from("departamentos").update({ nombre:nn }).eq("nombre", d.nombre); if (r.error){ toast("No se ha podido renombrar"); return; } recargar(); }), " ");
        if (!D.personas.some(p => p.departamento === d.nombre)) ac.append(btn("Eliminar", async () => { if (!confirm(`¿Eliminar el departamento «${d.nombre}»?`)) return; const r = await sch().from("departamentos").delete().eq("nombre", d.nombre); if (r.error){ toast("No se ha podido eliminar"); return; } recargar(); })); }
      tr2.append(td, el("td","n", n ? `${n} sin puesto` : "0"), ac); tb.append(tr2); } }
  t.append(tb); tw.append(t); box.append(tw);
  // asignación rápida de puestos
  const sin = activos.filter(p => !p.puesto_id);
  box.append(el("h3",null,`Personas activas sin puesto (${sin.length})`));
  if (!D.puestos.length) box.append(el("p","hint","Crea primero los puestos para poder asignarlos."));
  const tw2 = el("div","tblwrap"); const t2 = el("table","tbl"); const h2 = el("tr"); for (const h of ["Código","Nombre","Clasificación actual","Departamento actual","Asignar puesto"]) h2.append(el("th",null,h)); t2.append(el("thead")); t2.tHead.append(h2);
  const b2 = el("tbody");
  for (const p of sin){ const tr = el("tr"); const s = selectPuesto(p.puesto_id); s.disabled = !ed;
    s.addEventListener("change", async () => { if (!s.value) return; const r = await sch().from("personas").update({ puesto_id:+s.value }).eq("id", p.id); if (r.error){ toast("No se ha podido asignar"); return; } toast(`${p.nombre}: puesto asignado`); recargar(); });
    const td = el("td"); td.append(s); tr.append(el("td",null,p.codigo), el("td",null,p.nombre), el("td",null,p.clasificacion || "—"), el("td",null,p.departamento || "—"), td); b2.append(tr); }
  t2.append(b2); tw2.append(t2); box.append(tw2);
}
function selectPuesto(val){
  const s = el("select"); s.append(new Option("—","")); const D = R.data;
  for (const k of ["M.O.E","M.O.I","M.O.D"]) for (const dep of [...new Set(D.puestos.filter(x => x.clasificacion === k).map(x => x.departamento))].sort()){
    const og = document.createElement("optgroup"); og.label = `${k} › ${dep}`;
    for (const pu of D.puestos.filter(x => x.clasificacion === k && x.departamento === dep && (x.activo || x.id === val))) og.append(new Option(pu.nombre, pu.id)); s.append(og); }
  s.value = val ? String(val) : ""; return s;
}
function editarPuesto(pu){
  let dlg = document.getElementById("dlgPuesto"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgPuesto"; document.body.append(dlg); const f = el("form"); f.method = "dialog"; dlg.append(f);
  f.append(el("h2",null,"Puesto"));
  const n = el("input"); n.value = pu.nombre; const d = el("select"); for (const x of R.data.deps) d.append(new Option(x.nombre, x.nombre)); d.value = pu.departamento;
  const c = el("select"); for (const k of ["M.O.E","M.O.I","M.O.D"]) c.append(new Option(CLAS_LAB[k], k)); c.value = pu.clasificacion;
  const a = el("input"); a.type = "checkbox"; a.checked = pu.activo;
  const fld = (lab, node) => { const x = el("div","f"); x.append(el("label",null,lab), node); return x; };
  const la = el("label","chk"); la.append(a, " Activo (se puede asignar)");
  f.append(fld("Nombre", n), fld("Departamento", d), fld("Clasificación", c), la, el("p","hint","Los cambios se aplican a todas las personas de este puesto."));
  const acts = el("div","actions"); const cn = el("button","btn","Cancelar"); cn.type = "button"; cn.addEventListener("click", () => dlg.close()); const ok = el("button","btn primary","Guardar"); acts.append(cn, ok); f.append(acts);
  f.addEventListener("submit", async e => { e.preventDefault(); const r = await sch().from("puestos").update({ nombre:n.value.trim(), departamento:d.value, clasificacion:c.value, activo:a.checked }).eq("id", pu.id);
    if (r.error){ toast("No se ha podido guardar"); return; } dlg.close(); toast("Puesto guardado"); recargar(); });
  dlg.showModal();
}

// ---------- Ausencias en la ficha ----------
function tarjetaAusencias(p, ed, cerrarFicha){
  const D = R.data, A = D.aus.filter(a => a.persona_id === p.id).sort((a,b) => a.fecha_inicio < b.fecha_inicio ? 1 : -1);
  const c = el("div","card"); c.style.margin = "4px 0 12px";
  const s = situacion(p); const h = el("div"); h.append(el("b",null,"Situación y ausencias "), el("span","tag " + s.cls, s.t)); c.append(h);
  const itN = p.tipo_vinculo === "Nómina" ? D.nomina.filter(n => n.codigo === p.codigo && n.it_enfermedad).map(n => mesLab(n.periodo)) : [];
  if (itN.length) c.append(el("p","hint",`La nómina recoge IT (enfermedad) en: ${itN.join(", ")}.`));
  if (A.length){ const ul = el("ul"); for (const a of A){ const li = el("li"); li.append(`${a.tipo}: ${fec(a.fecha_inicio)} – ${a.fecha_fin ? fec(a.fecha_fin) : "abierta"}${a.observaciones ? " · " + a.observaciones : ""} `);
      if (ed){ if (!a.fecha_fin){ const b = el("button","btn small","Cerrar hoy"); b.type = "button"; b.addEventListener("click", async () => { const r = await sch().from("ausencias").update({ fecha_fin:hoyKey }).eq("id", a.id); if (r.error) return toast("No se ha podido guardar"); cerrarFicha(); recargar(); }); li.append(b, " "); }
        const x = el("button","btn small","Eliminar"); x.type = "button"; x.addEventListener("click", async () => { if (!confirm("¿Eliminar esta ausencia?")) return; const r = await sch().from("ausencias").delete().eq("id", a.id); if (r.error) return toast("No se ha podido eliminar"); cerrarFicha(); recargar(); }); li.append(x); }
      ul.append(li); } c.append(ul); }
  else c.append(el("p","hint","Sin ausencias registradas."));
  if (ed){ const g = el("div","f2"); const t = el("select"); for (const x of TIPOS_AUS) t.append(new Option(x, x)); const i = el("input"); i.type = "date"; i.value = hoyKey; const f = el("input"); f.type = "date"; const o = el("input"); o.placeholder = "Observaciones";
    const fld = (lab, node) => { const x = el("div","f"); x.append(el("label",null,lab), node); return x; };
    g.append(fld("Tipo", t), fld("Observaciones", o), fld("Desde", i), fld("Hasta (vacío = sigue abierta)", f));
    const b = el("button","btn small","Añadir ausencia"); b.type = "button";
    b.addEventListener("click", async () => { if (!i.value) return i.focus(); if (f.value && f.value < i.value) return toast("La fecha final es anterior a la inicial"); const r = await sch().from("ausencias").insert({ persona_id:p.id, tipo:t.value, fecha_inicio:i.value, fecha_fin:f.value || null, observaciones:o.value.trim() || null }); if (r.error) return toast("No se ha podido guardar la ausencia"); toast("Ausencia registrada"); cerrarFicha(); recargar(); });
    c.append(g, b, el("p","hint","La baja definitiva en la empresa se indica con la fecha y el motivo de baja de la ficha.")); }
  return c;
}

// ---------- Carga del fichero «Imputación de costes» ----------
const txt = v => v == null ? "" : String(v).trim();
// Lee un fichero «Imputación de costes»: resumen por persona y todas las líneas (conceptos)
async function leerImputacion(file){
  const wb = XLSX.read(await file.arrayBuffer(), { type:"array" }); const ws = wb.Sheets[wb.SheetNames[0]];
  const A = XLSX.utils.sheet_to_json(ws, { header:1, defval:null, raw:true });
  const titulo = txt((A.find(r => r && txt(r[0])) || [])[0]);
  const hi = A.findIndex(r => r && r.some(c => txt(c) === "Total")); if (hi < 0) throw new Error(`${file.name}: no encuentro la fila de códigos (con la columna «Total»).`);
  const H = A[hi], ti = H.findIndex(c => txt(c) === "Total"); const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(txt(H[0]) || A.slice(0, hi + 1).map(r => (r || []).map(txt).join(" ")).join(" "));
  if (!m) throw new Error(`${file.name}: no encuentro el periodo («Del dd/mm/aaaa…»).`);
  const periodo = `${m[3]}-${m[2]}-01`, extra = /paga extra/i.test(titulo);
  const ids = H.slice(4, ti).map(c => txt(c).padStart(6, "0"));
  const nom = ids.map((_, i) => [A[hi+1], A[hi+2], A[hi+3]].map(r => txt((r || [])[4 + i])).filter(Boolean).join(" "));
  const acc = ids.map(() => ({ bruto:0, ss_empresa:0, coste_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0, base_cc:0, ss_trabajador:0, irpf:0, liquido:0, deducciones:0, prorrata_extra:0 }));
  const conceptos = []; let fase = "devengo", orden = 0;
  for (const r of A.slice(hi + 4)){ if (!r) continue; const lab = txt(r[2]) || txt(r[1]); if (!lab || lab === "CONCEPTO") continue;
    const k = lab === "TOTAL BRUTO" ? "bruto" : lab === "SEGURIDAD SOCIAL EMPRESA" ? "ss_empresa" : lab === "COSTE EMPRESA" ? "coste_empresa" : /^Indemnizaci/i.test(lab) ? "indemnizacion"
      : lab === "HORAS PRESENCIA" ? "horas_presencia" : /^(Enfermedad|Prest\.Enfermedad|Complemento I\.T|Complemento Enfermedad)/i.test(lab) ? "it_enfermedad" : /^Parte Proporcional Vacaciones/i.test(lab) ? "vacaciones_finiquito" : lab === "BASE CONTINGENCIAS COMUNES" ? "base_cc" : /^Cotización/i.test(lab) ? "ss_trabajador"
      : /^Tributación IRPF/i.test(lab) ? "irpf" : lab === "TOTAL LIQUIDO" ? "liquido" : lab === "TOTAL DEDUCCIONES" ? "deducciones" : lab === "PRORRATA PAGAS EXTRAS" ? "prorrata_extra" : null;
    const grupo = /^TOTAL (BRUTO|DEDUCCIONES|LIQUIDO)$/.test(lab) ? "total" : fase; orden++;
    ids.forEach((cod, i) => { const v = +r[4 + i]; if (!isFinite(v) || !v) return; if (k) acc[i][k] += v;
      conceptos.push({ periodo, codigo:cod, tipo_nomina: extra ? "extra" : "ordinaria", orden, cod_concepto: txt(r[2]) ? txt(r[1]) : null, concepto:lab, grupo, importe: Math.round(v * 100) / 100 }); });
    if (lab === "TOTAL BRUTO") fase = "deduccion"; if (lab === "TOTAL LIQUIDO") fase = "empresa";
  }
  return { file, periodo, extra, ids, nom, acc, conceptos, total: acc.reduce((s, a) => s + a.coste_empresa, 0) };
}
async function cargarNominas(files){
  const set = t => { R.msg.textContent = t; };
  if (!files.length) return;
  try{
    set(`Leyendo ${files.length} fichero(s)…`);
    const F = []; for (const f of files) F.push(await leerImputacion(f));
    F.sort((a,b) => a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : a.extra - b.extra);
    const dup = F.filter((x, i) => F.findIndex(y => y.periodo === x.periodo && y.extra === x.extra) !== i);
    if (dup.length){ set(`Hay dos ficheros del mismo tipo para ${mesLab(dup[0].periodo)} (${dup.map(x => x.file.name).join(", ")}). Si uno es el de «totales» (nómina + paga extra), quítalo: sube la nómina ordinaria y la paga extra por separado.`); return; }
    const nuevos = new Map(); for (const x of F) x.ids.forEach((c, i) => { if (!R.data.porCodigo.has(c) && !nuevos.has(c)) nuevos.set(c, { c, n:x.nom[i], periodo:x.periodo }); });
    const lista = F.map(x => `• ${mesLab(x.periodo)} ${x.extra ? "PAGA EXTRA" : "nómina ordinaria"}: ${x.ids.length} personas, ${eur(x.total)} € (${x.file.name})`).join("\n");
    if (!confirm(`Se van a cargar ${F.length} fichero(s). Si un mes ya estaba cargado, se sustituye.\n\n${lista}\n\nNo subas el fichero de «totales» de junio: la nómina ordinaria y la paga extra van por separado.` + (nuevos.size ? `\n\n${nuevos.size} personas nuevas se darán de alta con la ficha incompleta: ${[...nuevos.values()].map(x => x.n).join(", ")}.` : "") + "\n\n¿Continuar?")){ set(""); return; }
    if (nuevos.size){ const r = await sch().from("personas").insert([...nuevos.values()].map(x => ({ codigo:x.c, nombre: x.n.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()), tipo_vinculo:"Nómina", empleador:"B10", tipo_contrato:"Indefinido", observaciones:`Alta automática al cargar la nómina de ${mesLab(x.periodo)}` }))); if (r.error) throw r.error; }
    const round = x => Math.round(x * 100) / 100;
    for (const x of F){
      set(`Guardando ${mesLab(x.periodo)} ${x.extra ? "(paga extra)" : ""}…`);
      const c = await sb.schema("core").from("cargas").insert({ tipo:"rrhh_nomina", fichero:x.file.name, periodo:x.periodo.slice(0,7) + (x.extra ? " extra" : ""), filas:x.ids.length, importe_total:round(x.total), notas:"Carga desde la app" }).select("id").single();
      if (c.error) throw c.error;
      const rows = x.ids.map((cod, i) => x.extra ? { periodo:x.periodo, codigo:cod, paga_extra:round(x.acc[i].coste_empresa), paga_extra_irpf:round(x.acc[i].irpf), paga_extra_liquido:round(x.acc[i].liquido) }
        : (({ deducciones, ...a }) => Object.assign({ periodo:x.periodo, codigo:cod, carga_id:c.data.id, otras_deducciones:round(deducciones - a.ss_trabajador - a.irpf) }, Object.fromEntries(Object.entries(a).map(([k,v]) => [k, round(v)]))))(x.acc[i]));
      if (!x.extra){ const del = await sch().from("nomina_mensual").update({ coste_empresa:0, bruto:0, ss_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0, base_cc:0, ss_trabajador:0, irpf:0, otras_deducciones:0, liquido:0, prorrata_extra:0 }).eq("periodo", x.periodo).not("codigo","in",`(${x.ids.map(v => `"${v}"`).join(",")})`); if (del.error) throw del.error; }
      const up = await sch().from("nomina_mensual").upsert(rows, { onConflict:"periodo,codigo" }); if (up.error) throw up.error;
      const dc = await sch().from("nomina_conceptos").delete().eq("periodo", x.periodo).eq("tipo_nomina", x.extra ? "extra" : "ordinaria"); if (dc.error) throw dc.error;
      for (let i = 0; i < x.conceptos.length; i += 1000){ const r = await sch().from("nomina_conceptos").insert(x.conceptos.slice(i, i + 1000)); if (r.error) throw r.error; }
    }
    set(`Hecho: ${F.length} fichero(s) cargados${nuevos.size ? `, ${nuevos.size} altas nuevas: completa su ficha` : ""}.`);
    toast("Nóminas cargadas"); if (nuevos.size){ R.tabD = "personas"; R.f.incompletas = true; toast(`${nuevos.size} personas nuevas: completa sus fichas en el Formulario de introducción de datos`); } recargar();
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
