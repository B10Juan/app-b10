// APP B10 · Imagen de marca (logo e imágenes de la web b10bath.com)
// Para no depender de la web, se pueden copiar estos ficheros a la carpeta /img del repositorio y cambiar aquí las rutas.
const W = "https://b10bath.com/wp-content/uploads";
export const MARCA = {
  logo: `${W}/2024/03/logo-b10.png`,
  lema: `${W}/2024/03/be-bath-b10-1024x174.png`,
  img: {
    compras:      `${W}/2025/12/washbasins-collecion-b10-02-1300x750.jpg`,
    planificador: `${W}/2025/12/bathtubs-collecion-b10-01.jpg`,
    proveedores:  `${W}/2025/12/bathtubs-collecion-b10-02-1300x750.jpg`,
    pagos:        `${W}/2025/12/shower-collecion-b10-02-1300x750.jpg`,
    plan_accion:  `${W}/2025/12/shower-collecion-b10-01.jpg`,
    crm:          `${W}/2025/12/shower-collecion-b10-02-1300x750.jpg`,
    usuarios:     `${W}/2025/12/shower-collecion-b10-01.jpg`,
    operaciones:  `${W}/2025/12/bathtubs-collecion-b10-02-1300x750.jpg`,
    comercial:    `${W}/2025/12/washbasins-collecion-b10-01.jpg`,
  },
};

// Logo; si no carga, se muestra el texto «b10»
export function logo(cls){
  const i = document.createElement("img"); i.src = MARCA.logo; i.alt = "b10"; i.className = cls; i.decoding = "async";
  i.onerror = () => { const s = document.createElement("span"); s.className = cls + " txt"; s.textContent = "b10"; i.replaceWith(s); };
  return i;
}

// Convierte una tarjeta de módulo en tarjeta con imagen arriba
export function conImagen(card, clave){
  const src = MARCA.img[clave]; if (!src) return card;
  const body = document.createElement("div"); body.className = "mod-body";
  while (card.firstChild) body.append(card.firstChild);
  const f = document.createElement("div"); f.className = "mod-img";
  const i = document.createElement("img"); i.src = src; i.alt = ""; i.loading = "lazy"; i.decoding = "async"; i.onerror = () => f.remove();
  f.append(i); card.classList.add("has-img"); card.append(f, body);
  return card;
}

// Iconos de la banda lateral
const P = {
  inicio:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  compras:'<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
  planificador:'<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="M8 14h3M13 14h3M8 17h3"/>',
  pagos:'<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
  plan:'<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="13" cy="18" r="2"/>',
  usuarios:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.6.8 2.7 2.5 3 5.2"/>',
  clave:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  salir:'<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
};
export function icono(n){
  const s = document.createElementNS("http://www.w3.org/2000/svg","svg");
  s.setAttribute("viewBox","0 0 24 24"); s.setAttribute("aria-hidden","true"); s.setAttribute("fill","none"); s.setAttribute("stroke","currentColor");
  s.setAttribute("stroke-width","1.7"); s.setAttribute("stroke-linecap","round"); s.setAttribute("stroke-linejoin","round"); s.innerHTML = P[n] || "";
  return s;
}
