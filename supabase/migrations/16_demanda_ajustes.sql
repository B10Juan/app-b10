-- APP B10 · Demanda: filtro por provincia, totales anuales y permisos evaluados una sola vez por consulta
begin;
create or replace function comercial._filtro(p jsonb, d ax.pedidos_venta_diario) returns boolean language sql stable as $$
  select (p->'anios' is null or jsonb_array_length(p->'anios') = 0 or (p->'anios') @> to_jsonb(d.anio))
     and (coalesce(p->>'hasta','') = '' or to_char(d.fecha_dia, 'MM-DD') <= p->>'hasta')
     and comercial._en(p,'uen',d.uen) and comercial._en(p,'familia',d.familia) and comercial._en(p,'producto',d.producto)
     and comercial._en(p,'articulo',d.articulo_id) and comercial._en(p,'config',d.config_id)
     and comercial._en(p,'cliente',d.cliente_id) and comercial._en(p,'delegado',d.delegado) and comercial._en(p,'zona',d.zona)
     and comercial._en(p,'pais',d.pais) and comercial._en(p,'provincia',d.provincia_envio) and comercial._en(p,'tipo_cliente',d.tipo_cliente)
     and comercial._en(p,'grupo',d.grupo_comercial) and comercial._en(p,'origen',d.origen) and comercial._en(p,'top', case when d.top then '1' else '0' end)
$$;
create or replace function comercial.demanda_serie(p jsonb, gran text default 'mes')
returns table (anio int, periodo int, importe numeric, unidades numeric, lineas bigint, pedidos bigint, clientes bigint)
language sql stable security invoker as $$
  select d.anio,
         case gran when 'anio' then 0 when 'trimestre' then ((d.mes - 1) / 3 + 1) when 'semana' then d.semana when 'dia' then extract(doy from d.fecha_dia)::int else d.mes end,
         round(sum(d.importe), 2), sum(d.cantidad), count(*), count(distinct d.pedido), count(distinct d.cliente_id)
  from ax.pedidos_venta_diario d where comercial._filtro(p, d)
  group by 1, 2 order by 1, 2;
$$;
drop policy if exists demanda_ver on ax.pedidos_venta_diario;
create policy demanda_ver on ax.pedidos_venta_diario for select to authenticated using ((select core.puede('demanda')));
drop policy if exists demanda_cargar on ax.pedidos_venta_diario;
create policy demanda_cargar on ax.pedidos_venta_diario for all to authenticated using ((select core.puede('demanda','editar'))) with check ((select core.puede('demanda','editar')));
drop policy if exists cartera_ver on ax.cartera_pendiente;
create policy cartera_ver on ax.cartera_pendiente for select to authenticated using ((select core.puede('demanda')));
drop policy if exists cartera_cargar on ax.cartera_pendiente;
create policy cartera_cargar on ax.cartera_pendiente for all to authenticated using ((select core.puede('demanda','editar'))) with check ((select core.puede('demanda','editar')));
grant execute on all functions in schema comercial to authenticated;
commit;
