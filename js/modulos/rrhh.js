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

const R = { tab:"resumen", data:null, loading:false, anio:null, agr:"departamento", repartirEtt:false,
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
      todo(() => sch().from("nomina_mensual").select("periodo,codigo,bruto,ss_empresa,coste_empresa,indemnizacion,paga_extra,coste_total,coste_ordinario,horas_presencia").order("periodo")),
      sch().from("departamentos").select("*").order("orden").then(r => { if (r.error) throw r.error; return r.data; }),
      todo(() => sch().from("ett_periodos").select("*").order("fecha_inicio")),
      todo(() => sch().from("v_ett_activos_mes").select("*")),
    ]);
    let fact = [];
    try { fact = await todo(() => sch().from("v_ett_facturas").select("*").order("fecha_factura")); }
    catch(e){ console.warn("Sin facturas ETT", e); }
    const num = r => { for (const k of ["bruto","ss_empresa","coste_empresa","indemnizacion","paga_extra","coste_total","coste_ordinario","horas_presencia"]) r[k] = +r[k] || 0; return r; };
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
function grupoDe(p){ if (!p) return "Sin asignar"; const v = R.agr === "departamento" ? p.departamento : R.agr === "clasificacion" ? p.clasificacion : R.agr === "area" ? ((R.data.deps.find(d => d.nombre === p.departamento) || {}).area) : p.tipo_vinculo; return v || "Sin asignar"; }

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
function serieMensual(){
  const M = meses(), D = R.data;
  return M.map(m => {
    const N = D.nomina.filter(n => n.periodo === m), ett = sum(Object.values(ettMes(m)), x => x);
    const ord = sum(N, n => n.coste_ordinario), ind = sum(N, n => n.indemnizacion), ext = sum(N, n => n.paga_extra);
    const pers = new Set(N.filter(n => n.bruto || n.coste_total).map(n => n.codigo)).size;
    const ettN = new Set(D.act.filter(a => a.periodo === m).map(a => a.codigo)).size, ettD = sum(D.act.filter(a => a.periodo === m), a => a.dias);
    const horas = sum(N, n => n.horas_presencia);
    return { m, ord, ind, ext, nom: ord + ind + ext, ett, tot: ord + ind + ext + ett, pers, ettN, ettD, horas };
  });
}
function tabResumen(box){
  const S = serieMensual(); if (!S.length){ box.append(el("div","card empty","No hay datos de este año.")); return; }
  const u = S[S.length - 1], T = k => sum(S, s => s[k]);
  const k = el("div","kpis"); const kp = (t, v, s, cl) => { const d = el("div","kpi"+(cl?" "+cl:"")); d.append(el("small",null,t), el("b",null,v)); if (s) d.append(el("span","delta",s)); return d; };
  k.append(
    kp(`Coste total de personal ${R.anio}`, eur(T("tot")) + " €", `${mesLab(S[0].m)} – ${mesLab(u.m)} · nómina + ETT`),
    kp("Coste ordinario medio / mes", eur(T("ord") / S.length) + " €", "nómina sin indemnizaciones ni pagas extra"),
    kp(`Plantilla en nómina (${mesLab(u.m)})`, String(u.pers), `${eur(u.pers ? u.ord / u.pers : 0)} € coste medio por persona`),
    kp(`Personas ETT (${mesLab(u.m)})`, String(u.ettN), `${eur(u.ett)} € facturado`),
    kp(`Peso ETT (${mesLab(u.m)})`, pctf(u.tot ? u.ett / u.tot : null), `media del año ${pctf(T("tot") ? T("ett") / T("tot") : null)}`, u.tot && u.ett / u.tot > 0.18 ? "bad" : ""));
  box.append(k);

  const cc = el("div","charts"); const card = el("div","card chartcard"); card.append(el("h3",null,"Coste de personal por mes (€)")); const cv = el("canvas"); card.append(cv); cc.append(card);
  const card2 = el("div","card chartcard"); card2.append(el("h3",null,"Personas por mes")); const cv2 = el("canvas"); card2.append(cv2); cc.append(card2);
  box.append(cc);
  requestAnimationFrame(() => {
    if (!window.Chart || !cv.isConnected) return;
    const L = S.map(s => mesLab(s.m));
    charts.push(new Chart(cv, { type:"bar", data:{ labels:L, datasets:[
      { label:"Nómina ordinaria", data:S.map(s => Math.round(s.ord)), backgroundColor:COL.ord, stack:"a" },
      { label:"Indemnizaciones", data:S.map(s => Math.round(s.ind)), backgroundColor:COL.ind, stack:"a" },
      { label:"Paga extra", data:S.map(s => Math.round(s.ext)), backgroundColor:COL.ext, stack:"a" },
      { label:"ETT (sin IVA)", data:S.map(s => Math.round(s.ett)), backgroundColor:COL.ett, stack:"a" }]},
      options:{ maintainAspectRatio:false, plugins:{ legend:{ position:"bottom" }, tooltip:{ callbacks:{ label:c => `${c.dataset.label}: ${eur(c.raw)} €` } } }, scales:{ y:{ stacked:true, ticks:{ callback:v => eur(v) } }, x:{ stacked:true } } } }));
    charts.push(new Chart(cv2, { type:"bar", data:{ labels:L, datasets:[
      { label:"Nómina", data:S.map(s => s.pers), backgroundColor:COL.ord, stack:"p" }, { label:"ETT", data:S.map(s => s.ettN), backgroundColor:COL.ett, stack:"p" }]},
      options:{ maintainAspectRatio:false, plugins:{ legend:{ position:"bottom" } }, scales:{ y:{ stacked:true, beginAtZero:true }, x:{ stacked:true } } } }));
  });

  const filas = [
    ["Personas con nómina", s => s.pers, "n"], ["Nómina ordinaria", s => s.ord], ["Indemnizaciones", s => s.ind], ["Paga extra", s => s.ext],
    ["Total nómina", s => s.nom, "b"], ["ETT (base imponible)", s => s.ett], ["Coste total personal", s => s.tot, "b"],
    ["% ETT sobre el total", s => s.tot ? s.ett / s.tot : null, "p"], ["Coste ordinario medio por persona", s => s.pers ? s.ord / s.pers : null],
    ["Horas de presencia (nómina)", s => s.horas, "n"], ["Coste ordinario por hora", s => s.horas ? s.ord / s.horas : null, "d"],
    ["Personas ETT (según contratos)", s => s.ettN, "n"], ["Coste ETT por día-persona", s => s.ettD ? s.ett / s.ettD : null, "d"] ];
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"Concepto")); for (const s of S) hr.append(el("th","n",mesLab(s.m))); hr.append(el("th","n","Total"), el("th","n","Media")); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const [lab, f, tp] of filas){
    const tr = el("tr", tp === "b" ? "wk" : null); tr.append(el("td",null,lab)); const v = S.map(f);
    const fm = x => x == null ? "" : tp === "p" ? pctf(x) : tp === "n" ? String(Math.round(x)) : tp === "d" ? (+x).toLocaleString("es-ES",{maximumFractionDigits:0}) : eur(x);
    for (const x of v) tr.append(el("td","n",fm(x)));
    const tot = ["p","d"].includes(tp) || lab.startsWith("Coste ordinario medio") || lab.startsWith("Personas") ? null : v.reduce((a,b) => a + (b || 0), 0);
    const med = v.filter(x => x != null).length ? v.reduce((a,b) => a + (b || 0), 0) / v.filter(x => x != null).length : null;
    tr.append(el("td","n",tot == null ? "" : fm(tot)), el("td","n",fm(med))); tb.append(tr);
  }
  t.append(tb); tw.append(t); box.append(tw);
  const avisos = avisosEtt(S); if (avisos.length){ const c = el("div","card"); c.append(el("h3",null,"A revisar")); const ul = el("ul"); for (const a of avisos) ul.append(el("li",null,a)); c.append(ul); box.append(c); }
  box.append(el("p","hint","Nómina ordinaria = coste de empresa sin indemnizaciones ni la paga extra que se paga aparte (la de Navidad va prorrateada en cada nómina). ETT = facturas de las ETT en Tesorería, por mes de la factura, sin IVA. Las personas en IT pueden salir con coste bajo o negativo por el pago delegado."));
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

