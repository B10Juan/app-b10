-- =====================================================================
-- APP B10 · Demanda: funciones más rápidas (SQL dinámico solo con los filtros activos)
-- y nuevos niveles de tiempo (semana dentro del mes, día de la semana)
-- =====================================================================
begin;
create or replace function comercial._where(p jsonb) returns text language plpgsql stable as $$
declare w text := 'true'; k text; col text;
  m jsonb := '{"uen":"uen","familia":"familia","producto":"producto","articulo":"articulo_id","config":"config_id","cliente":"cliente_id",
               "delegado":"delegado","zona":"zona","pais":"pais","provincia":"provincia_envio","tipo_cliente":"tipo_cliente",
               "grupo":"grupo_comercial","origen":"origen"}';
begin
  if jsonb_typeof(p->'anios') = 'array' and jsonb_array_length(p->'anios') > 0 then
    w := w || format(' and anio = any(%L::int[])', (select array_agg(x::int) from jsonb_array_elements_text(p->'anios') x)); end if;
  if jsonb_typeof(p->'meses') = 'array' and jsonb_array_length(p->'meses') > 0 then
    w := w || format(' and mes = any(%L::int[])', (select array_agg(x::int) from jsonb_array_elements_text(p->'meses') x)); end if;
  if jsonb_typeof(p->'semanas') = 'array' and jsonb_array_length(p->'semanas') > 0 then
    w := w || format(' and semana = any(%L::int[])', (select array_agg(x::int) from jsonb_array_elements_text(p->'semanas') x)); end if;
  if coalesce(p->>'hasta','') <> '' then w := w || format(' and to_char(fecha_dia, %L) <= %L', 'MM-DD', p->>'hasta'); end if;
  for k, col in select key, value #>> '{}' from jsonb_each(m) loop
    if jsonb_typeof(p->k) = 'array' and jsonb_array_length(p->k) > 0 then
      w := w || format(' and coalesce(%I, %L) = any(%L::text[])', col, '', (select array_agg(x) from jsonb_array_elements_text(p->k) x)); end if;
  end loop;
  if jsonb_typeof(p->'top') = 'array' and jsonb_array_length(p->'top') > 0 then
    w := w || format(' and (case when top then %L else %L end) = any(%L::text[])', '1', '0', (select array_agg(x) from jsonb_array_elements_text(p->'top') x)); end if;
  return w;
end $$;

create or replace function comercial.demanda_serie(p jsonb, gran text default 'mes')
returns table (anio int, periodo int, importe numeric, unidades numeric, lineas bigint, pedidos bigint, clientes bigint)
language plpgsql stable security invoker as $$
begin
  return query execute format(
    'select anio, (%s)::int, round(sum(importe), 2), sum(cantidad), count(*), count(distinct pedido), count(distinct cliente_id)
     from ax.pedidos_venta_diario where %s group by 1, 2 order by 1, 2',
    case gran when 'anio' then '0' when 'trimestre' then '((mes - 1) / 3 + 1)' when 'semana' then 'semana'
              when 'dia' then 'extract(doy from fecha_dia)' when 'dow' then 'extract(isodow from fecha_dia)' else 'mes' end,
    comercial._where(p));
end $$;

create or replace function comercial.demanda_desglose(p jsonb, dim text)
returns table (clave text, nombre text, anio int, importe numeric, unidades numeric, lineas bigint, pedidos bigint, clientes bigint)
language plpgsql stable security invoker as $$
declare c text; n text;
begin
  c := case dim when 'uen' then 'uen' when 'familia' then 'familia' when 'producto' then 'producto' when 'articulo' then 'articulo_id'
               when 'config' then 'config_id' when 'cliente' then 'cliente_id' when 'delegado' then 'delegado' when 'zona' then 'zona'
               when 'pais' then 'pais' when 'tipo_cliente' then 'tipo_cliente' when 'grupo' then 'grupo_comercial' when 'origen' then 'origen'
               when 'provincia' then 'provincia_envio' when 'top' then '(case when top then ''1'' else ''0'' end)' end;
  if c is null then raise exception 'Dimensión no válida: %', dim; end if;
  n := case dim when 'articulo' then 'max(coalesce(articulo_nombre, descripcion))' when 'cliente' then 'max(cliente_nombre)'
               when 'grupo' then 'max(grupo_comercial_nombre)' else 'null::text' end;
  return query execute format(
    'select (%s)::text, %s, anio, round(sum(importe), 2), sum(cantidad), count(*), count(distinct pedido), count(distinct cliente_id)
     from ax.pedidos_venta_diario where %s group by 1, 3', c, n, comercial._where(p));
end $$;

create or replace function comercial.demanda_lineas(p jsonb, lim int default 200, off int default 0)
returns setof ax.pedidos_venta_diario language plpgsql stable security invoker as $$
begin
  return query execute format('select * from ax.pedidos_venta_diario where %s order by fecha desc limit %s offset %s',
    comercial._where(p), least(coalesce(lim,200), 2000), greatest(coalesce(off,0), 0));
end $$;

-- Valores de cada filtro (con su importe total), para los desplegables
create or replace function comercial.demanda_opciones(dim text)
returns table (clave text, nombre text, importe numeric)
language sql stable security invoker as $$
  select clave, max(nombre), sum(importe) from comercial.demanda_desglose('{}'::jsonb, dim) group by clave order by 3 desc nulls last;
$$;

create index if not exists pvd_fecha_dia_idx on ax.pedidos_venta_diario (anio, fecha_dia);
grant execute on all functions in schema comercial to authenticated;
commit;
