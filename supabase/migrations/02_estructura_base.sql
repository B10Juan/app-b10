-- =====================================================================
-- APP B10 · Estructura base (bloque 1)
-- Esquemas: core (usuarios y permisos), maestros (proveedores y artículos),
--           ax (datos importados del ERP)
-- Ejecutar en Supabase > SQL Editor. Se puede ejecutar más de una vez.
-- Después: Settings > API > Exposed schemas: añadir core, maestros, ax
-- =====================================================================

create schema if not exists core;
create schema if not exists maestros;
create schema if not exists ax;

grant usage on schema core, maestros, ax to authenticated;

-- ---------------------------------------------------------------------
-- Utilidades comunes
-- ---------------------------------------------------------------------
create or replace function core.set_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- CORE: módulos, usuarios y permisos
-- ---------------------------------------------------------------------
create table if not exists core.modulos (
  codigo  text primary key,
  nombre  text not null,
  grupo   text,
  orden   int  not null default 0
);

create table if not exists core.usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  nombre     text,
  es_admin   boolean not null default false,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Sin fila = sin acceso. 'ver' = consulta, 'editar' = edición.
create table if not exists core.permisos (
  usuario_id uuid not null references core.usuarios(id) on delete cascade,
  modulo     text not null references core.modulos(codigo) on delete cascade,
  nivel      text not null check (nivel in ('ver','editar')),
  primary key (usuario_id, modulo)
);

