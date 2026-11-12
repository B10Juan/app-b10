// APP B10 · Tesorería: facturas de proveedores pendientes de pago (hoja «Proveedores» de Tesoreria.xlsx)
import { sb, render, cabecera, nivel } from "../app.js";
import { el, toast, dLong, parseKey, xDate, sheet, saveXlsx, stamp } from "../util.js";

const T = { expV:true, expN:true, rows:null, loading:false, formas:{}, carga:null, abiertos:new Set(), q:"", formasSel:[], soloVencidas:false, verAbonos:true };
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const hoyKey = (() => { const d = new Date(); const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; })();
const eur = v => { if (v == null || !isFinite(v) || Math.abs(v) < 0.5) return ""; const n = Math.round(v); return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €"; };
const fec = k => k ? `${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(0,4)}` : "";
const mesLab = k => k === "sin" ? "sin fecha" : `${MES[+k.slice(5,7)-1]} ${k.slice(2,4)}`;

async function cargar(){
  T.loading = true;
  try{
    const out = [];
    for (let i = 0; ; i += 1000){
      const { data, error } = await sb.schema("tesoreria").from("facturas_proveedores")
        .select("id,proveedor_cod,proveedor,asiento,factura,concepto,fecha_factura,vencimiento,importe_pendiente,importe,forma_pago,subvencion")
        .neq("importe_pendiente", 0).order("vencimiento").range(i, i+999);
      if (error) throw error; out.push(...data); if (data.length < 1000) break;
    }
    const [f, c] = await Promise.all([
      sb.schema("tesoreria").from("formas_pago").select("codigo,nombre"),
      sb.schema("core").from("cargas").select("fichero,cargado_en,fecha_datos,filas").eq("tipo","tesoreria_proveedores").order("cargado_en",{ascending:false}).limit(1),
    ]);
    T.formas = Object.fromEntries((f.data || []).map(x => [x.codigo, x.nombre]));
    T.carga = (c.data || [])[0] || null;
    // «pendiente» en positivo: lo que hay que pagar; los abonos a favor quedan en negativo
    T.rows = out.map(r => ({ ...r, pend: -(+r.importe_pendiente || 0), venc: r.vencimiento || null }));
  } catch(e){ console.error(e); toast("No se han podido cargar las facturas pendientes."); T.rows = []; }
  T.loading = false; render();
}
const nombreForma = c => c ? (T.formas[c] ? `${T.formas[c]} (${c})` : c) : "Sin forma de pago";

export function renderTesoreria(app){
  document.title = "Tesorería: facturas de proveedores pendientes de pago";
  cabecera(app, "Facturas de proveedores pendientes de pago", "Importes pendientes por proveedor y mes de vencimiento, separando lo vencido de lo que vence más adelante.", { txt:"Tesorería", href:"#tesoreria" }, "tesoreria_prov");
  const box = el("div","pad tes"); box.style.paddingBottom = "32px"; app.append(box);
  if (!T.rows){ if (!T.loading) cargar(); box.append(el("div","card empty","Cargando facturas…")); return; }
  if (T.carga) box.append(el("p","hint",`Datos del fichero «${T.carga.fichero}»${T.carga.fecha_datos ? ", guardado el " + dLong(parseKey(T.carga.fecha_datos.slice(0,10))) : ""}. Una factura está vencida si su vencimiento es anterior a hoy (${fec(hoyKey)}). Los importes pendientes van en positivo; los abonos a favor, en negativo.`));

  // filtros
  const formas = [...new Set(T.rows.map(r => r.forma_pago || ""))].sort();
  const ctl = el("div","ctrl");
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Proveedor, factura o concepto"; q.value = T.q; q.dataset.k = "tes-q"; q.addEventListener("input", () => { T.q = q.value; render(); }); qd.append(el("span",null,"Buscar"), q); ctl.append(qd);
  const fd = el("div","fld"); const sg = el("div","seg");
  for (const c of formas){ const b = el("button",null, T.formas[c] || c || "Sin forma"); b.type = "button"; b.title = nombreForma(c); b.setAttribute("aria-pressed", String(T.formasSel.includes(c)));
    b.addEventListener("click", () => { T.formasSel = T.formasSel.includes(c) ? T.formasSel.filter(x => x !== c) : [...T.formasSel, c]; render(); }); sg.append(b); }
  fd.append(el("span",null,"Forma de pago"), sg); ctl.append(fd);
  const cb = (txt, key) => { const l = el("label","chk"); const i = el("input"); i.type = "checkbox"; i.checked = T[key]; i.addEventListener("change", () => { T[key] = i.checked; render(); }); l.append(i, " " + txt); return l; };
  ctl.append(cb("Solo vencidas","soloVencidas"), cb("Incluir abonos","verAbonos"));
  const acc = el("div","acc"); const exb = el("button","btn","Exportar a Excel"); exb.addEventListener("click", exportar); acc.append(exb);
  if (nivel("tesoreria_prov") === "editar"){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm"; inp.hidden = true;
    const up = el("button","btn primary","Actualizar con Excel"); up.title = "Subir el fichero Tesoreria.xlsx (se lee la hoja «Proveedores»)"; up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => { if (inp.files[0]) cargarFichero(inp.files[0], T.msg, inp); });
    acc.append(up, inp);
  }
  ctl.append(acc); box.append(ctl);
  if (!T.msg) T.msg = el("p","hint upmsg"); box.append(T.msg);

  const qq = T.q.trim().toLowerCase();
  const L = T.rows.filter(r => (!T.formasSel.length || T.formasSel.includes(r.forma_pago || ""))
    && (!qq || `${r.proveedor} ${r.factura} ${r.concepto || ""} ${r.proveedor_cod}`.toLowerCase().includes(qq))
    && (T.verAbonos || r.pend > 0) && (!T.soloVencidas || (r.venc && r.venc < hoyKey)));
  const vencida = r => !!r.venc && r.venc < hoyKey;
  const mk = r => r.venc ? r.venc.slice(0,7) : "sin";

  // indicadores
  const sum = a => a.reduce((s,r) => s + r.pend, 0);
  const en = d => { const x = new Date(); x.setDate(x.getDate() + d); const p = n => String(n).padStart(2,"0"); return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`; };
  const V = L.filter(vencida), N7 = L.filter(r => !vencida(r) && r.venc && r.venc <= en(7)), N30 = L.filter(r => !vencida(r) && r.venc && r.venc <= en(30)), AB = L.filter(r => r.pend < 0);
  const k = el("div","kpis"); const kp = (t, v, s, cl) => { const d = el("div","kpi"+(cl?" "+cl:"")); d.append(el("small",null,t), el("b",null,v)); if (s) d.append(el("span","delta",s)); return d; };
  k.append(kp("Total pendiente de pago", eur(sum(L)) || "0 €", `${L.length} facturas · ${new Set(L.map(r => r.proveedor)).size} proveedores`),
    kp("Vencido sin pagar", eur(sum(V)) || "0 €", `${V.length} facturas`, V.length ? "bad" : ""),
    kp("Vence en 7 días", eur(sum(N7)) || "0 €", `${N7.length} facturas`), kp("Vence en 30 días", eur(sum(N30)) || "0 €", `${N30.length} facturas`),
    kp("Abonos a favor", eur(sum(AB)) || "0 €", `${AB.length} documentos`));
  box.append(k);

  // columnas: meses vencidos y meses por vencer
  const mV = [...new Set(L.filter(vencida).map(mk))].sort(), mN = [...new Set(L.filter(r => !vencida(r)).map(mk))].sort((a,b) => a === "sin" ? 1 : b === "sin" ? -1 : a < b ? -1 : 1);
  const prov = new Map();
  for (const r of L){ const x = prov.get(r.proveedor) || { nombre:r.proveedor, cod:r.proveedor_cod, filas:[], v:{}, n:{}, tv:0, tn:0, t:0 };
    const m = mk(r); if (vencida(r)){ x.v[m] = (x.v[m] || 0) + r.pend; x.tv += r.pend; } else { x.n[m] = (x.n[m] || 0) + r.pend; x.tn += r.pend; } x.t += r.pend; x.filas.push(r); prov.set(r.proveedor, x); }
  const P = [...prov.values()].sort((a,b) => b.t - a.t);
  // grupos de columnas desplegables: plegados solo se ve su total
  const mVv = T.expV ? mV : [], mNv = T.expN ? mN : [];
  const tw = el("div","rwrap"); const t = el("table","rtbl tesbl");
  const th = el("thead"); const g1 = el("tr","grp"); const gc = (txt, n, cls) => { const x = el("th",cls||"",txt); x.colSpan = n; return x; };
  const gt = (txt, n, cls, key) => { const x = gc("", n, cls + " tog"); const b = el("button","gtog"); b.type = "button"; const ab = T[key];
    b.append(el("span","gi", ab ? "⊟" : "⊞"), txt); b.title = ab ? `Agrupar: ver solo el total ${txt.toLowerCase()}` : `Desplegar los meses de ${txt.toLowerCase()}`;
    b.addEventListener("click", () => { T[key] = !T[key]; render(); }); x.append(b); return x; };
  g1.append(gc("",1,"fix f1"), gc("",3), gt("Vencida", mVv.length + 1, "gs gv", "expV"), gt("No vencida", mNv.length + 1, "gs", "expN"), gc("",1));
  const hr = el("tr"); const h2 = (a, b, cls) => { const x = el("th",cls||""); x.append(a); if (b){ x.append(el("br")); x.append(el("small",null,b)); } return x; };
  hr.append(h2("Proveedor", "o factura", "l fix f1"), h2("Fecha", "factura", "n"), h2("Vencimiento", null, "n"), h2("Forma", "de pago", "l"));
  mVv.forEach((m,i) => hr.append(h2(mesLab(m), null, "n m"+(i===0?" gsl":"")))); hr.append(h2("Total", "vencida", "n tot"+(mVv.length?"":" gsl")));
  mNv.forEach((m,i) => hr.append(h2(mesLab(m), null, "n m"+(i===0?" gsl":"")))); hr.append(h2("Total", "no vencida", "n tot"+(mNv.length?"":" gsl")));
  hr.append(h2("Total", "pendiente", "n tot gsl"));
  th.append(g1, hr); t.append(th);
  const tb = el("tbody");
  const celda = (v, cls) => { const td = el("td","n "+(cls||"")); const s = el("span",null,eur(v)); if (v < 0) td.classList.add("abono"); td.append(s); return td; };
  for (const x of P){
    const open = T.abiertos.has(x.nombre);
    const tr = el("tr","rsup"+(open?" open":"")); tr.title = open ? "Plegar" : "Ver sus facturas"; tr.addEventListener("click", () => { open ? T.abiertos.delete(x.nombre) : T.abiertos.add(x.nombre); render(); });
    const c0 = el("td","l fix f1 sup"); c0.append(el("span","chev", open ? "▾" : "▸"), el("b",null,x.nombre), el("small",null,` ${x.filas.length} fra.`));
    tr.append(c0, el("td"), el("td"), el("td"));
    mVv.forEach((m,i) => tr.append(celda(x.v[m], "venc"+(i===0?" gsl":"")))); tr.append(celda(x.tv, "tot venc"+(mVv.length?"":" gsl")));
    mNv.forEach((m,i) => tr.append(celda(x.n[m], i===0?"gsl":""))); tr.append(celda(x.tn, "tot"+(mNv.length?"":" gsl")));
    tr.append(celda(x.t, "tot gsl")); tb.append(tr);
    if (!open) continue;
    for (const r of x.filas.slice().sort((a,b) => (a.venc || "9") < (b.venc || "9") ? -1 : 1)){
      const rr = el("tr","rart"); const cf = el("td","l fix f1 code"); cf.append(`Fra. ${r.factura || "—"}`); if (r.concepto) cf.title = r.concepto; cf.append(el("small",null,` · ${r.asiento || ""}`));
      rr.append(cf, el("td","n",fec(r.fecha_factura)), el("td","n"+(vencida(r)?" late":""),fec(r.venc)), el("td","l fp",T.formas[r.forma_pago] || r.forma_pago || ""));
      const m = mk(r);
      mVv.forEach((mm,i) => rr.append(celda(vencida(r) && mm === m ? r.pend : null, "venc"+(i===0?" gsl":"")))); rr.append(celda(vencida(r) ? r.pend : null, "tot venc"+(mVv.length?"":" gsl")));
      mNv.forEach((mm,i) => rr.append(celda(!vencida(r) && mm === m ? r.pend : null, i===0?"gsl":""))); rr.append(celda(!vencida(r) ? r.pend : null, "tot"+(mNv.length?"":" gsl")));
      rr.append(celda(r.pend, "tot gsl")); tb.append(rr);
    }
  }
  if (!P.length){ const tr = el("tr"); const td = el("td","empty","No hay facturas pendientes con estos filtros."); td.colSpan = 6 + mVv.length + mNv.length; tr.append(td); tb.append(tr); }
  t.append(tb);
  const tf = el("tfoot"), fr = el("tr"); const c0 = el("td","l fix f1"); c0.append(el("b",null,"Total general")); fr.append(c0, el("td"), el("td"), el("td"));
  mVv.forEach((m,i) => fr.append(celda(P.reduce((s,x) => s + (x.v[m] || 0), 0), "venc"+(i===0?" gsl":"")))); fr.append(celda(sum(V.filter(r => L.includes(r))), "tot venc"+(mVv.length?"":" gsl")));
  mNv.forEach((m,i) => fr.append(celda(P.reduce((s,x) => s + (x.n[m] || 0), 0), i===0?"gsl":""))); fr.append(celda(sum(L.filter(r => !vencida(r))), "tot"+(mNv.length?"":" gsl")));
  fr.append(celda(sum(L), "tot gsl")); tf.append(fr); t.append(tf);
  tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa un proveedor para ver sus facturas. Al pasar el ratón por una factura se ve su concepto."));
  T._L = L; T._mV = mV; T._mN = mN; T._P = P;
}

function exportar(){
  const L = T._L || [], wb = XLSX.utils.book_new(); const vencida = r => !!r.venc && r.venc < hoyKey; const mk = r => r.venc ? r.venc.slice(0,7) : "sin";
  const A = [["Proveedor","Código","Factura","Asiento","Concepto","Fecha factura","Vencimiento","Forma de pago","Situación","Importe pendiente"]];
  for (const r of L.slice().sort((a,b) => a.proveedor < b.proveedor ? -1 : a.proveedor > b.proveedor ? 1 : (a.venc || "") < (b.venc || "") ? -1 : 1))
    A.push([r.proveedor, r.proveedor_cod, r.factura, r.asiento, r.concepto || "", r.fecha_factura ? xDate(parseKey(r.fecha_factura)) : "", r.venc ? xDate(parseKey(r.venc)) : "", nombreForma(r.forma_pago), vencida(r) ? "Vencida" : "No vencida", Math.round(r.pend*100)/100]);
  XLSX.utils.book_append_sheet(wb, sheet(A, [34,10,16,12,30,12,12,28,11,14]), "Facturas pendientes");
  const H = ["Proveedor", ...T._mV.map(m => "Vencida " + mesLab(m)), "Total vencida", ...T._mN.map(m => "No vencida " + mesLab(m)), "Total no vencida", "Total pendiente"];
  const B = [H]; for (const x of T._P) B.push([x.nombre, ...T._mV.map(m => Math.round((x.v[m] || 0)*100)/100), Math.round(x.tv*100)/100, ...T._mN.map(m => Math.round((x.n[m] || 0)*100)/100), Math.round(x.tn*100)/100, Math.round(x.t*100)/100]);
  XLSX.utils.book_append_sheet(wb, sheet(B, [34, ...H.slice(1).map(() => 13)]), "Resumen por proveedor");
  saveXlsx(wb, `Facturas_proveedores_pendientes_${stamp()}.xlsx`);
}

function cargaBox(box){
  if (nivel("tesoreria_prov") !== "editar") return;
  const d = el("details","card cargas"); d.style.marginTop = "18px"; d.append(el("summary",null,"Actualizar datos (fichero Tesoreria.xlsx)"));
  d.append(el("p","hint","Elige el Excel de tesorería. Se lee solo la hoja «Proveedores» y se sustituyen todos los datos anteriores."));
  const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm"; const msg = el("p","hint");
  inp.addEventListener("change", () => { if (inp.files[0]) cargarFichero(inp.files[0], msg, inp); });
  d.append(inp, msg); box.append(d);
}
const S = v => { if (v == null) return null; const s = String(v).trim(); return s && s !== "nan" ? s : null; };
const N = v => { if (v == null || v === "") return null; const x = typeof v === "number" ? v : Number(String(v).replace(",", ".")); return isFinite(x) ? x : null; };
const D = v => { if (!v) return null; const d = v instanceof Date ? v : new Date(v); if (isNaN(d)) return null; const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; };
async function cargarFichero(file, msg, inp){
  const set = t => { msg.textContent = t; };
  try{
    inp.disabled = true; set("Leyendo la hoja Proveedores…");
    const wb = XLSX.read(await file.arrayBuffer(), { type:"array", cellDates:true, sheets:["Proveedores"] });
    const ws = wb.Sheets["Proveedores"]; if (!ws) throw new Error("El fichero no tiene la hoja «Proveedores».");
    const R = XLSX.utils.sheet_to_json(ws, { defval:null, raw:true }).filter(r => r.Proveedor || r["Cod Proveedor"]);
    const rows = R.map(r => ({ proveedor_cod:S(r["Cod Proveedor"]), proveedor:S(r.Proveedor), asiento:S(r.Asiento), factura:S(r.Factura), concepto:S(r.Concepto), pagada: String(r.Pagado || "").trim().toUpperCase() === "P",
      fecha_factura:D(r["Fecha facura"] ?? r["Fecha factura"]), vencimiento:D(r["Vto Original"]), importe_pendiente:N(r.Riesgo), importe:N(r.importe), forma_pago:S(r.Banco), vencimiento_tabla:D(r["Vto Tabla"]),
      subvencion:N(r["Subvención"]), vencida_excel: String(r.Vencida || "").trim() === "Vencida" }));
    const pend = rows.filter(r => r.importe_pendiente);
    if (!confirm(`La hoja tiene ${rows.length} facturas, ${pend.length} pendientes de pago. Se sustituirán los datos actuales. ¿Continuar?`)){ set(""); inp.disabled = false; inp.value = ""; return; }
    const c = await sb.schema("core").from("cargas").insert({ tipo:"tesoreria_proveedores", fichero:file.name, filas:rows.length, importe_total: Math.round(pend.reduce((s,r) => s + r.importe_pendiente, 0)*100)/100, fecha_datos:new Date(file.lastModified || Date.now()).toISOString(), notas:"Carga desde la app" }).select("id").single();
    if (c.error) throw c.error;
    set("Sustituyendo los datos…");
    const del = await sb.schema("tesoreria").from("facturas_proveedores").delete().gte("id", 0); if (del.error) throw del.error;
    for (let i = 0; i < rows.length; i += 1000){ const r = await sb.schema("tesoreria").from("facturas_proveedores").insert(rows.slice(i, i+1000).map(x => Object.assign({ carga_id:c.data.id }, x))); if (r.error) throw r.error; }
    set(`Hecho: ${pend.length} facturas pendientes cargadas.`); toast("Facturas pendientes actualizadas"); T.rows = null; render();
  } catch(e){ console.error(e); set("No se ha podido cargar: " + (e.message || "error")); }
  inp.disabled = false; inp.value = "";
}
