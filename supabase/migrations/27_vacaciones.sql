-- 27 · Vacaciones (módulo «vacaciones», carpeta Personas) y cambio de código de una persona
-- · Calendario por año: días de vacaciones por defecto (34 laborables), días laborables de la semana y festivos.
-- · Saldo por persona y año: días del año (modificable por persona) y días pendientes de años anteriores.
-- · Los periodos de vacaciones se guardan en rrhh.ausencias con tipo «Vacaciones» (así salen también en la ficha
--   y en la situación de la persona). Los días se calculan con el calendario; «dias» permite ajustarlos a mano (medio día…).
-- · Se descuentan siempre primero los días de los años anteriores.
-- Permisos: «vacaciones» ve y edita calendario, saldos y SOLO las ausencias de tipo Vacaciones; ve la lista de personas.
-- Idempotente: se puede ejecutar más de una vez.
begin;

-- ---------- Cambio de código de una persona (corrige altas con el código mal puesto) ----------
-- nomina_mensual se actualiza sola (FK on update cascade); nomina_conceptos se actualiza aquí.
create or replace function rrhh.cambiar_codigo(p_id bigint, p_nuevo text)
returns void language plpgsql security definer set search_path = rrhh, core, public as $$
declare v_viejo text; v_otro text;
begin
  if not (core.puede('rrhh','editar') or core.puede('datos','editar')) then raise exception 'Sin permiso para cambiar el código'; end if;
  p_nuevo := nullif(trim(p_nuevo), '');
  if p_nuevo is null then raise exception 'El código nuevo está vacío'; end if;
  select codigo into v_viejo from rrhh.personas where id = p_id;
  if v_viejo is null then raise exception 'No existe la persona'; end if;
  if v_viejo = p_nuevo then return; end if;
  select nombre into v_otro from rrhh.personas where codigo = p_nuevo;
  if v_otro is not null then raise exception 'El código % ya es de %', p_nuevo, v_otro using errcode = '23505'; end if;
  update rrhh.personas set codigo = p_nuevo where id = p_id;
  update rrhh.nomina_conceptos set codigo = p_nuevo where codigo = v_viejo;
  insert into rrhh.movimientos (persona_id, fecha, tipo, valor_anterior, valor_nuevo)
  values (p_id, current_date, 'Cambio de código', v_viejo, p_nuevo);
end $$;
revoke all on function rrhh.cambiar_codigo(bigint, text) from public;
grant execute on function rrhh.cambiar_codigo(bigint, text) to authenticated;

-- ---------- Vacaciones ----------
alter table rrhh.ausencias add column if not exists dias numeric;   -- ajuste manual de días (null = calculado con el calendario)

create table if not exists rrhh.vac_calendarios (
  anio          int primary key check (anio between 2020 and 2100),
  dias_defecto  numeric not null default 34,
  laborables    int[] not null default '{1,2,3,4,5}',   -- 1 = lunes … 7 = domingo
  observaciones text,
  creado        timestamptz not null default now()
);
create table if not exists rrhh.vac_festivos (
  id          bigint generated always as identity primary key,
  anio        int not null references rrhh.vac_calendarios(anio) on delete cascade,
  fecha       date not null unique,
  descripcion text not null,
  tipo        text not null default 'Nacional' check (tipo in ('Nacional','Autonómico','Local','Empresa')),
  constraint vac_festivos_anio check (extract(year from fecha)::int = anio)
);
create table if not exists rrhh.vac_saldos (
  anio            int not null references rrhh.vac_calendarios(anio) on delete cascade,
  persona_id      bigint not null references rrhh.personas(id) on delete cascade,
  dias_anio       numeric not null,
  dias_anteriores numeric not null default 0,
  observaciones   text,
  primary key (anio, persona_id)
);

