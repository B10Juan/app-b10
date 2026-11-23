// APP B10 · Planificador de compras de importación, pedidos lanzados y previsión de pagos
// La lógica de cálculo y las pantallas son las del prototipo validado; aquí se conectan con Supabase.
import { sb, ctx, render, nivel, puedeEditar } from "../app.js";
import { toast as toastU, sheet as sheetU, safe as safeU } from "../util.js";
import { logo, conImagen } from "../marca.js";

const $ = s => document.querySelector(s);
const el = (t, cls, txt) => { const e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const toast = m => toastU(m);
const sheet = (a, w) => sheetU(a, w);
const safe = s => safeU(s);
const fmtM = (v,mon,d=2) => v==null||!isFinite(v) ? "" : v.toLocaleString("es-ES",{style:"currency",currency:mon||"EUR",minimumFractionDigits:d,maximumFractionDigits: d===0 ? 0 : Math.max(d, v!==0&&Math.abs(v)<10?4:2)});
// Moneda del proveedor que se está viendo (los precios de importación suelen ir en USD)
const CUR = { mon:"EUR" };
const fmtE = v => fmtM(v, CUR.mon, 0);
const fmtE2 = v => fmtM(v, CUR.mon, 2);
const addMon = (a, b) => { for (const [k,v] of Object.entries(b||{})) a[k] = (a[k]||0) + v; return a; };
const sumMon = arr => arr.reduce((a,r) => addMon(a, {[r.mon]: r.amount}), {});
const isZero = o => Object.values(o||{}).every(v => Math.abs(v) < 0.005);
const fmtAny = (o,d) => { const e = Object.entries(o||{}).filter(([,v]) => Math.abs(v) >= 0.005); return e.length ? e.map(([m,v]) => fmtM(v,m,d)).join(" + ") : fmtM(0,"EUR",d); };
const fmtAny0 = o => fmtAny(o,0), fmtAny2 = o => fmtAny(o,2);
const dispCode = p => (p && p.codigo_ax) || (p && p.artId ? "Muestra sin ref. AX" : (p && p.code) || "");
let tmpN = 0; const tmpId = () => `tmp-${Date.now()}-${++tmpN}`;
function whoChip(){ const w = el("div","who"); if (ctx.me) w.append(el("span",null,(ctx.me.nombre || ctx.session.user.email))); return w; }
function perm(m){ const n = nivel(m === "compras" ? "planificador" : m); return n === "editar" ? "edicion" : n === "ver" ? "consulta" : "ninguno"; }
function stamp(){ return key(utcToday); }
async function saveXlsx(wb, name){ XLSX.writeFile(wb, name, {cellDates:true}); toast("Archivo exportado"); }

const state = {
  suppliers:[], products:[], orders:[], canWrite:false, loaded:{s:false},
  filters:{q:"",onlyA:false,hide:new Set()}, formas:[], collapsed:new Set(), showDone:false, expanded:new Set(), histOpen:new Set(),
  ordFilter:{sid:"",peds:[],refs:[]}, payFilter:{sup:"",pend:true,paid:false},
  get dd(){ return ctx.ui.dd; }, set dd(v){ ctx.ui.dd = v; },
  get ddq(){ return ctx.ui.ddq; }, set ddq(v){ ctx.ui.ddq = v; },
};
/* ===== Código del prototipo validado (adaptado) ===== */
const SIZES=[["grupaje","Grupaje"],["20","Contenedor 20'"],["40","Contenedor 40'"],["40hc","Contenedor 40' HC"]];
const sizeLabel=v=>(SIZES.find(s=>s[0]===v)||[,""])[1];
const REQ=[["stock","stock actual"],["avg","venta media semanal"],["ss","stock de seguridad"],["pallet","uds por pallet"],["price","precio proveedor"]];

/* ---------- Fechas ---------- */
const DAY=86400000;
const utcToday=(()=>{const d=new Date(); return new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));})();
function mondayU(x){const wd=(x.getUTCDay()+6)%7; return new Date(x.getTime()-wd*DAY);}
const today=mondayU(utcToday);
function addW(d,n){return new Date(d.getTime()+n*7*DAY);}
function addD(d,n){return new Date(d.getTime()+n*DAY);}
function key(d){return d.toISOString().slice(0,10);}
function parseKey(k){const [y,m,dd]=k.split("-").map(Number); return new Date(Date.UTC(y,m-1,dd));}
function isoWeek(d){const t=new Date(d.getTime()); t.setUTCDate(t.getUTCDate()+3-((t.getUTCDay()+6)%7)); const y=t.getUTCFullYear(); const w1=new Date(Date.UTC(y,0,4)); return 1+Math.round(((t-w1)/DAY-3+((w1.getUTCDay()+6)%7))/7);}
function wLabel(d){return "S"+String(isoWeek(d)).padStart(2,"0");}
function dShort(d){return d.toLocaleDateString("es-ES",{day:"2-digit",month:"short",timeZone:"UTC"}).replace(".","");}
function dLong(d){return d.toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).replace(".","");}
function xDate(d){return d?new Date(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()):"";}
const fmt=v=>{if(v==null||v===0) return ""; const r=Math.round(v*100)/100; return Number.isInteger(r)?String(r):r.toLocaleString("es-ES",{maximumFractionDigits:2});};


const num=s=>{if(s==null) return NaN; const t=String(s).trim().replace(/\s/g,"").replace(",","."); return t===""?NaN:Number(t);};
function parsePrice(s){s=String(s).trim().replace(/\s|€/g,""); if(s.includes(",")) s=s.replace(/\./g,"").replace(",","."); return s===""?NaN:Number(s);}
const clone=o=>JSON.parse(JSON.stringify(o));
const same=(a,b)=>{const ka=Object.keys(a||{}).sort(), kb=Object.keys(b||{}).sort(); if(ka.join()!==kb.join()) return false; return ka.every(k=>a[k]===b[k]);};

/* ---------- Modelo ---------- */
const DEF={plazo:12,transito:5,despacho:1,horizonte:52,cobertura:8};
function sup(id){return state.suppliers.find(s=>s._id===id);}
function cfg(sid){return Object.assign({},DEF,sup(sid)||{});}
function weeks(sid){const n=cfg(sid).horizonte||52; const a=[]; for(let i=0;i<n;i++) a.push(addW(today,i)); return a;}
const prodsOf=sid=>state.products.filter(p=>p.supplier===sid).sort((a,b)=>(!!a.extinguir-!!b.extinguir)||(a.sort||0)-(b.sort||0));
const prod=code=>state.products.find(p=>p.code===code);
const ordersOf=sid=>state.orders.filter(o=>o.supplier===sid);
const isPend=o=>o.status==="pendiente";
const effLines=o=>(o.mod?o.mod.lines:o.lines)||{};
const effPrices=o=>(o.mod?o.mod.prices:o.prices)||{};
function lp(o,code,base){const pr=base?(o.prices||{}):effPrices(o); const p=prod(code); return pr[code]!=null?pr[code]:(p&&p.price||0);}
const total=(o,base)=>Object.entries(base?(o.lines||{}):effLines(o)).reduce((a,[k,q])=>a+q*lp(o,k,base),0);
const missing=p=>REQ.filter(([f])=>p[f]==null||p[f]===""||(f==="pallet"&&!(p[f]>=1))).map(([,l])=>l);
/* Formas de pago: tramos con % y momento (pedido = fecha del pedido, carga = ETD, eta = llegada; dias < 0 = antes) */
const FORMA_DEF={id:null,nombre:"Pago 15 días antes de ETA",tramos:[{pct:100,ref:"eta",dias:-15}]};
function formaDe(o){const id=(o&&o.fp)||(sup(o&&o.supplier)||{}).fpId; return state.formas.find(f=>f.id===id)||state.formas[0]||FORMA_DEF;}
function formaSup(sid){const id=(sup(sid)||{}).fpId; return state.formas.find(f=>f.id===id)||state.formas[0]||FORMA_DEF;}
const REFL={pedido:"al hacer el pedido",carga:"a la carga (ETD)",eta:"ETA"};
function tramoTxt(t,total1){const mom=t.ref==="eta"?(t.dias<0?`${-t.dias} días antes de ETA`:t.dias>0?`${t.dias} días después de ETA`:"a la llegada (ETA)"):(REFL[t.ref]+(t.dias?` ${t.dias>0?"+":"−"} ${Math.abs(t.dias)} d`:"")); return total1?mom:`${t.pct}% ${mom}`;}
function formaCorta(f){return f.tramos.length===1?tramoTxt(f.tramos[0],true):f.tramos.map(t=>tramoTxt(t)).join(" · ");}
function od(o,sid){
  const c=cfg(sid), eta=parseKey(o.eta), etaW=mondayU(eta);
  const etd=o.etd?parseKey(o.etd):addW(etaW,-c.transito), pedidoW=addW(etaW,-c.plazo);
  const fped=o.fechaPedido?parseKey(o.fechaPedido):pedidoW, f=formaDe(o);
  const pagos=f.tramos.map((t,i)=>({i,pct:+t.pct,ref:t.ref,dias:+t.dias||0,date:addD(t.ref==="pedido"?fped:t.ref==="carga"?etd:eta,+t.dias||0),est:t.ref==="pedido"?!o.fechaPedido:t.ref==="carga"?!o.etd:false}));
  return {eta,etaW,entryW:addW(etaW,c.despacho),etd,etdW:mondayU(etd),pedidoW,fped,forma:f,pagos,pago:pagos[pagos.length-1].date,crd:o.crd?parseKey(o.crd):null};
}
function orderState(o,sid){
  const d=od(o,sid);
  if(isPend(o)) return ["Pendiente de confirmar","pend"];
  if(utcToday>=d.entryW) return ["En almacén","neutral"];
  if(utcToday>=d.eta) return ["En despacho","warn"];
  if(o.etd&&utcToday>=d.etd) return ["En tránsito","ok"];
  if(d.crd&&utcToday>=d.crd) return ["Pendiente de embarque","warn"];
  return ["En producción","ok"];
}
function calc(p,sid){
  const c=cfg(sid), W=weeks(sid), n=W.length, idx=new Map(W.map((d,i)=>[key(d),i]));
  const dem=new Array(n), entry=new Array(n).fill(0), tone=new Array(n).fill(""), tips=Array.from({length:n},()=>[]), ped=new Array(n).fill(0), carga=new Array(n).fill(0);
  const ov=p.overrides||{}, avg=p.avg||0, pal=p.pallet>=1?p.pallet:1;
  for(let i=0;i<n;i++){const k=key(W[i]); dem[i]=(k in ov)?ov[k]:avg;}
  const man=new Array(n).fill(0), manInfo=new Array(n).fill(null); for(const [k,e] of Object.entries(p.manual||{})){const i=idx.get(k); if(i!=null){man[i]+=e.cantidad; manInfo[i]=e;}}
  const warnings=[], rank={"":0,conf:1,pnd:2,mod:3}, conf=new Array(n).fill(0);
  for(const o of ordersOf(sid)){
    const q=effLines(o)[p.code]||0, base=(o.lines||{})[p.code]||0, changed=!isPend(o)&&o.mod&&q!==base;
    if(!q&&!changed) continue;
    const d=od(o,sid), ie=idx.get(key(d.entryW));
    if(ie!=null){entry[ie]+=q; if(!isPend(o)) conf[ie]+=q; const t=isPend(o)?"pnd":changed?"mod":"conf"; if(rank[t]>rank[tone[ie]]) tone[ie]=t;
      tips[ie].push(isPend(o)?"Pendiente de confirmar pedido":changed?`${o.ref}: modificación pendiente de validar (antes ${base} uds)`:o.ref);}
    if(!q) continue;
    if(isPend(o)){const ip=idx.get(key(d.pedidoW)); if(ip!=null) ped[ip]+=q; else if(d.pedidoW<today) warnings.push(`Entrada ${wLabel(d.entryW)} sin pedido: debía lanzarse en ${wLabel(d.pedidoW)}`);}
    const ic=idx.get(key(d.etdW)); if(ic!=null) carga[ic]+=q;
    if(pal>1&&q%pal!==0) warnings.push(`${q} uds en ${isPend(o)?"entrada "+wLabel(d.entryW):o.ref} no es múltiplo de ${pal}`);
  }
  const net=new Array(n); let prev=p.stock||0;
  for(let i=0;i<n;i++){prev=prev-dem[i]+entry[i]+man[i]; net[i]=prev;}
  const real=net.map(v=>Math.max(0,v)), res=net.map(v=>Math.max(0,-v)), over=net.map(v=>v-(p.ss||0));
  const fi=p.extinguir?-1:over.findIndex(v=>v<-1e-9); let sug=null;
  if(fi>=0){const launch=addW(W[fi],-(c.despacho+c.plazo)); const short=-over[fi]+avg*c.cobertura; sug={week:W[fi],launch,qty:Math.max(pal,Math.ceil(short/pal-1e-9)*pal),late:launch<today,rotura:net.some(v=>v<-1e-9)};}
  return {conf,W,dem,entry,man,manInfo,tone,tips,ped,carga,net,real,res,over,sug,warnings,miss:missing(p)};
}
function supStats(sid){
  let brk=0,und=0,launch=0,inc=0;
  for(const p of prodsOf(sid).filter(x=>!x.extinguir)){const r=calc(p,sid); if(r.net.some(v=>v<-1e-9)) brk++; else if(r.over.some(v=>v<-1e-9)) und++; if(r.sug&&r.sug.launch<addW(today,4)) launch++; if(r.miss.length) inc++;}
  const os=ordersOf(sid);
  return {brk,und,launch,inc,n:prodsOf(sid).length,ext:prodsOf(sid).filter(x=>x.extinguir).length,
    live:os.filter(o=>!isPend(o)&&orderState(o,sid)[0]!=="En almacén").length,
    pend:os.filter(o=>isPend(o)&&Object.keys(o.lines||{}).length).length,
    mods:os.filter(o=>!isPend(o)&&o.mod).length};
}

/* Cambios en las líneas de un pedido lanzado: quedan como modificación pendiente de validar */
function changeLines(o,fn){
  const n=clone(o);
  if(isPend(n)){n.lines=n.lines||{}; n.prices=n.prices||{}; fn(n.lines,n.prices,n); return n;}
  if(!n.mod) n.mod={lines:clone(n.lines||{}),prices:clone(n.prices||{}),at:key(utcToday)};
  fn(n.mod.lines,n.mod.prices,n);
  if(same(n.mod.lines,n.lines||{})&&same(n.mod.prices,n.prices||{})) delete n.mod;
  return n;
}
function setLine(lines,prices,o,code,q){
  if(q){lines[code]=q; if(prices[code]==null){const b=(o.prices||{})[code]; prices[code]=b!=null?b:((prod(code)||{}).price||0);}}
  else {delete lines[code]; delete prices[code];}
}
function afterMod(n,ref){if(!isPend(n)) toast(n.mod?`${ref}: modificación pendiente de validar por el proveedor`:`${ref}: vuelve a coincidir con la versión confirmada`);}
function exportBtn(fn){const b=el("button","btn","Exportar a Excel"); b.addEventListener("click",fn); return b;}
function renderHome(app){
  document.title="Planificador de compras de importación";
  const h=el("header","top pad"); const b=el("div","brand"); const bk=el("a","back","‹ Planificador de compras"); bk.href="#planificador"; b.append(bk, el("h1",null,"Proveedores"), el("p",null,"Elige el proveedor que quieres revisar.")); h.append(b, stockBox(), exportBtn(exportHome)); app.append(h);
  const g=el("div","suppliers pad");
  const ss=[...state.suppliers].sort((a,b)=>(prodsOf(b._id).length>0)-(prodsOf(a._id).length>0)||(a.sort||0)-(b.sort||0));
  if(!ss.length&&state.loaded.s) g.append(el("div","card empty","Todavía no hay proveedores dados de alta."));
  for(const s of ss){
    const st=supStats(s._id); const a=el("a","sup"+(st.n?"":" nodata")); a.href="#"+s._id;
    a.append(el("h2",null,s.name), el("p",null,[s.familia,s.contacto?"Contacto: "+s.contacto:""].filter(Boolean).join(". ")||"Sin datos de contacto"));
    const t=el("div","stats");
    if(!st.n) t.append(el("span","tag neutral","Sin artículos cargados"));
    else{
      t.append(el("span","tag neutral",`${st.n} artículos`));
      if(st.brk) t.append(el("span","tag bad",`${st.brk} con rotura`));
      if(st.und) t.append(el("span","tag warn",`${st.und} bajo seguridad`));
      if(st.inc) t.append(el("span","tag bad",`${st.inc} con datos incompletos`));
      if(st.pend) t.append(el("span","tag pend",`${st.pend} entradas sin pedido`));
      if(st.mods) t.append(el("span","tag mod",`${st.mods} modificaciones por validar`));
      if(st.live) t.append(el("span","tag ok",`${st.live} pedidos en curso`));
      if(st.ext) t.append(el("span","tag ext",`${st.ext} a extinguir`));
    }
    a.append(t); g.append(a);
  }
  buscarArticulo(app);
  const tp=el("h2","sec pad provtit","Proveedores"); app.append(tp);
  app.append(g);
}
const PARAMS=[["plazo","Pedido a puerto","sem"],["transito","Tránsito","sem"],["despacho","Despacho","sem"],["cobertura","Cobertura por pedido","sem"]];
function renderSupHeader(app,r){
  const s=sup(r.sid), c=cfg(r.sid); document.title=`${s.name}: planificador de compras`;
  const h=el("header","top pad"); const b=el("div","brand");
  const back=el("a","back","‹ Proveedores"); back.href="#proveedores"; b.append(back, el("h1",null,s.name), el("p",null,[s.razon&&s.razon!==s.name?s.razon+(s.codigo_ax?` (${s.codigo_ax})`:""):"",s.contacto?"Contacto: "+s.contacto:"",s.email||""].filter(Boolean).join("   ")||"Sin datos de contacto"));
  h.append(b);
  const pr=el("div","params");
  for(const [k,l,u] of PARAMS){const w=el("label","param"); w.append(l+" "); const i=el("input"); i.value=c[k]; i.inputMode="numeric"; i.disabled=!state.canWrite; i.setAttribute("aria-label",l); i.dataset.k="param-"+k;
    i.addEventListener("change",()=>{const v=num(i.value); if(!(v>=0)){i.value=c[k]; toast("Introduce un número válido"); return;} saveSup(r.sid,{[k]:v});}); w.append(i,el("span","u",u)); pr.append(w);}
  const fw=el("label","param fpar"); fw.append("Forma de pago "); const fs=selForma((sup(r.sid)||{}).fpId, v=>saveSup(r.sid,{fpId:v}), false); fs.disabled=!state.canWrite; fs.setAttribute("aria-label","Forma de pago del proveedor"); fw.append(fs); pr.append(fw);
  h.append(pr); app.append(h);
  const fl=el("section","flow"); fl.setAttribute("aria-label","Plazos de un pedido");
  const step=(t,sm,k)=>{const d=el("div"); d.append(el("b",null,t),el("small",null,sm),el("span","k",k)); return d;};
  fl.append(step("Pedido","Se lanza al proveedor",`ETA − ${c.plazo} sem`), step("Pago",formaSup(r.sid).tramos.length>1?"En varios tramos":"Previsión",formaCorta(formaSup(r.sid))), step("Carga en China","ETD, embarque",`ETA − ${c.transito} sem`), step("Llegada a puerto","ETA Valencia","ETA"), step("Entrada en almacén","Tras despacho",`ETA + ${c.despacho} sem`));
  app.append(fl);
  const nav=el("nav","tabs pad");
  const t1=el("a",null,"Revisión de artículos para compras"); t1.href="#"+r.sid; if(r.view==="art") t1.setAttribute("aria-current","page");
  const t2=el("a",null,"Pedidos lanzados"); t2.href="#"+r.sid+"-pedidos"; if(r.view==="ped") t2.setAttribute("aria-current","page");
  nav.append(t1,t2); app.append(nav);
}

