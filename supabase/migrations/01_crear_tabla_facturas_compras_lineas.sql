-- B10 · Líneas de facturas de compra (exportación AX)
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- Después, importar el CSV de cada año desde Table Editor > facturas_compras_lineas > Insert > Import data from CSV.

create table if not exists public.facturas_compras_lineas (
  id                      bigint generated always as identity primary key,
  proveedor_cuenta        text        not null,          -- INVOICEACCOUNT
  proveedor_nombre        text,                          -- NAME
  proveedor_alias         text,                          -- NAMEALIAS
  factura_id              text        not null,          -- INVOICEID
  factura_fecha           date        not null,          -- INVOICEDATE
  linea                   numeric     not null,          -- LINENUM
  pais_destino            text,                          -- DESTCOUNTRYREGIONID
  articulo_id             text,                          -- ITEMID
  config_id               text,                          -- CONFIGID
  talla_id                text,                          -- INVENTSIZEID
  articulo_ref_proveedor  text,                          -- EXTERNALITEMID
  articulo_descripcion    text,                          -- NAME2
  grupo_impuesto          text,                          -- TAXGROUP
  moneda                  text,                          -- CURRENCYCODE
  unidad_precio           numeric,                       -- PRICEUNIT
  cantidad                numeric,                       -- QTY
  unidad_compra           text,                          -- PURCHUNIT
  precio_compra           numeric,                       -- PURCHPRICE (en la moneda de la factura)
  descuento_pct           numeric,                       -- DISCPERCENT
  descuento_importe       numeric,                       -- DISCAMOUNT
  importe_linea_divisa    numeric,                       -- LINEAMOUNT (en la moneda de la factura)
  importe_impuesto        numeric,                       -- TAXAMOUNT
  pedido_compra           text,                          -- PURCHID
  pedido_origen           text,                          -- ORIGPURCHID
  factura_interna         text,                          -- INTERNALINVOICEID
  asiento                 text,                          -- LEDGERVOUCHER
  invent_dim_id           text,                          -- INVENTDIMID
  fecha_inventario        date,                          -- INVENTDATE
  cantidad_inventario     numeric,                       -- INVENTQTY
  importe_eur             numeric,                       -- LINEAMOUNTMST (importe en euros, base de los análisis)
  familia_ban             text,                          -- BANFAMILYID
  tipo                    text,                          -- TIPOID
  familia                 text,                          -- FAMILIAID
  subfamilia              text,                          -- SUBFAMILIAID
  grupo_articulo          text,                          -- ITEMGROUPID
  cuenta_contable         text,                          -- LEDGERACCOUNTID
  cuenta_3d               text,                          -- 3 primeros dígitos de la cuenta
  grupo_articulo_nombre   text,                          -- Descripción del grupo de artículo
  grupo_compra            text,                          -- Import / Resinas (vacío = resto)
  anio                    int         not null,
  mes                     int         not null,
  origen_fichero          text,
  cargado_en              timestamptz not null default now()
);

-- Evita duplicar líneas si se vuelve a cargar un fichero
create unique index if not exists facturas_compras_lineas_uk
  on public.facturas_compras_lineas (proveedor_cuenta, factura_id, factura_interna, linea);

create index if not exists facturas_compras_lineas_fecha_idx     on public.facturas_compras_lineas (factura_fecha);
create index if not exists facturas_compras_lineas_proveedor_idx on public.facturas_compras_lineas (proveedor_cuenta);
create index if not exists facturas_compras_lineas_articulo_idx  on public.facturas_compras_lineas (articulo_id);
create index if not exists facturas_compras_lineas_anio_mes_idx  on public.facturas_compras_lineas (anio, mes);

-- Seguridad: la tabla queda cerrada salvo para usuarios autenticados (solo lectura).
-- Las cargas se hacen desde el panel de Supabase, que no está sujeto a estas políticas.
alter table public.facturas_compras_lineas enable row level security;

drop policy if exists "Lectura para usuarios autenticados" on public.facturas_compras_lineas;
create policy "Lectura para usuarios autenticados"
  on public.facturas_compras_lineas
  for select
  to authenticated
  using (true);
