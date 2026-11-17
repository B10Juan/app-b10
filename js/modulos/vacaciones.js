// APP B10 · Personas: vacaciones
// Calendario por año (días por defecto, días laborables y festivos), saldo por persona (días del año y pendientes
// de años anteriores) y periodos de vacaciones. Los periodos se guardan en rrhh.ausencias con tipo «Vacaciones».
// Siempre se descuentan primero los días de años anteriores. Informe en PDF por trabajador (jsPDF).
// Datos: migración 27. Permiso del módulo: «vacaciones».
import { sb, render, cabecera, nivel } from "../app.js";
import { el, toast, safe, exportarVista } from "../util.js";

const V = { anio:null, tab:"panel", data:null, loading:false, f:{ q:"", vinculo:"Nómina", dep:"", estado:"todos" } };
const sch = () => sb.schema("rrhh");
const puede = () => nivel("vacaciones") === "editar";
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DSEM = ["L","M","X","J","V","S","D"];
const TIPOS_FEST = ["Nacional","Autonómico","Local","Empresa"];
const fec = k => k ? `${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(0,4)}` : "";
const ymd = d => d.toISOString().slice(0,10);
const hoyKey = (() => { const d = new Date(), p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
const dsem = k => { const w = new Date(k + "T00:00:00Z").getUTCDay(); return w === 0 ? 7 : w; }; // 1 lunes … 7 domingo
const num = v => { const n = Math.round(v * 100) / 100; return Number.isInteger(n) ? String(n) : n.toLocaleString("es-ES"); };

async function cargar(){
  V.loading = true;
  try{
    const q = async (t, sel, ord) => { const r = await sch().from(t).select(sel).order(ord); if (r.error) throw r.error; return r.data; };
    const [cals, fest, saldos, personas, vac] = await Promise.all([
      q("vac_calendarios","*","anio"), q("vac_festivos","*","fecha"), q("vac_saldos","*","anio"),
      q("personas","id,codigo,nombre,tipo_vinculo,empresa_ett,departamento,puesto,fecha_alta,fecha_baja","codigo"),
      (async () => { const r = await sch().from("ausencias").select("*").eq("tipo","Vacaciones").order("fecha_inicio"); if (r.error) throw r.error; return r.data; })(),
    ]);
    V.data = { cals, fest, saldos, personas, vac: vac.map(a => ({ ...a, dias: a.dias == null ? null : +a.dias })) };
    for (const s of saldos){ s.dias_anio = +s.dias_anio; s.dias_anteriores = +s.dias_anteriores; }
    if (!V.anio || !cals.some(c => c.anio === V.anio)) V.anio = cals.some(c => c.anio === 2027) ? 2027 : (cals.length ? cals[cals.length - 1].anio : null);
  } catch(e){ console.error(e); toast("No se han podido cargar las vacaciones."); V.data = { cals:[], fest:[], saldos:[], personas:[], vac:[] }; }
  V.loading = false; render();
}
const recargar = () => { V.data = null; render(); };

// ---------- Cálculos ----------
function cal(anio){
  const c = V.data.cals.find(x => x.anio === anio); if (!c) return null;
  return { anio, defecto:+c.dias_defecto, lab:new Set((c.laborables || [1,2,3,4,5]).map(Number)), fest:new Map(V.data.fest.filter(f => f.anio === anio).map(f => [f.fecha, f])) };
}
// días laborables de un rango dentro del año (sin fines de semana ni festivos del calendario)
function diasLab(ini, fin, C){
  const a = ini > `${C.anio}-01-01` ? ini : `${C.anio}-01-01`, b = fin < `${C.anio}-12-31` ? fin : `${C.anio}-12-31`; if (b < a) return 0;
  let n = 0; for (let d = new Date(a + "T00:00:00Z"); ymd(d) <= b; d.setUTCDate(d.getUTCDate() + 1)){ const k = ymd(d); if (C.lab.has(dsem(k)) && !C.fest.has(k)) n++; }
  return n;
}
const enAnio = (a, anio) => a.fecha_inicio <= `${anio}-12-31` && (a.fecha_fin || a.fecha_inicio) >= `${anio}-01-01`;
const diasPeriodo = (a, C) => a.dias != null ? a.dias : diasLab(a.fecha_inicio, a.fecha_fin || a.fecha_inicio, C);
function saldo(p, C){
  const s = V.data.saldos.find(x => x.anio === C.anio && x.persona_id === p.id);
  return s ? { dias_anio:s.dias_anio, dias_anteriores:s.dias_anteriores, observaciones:s.observaciones || "", existe:true } : { dias_anio:C.defecto, dias_anteriores:0, observaciones:"", existe:false };
}
// resumen de una persona: se descuentan primero los días de años anteriores, por orden de fechas
function resumen(p, C){
  const s = saldo(p, C), per = V.data.vac.filter(a => a.persona_id === p.id && enAnio(a, C.anio)).sort((a,b) => a.fecha_inicio < b.fecha_inicio ? -1 : 1);
  let quedaAnt = s.dias_anteriores; const P = [];
  for (const a of per){ const d = diasPeriodo(a, C), deAnt = Math.max(0, Math.min(d, quedaAnt)); quedaAnt -= deAnt; P.push({ a, dias:d, deAnt, deAnio:d - deAnt }); }
  const disfr = P.reduce((t, x) => t + x.dias, 0), usadoAnt = s.dias_anteriores - quedaAnt;
  return { s, P, ant:s.dias_anteriores, anio:s.dias_anio, total:s.dias_anteriores + s.dias_anio, disfr, pendAnt:quedaAnt, pendAnio:s.dias_anio - (disfr - usadoAnt), pend:s.dias_anteriores + s.dias_anio - disfr };
}
function personasAnio(C){
  const a = `${C.anio}-01-01`, b = `${C.anio}-12-31`;
  return V.data.personas.filter(p => ((!p.fecha_alta || p.fecha_alta <= b) && (!p.fecha_baja || p.fecha_baja >= a)) || V.data.saldos.some(s => s.anio === C.anio && s.persona_id === p.id) || V.data.vac.some(x => x.persona_id === p.id && enAnio(x, C.anio)));
}

// ---------- Pantalla ----------
export function renderVacaciones(app){
  document.title = "Personas: vacaciones";
  cabecera(app, "Vacaciones", "Días de vacaciones por trabajador: del año, pendientes de años anteriores, disfrutados y pendientes, con informe en PDF.", { txt:"Personas", href:"#personas" }, "vacaciones");
  const box = el("div","pad vac"); box.style.paddingBottom = "32px"; app.append(box);
  if (!V.data){ if (!V.loading) cargar(); box.append(el("div","card empty","Cargando vacaciones…")); return; }
  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  for (const [k,t] of [["panel","Panel de vacaciones"],["calendario","Calendario y festivos"]]){ const a = el("a",null,t); a.href = "#vacaciones"; if (V.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); V.tab = k; render(); }); nav.append(a); }
  const acc = el("span"); acc.style.cssText = "margin-left:auto;display:flex;gap:8px";
  const exv = el("button","btn small","Exportar vista a Excel"); exv.addEventListener("click", () => exportarVista(box, V.tab === "panel" ? `Vacaciones ${V.anio}` : `Festivos ${V.anio}`)); acc.append(exv); nav.append(acc);
  box.append(nav);
  // años
  const c = el("div","ctrl"); const sAn = el("div","seg");
  for (const x of V.data.cals){ const b = el("button",null,String(x.anio)); b.type = "button"; b.setAttribute("aria-pressed", String(x.anio === V.anio)); b.addEventListener("click", () => { V.anio = x.anio; render(); }); sAn.append(b); }
  if (V.data.cals.length){ const d = el("div","fld"); d.append(el("span",null,"Año"), sAn); c.append(d); }
  if (puede()){ const a = el("div","acc"); const nb = el("button","btn small", V.data.cals.length ? `Nuevo calendario ${(V.data.cals[V.data.cals.length - 1].anio) + 1}` : "Nuevo calendario"); nb.type = "button"; nb.addEventListener("click", nuevoAnio); a.append(nb); c.append(a); }
  box.append(c);
  const C = V.anio ? cal(V.anio) : null;
  if (!C){ box.append(el("div","card empty","Todavía no hay calendario de vacaciones. Pulsa «Nuevo calendario».")); return; }
  if (V.tab === "calendario") tabCalendario(box, C); else tabPanel(box, C);
}