drop trigger if exists t_auditoria on rrhh.vac_calendarios;
create trigger t_auditoria after insert or update or delete on rrhh.vac_calendarios for each row execute function core.auditar();
drop trigger if exists t_auditoria on rrhh.vac_festivos;
create trigger t_auditoria after insert or update or delete on rrhh.vac_festivos for each row execute function core.auditar();
drop trigger if exists t_auditoria on rrhh.vac_saldos;
create trigger t_auditoria after insert or update or delete on rrhh.vac_saldos for each row execute function core.auditar();

alter table rrhh.vac_calendarios enable row level security;
alter table rrhh.vac_festivos enable row level security;
alter table rrhh.vac_saldos enable row level security;
grant select, insert, update, delete on rrhh.vac_calendarios, rrhh.vac_festivos, rrhh.vac_saldos to authenticated;
do $$ declare t text; begin
  foreach t in array array['vac_calendarios','vac_festivos','vac_saldos'] loop
    execute format('drop policy if exists %I on rrhh.%I', t||'_ver', t);
    execute format('create policy %I on rrhh.%I for select to authenticated using ((select core.puede(''vacaciones'') or core.puede(''rrhh'') or core.puede(''datos'')))', t||'_ver', t);
    execute format('drop policy if exists %I on rrhh.%I', t||'_editar', t);
    execute format('create policy %I on rrhh.%I for all to authenticated using ((select core.puede(''vacaciones'',''editar''))) with check ((select core.puede(''vacaciones'',''editar'')))', t||'_editar', t);
  end loop;
end $$;

-- quien tiene «vacaciones» ve la lista de personas y solo las ausencias de tipo Vacaciones
drop policy if exists personas_vac_ver on rrhh.personas;
create policy personas_vac_ver on rrhh.personas for select to authenticated using ((select core.puede('vacaciones')));
drop policy if exists ausencias_vac_ver on rrhh.ausencias;
create policy ausencias_vac_ver on rrhh.ausencias for select to authenticated using (tipo = 'Vacaciones' and (select core.puede('vacaciones')));
drop policy if exists ausencias_vac_editar on rrhh.ausencias;
create policy ausencias_vac_editar on rrhh.ausencias for all to authenticated
  using (tipo = 'Vacaciones' and (select core.puede('vacaciones','editar'))) with check (tipo = 'Vacaciones' and (select core.puede('vacaciones','editar')));

insert into core.modulos (codigo, nombre, grupo, orden) values ('vacaciones', 'Vacaciones', 'Personas', 80)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo, orden = excluded.orden;

-- Calendario 2027: festivos nacionales y autonómicos de la Comunitat Valenciana (los locales se añaden desde la app)
insert into rrhh.vac_calendarios (anio, dias_defecto) values (2027, 34) on conflict (anio) do nothing;
insert into rrhh.vac_festivos (anio, fecha, descripcion, tipo) values
  (2027, '2027-01-01', 'Año Nuevo', 'Nacional'),
  (2027, '2027-01-06', 'Epifanía del Señor', 'Nacional'),
  (2027, '2027-03-19', 'San José', 'Autonómico'),
  (2027, '2027-03-26', 'Viernes Santo', 'Nacional'),
  (2027, '2027-03-29', 'Lunes de Pascua', 'Autonómico'),
  (2027, '2027-05-01', 'Fiesta del Trabajo', 'Nacional'),
  (2027, '2027-10-09', 'Día de la Comunitat Valenciana', 'Autonómico'),
  (2027, '2027-10-12', 'Fiesta Nacional de España', 'Nacional'),
  (2027, '2027-11-01', 'Todos los Santos', 'Nacional'),
  (2027, '2027-12-06', 'Día de la Constitución', 'Nacional'),
  (2027, '2027-12-08', 'Inmaculada Concepción', 'Nacional'),
  (2027, '2027-12-25', 'Natividad del Señor', 'Nacional')
on conflict (fecha) do nothing;

commit;

select (select count(*) from rrhh.vac_festivos where anio = 2027) as festivos_2027, (select dias_defecto from rrhh.vac_calendarios where anio = 2027) as dias;
