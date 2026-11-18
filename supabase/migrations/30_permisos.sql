-- 30 · Permisos de las personas (por días completos o por horas)
-- Se registran en la ficha (Formulario de introducción de datos) y cuentan en «Número de personas por dpto.»:
-- la persona sigue activa, pero ese día está de permiso y no cuenta como empleado trabajando.
-- Idempotente: se puede ejecutar más de una vez.
begin;

create table if not exists rrhh.permisos (
  id            bigint generated always as identity primary key,
  persona_id    bigint not null references rrhh.personas(id) on delete cascade,
  tipo          text not null,
  fecha_inicio  date not null,
  fecha_fin     date,
  por_horas     boolean not null default false,
  hora_inicio   time,
  hora_fin      time,
  horas         numeric,
  observaciones text,
  creado_en     timestamptz not null default now(),
  constraint permisos_fechas check (fecha_fin is null or fecha_fin >= fecha_inicio),
  constraint permisos_horas check (not por_horas or (horas is not null and horas > 0))
);
create index if not exists permisos_persona_idx on rrhh.permisos (persona_id, fecha_inicio);

drop trigger if exists t_auditoria on rrhh.permisos;
create trigger t_auditoria after insert or update or delete on rrhh.permisos for each row execute function core.auditar();

alter table rrhh.permisos enable row level security;
grant select, insert, update, delete on rrhh.permisos to authenticated;
drop policy if exists permisos_ver on rrhh.permisos;
create policy permisos_ver on rrhh.permisos for select to authenticated using ((select core.puede('rrhh') or core.puede('datos')));
drop policy if exists permisos_editar on rrhh.permisos;
create policy permisos_editar on rrhh.permisos for all to authenticated
  using ((select core.puede('rrhh','editar') or core.puede('datos','editar'))) with check ((select core.puede('rrhh','editar') or core.puede('datos','editar')));

commit;

select count(*) as permisos from rrhh.permisos;