// ---------- Por sección ----------
function tabSeccion(box){
  const M = meses(), D = R.data;
  const c = el("div","ctrl");
  const sg = el("div","seg"); for (const [k,l] of [["departamento","Departamento"],["area","Área"],["clasificacion","Clasificación"],["tipo_vinculo","Vínculo"]]){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(R.agr === k)); b.addEventListener("click", () => { R.agr = k; render(); }); sg.append(b); }
  const d1 = el("div","fld"); d1.append(el("span",null,"Agrupar por"), sg); c.append(d1);
  const lb = el("label","chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = R.repartirEtt; cb.addEventListener("change", () => { R.repartirEtt = cb.checked; render(); }); lb.append(cb, " Incluir ETT repartida por días (estimación)"); c.append(lb);
  box.append(c);
  const G = new Map(), P = new Map();
  const add = (g, m, v, cod) => { const x = G.get(g) || {}; x[m] = (x[m] || 0) + v; G.set(g, x); const y = P.get(g) || {}; (y[m] = y[m] || new Set()).add(cod); P.set(g, y); };
  for (const n of D.nomina) if (M.includes(n.periodo)){ const p = D.porCodigo.get(n.codigo); add(grupoDe(p), n.periodo, n.coste_ordinario, (n.bruto || n.coste_total) ? n.codigo : null); }
  if (R.repartirEtt) for (const m of M){ const rp = repartoEtt(m); for (const [cod, v] of rp) add(grupoDe(D.porCodigo.get(cod)), m, v, cod); }
  const orden = R.agr === "departamento" ? new Map(D.deps.map((d,i) => [d.nombre, i])) : null;
  const filas = [...G.entries()].map(([g,x]) => ({ g, x, t:sum(M, m => x[m]) })).sort((a,b) => a.g === "Sin asignar" ? 1 : b.g === "Sin asignar" ? -1 : orden ? (orden.get(a.g) ?? 999) - (orden.get(b.g) ?? 999) : b.t - a.t);
  const TT = sum(filas, f => f.t);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); hr.append(el("th",null,"Grupo")); for (const m of M) hr.append(el("th","n",mesLab(m))); for (const h of ["Total","Media mes","Var. últ./1.º","% s/total","Personas (media)","Coste/persona mes"]) hr.append(el("th","n",h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const f of filas){
    const tr = el("tr"); tr.append(el("td",null,f.g)); for (const m of M) tr.append(el("td","n",eur(f.x[m])));
    const pm = M.map(m => ((P.get(f.g) || {})[m] || new Set()).size - (((P.get(f.g) || {})[m] || new Set()).has(null) ? 1 : 0));
    const pmed = sum(pm, x => x) / (M.length || 1), v0 = f.x[M[0]], v1 = f.x[M[M.length-1]];
    tr.append(el("td","n",eur(f.t)), el("td","n",eur(f.t / (M.length || 1))), el("td","n " + (v0 && v1 > v0 ? "up" : v0 && v1 < v0 ? "down" : ""), v0 ? varf(v1 / v0 - 1) : ""), el("td","n",pctf(TT ? f.t / TT : null)), el("td","n",pmed.toLocaleString("es-ES",{maximumFractionDigits:1})), el("td","n",eur(sum(pm,x=>x) ? f.t / sum(pm,x=>x) : null)));
    tb.append(tr);
  }
  const tr = el("tr","wk"); tr.append(el("td",null,"Total")); for (const m of M) tr.append(el("td","n",eur(sum(filas, f => f.x[m])))); tr.append(el("td","n",eur(TT)), el("td","n",eur(TT / (M.length || 1))), el("td"), el("td","n","100 %"), el("td"), el("td")); tb.append(tr);
  t.append(tb); tw.append(t);
  const cc = el("div","charts"); const card = el("div","card chartcard"); card.append(el("h3",null,"Coste ordinario por " + ({departamento:"departamento",area:"área",clasificacion:"clasificación",tipo_vinculo:"vínculo"})[R.agr] + " (€)")); const cv = el("canvas"); card.append(cv); cc.append(card); box.append(cc, tw);
  requestAnimationFrame(() => { if (!window.Chart || !cv.isConnected) return;
    charts.push(new Chart(cv, { type:"bar", data:{ labels:M.map(mesLab), datasets:filas.map((f,i) => ({ label:f.g, data:M.map(m => Math.round(f.x[m] || 0)), backgroundColor: f.g === "Sin asignar" ? "#D9D6CF" : PALETA[i % PALETA.length], stack:"s" })) },
      options:{ maintainAspectRatio:false, plugins:{ legend:{ position:"bottom", labels:{ boxWidth:12 } }, tooltip:{ callbacks:{ label:c => `${c.dataset.label}: ${eur(c.raw)} €` } } }, scales:{ x:{ stacked:true }, y:{ stacked:true, ticks:{ callback:v => eur(v) } } } } })); });
  const sa = filas.find(f => f.g === "Sin asignar");
  box.append(el("p","hint", (sa && TT ? `«Sin asignar» = personas sin ${R.agr === "departamento" || R.agr === "area" ? "departamento" : "clasificación"} en su ficha (${pctf(sa.t / TT)} del coste). Complétalo en «Ficha de personas». ` : "") + "Coste ordinario: sin indemnizaciones ni paga extra." + (R.repartirEtt ? " La ETT se reparte entre sus personas en activo según los días de contrato de cada mes: es una estimación." : "")));
}