/* ---------- Vista: revisión de artículos ---------- */
function visibleProducts(sid){
  const f=state.filters, qq=f.q.trim().toLowerCase();
  return prodsOf(sid).map(p=>({p,r:calc(p,sid)})).filter(({p,r})=>{
    if(qq&&!((p.codigo_ax||"").toLowerCase().includes(qq)||(p.name||"").toLowerCase().includes(qq)||(p.model||"").toLowerCase().includes(qq))) return false;
    if(f.onlyA&&(p.extinguir||(!r.over.some(v=>v<-1e-9)&&!r.warnings.length&&!r.miss.length))) return false;
    return true;});
}
function renderArticles(app,sid){
  const c=cfg(sid), W=weeks(sid), f=state.filters;
  const tb=el("div","toolbar pad");
  const q=el("input"); q.type="search"; q.placeholder="Buscar modelo o código"; q.value=f.q; q.dataset.k="q"; q.setAttribute("aria-label","Buscar artículo"); q.addEventListener("input",()=>{f.q=q.value; render();});
  const l1=el("label"); const c1=el("input"); c1.type="checkbox"; c1.checked=f.onlyA; c1.addEventListener("change",()=>{f.onlyA=c1.checked; render();}); l1.append(c1," Solo artículos con alerta");
  const l2=filasMenu(c);
  const nb=el("button","btn primary","Nuevo artículo"); nb.disabled=!state.canWrite; nb.addEventListener("click",()=>openProd(null,sid));
  const st=supStats(sid); const sm=el("div","summary");
  const mk=(cl,n,l)=>{const x=el("span",cl); x.append(el("b",null,String(n))," "+l); return x;};
  sm.append(mk("r",st.brk,"con rotura"),mk("a",st.und,"bajo seguridad"),mk("p",st.pend,"entradas sin pedido"),mk("m",st.mods,"modificaciones por validar"),mk("",st.launch,"pedidos a lanzar en 4 semanas"));
  tb.append(q,l1,l2,nb,exportBtn(()=>exportArticles(sid)),sm); app.append(tb);
  const lg=el("div","legend pad");
  for(const [v,t] of [["--arrive-soft","Entrada con pedido confirmado"],["--steel-soft","Otra entrada (devolución, otro proveedor…)"],["--pend-soft","Entrada pendiente de confirmar pedido"],["--mod-soft","Modificación pendiente de validar por el proveedor"],["--promo-soft","Venta modificada a mano"],["--amber-soft","Bajo stock de seguridad"],["--red-soft","Rotura"]]){const s=el("span"); const i=el("i"); i.style.background=`var(${v})`; s.append(i,t); lg.append(s);}
  app.append(lg);
  const wrap=el("div","gridwrap"), t=el("table","grid");
  t.append(gridHead(sid,W));
  const vis=visibleProducts(sid);
  let sep=false;
  for(const {p,r} of vis){
    if(p.extinguir&&!sep){sep=true; const b=el("tbody"), tr=el("tr","exthead"), td=el("td"); td.colSpan=W.length+1; const d=el("div","phin"); d.append(el("b",null,"Artículos a extinguir"), el("span",null,"No se vuelven a comprar: no se proponen pedidos ni cuentan en las alertas. Solo se sigue su stock hasta agotarlo.")); td.append(d); tr.append(td); b.append(tr); t.append(b);}
    t.append(productBody(p,r,W,sid,c));
  }
  if(!vis.length){const b=el("tbody"),tr=el("tr"),td=el("td","empty"); td.colSpan=W.length+1; td.style.textAlign="left"; td.textContent=prodsOf(sid).length?"Ningún artículo coincide con el filtro.":"Este proveedor aún no tiene artículos en el planificador. Añádelos con «Nuevo artículo»."; tr.append(td); b.append(tr); t.append(b);}
  wrap.append(t); app.append(wrap);
}
// Cabecera de semanas con las etiquetas de pedido y «Crear pedido»
function gridHead(sid,W){
  const th=el("thead"), hr=el("tr"); hr.append(el("th","lab","Semana"));
  const pendByWeek=new Map(); for(const o of ordersOf(sid)) if(isPend(o)&&Object.keys(o.lines||{}).length) pendByWeek.set(key(od(o,sid).entryW),o);
  const confByWeek=new Map(); for(const o of ordersOf(sid)) if(!isPend(o)){const k=key(od(o,sid).entryW); if(!confByWeek.has(k)) confByWeek.set(k,[]); confByWeek.get(k).push(o);}
  W.forEach((d,i)=>{const h=el("th",i===0?"now":""); h.append(wLabel(d)); h.append(el("small",null,dShort(d)));
    for(const o of (confByWeek.get(key(d))||[])){const dd=od(o,sid); const tg=el("a","otag"+(o.mod?" m":(o.comentarios?" c":"")),o.ref); tg.href=`#${sid}-pedidos`; tg.setAttribute("aria-label",`Pedido ${o.ref}`);
      const tip=el("span","tip"); tip.append(el("b",null,o.ref+"\n"), `CRD: ${o.crd?dLong(parseKey(o.crd)):"sin fecha"}\nETD: ${o.etd?dLong(parseKey(o.etd)):"sin fecha (estimada "+dLong(dd.etd)+")"}\nETA: ${dLong(dd.eta)}\nTamaño: ${sizeLabel(o.tamano)||"sin indicar"}\nNaviera: ${o.naviera||"sin indicar"}\nImporte: ${fmtE2(total(o))}${o.mod?"\nModificación pendiente de validar":""}${o.comentarios?"\n\nComentarios: "+o.comentarios:""}`);
      tg.append(tip); tg.addEventListener("click",()=>{state.expanded.add(o._id); state.ordFilter={sid,peds:[o._id],refs:[]}; state.dd=null;}); h.append(tg);}
    const po=pendByWeek.get(key(d)); if(po&&state.canWrite){const b=el("button","asg","Crear pedido"); b.title="Crear un pedido con todas las entradas pendientes de esta semana"; b.addEventListener("click",()=>openAsg(sid,po)); h.append(b);} hr.append(h);});
  th.append(hr); return th;
}
function rowsFor(c){return [["dem","Venta prevista"],["entry","Entrada en almacén",null,`ETA + ${c.despacho} sem`],["man","Otras entradas",null,"devoluciones, otros proveedores"],["ped","Pedido a lanzar","x"],["carga","Carga en China (ETD)","x"],["real","Stock disponible"],["res","Reservas pendientes"],["over","Stock disponible − Stock seguridad"]];}
function productBody(p,r,W,sid,c){
  const tb=el("tbody",p.extinguir?"extb":""), collapsed=state.collapsed.has(p.code), hide=state.filters.hide;
  const h=el("tr","ph"), hc=el("td"); hc.colSpan=W.length+1; const inn=el("div","phin");
  const nb=el("button","name",p.name||p.code); nb.title="Ver o editar los datos del artículo"; nb.addEventListener("click",()=>openProd(p,sid));
  const mv=v=>v==null||v===""?"falta":(fmt(v)||"0");
  const stk=el("span",p.stockAX?"stk ax":"stk man"); stk.append(`Disponible ${mv(p.stock)}`); stk.append(el("small",null,p.stockAX?` AX ${fechaCorta(p.stockFecha)}`:" manual"));
  stk.title=p.stockAX?`Stock disponible de AX («Disponible real», clave ${p.clave}): ${fmt(p.stock)||0} uds. Stock real («Disponible»): ${fmt(p.stockReal)||0} uds. Fichero «${p.stockFichero||""}» del ${fechaLarga(p.stockFecha)}`:(p.clave?`No hay stock de AX para la clave ${p.clave}: se usa el stock manual`:"Sin clave de stock: se usa el stock manual");
  inn.append(nb, el("span","code",dispCode(p)+(p.clave&&p.codigo_ax&&p.clave!==p.codigo_ax?` · ${p.clave.slice(p.codigo_ax.length)}`:"")), stk, el("span","meta",`Venta ${mv(p.avg)}/sem  |  Seguridad ${mv(p.ss)}  |  Pallet ${mv(p.pallet)}  |  Precio ${p.price==null||p.price===""?"falta":fmtE2(p.price)}`));
  if(p.extinguir) inn.append(el("span","tag ext","A extinguir: no pedir"));
  if(r.miss.length&&!p.extinguir){const mb=el("button","tag bad",`Faltan datos: ${r.miss.join(", ")}. Completar`); mb.addEventListener("click",()=>openProd(p,sid)); inn.append(mb);}
  if(r.sug){const s=r.sug; inn.append(el("span","tag "+(s.late||s.rotura?"bad":"warn"), s.late?`Vas tarde: bajo seguridad en ${wLabel(s.week)}. Pide ya ${s.qty} uds`:`Lanzar pedido en ${wLabel(s.launch)}: ${s.qty} uds (bajo seguridad en ${wLabel(s.week)})`));}
  else if(!r.miss.length&&!p.extinguir) inn.append(el("span","tag ok","Cubierto todo el horizonte"));
  for(const w of r.warnings) inn.append(el("span","tag bad",w));
  if(state.canWrite){const xb=el("button","tog xt",p.extinguir?"Volver a comprar":"A extinguir"); xb.title=p.extinguir?"Quitar la marca: el artículo vuelve a planificarse con normalidad":"Marcar como a extinguir: no se vuelve a comprar y pasa al final de la lista";
    xb.addEventListener("click",()=>{ if(!p.extinguir&&!confirm(`¿Marcar «${p.name}» como a extinguir? No se propondrán más pedidos y pasará al final, junto al resto de artículos a extinguir.`)) return; const np=clone(p); np.extinguir=!p.extinguir; saveProduct(np); toast(np.extinguir?`${p.name}: a extinguir`:`${p.name}: vuelve a planificarse`); }); inn.append(xb);}
  const tg=el("button","tog",collapsed?"Mostrar":"Ocultar"); tg.addEventListener("click",()=>{collapsed?state.collapsed.delete(p.code):state.collapsed.add(p.code); render();});
  inn.append(tg); hc.append(inn); h.append(hc); tb.append(h);
  for(const [k,label,opt,note] of rowsFor(c)){
    const tr=el("tr",(collapsed||hide.has(k))?"hidden":(k==="real"?"rowA":""));
    const lc=el("td","lab",label); if(note){lc.append(el("small",null,note)); lc.title="La mercancía entra en almacén una semana después de llegar a puerto, por el despacho del contenedor.";} tr.append(lc);
    for(let i=0;i<W.length;i++){
      const td=el("td","v"+(i===0?" now":"")), ks=key(W[i]);
      if(k==="dem"||k==="entry"){
        td.classList.remove("v");
        const inp=el("input","cell"); inp.disabled=!state.canWrite||(p.extinguir&&k==="entry"&&!r.entry[i]); inp.dataset.k=`${k}|${p.code}|${ks}`; if(p.extinguir&&k==="entry"&&!r.entry[i]) inp.title="Artículo a extinguir: no se vuelve a pedir";
        if(k==="dem"){
          inp.value=fmt(r.dem[i]); inp.inputMode="decimal";
          if(p.overrides&&(ks in p.overrides)){inp.classList.add("promo"); inp.title="Modificada a mano. Borra el valor para volver a la media.";}
          inp.setAttribute("aria-label",`Venta prevista ${p.name} ${wLabel(W[i])}`);
          inp.addEventListener("change",()=>setDemand(p,ks,inp.value));
        } else {
          inp.value=fmt(r.entry[i]); inp.inputMode="numeric";
          if(r.tone[i]){inp.classList.add(r.tone[i]); inp.title=r.tips[i].join(". ");}
          if(r.entry[i]&&(p.pallet||1)>1&&r.entry[i]%p.pallet) inp.classList.add("badpal");
          inp.setAttribute("aria-label",`Entrada en almacén ${p.name} ${wLabel(W[i])}`);
          inp.addEventListener("change",()=>setEntry(sid,p,W[i],inp));
        }
        td.append(inp);
      }
      else if(k==="man"){td.classList.remove("v"); const e=r.manInfo[i]; const b=el("button","mcell"+(e?" has":""),e?fmt(e.cantidad)||String(e.cantidad):"");
        b.disabled=!state.canWrite&&!e; b.dataset.k=`man|${p.code}|${ks}`; b.title=e?`${MOTIVOS[e.motivo]||"Entrada"}: ${e.cantidad} uds${e.comentario?"\n"+e.comentario:""}`:"Añadir una entrada (devolución, compra a otro proveedor…)";
        b.setAttribute("aria-label",`Otras entradas ${p.name} ${wLabel(W[i])}`); b.addEventListener("click",()=>openMan(p,W[i],e,sid)); td.append(b);}
      else if(k==="ped"){td.textContent=fmt(r.ped[i]); if(r.ped[i]) td.classList.add("ord");}
      else if(k==="carga"){td.textContent=fmt(r.carga[i]); td.classList.add("carga");}
      else if(k==="real"){td.textContent=fmt(r.real[i])||"0"; if(r.real[i]<=1e-9) td.classList.add("zero");}
      else if(k==="res"){td.textContent=fmt(r.res[i]); td.classList.add("res");}
      else {const v=r.over[i]; td.textContent=fmt(v)||"0"; if(r.net[i]<-1e-9) td.classList.add("break"); else if(v<-1e-9) td.classList.add("under"); else td.classList.add("dim");}
      tr.append(td);
    }
    tb.append(tr);
  }
  return tb;
}
function setDemand(p,k,raw){
  const np=clone(p); np.overrides=np.overrides||{}; const v=num(raw);
  if(raw.trim()===""||v===p.avg) delete np.overrides[k];
  else if(isNaN(v)||v<0){toast("La venta prevista debe ser un número igual o mayor que cero"); render(); return;}
  else np.overrides[k]=v;
  for(const kk of Object.keys(np.overrides)) if(parseKey(kk)<today) delete np.overrides[kk];
  saveProduct(np);
}
function setEntry(sid,p,w,inp){
  const c=cfg(sid), raw=inp.value, q=raw.trim()===""?0:num(raw), pal=p.pallet>=1?p.pallet:1;
  if(isNaN(q)||q<0||!Number.isInteger(q)){toast("Introduce un número entero de unidades."); render(); return;}
  if(q%pal!==0){const lo=Math.floor(q/pal)*pal; toast(`Aviso: ${q} no es múltiplo de ${pal} uds por pallet (lo habitual sería ${lo?lo+" o "+(lo+pal):pal}). Se guarda igualmente.`);}
  const wk=key(w);
  const confs=ordersOf(sid).filter(o=>!isPend(o)&&key(od(o,sid).entryW)===wk);
  const confO=confs.find(o=>effLines(o)[p.code]||(o.lines||{})[p.code])||confs[0];
  if(confO){const n=changeLines(confO,(L,P,o)=>setLine(L,P,o,p.code,q)); saveOrder(n); afterMod(n,n.ref); return;}
  const etaK=key(addW(w,-c.despacho)); const id=`pend-${sid}-${etaK}`;
  const ex=state.orders.find(o=>o._id===id)||ordersOf(sid).find(o=>isPend(o)&&key(od(o,sid).entryW)===wk);
  const o=ex?clone(ex):{_id:id,supplier:sid,status:"pendiente",ref:"",eta:etaK,lines:{}};
  o.lines=o.lines||{}; if(q) o.lines[p.code]=q; else delete o.lines[p.code];
  if(!Object.keys(o.lines).length){if(ex) delOrder(o); else render(); return;}
  saveOrder(o);
}

