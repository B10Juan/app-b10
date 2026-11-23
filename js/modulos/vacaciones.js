// APP B10 · Personas: vacaciones
// Calendario laboral por año y colectivo (Planta / Oficinas y almacén): festivos, cierre de empresa y ventana de turnos.
// Saldo por persona en dos cuentas: empresa (cierre + turnos + viernes + días de empresa) y trabajador (libre elección + años
// anteriores, que se gastan primero). Los periodos se guardan en rrhh.ausencias (tipo «Vacaciones», con concepto).
// Las vacaciones del día a día se apuntan en el Formulario de introducción de datos (buscar trabajador › Vacaciones).
// Informe en PDF por trabajador (jsPDF). Datos: migraciones 27 y 31. Permiso del módulo: «vacaciones».
import { sb, render, cabecera, nivel } from "../app.js";
import { el, toast, safe, exportarVista } from "../util.js";
import { cargarCal, crearCalc, calDe, CAL_NOM, tarjetaVac, calendarioAnual, ymd, dsem, fec, num, hoyKey } from "./vaccal.js";

const V = { anio:null, tab:"panel", data:null, loading:false, calSel:"planta", f:{ q:"", vinculo:"Nómina", dep:"", estado:"todos", cal:"" } };
const sch = () => sb.schema("rrhh");
const puede = () => nivel("vacaciones") === "editar";
const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const DSEM = ["L","M","X","J","V","S","D"];
const TIPOS_FEST = ["Nacional","Autonómico","Local","Empresa"];

async function cargar(){
  V.loading = true;
  try{
    const q = async (t, sel, ord, f) => { const out = []; for (let i = 0; ; i += 1000){ let b = sch().from(t).select(sel); if (f) b = f(b); const r = await b.order(ord).range(i, i + 999); if (r.error) throw r.error; out.push(...r.data); if (r.data.length < 1000) break; } return out; };
    const [cal, personas, vac] = await Promise.all([ cargarCal(),
      q("personas","*","codigo"),
      q("ausencias","*","fecha_inicio", b => b.eq("tipo","Vacaciones")) ]);
    V.data = { ...cal, personas, vac: vac.map(a => ({ ...a, dias: a.dias == null ? null : +a.dias })) };
    V.K = crearCalc(cal, V.data.vac);
    if (!V.anio || !cal.cals.some(c => +c.anio === V.anio)) V.anio = cal.cals.some(c => +c.anio === 2027) ? 2027 : (cal.cals.length ? +cal.cals[cal.cals.length - 1].anio : null);
  } catch(e){ console.error(e); toast("No se han podido cargar las vacaciones."); V.data = { cals:[], fest:[], saldos:[], cl:[], cd:[], personas:[], vac:[] }; V.K = crearCalc(V.data, []); }
  V.loading = false; render();
}
const recargar = () => { V.data = null; render(); };
function personasAnio(anio){
  const a = `${anio}-01-01`, b = `${anio}-12-31`;
  return V.data.personas.filter(p => ((!p.fecha_alta || p.fecha_alta <= b) && (!p.fecha_baja || p.fecha_baja >= a)) || V.data.saldos.some(s => +s.anio === anio && s.persona_id === p.id) || V.data.vac.some(x => x.persona_id === p.id && x.fecha_inicio <= b && (x.fecha_fin || x.fecha_inicio) >= a));
}

