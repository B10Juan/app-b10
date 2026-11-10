-- =====================================================================
-- APP B10 · Stock de AX (hoja INVENTSUM) y artículos a extinguir
-- =====================================================================

-- Fecha de los datos que trae cada carga (p. ej., cuándo se sacó el listado de AX)
alter table core.cargas add column if not exists fecha_datos timestamptz;

-- Stock por artículo, acabado (configuración) y almacén, tal como sale de AX
create table if not exists ax.stock_inventsum (
  id               bigint generated always as identity primary key,
  carga_id         bigint not null references core.cargas(id) on delete cascade,
  articulo_id      text   not null,      -- ITEMID
  nombre           text,                 -- ITEMNAME
  config_id        text,                 -- CONFIGID (acabado)
  talla_id         text,                 -- INVENTSIZEID
  almacen          text,                 -- INVENTLOCATIONID
  fisico           numeric,              -- PHYSICALINVENT
  reservado_fisico numeric,              -- RESERVPHYSICAL
  pedido_compra    numeric,              -- ORDERED (pendiente de recibir)
  pedido_venta     numeric,              -- ONORDER (pendiente de servir)
  reservado_pedido numeric,              -- RESERVORDERED
  disponible       numeric,              -- Disponible
  minimos          numeric,              -- Minimos
  disponible_real  numeric,              -- físico - reservado - pedido de venta
  clave            text generated always as (articulo_id || coalesce(config_id, '')) stored   -- SEARCHKEY2
);
create index if not exists stock_inventsum_carga_clave_idx on ax.stock_inventsum (carga_id, clave);

-- Stock actual: última carga de stock, sumando almacenes, por clave artículo+acabado
create or replace view ax.v_stock_actual with (security_invoker = true) as
with ultima as (
  select id, coalesce(fecha_datos, cargado_en) as fecha, fichero
  from core.cargas where tipo = 'stock' and estado = 'ok'
  order by coalesce(fecha_datos, cargado_en) desc, id desc limit 1)
select s.clave, max(s.articulo_id) as articulo_id, max(s.config_id) as config_id, max(s.nombre) as nombre,
       sum(s.disponible_real) as disponible_real, sum(s.fisico) as fisico, sum(s.reservado_fisico) as reservado_fisico,
       sum(s.pedido_venta) as pedido_venta, sum(s.pedido_compra) as pedido_compra, max(s.minimos) as minimos,
       string_agg(distinct s.almacen, ', ') as almacenes,
       u.fecha as fecha_stock, u.fichero, u.id as carga_id
from ax.stock_inventsum s join ultima u on u.id = s.carga_id
group by s.clave, u.fecha, u.fichero, u.id;

-- Parámetros del planificador por artículo y proveedor
alter table maestros.articulo_proveedor add column if not exists clave_stock text;           -- artículo + acabado (SEARCHKEY2)
alter table maestros.articulo_proveedor add column if not exists a_extinguir boolean not null default false;  -- no se vuelve a comprar
-- Proveedor que factura en AX cuando el planificador separa por fábrica (p. ej., Cankis)
alter table maestros.proveedores add column if not exists factura_proveedor_id bigint references maestros.proveedores(id);

-- Permisos
grant select on ax.stock_inventsum, ax.v_stock_actual to authenticated;
grant insert, delete on ax.stock_inventsum to authenticated;
grant usage on all sequences in schema ax, core to authenticated;
alter table ax.stock_inventsum enable row level security;
drop policy if exists stock_ver on ax.stock_inventsum;
create policy stock_ver on ax.stock_inventsum for select to authenticated using (core.usa_maestros());
drop policy if exists stock_cargar on ax.stock_inventsum;
create policy stock_cargar on ax.stock_inventsum for insert to authenticated with check (core.puede('planificador','editar'));
drop policy if exists stock_admin on ax.stock_inventsum;
create policy stock_admin on ax.stock_inventsum for delete to authenticated using (core.es_admin());

-- Quien edita el planificador puede registrar cargas de stock y ver su historial
drop policy if exists cargas_stock_insertar on core.cargas;
create policy cargas_stock_insertar on core.cargas for insert to authenticated
  with check (tipo = 'stock' and core.puede('planificador','editar'));
drop policy if exists cargas_stock_ver on core.cargas;
create policy cargas_stock_ver on core.cargas for select to authenticated
  using (tipo = 'stock' and core.usa_maestros());
