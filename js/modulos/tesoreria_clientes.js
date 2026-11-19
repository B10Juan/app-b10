// APP B10 · Tesorería: facturas de clientes pendientes de cobro (hoja «CustTransOpen» de transacciones abiertas de clientes de AX)
import { sb, render, cabecera, nivel, ctx } from "../app.js";
import { el, toast, dLong, parseKey, xDate, sheet, saveXlsx, stamp, ddMulti } from "../util.js";

const MOD = "tesoreria_cli";
const T = { rows:null, loading:false, carga:null, expV:true, expN:true, det:3, tog:new Map(), q:"", orden:"importe",
  f:{ estado:null, mercado:[], agrup:[], modo:[], cliente:[], sit:[], mes:[] } };
const MES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const p2 = n => String(n).padStart(2,"0");
const hoyD = new Date(), hoyKey = `${hoyD.getFullYear()}-${p2(hoyD.getMonth()+1)}-${p2(hoyD.getDate())}`;
const mesDesde = d => { const x = new Date(hoyD.getFullYear(), hoyD.getMonth() + d, 1); return `${x.getFullYear()}-${p2(x.getMonth()+1)}`; };
const LIM_V = mesDesde(-11), LIM_N = mesDesde(11), A_VIEJO = hoyD.getFullYear() - 3;   // ventana de 12 meses a cada lado
const eur = v => { if (v == null || !isFinite(v) || Math.abs(v) < 0.5) return ""; const n = Math.round(v); return (n < 0 ? "-" : "") + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".") + " €"; };
const fec = k => k ? `${k.slice(8,10)}/${k.slice(5,7)}/${k.slice(0,4)}` : "";
const SIN = "(sin dato)";
const vencida = r => !!r.venc && r.venc < hoyKey;
// Columna de vencimiento: meses de los últimos y próximos 12 meses; fuera de esa ventana, por años o «posteriores»
function col(r){
  if (!r.venc) return "9999-99";
  const m = r.venc.slice(0,7);
  if (vencida(r)){ if (m >= LIM_V) return m; const y = +m.slice(0,4); return y <= A_VIEJO ? "0000-00" : `${y}-00`; }
  return m <= LIM_N ? m : "9999-98";
}
const colLab = k => k === "9999-99" ? "sin fecha" : k === "9999-98" ? "posteriores" : k === "0000-00" ? `hasta ${A_VIEJO}` : k.endsWith("-00") ? `año ${k.slice(0,4)}` : `${MES[+k.slice(5,7)-1]} ${k.slice(2,4)}`;
const sitLab = r => vencida(r) ? "Vencida" : "No vencida";

const NIVELES = [
  { k:"mercado", t:"Mercado" },
  { k:"agrup",   t:"Agrupación sistema cobro" },
  { k:"cliente", t:"Nombre" },
];

async function cargar(){
  T.loading = true;
  try{
    const out = [];
    for (let i = 0; ; i += 1000){
      const { data, error } = await sb.schema("tesoreria").from("facturas_clientes")
        .select("id,cliente,cliente_cod,asiento,factura,texto,fecha_factura,vencimiento,importe,modo_pago,estado,estado_efecto,remesa,banco,agrupacion,mercado")
        .neq("importe", 0).order("vencimiento").range(i, i+999);
      if (error) throw error; out.push(...data); if (data.length < 1000) break;
    }
    const c = await sb.schema("core").from("cargas").select("fichero,cargado_en,fecha_datos,filas").eq("tipo","tesoreria_clientes").order("cargado_en",{ascending:false}).limit(1);
    T.carga = (c.data || [])[0] || null;
    T.rows = out.map(r => ({ ...r, imp:+r.importe || 0, venc:r.vencimiento || null,
      mercado:r.mercado || SIN, agrup:r.agrupacion || SIN, modo:r.modo_pago || SIN, cliente:r.cliente || r.cliente_cod || SIN, estado:r.estado || SIN }));
    T.rows.forEach(r => { r.col = col(r); r.sit = sitLab(r); });
    // Estado por defecto: General e Impago (lo que hay que cobrar), si existen
    if (!T.f.estado && T.rows.length){ const e = new Set(T.rows.map(r => r.estado)); T.f.estado = ["General","Impago"].filter(x => e.has(x)); }
  } catch(e){ console.error(e); toast("No se han podido cargar las facturas de clientes."); T.rows = []; }
  T.loading = false; render();
}

