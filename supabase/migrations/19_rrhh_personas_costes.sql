-- =====================================================================
-- APP B10 · Personas: ficha de personas (nómina y ETT) y costes de personal
-- Módulo «rrhh». Los datos (nombres, nóminas) NO van en este repositorio: se cargan desde la app
-- (fichero de imputación de costes) o con un script aparte en el SQL Editor.
-- Después de ejecutar: Settings > Data API > Exposed schemas > añadir «rrhh».
-- =====================================================================
begin;
create schema if not exists rrhh;
grant usage on schema rrhh to authenticated;

-- Departamentos / secciones (lista editable)
create table if not exists rrhh.departamentos (
  nombre  text primary key,
  area    text,                      -- Producción, Oficina, Comercial…
  orden   int not null default 0,
  activo  boolean not null default true
);

-- Ficha de personas: nómina, ETT y externos
create table if not exists rrhh.personas (
  id              bigint generated always as identity primary key,
  codigo          text not null unique,          -- código de nómina (000009…) o interno ETT (ETT001…)
  nombre          text not null,
  tipo_vinculo    text not null default 'Nómina' check (tipo_vinculo in ('Nómina','ETT','Externo')),
  empleador       text not null default 'B10',
  empresa_ett     text,
  clasificacion   text check (clasificacion in ('M.O.D','M.O.I','M.O.E')),
  departamento    text references rrhh.departamentos(nombre) on update cascade,
  puesto          text,
  categoria       text,
  tipo_contrato   text check (tipo_contrato in ('Indefinido','Temporal','Fijo discontinuo','Prácticas','Formación','Puesta a disposición (ETT)')),
  fecha_alta      date,
  fecha_baja      date,
  motivo_baja     text check (motivo_baja in ('Despido','Baja voluntaria','Fin de contrato','Jubilación','Fin puesta a disposición','Baja (pendiente motivo)','Otros')),
  observaciones   text,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint personas_ett_empresa check (tipo_vinculo <> 'ETT' or empresa_ett is not null),
  constraint personas_fechas check (fecha_baja is null or fecha_alta is null or fecha_baja >= fecha_alta)
);

-- Histórico de altas, bajas y cambios (lo rellena un trigger)
create table if not exists rrhh.movimientos (
  id             bigint generated always as identity primary key,
  persona_id     bigint not null references rrhh.personas(id) on delete cascade,
  fecha          date not null,
  tipo           text not null,          -- Alta, Baja, Reincorporación, Cambio de departamento…
  valor_anterior text,
  valor_nuevo    text,
  usuario_id     uuid default auth.uid(),
  creado_en      timestamptz not null default now()
);
create index if not exists mov_persona_idx on rrhh.movimientos (persona_id, fecha);

-- Nómina mensual por persona (ficheros «Imputación de costes»)
--  coste_empresa = nómina ordinaria del mes (sin la paga extra no prorrateada)
--  paga_extra    = coste de la paga extra pagada aparte (fichero «Paga Extra»)
create table if not exists rrhh.nomina_mensual (
  periodo              date not null,                 -- día 1 del mes
  codigo               text not null references rrhh.personas(codigo) on update cascade,
  bruto                numeric not null default 0,
  ss_empresa           numeric not null default 0,
  coste_empresa        numeric not null default 0,
  indemnizacion        numeric not null default 0,
  it_enfermedad        numeric not null default 0,
  vacaciones_finiquito numeric not null default 0,
  horas_presencia      numeric not null default 0,
  paga_extra           numeric not null default 0,
  coste_total          numeric generated always as (coste_empresa + paga_extra) stored,
  coste_ordinario      numeric generated always as (coste_empresa - indemnizacion) stored,
  carga_id             bigint references core.cargas(id) on delete set null,
  primary key (periodo, codigo)
);