/* ---------- Crear pedido desde entradas pendientes ---------- */
let asgCtx=null;
function openAsg(sid,po){
  asgCtx={sid,po}; const d=od(po,sid);
  $("#asgTitle").textContent=`Nuevo pedido para la entrada de ${wLabel(d.entryW)}`;
  $("#asgSub").textContent=`Incluirá todas las cantidades pendientes de esa semana (ETA ${wLabel(d.etaW)}):`;
  const ul=$("#asgList"); ul.textContent=""; for(const [k,q] of Object.entries(po.lines||{})) ul.append(el("li",null,`${(prod(k)||{name:k}).name}: ${q} uds`));
  const sz=$("#asgSize"); sz.textContent=""; for(const [v,l] of SIZES){const op=el("option",null,l); op.value=v; sz.append(op);} sz.value="40";
  $("#asgHint").textContent=`ETA inicial ${dLong(d.eta)}. Podrás ajustar CRD, ETD, ETA y naviera en Pedidos lanzados.`;
  $("#asgRef").value=""; $("#asgErr").textContent=""; $("#dlgAsg").showModal(); setTimeout(()=>$("#asgRef").focus(),30);
}
$("#asgCancel").addEventListener("click",()=>$("#dlgAsg").close());
$("#asgExport").addEventListener("click",()=>{ if(asgCtx) exportPropuesta(asgCtx.sid, asgCtx.po, $("#asgRef").value.trim(), $("#asgSize").value); });
// Exporta el pedido propuesto (antes de crearlo) para enviarlo o revisarlo; importes con fórmulas
function exportPropuesta(sid, po, ref, tamano){
  const s=sup(sid)||{}, c=cfg(sid), d=od(po,sid), mon=c.moneda||"EUR", f=formaSup(sid);
  const lin=Object.entries(po.lines||{}).map(([k,q])=>({p:prod(k)||{name:k},q:+q})).filter(x=>x.q);
  const A=[["Pedido de importación (propuesta)"],[],
    ["Proveedor", s.name||"", s.razon&&s.razon!==s.name?s.razon:"", s.codigo_ax?`Código AX ${s.codigo_ax}`:""],
    ["Nº de pedido", ref||"(sin número todavía)"],
    ["Fecha", xDate(utcToday)],
    ["Tamaño", (SIZES.find(x=>x[0]===tamano)||[,tamano||""])[1]],
    ["ETA prevista", xDate(d.eta), `Semana ${wLabel(d.etaW).replace("S","")}`],
    ["ETD estimada (carga)", xDate(d.etd)],
    ["Entrada en almacén", `${wLabel(d.entryW)} · ${dLong(d.entryW)}`],
    ["Forma de pago", f.nombre],
    ["Moneda", mon],
    [],
    ["Código AX","Clave stock","Ref. proveedor","Descripción","Modelo","Unidades","Uds/pallet","Pallets","Precio","Importe"]];
  const first=A.length+1;   // primera fila de líneas (Excel empieza en 1)
  lin.forEach((x,i)=>{ const r=first+i; A.push([x.p.codigo_ax||"", x.p.clave||"", x.p.refProv||"", x.p.name||"", x.p.model||"", x.q, x.p.pallet||"", {f:`IF(G${r}>0,F${r}/G${r},"")`}, x.p.price||0, {f:`F${r}*I${r}`}]); });
  const last=first+lin.length-1;
  A.push(["Total","","","","",{f:`SUM(F${first}:F${last})`},"",{f:`SUM(H${first}:H${last})`},"",{f:`SUM(J${first}:J${last})`}]);
  if(po.comentarios) A.push([],["Notas",po.comentarios]);
  const ws=XLSX.utils.aoa_to_sheet(A.map(r=>r.map(v=>v&&typeof v==="object"&&v.f?null:v)));
  A.forEach((r,ri)=>r.forEach((v,ci)=>{ if(v&&typeof v==="object"&&v.f){ ws[XLSX.utils.encode_cell({r:ri,c:ci})]={t:"n",f:v.f}; } }));
  const nf=mon==="USD"?'#,##0.00 "$"':'#,##0.00 "€"';
  for(let r=first;r<=last+1;r++){ for(const col of ["I","J"]){ const cell=ws[`${col}${r}`]; if(cell) cell.z=nf; } const h=ws[`H${r}`]; if(h) h.z="0.0"; }
  for(const c of ["B5","B7","B8"]) if(ws[c]&&typeof ws[c].v==="number"){ ws[c].t="n"; ws[c].z="dd/mm/yyyy"; }
  ws["!cols"]=[{wch:18},{wch:18},{wch:14},{wch:36},{wch:14},{wch:10},{wch:10},{wch:9},{wch:12},{wch:14}];
  ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:A.length-1,c:9}});
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Pedido");
  XLSX.writeFile(wb,`Pedido_${safeU(s.name||"proveedor")}_${ref?safeU(ref):wLabel(d.entryW)}_${key(utcToday)}.xlsx`);
}
$("#fAsg").addEventListener("submit",ev=>{
  ev.preventDefault(); const {sid,po}=asgCtx; const ref=$("#asgRef").value.trim();
  if(!ref){$("#asgErr").textContent="Indica el número de pedido."; return;}
  if(state.orders.some(x=>!isPend(x)&&x.supplier===sid&&(x.ref||"").toLowerCase()===ref.toLowerCase())){$("#asgErr").textContent="Ya existe un pedido con ese número."; return;}
  const o={_id:tmpId(),supplier:sid,status:"lanzado",ref,crd:"",etd:"",eta:po.eta,naviera:"",tamano:$("#asgSize").value,lines:{},prices:{},history:[],comentarios:po.comentarios||"",fechaPedido:key(utcToday),fp:null,pagos:{}};
  let n=0; for(const [k,q] of Object.entries(po.lines||{})){o.lines[k]=q; o.prices[k]=(prod(k)||{}).price||0; n++;}
  $("#dlgAsg").close(); saveOrder(o).then(ok=>{ if(ok) delOrder(po); }); toast(`Pedido ${ref} creado con ${n} ${n===1?"artículo":"artículos"}`);
});

/* ---------- Validación de modificaciones ---------- */
let verCtx=null;
function nextRef(o){const n=(o.history||[]).length+1; const base=(o.history&&o.history[0]?o.history[0].ref:o.ref).replace(/\s*-M\d+$/,""); return `${base}-M${n}`;}
function openVer(o){verCtx=o; $("#verSub").textContent=`Se aplicarán los cambios a ${o.ref} y su versión actual quedará en el historial.`; $("#verRef").value=nextRef(o); $("#verErr").textContent=""; $("#dlgVer").showModal(); setTimeout(()=>{$("#verRef").focus(); $("#verRef").select();},30);}
$("#verCancel").addEventListener("click",()=>$("#dlgVer").close());
$("#fVer").addEventListener("submit",ev=>{
  ev.preventDefault(); const o=verCtx, ref=$("#verRef").value.trim();
  if(!ref){$("#verErr").textContent="Indica el nuevo nombre del pedido."; return;}
  if(ref.toLowerCase()!==(o.ref||"").toLowerCase()&&state.orders.some(x=>x._id!==o._id&&!isPend(x)&&x.supplier===o.supplier&&(x.ref||"").toLowerCase()===ref.toLowerCase())){$("#verErr").textContent="Ya existe otro pedido con ese nombre."; return;}
  const n=clone(o); n.history=n.history||[];
  n.history.push({ref:o.ref,lines:clone(o.lines||{}),prices:clone(o.prices||{}),crd:o.crd||"",etd:o.etd||"",eta:o.eta,naviera:o.naviera||"",tamano:o.tamano||"",replacedAt:key(utcToday)});
  n.ref=ref; n.lines=n.mod.lines; n.prices=n.mod.prices; delete n.mod;
  $("#dlgVer").close(); state.expanded.add(n._id); saveOrder(n); toast(`Modificación confirmada. El pedido pasa a llamarse ${ref}`);
});
function rejectMod(o){if(!confirm(`¿Descartar la modificación de ${o.ref} y volver a la versión confirmada?`)) return; const n=clone(o); delete n.mod; saveOrder(n); toast(`${o.ref}: modificación descartada`);}

/* ---------- Vista: pedidos lanzados ---------- */
function orderGroups(sid){
  const pend=ordersOf(sid).filter(o=>isPend(o)&&Object.keys(o.lines||{}).length).sort((a,b)=>a.eta<b.eta?-1:1);
  const all=ordersOf(sid).filter(o=>!isPend(o)).sort((a,b)=>a.eta<b.eta?-1:1);
  return {pend, done:all.filter(o=>orderState(o,sid)[0]==="En almacén"), live:all.filter(o=>orderState(o,sid)[0]!=="En almacén")};
}
function ordF(sid){if(state.ordFilter.sid!==sid) state.ordFilter={sid,peds:[],refs:[]}; return state.ordFilter;}
function filteredGroups(sid){
  const g=orderGroups(sid), f=ordF(sid);
  const okRef=o=>!f.refs.length||f.refs.some(r=>effLines(o)[r]||(o.lines||{})[r]);
  const okPed=o=>!f.peds.length||f.peds.includes(o._id);
  return {pend:f.peds.length?[]:g.pend.filter(okRef), live:g.live.filter(o=>okPed(o)&&okRef(o)), done:g.done.filter(o=>okPed(o)&&okRef(o)), act:!!(f.peds.length||f.refs.length), totalN:g.live.length+g.done.length};
}
function ddMulti(id,label,opts,sel,onChange){
  const w=el("div","dd"); const b=el("button","btn ddb"+(sel.length?" on":"")); b.type="button";
  b.textContent=`${label}: ${sel.length?(sel.length===1?((opts.find(o=>o.v===sel[0])||{l:"1 seleccionado"}).l):sel.length+" seleccionados"):"Todos"}`;
  b.setAttribute("aria-expanded",String(state.dd===id)); b.addEventListener("click",e=>{e.stopPropagation(); state.dd=state.dd===id?null:id; state.ddq=""; render();});
  w.append(b);
  if(state.dd===id){
    const pn=el("div","ddp"); pn.addEventListener("click",e=>e.stopPropagation());
    const q=el("input"); q.type="search"; q.placeholder="Buscar"; q.value=state.ddq; q.dataset.k="ddq-"+id; q.setAttribute("aria-label","Buscar en "+label); q.addEventListener("input",()=>{state.ddq=q.value; render();});
    const list=el("div","ddl"), qq=state.ddq.trim().toLowerCase();
    for(const o of opts){if(qq&&!(o.l+" "+(o.sub||"")).toLowerCase().includes(qq)) continue;
      const lb=el("label"), cb=el("input"); cb.type="checkbox"; cb.checked=sel.includes(o.v); cb.dataset.k=`dd-${id}-${o.v}`;
      cb.addEventListener("change",()=>onChange(cb.checked?[...sel,o.v]:sel.filter(x=>x!==o.v)));
      const sp=el("span",null,o.l); if(o.sub) sp.append(el("small",null,o.sub)); lb.append(cb,sp); list.append(lb);}
    if(!list.childNodes.length) list.append(el("p","secsub","Sin resultados"));
    const ft=el("div","ddf"); const cl=el("button","btn small","Quitar selección"); cl.type="button"; cl.addEventListener("click",()=>onChange([]));
    const ok=el("button","btn small primary","Aceptar"); ok.type="button"; ok.addEventListener("click",()=>{state.dd=null; render();}); ft.append(cl,ok);
    pn.append(q,list,ft); w.append(pn);
    if(!state.ddq) setTimeout(()=>{const n=document.querySelector(`[data-k="ddq-${id}"]`); if(n&&document.activeElement!==n&&!document.activeElement.closest(".ddp")) n.focus();},0);
  }
  return w;
}
function filterBar(sid,fg){
  const f=ordF(sid), bar=el("div","fbar"); bar.append(el("span","lbl","Filtrar"));
  const all=ordersOf(sid).filter(o=>!isPend(o)).sort((a,b)=>a.eta<b.eta?-1:1);
  const pedOpts=all.map(o=>({v:o._id,l:o.ref,sub:`ETA ${dLong(parseKey(o.eta))}. Entrada en almacén ${wLabel(od(o,sid).entryW)}`}));
  const codes=new Set(); for(const o of ordersOf(sid)){for(const k of Object.keys(effLines(o))) codes.add(k); for(const k of Object.keys(o.lines||{})) codes.add(k);}
  const refOpts=prodsOf(sid).filter(p=>codes.has(p.code)).map(p=>({v:p.code,l:dispCode(p),sub:p.name}));
  bar.append(ddMulti("ped","Nº de pedido",pedOpts,f.peds,n=>{f.peds=n; render();}), ddMulti("ref","Referencia",refOpts,f.refs,n=>{f.refs=n; render();}));
  if(fg.act){const cl=el("button","btn small","Limpiar filtros"); cl.addEventListener("click",()=>{f.peds=[]; f.refs=[]; state.dd=null; render();}); bar.append(cl);
    const shown=fg.live.length+(state.showDone||f.peds.length?fg.done.length:0); bar.append(el("span","cnt",`Mostrando ${shown} de ${fg.totalN} pedidos`));}
  return bar;
}
function renderOrders(app,sid){
  const box=el("div","orders pad"); box.style.paddingTop="14px"; const c=cfg(sid);
  const fg=filteredGroups(sid), {pend,done,live}=fg;
  const dl=$("#navieras"); dl.textContent=""; for(const n of new Set(state.orders.map(o=>o.naviera).filter(Boolean))){const op=el("option"); op.value=n; dl.append(op);}
  const top=el("div","toolbar"); top.style.padding="0";
  const sm=el("div","summary"); sm.style.marginLeft="0";
  const a1=el("span"); a1.append(el("b",null,String(live.length))," pedidos en curso");
  const a2=el("span"); a2.append(el("b",null,fmtE(live.reduce((s,o)=>s+total(o),0)))," en curso");
  const a3=el("span","p"); a3.append(el("b",null,String(pend.length))," entradas sin pedido");
  const a4=el("span","m"); a4.append(el("b",null,String(live.filter(o=>o.mod).length))," modificaciones por validar");
  sm.append(a1,a2,a3,a4); top.append(sm); const eb=exportBtn(()=>exportOrders(sid)); eb.style.marginLeft="auto"; top.append(eb); box.append(top); box.append(filterBar(sid,fg));
  if(pend.length){
    box.append(el("h2","sec","Entradas pendientes de confirmar pedido"), el("p","secsub","Cantidades previstas en la revisión de artículos que aún no tienen número de pedido."));
    for(const o of pend){const d=od(o,sid), cd=el("div","card pendcard"), row=el("div","prow");
      const u=Object.values(o.lines).reduce((a,b)=>a+b,0);
      row.append(el("b",null,`Entrada en almacén ${wLabel(d.entryW)}`), el("span",null,`ETA ${wLabel(d.etaW)}`), el("span","tag "+(d.pedidoW<today?"bad":"pend"), d.pedidoW<today?`Debía pedirse en ${wLabel(d.pedidoW)}`:`Pedir en ${wLabel(d.pedidoW)}`), el("span",null,`${Object.keys(o.lines).length} artículos, ${fmt(u)} uds, ${fmtE2(total(o))} a precio de ficha`));
      const b=el("button","btn pend","Crear pedido"); b.disabled=!state.canWrite; b.style.marginLeft="auto"; b.addEventListener("click",()=>openAsg(sid,o)); row.append(b); cd.append(row);
      cd.append(notas(o,"Notas de esta entrada: acuerdos con el proveedor, dudas, pendientes… Se pasan al pedido al crearlo.")); box.append(cd);}
  }
  box.append(el("h2","sec","Pedidos lanzados"));
  if(!live.length) box.append(el("div","card empty",fg.act?(done.length?"Ningún pedido en curso coincide con los filtros.":"Ningún pedido coincide con los filtros."):"No hay pedidos en curso. Crea un pedido a partir de las entradas pendientes para que aparezca aquí."));
  for(const o of live) box.append(orderCard(o,sid,c));
  if(done.length){
    const tl=el("label"); tl.style.cssText="display:flex;gap:6px;align-items:center;font-size:14px;color:var(--ink-2)";
    const cb=el("input"); cb.type="checkbox"; cb.checked=state.showDone; cb.addEventListener("change",()=>{state.showDone=cb.checked; render();}); tl.append(cb,` Mostrar pedidos ya en almacén (${done.length})`); box.append(tl);
    if(state.showDone||ordF(sid).peds.length) for(const o of [...done].reverse()) box.append(orderCard(o,sid,c));
  }
  app.append(box);
}
function linesTable(o,editable){
  const ro=!state.canWrite||!editable, t=el("table","lines");
  const th=el("thead"), hr=el("tr"); for(const [x,cl] of [["Referencia",""],["Descripción",""],["Cantidad","n"],["Precio unitario","n"],["Importe línea","n"]]) hr.append(el("th",cl,x)); th.append(hr); t.append(th);
  const b=el("tbody"); let u=0,e=0;
  const L=editable?effLines(o):(o.lines||{}), base=o.lines||{}, hasMod=editable&&!isPend(o)&&o.mod;
  const codes=[...new Set([...Object.keys(L),...(hasMod?Object.keys(base):[])])];
  for(const code of codes){
    const q=L[code]||0, bq=base[code]||0, p=prod(code)||{name:code,pallet:1,price:0,code};
    const up=editable?lp(o,code):lp(o,code,true), bp=lp(o,code,true), fp=p.price||0, removed=hasMod&&!q;
    const tr=el("tr",(removed?"removed":"")+(state.ordFilter.refs.includes(code)?" hl":""));
    const c0=el("td",null,dispCode(prod(code)||{code})), c1=el("td",null,p.name+(removed?" (se elimina)":""));
    if(q&&(p.pallet||1)>1&&q%p.pallet) c1.append(el("span","badpal",`no es múltiplo de ${p.pallet}`));
    const c2=el("td","n"), c3=el("td","n");
    if(ro){c2.textContent=fmt(q)||"0"; c3.textContent=fmtE2(up);}
    else{
      const qi=el("input"); qi.value=q; qi.inputMode="numeric"; qi.dataset.k=`line|${o._id}|${code}`; qi.setAttribute("aria-label",`Cantidad de ${p.name}`);
      if(hasMod&&q!==bq){qi.classList.add("modv"); c2.append(el("span","was",`antes ${bq}`));}
      qi.addEventListener("change",()=>{const v=qi.value.trim()===""?0:num(qi.value); const pal=p.pallet>=1?p.pallet:1;
        if(isNaN(v)||v<0||!Number.isInteger(v)){toast("Introduce un número entero de unidades."); render(); return;}
        if(v%pal){toast(`Aviso: ${v} no es múltiplo de ${pal} uds por pallet. Se guarda igualmente.`);}
        const n=changeLines(o,(Lx,Px,oo)=>setLine(Lx,Px,oo,code,v)); saveOrder(n); afterMod(n,o.ref);});
      c2.prepend(qi);
      const pi=el("input"); pi.value=up.toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:4}); pi.inputMode="decimal"; pi.dataset.k=`price|${o._id}|${code}`; pi.setAttribute("aria-label",`Precio unitario de ${p.name}`); pi.disabled=!q;
      if(hasMod&&q&&Math.abs(up-bp)>1e-9){pi.classList.add("modv"); c3.append(el("span","was",`antes ${fmtE2(bp)}`));}
      else if(Math.abs(up-fp)>1e-9){pi.classList.add("chg"); pi.title=`Precio de ficha: ${fmtE2(fp)}`;}
      pi.addEventListener("change",()=>{const raw=pi.value.trim(); const v=raw===""?fp:parsePrice(raw); if(isNaN(v)||v<0){toast("El precio debe ser un número igual o mayor que cero"); render(); return;}
        const n=changeLines(o,(Lx,Px)=>{Px[code]=Math.round(v*10000)/10000;}); saveOrder(n); afterMod(n,o.ref);});
      c3.prepend(pi);
    }
    tr.append(c0,c1,c2,c3,el("td","n",fmtE2(q*up))); b.append(tr); u+=q; e+=q*up;
  }
  t.append(b); const tf=el("tfoot"), fr=el("tr"); fr.append(el("td",null,"Total"),el("td",null,""),el("td","n",fmt(u)||"0"),el("td","n",""),el("td","n",fmtE2(e))); tf.append(fr); t.append(tf);
  return t;
}
function orderCard(o,sid,c){
  const d=od(o,sid), cd=el("article","card"+(o.mod?" modcard":"")), ro=!state.canWrite, open=state.expanded.has(o._id)||(state.ordFilter.sid===sid&&state.ordFilter.refs.length>0), hopen=state.histOpen.has(o._id);
  const totU=Object.values(effLines(o)).reduce((a,b)=>a+b,0);
  const h=el("div","hdr");
  const fld=(lab,sub,input)=>{const l=el("label"); l.append(lab); if(sub) l.append(el("small",null,sub)); l.append(input); return l;};
  const iRef=el("input","ref"); iRef.value=o.ref||""; iRef.disabled=ro; iRef.dataset.k="ref|"+o._id;
  iRef.addEventListener("change",()=>{const v=iRef.value.trim(); if(!v){toast("El número de pedido no puede quedar vacío"); render(); return;} saveOrder(Object.assign(clone(o),{ref:v}));});
  const dIn=f=>{const i=el("input"); i.type="date"; i.value=o[f]||""; i.disabled=ro; i.dataset.k=f+"|"+o._id;
    i.addEventListener("change",()=>{if(f==="eta"&&!i.value){toast("La ETA es obligatoria: sin ella el pedido no se puede situar en el calendario"); render(); return;}
      const n=Object.assign(clone(o),{[f]:i.value}); saveOrder(n); if(f==="eta") toast(`Entrada en almacén movida a ${wLabel(od(n,sid).entryW)}`);}); return i;};
  const iNav=selNaviera(o, ro);
  const iSz=el("select"); iSz.disabled=ro; const e0=el("option",null,"Sin indicar"); e0.value=""; iSz.append(e0); for(const [v,l] of SIZES){const op=el("option",null,l); op.value=v; iSz.append(op);} iSz.value=o.tamano||""; iSz.addEventListener("change",()=>saveOrder(Object.assign(clone(o),{tamano:iSz.value})));
  const tot=el("div","tot",fmtE2(total(o))); if(o.mod) tot.append(el("s",null,fmtE2(total(o,true))));
  const iFp=el("input"); iFp.type="date"; iFp.value=o.fechaPedido||""; iFp.disabled=ro; iFp.dataset.k="fped|"+o._id; iFp.addEventListener("change",()=>saveOrder(Object.assign(clone(o),{fechaPedido:iFp.value||""})));
  const iFo=selForma(o.fp, v=>saveOrder(Object.assign(clone(o),{fp:v})), true, (sup(sid)||{}).fpId); iFo.disabled=ro; iFo.dataset.k="fpo|"+o._id;
  h.append(fld("Nº pedido",null,iRef), fld("Fecha pedido","Base de los adelantos",iFp), fld("CRD","Fin de producción",dIn("crd")), fld("ETD","Embarque",dIn("etd")), fld("ETA","Llegada a puerto",dIn("eta")), fld("Naviera",null,iNav), fld("Tamaño",null,iSz), fld("Importe total",`${fmt(totU)||0} uds`,tot), fld("Forma de pago",null,iFo));
  cd.append(h);
  if(o.mod){
    const mb=el("div","modbar"); const t=el("span"); t.append(el("b",null,"Modificación pendiente de validar por el proveedor"),` desde el ${dLong(parseKey(o.mod.at))}. Importe ${fmtE2(total(o,true))} pasa a ${fmtE2(total(o))}.`); mb.append(t);
    const acts=el("div","acts"); const r1=el("button","btn danger small","No confirmada: volver a la anterior"); r1.disabled=ro; r1.addEventListener("click",()=>rejectMod(o));
    const r2=el("button","btn ok small","Confirmada: guardar nueva versión"); r2.disabled=ro; r2.addEventListener("click",()=>openVer(o)); acts.append(r1,r2); mb.append(acts); cd.append(mb);
  }
  const m=el("div","cmeta"); const [stx,scl]=orderState(o,sid); m.append(el("span","tag "+scl,stx));
  const mi=(t,v)=>{const s=el("span"); s.append(t+" ",el("b",null,v)); return s;};
  m.append(mi("Entrada en almacén",`${wLabel(d.entryW)}, ${dLong(d.entryW)}`));
  const pg=el("span","ptramos"); pg.append("Pagos: ");
  d.pagos.forEach((t,i)=>{ const pd=(o.pagos||{})[i]||o.pagado; const x=el("b",pd?"pagado":t.date<utcToday?"vencido":""); x.textContent=`${t.pct}% ${fmtE2(total(o)*t.pct/100)} el ${dLong(t.date)}${t.est?" (est.)":""}${pd?" · pagado":""}`; x.title=tramoTxt(t); pg.append(x); if(i<d.pagos.length-1) pg.append(" · "); });
  m.append(pg);
  if(o.crd&&o.etd&&o.crd>o.etd) m.append(el("span","tag bad","El CRD es posterior a la ETD"));
  if(o.etd&&o.etd>o.eta) m.append(el("span","tag bad","La ETD es posterior a la ETA"));
  const tg=el("button","btn push",open?"Ocultar productos":`Ver productos (${Object.keys(effLines(o)).length})`); tg.setAttribute("aria-expanded",String(open)); tg.addEventListener("click",()=>{open?state.expanded.delete(o._id):state.expanded.add(o._id); render();}); m.append(tg);
  const nh=(o.history||[]).length;
  if(nh){const hb=el("button","btn",hopen?"Ocultar historial":`Historial (${nh} ${nh===1?"versión anterior":"versiones anteriores"})`); hb.addEventListener("click",()=>{hopen?state.histOpen.delete(o._id):state.histOpen.add(o._id); render();}); m.append(hb);}
  const del=el("button","btn danger","Eliminar pedido"); del.disabled=ro; del.addEventListener("click",()=>{if(confirm(`¿Eliminar el pedido ${o.ref} y todas sus líneas?`)) delOrder(o);}); m.append(del);
  cd.append(m);
  cd.append(notas(o,"Notas del pedido: incidencias, acuerdos con el proveedor, documentación…"));
  if(open){
    cd.append(linesTable(o,true));
    if(!ro){const al=el("div","addline"); const s=el("select"); s.setAttribute("aria-label","Artículo a añadir"); const o0=el("option",null,"Añadir artículo…"); o0.value=""; s.append(o0);
      for(const p of prodsOf(sid)) if(!effLines(o)[p.code]&&!p.extinguir){const op=el("option",null,`${p.name} (${dispCode(p)})`); op.value=p.code; s.append(op);}
      const qi=el("input"); qi.placeholder="Uds"; qi.inputMode="numeric"; qi.setAttribute("aria-label","Unidades");
      const bt=el("button","btn","Añadir"); bt.addEventListener("click",()=>{const code=s.value, v=num(qi.value), p=prod(code); if(!code){toast("Elige un artículo"); return;}
        if(isNaN(v)||v<=0||!Number.isInteger(v)){toast("Introduce un número entero de unidades."); return;} const pal=p.pallet>=1?p.pallet:1; if(v%pal){toast(`Aviso: ${v} no es múltiplo de ${pal} uds por pallet. Se guarda igualmente.`);}
        const n=changeLines(o,(L,P,oo)=>setLine(L,P,oo,code,v)); saveOrder(n); afterMod(n,o.ref);});
      al.append(s,qi,bt); cd.append(al);}
  }
  if(hopen&&nh){
    const hs=el("div","hist");
    const vers=[...o.history].map((v,i)=>({v,i})).reverse();
    for(const {v,i} of vers){const h3=el("h3",null,v.ref); h3.append(el("small",null,`${i===0?"Versión inicial":"Versión "+(i+1)}. Sustituida el ${dLong(parseKey(v.replacedAt))}. ETA ${v.eta?dLong(parseKey(v.eta)):"sin fecha"}`)); hs.append(h3, linesTable({lines:v.lines,prices:v.prices,_id:o._id+"-h"+i,status:"hist"},false));}
    cd.append(hs);
  }
  return cd;
}

