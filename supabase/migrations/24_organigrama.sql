-- 24 · Organigrama (módulo «organigrama», carpeta Personas)
-- Estructura de dirección para dibujar el organigrama y exportarlo a PowerPoint.
-- Niveles: dirección general › apoyo a DG (staff) › direcciones / pilares › departamentos.
-- Los nombres de los responsables se escriben desde la app; aquí no hay datos personales.
-- Idempotente: se puede ejecutar más de una vez.
begin;

create table if not exists rrhh.organigramas (
  id          bigserial primary key,
  titulo      text not null,
  subtitulo   text,
  nota        text,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create table if not exists rrhh.organigrama_nodos (
  id             bigserial primary key,
  organigrama_id bigint not null references rrhh.organigramas(id) on delete cascade,
  padre_id       bigint references rrhh.organigrama_nodos(id) on delete cascade,
  tipo           text not null check (tipo in ('direccion','staff','pilar','departamento')),
  titulo         text not null,
  responsable    text,
  descripcion    text,
  orden          int not null default 0
);
create index if not exists organigrama_nodos_org on rrhh.organigrama_nodos(organigrama_id);

drop trigger if exists t_auditoria on rrhh.organigramas;
create trigger t_auditoria after insert or update or delete on rrhh.organigramas for each row execute function core.auditar();
drop trigger if exists t_auditoria on rrhh.organigrama_nodos;
create trigger t_auditoria after insert or update or delete on rrhh.organigrama_nodos for each row execute function core.auditar();

alter table rrhh.organigramas enable row level security;
alter table rrhh.organigrama_nodos enable row level security;
grant select, insert, update, delete on rrhh.organigramas, rrhh.organigrama_nodos to authenticated;
grant usage on all sequences in schema rrhh to authenticated;
do $$ declare t text; begin
  foreach t in array array['organigramas','organigrama_nodos'] loop
    execute format('drop policy if exists %I on rrhh.%I', t||'_ver', t);
    execute format('create policy %I on rrhh.%I for select to authenticated using ((select core.puede(''organigrama'')))', t||'_ver', t);
    execute format('drop policy if exists %I on rrhh.%I', t||'_editar', t);
    execute format('create policy %I on rrhh.%I for all to authenticated using ((select core.puede(''organigrama'',''editar''))) with check ((select core.puede(''organigrama'',''editar'')))', t||'_editar', t);
  end loop;
end $$;

insert into core.modulos (codigo, nombre, grupo, orden) values ('organigrama', 'Organigrama', 'Personas', 75)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo, orden = excluded.orden;

commit;