-- Periodos de puesta a disposición de las personas de ETT
create table if not exists rrhh.ett_periodos (
  id            bigint generated always as identity primary key,
  persona_id    bigint not null references rrhh.personas(id) on delete cascade,
  empresa_ett   text not null,
  fecha_inicio  date not null,
  fecha_fin     date,
  comentario    text,
  constraint ett_periodos_fechas check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

-- Proveedores de Tesorería que son ETT (sus facturas son coste de personal)
create table if not exists rrhh.ett_proveedores (
  proveedor_cod text primary key,      -- «Cod Proveedor» de Tesorería
  nombre        text not null,         -- nombre corto para la app (debe coincidir con personas.empresa_ett)
  iva_pct       numeric not null default 21
);

-- ---------------- Triggers ----------------
create or replace function rrhh.al_cambiar_persona() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into rrhh.movimientos (persona_id, fecha, tipo, valor_nuevo)
    values (new.id, coalesce(new.fecha_alta, current_date), 'Alta', concat_ws(' · ', new.tipo_vinculo, new.empresa_ett, new.departamento));
    if new.fecha_baja is not null then
      insert into rrhh.movimientos (persona_id, fecha, tipo, valor_nuevo) values (new.id, new.fecha_baja, 'Baja', new.motivo_baja);
    end if;
    return new;
  end if;
  new.actualizado_en := now();
  if new.fecha_baja is distinct from old.fecha_baja then
    if new.fecha_baja is not null then
      insert into rrhh.movimientos (persona_id, fecha, tipo, valor_nuevo) values (new.id, new.fecha_baja, 'Baja', new.motivo_baja);
    else
      insert into rrhh.movimientos (persona_id, fecha, tipo, valor_anterior) values (new.id, current_date, 'Reincorporación', old.fecha_baja::text);
    end if;
  end if;
  if new.departamento  is distinct from old.departamento  then insert into rrhh.movimientos (persona_id, fecha, tipo, valor_anterior, valor_nuevo) values (new.id, current_date, 'Cambio de departamento', old.departamento, new.departamento); end if;
  if new.clasificacion is distinct from old.clasificacion then insert into rrhh.movimientos (persona_id, fecha, tipo, valor_anterior, valor_nuevo) values (new.id, current_date, 'Cambio de clasificación', old.clasificacion, new.clasificacion); end if;
  if new.tipo_contrato is distinct from old.tipo_contrato then insert into rrhh.movimientos (persona_id, fecha, tipo, valor_anterior, valor_nuevo) values (new.id, current_date, 'Cambio de contrato', old.tipo_contrato, new.tipo_contrato); end if;
  return new;
end $$;
drop trigger if exists t_movimientos_ins on rrhh.personas;
create trigger t_movimientos_ins after insert on rrhh.personas for each row execute function rrhh.al_cambiar_persona();
drop trigger if exists t_movimientos_upd on rrhh.personas;
create trigger t_movimientos_upd before update on rrhh.personas for each row execute function rrhh.al_cambiar_persona();
drop trigger if exists t_auditoria on rrhh.personas;
create trigger t_auditoria after insert or update or delete on rrhh.personas for each row execute function core.auditar();

-- ---------------- Vistas ----------------
-- Facturas de las ETT, leídas de Tesorería (se actualizan solas al cargar el Excel de Tesorería).
-- Mes de servicio = mes de la fecha de factura. Coste = base imponible (importe / (1 + IVA)).
-- La vista se ejecuta con los permisos de su dueño y filtra por el permiso del módulo de personas.
create or replace view rrhh.v_ett_facturas as
select f.id, p.nombre as empresa_ett, f.proveedor, f.factura, f.concepto, f.fecha_factura,
       date_trunc('month', f.fecha_factura)::date as periodo,
       -f.importe as importe_total,
       round(-f.importe / (1 + p.iva_pct/100), 2) as base_imponible,
       f.vencimiento, f.pagada
from tesoreria.facturas_proveedores f
join rrhh.ett_proveedores p on p.proveedor_cod = f.proveedor_cod
where (select core.puede('rrhh')) and f.fecha_factura is not null;

-- Personas de ETT en activo y días por mes (desde 2024)
create or replace view rrhh.v_ett_activos_mes with (security_invoker = on) as
select m::date as periodo, p.id as persona_id, p.codigo, p.nombre, p.empresa_ett,
       coalesce(p.departamento, 'Sin asignar') as departamento,
       sum(least(coalesce(r.fecha_fin, current_date), (m + interval '1 month - 1 day')::date) - greatest(r.fecha_inicio, m::date) + 1)::int as dias
from rrhh.ett_periodos r
join rrhh.personas p on p.id = r.persona_id
cross join generate_series(date '2024-01-01', date_trunc('month', current_date + interval '3 months'), interval '1 month') m
where r.fecha_inicio <= (m + interval '1 month - 1 day')::date and coalesce(r.fecha_fin, current_date) >= m::date
group by 1,2,3,4,5,6;

-- ---------------- Seguridad ----------------
alter table rrhh.departamentos  enable row level security;
alter table rrhh.personas       enable row level security;
alter table rrhh.movimientos    enable row level security;
alter table rrhh.nomina_mensual enable row level security;
alter table rrhh.ett_periodos   enable row level security;
alter table rrhh.ett_proveedores enable row level security;
grant select, insert, update, delete on all tables in schema rrhh to authenticated;
grant usage on all sequences in schema rrhh to authenticated;
do $$ declare t text; begin
  foreach t in array array['departamentos','personas','movimientos','nomina_mensual','ett_periodos','ett_proveedores'] loop
    execute format('drop policy if exists %I on rrhh.%I', t||'_ver', t);
    execute format('create policy %I on rrhh.%I for select to authenticated using ((select core.puede(''rrhh'')))', t||'_ver', t);
    execute format('drop policy if exists %I on rrhh.%I', t||'_editar', t);
    execute format('create policy %I on rrhh.%I for all to authenticated using ((select core.puede(''rrhh'',''editar''))) with check ((select core.puede(''rrhh'',''editar'')))', t||'_editar', t);
  end loop; end $$;
drop policy if exists cargas_rrhh_insertar on core.cargas;
create policy cargas_rrhh_insertar on core.cargas for insert to authenticated with check (tipo = 'rrhh_nomina' and core.puede('rrhh','editar'));
drop policy if exists cargas_rrhh_ver on core.cargas;
create policy cargas_rrhh_ver on core.cargas for select to authenticated using (tipo = 'rrhh_nomina' and core.puede('rrhh'));

insert into core.modulos (codigo, nombre, grupo, orden) values ('rrhh','Costes de personal y ficha de personas','Personas',70)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo;

-- Listas iniciales (sin datos personales)
insert into rrhh.departamentos (nombre, area, orden) values
  ('Carrusel','Producción',10), ('Corte y lija','Producción',20), ('Hidros','Producción',30), ('Moldes','Producción',40),
  ('Pintura','Producción',50), ('Empaquetado','Producción',60), ('Almacén','Logística',70), ('Encargado Almacen','Logística',75),
  ('Admon-Logistica','Logística',80), ('Compras','Oficina',90), ('Admon','Oficina',100), ('Back-Office','Oficina',110),
  ('Producto','Oficina',120), ('Sistemas','Oficina',130), ('Responable Operaciones','Dirección',140),
  ('Delegado Comercial','Comercial',150), ('Dirección general','Dirección',160)
on conflict (nombre) do nothing;
insert into rrhh.ett_proveedores (proveedor_cod, nombre) values ('270','Noawork'), ('545','Interim')
on conflict (proveedor_cod) do nothing;
commit;