function renderPlanMenu(app){
  document.title="Planificador de compras";
  const h=el("header","top pad hero"); const b=el("div","brand marca"); const lg=el("a"); lg.href="#"; lg.append(logo("logo-hero")); b.append(lg, el("span","lema","planificador de compras")); h.append(b,whoChip()); app.append(h);
  const sub=el("div","pad"); const bk=el("a","back","‹ Operaciones"); bk.href="#operaciones"; sub.append(bk, el("p","secsub","Elige qué quieres hacer.")); app.append(sub);
  const g=el("div","modules pad");
  if(perm("compras")!=="ninguno"){const a=el("a","mod-card"); a.href="#proveedores"; a.append(el("h2",null,"Planificador de compras"),el("p",null,"Revisión de artículos para compras y pedidos lanzados, por proveedor."));
    const t=el("div","stats"); let br=0,pe=0; for(const s of state.suppliers){const st=supStats(s._id); br+=st.brk; pe+=st.pend;} if(br) t.append(el("span","tag bad",`${br} artículos con rotura`)); if(pe) t.append(el("span","tag pend",`${pe} entradas sin pedido`)); a.append(t); g.append(a);}
  if(perm("pagos")!=="ninguno"){const a=el("a","mod-card pay"); a.href="#pagos"; a.append(el("h2",null,"Previsión pagos importaciones"),el("p",null,"Calendario de pagos de contenedores a partir de las fechas de embarque y los importes de los pedidos."));
    const rows=payRows(), t=el("div","stats"); const nx=sumMon(rows.filter(r=>!r.paid&&r.date<addW(today,4))); t.append(el("span","tag neutral",`${isZero(nx)?"Nada":fmtAny0(nx)} en las próximas 4 semanas`)); const ov=rows.filter(r=>r.late).length; if(ov) t.append(el("span","tag bad",`${ov} vencidos`)); a.append(t); g.append(a);}
  if(perm("compras")!=="ninguno"){const a=el("a","mod-card stk"); a.href="#stock"; a.append(el("h2",null,"Evolución del stock"),el("p",null,"Stock de seguridad y stock previsto semana a semana por proveedor y artículo, a partir de la planificación de importaciones."));
    const t=el("div","stats"); let neg=0; for(const s of state.suppliers){ for(const p of prodsOf(s._id)){ if(p.extinguir) continue; const r=calc(p,s._id); if(r.net.slice(0,12).some(v=>v<-1e-9)) neg++; } } if(neg) t.append(el("span","tag bad",`${neg} artículos en rotura en 12 semanas`)); a.append(t); g.append(a);}
  for(const card of [...g.querySelectorAll("a.mod-card")]){ const h=card.getAttribute("href"); conImagen(card, h==="#pagos"?"pagos":h==="#stock"?"stock":"proveedores"); }
  app.append(g);
}