// ---------- Por empleado ----------
function tabEmpleado(box){
  const M = meses(), D = R.data;
  const c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre o código"; q.value = R.fe.q; q.dataset.k = "rr-eq"; q.addEventListener("input", () => { R.fe.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const dd = el("div","fld"); const s = el("select"); s.append(new Option("Todos","")); for (const g of [...new Set(D.personas.map(p => p.departamento || "Sin asignar"))].sort()) s.append(new Option(g, g)); s.value = R.fe.dep; s.addEventListener("change", () => { R.fe.dep = s.value; render(); }); dd.append(el("span",null,"Departamento"), s); c.append(dd);
  box.append(c);
  const by = new Map(); for (const n of D.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = n; by.set(n.codigo, x); }
  const qq = R.fe.q.trim().toLowerCase();
  const L = [...by.entries()].map(([cod, x]) => ({ cod, x, p: D.porCodigo.get(cod) || { codigo:cod, nombre:"(sin ficha)" } }))
    .filter(r => (!qq || `${r.p.nombre} ${r.cod}`.toLowerCase().includes(qq)) && (!R.fe.dep || (r.p.departamento || "Sin asignar") === R.fe.dep))
    .map(r => ({ ...r, tot: sum(M, m => (r.x[m] || {}).coste_total), ord: sum(M, m => (r.x[m] || {}).coste_ordinario), nm: M.filter(m => r.x[m] && (r.x[m].bruto || r.x[m].coste_total)).length }))
    .sort((a,b) => b.tot - a.tot);
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr");
  for (const h of ["Código","Nombre","Departamento"]) hr.append(el("th",null,h)); for (const m of M) hr.append(el("th","n",mesLab(m))); for (const h of ["Total","Ordinario medio/mes","Meses"]) hr.append(el("th","n",h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const r of L){ const tr = el("tr"); tr.style.cursor = "pointer"; tr.title = "Abrir la ficha"; tr.addEventListener("click", () => { if (R.data.porCodigo.get(r.cod)) ficha(R.data.porCodigo.get(r.cod)); });
    tr.append(el("td",null,r.cod), el("td",null,r.p.nombre), el("td",null,r.p.departamento || "—"));
    for (const m of M){ const n = r.x[m]; const td = el("td","n", n ? eur(n.coste_total) : ""); if (n && (n.indemnizacion || n.paga_extra)){ td.title = `Incluye ${n.indemnizacion ? "indemnización " + eur(n.indemnizacion) + " €" : ""}${n.indemnizacion && n.paga_extra ? " y " : ""}${n.paga_extra ? "paga extra " + eur(n.paga_extra) + " €" : ""}`; td.style.fontWeight = "700"; } tr.append(td); }
    tr.append(el("td","n",eur(r.tot)), el("td","n",eur(r.nm ? r.ord / r.nm : 0)), el("td","n",String(r.nm))); tb.append(tr); }
  const tr = el("tr","wk"); tr.append(el("td"), el("td",null,`Total (${L.length} personas)`), el("td")); for (const m of M) tr.append(el("td","n",eur(sum(L, r => (r.x[m] || {}).coste_total)))); tr.append(el("td","n",eur(sum(L, r => r.tot))), el("td"), el("td")); tb.append(tr);
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Coste de empresa real de cada mes (incluye indemnizaciones y paga extra, en negrita). Pulsa una fila para abrir la ficha."));
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
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Código","Nombre","Vínculo","Clasif.","Departamento","Puesto / categoría","Contrato","Alta","Baja","Pendiente"]) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const p of L){ const tr = el("tr", activa(p) ? null : "paid"); tr.style.cursor = "pointer"; tr.addEventListener("click", () => ficha(p));
    const pend = pendientes(p); const tp = el("td"); for (const x of pend) { tp.append(el("span","tag warn",x), " "); }
    tr.append(el("td",null,p.codigo), el("td",null,p.nombre), el("td",null,p.tipo_vinculo + (p.empresa_ett ? " · " + p.empresa_ett : "")), el("td",null,p.clasificacion || ""), el("td",null,p.departamento || ""), el("td",null,p.puesto || p.categoria || ""), el("td",null,p.tipo_contrato || ""), el("td",null,fec(p.fecha_alta)), el("td",null,fec(p.fecha_baja) + (p.motivo_baja ? ` (${p.motivo_baja})` : "")), tp);
    tb.append(tr); }
  if (!L.length){ const tr = el("tr"); const td = el("td","empty","No hay personas con estos filtros."); td.colSpan = 10; tr.append(td); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa una persona para ver o editar su ficha. Al dar de alta se piden la clasificación, el departamento, el tipo de contrato y la fecha de alta; en ETT, además, la empresa y la fecha de fin prevista."));
}

// Diálogo de ficha (alta, edición, baja y periodos ETT)
async function ficha(p){
  const nueva = !p, ed = puede(), D = R.data;
  let dlg = document.getElementById("dlgPersona"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgPersona"; dlg.style.maxWidth = "680px"; document.body.append(dlg);
  const f = el("form"); f.method = "dialog"; f.noValidate = true; dlg.append(f);
  f.append(el("h2",null, nueva ? "Nueva persona" : p.nombre), el("p","sub", nueva ? "Los campos con * son obligatorios." : `${p.codigo} · ${p.tipo_vinculo}${p.empresa_ett ? " · " + p.empresa_ett : ""}`));
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
  f.append(fila(campo("puesto","Puesto","text"), campo("categoria","Categoría","text")));
  f.append(fila(campo("tipo_contrato","Tipo de contrato","select",CONTRATOS,true), campo("fecha_alta","Fecha de alta","date",null,true)));
  let finPrev = null;
  if (nueva){ const d = el("div","f"); d.dataset.f = "fin"; finPrev = el("input"); finPrev.type = "date"; d.append(el("label",null,"Fin previsto del contrato (ETT) *"), finPrev, el("span","hint","")); blkEtt.append(d); }
  f.append(fila(campo("fecha_baja","Fecha de baja","date"), campo("motivo_baja","Motivo de la baja","select",MOTIVOS)));
  f.append(campo("observaciones","Observaciones","area"));
  // código de nómina vs ETT
  const syncV = () => { const ett = I.tipo_vinculo.value === "ETT"; blkEtt.hidden = !ett; blkNom.hidden = ett; if (ett && nueva && !I.codigo.value){ const sc = sigCodigoEtt(); for (const x of f.querySelectorAll('[data-f="codigo"] input')) x.value = sc; } if (ett && !I.tipo_contrato.value) I.tipo_contrato.value = "Puesta a disposición (ETT)"; };
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
    const N = D.nomina.filter(n => n.codigo === p.codigo); if (N.length){ f.append(el("p","hint",`Nómina: ${N.length} meses cargados, coste total ${eur(sum(N, n => n.coste_total))} €, último ${mesLab(N[N.length-1].periodo)}.`)); }
  }
  const err = el("span","err"); f.append(err);
  const acts = el("div","actions"); const cn = el("button","btn", ed ? "Cancelar" : "Cerrar"); cn.type = "button"; cn.addEventListener("click", () => dlg.close()); acts.append(cn);
  if (ed){ const ok = el("button","btn primary", nueva ? "Dar de alta" : "Guardar"); acts.append(ok); }
  f.append(acts);
  f.addEventListener("submit", async e => { e.preventDefault(); if (!ed) return;
    const val = {}; for (const k of Object.keys(I)) val[k] = (I[k].value || "").trim() || null; if (val.departamento === "__nuevo") val.departamento = null;
    const ett = val.tipo_vinculo === "ETT"; for (const d of f.querySelectorAll(".f")) d.classList.remove("miss");
    const falta = [["nombre"],["tipo_vinculo"],["codigo"],["clasificacion"],["departamento"],["tipo_contrato"],["fecha_alta"]].concat(ett ? [["empresa_ett"]] : []).map(x => x[0]).filter(k => !val[k]);
    if (nueva && ett && !finPrev.value) falta.push("fin");
    if (val.fecha_baja && !val.motivo_baja) falta.push("motivo_baja");
    if (falta.length){ for (const k of falta){ const d = f.querySelector(`[data-f="${k}"]:not([hidden] *)`) || f.querySelector(`[data-f="${k}"]`); if (d){ d.classList.add("miss"); d.querySelector(".hint").textContent = "Obligatorio"; } } err.textContent = "Faltan datos obligatorios."; return; }
    if (val.fecha_baja && val.fecha_alta && val.fecha_baja < val.fecha_alta){ err.textContent = "La baja no puede ser anterior al alta."; return; }
    const row = { nombre:val.nombre, tipo_vinculo:val.tipo_vinculo, empleador: ett ? val.empresa_ett : (val.empleador || "B10"), empresa_ett: ett ? val.empresa_ett : null, clasificacion:val.clasificacion, departamento:val.departamento,
      puesto:val.puesto, categoria:val.categoria, tipo_contrato:val.tipo_contrato, fecha_alta:val.fecha_alta, fecha_baja:val.fecha_baja, motivo_baja: val.fecha_baja ? val.motivo_baja : null, observaciones:val.observaciones };
    let r;
    if (nueva){ row.codigo = val.codigo; r = await sch().from("personas").insert(row).select("id").single();
      if (!r.error && ett) await sch().from("ett_periodos").insert({ persona_id:r.data.id, empresa_ett:val.empresa_ett, fecha_inicio:val.fecha_alta, fecha_fin:finPrev.value }); }
    else r = await sch().from("personas").update(row).eq("id", p.id);
    if (r.error){ console.error(r.error); err.textContent = r.error.code === "23505" ? "Ya existe una persona con ese código." : "No se ha podido guardar: " + r.error.message; return; }
    toast(nueva ? "Persona dada de alta" : "Ficha guardada"); dlg.close(); recargar();
  });
  dlg.showModal();
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
    const acc = ids.map(() => ({ bruto:0, ss_empresa:0, coste_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0 }));
    for (const r of A.slice(hi + 4)){ if (!r) continue; const lab = txt(r[2]) || txt(r[1]); if (!lab) continue;
      const k = lab === "TOTAL BRUTO" ? "bruto" : lab === "SEGURIDAD SOCIAL EMPRESA" ? "ss_empresa" : lab === "COSTE EMPRESA" ? "coste_empresa" : /^Indemnizaci/i.test(lab) ? "indemnizacion"
        : lab === "HORAS PRESENCIA" ? "horas_presencia" : /^(Enfermedad|Prest\.Enfermedad|Complemento I\.T|Complemento Enfermedad)/i.test(lab) ? "it_enfermedad" : /^Parte Proporcional Vacaciones/i.test(lab) ? "vacaciones_finiquito" : null;
      if (!k) continue; ids.forEach((_, i) => { const v = +r[4 + i]; if (isFinite(v)) acc[i][k] += v; }); }
    const round = x => Math.round(x * 100) / 100;
    const total = acc.reduce((s, a) => s + a.coste_empresa, 0);
    const nuevos = ids.map((c, i) => ({ c, n: nom[i] })).filter(x => !R.data.porCodigo.has(x.c));
    const msg = extra ? `Fichero de PAGA EXTRA de ${mesLab(periodo)}: ${ids.length} personas, ${eur(total)} €. Se guarda como paga extra del mes (no toca la nómina ordinaria).`
      : `Nómina ordinaria de ${mesLab(periodo)}: ${ids.length} personas, coste de empresa ${eur(total)} €. Si ya estaba cargada, se sustituye.\n\nOjo: si es el fichero de «totales» (nómina + paga extra), no lo cargues: sube la nómina ordinaria y la paga extra por separado.`;
    if (!confirm(msg + (nuevos.length ? `\n\n${nuevos.length} personas nuevas se darán de alta con ficha incompleta: ${nuevos.map(x => x.n).join(", ")}.` : "") + "\n\n¿Continuar?")){ set(""); return; }
    if (nuevos.length){ const r = await sch().from("personas").insert(nuevos.map(x => ({ codigo:x.c, nombre: x.n.toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()), tipo_vinculo:"Nómina", empleador:"B10", observaciones:`Alta automática al cargar la nómina de ${mesLab(periodo)}` }))); if (r.error) throw r.error; }
    const c = await sb.schema("core").from("cargas").insert({ tipo:"rrhh_nomina", fichero:file.name, periodo:periodo.slice(0,7) + (extra ? " extra" : ""), filas:ids.length, importe_total:round(total), notas:"Carga desde la app" }).select("id").single();
    if (c.error) throw c.error;
    const rows = ids.map((cod, i) => extra ? { periodo, codigo:cod, paga_extra:round(acc[i].coste_empresa) }
      : Object.assign({ periodo, codigo:cod, carga_id:c.data.id }, Object.fromEntries(Object.entries(acc[i]).map(([k,v]) => [k, round(v)]))));
    if (!extra){ const del = await sch().from("nomina_mensual").update({ coste_empresa:0, bruto:0, ss_empresa:0, indemnizacion:0, it_enfermedad:0, vacaciones_finiquito:0, horas_presencia:0 }).eq("periodo", periodo).not("codigo","in",`(${ids.map(x => `"${x}"`).join(",")})`); if (del.error) throw del.error; }
    const up = await sch().from("nomina_mensual").upsert(rows, { onConflict:"periodo,codigo" }); if (up.error) throw up.error;
    set(`Hecho: ${extra ? "paga extra" : "nómina"} de ${mesLab(periodo)} cargada (${ids.length} personas${nuevos.length ? `, ${nuevos.length} altas nuevas: completa su ficha` : ""}).`);
    toast("Nómina cargada"); if (nuevos.length){ R.tab = "personas"; R.f.incompletas = true; } recargar();
  } catch(e){ console.error(e); set("No se ha podido cargar: " + (e.message || "error")); }
}

