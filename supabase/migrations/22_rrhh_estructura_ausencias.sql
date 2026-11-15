-- =====================================================================
-- APP B10 · Personas: estructura (clasificación › departamento › puesto), ausencias,
-- fecha de fin de contrato y desglose de conceptos de nómina
-- =====================================================================
begin;

-- Puestos: cada puesto depende de un departamento y tiene su clasificación (M.O.E / M.O.I / M.O.D)
create table if not exists rrhh.puestos (
  id            bigint generated always as identity primary key,
  nombre        text not null,
  departamento  text not null references rrhh.departamentos(nombre) on update cascade,
  clasificacion text not null check (clasificacion in ('M.O.D','M.O.I','M.O.E')),
  activo        boolean not null default true,
  orden         int not null default 0,
  unique (departamento, nombre)
);

alter table rrhh.personas add column if not exists puesto_id bigint references rrhh.puestos(id) on delete set null;
alter table rrhh.personas add column if not exists fecha_fin_contrato date;   -- contratos temporales: fin previsto

-- Puestos a partir de lo que ya hay en las fichas (departamento + puesto + clasificación)
insert into rrhh.puestos (nombre, departamento, clasificacion)
select distinct p.puesto, p.departamento, p.clasificacion from rrhh.personas p
where p.puesto is not null and p.departamento is not null and p.clasificacion is not null
on conflict (departamento, nombre) do nothing;
update rrhh.personas p set puesto_id = pu.id from rrhh.puestos pu
where p.puesto_id is null and pu.nombre = p.puesto and pu.departamento = p.departamento;

-- Al asignar un puesto, la ficha toma su departamento y su clasificación
create or replace function rrhh.al_asignar_puesto() returns trigger language plpgsql as $$
begin
  if new.puesto_id is not null then
    select pu.nombre, pu.departamento, pu.clasificacion into new.puesto, new.departamento, new.clasificacion
    from rrhh.puestos pu where pu.id = new.puesto_id;
  end if;
  return new;
end $$;
drop trigger if exists t_asignar_puesto on rrhh.personas;
create trigger t_asignar_puesto before insert or update of puesto_id on rrhh.personas for each row execute function rrhh.al_asignar_puesto();

-- Si se cambia un puesto (nombre, departamento o clasificación), se actualizan sus personas
create or replace function rrhh.al_cambiar_puesto() returns trigger language plpgsql as $$
begin
  update rrhh.personas set puesto = new.nombre, departamento = new.departamento, clasificacion = new.clasificacion
  where puesto_id = new.id and (puesto is distinct from new.nombre or departamento is distinct from new.departamento or clasificacion is distinct from new.clasificacion);
  return new;
end $$;
drop trigger if exists t_cambiar_puesto on rrhh.puestos;
create trigger t_cambiar_puesto after update on rrhh.puestos for each row execute function rrhh.al_cambiar_puesto();

-- Ausencias: IT, excedencia, vacaciones, permisos… (la baja definitiva sigue siendo fecha_baja + motivo en la ficha)
create table if not exists rrhh.ausencias (
  id            bigint generated always as identity primary key,
  persona_id    bigint not null references rrhh.personas(id) on delete cascade,
  tipo          text not null check (tipo in ('IT enfermedad común','IT accidente de trabajo','Excedencia','Vacaciones','Permiso','Otra')),
  fecha_inicio  date not null,
  fecha_fin     date,                 -- vacía = sigue abierta
  observaciones text,
  creado_en     timestamptz not null default now(),
  constraint ausencias_fechas check (fecha_fin is null or fecha_fin >= fecha_inicio)
);
create index if not exists ausencias_persona_idx on rrhh.ausencias (persona_id, fecha_inicio);
drop trigger if exists t_auditoria on rrhh.ausencias;
create trigger t_auditoria after insert or update or delete on rrhh.ausencias for each row execute function core.auditar();

-- Desglose de cada nómina (todas las líneas del fichero de imputación de costes)
create table if not exists rrhh.nomina_conceptos (
  id              bigint generated always as identity primary key,
  periodo         date not null,
  codigo          text not null,
  tipo_nomina     text not null default 'ordinaria' check (tipo_nomina in ('ordinaria','extra')),
  orden           int not null,
  cod_concepto    text,
  concepto        text not null,
  grupo           text not null,      -- devengo, deduccion, total, empresa
  importe         numeric not null
);
create index if not exists conceptos_idx on rrhh.nomina_conceptos (codigo, periodo);
create index if not exists conceptos_periodo_idx on rrhh.nomina_conceptos (periodo, tipo_nomina);

-- Seguridad
alter table rrhh.puestos enable row level security;
alter table rrhh.ausencias enable row level security;
alter table rrhh.nomina_conceptos enable row level security;
grant select, insert, update, delete on rrhh.puestos, rrhh.ausencias, rrhh.nomina_conceptos to authenticated;
grant usage on all sequences in schema rrhh to authenticated;
do $$ declare t text; begin
  foreach t in array array['puestos','ausencias','nomina_conceptos'] loop
    execute format('drop policy if exists %I on rrhh.%I', t||'_ver', t);
    execute format('create policy %I on rrhh.%I for select to authenticated using ((select core.puede(''rrhh'')))', t||'_ver', t);
    execute format('drop policy if exists %I on rrhh.%I', t||'_editar', t);
    execute format('create policy %I on rrhh.%I for all to authenticated using ((select core.puede(''rrhh'',''editar''))) with check ((select core.puede(''rrhh'',''editar'')))', t||'_editar', t);
  end loop; end $$;
-- departamentos: se pueden borrar si no tienen puestos (la FK lo impide si los tienen)
commit;