function payRows(){
  const rows=[];
  for(const o of state.orders){
    const s=sup(o.supplier); if(!s) continue; const c=cfg(o.supplier), d=od(o,o.supplier), n=d.pagos.length;
    if(isPend(o)){ if(!Object.keys(o.lines||{}).length) continue;
      for(const t of d.pagos) rows.push({mon:c.moneda||"EUR",o,sid:o.supplier,supName:s.name,ref:"Sin pedido (entrada "+wLabel(d.entryW)+")",tramo:n>1?tramoTxt(t):"",ti:t.i,est:true,etdReal:false,etd:d.etd,date:t.date,amount:total(o)*t.pct/100,paid:false,late:false,mod:false});
      continue;}
    for(const t of d.pagos){
      const paidAt=(o.pagos||{})[t.i]||o.pagado||"", paid=!!paidAt;
      if(orderState(o,o.supplier)[0]==="En almacén"&&!paid&&t.date<addW(today,-26)) continue;
      rows.push({mon:c.moneda||"EUR",o,sid:o.supplier,supName:s.name,ref:o.ref,tramo:n>1?tramoTxt(t):"",ti:t.i,n,est:false,etdReal:!t.est,etd:d.etd,date:t.date,amount:total(o)*t.pct/100,modAmount:o.mod?total(o,true)*t.pct/100:null,paid,paidAt,late:!paid&&t.date<utcToday,mod:!!o.mod});
    }
  }
  return rows.sort((a,b)=>a.date-b.date);
}
function marcarPago(r){
  const n=clone(r.o); n.pagos=Object.assign({},n.pagos||{});
  if(n.pagado){ for(let i=0;i<(r.n||1);i++) if(!n.pagos[i]) n.pagos[i]=n.pagado; delete n.pagado; }
  if(r.paid) delete n.pagos[r.ti]; else n.pagos[r.ti]=key(utcToday);
  saveOrder(n); toast(r.paid?`${r.ref}: pago deshecho`:`${r.ref}${r.tramo?" ("+r.tramo+")":""}: marcado como pagado`);
}
function payVisible(){const f=state.payFilter; return payRows().filter(r=>(!f.sup||r.sid===f.sup)&&(f.pend||!r.est)&&(f.paid||!r.paid));}
function monthKey(d){return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");}
function monthLabel(k){const [y,m]=k.split("-").map(Number); return new Date(Date.UTC(y,m-1,1)).toLocaleDateString("es-ES",{month:"long",year:"numeric",timeZone:"UTC"});}
function renderPagos(app){
  document.title="Previsión pagos importaciones";
  const h=el("header","top pad"); const b=el("div","brand"); const bk=el("a","back","‹ Planificador de compras"); bk.href="#planificador"; b.append(bk,el("h1",null,"Previsión pagos importaciones"),el("p",null,"Fechas de pago según la forma de pago de cada proveedor (o la del pedido): adelantos en la fecha del pedido, pagos a la carga en la ETD y el resto respecto a la ETA.")); h.append(b,whoChip()); app.append(h);
  const box=el("div","pad"); const f=state.payFilter;
  const tb=el("div","toolbar"); tb.style.paddingTop="0";
  const sl=el("select"); sl.setAttribute("aria-label","Proveedor"); const o0=el("option",null,"Todos los proveedores"); o0.value=""; sl.append(o0);
  for(const s of [...state.suppliers].sort((a,b)=>(a.sort||0)-(b.sort||0))){if(!state.orders.some(o=>o.supplier===s._id)) continue; const op=el("option",null,s.name); op.value=s._id; sl.append(op);} sl.value=f.sup; sl.addEventListener("change",()=>{f.sup=sl.value; render();});
  sl.style.cssText="border:1px solid var(--line);border-radius:6px;padding:6px 10px;background:var(--surface)";
  const l1=el("label"); const c1=el("input"); c1.type="checkbox"; c1.checked=f.pend; c1.addEventListener("change",()=>{f.pend=c1.checked; render();}); l1.append(c1," Incluir entradas aún sin pedido (estimado)");
  const l2=el("label"); const c2=el("input"); c2.type="checkbox"; c2.checked=f.paid; c2.addEventListener("change",()=>{f.paid=c2.checked; render();}); l2.append(c2," Mostrar pagados");
  const eb=exportBtn(exportPagos); eb.style.marginLeft="auto"; tb.append(sl,l1,l2,eb); box.append(tb);
  const rows=payVisible(), open=rows.filter(r=>!r.paid);
  const sum=(arr)=>sumMon(arr);
  const k=el("div","kpis");
  const kp=(l,v,cl)=>{const d=el("div","kpi"+(cl?" "+cl:"")); d.append(el("small",null,l),el("b",null,v)); return d;};
  const endM=new Date(Date.UTC(utcToday.getUTCFullYear(),utcToday.getUTCMonth()+1,1));
  k.append(kp("Vencido sin pagar",fmtAny0(sum(open.filter(r=>r.late))),open.some(r=>r.late)?"bad":""), kp("Próximas 4 semanas",fmtAny0(sum(open.filter(r=>!r.late&&r.date<addW(today,4))))), kp("Resto de este mes",fmtAny0(sum(open.filter(r=>!r.late&&r.date<endM)))), kp("Próximos 3 meses",fmtAny0(sum(open.filter(r=>r.date<addD(utcToday,92))))), kp("Total pendiente de pago",fmtAny0(sum(open))));
  box.append(k);
  // Resumen mensual por proveedor
  const months=[...new Set(open.map(r=>monthKey(r.date)))].sort().slice(0,8);
  if(months.length){
    box.append(el("h2","sec","Resumen mensual"));
    const tw=el("div","tblwrap"); tw.style.marginTop="8px"; const t=el("table","tbl"); const hr=el("tr"); hr.append(el("th",null,"Proveedor")); for(const m of months) hr.append(el("th","n",monthLabel(m))); hr.append(el("th","n","Total")); const th=el("thead"); th.append(hr); t.append(th);
    const tbd=el("tbody"); const sups=[...new Set(open.map(r=>r.supName))];
    const tot=months.map(()=>({}));
    for(const sn of sups){const tr=el("tr"); tr.append(el("td",null,sn)); let s2={}; months.forEach((m,i)=>{const v=sum(open.filter(r=>r.supName===sn&&monthKey(r.date)===m)); addMon(tot[i],v); addMon(s2,v); tr.append(el("td","n",isZero(v)?"":fmtAny0(v)));}); tr.append(el("td","n",fmtAny0(s2))); tbd.append(tr);}
    const ft=el("tr","wk"); ft.append(el("td",null,"Total")); tot.forEach(v=>ft.append(el("td","n",fmtAny0(v)))); ft.append(el("td","n",fmtAny0(tot.reduce((a,b)=>addMon(a,b),{})))); tbd.append(ft);
    t.append(tbd); tw.append(t); box.append(tw);
  }
  box.append(el("h2","sec","Calendario de pagos"));
  const tw=el("div","tblwrap"); tw.style.marginTop="8px"; const t=el("table","tbl");
  const th=el("thead"), hr=el("tr"); for(const [x,c] of [["Fecha de pago",""],["Proveedor",""],["Pedido",""],["ETD",""],["Situación",""],["Importe","n"],["",""]]) hr.append(el("th",c,x)); th.append(hr); t.append(th);
  const tbd=el("tbody");
  if(!rows.length){const tr=el("tr"),td=el("td","empty"); td.colSpan=7; td.textContent="No hay pagos previstos con estos filtros."; tr.append(td); tbd.append(tr);}
  let cur=null, wsum={}, wrow=null;
  const closeW=()=>{if(wrow) wrow.lastChild.previousSibling.textContent=fmtAny2(wsum);};
  for(const r of rows){
    const wk=key(mondayU(r.date));
    if(wk!==cur){closeW(); cur=wk; wsum={}; wrow=el("tr","wk"); const td=el("td",null,`Semana ${wLabel(parseKey(wk))}, del ${dLong(parseKey(wk))}`); td.colSpan=5; wrow.append(td,el("td","n",""),el("td")); tbd.append(wrow);}
    if(!r.paid) addMon(wsum,{[r.mon]:r.amount});
    const tr=el("tr",(r.late?"late":r.paid?"paid":r.est?"est":""));
    const sit=r.paid?`Pagado el ${dLong(parseKey(r.paidAt))}`:r.late?"Vencido":r.est?"Estimado: entrada sin pedido":(r.etdReal?"Fecha confirmada":"Fecha estimada");
    const st=el("td",null,sit); if(r.mod) st.append(el("span","tag mod",` Incluye modificación por validar. Confirmado: ${fmtM(r.modAmount,r.mon,2)}`));
    const rc=el("td",null,r.ref); if(r.tramo) rc.append(el("small","tramo",r.tramo));
    tr.append(el("td",null,dLong(r.date)), el("td",null,r.supName), rc, el("td",null,dLong(r.etd)+(r.o.etd?"":" (est.)")), st, el("td","n",fmtM(r.amount,r.mon,2)));
    const ac=el("td");
    if(!r.est&&state.canWrite){const bt=el("button","btn small "+(r.paid?"":"ok"),r.paid?"Deshacer pago":"Marcar pagado"); bt.addEventListener("click",()=>marcarPago(r)); ac.append(bt);}
    tr.append(ac); tbd.append(tr);
  }
  closeW();
  t.append(tbd); tw.append(t); box.append(tw);
  box.append(el("p","secsub","Cada pedido se divide en los tramos de su forma de pago. La forma de pago se elige en la cabecera de cada proveedor y se puede cambiar en un pedido concreto."));
  app.append(box);
}
function exportPagos(){
  const wb=XLSX.utils.book_new(), rows=payVisible();
  const A=[["Fecha de pago","Semana","Proveedor","Pedido","Tramo","ETD","Fecha confirmada","Situación","Moneda","Importe previsto","Importe confirmado (si hay modificación por validar)","Pagado el"]];
  for(const r of rows) A.push([xDate(r.date),wLabel(r.date),r.supName,r.ref,r.tramo||"Pago único",xDate(r.etd),r.etdReal?"Sí":"No",r.paid?"Pagado":r.late?"Vencido":r.est?"Estimado sin pedido":"Previsto",r.mon,Math.round(r.amount*100)/100,r.modAmount!=null?Math.round(r.modAmount*100)/100:"",r.paidAt?xDate(parseKey(r.paidAt)):""]);
  XLSX.utils.book_append_sheet(wb,sheet(A,[14,9,24,26,12,15,20,14,30,12]),"Calendario de pagos");
  const open=rows.filter(r=>!r.paid), months=[...new Set(open.map(r=>monthKey(r.date)))].sort(), sups=[...new Set(open.map(r=>r.supName))];
  const M=[["Proveedor","Moneda",...months.map(monthLabel),"Total"]];
  for(const sn of sups){const vals=months.map(m=>Math.round(open.filter(r=>r.supName===sn&&monthKey(r.date)===m).reduce((a,r)=>a+r.amount,0)*100)/100); M.push([sn,(open.find(r=>r.supName===sn)||{}).mon||"",...vals,vals.reduce((a,b)=>a+b,0)]);}
  XLSX.utils.book_append_sheet(wb,sheet(M,[24,...months.map(()=>16),14]),"Resumen mensual");
  saveXlsx(wb,`Prevision_pagos_importaciones_${stamp()}.xlsx`);
}


function exportHome(){
  const wb=XLSX.utils.book_new();
  const rows=[["Proveedor","Familia","Contacto","Correo","Artículos","Con rotura","Bajo seguridad","Datos incompletos","Entradas sin pedido","Modificaciones por validar","Pedidos en curso"]];
  for(const s of state.suppliers){const st=supStats(s._id); rows.push([s.name,s.familia||"",s.contacto||"",s.email||"",st.n,st.brk,st.und,st.inc,st.pend,st.mods,st.live]);}
  XLSX.utils.book_append_sheet(wb,sheet(rows,[26,22,18,30,10,10,13,15,17,22,15]),"Proveedores");
  saveXlsx(wb,`Proveedores_${stamp()}.xlsx`);
}
function exportArticles(sid){
  const s=sup(sid), c=cfg(sid), W=weeks(sid), wb=XLSX.utils.book_new(), vis=visibleProducts(sid);
  const head=["Código","Descripción","Concepto",...W.map(d=>`${wLabel(d)} ${dShort(d)}`)];
  const rows=[head]; const TONE={conf:"Confirmada",pnd:"Pendiente de pedido",mod:"Modificación por validar"};
  for(const {p,r} of vis){
    for(const [k,label,opt] of rowsFor(c)){
      if(state.filters.hide.has(k)) continue;
      const arr={dem:r.dem,entry:r.entry,man:r.man,ped:r.ped,carga:r.carga,real:r.real,res:r.res,over:r.over}[k].map(v=>Math.round(v*100)/100);
      rows.push([dispCode(p),p.name,label+(k==="entry"?` (ETA + ${c.despacho} sem)`:""),...arr.map(v=>(["entry","man","ped","carga","res"].includes(k)&&!v)?"":v)]);
      if(k==="entry") rows.push([dispCode(p),p.name,"Situación de la entrada",...r.tone.map(t=>TONE[t]||"")]);
    }
  }
  XLSX.utils.book_append_sheet(wb,sheet(rows,[16,26,30,...W.map(()=>10)]),"Revisión semanal");
  const a=[["Código","Descripción","Modelo","Stock actual","Venta media semanal","Stock de seguridad","Uds por pallet","Precio proveedor","Sugerencia","Avisos","Datos que faltan"]];
  for(const {p,r} of vis){const sg=r.sug?(r.sug.late?`Vas tarde: bajo seguridad en ${wLabel(r.sug.week)}. Pide ya ${r.sug.qty} uds`:`Lanzar en ${wLabel(r.sug.launch)}: ${r.sug.qty} uds`):(r.miss.length?"":"Cubierto todo el horizonte");
    a.push([dispCode(p),p.name,p.model||"",p.stock??"",p.avg??"",p.ss??"",p.pallet??"",p.price??"",sg,r.warnings.join(". "),r.miss.join(", ")]);}
  XLSX.utils.book_append_sheet(wb,sheet(a,[16,26,12,12,18,16,13,15,40,50,30]),"Artículos");
  const pr=[["Parámetro","Valor"],["Pedido a puerto (sem)",c.plazo],["Tránsito (sem)",c.transito],["Despacho (sem)",c.despacho],["Forma de pago",formaSup(sid).nombre],["Cobertura por pedido (sem)",c.cobertura],["Fecha de exportación",xDate(utcToday)]];
  XLSX.utils.book_append_sheet(wb,sheet(pr,[30,14]),"Parámetros");
  saveXlsx(wb,`Revision_articulos_${safe(s.name)}_${stamp()}.xlsx`);
}
function exportOrders(sid){
  const s=sup(sid), wb=XLSX.utils.book_new(), {pend,done,live}=filteredGroups(sid), shown=[...live,...(state.showDone||ordF(sid).peds.length?done:[])];
  const P=[["Nº pedido","Estado","CRD","ETD","ETA","Entrada en almacén","Semana entrada","Naviera","Tamaño","Uds","Importe total","Fecha pedido","Forma de pago","Pagos previstos","Modificación pendiente","Comentarios","Importe versión confirmada"]];
  for(const o of shown){const d=od(o,sid); P.push([o.ref,orderState(o,sid)[0],o.crd?xDate(parseKey(o.crd)):"",o.etd?xDate(parseKey(o.etd)):"",xDate(d.eta),xDate(d.entryW),wLabel(d.entryW),o.naviera||"",sizeLabel(o.tamano),Object.values(effLines(o)).reduce((a,b)=>a+b,0),Math.round(total(o)*100)/100,o.fechaPedido?xDate(parseKey(o.fechaPedido)):"",d.forma.nombre,d.pagos.map(t=>`${t.pct}% ${dShort(t.date)}`).join(" · "),o.mod?"Sí":"No",o.comentarios||"",Math.round(total(o,true)*100)/100]);}
  XLSX.utils.book_append_sheet(wb,sheet(P,[16,22,12,12,12,16,14,14,18,8,14,14,20,22]),"Pedidos");
  const L=[["Nº pedido","Referencia","Descripción","Cantidad","Precio unitario","Importe línea","Situación","Cantidad confirmada","Precio confirmado"]];
  for(const o of shown){const E=effLines(o), B=o.lines||{}; for(const code of new Set([...Object.keys(E),...Object.keys(B)])){const q=E[code]||0, bq=B[code]||0, up=lp(o,code), bp=lp(o,code,true); const ch=o.mod&&(q!==bq||Math.abs(up-bp)>1e-9);
    L.push([o.ref,dispCode(prod(code)||{code}),(prod(code)||{name:code}).name,q,up,Math.round(q*up*100)/100,ch?(q?"Modificación por validar":"Se elimina (por validar)"):"Confirmada",bq,bp]);}}
  XLSX.utils.book_append_sheet(wb,sheet(L,[16,16,28,10,14,14,24,18,18]),"Líneas");
  const N=[["Semana entrada","ETA (semana)","Pedir en","Referencia","Descripción","Cantidad","Precio de ficha","Importe"]];
  for(const o of pend){const d=od(o,sid); for(const [code,q] of Object.entries(o.lines||{})){const pp=(prod(code)||{}).price||0; N.push([wLabel(d.entryW),wLabel(d.etaW),wLabel(d.pedidoW),dispCode(prod(code)||{code}),(prod(code)||{name:code}).name,q,pp,q*pp]);}}
  XLSX.utils.book_append_sheet(wb,sheet(N,[14,12,10,16,28,10,14,12]),"Pendientes de pedido");
  const H=[["Pedido actual","Versión","Nº pedido de esa versión","Sustituida el","Referencia","Descripción","Cantidad","Precio unitario","Importe línea"]];
  for(const o of shown) (o.history||[]).forEach((v,i)=>{for(const [code,q] of Object.entries(v.lines||{})){const up=(v.prices||{})[code]??((prod(code)||{}).price||0); H.push([o.ref,i===0?"Versión inicial":`Versión ${i+1}`,v.ref,xDate(parseKey(v.replacedAt)),dispCode(prod(code)||{code}),(prod(code)||{name:code}).name,q,up,Math.round(q*up*100)/100]);}});
  XLSX.utils.book_append_sheet(wb,sheet(H,[16,16,22,14,16,28,10,14,14]),"Historial");
  saveXlsx(wb,`Pedidos_${safe(s.name)}_${stamp()}.xlsx`);
}

document.addEventListener("click",()=>{if(state.dd){state.dd=null; render();}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&state.dd){state.dd=null; render();}});
/* ===== Datos: lectura y escritura en Supabase ===== */
const S = { loaded:false, loading:false, idMap:{} };
const chk = r => { if (r && r.error) throw r.error; return r; };
async function cargar(){
  S.loading = true;
  try{
    const [pv, ap, pr, pe, st, fpg, nav, em] = await Promise.all([
      sb.schema("maestros").from("proveedores").select("id,codigo_ax,nombre,nombre_corto,alias,moneda,grupo_compra,es_importacion,contacto,email,plazo_semanas,transito_semanas,despacho_semanas,forma_pago_id,cobertura_semanas"),
      sb.schema("maestros").from("articulo_proveedor").select("id,articulo_id,proveedor_id,precio,moneda,uds_pallet,orden,ref_proveedor,clave_stock,a_extinguir,venta_media_semanal,stock_seguridad,stock_manual,descripcion,modelo,articulos(id,codigo_ax,descripcion,modelo,estado)").eq("planificar", true).range(0, 4999),
      sb.schema("compras").from("prevision_venta").select("articulo_proveedor_id,semana,unidades").gte("semana", key(today)).range(0, 9999),
      sb.schema("compras").from("pedidos").select("*").order("eta"),
      sb.schema("ax").from("v_stock_actual").select("clave,disponible_real,disponible,fecha_stock,fichero").range(0, 9999),
      sb.schema("compras").from("formas_pago").select("id,nombre,tramos,orden,activa").order("orden").order("id"),
      sb.schema("compras").from("navieras").select("id,nombre,contacto,telefono,email").order("nombre"),
      sb.schema("compras").from("entradas_manuales").select("id,articulo_proveedor_id,semana,cantidad,motivo,comentario").gte("semana", key(addW(today,-1))).range(0, 9999),
    ]);
    for (const r of [pv, ap, pr, pe, st, em, fpg]) chk(r);
    state.navieras = nav.error ? null : nav.data;   // null = tabla aún no creada (migración 33): se usa texto libre
    state.formas = fpg.data.filter(f => f.activa !== false).map(f => ({ id:f.id, nombre:f.nombre, tramos:(f.tramos || []).map(t => ({ pct:+t.pct, ref:t.ref, dias:+t.dias || 0 })), orden:f.orden }));
    const man = {}; for (const e of em.data){ (man[e.articulo_proveedor_id] = man[e.articulo_proveedor_id] || {})[e.semana] = { id:e.id, cantidad:+e.cantidad, motivo:e.motivo, comentario:e.comentario || "" }; }
    const ov = {}; for (const r of pr.data){ (ov[r.articulo_proveedor_id] = ov[r.articulo_proveedor_id] || {})[r.semana] = +r.unidades; }
    const stock = new Map(st.data.map(x => [x.clave, x]));
    S.stockInfo = st.data[0] ? { fecha: st.data[0].fecha_stock, fichero: st.data[0].fichero, n: st.data.length } : null;
    const conProd = new Set(ap.data.map(a => a.proveedor_id));
    state.suppliers = pv.data.filter(p => conProd.has(p.id) || p.es_importacion).map(p => ({
      _id:"prov-"+p.id, dbId:p.id, codigo_ax:p.codigo_ax, name:p.nombre_corto || p.nombre.replace(/@+$/,""), razon:p.nombre.replace(/@+$/,""), alias:p.alias, familia:p.grupo_compra || "", contacto:p.contacto || "", email:p.email || "",
      moneda:p.moneda || "EUR", plazo:p.plazo_semanas ?? 12, transito:p.transito_semanas ?? 5, despacho:p.despacho_semanas ?? 1,
      fpId:p.forma_pago_id || null, cobertura:p.cobertura_semanas ?? 8, horizonte:52, sort: conProd.has(p.id) ? 0 : 1 }));
    state.products = ap.data.filter(a => a.articulos).map(a => { const sx = a.clave_stock ? stock.get(a.clave_stock) : null; return {
      _id:"ap-"+a.id, apId:a.id, artId:a.articulos.id, code:String(a.id), codigo_ax:a.articulos.codigo_ax, estado:a.articulos.estado, clave:a.clave_stock || "",
      name:a.descripcion || a.articulos.descripcion, model:a.modelo || a.articulos.modelo || "", avg:num0(a.venta_media_semanal), ss:num0(a.stock_seguridad),
      stockAX: !!sx, stock: sx ? +sx.disponible_real : num0(a.stock_manual), stockReal: sx ? +sx.disponible : num0(a.stock_manual), stockManual:num0(a.stock_manual), stockFecha: sx ? sx.fecha_stock : null, stockFichero: sx ? sx.fichero : null,
      extinguir: !!a.a_extinguir, refProv:a.ref_proveedor || "", pallet:a.uds_pallet, price:num0(a.precio), supplier:"prov-"+a.proveedor_id, sort:a.orden ?? 999, overrides: ov[a.id] || {}, manual: man[a.id] || {} }; });
    state.orders = pe.data.map(fromRow);
    state.loaded.s = true; S.loaded = true;
  } catch(e){ console.error(e); toast("No se han podido cargar los datos del planificador."); S.loaded = true; }
  S.loading = false; render();
}
const num0 = v => v == null ? null : +v;
function fromRow(r){
  return { _id:"ped-"+r.id, dbId:r.id, supplier:"prov-"+r.proveedor_id, status:r.estado, ref:r.referencia || "", crd:r.crd || "", etd:r.etd || "", eta:r.eta,
    naviera:r.naviera || "", tamano:r.tamano || "", comentarios:r.comentarios || "", lines:r.lineas || {}, prices:r.precios || {}, mod:r.modificacion || undefined, history:r.historial || [], pagado:r.pagado_en || undefined,
    fechaPedido:r.fecha_pedido || "", fp:r.forma_pago_id || null, pagos:r.pagos || {} };
}
function toRow(o){
  return { proveedor_id:sup(o.supplier).dbId, estado:o.status, referencia:o.ref || null, crd:o.crd || null, etd:o.etd || null, eta:o.eta,
    naviera:o.naviera || null, tamano:o.tamano || null, comentarios:o.comentarios || null, lineas:o.lines || {}, precios:o.prices || {}, modificacion:o.mod || null, historial:o.history || [], pagado_en:o.pagado || null,
    fecha_pedido:o.fechaPedido || null, forma_pago_id:o.fp || null, pagos:o.pagos || {} };
}
const queues = {};
function enqueue(k, fn){ const p = (queues[k] || Promise.resolve()).then(fn).then(() => true).catch(e => { console.error(e); toast(msgErr(e)); cargar(); return false; }); queues[k] = p; return p; }
function msgErr(e){ const m = (e && (e.message || "")) || ""; if ((e && e.code === "42501") || /row-level security|permission/i.test(m)) return "No tienes permiso para guardar este cambio.";
  if (e && e.code === "23505") return "Ya existe un registro con ese número o código."; return "No se ha podido guardar. Revisa la conexión y vuelve a intentarlo."; }