// ---------- Pantalla ----------
export function renderVacaciones(app){
  document.title = "Personas: vacaciones";
  cabecera(app, "Vacaciones", "Días de vacaciones por trabajador en dos cuentas (empresa y trabajador), calendario laboral de Planta y de Oficinas y almacén, e informe en PDF.", { txt:"Personas", href:"#personas" }, "vacaciones");
  const box = el("div","pad vac"); box.style.paddingBottom = "32px"; app.append(box);
  if (!V.data){ if (!V.loading) cargar(); box.append(el("div","card empty","Cargando vacaciones…")); return; }
  const nav = el("nav","tabs"); nav.style.marginBottom = "12px";
  for (const [k,t] of [["panel","Panel de vacaciones"],["calendario","Calendario laboral y festivos"]]){ const a = el("a",null,t); a.href = "#vacaciones"; if (V.tab === k) a.setAttribute("aria-current","page"); a.addEventListener("click", e => { e.preventDefault(); V.tab = k; render(); }); nav.append(a); }
  const acc = el("span"); acc.style.cssText = "margin-left:auto;display:flex;gap:8px";
  if (nivel("datos") || nivel("rrhh")){ const fd = el("a","btn small","Apuntar vacaciones ›"); fd.href = "#datos"; fd.title = "Formulario de introducción de datos: busca el trabajador y abre «Vacaciones»"; acc.append(fd); }
  const exv = el("button","btn small","Exportar vista a Excel"); exv.addEventListener("click", () => exportarVista(box, V.tab === "panel" ? `Vacaciones ${V.anio}` : `Calendario ${V.anio}`)); acc.append(exv); nav.append(acc);
  box.append(nav);
  const c = el("div","ctrl"); const sAn = el("div","seg");
  for (const x of V.data.cals){ const b = el("button",null,String(x.anio)); b.type = "button"; b.setAttribute("aria-pressed", String(+x.anio === V.anio)); b.addEventListener("click", () => { V.anio = +x.anio; render(); }); sAn.append(b); }
  if (V.data.cals.length){ const d = el("div","fld"); d.append(el("span",null,"Año"), sAn); c.append(d); }
  if (puede()){ const a = el("div","acc"); const nb = el("button","btn small", V.data.cals.length ? `Nuevo calendario ${(+V.data.cals[V.data.cals.length - 1].anio) + 1}` : "Nuevo calendario"); nb.type = "button"; nb.addEventListener("click", nuevoAnio); a.append(nb); c.append(a); }
  box.append(c);
  if (!V.anio){ box.append(el("div","card empty","Todavía no hay calendario de vacaciones. Pulsa «Nuevo calendario».")); return; }
  if (V.tab === "calendario") tabCalendario(box, V.anio); else tabPanel(box, V.anio);
}

