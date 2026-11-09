// APP B10 · Compras: análisis por proveedor de las facturas de compra (tabla ax.facturas_compras_lineas)
import { sb, ctx, render, cabecera } from "../app.js";
import { el, toast, ddMulti, dLong, parseKey, xDate, fmtE, fmtN, fmtM, sheet, saveXlsx, safe, stamp } from "../util.js";

const A = { prov:"", refs:[], gran:"mes", medida:"uds", moneda:"div", anio:"", per:null, openGroups:new Set(), _last:null };
const D = { provs:null, cargandoProvs:false, lineas:{}, cargando:{} };
const MESES = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const perKey = (f,g) => { const y = f.slice(0,4), m = +f.slice(5,7); return g==="anio" ? y : g==="trim" ? `${y}-T${Math.ceil(m/3)}` : f.slice(0,7); };
const perLabel = (k,g) => g==="anio" ? k : g==="trim" ? k.replace("-"," ") : MESES[+k.slice(5,7)-1]+" "+k.slice(0,4);

async function cargarProveedores(){
  D.cargandoProvs = true;
  const { data, error } = await sb.schema("ax").from("v_compras_proveedores").select("*").order("importe_eur", { ascending:false });
  D.cargandoProvs = false;
  if (error){ toast("No se han podido cargar los proveedores."); D.provs = []; }
  else D.provs = data.map(p => ({ cod:p.proveedor_cuenta, nombre:p.nombre, mon:p.moneda || "EUR", eur:+p.importe_eur, n:p.lineas }));
  render();
}

// Lee todas las líneas de un proveedor, de 1.000 en 1.000
async function cargarLineas(cod){
  D.cargando[cod] = true; const out = [];
  for (let i = 0; ; i += 1000){
    const { data, error } = await sb.schema("ax").from("facturas_compras_lineas")
      .select("factura_id,factura_fecha,articulo_id,articulo_descripcion,unidad_compra,cantidad,precio_compra,unidad_precio,importe_linea_divisa,moneda,importe_eur,linea")
      .eq("proveedor_cuenta", cod).order("factura_fecha").order("factura_id").order("linea").range(i, i+999);
    if (error){ toast("No se han podido cargar las facturas."); break; }
    for (const r of data) out.push({ fac:r.factura_id, fecha:r.factura_fecha, item:r.articulo_id || "(sin artículo)", desc:(r.articulo_descripcion||"").split(" | ")[0],
      ud:r.unidad_compra, qty:+r.cantidad, pu:+r.precio_compra/((+r.unidad_precio)||1), imp:+r.importe_linea_divisa, mon:r.moneda, eur:+r.importe_eur });
    if (data.length < 1000) break;
  }
  D.lineas[cod] = out; D.cargando[cod] = false; render();
}

