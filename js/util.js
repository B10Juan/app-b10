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