function tabPanel(box, C){
  const F = V.f, c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre o código"; q.value = F.q; q.dataset.k = "vac-q"; q.addEventListener("input", () => { F.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const seg = (lab, key, opts) => { const s = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(F[key] === k)); b.addEventListener("click", () => { F[key] = k; render(); }); s.append(b); } const d = el("div","fld"); d.append(el("span",null,lab), s); return d; };
  c.append(seg("Vínculo","vinculo",[["Nómina","Nómina"],["ETT","ETT"],["","Todos"]]), seg("Mostrar","estado",[["todos","Todos"],["pendientes","Con días pendientes"],["exceso","Con exceso"]]));
  const deps = [...new Set(V.data.personas.map(p => p.departamento).filter(Boolean))].sort();
  const dd = el("div","fld"); const ds = el("select"); ds.append(new Option("Todos","")); for (const d of deps) ds.append(new Option(d, d)); ds.value = F.dep; ds.addEventListener("change", () => { F.dep = ds.value; render(); }); dd.append(el("span",null,"Departamento"), ds); c.append(dd);
  const a = el("div","acc"); const pdf = el("button","btn small","Informe PDF de la lista"); pdf.type = "button"; pdf.title = "Un PDF con una página por trabajador de la lista";
  a.append(pdf); c.append(a); box.append(c);
  const qq = F.q.trim().toLowerCase();
  const L = personasAnio(C).filter(p => (!F.vinculo || p.tipo_vinculo === F.vinculo) && (!F.dep || p.departamento === F.dep) && (!qq || `${p.nombre} ${p.codigo}`.toLowerCase().includes(qq)))
    .map(p => ({ p, r:resumen(p, C) })).filter(x => F.estado === "todos" || (F.estado === "pendientes" ? x.r.pend > 0 : x.r.pend < 0))
    .sort((x, y) => x.p.nombre.localeCompare(y.p.nombre, "es"));
  pdf.addEventListener("click", () => informePdf(L.map(x => x.p), C));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr");
  for (const [h, n] of [["Código",0],["Trabajador",0],["Departamento",0],["Días vacaciones años anteriores",1],[`Días vacaciones año ${C.anio}`,1],["Total días vacaciones",1],[`Días disfrutados ${C.anio}`,1],["Días pendientes por disfrutar",1],["De ellos, de años anteriores",1]]){ const th = el("th", n ? "n" : null, h); hr.append(th); }
  t.append(el("thead")); t.tHead.append(hr); const tb = el("tbody"); const tot = { ant:0, anio:0, total:0, disfr:0, pend:0, pendAnt:0 };
  for (const { p, r } of L){ const tr = el("tr"); tr.style.cursor = "pointer"; tr.addEventListener("click", () => detalle(p, C));
    const pend = el("td","n", num(r.pend)); pend.style.fontWeight = "700"; if (r.pend < 0){ pend.style.color = "var(--red)"; pend.title = "Ha cogido más días de los que tiene"; }
    const pa = el("td","n", r.pendAnt ? num(r.pendAnt) : ""); if (r.pendAnt) { pa.title = "Días de años anteriores aún sin gastar"; }
    tr.append(el("td",null,p.codigo), el("td",null,p.nombre), el("td",null,p.departamento || ""), el("td","n", num(r.ant)), el("td","n", num(r.anio)), el("td","n", num(r.total)), el("td","n", num(r.disfr)), pend, pa);
    tb.append(tr); for (const k of Object.keys(tot)) tot[k] += r[k]; }
  if (!L.length){ const tr = el("tr"); const td = el("td","empty","No hay trabajadores con estos filtros."); td.colSpan = 9; tr.append(td); tb.append(tr); }
  else { const tr = el("tr","wk"); tr.append(el("td"), el("td",null,`Total (${L.length})`), el("td")); for (const k of ["ant","anio","total","disfr","pend","pendAnt"]) tr.append(el("td","n", num(tot[k]))); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  box.append(el("p","hint",`Pulsa un trabajador para ver el detalle, cambiar sus días y apuntar vacaciones. Los días se cuentan en días laborables del calendario ${C.anio} (sin fines de semana ni festivos) y se descuentan primero los de años anteriores. Por defecto cada trabajador tiene ${num(C.defecto)} días; se cambia en su ficha de vacaciones.`));
}

// ---------- Detalle del trabajador ----------
function detalle(p, C){
  const ed = puede(); let dlg = document.getElementById("dlgVac"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgVac"; dlg.style.cssText = "max-width:860px;width:96vw;max-height:92vh;overflow:auto"; document.body.append(dlg);
  const f = el("form"); f.method = "dialog"; f.noValidate = true; dlg.append(f);
  const r = resumen(p, C);
  f.append(el("h2",null,p.nombre), el("p","sub",`${p.codigo} · ${p.departamento || "sin departamento"}${p.puesto ? " · " + p.puesto : ""} · Vacaciones ${C.anio}`));
  // saldo
  const sc = el("div","card"); sc.style.margin = "4px 0 12px";
  const iA = el("input"); iA.type = "number"; iA.step = "0.5"; iA.min = "0"; iA.value = r.anio; iA.disabled = !ed;
  const iP = el("input"); iP.type = "number"; iP.step = "0.5"; iP.min = "0"; iP.value = r.ant; iP.disabled = !ed;
  const iO = el("input"); iO.value = r.s.observaciones; iO.placeholder = "Ej.: alta en marzo, días proporcionales"; iO.disabled = !ed;
  const fld = (lab, n, hint) => { const x = el("div","f"); x.append(el("label",null,lab), n); if (hint) x.append(el("span","hint",hint)); return x; };
  const g = el("div","f2"); g.append(fld(`Días de vacaciones ${C.anio}`, iA, `Por defecto ${num(C.defecto)} días laborables`), fld("Días pendientes de años anteriores", iP, "Se descuentan antes que los del año"));
  sc.append(el("b",null,"Días de vacaciones"), g, fld("Observaciones", iO));
  if (ed){ const sv = el("button","btn small primary","Guardar días"); sv.type = "button"; sv.addEventListener("click", async () => {
      const da = +iA.value, dp = +iP.value; if (!(da >= 0) || !(dp >= 0)) return toast("Revisa los días: tienen que ser números positivos");
      const q = await sch().from("vac_saldos").upsert({ anio:C.anio, persona_id:p.id, dias_anio:da, dias_anteriores:dp, observaciones:iO.value.trim() || null });
      if (q.error){ console.error(q.error); return toast("No se han podido guardar los días"); } toast("Días guardados"); dlg.close(); await recargarYabrir(p); });
    sc.append(sv); }
  f.append(sc);
  // resumen
  const k = el("div","kpis"); const kp = (t, v, s, rojo) => { const d = el("div","kpi"); const b = el("b",null,v); if (rojo) b.style.color = "var(--red)"; d.append(el("small",null,t), b); if (s) d.append(el("span","delta",s)); return d; };
  k.append(kp("Total días", num(r.total), `${num(r.ant)} de años anteriores + ${num(r.anio)} de ${C.anio}`), kp("Disfrutados", num(r.disfr), `${r.P.length} periodo${r.P.length === 1 ? "" : "s"}`),
    kp("Pendientes", num(r.pend), r.pend < 0 ? "ha cogido más días de los que tiene" : `${num(r.pendAnt)} de años anteriores · ${num(r.pendAnio)} de ${C.anio}`, r.pend < 0));
  f.append(k);
  // periodos
  f.append(el("h3",null,"Vacaciones apuntadas"));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Desde","Hasta","Días","De años anteriores",`De ${C.anio}`,"Observaciones", ed ? "" : null].filter(x => x !== null)) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  for (const x of r.P){ const a = x.a, tr = el("tr");
    const ob = (a.observaciones || "") + (a.fecha_inicio > hoyKey ? (a.observaciones ? " · " : "") + "programado" : "") + (a.dias != null ? (a.observaciones || a.fecha_inicio > hoyKey ? " · " : "") + "días ajustados a mano" : "");
    tr.append(el("td",null,fec(a.fecha_inicio)), el("td",null,fec(a.fecha_fin || a.fecha_inicio)), el("td","n",num(x.dias)), el("td","n", x.deAnt ? num(x.deAnt) : ""), el("td","n", x.deAnio ? num(x.deAnio) : ""), el("td",null,ob));
    if (ed){ const td = el("td"); const del = el("button","btn small","Eliminar"); del.type = "button"; del.addEventListener("click", async () => { if (!confirm(`¿Eliminar las vacaciones del ${fec(a.fecha_inicio)} al ${fec(a.fecha_fin)}?`)) return; const q = await sch().from("ausencias").delete().eq("id", a.id); if (q.error) return toast("No se ha podido eliminar"); toast("Vacaciones eliminadas"); dlg.close(); await recargarYabrir(p); }); td.append(del); tr.append(td); }
    tb.append(tr); }
  if (!r.P.length){ const tr = el("tr"); const td = el("td","empty","Sin vacaciones apuntadas en " + C.anio + "."); td.colSpan = ed ? 7 : 6; tr.append(td); tb.append(tr); }
  t.append(tb); tw.append(t); f.append(tw);
  // alta de un periodo
  let selIni = null;
  const iD = el("input"); iD.type = "date"; iD.min = `${C.anio}-01-01`; iD.max = `${C.anio}-12-31`;
  const iH = el("input"); iH.type = "date"; iH.min = `${C.anio}-01-01`; iH.max = `${C.anio}-12-31`;
  const iN = el("input"); iN.type = "number"; iN.step = "0.5"; iN.min = "0"; const iOb = el("input"); iOb.placeholder = "Opcional";
  const calc = el("span","hint");
  const recalc = () => { if (iD.value && iH.value && iH.value >= iD.value){ const n = diasLab(iD.value, iH.value, C); iN.placeholder = String(n); calc.textContent = `${n} días laborables según el calendario${iN.value ? ` · se apuntarán ${iN.value} (ajuste manual)` : ""}.`; } else { iN.placeholder = ""; calc.textContent = ""; } };
  iD.addEventListener("change", () => { if (iD.value && (!iH.value || iH.value < iD.value)) iH.value = iD.value; recalc(); }); iH.addEventListener("change", recalc); iN.addEventListener("input", recalc);
  if (ed){
    const ac = el("div","card"); ac.style.margin = "12px 0"; ac.append(el("b",null,"Apuntar vacaciones"));
    const g2 = el("div","f2"); g2.append(fld("Desde", iD), fld("Hasta", iH)); const g3 = el("div","f2"); g3.append(fld("Días (solo si hay que ajustarlos, p. ej. medio día)", iN), fld("Observaciones", iOb));
    const add = el("button","btn small primary","Añadir vacaciones"); add.type = "button";
    add.addEventListener("click", async () => {
      if (!iD.value) return iD.focus(); const ini = iD.value, fin = iH.value || iD.value;
      if (fin < ini) return toast("La fecha «hasta» es anterior a «desde»");
      if (ini.slice(0,4) !== String(C.anio) || fin.slice(0,4) !== String(C.anio)) return toast(`Las fechas tienen que ser de ${C.anio}. Si las vacaciones cruzan el año, apúntalas en dos partes.`);
      const choque = V.data.vac.find(a => a.persona_id === p.id && a.fecha_inicio <= fin && (a.fecha_fin || a.fecha_inicio) >= ini);
      if (choque) return toast(`Se solapa con las vacaciones del ${fec(choque.fecha_inicio)} al ${fec(choque.fecha_fin)}`);
      const dias = iN.value !== "" ? +iN.value : null, n = dias != null ? dias : diasLab(ini, fin, C);
      if (!(n > 0)) return toast("Ese rango no tiene días laborables (fin de semana o festivo)");
      if (n > r.pend && !confirm(`Con estos ${num(n)} días se pasa de los ${num(r.pend)} pendientes. ¿Apuntar igualmente?`)) return;
      const q = await sch().from("ausencias").insert({ persona_id:p.id, tipo:"Vacaciones", fecha_inicio:ini, fecha_fin:fin, dias, observaciones:iOb.value.trim() || null });
      if (q.error){ console.error(q.error); return toast("No se han podido guardar las vacaciones"); }
      toast(`${num(n)} días de vacaciones apuntados`); dlg.close(); await recargarYabrir(p); });
    ac.append(g2, g3, calc, add, el("p","hint","También puedes pulsar en el calendario: primer clic, fecha «desde»; segundo clic, fecha «hasta»."));
    f.append(ac);
  }
  // calendario del año
  f.append(el("h3",null,`Calendario ${C.anio}`));
  f.append(calendarioAnual(C, r.P.map(x => x.a), ed ? k => { if (!selIni || iH.value){ selIni = k; iD.value = k; iH.value = ""; } else { if (k < selIni){ iH.value = selIni; iD.value = k; } else iH.value = k; selIni = null; } recalc(); } : null));
  const acts = el("div","actions"); const pdf = el("button","btn","Informe PDF"); pdf.type = "button"; pdf.addEventListener("click", () => informePdf([p], C));
  const cl = el("button","btn primary","Cerrar"); cl.type = "button"; cl.addEventListener("click", () => dlg.close()); acts.append(pdf, cl); f.append(acts);
  dlg.showModal();
}
async function recargarYabrir(p){ V.data = null; await cargar(); const pp = V.data.personas.find(x => x.id === p.id); if (pp) detalle(pp, cal(V.anio)); }

// Calendario de 12 meses: vacaciones, festivos y días no laborables
function calendarioAnual(C, periodos, alPulsar){
  const vac = new Set(); for (const a of periodos){ for (let d = new Date(a.fecha_inicio + "T00:00:00Z"); ymd(d) <= (a.fecha_fin || a.fecha_inicio); d.setUTCDate(d.getUTCDate() + 1)){ const k = ymd(d); if (C.lab.has(dsem(k)) && !C.fest.has(k)) vac.add(k); } }
  const w = el("div","vac-cal");
  for (let m = 0; m < 12; m++){
    const mb = el("div","vac-mes"); mb.append(el("b",null,MESES[m]));
    const g = el("div","vac-dias"); for (const d of DSEM) g.append(el("span","vac-h",d));
    const pri = `${C.anio}-${String(m + 1).padStart(2,"0")}-01`; for (let i = 1; i < dsem(pri); i++) g.append(el("span"));
    const nd = new Date(Date.UTC(C.anio, m + 1, 0)).getUTCDate();
    for (let d = 1; d <= nd; d++){ const k = `${C.anio}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const s = el(alPulsar ? "button" : "span","vac-d", String(d)); if (alPulsar){ s.type = "button"; s.addEventListener("click", () => alPulsar(k)); }
      if (C.fest.has(k)){ s.classList.add("fest"); s.title = C.fest.get(k).descripcion; } else if (!C.lab.has(dsem(k))) s.classList.add("nolab");
      if (vac.has(k)) s.classList.add("vac"); if (k === hoyKey) s.classList.add("hoy");
      g.append(s); }
    mb.append(g); w.append(mb); }
  const ley = el("div","vac-ley"); for (const [c, t] of [["vac","Vacaciones"],["fest","Festivo"],["nolab","No laborable"]]){ const s = el("span"); s.append(el("i","vac-d " + c, " "), t); ley.append(s); }
  const o = el("div"); o.append(w, ley); return o;
}

// ---------- Calendario y festivos ----------
function tabCalendario(box, C){
  const ed = puede(), c = V.data.cals.find(x => x.anio === C.anio);
  const card = el("div","card"); card.style.marginBottom = "12px"; card.append(el("b",null,`Calendario ${C.anio}`));
  const iD = el("input"); iD.type = "number"; iD.step = "0.5"; iD.min = "0"; iD.value = c.dias_defecto; iD.disabled = !ed;
  const labs = el("div"); labs.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;padding-top:6px"; const cbs = [];
  ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].forEach((n, i) => { const l = el("label","chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = C.lab.has(i + 1); cb.disabled = !ed; cbs.push(cb); l.append(cb, " " + n); labs.append(l); });
  const g = el("div","f2"); const f1 = el("div","f"); f1.append(el("label",null,"Días de vacaciones por defecto"), iD, el("span","hint","Lo que tiene cada trabajador salvo que se cambie en su ficha de vacaciones")); const f2 = el("div","f"); f2.append(el("label",null,"Días laborables (cuentan como vacaciones)"), labs); g.append(f1, f2); card.append(g);
  if (ed){ const sv = el("button","btn small primary","Guardar"); sv.type = "button"; sv.addEventListener("click", async () => { const lab = cbs.map((x, i) => x.checked ? i + 1 : null).filter(Boolean); if (!lab.length) return toast("Marca al menos un día laborable");
      const q = await sch().from("vac_calendarios").update({ dias_defecto:+iD.value || 0, laborables:lab }).eq("anio", C.anio); if (q.error) return toast("No se ha podido guardar"); toast("Calendario guardado"); recargar(); }); card.append(sv);
    const prev = V.data.cals.find(x => x.anio === C.anio - 1);
    if (prev){ const tr = el("button","btn small",`Traspasar pendientes de ${C.anio - 1}`); tr.type = "button"; tr.title = `Pone como «días de años anteriores» de ${C.anio} lo que cada trabajador tenga pendiente al cerrar ${C.anio - 1}`; tr.style.marginLeft = "8px"; tr.addEventListener("click", () => traspasar(C)); card.append(tr); } }
  box.append(card);
  // festivos
  box.append(el("h3",null,`Festivos ${C.anio}`));
  if (ed){ const a = el("div","ctrl"); const fd = el("input"); fd.type = "date"; fd.min = `${C.anio}-01-01`; fd.max = `${C.anio}-12-31`; const ds = el("input"); ds.placeholder = "Ej.: Fiesta local"; const tp = el("select"); for (const x of TIPOS_FEST) tp.append(new Option(x, x)); tp.value = "Local";
    const fl = (lab, n) => { const d = el("div","fld"); d.append(el("span",null,lab), n); return d; };
    const ad = el("button","btn small primary","Añadir festivo"); ad.type = "button";
    ad.addEventListener("click", async () => { if (!fd.value || !ds.value.trim()) return toast("Pon la fecha y la descripción"); if (fd.value.slice(0,4) !== String(C.anio)) return toast(`La fecha tiene que ser de ${C.anio}`);
      const q = await sch().from("vac_festivos").insert({ anio:C.anio, fecha:fd.value, descripcion:ds.value.trim(), tipo:tp.value }); if (q.error){ console.error(q.error); return toast(q.error.code === "23505" ? "Ese día ya es festivo" : "No se ha podido guardar"); } toast("Festivo añadido"); recargar(); });
    const ac = el("div","acc"); ac.append(ad); a.append(fl("Fecha", fd), fl("Descripción", ds), fl("Tipo", tp), ac); box.append(a); }
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Fecha","Día","Descripción","Tipo", ed ? "" : null].filter(x => x !== null)) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody"); const FD = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
  for (const x of V.data.fest.filter(x => x.anio === C.anio)){ const tr = el("tr"); const lab = C.lab.has(dsem(x.fecha)); const dd = el("td",null, FD[dsem(x.fecha) - 1] + (lab ? "" : " (no laborable)")); if (!lab) dd.style.color = "var(--ink-3)";
    tr.append(el("td",null,fec(x.fecha)), dd, el("td",null,x.descripcion), el("td",null,x.tipo));
    if (ed){ const td = el("td"); const b = el("button","btn small","Eliminar"); b.type = "button"; b.addEventListener("click", async () => { if (!confirm(`¿Quitar el festivo ${x.descripcion} (${fec(x.fecha)})?`)) return; const q = await sch().from("vac_festivos").delete().eq("id", x.id); if (q.error) return toast("No se ha podido eliminar"); recargar(); }); td.append(b); tr.append(td); }
    tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  const loc = V.data.fest.filter(x => x.anio === C.anio && x.tipo === "Local").length;
  if (!loc){ const w = el("p","hint","Faltan los festivos locales del municipio: añádelos (tipo Local) para que no cuenten como días de vacaciones."); w.style.color = "var(--red)"; box.append(w); }
  box.append(el("h3",null,`Calendario ${C.anio}`), calendarioAnual(C, [], null));
}

async function nuevoAnio(){
  const ult = V.data.cals[V.data.cals.length - 1], anio = ult ? ult.anio + 1 : new Date().getFullYear() + 1;
  if (!confirm(`¿Crear el calendario de vacaciones ${anio}? Se copian los días por defecto y los días laborables de ${ult ? ult.anio : "la configuración inicial"}; los festivos hay que añadirlos.`)) return;
  const q = await sch().from("vac_calendarios").insert({ anio, dias_defecto: ult ? ult.dias_defecto : 34, laborables: ult ? ult.laborables : [1,2,3,4,5] });
  if (q.error){ console.error(q.error); return toast("No se ha podido crear el calendario"); }
  V.anio = anio; V.tab = "calendario"; toast(`Calendario ${anio} creado: añade sus festivos y traspasa los pendientes de ${anio - 1}`); recargar();
}
async function traspasar(C){
  const P = cal(C.anio - 1); if (!P) return;
  const filas = personasAnio(P).map(p => ({ p, r:resumen(p, P) })).filter(x => x.r.pend > 0);
  if (!filas.length) return toast(`Nadie tiene días pendientes de ${P.anio}`);
  if (!confirm(`${filas.length} trabajadores tienen días pendientes de ${P.anio} (${num(filas.reduce((t, x) => t + x.r.pend, 0))} días en total). ¿Ponerlos como «días de años anteriores» de ${C.anio}? Sustituye lo que hubiera apuntado en esa columna.`)) return;
  const rows = filas.map(({ p, r }) => { const s = saldo(p, C); return { anio:C.anio, persona_id:p.id, dias_anio:s.dias_anio, dias_anteriores:r.pend, observaciones:s.observaciones || null }; });
  const q = await sch().from("vac_saldos").upsert(rows); if (q.error){ console.error(q.error); return toast("No se ha podido traspasar"); }
  toast(`Pendientes de ${P.anio} traspasados a ${C.anio}`); V.tab = "panel"; recargar();
}

// ---------- Informe PDF (jsPDF + autotable) ----------
let cargaPdf = null;
function pdfLib(){
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
  const una = u => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = u; s.onload = ok; s.onerror = () => { s.remove(); ko(); }; document.head.append(s); });
  const dos = base => una(`${base}/jspdf@2.5.1/dist/jspdf.umd.min.js`).then(() => una(`${base}/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js`));
  if (!cargaPdf) cargaPdf = dos("https://cdn.jsdelivr.net/npm").catch(() => dos("https://unpkg.com")).catch(() => { cargaPdf = null; throw new Error("No se ha podido cargar la librería de PDF"); });
  return cargaPdf;
}
async function informePdf(lista, C){
  if (!lista.length) return toast("No hay trabajadores en la lista");
  try { await pdfLib(); } catch(e){ return toast(e.message); }
  const doc = new window.jspdf.jsPDF({ unit:"mm", format:"a4" }), W = 210, M = 14;
  const AZ = [31,56,100], VE = [78,154,143], RO = [194,54,43], GR = [120,120,120];
  lista.forEach((p, i) => {
    if (i) doc.addPage();
    const r = resumen(p, C);
    doc.setFillColor(...AZ); doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255); doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.text(`Vacaciones ${C.anio}`, M, 10);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.text("Baños 10 · Informe de vacaciones por trabajador", M, 16);
    doc.text(`Emitido el ${fec(hoyKey)}`, W - M, 16, { align:"right" });
    doc.setTextColor(30); doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.text(p.nombre, M, 32);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(80);
    doc.text(`Código ${p.codigo}${p.departamento ? " · " + p.departamento : ""}${p.puesto ? " · " + p.puesto : ""}`, M, 38);
    doc.autoTable({ startY:43, margin:{ left:M, right:M }, theme:"grid", styles:{ fontSize:9, halign:"center", cellPadding:2 }, headStyles:{ fillColor:AZ, textColor:255 },
      head:[["Días años anteriores", `Días ${C.anio}`, "Total días", "Disfrutados", "Pendientes", "de ellos, de años ant."]],
      body:[[num(r.ant), num(r.anio), num(r.total), num(r.disfr), num(r.pend), num(r.pendAnt)]],
      didParseCell: d => { if (d.section === "body" && d.column.index === 4){ d.cell.styles.fontStyle = "bold"; if (r.pend < 0) d.cell.styles.textColor = RO; } } });
    let y = doc.lastAutoTable.finalY + 7;
    doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.setTextColor(30); doc.text("Detalle de las vacaciones", M, y);
    doc.autoTable({ startY:y + 2, margin:{ left:M, right:M }, theme:"striped", styles:{ fontSize:8.5, cellPadding:1.6 }, headStyles:{ fillColor:VE, textColor:255 },
      head:[["Nº","Desde","Hasta","Días laborables","De años anteriores",`De ${C.anio}`,"Observaciones"]],
      body: r.P.length ? r.P.map((x, j) => [j + 1, fec(x.a.fecha_inicio), fec(x.a.fecha_fin || x.a.fecha_inicio), num(x.dias), x.deAnt ? num(x.deAnt) : "", x.deAnio ? num(x.deAnio) : "", (x.a.observaciones || "") + (x.a.fecha_inicio > hoyKey ? (x.a.observaciones ? " · " : "") + "programado" : "")])
        : [["", "Sin vacaciones apuntadas", "", "", "", "", ""]],
      foot: r.P.length ? [["", "", "Total", num(r.disfr), num(r.P.reduce((t, x) => t + x.deAnt, 0)), num(r.P.reduce((t, x) => t + x.deAnio, 0)), ""]] : undefined,
      footStyles:{ fillColor:[235,240,238], textColor:30, fontStyle:"bold" },
      columnStyles:{ 0:{ halign:"center", cellWidth:9 }, 3:{ halign:"right" }, 4:{ halign:"right" }, 5:{ halign:"right" } } });
    y = doc.lastAutoTable.finalY + 6;
    // calendario anual (4 × 3 meses)
    const vac = new Set(); for (const x of r.P) for (let d = new Date(x.a.fecha_inicio + "T00:00:00Z"); ymd(d) <= (x.a.fecha_fin || x.a.fecha_inicio); d.setUTCDate(d.getUTCDate() + 1)){ const k = ymd(d); if (C.lab.has(dsem(k)) && !C.fest.has(k)) vac.add(k); }
    const cw = 4.9, ch = 3.7, mw = 7 * cw, gap = (W - 2 * M - 4 * mw) / 3, mh = 3.6 + ch + 6 * ch + 2;
    if (y + 3 * mh + 30 > 297) { doc.addPage(); y = 16; }
    doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.text(`Calendario ${C.anio}`, M, y); y += 3;
    for (let m = 0; m < 12; m++){
      const x0 = M + (m % 4) * (mw + gap), y0 = y + Math.floor(m / 4) * mh;
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...AZ); doc.text(MESES[m], x0, y0 + 3);
      doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GR); DSEM.forEach((d, j) => doc.text(d, x0 + j * cw + cw / 2, y0 + 3.6 + ch - 1, { align:"center" }));
      const pri = `${C.anio}-${String(m + 1).padStart(2,"0")}-01`, nd = new Date(Date.UTC(C.anio, m + 1, 0)).getUTCDate(); let pos = dsem(pri) - 1;
      for (let d = 1; d <= nd; d++, pos++){ const k = `${C.anio}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`, cx = x0 + (pos % 7) * cw, cy = y0 + 3.6 + ch + Math.floor(pos / 7) * ch;
        if (vac.has(k)){ doc.setFillColor(...VE); doc.rect(cx + 0.2, cy + 0.2, cw - 0.4, ch - 0.4, "F"); doc.setTextColor(255); }
        else if (C.fest.has(k)){ doc.setFillColor(248, 222, 219); doc.rect(cx + 0.2, cy + 0.2, cw - 0.4, ch - 0.4, "F"); doc.setTextColor(...RO); }
        else doc.setTextColor(...(C.lab.has(dsem(k)) ? [40,40,40] : [170,170,170]));
        doc.text(String(d), cx + cw / 2, cy + ch - 1, { align:"center" }); } }
    y += 3 * mh + 2;
    doc.setFontSize(7.5); doc.setFillColor(...VE); doc.rect(M, y, 3, 3, "F"); doc.setTextColor(60); doc.text("Vacaciones", M + 4.5, y + 2.5);
    doc.setFillColor(248, 222, 219); doc.rect(M + 28, y, 3, 3, "F"); doc.text("Festivo", M + 32.5, y + 2.5); doc.setTextColor(170); doc.text("Gris: no laborable", M + 52, y + 2.5);
    // firmas
    const fy = Math.min(Math.max(y + 22, 255), 280); doc.setDrawColor(150); doc.setTextColor(80); doc.setFontSize(8.5);
    doc.line(M, fy, M + 70, fy); doc.text("Firma del trabajador", M, fy + 4.5); doc.line(W - M - 70, fy, W - M, fy); doc.text("Firma de la empresa", W - M - 70, fy + 4.5);
    doc.setFontSize(7); doc.setTextColor(150); doc.text(`Días en días laborables según el calendario ${C.anio}. Se descuentan primero los días pendientes de años anteriores.`, M, 291);
  });
  const nombre = lista.length === 1 ? `Vacaciones_${C.anio}_${safe(lista[0].codigo + " " + lista[0].nombre)}` : `Vacaciones_${C.anio}_${lista.length}_trabajadores`;
  doc.save(nombre + ".pdf"); toast("Informe PDF descargado");
}