function tabPanel(box, anio){
  const F = V.f, K = V.K, c = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Nombre o código"; q.value = F.q; q.dataset.k = "vac-q"; q.addEventListener("input", () => { F.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); c.append(qd);
  const seg = (lab, key, opts) => { const s = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(F[key] === k)); b.addEventListener("click", () => { F[key] = k; render(); }); s.append(b); } const d = el("div","fld"); d.append(el("span",null,lab), s); return d; };
  c.append(seg("Vínculo","vinculo",[["Nómina","Nómina"],["ETT","ETT"],["","Todos"]]), seg("Calendario","cal",[["","Todos"],["planta","Planta"],["oficinas","Oficinas y almacén"]]), seg("Mostrar","estado",[["todos","Todos"],["pendientes","Con días pendientes"],["exceso","Con exceso"]]));
  const deps = [...new Set(V.data.personas.map(p => p.departamento).filter(Boolean))].sort();
  const dd = el("div","fld"); const ds = el("select"); ds.append(new Option("Todos","")); for (const d of deps) ds.append(new Option(d, d)); ds.value = F.dep; ds.addEventListener("change", () => { F.dep = ds.value; render(); }); dd.append(el("span",null,"Departamento"), ds); c.append(dd);
  const a = el("div","acc"); const pdf = el("button","btn small","Informe PDF de la lista"); pdf.type = "button"; pdf.title = "Un PDF con una página por trabajador de la lista";
  a.append(pdf); c.append(a); box.append(c);
  const qq = F.q.trim().toLowerCase();
  const L = personasAnio(anio).filter(p => (!F.vinculo || p.tipo_vinculo === F.vinculo) && (!F.cal || calDe(p) === F.cal) && (!F.dep || p.departamento === F.dep) && (!qq || `${p.nombre} ${p.codigo}`.toLowerCase().includes(qq)))
    .map(p => ({ p, r:K.resumen(p, anio) })).filter(x => F.estado === "todos" || (F.estado === "pendientes" ? x.r.pend > 0 : (x.r.emp.pend < 0 || x.r.trab.pend < 0)))
    .sort((x, y) => x.p.nombre.localeCompare(y.p.nombre, "es"));
  pdf.addEventListener("click", () => informePdf(L.map(x => x.p), anio));
  const tw = el("div","tblwrap"); const t = el("table","tbl"); t.append(el("thead"));
  const h1 = el("tr"), h2 = el("tr");
  const th = (txt, cls, span, rows) => { const x = el("th", cls, txt); if (span) x.colSpan = span; if (rows) x.rowSpan = rows; return x; };
  h1.append(th("Código",null,0,2), th("Trabajador",null,0,2), th("Calendario",null,0,2), th("Cuenta empresa",null,3), th("Cuenta trabajador",null,5), th("Total pendientes","n",0,2));
  for (const x of ["Días","Disfrutados","Pendientes","Años ant.",`Días ${anio}`,"Total","Disfrutados","Pendientes"]) h2.append(th(x,"n"));
  for (const x of h1.children) if (x.colSpan > 1) x.style.cssText = "text-align:center;border-left:1px solid var(--line)";
  h2.children[0].style.borderLeft = h2.children[3].style.borderLeft = "1px solid var(--line)";
  t.tHead.append(h1, h2);
  const tb = el("tbody"); const tot = { e:0, eu:0, ep:0, ta:0, ty:0, tt:0, tu:0, tp:0, p:0 };
  for (const { p, r } of L){ const tr = el("tr"); tr.style.cursor = "pointer"; tr.addEventListener("click", () => detalle(p, anio));
    const n = (v, rojo, b) => { const x = el("td","n", num(v)); if (rojo && v < 0){ x.style.color = "var(--red)"; x.title = "Ha cogido más días de los que tiene"; } if (b) x.style.fontWeight = "700"; return x; };
    const e1 = n(r.emp.total); e1.style.borderLeft = "1px solid var(--line)"; const t1 = n(r.trab.ant); t1.style.borderLeft = "1px solid var(--line)";
    tr.append(el("td",null,p.codigo), el("td",null,p.nombre), el("td",null,CAL_NOM[r.cod]), e1, n(r.emp.usado), n(r.emp.pend, true, true), t1, n(r.trab.anio), n(r.trab.total), n(r.trab.usado), n(r.trab.pend, true, true), n(r.pend, true, true));
    tb.append(tr); tot.e += r.emp.total; tot.eu += r.emp.usado; tot.ep += r.emp.pend; tot.ta += r.trab.ant; tot.ty += r.trab.anio; tot.tt += r.trab.total; tot.tu += r.trab.usado; tot.tp += r.trab.pend; tot.p += r.pend; }
  if (!L.length){ const tr = el("tr"); const td = el("td","empty","No hay trabajadores con estos filtros."); td.colSpan = 12; tr.append(td); tb.append(tr); }
  else { const tr = el("tr","wk"); tr.append(el("td"), el("td",null,`Total (${L.length})`), el("td")); for (const k of ["e","eu","ep","ta","ty","tt","tu","tp","p"]) tr.append(el("td","n", num(tot[k]))); tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
  const cp = K.conf(anio, "planta"), co = K.conf(anio, "oficinas");
  box.append(el("p","hint", cp.existe ? `Planta: empresa ${num(cp.cierre.length + cp.turnos + cp.viernes + cp.empresa)} (cierre ${cp.cierre.length} + turnos ${num(cp.turnos)}${cp.viernes ? ` + viernes ${num(cp.viernes)}` : ""} + empresa ${num(cp.empresa)}) y trabajador ${num(cp.trabajador)}. Oficinas y almacén: empresa ${num(co.cierre.length + co.turnos + co.viernes + co.empresa)} (cierre ${co.cierre.length} + turnos ${num(co.turnos)} + viernes ${num(co.viernes)}${co.empresa ? ` + empresa ${num(co.empresa)}` : ""}) y trabajador ${num(co.trabajador)}. El cierre de empresa y los viernes se descuentan solos; los años anteriores van a la cuenta del trabajador y se gastan primero. Pulsa un trabajador para ver el detalle y apuntar vacaciones.` : `Pulsa un trabajador para ver el detalle. Este año no tiene calendario laboral con cuentas: todos los días van a la cuenta del trabajador.`));
}

// ---------- Detalle del trabajador ----------
function detalle(p, anio){
  let dlg = document.getElementById("dlgVac"); if (dlg) dlg.remove();
  dlg = el("dialog"); dlg.id = "dlgVac"; dlg.style.cssText = "max-width:900px;width:96vw;max-height:92vh;overflow:auto"; document.body.append(dlg);
  const f = el("form"); f.method = "dialog"; f.noValidate = true; dlg.append(f);
  f.append(el("h2",null,p.nombre), el("p","sub",`${p.codigo} · ${p.departamento || "sin departamento"}${p.puesto ? " · " + p.puesto : ""}`));
  f.append(tarjetaVac(p, anio, V.K, { ed:puede(), onSaved: async () => { dlg.close(); await recargarYabrir(p, anio); } }));
  const acts = el("div","actions"); const pdf = el("button","btn","Informe PDF"); pdf.type = "button"; pdf.addEventListener("click", () => informePdf([p], anio));
  const cl = el("button","btn primary","Cerrar"); cl.type = "button"; cl.addEventListener("click", () => dlg.close()); acts.append(pdf, cl); f.append(acts);
  dlg.showModal();
}
async function recargarYabrir(p, anio){ V.data = null; await cargar(); const pp = V.data.personas.find(x => x.id === p.id); if (pp) detalle(pp, anio); }