// ---------- Exportar ----------
function exportar(){
  const wb = XLSX.utils.book_new(), M = meses(), S = serieMensual();
  const A = [["Mes","Personas nómina","Nómina ordinaria","Indemnizaciones","Paga extra","Total nómina","ETT sin IVA","Coste total","% ETT","Personas ETT"]];
  for (const s of S) A.push([mesLab(s.m), s.pers, Math.round(s.ord), Math.round(s.ind), Math.round(s.ext), Math.round(s.nom), Math.round(s.ett), Math.round(s.tot), s.tot ? Math.round(s.ett / s.tot * 1000) / 1000 : 0, s.ettN]);
  XLSX.utils.book_append_sheet(wb, sheet(A, [10,10,14,14,12,14,12,14,8,10]), "Resumen");
  const B = [["Código","Nombre","Vínculo","Empresa ETT","Clasificación","Departamento","Puesto","Categoría","Contrato","Alta","Baja","Motivo baja","Pendiente"]];
  for (const p of R.data.personas) B.push([p.codigo, p.nombre, p.tipo_vinculo, p.empresa_ett || "", p.clasificacion || "", p.departamento || "", p.puesto || "", p.categoria || "", p.tipo_contrato || "", p.fecha_alta || "", p.fecha_baja || "", p.motivo_baja || "", pendientes(p).join(", ")]);
  XLSX.utils.book_append_sheet(wb, sheet(B, [9,32,9,12,10,20,18,14,22,11,11,20,30]), "Personas");
  const C = [["Código","Nombre","Clasificación","Departamento", ...M.map(mesLab), "Total"]];
  const by = new Map(); for (const n of R.data.nomina) if (M.includes(n.periodo)){ const x = by.get(n.codigo) || {}; x[n.periodo] = n.coste_total; by.set(n.codigo, x); }
  for (const [cod, x] of by){ const p = R.data.porCodigo.get(cod) || {}; C.push([cod, p.nombre || "", p.clasificacion || "", p.departamento || "", ...M.map(m => Math.round((x[m] || 0) * 100) / 100), Math.round(sum(M, m => x[m]) * 100) / 100]); }
  XLSX.utils.book_append_sheet(wb, sheet(C, [9,32,10,20, ...M.map(() => 11), 12]), "Coste por empleado");
  saveXlsx(wb, `Costes_personal_${stamp()}.xlsx`);
}