function saveSup(sid, patch){
  const s = Object.assign({}, sup(sid), patch); const i = state.suppliers.findIndex(x => x._id === sid); state.suppliers[i] = s; render();
  const M = { plazo:"plazo_semanas", transito:"transito_semanas", despacho:"despacho_semanas", fpId:"forma_pago_id", cobertura:"cobertura_semanas" };
  const row = {}; for (const k of Object.keys(patch)) if (M[k]) row[M[k]] = patch[k];
  return enqueue(sid, async () => chk(await sb.schema("maestros").from("proveedores").update(row).eq("id", s.dbId)));
}
function saveProduct(p){
  const old = state.products.find(x => x._id === p._id) || {}; const i = state.products.findIndex(x => x._id === p._id);
  if (i >= 0) state.products[i] = p; render();
  return enqueue(p._id, async () => {
    const a = {}; if (old.codigo_ax !== p.codigo_ax) a.codigo_ax = p.codigo_ax || null; if (old.estado !== p.estado) a.estado = p.estado;
    if (Object.keys(a).length) chk(await sb.schema("maestros").from("articulos").update(a).eq("id", p.artId));
    const b = {}, F = { avg:"venta_media_semanal", ss:"stock_seguridad", pallet:"uds_pallet", name:"descripcion", model:"modelo", clave:"clave_stock", extinguir:"a_extinguir", stockManual:"stock_manual" };
    for (const [k,c] of Object.entries(F)) if (old[k] !== p[k]) b[c] = p[k] === "" ? null : p[k];
    if (old.price !== p.price){ b.precio = p.price; b.precio_origen = "manual"; }
    if (Object.keys(b).length) chk(await sb.schema("maestros").from("articulo_proveedor").update(b).eq("id", p.apId));
    const o0 = old.overrides || {}, o1 = p.overrides || {};
    const ups = Object.keys(o1).filter(k => o1[k] !== o0[k]), dels = Object.keys(o0).filter(k => !(k in o1));
    if (ups.length) chk(await sb.schema("compras").from("prevision_venta").upsert(ups.map(k => ({ articulo_proveedor_id:p.apId, semana:k, unidades:o1[k] })), { onConflict:"articulo_proveedor_id,semana" }));
    if (dels.length) chk(await sb.schema("compras").from("prevision_venta").delete().eq("articulo_proveedor_id", p.apId).in("semana", dels));
    if (b.clave_stock !== undefined) await cargar();
  });
}
function saveOrder(o){
  const i = state.orders.findIndex(x => x._id === o._id); if (i >= 0) state.orders[i] = o; else state.orders.push(o); render();
  return enqueue(o._id, async () => {
    const id = o.dbId || S.idMap[o._id];
    if (id) chk(await sb.schema("compras").from("pedidos").update(toRow(o)).eq("id", id));
    else { const r = chk(await sb.schema("compras").from("pedidos").insert(toRow(o)).select("id").single()); S.idMap[o._id] = r.data.id; for (const x of state.orders) if (x._id === o._id) x.dbId = r.data.id; }
  });
}
function delOrder(o){
  state.orders = state.orders.filter(x => x._id !== o._id); render();
  return enqueue(o._id, async () => { const id = o.dbId || S.idMap[o._id]; if (id) chk(await sb.schema("compras").from("pedidos").delete().eq("id", id)); });
}

/* ===== Notas (pedidos y entradas aún sin pedido) ===== */
function notas(o, ph){
  const cw=el("div","comments"); const cl=el("label",null,"Notas"); const ta=el("textarea"); ta.rows=2; ta.value=o.comentarios||""; ta.disabled=!state.canWrite; ta.dataset.k="com|"+o._id;
  ta.placeholder=state.canWrite?ph:"Sin notas"; ta.id="com-"+o._id; cl.htmlFor=ta.id;
  ta.addEventListener("change",()=>{const v=ta.value.trim(); if(v!==(o.comentarios||"")){saveOrder(Object.assign(clone(o),{comentarios:v})); toast("Nota guardada");}});
  cw.append(cl,ta); return cw;
}
/* ===== Menú de filas visibles en la revisión de artículos ===== */
function filasMenu(c){
  const rows=rowsFor(c), hide=state.filters.hide, vis=rows.filter(([k])=>!hide.has(k)).length;
  const d=el("details","rowsdd"); if(state.rowsOpen) d.open=true; d.addEventListener("toggle",()=>{state.rowsOpen=d.open;});
  const sm=el("summary",null,`Filas visibles: ${vis} de ${rows.length}`); d.append(sm);
  const pn=el("div","rowsp");
  for(const [k,label] of rows){ const l=el("label"); const cb=el("input"); cb.type="checkbox"; cb.checked=!hide.has(k);
    cb.addEventListener("change",()=>{ if(!cb.checked&&rows.filter(([x])=>!hide.has(x)).length<=1){cb.checked=true; toast("Deja al menos una fila visible"); return;} cb.checked?hide.delete(k):hide.add(k); render(); });
    l.append(cb," "+label); pn.append(l); }
  const ac=el("div","rowsa"); const all=el("button","btn small","Todas"); all.type="button"; all.addEventListener("click",()=>{hide.clear(); render();});
  const ess=el("button","btn small","Solo las principales"); ess.type="button"; ess.title="Venta prevista, entradas en almacén y stock disponible"; ess.addEventListener("click",()=>{hide.clear(); for(const [k] of rows) if(!["dem","entry","man","real"].includes(k)) hide.add(k); render();});
  ac.append(all,ess); pn.append(ac); d.append(pn); return d;
}
/* ===== Navieras: desplegable y tabla ===== */
function selNaviera(o, ro){
  if(!state.navieras){ const i=el("input"); i.value=o.naviera||""; i.setAttribute("list","navieras"); i.disabled=ro; i.dataset.k="nav|"+o._id; i.addEventListener("change",()=>saveOrder(Object.assign(clone(o),{naviera:i.value.trim()}))); return i; }
  const s=el("select","navsel"); s.disabled=ro; s.dataset.k="nav|"+o._id; s.setAttribute("aria-label","Naviera");
  const add=(v,l)=>{const op=el("option",null,l); op.value=v; s.append(op);};
  add("","— Sin naviera —");
  const nombres=state.navieras.map(n=>n.nombre);
  if(o.naviera&&!nombres.some(n=>n.toLowerCase()===o.naviera.toLowerCase())) add(o.naviera,o.naviera+" (no está en la tabla)");
  for(const n of state.navieras) add(n.nombre,n.nombre);
  add("__tabla",state.canWrite?"＋ Gestionar navieras…":"Ver la tabla de navieras…");
  const cur=state.navieras.find(n=>n.nombre.toLowerCase()===(o.naviera||"").toLowerCase()); s.value=cur?cur.nombre:(o.naviera||"");
  if(cur&&(cur.contacto||cur.telefono||cur.email)) s.title=[cur.contacto,cur.telefono,cur.email].filter(Boolean).join(" · ");
  s.addEventListener("change",()=>{ if(s.value==="__tabla"){ s.value=cur?cur.nombre:(o.naviera||""); openNavieras(nombre=>saveOrder(Object.assign(clone(o),{naviera:nombre}))); return; } saveOrder(Object.assign(clone(o),{naviera:s.value})); });
  return s;
}
let navCtx=null;
function openNavieras(onElegir){ navCtx={onElegir, edit:null}; pintarNavieras(); $("#dlgNav").showModal(); }
function pintarNavieras(){
  const box=$("#navTabla"); box.textContent=""; const ro=!state.canWrite;
  const t=el("table","tbl navtbl"), th=el("thead"), hr=el("tr");
  for(const x of ["Naviera","Persona de contacto","Teléfono","Correo",""]) hr.append(el("th",null,x)); th.append(hr); t.append(th);
  const tb=el("tbody");
  const usos=n=>state.orders.filter(o=>(o.naviera||"").toLowerCase()===n.nombre.toLowerCase()).length;
  for(const n of state.navieras){
    const tr=el("tr");
    if(navCtx.edit===n.id){
      const ins={}; for(const k of ["nombre","contacto","telefono","email"]){ const i=el("input"); i.value=n[k]||""; i.dataset.f=k; ins[k]=i; const td=el("td"); td.append(i); tr.append(td); }
      const td=el("td","acc"); const g=el("button","btn small primary","Guardar"); g.type="button"; g.addEventListener("click",()=>guardarNaviera(n,ins)); const c=el("button","btn small","Cancelar"); c.type="button"; c.addEventListener("click",()=>{navCtx.edit=null; pintarNavieras();}); td.append(g,c); tr.append(td);
    } else {
      tr.append(el("td",null,n.nombre), el("td",null,n.contacto||""), el("td",null,n.telefono||""), el("td",null,n.email||""));
      const td=el("td","acc");
      if(navCtx.onElegir){ const u=el("button","btn small","Elegir"); u.type="button"; u.addEventListener("click",()=>{ $("#dlgNav").close(); navCtx.onElegir(n.nombre); }); td.append(u); }
      if(!ro){ const e=el("button","btn small","Editar"); e.type="button"; e.addEventListener("click",()=>{navCtx.edit=n.id; pintarNavieras();});
        const d=el("button","btn small danger","Eliminar"); d.type="button"; d.addEventListener("click",()=>eliminarNaviera(n, usos(n))); td.append(e,d); }
      const k=usos(n); if(k) td.append(el("small","hint",` ${k} pedido${k===1?"":"s"}`));
      tr.append(td);
    }
    tb.append(tr);
  }
  if(!state.navieras.length){ const tr=el("tr"), td=el("td","empty","Todavía no hay navieras."); td.colSpan=5; tr.append(td); tb.append(tr); }
  t.append(tb); box.append(t);
  $("#navAlta").hidden=ro;
}
async function guardarNaviera(n, ins){
  const v={ nombre:ins.nombre.value.trim(), contacto:ins.contacto.value.trim()||null, telefono:ins.telefono.value.trim()||null, email:ins.email.value.trim()||null };
  if(!v.nombre){ $("#navErr").textContent="El nombre de la naviera es obligatorio."; return; }
  if(state.navieras.some(x=>x.id!==n.id&&x.nombre.toLowerCase()===v.nombre.toLowerCase())){ $("#navErr").textContent="Ya existe una naviera con ese nombre."; return; }
  if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)){ $("#navErr").textContent="El correo no es válido."; return; }
  const r=await sb.schema("compras").from("navieras").update(v).eq("id",n.id); if(r.error){ $("#navErr").textContent=msgErr(r.error); return; }
  // si cambia el nombre, los pedidos que la usaban pasan al nombre nuevo
  if(v.nombre!==n.nombre) for(const o of state.orders.filter(o=>(o.naviera||"").toLowerCase()===n.nombre.toLowerCase())) saveOrder(Object.assign(clone(o),{naviera:v.nombre}));
  Object.assign(n,v); navCtx.edit=null; $("#navErr").textContent=""; pintarNavieras(); render(); toast("Naviera guardada");
}
async function eliminarNaviera(n, k){
  if(!confirm(k?`«${n.nombre}» está en ${k} pedido${k===1?"":"s"}. Se quitará de la lista, pero esos pedidos la conservan. ¿Eliminar?`:`¿Eliminar la naviera «${n.nombre}»?`)) return;
  const r=await sb.schema("compras").from("navieras").delete().eq("id",n.id); if(r.error){ toast(msgErr(r.error)); return; }
  state.navieras=state.navieras.filter(x=>x.id!==n.id); pintarNavieras(); render(); toast("Naviera eliminada");
}
$("#navCerrar").addEventListener("click",()=>$("#dlgNav").close());
$("#navAlta").addEventListener("submit",async ev=>{
  ev.preventDefault(); const v={ nombre:$("#nvNombre").value.trim(), contacto:$("#nvContacto").value.trim()||null, telefono:$("#nvTelefono").value.trim()||null, email:$("#nvEmail").value.trim()||null };
  if(!v.nombre){ $("#navErr").textContent="El nombre de la naviera es obligatorio."; return; }
  if(state.navieras.some(x=>x.nombre.toLowerCase()===v.nombre.toLowerCase())){ $("#navErr").textContent="Ya existe una naviera con ese nombre."; return; }
  if(v.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)){ $("#navErr").textContent="El correo no es válido."; return; }
  const r=await sb.schema("compras").from("navieras").insert(v).select("id,nombre,contacto,telefono,email").single();
  if(r.error){ $("#navErr").textContent=msgErr(r.error); return; }
  state.navieras.push(Object.assign({id:Date.now()},v,r.data||{},{nombre:(r.data&&r.data.nombre)||v.nombre})); state.navieras.sort((a,b)=>a.nombre.localeCompare(b.nombre));
  for(const id of ["nvNombre","nvContacto","nvTelefono","nvEmail"]) $("#"+id).value=""; $("#navErr").textContent=""; pintarNavieras(); toast(`Naviera añadida: ${v.nombre}`);
  if(navCtx&&navCtx.onElegir&&confirm(`¿Asignar «${v.nombre}» a este pedido?`)){ $("#dlgNav").close(); navCtx.onElegir(v.nombre); } else render();
});

/* ===== Formas de pago: selector y alta ===== */
function selForma(val, onChange, porPedido, supFp){
  const s=el("select","fpsel");
  if(porPedido){ const sf=state.formas.find(f=>f.id===supFp)||state.formas[0]; const o0=el("option",null,`La del proveedor${sf?": "+sf.nombre:""}`); o0.value=""; s.append(o0); }
  for(const f of state.formas){ const o=el("option",null,f.nombre); o.value=String(f.id); s.append(o); }
  if(state.canWrite){ const on=el("option",null,"＋ Nueva forma de pago…"); on.value="__new"; s.append(on); }
  s.value=val?String(val):(porPedido?"":(state.formas[0]?String(state.formas[0].id):""));
  s.addEventListener("change",()=>{ if(s.value==="__new"){ s.value=val?String(val):(porPedido?"":String((state.formas[0]||{}).id||"")); openFp(id=>onChange(id)); return; } onChange(s.value?+s.value:null); });
  return s;
}
let fpCtx=null;
function fpTramoRow(t){
  const r=el("div","fprow");
  const p=el("input"); p.inputMode="decimal"; p.value=t.pct??""; p.className="fp-pct"; p.setAttribute("aria-label","Porcentaje");
  const m=el("select"); m.className="fp-ref"; for(const [v,l] of [["pedido","Al hacer el pedido (adelantado)"],["carga","A la carga (ETD, embarque)"],["eta","Respecto a la ETA (llegada)"]]){const o=el("option",null,l); o.value=v; m.append(o);} m.value=t.ref||"eta";
  const dd=el("input"); dd.inputMode="numeric"; dd.className="fp-dias"; dd.value=t.dias!=null?Math.abs(t.dias):(t.ref==="eta"?15:0); dd.setAttribute("aria-label","Días");
  const sg=el("select"); sg.className="fp-sig"; for(const [v,l] of [["-","días antes"],["+","días después"]]){const o=el("option",null,l); o.value=v; sg.append(o);} sg.value=(t.dias||0)>0?"+":"-";
  const del=el("button","btn small danger","Quitar"); del.type="button"; del.addEventListener("click",()=>{ if($("#fpTramos").children.length>1) r.remove(); fpResumen(); });
  for(const x of [p,m,dd,sg]) x.addEventListener("input",fpResumen);
  r.append(p, el("span",null,"%"), m, dd, sg, del); return r;
}
function fpLeer(){ return [...$("#fpTramos").children].map(r=>({pct:num(r.querySelector(".fp-pct").value), ref:r.querySelector(".fp-ref").value, dias:(r.querySelector(".fp-sig").value==="+"?1:-1)*(num(r.querySelector(".fp-dias").value)||0)})); }
function fpNombre(tr){ if(tr.length===1&&tr[0].ref==="eta") return `Pago ${tramoTxt(tr[0],true)}`;
  const partes=tr.map((t,i)=>{ const ult=i===tr.length-1&&i>0; const mom=t.ref==="pedido"?"adelantado":t.ref==="carga"?"a la carga":tramoTxt(t,true); return ult?`resto ${mom}`:`${t.pct}% ${mom}`; }); return "Pago "+partes.join(", "); }