export function renderCompras(app){
  document.title = "Compras: análisis por proveedor";
  cabecera(app, "Compras", "Análisis por proveedor de las facturas de compra.", true, "compras");
  const box = el("div","pad"); box.style.paddingBottom = "32px"; app.append(box);
  if (!D.provs){ if (!D.cargandoProvs) cargarProveedores(); box.append(el("div","card empty","Cargando proveedores…")); return; }
  if (!D.provs.length){ box.append(el("div","card empty","Todavía no hay facturas cargadas o no tienes permiso para verlas.")); return; }
  const provs = D.provs; if (!A.prov || !provs.some(p => p.cod===A.prov)) A.prov = provs[0].cod;
  const prov = provs.find(p => p.cod===A.prov);
  const ui = ctx.ui;

  // Controles
  const c = el("div","ctrl");
  const fs = (lab,node) => { const isSel = node.tagName==="SELECT"; const d = el(isSel?"label":"div","fld"); d.append(isSel?lab:el("span",null,lab), node); return d; };
  const sp = el("select"); for (const p of provs){ const o = el("option",null,`${p.nombre} (${p.cod}) · ${fmtE(p.eur)}`); o.value = p.cod; sp.append(o); } sp.value = A.prov;
  sp.addEventListener("change", () => { A.prov = sp.value; A.refs = []; A.per = null; A.anio = ""; ui.dd = null; render(); });
  c.append(fs("Proveedor", sp));
  const L = D.lineas[A.prov];
  if (!L){ box.append(c); if (!D.cargando[A.prov]) cargarLineas(A.prov); box.append(el("div","card empty","Cargando facturas del proveedor…")); return; }

  const years = [...new Set(L.map(l => l.fecha.slice(0,4)))].sort();
  const sy = el("select"); const o0 = el("option",null,"Todos"); o0.value = ""; sy.append(o0); for (const y of years){ const o = el("option",null,y); o.value = y; sy.append(o); }
  if (A.anio && !years.includes(A.anio)) A.anio = ""; sy.value = A.anio; sy.addEventListener("change", () => { A.anio = sy.value; A.per = null; render(); });
  const lp = L.filter(l => !A.anio || l.fecha.startsWith(A.anio));
  const items = new Map(); for (const l of lp){ const x = items.get(l.item) || { item:l.item, desc:l.desc }; x.desc = l.desc; items.set(l.item, x); }
  const refOpts = [...items.values()].sort((a,b) => a.item<b.item?-1:1).map(x => ({ v:x.item, l:x.item, sub:x.desc }));
  A.refs = A.refs.filter(r => items.has(r));
  const seg = (opts,val,on) => { const s = el("div","seg"); for (const [v,l] of opts){ const bt = el("button",null,l); bt.type = "button"; bt.setAttribute("aria-pressed", String(v===val)); bt.addEventListener("click", () => on(v)); s.append(bt); } return s; };
  const monProv = prov.mon || "EUR";
  c.append(fs("Año", sy), fs("Referencias", ddMulti(ui, "refs", "Artículos", refOpts, A.refs, n => { A.refs = n; A.per = null; render(); }, render)),
    fs("Periodo", seg([["anio","Año"],["trim","Trimestre"],["mes","Mes"]], A.gran, v => { A.gran = v; A.per = null; render(); })));
  if (monProv !== "EUR") c.append(fs("Moneda", seg([["div",monProv],["eur","EUR"]], A.moneda, v => { A.moneda = v; render(); })));
  const eb = el("button","btn","Exportar a Excel"); eb.style.marginLeft = "auto"; eb.addEventListener("click", exportar); c.append(eb);
  box.append(c);

  const sel = A.refs.length ? lp.filter(l => A.refs.includes(l.item)) : lp;
  const useEur = A.moneda==="eur" || monProv==="EUR", mon = useEur ? "EUR" : monProv;
  const imp = l => useEur ? l.eur : l.imp;

  // Indicadores
  const k = el("div","kpis"); const kp = (t,v) => { const d = el("div","kpi"); d.append(el("small",null,t), el("b",null,v)); return d; };
  k.append(kp("Importe", fmtM(sel.reduce((a,l)=>a+imp(l),0), mon, 0)), kp("Facturas", String(new Set(sel.map(l=>l.fac)).size)), kp("Artículos", String(new Set(sel.map(l=>l.item)).size)),
    kp("Líneas", String(sel.length)), kp("Última factura", sel.length ? dLong(parseKey(sel.map(l=>l.fecha).sort().pop())) : "—"));
  box.append(k);

  // Cabecera: tabla dinámica
  box.append(el("h2","sec","Cabecera"));
  const ms = el("div","measure"); ms.append(seg([["uds","Unidades"],["precio","Precio medio"],["imp","Importe"]], A.medida, v => { A.medida = v; render(); })); box.append(ms);
  box.append(el("p","hint", A.medida==="precio" ? "Precio medio de cada periodo = importe facturado ÷ unidades facturadas. Pulsa una celda para ver sus facturas en el detalle." : "Pulsa un artículo, un periodo o una celda para filtrar el detalle."));
  const per = [...new Set(sel.map(l => perKey(l.fecha, A.gran)))].sort();
  const piv = new Map();
  for (const l of sel){ const r = piv.get(l.item) || { item:l.item, desc:l.desc, ud:l.ud, p:{}, q:0, i:0 }; const pk = perKey(l.fecha, A.gran); const c2 = r.p[pk] || { q:0, i:0 }; c2.q += l.qty; c2.i += imp(l); r.p[pk] = c2; r.q += l.qty; r.i += imp(l); piv.set(l.item, r); }
  const rows = [...piv.values()].sort((a,b) => b.i - a.i);
  const val = c3 => !c3 ? null : A.medida==="uds" ? c3.q : A.medida==="imp" ? c3.i : (c3.q ? c3.i/c3.q : null);
  const show = v => v==null ? "" : A.medida==="uds" ? fmtN(v) : fmtM(v, mon, 2);
  const tw = el("div","tblwrap"), t = el("table","tbl pivot");
  const th = el("thead"), hr = el("tr"); hr.append(el("th","code","Código"), el("th",null,"Descripción"), el("th",null,"Unidad"));
  for (const p of per){ const hc = el("th","n pk"+(A.per===p?" on":""), perLabel(p, A.gran)); hc.title = "Filtrar el detalle por este periodo"; hc.addEventListener("click", () => { A.per = A.per===p ? null : p; render(); }); hr.append(hc); }
  hr.append(el("th","n tot","Total")); th.append(hr); t.append(th);
  const tb = el("tbody");
  for (const r of rows){
    const tr = el("tr", A.refs.length===1 && A.refs[0]===r.item ? "sel" : ""); tr.title = "Ver solo este artículo en el detalle";
    tr.addEventListener("click", () => { A.refs = (A.refs.length===1 && A.refs[0]===r.item && !A.per) ? [] : [r.item]; A.per = null; render(); });
    tr.append(el("td","code",r.item), el("td",null,r.desc), el("td",null,r.ud||""));
    for (const p of per){
      const v = val(r.p[p]); const on = A.per===p && A.refs.length===1 && A.refs[0]===r.item;
      const cell = el("td","n cell"+(v<0?" neg":"")+(on?" selc":""), show(v));
      if (r.p[p]){ cell.title = `Ver las facturas de ${r.item} en ${perLabel(p, A.gran)}`; cell.addEventListener("click", e => { e.stopPropagation(); if (on) A.per = null; else { A.refs = [r.item]; A.per = p; } render(); }); }
      tr.append(cell);
    }
    tr.append(el("td","n tot", show(val({ q:r.q, i:r.i })))); tb.append(tr);
  }
  t.append(tb);
  if (A.medida!=="precio" || new Set(rows.map(r => r.ud)).size===1){
    const tf = el("tfoot"), fr = el("tr"); fr.append(el("td","code","Total"), el("td"), el("td"));
    for (const p of per){ const q = rows.reduce((a,r)=>a+((r.p[p]||{}).q||0),0), i = rows.reduce((a,r)=>a+((r.p[p]||{}).i||0),0); fr.append(el("td","n",show(val({q,i})))); }
    fr.append(el("td","n tot", show(val({ q:rows.reduce((a,r)=>a+r.q,0), i:rows.reduce((a,r)=>a+r.i,0) })))); tf.append(fr); t.append(tf);
  }
  tw.append(t); box.append(tw);

  // Detalle de líneas
  box.append(el("h2","sec","Detalle de líneas"));
  const detSel = A.per ? sel.filter(l => perKey(l.fecha, A.gran)===A.per) : sel;
  const dg = new Map(); for (const l of detSel){ const x = dg.get(l.item) || { item:l.item, desc:l.desc, ud:l.ud, q:0, i:0 }; x.q += l.qty; x.i += imp(l); dg.set(l.item, x); }
  const drows = [...dg.values()].sort((a,b) => b.i - a.i);
  if (A.refs.length || A.per){
    const fb = el("div","prow"); fb.style.margin = "6px 0 10px";
    if (A.refs.length) fb.append(el("span","tag neutral", A.refs.length===1 ? `Artículo ${A.refs[0]}` : `${A.refs.length} artículos`));
    if (A.per){ fb.append(el("span","tag pend", `Periodo ${perLabel(A.per, A.gran)}`)); const qb = el("button","btn small","Quitar periodo"); qb.addEventListener("click", () => { A.per = null; render(); }); fb.append(qb); }
    const cb = el("button","btn small","Ver todo"); cb.addEventListener("click", () => { A.per = null; A.refs = []; render(); }); fb.append(cb);
    const nf = new Set(detSel.map(l => l.fac)).size;
    fb.append(el("span","cnt", `${detSel.length} ${detSel.length===1?"línea":"líneas"} en ${nf} ${nf===1?"factura":"facturas"}`)); box.append(fb);
  }
  const dw = el("div","tblwrap"); dw.style.maxHeight = "70vh"; const dt = el("table","tbl det");
  const dh = el("thead"), dr = el("tr"); for (const [x,cl] of [["Fecha factura",""],["Nº factura",""],["Artículo",""],["Descripción",""],["Unidad",""],["Cantidad","n"],["Precio","n"],["Total línea","n"]]) dr.append(el("th",cl,x)); dh.append(dr); dt.append(dh);
  const dbody = el("tbody"); const many = drows.length>8 && !A.refs.length;
  for (const r of drows){
    const open = !many || A.openGroups.has(r.item);
    const g = el("tr","grp"); const td = el("td"); td.colSpan = 5; td.append(`${open?"▾":"▸"} ${r.item}  ${r.desc}`); td.append(el("small",null,r.ud||""));
    g.append(td, el("td","n",fmtN(r.q)), el("td","n", r.q ? fmtM(r.i/r.q, mon, 2) : ""), el("td","n", fmtM(r.i, mon, 2)));
    g.addEventListener("click", () => { open ? A.openGroups.delete(r.item) : A.openGroups.add(r.item); render(); }); dbody.append(g);
    if (!open) continue;
    for (const l of detSel.filter(x => x.item===r.item).sort((a,b) => a.fecha<b.fecha?1:-1)){
      const tr = el("tr", l.qty<0 || imp(l)<0 ? "neg" : ""); const pu = useEur && l.qty ? l.eur/l.qty : l.pu;
      tr.append(el("td",null,dLong(parseKey(l.fecha))), el("td",null,l.fac), el("td",null,l.item), el("td",null,l.desc), el("td",null,l.ud||""), el("td","n",fmtN(l.qty)), el("td","n",fmtM(pu,mon,2)), el("td","n",fmtM(imp(l),mon,2)));
      dbody.append(tr);
    }
  }
  dt.append(dbody); dw.append(dt); box.append(dw);
  if (many) box.append(el("p","hint","Pulsa un artículo del detalle para desplegar sus líneas, o filtra por referencias."));
  if (useEur && monProv!=="EUR") box.append(el("p","hint","En euros, el precio es el contravalor contable de cada línea (importe en euros ÷ cantidad)."));
  A._last = { rows, per, sel:detSel, mon, useEur, prov };
}