// ---------- Calendario laboral y festivos ----------
function tabCalendario(box, anio){
  const ed = puede(), c = V.data.cals.find(x => +x.anio === anio), K = V.K;
  const fl = (lab, n, hint) => { const d = el("div","f"); d.append(el("label",null,lab), n); if (hint) d.append(el("span","hint",hint)); return d; };
  // general del año
  const card = el("div","card"); card.style.marginBottom = "12px"; card.append(el("b",null,`Año ${anio}`));
  const iD = el("input"); iD.type = "number"; iD.step = "0.5"; iD.min = "0"; iD.value = c.dias_defecto; iD.disabled = !ed;
  const labs = el("div"); labs.style.cssText = "display:flex;gap:12px;flex-wrap:wrap;padding-top:6px"; const cbs = []; const lset = new Set((c.laborables || [1,2,3,4,5]).map(Number));
  ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].forEach((n, i) => { const l = el("label","chk"); const cb = el("input"); cb.type = "checkbox"; cb.checked = lset.has(i + 1); cb.disabled = !ed; cbs.push(cb); l.append(cb, " " + n); labs.append(l); });
  const g = el("div","f2"); g.append(fl("Días de vacaciones (total por convenio)", iD, "Referencia: 252 días × 8 h = 2.016 h − 1.744 h de convenio = 272 h = 34 días"), fl("Días laborables de la semana", labs)); card.append(g);
  if (ed){ const sv = el("button","btn small primary","Guardar"); sv.type = "button"; sv.addEventListener("click", async () => { const lab = cbs.map((x, i) => x.checked ? i + 1 : null).filter(Boolean); if (!lab.length) return toast("Marca al menos un día laborable");
      const q = await sch().from("vac_calendarios").update({ dias_defecto:+iD.value || 0, laborables:lab }).eq("anio", anio); if (q.error) return toast("No se ha podido guardar"); toast("Calendario guardado"); recargar(); }); card.append(sv);
    if (V.data.cals.some(x => +x.anio === anio - 1)){ const tr = el("button","btn small",`Traspasar pendientes de ${anio - 1}`); tr.type = "button"; tr.title = `Pone como «años anteriores» (cuenta del trabajador) de ${anio} lo que cada trabajador tenga pendiente al cerrar ${anio - 1}`; tr.style.marginLeft = "8px"; tr.addEventListener("click", () => traspasar(anio)); card.append(tr); } }
  box.append(card);
  // calendarios laborales (Planta / Oficinas y almacén)
  const sC = el("div","seg"); for (const [k, l] of Object.entries(CAL_NOM)){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(V.calSel === k)); b.addEventListener("click", () => { V.calSel = k; render(); }); sC.append(b); }
  const cc = el("div","ctrl"); const dcs = el("div","fld"); dcs.append(el("span",null,"Calendario laboral"), sC); cc.append(dcs); box.append(cc);
  const cod = V.calSel, C = K.conf(anio, cod), row = V.data.cl.find(x => +x.anio === anio && x.codigo === cod);
  const cardC = el("div","card"); cardC.style.marginBottom = "12px"; cardC.append(el("b",null,`${CAL_NOM[cod]} ${anio}`));
  if (!row){ cardC.append(el("p","hint","Este año no tiene este calendario laboral."));
    if (ed){ const b = el("button","btn small primary","Crear calendario laboral"); b.type = "button"; b.addEventListener("click", async () => { const prev = V.data.cl.filter(x => x.codigo === cod && +x.anio < anio).sort((a, b) => b.anio - a.anio)[0];
        const q = await sch().from("cal_laborales").insert({ anio, codigo:cod, nombre:CAL_NOM[cod], horas_dia: prev ? prev.horas_dia : 8, dias_turnos: prev ? prev.dias_turnos : 0, dias_viernes: prev ? prev.dias_viernes : 0, dias_empresa: prev ? prev.dias_empresa : 0, dias_trabajador: prev ? prev.dias_trabajador : +c.dias_defecto });
        if (q.error){ console.error(q.error); return toast("No se ha podido crear"); } toast("Calendario creado: marca los días de cierre y de turnos"); recargar(); }); cardC.append(b); }
    box.append(cardC); }
  else {
    const n0 = (v, st) => { const i = el("input"); i.type = "number"; i.step = st || "0.5"; i.min = "0"; i.value = v; i.disabled = !ed; return i; };
    const iH = n0(row.horas_dia, "0.25"), iT = n0(row.dias_turnos), iV = n0(row.dias_viernes), iE = n0(row.dias_empresa), iW = n0(row.dias_trabajador), iO = el("input"); iO.value = row.observaciones || ""; iO.disabled = !ed;
    const tot = el("p","hint"); const upd = () => { const e = C.cierre.length + (+iT.value || 0) + (+iV.value || 0) + (+iE.value || 0); tot.textContent = `Cuenta empresa: ${num(e)} (cierre ${C.cierre.length} + turnos + viernes + empresa) · Cuenta trabajador: ${num(+iW.value || 0)} · Total ${num(e + (+iW.value || 0))} días (convenio: ${num(+c.dias_defecto)}).`; tot.style.color = Math.abs(e + (+iW.value || 0) - +c.dias_defecto) > 0.01 ? "var(--red)" : ""; };
    for (const i of [iT, iV, iE, iW]) i.addEventListener("input", upd); upd();
    const g2 = el("div","f2"); g2.append(fl("Horas por día laborable", iH), fl("Días de turno (cuenta empresa)", iT, "Se apuntan con fecha en la ventana de turnos"), fl("Viernes de jornada corta (cuenta empresa)", iV, "Se descuentan solos, sin fecha"), fl("Días que pone la empresa", iE, "Se apuntan con fecha"), fl("Días de libre elección del trabajador", iW), fl("Observaciones", iO));
    cardC.append(g2, tot);
    if (ed){ const sv = el("button","btn small primary","Guardar calendario laboral"); sv.type = "button"; sv.addEventListener("click", async () => {
        const q = await sch().from("cal_laborales").update({ horas_dia:+iH.value || 8, dias_turnos:+iT.value || 0, dias_viernes:+iV.value || 0, dias_empresa:+iE.value || 0, dias_trabajador:+iW.value || 0, observaciones:iO.value.trim() || null }).eq("id", row.id);
        if (q.error){ console.error(q.error); return toast("No se ha podido guardar"); } toast("Calendario laboral guardado"); recargar(); }); cardC.append(sv); }
    // días de cierre y de turno: se marcan pulsando en el calendario
    if (ed){ const mo = el("div","seg"); mo.style.margin = "10px 0 0"; V.marca = V.marca || "Cierre";
      for (const [k, l] of [["Cierre","Marcar cierre de empresa"],["Turno","Marcar ventana de turnos"],["Quitar","Quitar marca"]]){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(V.marca === k)); b.addEventListener("click", () => { V.marca = k; render(); }); mo.append(b); }
      cardC.append(el("p","hint","Pulsa en los días del calendario para marcarlos según la opción elegida (cada clic guarda):"), mo); }
    box.append(cardC);
    const cie = V.data.cd.filter(x => x.calendario_id === row.id && x.tipo === "Cierre").map(x => x.fecha).sort();
    const tur = V.data.cd.filter(x => x.calendario_id === row.id && x.tipo === "Turno").length;
    box.append(el("p","hint",`Cierre de empresa: ${cie.length ? cie.map(fec).join(", ") : "sin días"} · Ventana de turnos: ${tur} días laborables.`));
    box.append(calendarioAnual(K, anio, cod, [], ed ? k => marcar(row, k) : null));
  }
  // festivos
  box.append(el("h3",null,`Festivos ${anio} (los dos calendarios)`));
  if (ed){ const a = el("div","ctrl"); const fd = el("input"); fd.type = "date"; fd.min = `${anio}-01-01`; fd.max = `${anio}-12-31`; const dsc = el("input"); dsc.placeholder = "Ej.: Fiesta local"; const tp = el("select"); for (const x of TIPOS_FEST) tp.append(new Option(x, x)); tp.value = "Local";
    const f2 = (lab, n) => { const d = el("div","fld"); d.append(el("span",null,lab), n); return d; };
    const ad = el("button","btn small primary","Añadir festivo"); ad.type = "button";
    ad.addEventListener("click", async () => { if (!fd.value || !dsc.value.trim()) return toast("Pon la fecha y la descripción"); if (fd.value.slice(0,4) !== String(anio)) return toast(`La fecha tiene que ser de ${anio}`);
      const q = await sch().from("vac_festivos").insert({ anio, fecha:fd.value, descripcion:dsc.value.trim(), tipo:tp.value }); if (q.error){ console.error(q.error); return toast(q.error.code === "23505" ? "Ese día ya es festivo" : "No se ha podido guardar"); } toast("Festivo añadido"); recargar(); });
    const ac = el("div","acc"); ac.append(ad); a.append(f2("Fecha", fd), f2("Descripción", dsc), f2("Tipo", tp), ac); box.append(a); }
  const tw = el("div","tblwrap"); const t = el("table","tbl"); const hr = el("tr"); for (const h of ["Fecha","Día","Descripción","Tipo", ed ? "" : null].filter(x => x !== null)) hr.append(el("th",null,h)); t.append(el("thead")); t.tHead.append(hr);
  const tb = el("tbody"); const FD = ["lunes","martes","miércoles","jueves","viernes","sábado","domingo"];
  for (const x of V.data.fest.filter(x => +x.anio === anio)){ const tr = el("tr"); const lab = lset.has(dsem(x.fecha)); const dd = el("td",null, FD[dsem(x.fecha) - 1] + (lab ? "" : " (no laborable)")); if (!lab) dd.style.color = "var(--ink-3)";
    tr.append(el("td",null,fec(x.fecha)), dd, el("td",null,x.descripcion), el("td",null,x.tipo));
    if (ed){ const td = el("td"); const b = el("button","btn small","Eliminar"); b.type = "button"; b.addEventListener("click", async () => { if (!confirm(`¿Quitar el festivo ${x.descripcion} (${fec(x.fecha)})?`)) return; const q = await sch().from("vac_festivos").delete().eq("id", x.id); if (q.error) return toast("No se ha podido eliminar"); recargar(); }); td.append(b); tr.append(td); }
    tb.append(tr); }
  t.append(tb); tw.append(t); box.append(tw);
}
async function marcar(row, k){
  const ya = V.data.cd.find(x => x.calendario_id === row.id && x.fecha === k), m = V.marca || "Cierre";
  let q;
  if (m === "Quitar"){ if (!ya) return; q = await sch().from("cal_dias").delete().eq("calendario_id", row.id).eq("fecha", k); }
  else if (ya){ if (ya.tipo === m) return; q = await sch().from("cal_dias").update({ tipo:m }).eq("calendario_id", row.id).eq("fecha", k); }
  else q = await sch().from("cal_dias").insert({ calendario_id:row.id, fecha:k, tipo:m, descripcion: m === "Cierre" ? "Cierre de empresa" : "Ventana de turnos" });
  if (q.error){ console.error(q.error); return toast("No se ha podido guardar el día"); }
  toast(m === "Quitar" ? `${fec(k)}: marca quitada` : `${fec(k)}: ${m === "Cierre" ? "cierre de empresa" : "ventana de turnos"}`); recargar();
}

