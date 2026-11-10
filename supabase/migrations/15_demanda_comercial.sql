-- =====================================================================
-- APP B10 · Comercial: análisis de la demanda (diario de pedidos de venta de AX)
-- Tablas en «ax» (datos tal como salen del Excel Diario_Demanda_Cartera)
-- Funciones de análisis en «comercial» (agregan en la base de datos)
-- =====================================================================
begin;
create schema if not exists comercial;
grant usage on schema comercial to authenticated;

-- Líneas del diario de pedidos (cada alta, modificación o anulación de línea; las negativas restan)
create table if not exists ax.pedidos_venta_diario (
  id                    bigint generated always as identity primary key,
  carga_id              bigint references core.cargas(id) on delete cascade,
  anio_fichero          int not null,
  fecha                 timestamp not null,              -- CREATEDDATETIME
  fecha_dia             date generated always as (fecha::date) stored,
  anio                  int generated always as (extract(year from fecha)::int) stored,
  mes                   int generated always as (extract(month from fecha)::int) stored,
  semana                int generated always as (extract(week from fecha)::int) stored,      -- ISO
  pedido                text,                             -- SALESID
  linea                 numeric,                          -- LINENUM
  articulo_id           text,                             -- ITEMID
  config_id             text,                             -- CONFIGID (acabado)
  talla_id              text,
  ancho                 numeric,
  alto                  numeric,
  descripcion           text,                             -- NAME
  cliente_id            text,                             -- CUSTACCOUNT
  cliente_nombre        text,                             -- SALESNAME
  cantidad              numeric,                          -- QTYORDERED
  importe               numeric,                          -- LINEAMOUNT (EUR)
  moneda                text,
  grupo_comercial       text,                             -- SALESGROUP
  grupo_comercial_nombre text,                            -- Desc. SALESGROUP
  pedido_cliente        text,                             -- PURCHORDERFORMNUM
  modo_entrega          text,
  provincia_envio_cod   text,
  pais_envio_cod        text,
  uen                   text,
  familia               text,
  producto              text,
  articulo_nombre       text,
  origen                text,
  zona                  text,
  pais                  text,
  provincia_envio       text,
  tipo_cliente          text,                             -- SHOPGROUPID
  cliente_alta          timestamp,
  delegado              text,
  provincia_cliente     text,
  top                   boolean
);
create index if not exists pvd_anio_idx on ax.pedidos_venta_diario (anio, mes);
create index if not exists pvd_fichero_idx on ax.pedidos_venta_diario (anio_fichero);
create index if not exists pvd_cliente_idx on ax.pedidos_venta_diario (cliente_id);
create index if not exists pvd_articulo_idx on ax.pedidos_venta_diario (articulo_id);

-- Cartera pendiente de servir (foto del momento de la carga; se sustituye en cada carga)
create table if not exists ax.cartera_pendiente (
  id                    bigint generated always as identity primary key,
  carga_id              bigint references core.cargas(id) on delete cascade,
  lote                  text,                             -- INVENTTRANSID
  pedido                text, cliente_nombre text, cliente_id text, linea numeric,
  articulo_id text, config_id text, talla_id text, descripcion text, almacen text,
  cantidad numeric, pendiente numeric, precio numeric, dto numeric, dto_pct numeric, importe numeric, moneda text,
  fecha_pedido timestamp, fecha_entrega_solicitada date,
  grupo_comercial text, grupo_comercial_nombre text, pedido_cliente text, provincia_envio_cod text, pais_envio_cod text,
  importe_pendiente numeric, uen text, familia text, producto text, articulo_nombre text, origen text
);

-- Seguridad: lo ve quien tiene acceso al módulo de demanda; solo los administradores cargan
alter table ax.pedidos_venta_diario enable row level security;
alter table ax.cartera_pendiente enable row level security;
grant select on ax.pedidos_venta_diario, ax.cartera_pendiente to authenticated;
grant insert, delete on ax.pedidos_venta_diario, ax.cartera_pendiente to authenticated;
drop policy if exists demanda_ver on ax.pedidos_venta_diario;
create policy demanda_ver on ax.pedidos_venta_diario for select to authenticated using (core.puede('demanda'));
drop policy if exists demanda_cargar on ax.pedidos_venta_diario;
create policy demanda_cargar on ax.pedidos_venta_diario for all to authenticated using (core.puede('demanda','editar')) with check (core.puede('demanda','editar'));
drop policy if exists cartera_ver on ax.cartera_pendiente;
create policy cartera_ver on ax.cartera_pendiente for select to authenticated using (core.puede('demanda'));
drop policy if exists cartera_cargar on ax.cartera_pendiente;
create policy cartera_cargar on ax.cartera_pendiente for all to authenticated using (core.puede('demanda','editar')) with check (core.puede('demanda','editar'));
drop policy if exists cargas_demanda_insertar on core.cargas;
create policy cargas_demanda_insertar on core.cargas for insert to authenticated with check (tipo in ('pedidos_venta','cartera') and core.puede('demanda','editar'));
drop policy if exists cargas_demanda_ver on core.cargas;
create policy cargas_demanda_ver on core.cargas for select to authenticated using (tipo in ('pedidos_venta','cartera') and core.puede('demanda'));

