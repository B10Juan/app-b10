// APP B10 · Personas: calendario laboral y vacaciones en dos cuentas (lo usan Vacaciones y el Formulario de introducción de datos)
// · Cada persona usa el calendario de su ficha («calendario») o el de su sección: M.O.D → Planta, el resto → Oficinas y almacén.
// · Cuenta empresa = cierre de empresa (automático) + turnos + viernes de jornada corta (automático, sin fecha) + días que pone la empresa.
// · Cuenta trabajador = días de libre elección + pendientes de años anteriores (se gastan primero).
// · Los periodos se guardan en rrhh.ausencias (tipo «Vacaciones») con concepto Libre elección, Turno o Empresa.
// Datos: migraciones 27 y 31.
import { sb } from "../app.js";
import { el, toast } from "../util.js";

export const CAL_NOM = { planta:"Planta", oficinas:"Oficinas y almacén" };
export const CONCEPTOS = ["Libre elección","Turno","Empresa"];
export const calDe = p => p.calendario || (p.clasificacion === "M.O.D" ? "planta" : "oficinas");
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DSEM = ["L","M","X","J","V","S","D"];
const DEF_LAB = new Set([1,2,3,4,5]);
const sch = () => sb.schema("rrhh");
export const ymd = d => d.toISOString().slice(0,10);
export const dsem = k => { const w = new Date(k + "T00:00:00Z").getUTCDay(); return w === 0 ? 7 : w; }; // 1 lunes … 7 domingo
export const fec = k => k ? `${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(0,4)}` : "";
export const num = v => { const n = Math.round(v * 100) / 100; return Number.isInteger(n) ? String(n) : n.toLocaleString("es-ES"); };
export const hoyKey = (() => { const d = new Date(), p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
const cuentaDe = a => a.concepto === "Turno" || a.concepto === "Empresa" ? "empresa" : "trabajador";
const enAnio = (a, anio) => a.fecha_inicio <= `${anio}-12-31` && (a.fecha_fin || a.fecha_inicio) >= `${anio}-01-01`;

// Carga lo necesario de Supabase (cada tabla es opcional: si aún no existe, va vacía)
export async function cargarCal(){
  const q = async (t, ord) => { try { const out = []; for (let i = 0; ; i += 1000){ const r = await sch().from(t).select("*").order(ord).range(i, i + 999); if (r.error) throw r.error; out.push(...r.data); if (r.data.length < 1000) break; } return out; } catch(e){ console.warn("Sin " + t, e); return []; } };
  const [cals, fest, saldos, cl, cd] = await Promise.all([q("vac_calendarios","anio"), q("vac_festivos","fecha"), q("vac_saldos","anio"), q("cal_laborales","anio"), q("cal_dias","fecha")]);
  return { cals, fest, saldos, cl, cd };
}

// Motor de cálculo: d = { cals, fest, saldos, cl, cd }, vac = ausencias de tipo Vacaciones
export function crearCalc(d, vac){
  const festM = new Map(d.fest.map(f => [f.fecha, f]));
  const labY = new Map(d.cals.map(c => [+c.anio, new Set((c.laborables || [1,2,3,4,5]).map(Number))]));
  const clM = new Map(d.cl.map(c => [`${c.anio}|${c.codigo}`, c]));
  const cdM = new Map(); for (const x of d.cd){ let m = cdM.get(x.calendario_id); if (!m) cdM.set(x.calendario_id, m = new Map()); m.set(x.fecha, x); }
  const saldoM = new Map(d.saldos.map(s => [`${s.anio}|${s.persona_id}`, s]));
  const vacPor = new Map(); for (const a of vac){ if (!vacPor.has(a.persona_id)) vacPor.set(a.persona_id, []); vacPor.get(a.persona_id).push(a); }
  const confRow = (anio, cod) => clM.get(`${anio}|${cod}`) || null;
  const diaCal = (k, cod) => { const c = confRow(+k.slice(0,4), cod); return c ? ((cdM.get(c.id) || new Map()).get(k) || null) : null; };
  const laborable = (k, cod) => (labY.get(+k.slice(0,4)) || DEF_LAB).has(dsem(k)) && !festM.has(k);
  const cierre = (k, cod) => { const x = diaCal(k, cod); return !!x && x.tipo === "Cierre" && laborable(k, cod); };
  const turno = (k, cod) => { const x = diaCal(k, cod); return !!x && x.tipo === "Turno"; };
  const horasDia = (anio, cod) => { const c = confRow(+anio, cod); return c ? +c.horas_dia : 8; };
  // días de vacaciones de un rango: laborables que no son festivo ni cierre de empresa
  const diasVac = (ini, fin, cod) => { let n = 0; for (let x = new Date(ini + "T00:00:00Z"); ymd(x) <= fin; x.setUTCDate(x.getUTCDate() + 1)){ const k = ymd(x); if (laborable(k, cod) && !cierre(k, cod)) n++; } return n; };
  function conf(anio, cod){
    const c = confRow(anio, cod), def = d.cals.find(x => +x.anio === +anio);
    if (!c) return { existe:false, nombre:CAL_NOM[cod], horas:8, cierre:[], turnos:0, viernes:0, empresa:0, trabajador: def ? +def.dias_defecto : 0, tiene:!!def };
    const cie = [...(cdM.get(c.id) || new Map()).values()].filter(x => x.tipo === "Cierre" && laborable(x.fecha, cod)).map(x => x.fecha).sort();
    return { existe:true, tiene:true, id:c.id, nombre:c.nombre, horas:+c.horas_dia, cierre:cie, turnos:+c.dias_turnos, viernes:+c.dias_viernes, empresa:+c.dias_empresa, trabajador:+c.dias_trabajador, obs:c.observaciones || "" };
  }
  function resumen(p, anio){
    const cod = calDe(p), C = conf(anio, cod), s = saldoM.get(`${anio}|${p.id}`) || null;
    const enAlta = k => (!p.fecha_alta || p.fecha_alta <= k) && (!p.fecha_baja || p.fecha_baja >= k);
    const cierreP = C.cierre.filter(enAlta);
    const empDef = C.existe ? C.cierre.length + C.turnos + C.viernes + C.empresa : 0;
    const emp = s && s.dias_empresa != null ? +s.dias_empresa : empDef;
    const trab = s && s.dias_trabajador != null ? +s.dias_trabajador : s && !C.existe ? +s.dias_anio : C.trabajador;
    const ant = s ? +s.dias_anteriores || 0 : 0;
    const a0 = `${anio}-01-01`, a1 = `${anio}-12-31`;
    const per = (vacPor.get(p.id) || []).filter(a => enAnio(a, anio)).sort((a, b) => a.fecha_inicio < b.fecha_inicio ? -1 : 1);
    let quedaAnt = ant; const P = [];
    for (const a of per){ const ini = a.fecha_inicio > a0 ? a.fecha_inicio : a0, fin0 = a.fecha_fin || a.fecha_inicio, fin = fin0 < a1 ? fin0 : a1;
      const dias = a.dias != null ? +a.dias : diasVac(ini, fin, cod), cuenta = cuentaDe(a); let deAnt = 0;
      if (cuenta === "trabajador"){ deAnt = Math.max(0, Math.min(dias, quedaAnt)); quedaAnt -= deAnt; }
      P.push({ a, dias, cuenta, deAnt, deAnio:dias - deAnt }); }
    const s1 = f => P.filter(f).reduce((t, x) => t + x.dias, 0);
    const usFechas = s1(x => x.cuenta === "empresa"), usTrab = s1(x => x.cuenta === "trabajador");
    const viernes = C.existe ? C.viernes : 0, usEmp = cierreP.length + viernes + usFechas;
    return { cod, C, s, P,
      emp:{ total:emp, def:empDef, cierre:cierreP.length, viernes, turnos:C.turnos, empresa:C.empresa, turnosUsados:s1(x => x.a.concepto === "Turno"), empresaUsados:s1(x => x.a.concepto === "Empresa"), usado:usEmp, pend:emp - usEmp },
      trab:{ ant, anio:trab, total:ant + trab, usado:usTrab, pend:ant + trab - usTrab, pendAnt:quedaAnt },
      total:emp + ant + trab, usado:usEmp + usTrab, pend:emp + ant + trab - usEmp - usTrab };
  }
  return { laborable, cierre, turno, horasDia, diasVac, conf, resumen, festM, diaCal, saldo:(anio, pid) => saldoM.get(`${anio}|${pid}`) || null, anios: d.cals.map(c => +c.anio).sort() };
}

// Calendario de 12 meses: cierre, ventana de turnos, festivos, no laborables y vacaciones de la persona
export function calendarioAnual(K, anio, cod, periodos, alPulsar){
  const vac = new Map(); for (const a of periodos){ for (let x = new Date(a.fecha_inicio + "T00:00:00Z"); ymd(x) <= (a.fecha_fin || a.fecha_inicio); x.setUTCDate(x.getUTCDate() + 1)){ const k = ymd(x); if (K.laborable(k, cod) && !K.cierre(k, cod)) vac.set(k, cuentaDe(a)); } }
  const w = el("div","vac-cal");
  for (let m = 0; m < 12; m++){
    const mb = el("div","vac-mes"); mb.append(el("b",null,MESES[m]));
    const g = el("div","vac-dias"); for (const x of DSEM) g.append(el("span","vac-h",x));
    const pri = `${anio}-${String(m + 1).padStart(2,"0")}-01`; for (let i = 1; i < dsem(pri); i++) g.append(el("span"));
    const nd = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate();
    for (let dd = 1; dd <= nd; dd++){ const k = `${anio}-${String(m + 1).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
      const s = el(alPulsar ? "button" : "span","vac-d", String(dd)); if (alPulsar){ s.type = "button"; s.addEventListener("click", () => alPulsar(k)); }
      if (K.festM.has(k)){ s.classList.add("fest"); s.title = K.festM.get(k).descripcion; } else if (!K.laborable(k, cod)) s.classList.add("nolab");
      else if (K.cierre(k, cod)){ s.classList.add("cierre"); s.title = (K.diaCal(k, cod) || {}).descripcion || "Cierre de empresa"; }
      else if (K.turno(k, cod)){ s.classList.add("turno"); s.title = (K.diaCal(k, cod) || {}).descripcion || "Ventana de turnos"; }
      if (vac.has(k)){ s.classList.add("vac"); if (vac.get(k) === "empresa") s.classList.add("emp"); }
      if (k === hoyKey) s.classList.add("hoy");
      g.append(s); }
    mb.append(g); w.append(mb); }
  const ley = el("div","vac-ley"); for (const [c, t] of [["vac","Vacaciones del trabajador"],["vac emp","Vacaciones de empresa (turno o empresa)"],["cierre","Cierre de empresa"],["turno","Ventana de turnos"],["fest","Festivo"],["nolab","No laborable"]]){ const s = el("span"); s.append(el("i","vac-d " + c, " "), t); ley.append(s); }
  const o = el("div"); o.append(w, ley); return o;
}

// Tarjeta de vacaciones de una persona (saldo en dos cuentas, periodos, alta de periodos y calendario)
// op = { ed, onSaved, anios }
export function tarjetaVac(p, anio, K, op){
  const ed = !!op.ed, r = K.resumen(p, anio), C = r.C;
  const box = el("div");
  const fld = (lab, n, hint) => { const x = el("div","f"); x.append(el("label",null,lab), n); if (hint) x.append(el("span","hint",hint)); return x; };
  const num0 = (v, step) => { const i = el("input"); i.type = "number"; i.step = step || "0.5"; i.min = "0"; i.value = v; i.disabled = !ed; return i; };
  box.append(el("p","sub",`Calendario: ${C.nombre}${p.calendario ? "" : " (por su sección)"} · Vacaciones ${anio}${C.existe ? "" : " · este año no tiene calendario laboral con cuentas: todos los días van a la cuenta del trabajador"}`));
  // KPIs
  const k = el("div","kpis"); const kp = (t, v, s, rojo) => { const d = el("div","kpi"); const b = el("b",null,v); if (rojo) b.style.color = "var(--red)"; d.append(el("small",null,t), b); if (s) d.append(el("span","delta",s)); return d; };
  if (C.existe) k.append(kp("Cuenta empresa: pendientes", num(r.emp.pend), `de ${num(r.emp.total)}: cierre ${num(r.emp.cierre)}${r.emp.viernes ? ` · viernes ${num(r.emp.viernes)}` : ""} · turnos ${num(r.emp.turnosUsados)}/${num(r.emp.turnos)}${r.emp.empresa ? ` · empresa ${num(r.emp.empresaUsados)}/${num(r.emp.empresa)}` : ""}`, r.emp.pend < 0));
  k.append(kp("Cuenta trabajador: pendientes", num(r.trab.pend), `de ${num(r.trab.total)} (${num(r.trab.anio)} de ${anio}${r.trab.ant ? ` + ${num(r.trab.ant)} de años anteriores` : ""}) · disfrutados ${num(r.trab.usado)}`, r.trab.pend < 0));
  k.append(kp("Total pendientes", num(r.pend), `de ${num(r.total)} días · disfrutados ${num(r.usado)}`, r.pend < 0));
  box.append(k);
  // saldo
  const sc = el("details"); sc.style.margin = "0 0 10px"; sc.append(el("summary",null,"Días de cada cuenta (cambiar para esta persona)"));
  const iE = num0(r.emp.total), iT = num0(r.trab.anio), iA = num0(r.trab.ant), iO = el("input"); iO.value = r.s && r.s.observaciones || ""; iO.placeholder = "Ej.: alta en marzo, días proporcionales"; iO.disabled = !ed;
  const g = el("div","f2"); if (C.existe) g.append(fld("Días cuenta empresa", iE, `Por calendario ${num(r.emp.def)}`)); g.append(fld(`Días del trabajador ${anio}`, iT, `Por calendario ${num(C.trabajador)}`), fld("Pendientes de años anteriores", iA, "Van a la cuenta del trabajador y se gastan primero"));
  sc.append(g, fld("Observaciones", iO));
  if (ed){ const sv = el("button","btn small primary","Guardar días"); sv.type = "button"; sv.addEventListener("click", async () => {
      const de = C.existe ? +iE.value : 0, dt = +iT.value, da = +iA.value; if (!(de >= 0) || !(dt >= 0) || !(da >= 0)) return toast("Revisa los días: tienen que ser números positivos");
      const q = await sch().from("vac_saldos").upsert({ anio, persona_id:p.id, dias_anio:de + dt, dias_empresa: C.existe ? de : null, dias_trabajador:dt, dias_anteriores:da, observaciones:iO.value.trim() || null });
      if (q.error){ console.error(q.error); return toast("No se han podido guardar los días"); } toast("Días guardados"); op.onSaved(); });
    sc.append(sv); }
  box.append(sc);
  // periodos
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr");
  for (const h of ["Desde","Hasta","Concepto","Cuenta","Días","De años ant.","Comentario", ed ? "" : null].filter(x => x !== null)) hr.append(el("th", ["Días","De años ant."].includes(h) ? "n" : null, h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody");
  if (C.existe && r.emp.cierre){ const tr = el("tr"); tr.style.color = "var(--ink-3)"; tr.append(el("td",null,C.cierre.map(x => fec(x).slice(0,5)).join(", ")), el("td"), el("td",null,"Cierre de empresa"), el("td",null,"Empresa"), el("td","n",num(r.emp.cierre)), el("td"), el("td",null,"Automático: lo marca el calendario")); if (ed) tr.append(el("td")); tb.append(tr); }
  if (C.existe && r.emp.viernes){ const tr = el("tr"); tr.style.color = "var(--ink-3)"; tr.append(el("td",null,"—"), el("td"), el("td",null,"Viernes de jornada corta"), el("td",null,"Empresa"), el("td","n",num(r.emp.viernes)), el("td"), el("td",null,"Automático: compensan los viernes de 6 h 45")); if (ed) tr.append(el("td")); tb.append(tr); }
  for (const x of r.P){ const a = x.a, tr = el("tr");
    const ob = (a.observaciones || "") + (a.fecha_inicio > hoyKey ? (a.observaciones ? " · " : "") + "programado" : "") + (a.dias != null ? " · días ajustados a mano" : "");
    tr.append(el("td",null,fec(a.fecha_inicio)), el("td",null,fec(a.fecha_fin || a.fecha_inicio)), el("td",null,a.concepto || "Libre elección"), el("td",null,x.cuenta === "empresa" ? "Empresa" : "Trabajador"), el("td","n",num(x.dias)), el("td","n", x.deAnt ? num(x.deAnt) : ""), el("td",null,ob));
    if (ed){ const td = el("td"); const del = el("button","btn small","Eliminar"); del.type = "button"; del.addEventListener("click", async () => { if (!confirm(`¿Eliminar las vacaciones del ${fec(a.fecha_inicio)} al ${fec(a.fecha_fin || a.fecha_inicio)}?`)) return; const q = await sch().from("ausencias").delete().eq("id", a.id); if (q.error) return toast("No se ha podido eliminar"); toast("Vacaciones eliminadas"); op.onSaved(); }); td.append(del); tr.append(td); }
    tb.append(tr); }
  if (!tb.childNodes.length){ const tr = el("tr"); const td = el("td","empty",`Sin vacaciones apuntadas en ${anio}.`); td.colSpan = ed ? 8 : 7; tr.append(td); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  // alta de un periodo (días completos)
  let selIni = null;
  const iD = el("input"); iD.type = "date"; iD.min = `${anio}-01-01`; iD.max = `${anio}-12-31`;
  const iH = el("input"); iH.type = "date"; iH.min = `${anio}-01-01`; iH.max = `${anio}-12-31`;
  const sC = el("select"); for (const c of C.existe ? CONCEPTOS : ["Libre elección"]) sC.append(new Option(c + (c === "Libre elección" ? " (cuenta del trabajador)" : " (cuenta empresa)"), c));
  const iOb = el("input"); iOb.placeholder = "Comentario (opcional)";
  const calc = el("span","hint");
  const recalc = () => { if (iD.value && iH.value && iH.value >= iD.value){ const n = K.diasVac(iD.value, iH.value, r.cod); calc.textContent = `${n} día${n === 1 ? "" : "s"} de vacaciones (laborables, sin festivos ni cierre).`; } else calc.textContent = ""; };
  iD.addEventListener("change", () => { if (iD.value && (!iH.value || iH.value < iD.value)) iH.value = iD.value; recalc(); }); iH.addEventListener("change", recalc);
  if (ed){
    const ac = el("div","card"); ac.style.margin = "12px 0"; ac.append(el("b",null,"Apuntar vacaciones (días completos)"));
    const g2 = el("div","f2"); g2.append(fld("Desde", iD), fld("Hasta", iH)); const g3 = el("div","f2"); g3.append(fld("Concepto", sC), fld("Comentario", iOb));
    const add = el("button","btn small primary","Añadir vacaciones"); add.type = "button";
    add.addEventListener("click", async () => {
      if (!iD.value) return iD.focus(); const ini = iD.value, fin = iH.value || iD.value;
      if (fin < ini) return toast("La fecha «hasta» es anterior a «desde»");
      if (ini.slice(0,4) !== String(anio) || fin.slice(0,4) !== String(anio)) return toast(`Las fechas tienen que ser de ${anio}. Si cruzan el año, apúntalas en dos partes.`);
      const choque = r.P.find(x => x.a.fecha_inicio <= fin && (x.a.fecha_fin || x.a.fecha_inicio) >= ini);
      if (choque) return toast(`Se solapa con las vacaciones del ${fec(choque.a.fecha_inicio)} al ${fec(choque.a.fecha_fin || choque.a.fecha_inicio)}`);
      const n = K.diasVac(ini, fin, r.cod); if (!(n > 0)) return toast("Ese rango no tiene días de vacaciones (fin de semana, festivo o cierre)");
      const cta = sC.value === "Libre elección" ? r.trab : r.emp;
      if (n > cta.pend && !confirm(`Con estos ${num(n)} días se pasa de los ${num(cta.pend)} pendientes de la cuenta ${sC.value === "Libre elección" ? "del trabajador" : "de empresa"}. ¿Apuntar igualmente?`)) return;
      const q = await sch().from("ausencias").insert({ persona_id:p.id, tipo:"Vacaciones", concepto:sC.value, fecha_inicio:ini, fecha_fin:fin, observaciones:iOb.value.trim() || null });
      if (q.error){ console.error(q.error); return toast("No se han podido guardar las vacaciones"); }
      toast(`${num(n)} días de vacaciones apuntados`); op.onSaved(); });
    ac.append(g2, g3, calc, add, el("p","hint","También puedes pulsar en el calendario: primer clic, «desde»; segundo clic, «hasta». Los días de cierre de empresa ya están descontados y no hace falta apuntarlos."));
    box.append(ac);
  }
  box.append(el("h3",null,`Calendario ${anio} · ${C.nombre}`));
  box.append(calendarioAnual(K, anio, r.cod, r.P.map(x => x.a), ed ? kk => { if (!selIni || iH.value){ selIni = kk; iD.value = kk; iH.value = ""; } else { if (kk < selIni){ iH.value = selIni; iD.value = kk; } else iH.value = kk; selIni = null; } recalc(); } : null));
  return box;
}