function fpResumen(){ const tr=fpLeer(), sum=tr.reduce((a,t)=>a+(isNaN(t.pct)?0:t.pct),0); $("#fpSuma").textContent=`Suma: ${fmt(sum)||0} %${Math.abs(sum-100)<0.001?"":" (debe ser 100 %)"}`; $("#fpSuma").className="fpsum"+(Math.abs(sum-100)<0.001?"":" bad"); if(!$("#fpNombre").dataset.tocado) $("#fpNombre").value=fpNombre(tr); }
function openFp(onDone){
  fpCtx={onDone}; $("#fpErr").textContent=""; const n=$("#fpNombre"); n.value=""; delete n.dataset.tocado;
  const box=$("#fpTramos"); box.textContent=""; for(const t of [{pct:30,ref:"pedido",dias:0},{pct:70,ref:"eta",dias:-15}]) box.append(fpTramoRow(t));
  fpResumen(); $("#dlgFp").showModal(); setTimeout(()=>box.querySelector("input").focus(),30);
}
$("#fpNombre").addEventListener("input",()=>{$("#fpNombre").dataset.tocado="1";});
$("#fpAdd").addEventListener("click",()=>{ $("#fpTramos").append(fpTramoRow({pct:"",ref:"eta",dias:-15})); fpResumen(); });
$("#fpCancel").addEventListener("click",()=>$("#dlgFp").close());
$("#fFp").addEventListener("submit",async ev=>{
  ev.preventDefault(); const tr=fpLeer(), nombre=$("#fpNombre").value.trim();
  if(tr.some(t=>isNaN(t.pct)||t.pct<=0)){ $("#fpErr").textContent="Cada tramo necesita un porcentaje mayor que cero."; return; }
  if(Math.abs(tr.reduce((a,t)=>a+t.pct,0)-100)>0.001){ $("#fpErr").textContent="Los porcentajes deben sumar 100 %."; return; }
  if(!nombre){ $("#fpErr").textContent="Ponle un nombre."; return; }
  if(state.formas.some(f=>f.nombre.toLowerCase()===nombre.toLowerCase())){ $("#fpErr").textContent="Ya existe una forma de pago con ese nombre."; return; }
  const ant=tr.filter(t=>t.ref==="pedido").reduce((a,t)=>a+t.pct,0), eta=tr.find(t=>t.ref==="eta");
  const r=await sb.schema("compras").from("formas_pago").insert({ nombre, tramos:tr, orden:(Math.max(0,...state.formas.map(f=>f.orden||0))+1), pct_anticipo:ant, dias_antes_eta: eta?Math.max(0,-eta.dias):0 }).select("id,nombre,tramos,orden").single();
  if(r.error){ $("#fpErr").textContent=msgErr(r.error); return; }
  state.formas.push({ id:r.data.id, nombre:r.data.nombre || nombre, tramos:(r.data.tramos || tr).map(t => ({ pct:+t.pct, ref:t.ref, dias:+t.dias || 0 })), orden:r.data.orden }); $("#dlgFp").close(); toast(`Forma de pago creada: ${nombre}`);
  if(fpCtx&&fpCtx.onDone) fpCtx.onDone(r.data.id); else render();
});