-- ---------------------------------------------------------------------
-- Funciones de análisis. Todas reciben los filtros en un JSON:
-- {"anios":[2025,2026], "hasta":"11-10", "uen":[..], "familia":[..], "producto":[..], "articulo":[..], "config":[..],
--  "cliente":[..], "delegado":[..], "zona":[..], "pais":[..], "tipo_cliente":[..], "grupo":[..], "top":["1"]}
-- «hasta» (MM-DD) recorta todos los años hasta ese día para comparar el mismo periodo.
-- ---------------------------------------------------------------------
create or replace function comercial._en(p jsonb, k text, v text) returns boolean language sql immutable as $$
  select p->k is null or jsonb_typeof(p->k) <> 'array' or jsonb_array_length(p->k) = 0 or (p->k) ? coalesce(v, '')
$$;

create or replace function comercial._filtro(p jsonb, d ax.pedidos_venta_diario) returns boolean language sql stable as $$
  select (p->'anios' is null or jsonb_array_length(p->'anios') = 0 or (p->'anios') @> to_jsonb(d.anio))
     and (coalesce(p->>'hasta','') = '' or to_char(d.fecha_dia, 'MM-DD') <= p->>'hasta')
     and comercial._en(p,'uen',d.uen) and comercial._en(p,'familia',d.familia) and comercial._en(p,'producto',d.producto)
     and comercial._en(p,'articulo',d.articulo_id) and comercial._en(p,'config',d.config_id)
     and comercial._en(p,'cliente',d.cliente_id) and comercial._en(p,'delegado',d.delegado) and comercial._en(p,'zona',d.zona)
     and comercial._en(p,'pais',d.pais) and comercial._en(p,'tipo_cliente',d.tipo_cliente) and comercial._en(p,'grupo',d.grupo_comercial)
     and comercial._en(p,'origen',d.origen) and comercial._en(p,'top', case when d.top then '1' else '0' end)
$$;

-- Serie temporal por año y periodo (mes, trimestre, semana o día del año)
create or replace function comercial.demanda_serie(p jsonb, gran text default 'mes')
returns table (anio int, periodo int, importe numeric, unidades numeric, lineas bigint, pedidos bigint, clientes bigint)
language sql stable security invoker as $$
  select d.anio,
         case gran when 'trimestre' then ((d.mes - 1) / 3 + 1) when 'semana' then d.semana when 'dia' then extract(doy from d.fecha_dia)::int else d.mes end,
         round(sum(d.importe), 2), sum(d.cantidad), count(*), count(distinct d.pedido), count(distinct d.cliente_id)
  from ax.pedidos_venta_diario d where comercial._filtro(p, d)
  group by 1, 2 order by 1, 2;
$$;

-- Desglose por una dimensión y año
create or replace function comercial.demanda_desglose(p jsonb, dim text)
returns table (clave text, nombre text, anio int, importe numeric, unidades numeric, lineas bigint, pedidos bigint, clientes bigint)
language sql stable security invoker as $$
  select k.clave, max(k.nombre), d.anio, round(sum(d.importe), 2), sum(d.cantidad), count(*), count(distinct d.pedido), count(distinct d.cliente_id)
  from ax.pedidos_venta_diario d
  cross join lateral (select
     case dim when 'uen' then d.uen when 'familia' then d.familia when 'producto' then d.producto when 'articulo' then d.articulo_id
              when 'config' then d.config_id when 'cliente' then d.cliente_id when 'delegado' then d.delegado when 'zona' then d.zona
              when 'pais' then d.pais when 'tipo_cliente' then d.tipo_cliente when 'grupo' then d.grupo_comercial when 'origen' then d.origen
              when 'provincia' then d.provincia_envio when 'top' then case when d.top then '1' else '0' end end as clave,
     case dim when 'articulo' then coalesce(d.articulo_nombre, d.descripcion) when 'cliente' then d.cliente_nombre
              when 'grupo' then d.grupo_comercial_nombre when 'top' then case when d.top then 'Clientes TOP' else 'Resto de clientes' end else null end as nombre) k
  where comercial._filtro(p, d)
  group by k.clave, d.anio;
$$;

-- Detalle de líneas (paginado)
create or replace function comercial.demanda_lineas(p jsonb, lim int default 200, off int default 0)
returns setof ax.pedidos_venta_diario language sql stable security invoker as $$
  select d.* from ax.pedidos_venta_diario d where comercial._filtro(p, d) order by d.fecha desc limit least(lim, 2000) offset off;
$$;

-- Información de las cargas y fechas de los datos
create or replace function comercial.demanda_info()
returns table (anio int, desde date, hasta date, lineas bigint, importe numeric) language sql stable security invoker as $$
  select anio, min(fecha_dia), max(fecha_dia), count(*), round(sum(importe), 2) from ax.pedidos_venta_diario group by anio order by anio;
$$;

grant execute on all functions in schema comercial to authenticated;

insert into core.modulos (codigo, nombre, grupo, orden) values ('demanda', 'Análisis de la demanda', 'Comercial', 45)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo;
commit;
