// Utilidades comunes de la APP B10
export const $ = s => document.querySelector(s);
export const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const DAY = 86400000;
export function parseKey(k){ const [y,m,d] = k.slice(0,10).split("-").map(Number); return new Date(Date.UTC(y,m-1,d)); }
export function key(d){ return d.toISOString().slice(0,10); }
export const hoy = (() => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); })();
export function dLong(d){ return d.toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).replace(".",""); }
export function xDate(d){ return d ? new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) : ""; }
export const fmtE = v => v.toLocaleString("es-ES",{style:"currency",currency:"EUR",maximumFractionDigits:0});
export const fmtN = (v,d=2) => v==null||!isFinite(v) ? "" : v.toLocaleString("es-ES",{minimumFractionDigits:0,maximumFractionDigits:d});
export const fmtM = (v,mon,d=2) => v==null||!isFinite(v) ? "" : v.toLocaleString("es-ES",{style:"currency",currency:mon||"EUR",minimumFractionDigits:d,maximumFractionDigits:Math.max(d, v!==0&&Math.abs(v)<10?4:2)});
export const safe = s => s.replace(/[^\w\- ]+/g,"").trim().replace(/\s+/g,"_");
export const stamp = () => key(hoy);

let tt;
export function toast(m){ const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(tt); tt = setTimeout(() => t.classList.remove("show"), 3800); }

// Desplegable de selección múltiple con buscador
export function ddMulti(ui, id, label, opts, sel, onChange, rerender){
  const w = el("div","dd"); const b = el("button","btn ddb"+(sel.length?" on":"")); b.type = "button";
  b.textContent = `${label}: ${sel.length ? (sel.length===1 ? ((opts.find(o=>o.v===sel[0])||{l:"1 seleccionado"}).l) : sel.length+" seleccionados") : "Todos"}`;
  b.setAttribute("aria-expanded", String(ui.dd===id));
  b.addEventListener("click", e => { e.stopPropagation(); ui.dd = ui.dd===id ? null : id; ui.ddq = ""; rerender(); });
  w.append(b);
  if (ui.dd === id){
    const pn = el("div","ddp"); pn.addEventListener("click", e => e.stopPropagation());
    const q = el("input"); q.type = "search"; q.placeholder = "Buscar"; q.value = ui.ddq; q.dataset.k = "ddq-"+id; q.setAttribute("aria-label","Buscar en "+label);
    q.addEventListener("input", () => { ui.ddq = q.value; rerender(); });
    const list = el("div","ddl"), qq = ui.ddq.trim().toLowerCase();
    for (const o of opts){
      if (qq && !(o.l+" "+(o.sub||"")).toLowerCase().includes(qq)) continue;
      const lb = el("label"), cb = el("input"); cb.type = "checkbox"; cb.checked = sel.includes(o.v); cb.dataset.k = `dd-${id}-${o.v}`;
      cb.addEventListener("change", () => onChange(cb.checked ? [...sel, o.v] : sel.filter(x => x!==o.v)));
      const sp = el("span",null,o.l); if (o.sub) sp.append(el("small",null,o.sub)); lb.append(cb, sp); list.append(lb);
    }
    if (!list.childNodes.length) list.append(el("p","secsub","Sin resultados"));
    const ft = el("div","ddf");
    const cl = el("button","btn small","Quitar selección"); cl.type = "button"; cl.addEventListener("click", () => onChange([]));
    const ok = el("button","btn small primary","Aceptar"); ok.type = "button"; ok.addEventListener("click", () => { ui.dd = null; rerender(); });
    ft.append(cl, ok); pn.append(q, list, ft); w.append(pn);
  }
  return w;
}

// Exportación a Excel (SheetJS)
export function sheet(aoa, widths){ const ws = XLSX.utils.aoa_to_sheet(aoa, {cellDates:true}); if (widths) ws["!cols"] = widths.map(w => ({wch:w})); return ws; }
export function saveXlsx(wb, name){ XLSX.writeFile(wb, name, {cellDates:true}); toast("Archivo exportado"); }

// Exporta a Excel las tablas que se están viendo dentro de «box» (una hoja por tabla).
// Convierte a número los importes con formato español (1.234,56), los porcentajes y las fechas dd/mm/aaaa.
export function exportarVista(box, nombre){
  const tablas = [...box.querySelectorAll("table")].filter(t => t.offsetParent !== null);
  if (!tablas.length){ toast("No hay ninguna tabla en esta vista"); return; }
  const valor = td => {
    const sel = td.querySelector("select"); if (sel) return sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text.replace(/^—$/, "") : "";
    const c = td.cloneNode(true); c.querySelectorAll("button,input,svg").forEach(x => x.remove());
    const t = c.textContent.replace(/\s+/g, " ").trim();
    let m;
    if ((m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t))) return { n:(Date.UTC(+m[3], +m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 86400000, z:"dd/mm/yyyy" };
    if (/^0\d/.test(t) && !t.includes(",")) return t; // códigos con ceros a la izquierda
    if (/^[+-]?\d{1,3}(\.\d{3})*(,\d+)?( €)?$/.test(t) || /^[+-]?\d+(,\d+)?( €)?$/.test(t)) return { n: +t.replace(/ €$/, "").replace(/\./g, "").replace(",", ".") };
    if (/^[+-]?\d+(\.\d{3})*(,\d+)? %$/.test(t)) return { n: +t.replace(" %", "").replace(/\./g, "").replace(",", ".") / 100, z: "0.0%" };
    return t;
  };
  const wb = XLSX.utils.book_new(), usados = new Set();
  tablas.forEach((t, i) => {
    const filas = [];
    for (const tr of t.rows){ if (tr.offsetParent === null) continue; const f = []; for (const c of tr.cells){ f.push(valor(c)); for (let k = 1; k < (c.colSpan || 1); k++) f.push(""); } if (f.some(v => v !== "")) filas.push(f); }
    const aoa = filas.map(f => f.map(v => v && typeof v === "object" && "n" in v ? v.n : v));
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    filas.forEach((f, r) => f.forEach((v, c) => { if (v && typeof v === "object" && "n" in v){ const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = v.z || "#,##0.##"; } }));
    const anchos = []; for (const f of aoa) f.forEach((v, c) => { const l = String(v ?? "").length; anchos[c] = Math.min(45, Math.max(anchos[c] || 6, l + 2)); }); ws["!cols"] = anchos.map(w => ({ wch:w }));
    // nombre de hoja: el título que tenga encima la tabla
    let tit = ""; let n = t.closest(".tblwrap") || t; while (n && n !== box && !tit){ let p = n.previousElementSibling; while (p && !tit){ if (/^H[1-4]$/.test(p.tagName)) tit = p.textContent; p = p.previousElementSibling; } n = n.parentElement; }
    let base = (tit || (tablas.length > 1 ? `${nombre} ${i + 1}` : nombre)).replace(/[\[\]:*?\/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Hoja", nm = base, k = 2;
    while (usados.has(nm.toLowerCase())) nm = `${base.slice(0, 26)} ${k++}`; usados.add(nm.toLowerCase());
    XLSX.utils.book_append_sheet(wb, ws, nm);
  });
  saveXlsx(wb, `${safe(nombre)}_${stamp()}.xlsx`);
}
