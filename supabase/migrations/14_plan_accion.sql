-- =====================================================================
-- APP B10 · Plan de Acción del Plan Estratégico (esquema plan)
-- Misma estructura que la app de seguimiento de Almesa:
-- planes › líneas estratégicas › acciones clave › actividades › tareas y subtareas
-- Los permisos salen de la Gestión de usuarios de APP B10 (módulo plan_accion).
-- =====================================================================
begin;
create schema if not exists plan;
grant usage on schema plan to authenticated;

create table if not exists plan.areas (
  nombre  text primary key,
  orden   integer
);

create table if not exists plan.responsables (
  codigo      text primary key check (codigo ~ '^[A-Z0-9ÑÁÉÍÓÚ]{1,6}$'),
  nombre      text not null,
  area        text not null default '',
  email       text not null default '',
  activo      boolean not null default true,
  orden       integer,
  actualizado timestamptz not null default now()
);

create table if not exists plan.planes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  descripcion text not null default '',
  inicio      date,
  fin         date,
  estado      text not null default 'activo',
  orden       integer,
  creado      timestamptz not null default now()
);

create table if not exists plan.categorias (
  id        uuid primary key default gen_random_uuid(),
  plan_id   uuid references plan.planes(id) on delete cascade,
  nivel     text not null check (nivel in ('modulo','grupo','subgrupo')),
  modulo    text not null default '',
  grupo     text not null default '',
  subgrupo  text not null default '',
  orden     integer,
  constraint categorias_uk unique (plan_id, nivel, modulo, grupo, subgrupo)
);

create table if not exists plan.acciones (
  id              text primary key default gen_random_uuid()::text,
  plan_id         uuid references plan.planes(id) on delete cascade,
  padre           text references plan.acciones(id) on delete cascade,
  modulo          text not null default '',
  grupo           text not null default '',
  subgrupo        text not null default '',
  actividad       text not null,
  estado          text not null default 'Pendiente' check (estado in ('Pendiente','En curso','Standby','Cerrada')),
  responsable     text not null default '',
  prioridad       text not null default '' check (prioridad in ('','Alta','Media','Baja')),
  inicio          date,
  fin             date,
  notas           text not null default '',
  orden           integer,
  historial       jsonb not null default '[]'::jsonb,
  creado          timestamptz not null default now(),
  actualizado     timestamptz not null default now(),
  actualizado_por uuid references auth.users(id) on delete set null,
  constraint fechas_ok check (inicio is null or fin is null or fin >= inicio)
);
create index if not exists acciones_padre_idx on plan.acciones(padre);
create index if not exists acciones_plan_idx on plan.acciones(plan_id);

-- Usuario de APP B10 ↔ responsable del plan (para «Mis tareas»)
create table if not exists plan.usuario_responsable (
  usuario_id  uuid primary key references core.usuarios(id) on delete cascade,
  responsable text references plan.responsables(codigo) on update cascade on delete set null
);

-- Perfil que espera la app, calculado desde los permisos de APP B10
create or replace view plan.perfiles with (security_invoker = true) as
select u.id,
       split_part(u.email, '@', 1) as usuario,
       coalesce(u.nombre, '') as nombre,
       ur.responsable,
       case when u.es_admin then 'admin'
            when p.nivel = 'editar' then 'encargado'
            else 'lector' end as rol,
       (u.activo and (u.es_admin or p.nivel is not null)) as activo,
       false as cambiar_password,
       u.creado_en as creado
from core.usuarios u
left join core.permisos p on p.usuario_id = u.id and p.modulo = 'plan_accion'
left join plan.usuario_responsable ur on ur.usuario_id = u.id;

create or replace function plan.marcar_password_cambiada() returns void language sql as $$ select null::void $$;

-- Fecha y autor de la última modificación de cada acción
create or replace function plan.set_actualizado() returns trigger language plpgsql as $$
begin new.actualizado := now(); new.actualizado_por := auth.uid(); return new; end $$;
drop trigger if exists t_actualizado on plan.acciones;
create trigger t_actualizado before update on plan.acciones for each row execute function plan.set_actualizado();
drop trigger if exists t_auditoria on plan.acciones;
create trigger t_auditoria after insert or update or delete on plan.acciones for each row execute function core.auditar();

-- Permisos
grant select on plan.perfiles to authenticated;
grant select, insert, update, delete on plan.areas, plan.responsables, plan.planes, plan.categorias, plan.acciones, plan.usuario_responsable to authenticated;
grant execute on function plan.marcar_password_cambiada() to authenticated;
revoke all on all tables in schema plan from anon;

do $$ declare t text; begin
  foreach t in array array['plan.areas','plan.responsables','plan.planes','plan.categorias','plan.acciones','plan.usuario_responsable'] loop
    execute format('alter table %s enable row level security', t);
    execute format('drop policy if exists plan_ver on %s', t);
    execute format('create policy plan_ver on %s for select to authenticated using (core.puede(''plan_accion''))', t);
    execute format('drop policy if exists plan_editar on %s', t);
    execute format('create policy plan_editar on %s for all to authenticated using (core.puede(''plan_accion'',''editar'')) with check (core.puede(''plan_accion'',''editar''))', t);
  end loop;
end $$;
-- La relación usuario-responsable solo la cambian los administradores
drop policy if exists plan_editar on plan.usuario_responsable;
create policy plan_editar on plan.usuario_responsable for all to authenticated using (core.es_admin()) with check (core.es_admin());

-- Tiempo real: los cambios de un usuario aparecen al resto
do $$ declare t text; begin
  foreach t in array array['plan.acciones','plan.responsables','plan.categorias','plan.planes','plan.areas'] loop
    begin execute format('alter publication supabase_realtime add table %s', t); exception when duplicate_object then null; end;
  end loop;
end $$;

update core.modulos set nombre = 'Plan de Acción del P.E.' where codigo = 'plan_accion';
commit;