function exportar(){
  const X = A._last; if (!X) return; const wb = XLSX.utils.book_new(), med = { uds:"Unidades", precio:"Precio medio", imp:"Importe" }[A.medida];
  const val = c3 => !c3 ? "" : A.medida==="uds" ? c3.q : A.medida==="imp" ? Math.round(c3.i*100)/100 : (c3.q ? Math.round(c3.i/c3.q*10000)/10000 : "");
  const C = [[`Proveedor: ${X.prov.nombre} (${X.prov.cod})`], [`Medida: ${med}${A.medida!=="uds" ? " ("+X.mon+")" : ""}`], [], ["Código","Descripción","Unidad", ...X.per.map(p => perLabel(p, A.gran)), "Total"]];
  for (const r of X.rows) C.push([r.item, r.desc, r.ud||"", ...X.per.map(p => val(r.p[p])), val({ q:r.q, i:r.i })]);
  XLSX.utils.book_append_sheet(wb, sheet(C, [18,40,10,...X.per.map(()=>12),14]), "Cabecera");
  const Dt = [["Fecha factura","Nº factura","Artículo","Descripción","Unidad","Cantidad",`Precio (${X.mon})`,`Total línea (${X.mon})`]];
  for (const l of [...X.sel].sort((a,b) => a.item===b.item ? (a.fecha<b.fecha?1:-1) : (a.item<b.item?-1:1))){
    const im = X.useEur ? l.eur : l.imp; Dt.push([xDate(parseKey(l.fecha)), l.fac, l.item, l.desc, l.ud||"", l.qty, X.useEur && l.qty ? Math.round(l.eur/l.qty*10000)/10000 : Math.round(l.pu*10000)/10000, im]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(Dt, [13,20,18,44,8,10,14,14]), "Detalle");
  saveXlsx(wb, `Compras_${safe(X.prov.nombre)}_${stamp()}.xlsx`);
}