const opciones = (rows, k, lab) => { const m = new Map(); for (const r of rows){ const v = r[k]; const x = m.get(v) || { v, l: lab ? lab(v) : v, n:0, s:0 }; x.n++; x.s += r.imp; m.set(v, x); } return [...m.values()]; };

export function renderTesoreriaClientes(app){
  document.title = "Tesorería: facturas de clientes pendientes de cobro";
  cabecera(app, "Facturas de clientes pendientes de cobro", "Importes pendientes por mercado, sistema de cobro y cliente, por mes de vencimiento, separando lo vencido de lo que vence más adelante. Pulsa un cliente para ver sus facturas.", { txt:"Tesorería", href:"#tesoreria" }, MOD);
  const box = el("div","pad tes tcli"); box.style.paddingBottom = "32px"; app.append(box);
  if (!T.rows){ if (!T.loading) cargar(); box.append(el("div","card empty","Cargando facturas…")); return; }
  if (T.carga) box.append(el("p","hint",`Datos del fichero «${T.carga.fichero}»${T.carga.fecha_datos ? ", informe del " + dLong(parseKey(T.carga.fecha_datos.slice(0,10))) : ""}. Una factura está vencida si su vencimiento es anterior a hoy (${fec(hoyKey)}). Los importes a cobrar van en positivo; los abonos y cobros a cuenta, en negativo.`));
  else box.append(el("p","hint","Todavía no hay datos. Sube el Excel de transacciones abiertas de clientes con «Actualizar con Excel» (se lee la hoja «CustTransOpen»)."));

  const F = T.f, rr = () => render(); const FE = F.estado || [];
  const pasa = (r, salvo) => (salvo === "estado" || !FE.length || FE.includes(r.estado))
    && (salvo === "mercado" || !F.mercado.length || F.mercado.includes(r.mercado))
    && (salvo === "agrup" || !F.agrup.length || F.agrup.includes(r.agrup))
    && (salvo === "modo" || !F.modo.length || F.modo.includes(r.modo))
    && (salvo === "cliente" || !F.cliente.length || F.cliente.includes(r.cliente))
    && (salvo === "sit" || !F.sit.length || F.sit.includes(r.sit))
    && (salvo === "col" || !F.mes.length || F.mes.includes(r.col));
  const qq = T.q.trim().toLowerCase();
  const busca = r => !qq || `${r.cliente} ${r.cliente_cod || ""} ${r.factura || ""} ${r.asiento || ""} ${r.texto || ""}`.toLowerCase().includes(qq);
  // opciones de cada filtro: las que quedan con los demás filtros aplicados
  const ops = (k, salvo, lab, ord) => { const o = opciones(T.rows.filter(r => pasa(r, salvo) && busca(r)), k, lab);
    for (const x of o) x.sub = ` ${x.n} · ${eur(x.s) || "0 €"}`; return o.sort(ord || ((a,b) => String(a.l).localeCompare(String(b.l), "es"))); };

  // Estado: filtro principal, arriba
  const top = el("div","ctrl estado-ctrl");
  const ed = el("div","fld"); const sg = el("div","seg");
  const estados = opciones(T.rows, "estado").sort((a,b) => b.n - a.n);
  for (const e of estados){ const b = el("button",null,e.v); b.type = "button"; b.title = `${e.n} apuntes · ${eur(e.s) || "0 €"}`; b.setAttribute("aria-pressed", String(FE.includes(e.v)));
    b.addEventListener("click", () => { F.estado = FE.includes(e.v) ? FE.filter(x => x !== e.v) : [...FE, e.v]; rr(); }); sg.append(b); }
  ed.append(el("span",null,"Estado" + (FE.length ? "" : " (todos)")), sg); top.append(ed);
  const acc = el("div","acc");
  const fmb = el("button","btn","Descargar formato"); fmb.title = "Excel con las columnas de la hoja «CustTransOpen», instrucciones y los datos actuales"; fmb.addEventListener("click", descargarFormato); acc.append(fmb);
  const exb = el("button","btn","Exportar a Excel"); exb.addEventListener("click", exportar); acc.append(exb);
  if (nivel(MOD) === "editar"){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm"; inp.hidden = true;
    const up = el("button","btn primary","Actualizar con Excel"); up.title = "Subir el Excel de transacciones abiertas de clientes (se lee la hoja «CustTransOpen»)"; up.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => { if (inp.files[0]) cargarFichero(inp.files[0], T.msg, inp); });
    acc.append(up, inp);
  }
  top.append(acc); box.append(top);
  if (!T.msg) T.msg = el("p","hint upmsg"); box.append(T.msg);

  // resto de filtros: todos los campos que se ven
  const ctl = el("div","ctrl");
  const dd = (id, lab, k, salvo, key, labf, ord) => ddMulti(ctx.ui, "tc-"+id, lab, ops(k, salvo, labf, ord), F[key], v => { F[key] = v; rr(); }, rr);
  ctl.append(dd("mer","Mercado","mercado","mercado","mercado"), dd("agr","Agrupación","agrup","agrup","agrup"), dd("mod","Modo de pago","modo","modo","modo"),
    dd("cli","Nombre","cliente","cliente","cliente"), dd("sit","Situación","sit","sit","sit"), dd("mes","Vencimiento","col","col","mes", colLab, (a,b) => a.v < b.v ? -1 : 1));
  const qd = el("div","fld"); const q = el("input"); q.type = "search"; q.placeholder = "Cliente, código, factura o asiento"; q.value = T.q; q.dataset.k = "tc-q"; q.addEventListener("input", () => { T.q = q.value; rr(); }); qd.append(el("span",null,"Buscar"), q); ctl.append(qd);
  const hay = F.mercado.length || F.agrup.length || F.modo.length || F.cliente.length || F.sit.length || F.mes.length || T.q;
  if (hay){ const cl = el("button","btn small","Quitar filtros"); cl.type = "button"; cl.addEventListener("click", () => { Object.assign(F, { mercado:[], agrup:[], modo:[], cliente:[], sit:[], mes:[] }); T.q = ""; rr(); }); ctl.append(cl); }
  box.append(ctl);

  const L = T.rows.filter(r => pasa(r) && busca(r));
  const sum = a => a.reduce((s,r) => s + r.imp, 0);
  const en = d => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${p2(x.getMonth()+1)}-${p2(x.getDate())}`; };
  const V = L.filter(vencida), V90 = V.filter(r => r.venc < en(-90)), N30 = L.filter(r => !vencida(r) && r.venc && r.venc <= en(30)), AB = L.filter(r => r.imp < 0);
  const k = el("div","kpis"); const kp = (t, v, s, cl) => { const d = el("div","kpi"+(cl?" "+cl:"")); d.append(el("small",null,t), el("b",null,v)); if (s) d.append(el("span","delta",s)); return d; };
  k.append(kp("Total pendiente de cobro", eur(sum(L)) || "0 €", `${L.length} apuntes · ${new Set(L.map(r => r.cliente)).size} clientes`),
    kp("Vencido sin cobrar", eur(sum(V)) || "0 €", `${V.length} apuntes`, V.length ? "bad" : ""),
    kp("Vencido hace más de 90 días", eur(sum(V90)) || "0 €", `${V90.length} apuntes`, V90.length ? "bad" : ""),
    kp("Vence en 30 días", eur(sum(N30)) || "0 €", `${N30.length} apuntes`),
    kp("Abonos y cobros a cuenta", eur(sum(AB)) || "0 €", `${AB.length} apuntes`));
  box.append(k);

  // nivel de detalle
  const dctl = el("div","ctrl rctl"); const df = el("div","fld"); const ds = el("div","seg");
  NIVELES.map(n => n.t).forEach((t, i) => { const b = el("button",null,t); b.type = "button"; b.setAttribute("aria-pressed", String(T.det === i+1));
    b.addEventListener("click", () => { T.det = i+1; T.tog.clear(); rr(); }); ds.append(b); });
  df.append(el("span",null,"Detalle hasta"), ds); dctl.append(df);
  const of = el("div","fld"); const os = el("div","seg");
  for (const [v,t] of [["importe","Importe"],["nombre","Nombre"]]){ const b = el("button",null,t); b.type = "button"; b.setAttribute("aria-pressed", String(T.orden === v)); b.addEventListener("click", () => { T.orden = v; rr(); }); os.append(b); }
  of.append(el("span",null,"Ordenar clientes por"), os); dctl.append(of);
  box.append(dctl);

  // columnas de vencimiento
  const mV = [...new Set(V.map(r => r.col))].sort(), mN = [...new Set(L.filter(r => !vencida(r)).map(r => r.col))].sort();
  const mVv = T.expV ? mV : [], mNv = T.expN ? mN : [];
  // árbol mercado › agrupación › modo de pago › cliente › facturas
  const nodo = (lab, d, path) => ({ lab, d, path, v:{}, n:{}, tv:0, tn:0, t:0, hijos:new Map(), filas:[] });
  const raiz = nodo("", 0, "");
  for (const r of L){
    let x = raiz; const add = y => { if (vencida(r)){ y.v[r.col] = (y.v[r.col] || 0) + r.imp; y.tv += r.imp; } else { y.n[r.col] = (y.n[r.col] || 0) + r.imp; y.tn += r.imp; } y.t += r.imp; y.filas.push(r); };
    add(x);
    NIVELES.forEach((nv, i) => { const key = r[nv.k]; let h = x.hijos.get(key); if (!h){ h = nodo(key, i+1, x.path + "\u0001" + key); if (nv.k === "cliente") h.cod = r.cliente_cod; x.hijos.set(key, h); } x = h; add(x); });
  }
  const abierto = n => T.tog.has(n.path) ? T.tog.get(n.path) : n.d < T.det;
  const ordenar = (hs, d) => [...hs.values()].sort(d === 3 && T.orden === "importe" ? (a,b) => b.t - a.t : (a,b) => a.lab === SIN ? 1 : b.lab === SIN ? -1 : String(a.lab).localeCompare(String(b.lab), "es"));

  const tw = el("div","rwrap"); const t = el("table","rtbl tesbl tclitbl");
  const th = el("thead"); const g1 = el("tr","grp"); const gc = (txt, n, cls) => { const x = el("th",cls||"",txt); x.colSpan = n; return x; };
  const gt = (txt, n, cls, key) => { const x = gc("", n, cls + " tog"); const b = el("button","gtog"); b.type = "button"; const ab = T[key];
    b.append(el("span","gi", ab ? "⊟" : "⊞"), txt); b.title = ab ? `Agrupar: ver solo el total ${txt.toLowerCase()}` : `Desplegar los meses de ${txt.toLowerCase()}`;
    b.addEventListener("click", () => { T[key] = !T[key]; rr(); }); x.append(b); return x; };
  g1.append(gc("",1,"fix c1"), gc("",1,"fix c2"), gc("",1,"fix c3"), gt("Vencida", mVv.length + 1, "gs gv", "expV"), gt("No vencida", mNv.length + 1, "gs", "expN"), gc("",1));
  const hr = el("tr"); const h2 = (a, b, cls) => { const x = el("th",cls||""); x.append(a); if (b){ x.append(el("br")); x.append(el("small",null,b)); } return x; };
  hr.append(h2("Mercado", null, "l fix c1"), h2("Agrupación", "sistema cobro", "l fix c2"), h2("Nombre", "pulsa para ver sus facturas", "l fix c3"));
  mVv.forEach((m,i) => hr.append(h2(colLab(m), null, "n m"+(i===0?" gsl":"")))); hr.append(h2("Total", "vencida", "n tot"+(mVv.length?"":" gsl")));
  mNv.forEach((m,i) => hr.append(h2(colLab(m), null, "n m"+(i===0?" gsl":"")))); hr.append(h2("Total", "no vencida", "n tot"+(mNv.length?"":" gsl")));
  hr.append(h2("Total", "pendiente", "n tot gsl"));
  th.append(g1, hr); t.append(th);
  const tb = el("tbody");
  const celda = (v, cls) => { const td = el("td","n "+(cls||"")); if (v < 0) td.classList.add("abono"); td.append(el("span",null,eur(v))); return td; };
  const importes = (tr, x) => {
    mVv.forEach((m,i) => tr.append(celda(x.v[m], "venc"+(i===0?" gsl":"")))); tr.append(celda(x.tv, "tot venc"+(mVv.length?"":" gsl")));
    mNv.forEach((m,i) => tr.append(celda(x.n[m], i===0?"gsl":""))); tr.append(celda(x.tn, "tot"+(mNv.length?"":" gsl")));
    tr.append(celda(x.t, "tot gsl"));
  };
  let filas = 0;
  const pinta = x => {
    const open = abierto(x), cliente = x.d === 3;
    const tr = el("tr","rsup lv"+x.d+(open?" open":"")); tr.title = cliente ? "Ver el detalle de sus facturas" : (open ? "Plegar" : "Desplegar");
    tr.addEventListener("click", () => { if (cliente) fichaCliente(x); else { T.tog.set(x.path, !open); rr(); } });
    for (let c = 1; c <= 3; c++){
      const td = el("td","l fix c"+c);
      if (c === x.d){ td.classList.add("sup"); td.append(el("span","chev", cliente ? "›" : (open ? "▾" : "▸")), el("b",null,x.lab));
        if (cliente) td.append(el("small",null,` ${x.cod ? x.cod + " · " : ""}${x.filas.length} fra.`));
        td.title = x.lab; }
      tr.append(td);
    }
    importes(tr, x); tb.append(tr); filas++;
    if (open && !cliente) for (const h of ordenar(x.hijos, x.d + 1)) pinta(h);
  };
  for (const h of ordenar(raiz.hijos, 1)) pinta(h);
  if (!filas){ const tr = el("tr"); const td = el("td","l empty","No hay facturas pendientes con estos filtros."); td.colSpan = 6 + mVv.length + mNv.length; tr.append(td); tb.append(tr); }
  t.append(tb);
  const tf = el("tfoot"), fr = el("tr"); const c0 = el("td","l fix c1"); c0.colSpan = 1; c0.append(el("b",null,"Total general")); fr.append(c0, el("td","fix c2"), el("td","fix c3"));
  importes(fr, raiz); tf.append(fr); t.append(tf);
  tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa una fila para desplegarla o plegarla; al pulsar un cliente se abre el detalle de sus facturas con el saldo acumulado. Con «Detalle hasta» se despliega todo hasta ese nivel. Fuera de los 12 meses anteriores y posteriores a hoy, los vencimientos se agrupan por años o como «posteriores»."));
  T._L = L; T._mV = mV; T._mN = mN; T._raiz = raiz;
}

// Ficha del cliente: facturas con saldo acumulado
function fichaCliente(x){
  let dlg = document.getElementById("dlgCliCobro"); if (dlg) dlg.remove();
  dlg = el("dialog","ficha-cli"); dlg.id = "dlgCliCobro"; document.body.append(dlg);
  const F = x.filas.slice().sort((a,b) => ((a.venc || "9") < (b.venc || "9") ? -1 : (a.venc || "9") > (b.venc || "9") ? 1 : (a.fecha_factura || "") < (b.fecha_factura || "") ? -1 : 1));
  const modos = [...new Set(F.map(r => r.modo))], tot = F.reduce((s,r) => s + r.imp, 0), venc = F.filter(vencida).reduce((s,r) => s + r.imp, 0);
  const cab = el("div","fc-cab");
  const tit = el("div"); tit.append(el("h2",null,x.lab), el("p","sub",`${x.cod ? "Cliente " + x.cod + " · " : ""}${F[0] ? F[0].mercado + " · " + F[0].agrup : ""}`));
  const cerrar = el("button","btn small","Cerrar"); cerrar.type = "button"; cerrar.addEventListener("click", () => dlg.close());
  cab.append(tit, cerrar); dlg.append(cab);
  const info = el("div","fc-info");
  const dato = (t, v, cl) => { const d = el("div","fc-dato"+(cl ? " "+cl : "")); d.append(el("small",null,t), el("b",null,v)); return d; };
  info.append(dato(modos.length > 1 ? "Modos de pago" : "Modo de pago", modos.join(", ")), dato("Saldo pendiente", eur(tot) || "0 €"), dato("Vencido", eur(venc) || "0 €", venc > 0.5 ? "bad" : ""), dato("Facturas", String(F.length)));
  dlg.append(info);
  const w = el("div","fc-tbl"); const t = el("table","tbl"); const th = el("thead"), hr = el("tr");
  for (const [h, c] of [["Nº factura","l"],["Fecha factura","n"],["Vencimiento","n"],["Saldo acumulado","n"]]) hr.append(el("th",c,h));
  th.append(hr); t.append(th); const tb = el("tbody"); let acum = 0;
  for (const r of F){
    acum += r.imp; const tr = el("tr", vencida(r) ? "fc-venc" : "");
    tr.title = [`Importe ${eur(r.imp) || "0 €"}`, r.modo, r.estado !== "General" && r.estado, r.asiento && `Asiento ${r.asiento}`, r.texto, r.remesa && `Remesa ${r.remesa}`].filter(Boolean).join(" · ");
    tr.append(el("td","l", r.factura || r.asiento || "—"), el("td","n", fec(r.fecha_factura)), el("td","n"+(vencida(r) ? " late" : ""), fec(r.venc)), el("td","n"+(acum < -0.5 ? " abono" : ""), eur(acum) || "0 €"));
    tb.append(tr);
  }
  t.append(tb); w.append(t); dlg.append(w);
  dlg.append(el("p","hint","Ordenadas por vencimiento. En rojo, las vencidas. Al pasar el ratón por una factura se ve su importe, modo de pago y asiento."));
  dlg.addEventListener("close", () => dlg.remove());
  dlg.showModal(); cerrar.focus();
}

function exportar(){
  const L = T._L || [], wb = XLSX.utils.book_new(), r2 = v => Math.round(v*100)/100;
  const A = [["Mercado","Estado","Agrupación sistema cobro","Modo de pago","Nombre","Código cliente","Factura","Asiento","Texto","Fecha factura","Vencimiento","Situación","Columna vencimiento","Estado efecto","Remesa","Banco","Importe pendiente"]];
  for (const r of L.slice().sort((a,b) => a.mercado.localeCompare(b.mercado) || a.agrup.localeCompare(b.agrup) || a.modo.localeCompare(b.modo) || a.cliente.localeCompare(b.cliente) || ((a.venc || "") < (b.venc || "") ? -1 : 1)))
    A.push([r.mercado, r.estado, r.agrup, r.modo, r.cliente, r.cliente_cod || "", r.factura || "", r.asiento || "", r.texto || "", r.fecha_factura ? xDate(parseKey(r.fecha_factura)) : "", r.venc ? xDate(parseKey(r.venc)) : "", r.sit, colLab(r.col), r.estado_efecto || "", r.remesa || "", r.banco || "", r2(r.imp)]);
  XLSX.utils.book_append_sheet(wb, sheet(A, [11,10,24,14,36,10,16,12,24,12,12,11,13,12,12,22,14]), "Facturas pendientes");
  const H = ["Mercado","Agrupación sistema cobro","Nombre", ...T._mV.map(m => "Vencida " + colLab(m)), "Total vencida", ...T._mN.map(m => "No vencida " + colLab(m)), "Total no vencida", "Total pendiente"];
  const B = [H];
  const fila = (x, labs) => B.push([...labs, ...T._mV.map(m => r2(x.v[m] || 0)), r2(x.tv), ...T._mN.map(m => r2(x.n[m] || 0)), r2(x.tn), r2(x.t)]);
  const rec = (x, labs) => { for (const h of [...x.hijos.values()].sort((a,b) => String(a.lab).localeCompare(String(b.lab), "es"))){ const l = [...labs, h.lab]; if (h.d === 3) fila(h, l); else rec(h, l); } };
  if (T._raiz){ rec(T._raiz, []); fila(T._raiz, ["Total general","",""]); }
  XLSX.utils.book_append_sheet(wb, sheet(B, [11,24,36, ...H.slice(3).map(() => 13)]), "Resumen por cliente");
  saveXlsx(wb, `Facturas_clientes_pendientes_${stamp()}.xlsx`);
}

// ---- Formato del fichero: hoja «CustTransOpen» ----
const COLS = [
  // [columna, obligatoria, descripción, ejemplo, campo]
  ["NAME",            true,  "Nombre del cliente", "ALMACENES SINFO SL"],
  ["ACCOUNTNUM",      true,  "Código del cliente en AX", "06074"],
  ["VOUCHER",         false, "Asiento contable", "fr400722v"],
  ["INVOICE",         false, "Número de factura (vacío en apuntes que no son factura)", "26/00/011490"],
  ["TXT",             false, "Texto del apunte", ""],
  ["TRANSDATE",       true,  "Fecha de la factura o del apunte", "18/11/2026"],
  ["DUEDATE",         true,  "Fecha de vencimiento", "18/12/2026"],
  ["AMOUNTMST",       true,  "Importe pendiente en euros: positivo = a cobrar; negativo = abono o cobro a cuenta", "249,26"],
  ["PAYMMODE",        true,  "Modo de pago (CONFIRMING, TRANSFER, DESCTO, PAGARE…)", "DESCTO"],
  ["POSTINGPROFILE",  true,  "Estado en la app: General, Remesa, Impago, Cartera, Dotación…", "General"],
  ["BILLOFEXCHANGESTATUS", false, "Estado del efecto (código)", "0"],
  ["BILLOFEXCHANGEID", false, "Remesa del efecto", ""],
  ["BANCO",           false, "Banco de la remesa", ""],
  ["Estado",          false, "Estado del efecto (Ninguno, Librado, Renegociado…)", "Ninguno"],
  ["Fecha informe",   false, "Fecha y hora del informe de AX", "18/11/2026"],
  ["Estado2",         false, "Calculada en el Excel; la app la recalcula con la fecha de hoy", "No Vencida"],
  ["Tramo",           false, "Tramo de antigüedad según el Excel", "no vencida"],
  ["Agrupación Sistema cobro", true, "Agrupación del modo de pago (Pagaré, Transferencia adelantado, Descuento…); puede ir vacía o con #N/D", "Descuento"],
  ["Extranjeros",     true,  "Mercado: Nacional o Extranjero", "Nacional"],
];
const nrm = x => String(x ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/\s+/g," ").trim();
function mapaColumnas(headers){ const h = headers.map(nrm), m = {}; for (const [c] of COLS){ const i = h.indexOf(nrm(c)); if (i >= 0) m[c] = headers[i]; } return m; }
function hojaValida(wb){
  const orden = [...wb.SheetNames].sort((a,b) => (nrm(b) === "custtransopen") - (nrm(a) === "custtransopen"));
  let mejor = null;
  for (const n of orden){
    const ws = wb.Sheets[n]; if (!ws || !ws["!ref"]) continue;
    const head = (XLSX.utils.sheet_to_json(ws, { header:1, range:0, defval:null })[0] || []).map(x => x == null ? "" : String(x));
    const m = mapaColumnas(head), faltan = COLS.filter(([c,ob]) => ob && !m[c]).map(([c]) => c);
    if (!faltan.length) return { nombre:n, ws, m, faltan };
    if (!mejor || faltan.length < mejor.faltan.length) mejor = { nombre:n, ws, m, faltan };
  }
  return mejor;
}
const S = v => { if (v == null) return null; const s = String(v).trim(); return s && s !== "nan" && !/^#(N\/D|N\/A|¡?REF!|VALOR!|VALUE!)/i.test(s) ? s : null; };
const N = v => { if (v == null || v === "") return null; if (typeof v === "number") return isFinite(v) ? v : null;
  const t = String(v).trim().replace(/\s|€/g, ""); const x = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return isFinite(x) ? x : null; };
const D = v => { if (!v) return null; let d = v;
  if (!(v instanceof Date)){ const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(v).trim()); d = m ? new Date(+m[3], +m[2]-1, +m[1]) : new Date(v); }
  if (isNaN(d)) return null; return `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`; };

function descargarFormato(){
  const wb = XLSX.utils.book_new(), hoy = new Date();
  const A = [COLS.map(c => c[0])];
  for (const r of (T.rows || [])){
    const v = r.venc ? parseKey(r.venc) : null, f = r.fecha_factura ? parseKey(r.fecha_factura) : null;
    A.push([r.cliente, r.cliente_cod || "", r.asiento || "", r.factura || "", r.texto || "", f ? xDate(f) : "", v ? xDate(v) : "", r.imp, r.modo_pago || "", r.estado, "", r.remesa || "", r.banco || "", r.estado_efecto || "", "", r.sit, "", r.agrupacion || "", r.mercado === SIN ? "" : r.mercado]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(A, [34,10,12,14,20,11,11,11,13,13,8,12,18,11,12,11,11,22,11]), "CustTransOpen");
  const I = [["Columna","Obligatoria","Qué contiene","Ejemplo"], ...COLS.map(([c,ob,d,e]) => [c, ob ? "Sí" : "No", d, e]), [],
    ["Cómo subirlo"], ["1. La hoja debe llamarse «CustTransOpen» y la primera fila llevar estos títulos (el orden da igual; las demás columnas se ignoran)."],
    ["2. Una fila por apunte abierto del cliente. Los de importe cero no se muestran."],
    ["3. En la app: Tesorería › Facturas de clientes pendientes de cobro › Actualizar con Excel. Se sustituyen todos los datos."],
    [`Formato descargado el ${p2(hoy.getDate())}/${p2(hoy.getMonth()+1)}/${hoy.getFullYear()} con ${(T.rows || []).length} apuntes.`]];
  XLSX.utils.book_append_sheet(wb, sheet(I, [26,11,80,20]), "Instrucciones");
  saveXlsx(wb, `Tesoreria_formato_Clientes_${stamp()}.xlsx`);
}

async function cargarFichero(file, msg, inp){
  const set = t => { msg.textContent = t; };
  const rechazar = t => { set(t); toast("Fichero no válido: no se ha cargado nada"); inp.disabled = false; inp.value = ""; };
  try{
    inp.disabled = true; set("Comprobando el fichero…");
    const buf = await file.arrayBuffer();
    // rápido: solo la hoja habitual (el Excel trae hojas de contabilidad muy grandes)
    let wb = XLSX.read(buf, { type:"array", cellDates:true, sheets:["CustTransOpen","custTransOpen","CUSTTRANSOPEN"] });
    if (!wb.SheetNames.some(n => wb.Sheets[n] && wb.Sheets[n]["!ref"])){ set("Buscando la hoja en todo el fichero…"); wb = XLSX.read(buf, { type:"array", cellDates:true }); }
    const h = hojaValida(wb);
    if (!h) return rechazar("El fichero no tiene ninguna hoja con datos. No se ha cargado nada.");
    if (h.faltan.length) return rechazar(`No es el fichero de transacciones abiertas de clientes: en la hoja «${h.nombre}» faltan las columnas ${h.faltan.map(c => "«"+c+"»").join(", ")}. No se ha cargado nada. Descarga el formato con «Descargar formato».`);
    const m = h.m, g = (r, c) => m[c] ? r[m[c]] : null;
    const R = XLSX.utils.sheet_to_json(h.ws, { defval:null, raw:true }).filter(r => S(g(r,"NAME")) || S(g(r,"ACCOUNTNUM")));
    if (!R.length) return rechazar(`La hoja «${h.nombre}» tiene las columnas correctas pero ningún apunte. No se ha cargado nada.`);
    const errores = []; let fInf = null;
    const rows = R.map((r, i) => {
      const fila = i + 2, av = g(r,"AMOUNTMST"), imp = N(av), vto = D(g(r,"DUEDATE")), ff = D(g(r,"TRANSDATE"));
      if (imp == null) errores.push(`fila ${fila}: «AMOUNTMST» no es un número (${av})`);
      if (imp && !vto) errores.push(`fila ${fila}: apunte pendiente sin «DUEDATE» válido`);
      if (imp && S(g(r,"TRANSDATE")) && !ff) errores.push(`fila ${fila}: «TRANSDATE» no es una fecha`);
      if (!fInf){ const fi = g(r,"Fecha informe"); if (fi instanceof Date && !isNaN(fi)) fInf = fi; }
      const cod = g(r,"ACCOUNTNUM");
      return { cliente:S(g(r,"NAME")), cliente_cod: cod == null ? null : (typeof cod === "number" ? String(cod).padStart(5,"0") : S(cod)), asiento:S(g(r,"VOUCHER")), factura:S(g(r,"INVOICE")), texto:S(g(r,"TXT")),
        fecha_factura:ff, vencimiento:vto, importe:imp, modo_pago:S(g(r,"PAYMMODE")), estado:S(g(r,"POSTINGPROFILE")), estado_efecto:S(g(r,"Estado")),
        remesa:S(g(r,"BILLOFEXCHANGEID")), banco:S(g(r,"BANCO")), agrupacion:S(g(r,"Agrupación Sistema cobro")), mercado:S(g(r,"Extranjeros")), tramo:S(g(r,"Tramo")) };
    });
    if (errores.length) return rechazar(`El fichero tiene ${errores.length} error${errores.length === 1 ? "" : "es"} y no se ha cargado nada: ${errores.slice(0,5).join("; ")}${errores.length > 5 ? "…" : ""}`);
    const pend = rows.filter(r => r.importe);
    const porEstado = {}; for (const r of pend) porEstado[r.estado || SIN] = (porEstado[r.estado || SIN] || 0) + r.importe;
    const det = Object.entries(porEstado).sort((a,b) => b[1] - a[1]).map(([e,v]) => `  · ${e}: ${eur(v) || "0 €"}`).join("\n");
    if (!confirm(`Fichero correcto (hoja «${h.nombre}»): ${pend.length} apuntes pendientes de ${new Set(pend.map(r => r.cliente_cod || r.cliente)).size} clientes.\n${det}\n\nSe sustituirán los datos actuales. ¿Continuar?`)){ set(""); inp.disabled = false; inp.value = ""; return; }
    const c = await sb.schema("core").from("cargas").insert({ tipo:"tesoreria_clientes", fichero:file.name, filas:rows.length, importe_total: Math.round(pend.reduce((s,r) => s + r.importe, 0)*100)/100, fecha_datos:(fInf || new Date(file.lastModified || Date.now())).toISOString(), notas:`Carga desde la app (hoja ${h.nombre})` }).select("id").single();
    if (c.error) throw c.error;
    set("Sustituyendo los datos…");
    const del = await sb.schema("tesoreria").from("facturas_clientes").delete().gte("id", 0); if (del.error) throw del.error;
    for (let i = 0; i < rows.length; i += 1000){ const r = await sb.schema("tesoreria").from("facturas_clientes").insert(rows.slice(i, i+1000).map(x => Object.assign({ carga_id:c.data.id }, x))); if (r.error) throw r.error; }
    set(`Hecho: ${pend.length} apuntes pendientes cargados.`); toast("Facturas de clientes actualizadas"); T.rows = null; render();
  } catch(e){ console.error(e); set("No se ha podido cargar: " + (e.message || "error")); }
  inp.disabled = false; inp.value = "";
}
