-- 23 · Módulo «Formulario introducción de datos» (código «datos»)
-- Separa la introducción de datos maestros (fichas de personas y estructura de departamentos y puestos)
-- del módulo de análisis «Costes de personal» (código «rrhh»).
-- Permisos:
--   · Tablas maestras (personas, departamentos, puestos, ausencias, movimientos, periodos y proveedores ETT):
--     ver con «rrhh» o «datos»; editar con «rrhh» o «datos» en nivel edición.
--   · Nóminas y conceptos de nómina (importes salariales): solo con «rrhh», como hasta ahora.
-- Idempotente: se puede ejecutar más de una vez.
begin;

insert into core.modulos (codigo, nombre, grupo, orden)
values ('datos', 'Formulario introducción de datos (personas y estructura)', 'Formularios', 65)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo, orden = excluded.orden;

update core.modulos set nombre = 'Costes de personal' where codigo = 'rrhh';

do $$ declare t text; begin
  foreach t in array array['departamentos','puestos','personas','movimientos','ausencias','ett_periodos','ett_proveedores'] loop
    execute format('drop policy if exists %I on rrhh.%I', t||'_ver', t);
    execute format('create policy %I on rrhh.%I for select to authenticated using ((select core.puede(''rrhh'') or core.puede(''datos'')))', t||'_ver', t);
    execute format('drop policy if exists %I on rrhh.%I', t||'_editar', t);
    execute format('create policy %I on rrhh.%I for all to authenticated using ((select core.puede(''rrhh'',''editar'') or core.puede(''datos'',''editar''))) with check ((select core.puede(''rrhh'',''editar'') or core.puede(''datos'',''editar'')))', t||'_editar', t);
  end loop;
end $$;

commit;

select codigo, nombre, grupo, orden from core.modulos where codigo in ('datos','rrhh') order by orden;