-- Alta automática en core.usuarios cuando se invita o registra a alguien en Supabase Auth
create or replace function core.alta_usuario()
returns trigger language plpgsql security definer set search_path = core, public as $$
begin
  insert into core.usuarios (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function core.alta_usuario();

-- Funciones de permiso que usan todas las políticas
create or replace function core.es_admin()
returns boolean language sql stable security definer set search_path = core as $$
  select coalesce((select es_admin and activo from core.usuarios where id = auth.uid()), false);
$$;

create or replace function core.puede(p_modulo text, p_nivel text default 'ver')
returns boolean language sql stable security definer set search_path = core as $$
  select core.es_admin() or exists (
    select 1 from core.permisos p join core.usuarios u on u.id = p.usuario_id
    where p.usuario_id = auth.uid() and u.activo and p.modulo = p_modulo
      and (p_nivel = 'ver' or p.nivel = 'editar'));
$$;

-- Acceso a algún módulo que usa los datos maestros
create or replace function core.usa_maestros(p_nivel text default 'ver')
returns boolean language sql stable security definer set search_path = core as $$
  select core.puede('planificador', p_nivel) or core.puede('pagos', p_nivel) or core.puede('compras', p_nivel);
$$;

-- ---------------------------------------------------------------------
-- CORE: registro de cargas y auditoría de cambios
-- ---------------------------------------------------------------------
create table if not exists core.cargas (
  id             bigint generated always as identity primary key,
  tipo           text not null,            -- 'facturas_compra', 'stock', 'ventas'...
  fichero        text,
  periodo        text,                     -- '2026', '2025-T1'...
  filas          int,
  importe_total  numeric,
  estado         text not null default 'ok' check (estado in ('ok','anulada')),
  notas          text,
  cargado_por    uuid default auth.uid(),
  cargado_en     timestamptz not null default now()
);

create table if not exists core.auditoria (
  id          bigint generated always as identity primary key,
  tabla       text not null,
  registro_id text,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  usuario_id  uuid default auth.uid(),
  fecha       timestamptz not null default now()
);

create or replace function core.auditar()
returns trigger language plpgsql security definer set search_path = core, public as $$
begin
  insert into core.auditoria (tabla, registro_id, accion, antes, despues)
  values (tg_table_schema || '.' || tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', null),
          tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- MAESTROS: proveedores
-- ---------------------------------------------------------------------
create table if not exists maestros.proveedores (
  id                        bigint generated always as identity primary key,
  codigo_ax                 text unique,                 -- INVOICEACCOUNT de AX
  nombre                    text not null,
  alias                     text,
  pais                      text,
  moneda                    text not null default 'EUR' check (moneda in ('EUR','USD')),
  grupo_compra              text,                        -- 'Import', 'Resinas'... (vacío = nacional general)
  es_importacion            boolean not null default false,
  contacto                  text,
  email                     text,
  telefono                  text,
  -- Condiciones logísticas para el planificador (semanas)
  plazo_semanas             int,                         -- pedido -> llegada a puerto
  transito_semanas          int,                         -- embarque -> llegada a puerto
  despacho_semanas          int default 1,               -- llegada a puerto -> entrada en almacén
  -- Condiciones de pago
  dias_pago_antes_embarque  int,
  deposito_pct              numeric check (deposito_pct between 0 and 100),
  condiciones_pago          text,
  activo                    boolean not null default true,
  notas                     text,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  actualizado_por           uuid
);

-- ---------------------------------------------------------------------
-- MAESTROS: grupos de artículo (de AX) y artículos
-- ---------------------------------------------------------------------
create table if not exists maestros.grupos_articulo (
  codigo          text primary key,                      -- ITEMGROUPID
  nombre          text not null,
  cuenta_consumo  text
);

-- Un artículo puede existir en AX (codigo_ax) o ser provisional (muestra sin referencia).
create table if not exists maestros.articulos (
  id                  bigint generated always as identity primary key,
  codigo_ax           text unique,                       -- ITEMID; vacío = no dado de alta en AX
  descripcion         text not null,
  estado              text not null default 'activo'
                      check (estado in ('activo','muestra','descartado','baja')),
  en_ax               boolean generated always as (codigo_ax is not null) stored,
  modelo              text,
  tipo                text,                              -- TIPOID
  familia             text,                              -- FAMILIAID
  subfamilia          text,                              -- SUBFAMILIAID
  grupo_articulo      text references maestros.grupos_articulo(codigo),
  -- Parámetros de planificación (hasta que se carguen stock y ventas de AX)
  stock_actual        numeric,
  venta_media_semanal numeric,
  stock_seguridad     numeric,
  notas               text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  actualizado_por     uuid,
  -- Solo las muestras pueden no tener código de AX
  constraint articulo_activo_con_codigo check (estado in ('muestra','descartado') or codigo_ax is not null)
);

-- Relación artículo-proveedor: el mismo artículo puede comprarse a varios proveedores
create table if not exists maestros.articulo_proveedor (
  id                bigint generated always as identity primary key,
  articulo_id       bigint not null references maestros.articulos(id) on delete cascade,
  proveedor_id      bigint not null references maestros.proveedores(id) on delete cascade,
  ref_proveedor     text,                                -- EXTERNALITEMID
  precio            numeric,
  moneda            text not null default 'EUR' check (moneda in ('EUR','USD')),
  uds_pallet        int check (uds_pallet >= 1),
  principal         boolean not null default false,      -- proveedor habitual
  activo            boolean not null default true,
  actualizado_en    timestamptz not null default now(),
  actualizado_por   uuid,
  unique (articulo_id, proveedor_id)
);
create unique index if not exists articulo_un_principal
  on maestros.articulo_proveedor (articulo_id) where principal;

-- Disparadores de fecha de actualización y auditoría
do $$ declare t text; begin
  foreach t in array array['maestros.proveedores','maestros.articulos','maestros.articulo_proveedor'] loop
    execute format('drop trigger if exists t_actualizado on %s', t);
    execute format('create trigger t_actualizado before update on %s for each row execute function core.set_actualizado()', t);
    execute format('drop trigger if exists t_auditoria on %s', t);
    execute format('create trigger t_auditoria after insert or update or delete on %s for each row execute function core.auditar()', t);
  end loop;
end $$;
drop trigger if exists t_auditoria on core.permisos;
create trigger t_auditoria after insert or update or delete on core.permisos for each row execute function core.auditar();

-- ---------------------------------------------------------------------
-- AX: líneas de facturas de compra
-- Si ya creaste la tabla con el script 01 en el esquema public, se mueve aquí.
-- ---------------------------------------------------------------------
do $$ begin
  if to_regclass('public.facturas_compras_lineas') is not null
     and to_regclass('ax.facturas_compras_lineas') is null then
    alter table public.facturas_compras_lineas set schema ax;
  end if;
end $$;

create table if not exists ax.facturas_compras_lineas (
  id                      bigint generated always as identity primary key,
  proveedor_cuenta        text        not null,
  proveedor_nombre        text,
  proveedor_alias         text,
  factura_id              text        not null,
  factura_fecha           date        not null,
  linea                   numeric     not null,
  pais_destino            text,
  articulo_id             text,
  config_id               text,
  talla_id                text,
  articulo_ref_proveedor  text,
  articulo_descripcion    text,
  grupo_impuesto          text,
  moneda                  text,
  unidad_precio           numeric,
  cantidad                numeric,
  unidad_compra           text,
  precio_compra           numeric,
  descuento_pct           numeric,
  descuento_importe       numeric,
  importe_linea_divisa    numeric,
  importe_impuesto        numeric,
  pedido_compra           text,
  pedido_origen           text,
  factura_interna         text,
  asiento                 text,
  invent_dim_id           text,
  fecha_inventario        date,
  cantidad_inventario     numeric,
  importe_eur             numeric,
  familia_ban             text,
  tipo                    text,
  familia                 text,
  subfamilia              text,
  grupo_articulo          text,
  cuenta_contable         text,
  cuenta_3d               text,
  grupo_articulo_nombre   text,
  grupo_compra            text,
  anio                    int         not null,
  mes                     int         not null,
  origen_fichero          text,
  cargado_en              timestamptz not null default now()
);
alter table ax.facturas_compras_lineas add column if not exists carga_id bigint references core.cargas(id);

create unique index if not exists facturas_compras_lineas_uk
  on ax.facturas_compras_lineas (proveedor_cuenta, factura_id, factura_interna, linea);
create index if not exists facturas_compras_lineas_fecha_idx     on ax.facturas_compras_lineas (factura_fecha);
create index if not exists facturas_compras_lineas_proveedor_idx on ax.facturas_compras_lineas (proveedor_cuenta);
create index if not exists facturas_compras_lineas_articulo_idx  on ax.facturas_compras_lineas (articulo_id);
create index if not exists facturas_compras_lineas_anio_mes_idx  on ax.facturas_compras_lineas (anio, mes);

-- ---------------------------------------------------------------------
-- PERMISOS DE TABLA (la seguridad real la ponen las políticas RLS)
-- ---------------------------------------------------------------------
grant select on all tables in schema core, maestros, ax to authenticated;
grant insert, update, delete on core.usuarios, core.permisos, core.cargas to authenticated;
grant insert, update, delete on maestros.proveedores, maestros.articulos, maestros.articulo_proveedor, maestros.grupos_articulo to authenticated;
grant insert, update, delete on ax.facturas_compras_lineas to authenticated;
grant usage on all sequences in schema core, maestros, ax to authenticated;
revoke all on all tables in schema core, maestros, ax from anon;

-- ---------------------------------------------------------------------
-- POLÍTICAS RLS
-- ---------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['core.modulos','core.usuarios','core.permisos','core.cargas','core.auditoria',
                           'maestros.proveedores','maestros.grupos_articulo','maestros.articulos','maestros.articulo_proveedor',
                           'ax.facturas_compras_lineas'] loop
    execute format('alter table %s enable row level security', t);
  end loop;
end $$;

-- core
drop policy if exists modulos_ver on core.modulos;
create policy modulos_ver on core.modulos for select to authenticated using (true);

drop policy if exists usuarios_ver on core.usuarios;
create policy usuarios_ver on core.usuarios for select to authenticated using (id = auth.uid() or core.es_admin());
drop policy if exists usuarios_admin on core.usuarios;
create policy usuarios_admin on core.usuarios for all to authenticated using (core.es_admin()) with check (core.es_admin());

drop policy if exists permisos_ver on core.permisos;
create policy permisos_ver on core.permisos for select to authenticated using (usuario_id = auth.uid() or core.es_admin());
drop policy if exists permisos_admin on core.permisos;
create policy permisos_admin on core.permisos for all to authenticated using (core.es_admin()) with check (core.es_admin());

drop policy if exists cargas_ver on core.cargas;
create policy cargas_ver on core.cargas for select to authenticated using (core.puede('compras'));
drop policy if exists cargas_admin on core.cargas;
create policy cargas_admin on core.cargas for all to authenticated using (core.es_admin()) with check (core.es_admin());

drop policy if exists auditoria_admin on core.auditoria;
create policy auditoria_admin on core.auditoria for select to authenticated using (core.es_admin());

-- maestros: los ve quien usa planificador, pagos o compras; los edita quien tiene edición en el planificador
do $$ declare t text; begin
  foreach t in array array['maestros.proveedores','maestros.grupos_articulo','maestros.articulos','maestros.articulo_proveedor'] loop
    execute format('drop policy if exists maestros_ver on %s', t);
    execute format('create policy maestros_ver on %s for select to authenticated using (core.usa_maestros())', t);
    execute format('drop policy if exists maestros_editar on %s', t);
    execute format('create policy maestros_editar on %s for all to authenticated using (core.puede(''planificador'',''editar'')) with check (core.puede(''planificador'',''editar''))', t);
  end loop;
end $$;

-- ax: las facturas las ve quien tiene acceso al módulo Compras; solo los administradores cargan
drop policy if exists "Lectura para usuarios autenticados" on ax.facturas_compras_lineas;
drop policy if exists facturas_ver on ax.facturas_compras_lineas;
create policy facturas_ver on ax.facturas_compras_lineas for select to authenticated using (core.puede('compras'));
drop policy if exists facturas_admin on ax.facturas_compras_lineas;
create policy facturas_admin on ax.facturas_compras_lineas for all to authenticated using (core.es_admin()) with check (core.es_admin());

-- ---------------------------------------------------------------------
-- Módulos de la APP B10
-- ---------------------------------------------------------------------
insert into core.modulos (codigo, nombre, grupo, orden) values
  ('planificador', 'Planificador de compras',          'Planificador de compras', 10),
  ('pagos',        'Previsión pagos importaciones',    'Planificador de compras', 20),
  ('compras',      'Compras (dashboard de facturas)',  'Compras',                 30),
  ('plan_accion',  'Plan de acción del plan estratégico', 'Plan de acción',       40),
  ('crm',          'CRM de clientes',                  'CRM',                     50)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo, orden = excluded.orden;