async function nuevoAnio(){
  const ult = V.data.cals[V.data.cals.length - 1], anio = ult ? +ult.anio + 1 : new Date().getFullYear() + 1;
  if (!confirm(`¿Crear el calendario de vacaciones ${anio}? Se copian los días por convenio, los días laborables y la configuración de Planta y de Oficinas y almacén de ${ult ? ult.anio : "la configuración inicial"}; los festivos, el cierre y los turnos hay que marcarlos.`)) return;
  const q = await sch().from("vac_calendarios").insert({ anio, dias_defecto: ult ? ult.dias_defecto : 34, laborables: ult ? ult.laborables : [1,2,3,4,5] });
  if (q.error){ console.error(q.error); return toast("No se ha podido crear el calendario"); }
  const prev = V.data.cl.filter(x => ult && +x.anio === +ult.anio);
  if (prev.length){ const q2 = await sch().from("cal_laborales").insert(prev.map(x => ({ anio, codigo:x.codigo, nombre:x.nombre, horas_dia:x.horas_dia, dias_turnos:x.dias_turnos, dias_viernes:x.dias_viernes, dias_empresa:x.dias_empresa, dias_trabajador:x.dias_trabajador, observaciones:x.observaciones }))); if (q2.error) console.error(q2.error); }
  V.anio = anio; V.tab = "calendario"; toast(`Calendario ${anio} creado: añade festivos, cierre y turnos, y traspasa los pendientes de ${anio - 1}`); recargar();
}
async function traspasar(anio){
  const prev = anio - 1, K = V.K;
  const filas = personasAnio(prev).map(p => ({ p, r:K.resumen(p, prev) })).filter(x => x.r.pend > 0);
  if (!filas.length) return toast(`Nadie tiene días pendientes de ${prev}`);
  if (!confirm(`${filas.length} trabajadores tienen días pendientes de ${prev} (${num(filas.reduce((t, x) => t + x.r.pend, 0))} días en total). ¿Ponerlos como «años anteriores» (cuenta del trabajador) de ${anio}? Sustituye lo que hubiera en esa columna.`)) return;
  const rows = filas.map(({ p, r }) => { const s = K.saldo(anio, p.id), n = K.resumen(p, anio); return { anio, persona_id:p.id, dias_anio: s ? s.dias_anio : n.emp.total + n.trab.anio, dias_empresa: s ? s.dias_empresa : null, dias_trabajador: s ? s.dias_trabajador : null, dias_anteriores:r.pend, observaciones: s ? s.observaciones : null }; });
  const q = await sch().from("vac_saldos").upsert(rows); if (q.error){ console.error(q.error); return toast("No se ha podido traspasar"); }
  toast(`Pendientes de ${prev} traspasados a ${anio}`); V.tab = "panel"; recargar();
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
async function informePdf(lista, anio){
  if (!lista.length) return toast("No hay trabajadores en la lista");
  try { await pdfLib(); } catch(e){ return toast(e.message); }
  const K = V.K, doc = new window.jspdf.jsPDF({ unit:"mm", format:"a4" }), W = 210, M = 14;
  const AZ = [31,56,100], VE = [78,154,143], NA = [217,140,46], RO = [194,54,43], GR = [120,120,120];
  lista.forEach((p, i) => {
    if (i) doc.addPage();
    const r = K.resumen(p, anio), cod = r.cod;
    doc.setFillColor(...AZ); doc.rect(0, 0, W, 22, "F");
    doc.setTextColor(255); doc.setFont("helvetica","bold"); doc.setFontSize(15); doc.text(`Vacaciones ${anio}`, M, 10);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.text(`Baños 10 · Informe de vacaciones por trabajador · Calendario ${CAL_NOM[cod]}`, M, 16);
    doc.text(`Emitido el ${fec(hoyKey)}`, W - M, 16, { align:"right" });
    doc.setTextColor(30); doc.setFont("helvetica","bold"); doc.setFontSize(13); doc.text(p.nombre, M, 32);
    doc.setFont("helvetica","normal"); doc.setFontSize(9.5); doc.setTextColor(80);
    doc.text(`Código ${p.codigo}${p.departamento ? " · " + p.departamento : ""}${p.puesto ? " · " + p.puesto : ""}`, M, 38);
    doc.autoTable({ startY:43, margin:{ left:M, right:M }, theme:"grid", styles:{ fontSize:9, halign:"center", cellPadding:2 }, headStyles:{ fillColor:AZ, textColor:255 },
      head:[["Cuenta", "Años anteriores", `Días ${anio}`, "Total", "Disfrutados", "Pendientes"]],
      body:[["Empresa", "", num(r.emp.total), num(r.emp.total), num(r.emp.usado), num(r.emp.pend)], ["Trabajador", num(r.trab.ant), num(r.trab.anio), num(r.trab.total), num(r.trab.usado), num(r.trab.pend)], ["Total", num(r.trab.ant), num(r.emp.total + r.trab.anio), num(r.total), num(r.usado), num(r.pend)]],
      didParseCell: d => { if (d.section === "body" && (d.column.index === 5 || d.row.index === 2)){ d.cell.styles.fontStyle = "bold"; if (d.column.index === 5 && +String(d.cell.raw).replace(",", ".") < 0) d.cell.styles.textColor = RO; } } });
    let y = doc.lastAutoTable.finalY + 7;
    doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.setTextColor(30); doc.text("Detalle de las vacaciones", M, y);
    const body = [];
    if (r.emp.cierre) body.push(["", r.C.cierre.filter(k => (!p.fecha_alta || p.fecha_alta <= k) && (!p.fecha_baja || p.fecha_baja >= k)).map(k => fec(k).slice(0,5)).join(", "), "", "Cierre de empresa", "Empresa", num(r.emp.cierre), ""]);
    if (r.emp.viernes) body.push(["", "—", "", "Viernes de jornada corta", "Empresa", num(r.emp.viernes), "Automático"]);
    r.P.forEach((x, j) => body.push([j + 1, fec(x.a.fecha_inicio), fec(x.a.fecha_fin || x.a.fecha_inicio), x.a.concepto || "Libre elección", x.cuenta === "empresa" ? "Empresa" : "Trabajador", num(x.dias), (x.a.observaciones || "") + (x.a.fecha_inicio > hoyKey ? (x.a.observaciones ? " · " : "") + "programado" : "")]));
    doc.autoTable({ startY:y + 2, margin:{ left:M, right:M }, theme:"striped", styles:{ fontSize:8.5, cellPadding:1.6 }, headStyles:{ fillColor:VE, textColor:255 },
      head:[["Nº","Desde","Hasta","Concepto","Cuenta","Días","Comentario"]],
      body: body.length ? body : [["", "Sin vacaciones apuntadas", "", "", "", "", ""]],
      foot: body.length ? [["", "", "", "", "Total", num(r.usado), ""]] : undefined,
      footStyles:{ fillColor:[235,240,238], textColor:30, fontStyle:"bold" },
      columnStyles:{ 0:{ halign:"center", cellWidth:9 }, 5:{ halign:"right" } } });
    y = doc.lastAutoTable.finalY + 6;
    // calendario anual (4 × 3 meses)
    const vac = new Map(); for (const x of r.P) for (let d = new Date(x.a.fecha_inicio + "T00:00:00Z"); ymd(d) <= (x.a.fecha_fin || x.a.fecha_inicio); d.setUTCDate(d.getUTCDate() + 1)){ const k = ymd(d); if (K.laborable(k, cod) && !K.cierre(k, cod)) vac.set(k, x.cuenta); }
    const cw = 4.9, ch = 3.7, mw = 7 * cw, gap = (W - 2 * M - 4 * mw) / 3, mh = 3.6 + ch + 6 * ch + 2;
    if (y + 3 * mh + 30 > 297) { doc.addPage(); y = 16; }
    doc.setFont("helvetica","bold"); doc.setFontSize(10.5); doc.text(`Calendario ${anio}`, M, y); y += 3;
    for (let m = 0; m < 12; m++){
      const x0 = M + (m % 4) * (mw + gap), y0 = y + Math.floor(m / 4) * mh;
      doc.setFont("helvetica","bold"); doc.setFontSize(7.5); doc.setTextColor(...AZ); doc.text(MESES[m], x0, y0 + 3);
      doc.setFont("helvetica","normal"); doc.setFontSize(6); doc.setTextColor(...GR); DSEM.forEach((d, j) => doc.text(d, x0 + j * cw + cw / 2, y0 + 3.6 + ch - 1, { align:"center" }));
      const pri = `${anio}-${String(m + 1).padStart(2,"0")}-01`, nd = new Date(Date.UTC(anio, m + 1, 0)).getUTCDate(); let pos = dsem(pri) - 1;
      for (let d = 1; d <= nd; d++, pos++){ const k = `${anio}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`, cx = x0 + (pos % 7) * cw, cy = y0 + 3.6 + ch + Math.floor(pos / 7) * ch;
        const box = col => { doc.setFillColor(...col); doc.rect(cx + 0.2, cy + 0.2, cw - 0.4, ch - 0.4, "F"); };
        if (vac.has(k)){ box(vac.get(k) === "empresa" ? NA : VE); doc.setTextColor(255); }
        else if (K.cierre(k, cod)){ box(AZ); doc.setTextColor(255); }
        else if (K.festM.has(k)){ box([248, 222, 219]); doc.setTextColor(...RO); }
        else doc.setTextColor(...(K.laborable(k, cod) ? [40,40,40] : [170,170,170]));
        doc.text(String(d), cx + cw / 2, cy + ch - 1, { align:"center" }); } }
    y += 3 * mh + 2;
    doc.setFontSize(7.5); doc.setTextColor(60); let lx = M;
    for (const [col, t] of [[VE,"Vacaciones (trabajador)"],[NA,"Vacaciones (empresa)"],[AZ,"Cierre de empresa"],[[248,222,219],"Festivo"]]){ doc.setFillColor(...col); doc.rect(lx, y, 3, 3, "F"); doc.text(t, lx + 4.5, y + 2.5); lx += 42; }
    // firmas
    const fy = Math.min(Math.max(y + 22, 255), 280); doc.setDrawColor(150); doc.setTextColor(80); doc.setFontSize(8.5);
    doc.line(M, fy, M + 70, fy); doc.text("Firma del trabajador", M, fy + 4.5); doc.line(W - M - 70, fy, W - M, fy); doc.text("Firma de la empresa", W - M - 70, fy + 4.5);
    doc.setFontSize(7); doc.setTextColor(150); doc.text(`Días laborables del calendario ${anio} (${CAL_NOM[cod]}). En la cuenta del trabajador se gastan primero los días de años anteriores.`, M, 291);
  });
  const nombre = lista.length === 1 ? `Vacaciones_${anio}_${safe(lista[0].codigo + " " + lista[0].nombre)}` : `Vacaciones_${anio}_${lista.length}_trabajadores`;
  doc.save(nombre + ".pdf"); toast("Informe PDF descargado");
}
