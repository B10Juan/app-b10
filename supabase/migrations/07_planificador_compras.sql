-- =====================================================================
-- APP B10 · Planificador de compras y previsión de pagos de importación
-- Esquema compras: previsión de venta semanal y pedidos (con versiones)
-- Después: Settings > Data API > Exposed schemas: añadir compras
-- =====================================================================

create schema if not exists compras;
grant usage on schema compras to authenticated;

-- Parámetros que usa el planificador en los maestros
alter table maestros.proveedores        add column if not exists cobertura_semanas int default 8;
alter table maestros.articulo_proveedor add column if not exists planificar boolean not null default false;  -- aparece en el planificador
alter table maestros.articulo_proveedor add column if not exists orden int;

-- Venta prevista modificada a mano (promociones, cambios de tendencia).
-- Si una semana no tiene fila, se usa la venta media semanal del artículo.
create table if not exists compras.prevision_venta (
  articulo_id      bigint not null references maestros.articulos(id) on delete cascade,
  semana           date   not null check (extract(isodow from semana) = 1),   -- lunes de la semana
  unidades         numeric not null check (unidades >= 0),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid,
  primary key (articulo_id, semana)
);

-- Pedidos de importación.
--   estado 'pendiente': cantidades previstas por semana, todavía sin número de pedido
--   estado 'lanzado'  : pedido con número; sus cambios quedan en «modificacion» hasta que el proveedor los valida
-- lineas / precios: {"<id de artículo>": cantidad | precio}
create table if not exists compras.pedidos (
  id               bigint generated always as identity primary key,
  proveedor_id     bigint not null references maestros.proveedores(id),
  estado           text   not null check (estado in ('pendiente','lanzado')),
  referencia       text,                       -- Nº de pedido
  crd              date,                       -- fin de producción
  etd              date,                       -- embarque
  eta              date   not null,            -- llegada a puerto
  naviera          text,
  tamano           text check (tamano is null or tamano in ('grupaje','20','40','40hc')),
  lineas           jsonb  not null default '{}'::jsonb,
  precios          jsonb  not null default '{}'::jsonb,
  modificacion     jsonb,                      -- {"lines":{...},"prices":{...},"at":"aaaa-mm-dd"} pendiente de validar
  historial        jsonb  not null default '[]'::jsonb,   -- versiones anteriores
  pagado_en        date,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid,
  constraint pedido_lanzado_con_numero check (estado = 'pendiente' or nullif(trim(referencia),'') is not null)
);
create unique index if not exists pedidos_referencia_uk on compras.pedidos (proveedor_id, lower(referencia)) where estado = 'lanzado';
create index if not exists pedidos_proveedor_idx on compras.pedidos (proveedor_id, eta);

-- Vista de líneas (para análisis y cruces con facturas)
create or replace view compras.v_pedido_lineas with (security_invoker = true) as
select p.id as pedido_id, p.proveedor_id, p.estado, p.referencia, p.eta, p.etd,
       (l.key)::bigint as articulo_id,
       (l.value #>> '{}')::numeric as cantidad,
       coalesce((p.precios ->> l.key)::numeric, ap.precio) as precio,
       (p.modificacion is not null) as con_modificacion
from compras.pedidos p
cross join lateral jsonb_each(case when p.modificacion is not null then p.modificacion->'lines' else p.lineas end) l
left join maestros.articulo_proveedor ap on ap.articulo_id = (l.key)::bigint and ap.proveedor_id = p.proveedor_id;

-- Fechas de actualización y auditoría
drop trigger if exists t_actualizado on compras.pedidos;
create trigger t_actualizado before update on compras.pedidos for each row execute function core.set_actualizado();
drop trigger if exists t_auditoria on compras.pedidos;
create trigger t_auditoria after insert or update or delete on compras.pedidos for each row execute function core.auditar();
drop trigger if exists t_actualizado on compras.prevision_venta;
create trigger t_actualizado before update on compras.prevision_venta for each row execute function core.set_actualizado();

-- Permisos de tabla y seguridad por fila
grant select, insert, update, delete on compras.pedidos, compras.prevision_venta to authenticated;
grant select on compras.v_pedido_lineas to authenticated;
grant usage on all sequences in schema compras to authenticated;
revoke all on all tables in schema compras from anon;
alter table compras.pedidos enable row level security;
alter table compras.prevision_venta enable row level security;

drop policy if exists pedidos_ver on compras.pedidos;
create policy pedidos_ver on compras.pedidos for select to authenticated
  using (core.puede('planificador') or core.puede('pagos'));
drop policy if exists pedidos_editar on compras.pedidos;
create policy pedidos_editar on compras.pedidos for all to authenticated
  using (core.puede('planificador','editar')) with check (core.puede('planificador','editar'));
-- Quien edita pagos puede marcar pedidos como pagados (la app solo le deja tocar ese campo)
drop policy if exists pedidos_pagar on compras.pedidos;
create policy pedidos_pagar on compras.pedidos for update to authenticated
  using (core.puede('pagos','editar')) with check (core.puede('pagos','editar'));

drop policy if exists prevision_ver on compras.prevision_venta;
create policy prevision_ver on compras.prevision_venta for select to authenticated using (core.puede('planificador'));
drop policy if exists prevision_editar on compras.prevision_venta;
create policy prevision_editar on compras.prevision_venta for all to authenticated
  using (core.puede('planificador','editar')) with check (core.puede('planificador','editar'));

-- Los maestros también los ve quien tiene acceso a pagos (ya incluido en core.usa_maestros)