/* ===== Búsqueda por artículo (en todos los proveedores) ===== */
const BA = { q:"", sel:new Set() };
const norm = x => (x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
function buscarArticulo(app){
  const box=el("section","busart pad");
  box.append(el("h2","sec","Búsqueda por artículo"));
  // (va encima de las tarjetas de proveedores)
  box.append(el("p","secsub","Busca por código o descripción en todos los proveedores y revisa la previsión del artículo sin entrar en su proveedor."));
  const bar=el("div","toolbar"); bar.style.padding="6px 0 10px";
  const q=el("input","search"); q.type="search"; q.placeholder="Código o descripción (por ejemplo: vela 1700, P-COM-BAN-004)"; q.value=BA.q; q.dataset.k="busart"; q.setAttribute("aria-label","Buscar artículo por código o descripción");
  q.addEventListener("input",()=>{BA.q=q.value; BA.sel.clear(); render();});
  bar.append(q);
  if(BA.q){const cl=el("button","btn small","Limpiar"); cl.addEventListener("click",()=>{BA.q=""; BA.sel.clear(); render();}); bar.append(cl);}
  box.append(bar);
  const words=norm(BA.q).split(/\s+/).filter(Boolean);
  if(!words.length){ app.append(box); return; }
  const hits=state.products.filter(p=>{const t=norm(`${p.codigo_ax||""} ${p.clave||""} ${p.name||""} ${p.model||""} ${(sup(p.supplier)||{}).name||""}`); return words.every(w=>t.includes(w));})
    .sort((a,b)=>(!!a.extinguir-!!b.extinguir)||(a.name||"").localeCompare(b.name||""));
  if(!hits.length){ box.append(el("div","card empty","Ningún artículo coincide con la búsqueda.")); app.append(box); return; }
  const lista=el("div","balist");
  const auto=hits.length<=3;
  for(const p of hits.slice(0,40)){
    const on=auto||BA.sel.has(p._id); const b=el("button","bahit"+(on?" on":"")+(p.extinguir?" ext":"")); b.type="button";
    b.append(el("span","code",dispCode(p)+(p.clave&&p.codigo_ax&&p.clave!==p.codigo_ax?` · ${p.clave.slice(p.codigo_ax.length)}`:"")), el("b",null,p.name), el("span","sup",(sup(p.supplier)||{}).name||""));
    if(!auto) b.addEventListener("click",()=>{BA.sel.has(p._id)?BA.sel.delete(p._id):BA.sel.add(p._id); render();});
    lista.append(b);
  }
  box.append(lista);
  if(hits.length>40) box.append(el("p","hint",`Hay ${hits.length} artículos: se muestran los 40 primeros. Afina la búsqueda.`));
  if(!auto&&!BA.sel.size) box.append(el("p","hint","Pulsa uno o varios artículos para ver su previsión."));
  const ver=auto?hits:hits.filter(p=>BA.sel.has(p._id));
  for(const p of ver){
    const sid=p.supplier, s=sup(sid), c=cfg(sid), W=weeks(sid);
    const hd=el("div","bahead"); const a=el("a",null,`${s?s.name:""} ›`); a.href=`#${sid}`; a.title="Abrir la revisión de artículos de este proveedor"; hd.append(a, el("span",null,`Pedido a puerto ${c.plazo} sem · tránsito ${c.transito} sem · ${formaCorta(formaSup(sid))}`));
    box.append(hd);
    const prevMon=CUR.mon; CUR.mon=c.moneda||"EUR";   // importes en la moneda de su proveedor
    const wrap=el("div","gridwrap bagrid"), t=el("table","grid"); t.append(gridHead(sid,W)); t.append(productBody(p,calc(p,sid),W,sid,c)); wrap.append(t); box.append(wrap);
    CUR.mon=prevMon;
  }
  app.append(box);
}

/* ===== Resumen por proveedor: stock de seguridad y stock previsto ===== */
const RS = { abiertos:new Set(), semanas:12, medida:"uds", tipo:"disp", q:"" };
// Stock real = columna «Disponible» del fichero de AX; stock disponible = «Disponible real». Los negativos cuentan como cero.
const stHoyRaw = p => RS.tipo === "real" ? (p.stockAX ? (p.stockReal || 0) : (p.stock || 0)) : (p.stock || 0);
const stHoy = p => Math.max(0, stHoyRaw(p));
// Stock real previsto = disponible previsto + pedidos de compra de AX que aún no han entrado (se van descontando
// a medida que llegan las entradas de pedidos confirmados, para no contarlos dos veces)
const stPrevRaw = (p, v, r, i) => { if (v == null) return null; if (RS.tipo !== "real") return v;
  const pc = Math.max(0, (p.stockAX ? (p.stockReal || 0) : (p.stock || 0)) - (p.stock || 0)); let llegado = 0; for (let j = 0; j <= i; j++) llegado += (r.conf[j] || 0);
  return v + Math.max(0, pc - llegado); };
const stPrev = (p, v, r, i) => v == null ? null : Math.max(0, stPrevRaw(p, v, r, i));
// Número con punto de miles (también en 4 cifras) y los decimales indicados como máximo
const fmtN = (v, d=0) => { if (v == null || !isFinite(v)) return ""; const r = Math.round(v * 10**d) / 10**d; const [e, f] = Math.abs(r).toFixed(d).split("."); const fx = f ? f.replace(/0+$/, "") : ""; return (r < 0 ? "-" : "") + e.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (fx ? "," + fx : ""); };
function renderStock(app){
  document.title="Evolución del stock";
  const h=el("header","top pad"); const bb=el("div","brand"); const bk=el("a","back","‹ Planificador de compras"); bk.href="#planificador";
  bb.append(bk, el("h1",null,"Evolución del stock"), el("p",null,"Stock de seguridad y stock previsto por proveedor y artículo, según la planificación de importaciones.")); h.append(bb); app.append(h);
  resumenProveedores(app);
}
function resumenProveedores(app){
  const box = el("section","resumen pad");
  const ctl = el("div","toolbar rctl");
  const sg = (opts, v, on) => { const s2 = el("div","seg"); for (const [k,l] of opts){ const b = el("button",null,l); b.type = "button"; b.setAttribute("aria-pressed", String(k === v)); b.addEventListener("click", () => on(k)); s2.append(b); } return s2; };
  const l0 = el("label"); l0.append("Stock ", sg([["disp","disponible"],["real","real"]], RS.tipo, v => { RS.tipo = v; render(); })); l0.title = "Disponible: en almacén menos los pedidos de clientes pendientes de servir. Real: lo que hay en almacén.";
  const l1 = el("label"); l1.append("Ver en ", sg([["uds","unidades"],["coste","coste"]], RS.medida, v => { RS.medida = v; render(); }));
  const l2 = el("label"); l2.append("Semanas ", sg([[8,"8"],[12,"12"],[26,"26"],[52,"52"]], RS.semanas, v => { RS.semanas = v; render(); }));
  const allOpen = el("button","btn small", RS.abiertos.size ? "Plegar todo" : "Desplegar todo");
  allOpen.addEventListener("click", () => { if (RS.abiertos.size) RS.abiertos.clear(); else for (const s of state.suppliers) if (prodsOf(s._id).length) RS.abiertos.add(s._id); render(); });
  const ex = el("button","btn small","Exportar a Excel"); ex.addEventListener("click", exportResumen);
  const leg = el("div","rleg"); leg.append(el("span","l-under","bajo stock de seguridad"), el("span","l-neg","rotura"), el("span","l-low","cubre menos de 4 semanas"));
  const qs = el("input","rbusq"); qs.type = "search"; qs.placeholder = "Buscar referencia o descripción"; qs.value = RS.q; qs.dataset.k = "rs-q"; qs.setAttribute("aria-label","Buscar artículo por referencia o descripción");
  qs.addEventListener("input", () => { RS.q = qs.value; render(); });
  ctl.append(qs, l0, l1, l2, allOpen, ex, leg); box.append(ctl);
  const W = weeks(state.suppliers[0] ? state.suppliers[0]._id : "").slice(0, RS.semanas);
  const nq = x => (x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const words = nq(RS.q).split(/\s+/).filter(Boolean);
  const coincide = p => !words.length || words.every(w => nq(`${p.codigo_ax||""} ${p.clave||""} ${p.name||""} ${p.model||""}`).includes(w));
  const prodsRS = sid => prodsOf(sid).filter(coincide);
  const sups = state.suppliers.filter(s => prodsRS(s._id).length).sort((a,b) => (a.name||"").localeCompare(b.name||""));
  const tw = el("div","rwrap"); const t = el("table","rtbl");
  // cabecera en dos niveles y títulos en dos renglones
  const th = el("thead");
  const g1 = el("tr","grp"); const gc = (txt, n, cls) => { const x = el("th",cls||"",txt); x.colSpan = n; return x; };
  g1.append(gc("",2,"fix"), gc("",2), gc("Stock de seguridad",3,"gs"), gc("Hoy",2,"gs"), gc(`Stock ${RS.tipo === "real" ? "real" : "disponible"} previsto por semana (${RS.medida === "coste" ? "coste" : "unidades"})`, W.length, "gs gw"));
  const hr = el("tr");
  const h2 = (a, b, cls) => { const x = el("th",cls||""); x.append(a); if (b){ x.append(el("br")); x.append(b); } return x; };
  hr.append(h2("Proveedor", "y artículo", "l fix f1"), h2("Descripción", null, "l fix f2"), h2("Precio", null, "n"), h2("Venta media","semanal","n"),
    h2("Unidades", null, "n gsl"), h2("Coste", null, "n"), h2("Semanas", "que cubre", "n"), h2("Stock", RS.tipo === "real" ? "real" : "disponible", "n gsl"), h2("Coste", null, "n"));
  W.forEach((w,i) => { const x = el("th","n wk"+(i===0?" gsl":"")); x.append(wLabel(w)); x.append(el("br")); x.append(el("small",null,dShort(w))); hr.append(x); });
  th.append(g1, hr); t.append(th);
  const tb = el("tbody"); const tot = {};
  const add = (mon, k, v) => { tot[mon] = tot[mon] || { ss:0, ssc:0, st:0, stc:0, w:new Array(W.length).fill(0) }; if (k === "w") v.forEach((x,i) => tot[mon].w[i] += x); else tot[mon][k] += v; };
  const cov = (ss, avg) => avg > 0 ? ss / avg : null;
  const fmtC = (v, mon) => v == null || !isFinite(v) ? "" : fmtN(v, 0) + (mon === "USD" ? " $" : " €");
  const cel = (txt, cls) => { const td = el("td", cls || ""); const sp = el("span", null, txt); td.append(sp); return td; };
  for (const s of sups){
    const c = cfg(s._id), mon = c.moneda || "EUR", ps = prodsRS(s._id), Ws = weeks(s._id);
    const rows = ps.map(p => { const r = calc(p, s._id); const idx = W.map(w => Ws.findIndex(x => key(x) === key(w))); return { p, r, prev: idx.map(i => i >= 0 ? stPrev(p, r.net[i], r, i) : null), raw: idx.map(i => i >= 0 ? stPrevRaw(p, r.net[i], r, i) : null) }; });
    const ssU = ps.reduce((a,p) => a + (p.ss || 0), 0), ssC = ps.reduce((a,p) => a + (p.ss || 0) * (p.price || 0), 0);
    const stU = ps.reduce((a,p) => a + Math.max(0, stHoy(p)), 0), stC = ps.reduce((a,p) => a + Math.max(0, stHoy(p)) * (p.price || 0), 0);
    const wk = W.map((_,i) => rows.reduce((a,x) => a + (RS.medida === "coste" ? (x.prev[i] || 0) * (x.p.price || 0) : (x.prev[i] || 0)), 0));
    const rot = W.map((_,i) => rows.some(x => !x.p.extinguir && x.raw[i] != null && x.raw[i] < -1e-9));
    add(mon,"ss",ssU); add(mon,"ssc",ssC); add(mon,"st",stU); add(mon,"stc",stC); add(mon,"w",wk);
    const open = RS.abiertos.has(s._id) || words.length > 0;   // con búsqueda se ven los artículos directamente
    const tr = el("tr","rsup"+(open?" open":"")); tr.title = open ? "Plegar" : "Ver los artículos"; tr.addEventListener("click", () => { open ? RS.abiertos.delete(s._id) : RS.abiertos.add(s._id); render(); });
    const c0 = el("td","l fix f1 sup"); c0.colSpan = 2; c0.append(el("span","chev", open ? "▾" : "▸"), el("b",null,s.name), el("small",null,` ${ps.length} art. · ${mon}`));
    tr.append(c0, cel(""), cel(""), cel(fmtN(ssU,0),"gsl"), cel(fmtC(ssC,mon)), cel(""), cel(fmtN(stU,0),"gsl"), cel(fmtC(stC,mon)));
    wk.forEach((v,i) => { const c2 = cel(RS.medida === "coste" ? fmtC(v,mon) : fmtN(v,0), "wk"+(i===0?" gsl":"")); if (rot[i]){ c2.classList.add("rot"); c2.title = "Algún artículo de este proveedor está en rotura esta semana"; } tr.append(c2); });
    tb.append(tr);
    if (!open) continue;
    for (const x of rows){
      const p = x.p, r2 = el("tr","rart"+(p.extinguir?" ext":""));
      const cp = el("td","l fix f1 code"); cp.append(dispCode(p)); const cd = el("td","l fix f2 desc"); cd.append(p.name); if (p.extinguir) cd.append(el("small",null," · a extinguir"));
      r2.append(cp, cd, cel(p.price==null?"":fmtM(p.price,mon,2)), cel(p.avg==null?"":fmtN(p.avg,2)));
      const cs = el("td","gsl"); const inp = el("input"); inp.value = p.ss == null ? "" : p.ss; inp.inputMode = "decimal"; inp.disabled = !state.canWrite; inp.dataset.k = "rss|"+p._id; inp.setAttribute("aria-label",`Stock de seguridad de ${p.name}`);
      inp.addEventListener("click", e => e.stopPropagation());
      inp.addEventListener("change", () => { const v = inp.value.trim() === "" ? null : num(inp.value); if (v != null && (isNaN(v) || v < 0)){ toast("El stock de seguridad debe ser un número igual o mayor que cero"); render(); return; }
        const np = clone(p); np.ss = v; saveProduct(np); toast(`Stock de seguridad de ${p.name}: ${v ?? "sin dato"}`); });
      cs.append(inp);
      const cvp = cov(p.ss || 0, p.avg || 0);
      r2.append(cs, cel(p.ss==null||p.price==null?"":fmtC(p.ss*p.price,mon)), cel(cvp==null?"":fmtN(cvp,1), cvp!=null&&cvp<4&&!p.extinguir?"low":""),
        cel(fmtN(stHoy(p),0), "gsl"+(stHoyRaw(p)<0?" neg":"")), cel(p.price==null?"":fmtC(Math.max(0,stHoy(p))*p.price,mon)));
      x.prev.forEach((v,i) => { const raw = x.raw[i]; const c3 = cel(v==null?"":(RS.medida === "coste" ? fmtC(v*(p.price||0),mon) : fmtN(v,0)), "wk"+(i===0?" gsl":"")+(v==null?"":raw<-1e-9?" neg":v<(p.ss||0)&&!p.extinguir?" under":"")); if (raw != null && raw < -1e-9) c3.title = `Rotura: faltan ${fmtN(-raw,0)} uds (se valora como cero)`; r2.append(c3); });
      tb.append(r2);
    }
  }
  t.append(tb);
  const tf = el("tfoot");
  for (const [mon, T] of Object.entries(tot)){ const fr = el("tr"); const c0 = el("td","l fix f1"); c0.colSpan = 2; c0.append(el("b",null,`Total ${mon === "USD" ? "en dólares" : "en euros"}`));
    fr.append(c0, cel(""), cel(""), cel(fmtN(T.ss,0),"gsl"), cel(fmtC(T.ssc,mon)), cel(""), cel(fmtN(T.st,0),"gsl"), cel(fmtC(T.stc,mon)));
    T.w.forEach((v,i) => fr.append(cel(RS.medida === "coste" ? fmtC(v,mon) : fmtN(v,0), "wk"+(i===0?" gsl":"")))); tf.append(fr); }
  t.append(tf); tw.append(t); box.append(tw);
  box.append(el("p","hint","Pulsa un proveedor para ver sus artículos. El stock de seguridad se puede cambiar aquí y se guarda en la planificación del proveedor. «Semanas que cubre» = stock de seguridad ÷ venta media semanal. El stock negativo (rotura) se valora como cero y se marca en rojo. Stock disponible = «Disponible real» del fichero de AX; stock real = «Disponible». Los totales se separan por moneda."));
  RS._W = W; RS._sups = sups; RS._match = coincide;
  if (!sups.length){ const tr = el("tr"), td = el("td","empty", "Ningún artículo coincide con la búsqueda."); td.colSpan = 9 + W.length; td.style.textAlign = "left"; tr.append(td); tb.append(tr); }
  app.append(box);
}
function exportResumen(){
  const W = RS._W || [], wb = XLSX.utils.book_new();
  const A = [["Proveedor","Moneda","Código","Descripción","Modelo","A extinguir","Precio","Venta media semanal","Stock seguridad","Coste stock seguridad","Semanas que cubre",RS.tipo==="real"?"Stock real":"Stock disponible",RS.tipo==="real"?"Coste stock real":"Coste stock disponible", ...W.map(w => `${wLabel(w)} ${dShort(w)}`)]];
  for (const s of RS._sups || []){ const mon = cfg(s._id).moneda || "EUR", Ws = weeks(s._id);
    for (const p of prodsOf(s._id).filter(RS._match || (() => true))){ const r = calc(p, s._id); const prev = W.map(w => { const i = Ws.findIndex(x => key(x) === key(w)); return i >= 0 ? Math.round(stPrev(p, r.net[i], r, i)*100)/100 : ""; });
      A.push([s.name, mon, dispCode(p), p.name, p.model || "", p.extinguir ? "Sí" : "", p.price ?? "", p.avg ?? "", p.ss ?? "", p.ss != null && p.price != null ? Math.round(p.ss*p.price*100)/100 : "", p.avg ? Math.round((p.ss||0)/p.avg*10)/10 : "", stHoy(p), p.price != null ? Math.round(Math.max(0,stHoy(p))*p.price*100)/100 : "", ...prev]); } }
  XLSX.utils.book_append_sheet(wb, sheet(A, [24,6,18,34,12,10,10,12,12,14,12,10,14, ...W.map(() => 9)]), "Resumen por proveedor");
  saveXlsx(wb, `Resumen_stock_proveedores_${stamp()}.xlsx`);
}

/* ===== Entradas manuales de almacén ===== */
const MOTIVOS = { devolucion:"Devolución de cliente", otro_proveedor:"Compra a otro proveedor", ajuste:"Ajuste de stock", otro:"Otra entrada" };
let manCtx = null;
function openMan(p, w, e, sid){
  manCtx = { p, w, e, sid }; const ro = !state.canWrite;
  $("#manTitle").textContent = `${p.name}: otra entrada en ${wLabel(w)}`;
  $("#manSub").textContent = `Entra en almacén la semana del ${dLong(w)} y suma al stock desde esa semana.${p.pallet>1?` Pallet de ${p.pallet} uds (no es obligatorio respetarlo).`:""}`;
  const ms = $("#manMotivo"); ms.textContent = ""; for (const [v,l] of Object.entries(MOTIVOS)){ const o = el("option",null,l); o.value = v; ms.append(o); }
  ms.value = e ? e.motivo : "devolucion"; $("#manQty").value = e ? e.cantidad : ""; $("#manCom").value = e ? e.comentario : "";
  for (const id of ["manMotivo","manQty","manCom"]) $("#"+id).disabled = ro;
  $("#manSave").hidden = ro; $("#manDel").hidden = ro || !e; $("#manErr").textContent = "";
  $("#dlgMan").showModal(); setTimeout(() => $("#manQty").focus(), 30);
}
$("#manCancel").addEventListener("click", () => $("#dlgMan").close());
async function guardarMan(borrar){
  const { p, w, e } = manCtx, k = key(w);
  const np = clone(p); np.manual = np.manual || {};
  if (borrar){ delete np.manual[k]; }
  else {
    const q = num($("#manQty").value);
    if (isNaN(q) || q === 0) { $("#manErr").textContent = "Indica la cantidad (puede ser negativa para un ajuste)."; return; }
    const com = $("#manCom").value.trim(), mot = $("#manMotivo").value;
    if (mot !== "devolucion" && !com) { $("#manErr").textContent = "Añade un comentario: de qué proveedor viene o por qué se hace el ajuste."; return; }
    if (p.pallet > 1 && q % p.pallet) toast(`Aviso: ${q} no es múltiplo de ${p.pallet} uds por pallet. Se guarda igualmente.`);
    np.manual[k] = { id: e && e.id, cantidad:q, motivo:mot, comentario:com };
  }
  $("#dlgMan").close();
  const i = state.products.findIndex(x => x._id === p._id); if (i >= 0) state.products[i] = np; render();
  await enqueue("man-"+p.apId+"-"+k, async () => {
    if (borrar) chk(await sb.schema("compras").from("entradas_manuales").delete().eq("articulo_proveedor_id", p.apId).eq("semana", k));
    else { const m = np.manual[k]; chk(await sb.schema("compras").from("entradas_manuales").upsert({ articulo_proveedor_id:p.apId, semana:k, cantidad:m.cantidad, motivo:m.motivo, comentario:m.comentario || null }, { onConflict:"articulo_proveedor_id,semana" })); }
  });
  toast(borrar ? "Entrada eliminada" : "Entrada guardada");
}
$("#fMan").addEventListener("submit", ev => { ev.preventDefault(); guardarMan(false); });
$("#manDel").addEventListener("click", () => { if (confirm("¿Eliminar esta entrada?")) guardarMan(true); });

/* ===== Stock de AX: fecha y carga del fichero ===== */
function fechaCorta(f){ if (!f) return ""; const d = new Date(f); return d.toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit"}); }
function fechaLarga(f){ if (!f) return ""; const d = new Date(f); return d.toLocaleDateString("es-ES",{day:"numeric",month:"short",year:"numeric"}).replace(".","") + " a las " + d.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}); }
function stockBox(){
  const w = el("div","stockbox"); const i = S.stockInfo;
  w.append(el("b",null,"Stock de AX"), el("span",null, i ? `Actualizado el ${fechaLarga(i.fecha)}` : "Todavía no se ha cargado"));
  if (i && i.fichero) w.append(el("small",null,i.fichero));
  if (state.canWrite){
    const inp = el("input"); inp.type = "file"; inp.accept = ".xlsx,.xlsm,.xls"; inp.hidden = true;
    const b = el("button","btn small primary","Cargar fichero de stock"); b.addEventListener("click", () => inp.click());
    inp.addEventListener("change", () => { if (inp.files[0]) cargarStock(inp.files[0], b); });
    w.append(b, inp);
  }
  return w;
}
const numX = v => { if (v == null || v === "") return 0; const n = typeof v === "number" ? v : Number(String(v).replace(",", ".")); return isFinite(n) ? n : 0; };
async function cargarStock(file, btn){
  btn.disabled = true; btn.textContent = "Leyendo el fichero…";
  try{
    const wb = XLSX.read(await file.arrayBuffer(), { type:"array" });
    const ws = wb.Sheets["INVENTSUM"]; if (!ws) throw new Error("El fichero no tiene la hoja INVENTSUM.");
    const rows = XLSX.utils.sheet_to_json(ws, { defval:null });
    const data = rows.filter(r => r.ITEMID).map(r => { const fis = numX(r.PHYSICALINVENT), res = numX(r.RESERVPHYSICAL), ven = numX(r.ONORDER);
      return { articulo_id:String(r.ITEMID).trim(), nombre:r.ITEMNAME || null, config_id: r.CONFIGID ? String(r.CONFIGID).trim() || null : null, talla_id: r.INVENTSIZEID ? String(r.INVENTSIZEID) : null,
        almacen: r.INVENTLOCATIONID || null, fisico:fis, reservado_fisico:res, pedido_compra:numX(r.ORDERED), pedido_venta:ven, reservado_pedido:numX(r.RESERVORDERED),
        disponible:numX(r.Disponible), minimos: r.Minimos == null ? null : numX(r.Minimos), disponible_real: fis - res - ven }; });
    if (!data.length) throw new Error("La hoja INVENTSUM está vacía.");
    const fecha = new Date(file.lastModified || Date.now()).toISOString();
    // Control: artículos del planificador que hoy tienen stock de AX y que no vienen en este fichero
    const nuevas = new Set(data.map(r => r.articulo_id + (r.config_id || "")));
    const faltan = state.products.filter(p => p.stockAX && p.clave && !nuevas.has(p.clave));
    let aviso = "";
    if (faltan.length){
      const porProv = {}; for (const p of faltan){ const n = (sup(p.supplier) || {}).name || ""; (porProv[n] = porProv[n] || []).push(p.clave); }
      aviso = `\n\n⚠ ATENCIÓN: ${faltan.length} artículo${faltan.length === 1 ? "" : "s"} del planificador NO aparece${faltan.length === 1 ? "" : "n"} en este fichero y se quedará${faltan.length === 1 ? "" : "n"} sin stock de AX:\n` +
        Object.entries(porProv).map(([n, cs]) => `• ${n}: ${cs.slice(0,6).join(", ")}${cs.length > 6 ? ` y ${cs.length - 6} más` : ""}`).join("\n") +
        "\n\nRevisa que la hoja INVENTSUM esté completa (sin filtros en la consulta de AX) antes de continuar.";
    }
    if (!confirm(`Se cargarán ${data.length} líneas de stock del fichero «${file.name}» (guardado el ${fechaLarga(fecha)}).${aviso}\n\n¿Continuar?`)){ btn.disabled = false; btn.textContent = "Cargar fichero de stock"; return; }
    btn.textContent = "Guardando…";
    const c = chk(await sb.schema("core").from("cargas").insert({ tipo:"stock", fichero:file.name, filas:data.length, fecha_datos:fecha, notas:"Carga desde la app" }).select("id").single());
    for (let i = 0; i < data.length; i += 500) chk(await sb.schema("ax").from("stock_inventsum").insert(data.slice(i, i+500).map(r => Object.assign({ carga_id:c.data.id }, r))));
    toast(`Stock actualizado: ${data.length} líneas del ${fechaLarga(fecha)}`); await cargar();
  } catch(e){ console.error(e); toast(e.message && !e.code ? e.message : msgErr(e)); btn.disabled = false; btn.textContent = "Cargar fichero de stock"; }
}

/* ===== Ficha de artículo: nuevo o existente ===== */
let prodCtx = null;
const PF = { codigo_ax:"pCode", model:"pModel", name:"pName", clave:"pClave", stock:"pStock", avg:"pAvg", ss:"pSS", pallet:"pPal", price:"pPrice" };
function openProd(p, sid){
  const isNew = !p; prodCtx = { p, sid, isNew };
  $("#prodTitle").textContent = isNew ? `Nuevo artículo de ${sup(sid).name}` : p.name;
  $("#prodSub").textContent = isNew ? "Si aún no está dado de alta en AX (por ejemplo, una muestra), deja vacío el código: quedará como muestra sin referencia." : `${dispCode(p)}${p.model ? ". Modelo " + p.model : ""}. Precios en ${cfg(sid).moneda}.`;
  const src = p || {};
  for (const [f,id] of Object.entries(PF)){ const i = $("#"+id); i.value = src[f] == null ? "" : src[f]; i.disabled = !state.canWrite || (f === "codigo_ax" && !isNew && !!src.codigo_ax); }
  for (const box of document.querySelectorAll("#fProd .f[data-f]")){ const f = box.dataset.f; const r = REQ.find(x => x[0] === f); if (!r) continue;
    const miss = !isNew && missing(src).includes(r[1]); box.classList.toggle("miss", miss); const h = box.querySelector(".hint"); if (h) h.textContent = miss ? "Falta este dato para planificar." : ""; }
  $("#pExt").checked = !!src.extinguir; $("#pExt").disabled = !state.canWrite;
  const sx = $("#pStock"); sx.disabled = !state.canWrite || !!src.stockAX;
  sx.parentElement.querySelector(".hint").textContent = src.stockAX ? `Stock de AX (${src.clave}) del ${fechaLarga(src.stockFecha)}. Se actualiza al cargar el fichero de stock.` : (isNew ? "Se tomará de AX si la clave existe en el fichero de stock." : (src.clave ? `No hay stock de AX para ${src.clave}: introdúcelo a mano.` : "Sin clave de stock: introdúcelo a mano."));
  $("#pErr").textContent = ""; $("#prodSave").textContent = isNew ? "Crear artículo" : "Guardar"; $("#prodSave").disabled = !state.canWrite;
  $("#dlgProd").showModal(); setTimeout(() => $("#"+(isNew ? "pCode" : "pStock")).focus(), 30);
}
$("#prodCancel").addEventListener("click", () => $("#dlgProd").close());
$("#fProd").addEventListener("submit", async ev => {
  ev.preventDefault(); if (!state.canWrite){ $("#dlgProd").close(); return; }
  const { p, sid, isNew } = prodCtx, val = f => $("#"+PF[f]).value.trim(), err = m => { $("#pErr").textContent = m; };
  const code = val("codigo_ax").toUpperCase(), name = val("name"), clave = (val("clave").toUpperCase() || code), ext = $("#pExt").checked;
  if (code && !/^[A-Z0-9._\-]+$/.test(code)) return err("El código solo puede llevar letras, números, guiones y puntos (sin espacios).");
  if (!name) return err("La descripción es obligatoria.");
  const out = {}; for (const [f] of REQ){ const raw = val(f); if (raw === ""){ out[f] = null; continue; } const v = f === "price" ? parsePrice(raw) : num(raw);
    if (isNaN(v)) return err(`Revisa el campo ${REQ.find(x => x[0] === f)[1]}: debe ser un número.`);
    if (f === "pallet" && (v < 1 || !Number.isInteger(v))) return err("Las uds por pallet deben ser un entero de 1 o más.");
    if (f === "stock" && p && p.stockAX) continue;
    if (f !== "stock" && v < 0) return err(`El ${REQ.find(x => x[0] === f)[1]} no puede ser negativo.`); out[f] = v; }
  if (!isNew){
    const np = Object.assign(clone(p), { name, model:val("model"), clave, extinguir:ext }, out);
    if (!p.stockAX){ np.stockManual = out.stock; } else { np.stock = p.stock; }
    if (code && !p.codigo_ax){ np.codigo_ax = code; np.estado = "activo"; }
    $("#dlgProd").close(); saveProduct(np); const ms = missing(np); toast(ms.length ? `Artículo guardado. Faltan: ${ms.join(", ")}` : "Artículo guardado"); return;
  }
  const bt = $("#prodSave"); bt.disabled = true;
  try{
    let artId = null;
    if (code){ const ex = chk(await sb.schema("maestros").from("articulos").select("id").eq("codigo_ax", code).maybeSingle()); if (ex.data) artId = ex.data.id; }
    if (artId){
      if (state.products.some(x => x.artId === artId && x.supplier === sid && (x.clave || "") === (clave || ""))){ bt.disabled = false; return err("Ese artículo con ese acabado ya está en el planificador de este proveedor."); }
    } else {
      const r = chk(await sb.schema("maestros").from("articulos").insert({ codigo_ax:code || null, descripcion:name, modelo:val("model") || null, estado: code ? "activo" : "muestra" }).select("id").single()); artId = r.data.id;
    }
    const orden = Math.max(0, ...prodsOf(sid).map(x => x.sort || 0)) + 1;
    const ex = chk(await sb.schema("maestros").from("articulo_proveedor").select("id").eq("articulo_id", artId).eq("proveedor_id", sup(sid).dbId).is("clave_stock", null).maybeSingle());
    const row = { precio:out.price, moneda:cfg(sid).moneda, uds_pallet:out.pallet, planificar:true, orden, precio_origen:"manual", clave_stock:clave || null, a_extinguir:ext,
      venta_media_semanal:out.avg, stock_seguridad:out.ss, stock_manual:out.stock, descripcion:name, modelo:val("model") || null };
    if (ex.data) chk(await sb.schema("maestros").from("articulo_proveedor").update(row).eq("id", ex.data.id));
    else chk(await sb.schema("maestros").from("articulo_proveedor").insert(Object.assign({ articulo_id:artId, proveedor_id:sup(sid).dbId }, row)));
    $("#dlgProd").close(); toast(code ? "Artículo añadido al planificador" : "Muestra añadida al planificador (sin referencia de AX)"); await cargar();
  } catch(e){ console.error(e); err(msgErr(e)); }
  bt.disabled = false;
});

/* ===== Entrada al módulo ===== */
let lastHash = null;
export function renderPlanificador(app, r){
  if (r !== lastHash && (r === "planificador" || r === "proveedores" || r === "pagos" || r === "stock") && S.loaded && !S.loading) cargar();
  lastHash = r;
  if (!S.loaded){ if (!S.loading) cargar(); app.append(el("div","loading","Cargando el planificador…")); return; }
  if (r === "planificador"){ CUR.mon = "EUR"; return renderPlanMenu(app); }
  if (r === "stock"){ state.canWrite = puedeEditar("planificador"); renderStock(app); return soloVer(app); }
  if (r === "pagos"){ state.canWrite = puedeEditar("pagos"); renderPagos(app); return soloVer(app); }
  state.canWrite = puedeEditar("planificador");
  if (r === "proveedores"){ renderHome(app); return soloVer(app); }
  const m = r.match(/^(prov-\d+)(-pedidos)?$/);
  if (!m || !sup(m[1])){ renderHome(app); return; }
  const sid = m[1]; CUR.mon = cfg(sid).moneda || "EUR";
  const rr = { view: m[2] ? "ped" : "art", sid };
  renderSupHeader(app, rr); if (rr.view === "ped") renderOrders(app, sid); else renderArticles(app, sid);
  soloVer(app);
}
function soloVer(app){
  if (state.canWrite) return; const b = app.querySelector(".brand"); if (!b) return;
  const t = el("span","tag neutral","Solo visualización: puedes consultar y filtrar, pero no modificar datos"); t.style.cssText = "display:inline-block;margin-top:6px"; b.append(t);
}
