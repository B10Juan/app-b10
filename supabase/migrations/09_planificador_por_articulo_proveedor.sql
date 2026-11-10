-- =====================================================================
-- APP B10 · El planificador trabaja por artículo-proveedor (artículo + acabado)
-- Un mismo artículo de AX puede tener varios acabados (BCO, NEG...) con stock propio.
-- =====================================================================
begin;

-- 1. Relación artículo-proveedor: se permite el mismo artículo con distinta clave de stock
alter table maestros.articulo_proveedor drop constraint if exists articulo_proveedor_articulo_id_proveedor_id_key;
create unique index if not exists articulo_proveedor_uk
  on maestros.articulo_proveedor (articulo_id, proveedor_id, coalesce(clave_stock, ''));

-- 2. Previsión de venta por artículo-proveedor
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='compras' and table_name='prevision_venta' and column_name='articulo_id') then
    alter table compras.prevision_venta add column if not exists articulo_proveedor_id bigint references maestros.articulo_proveedor(id) on delete cascade;
    update compras.prevision_venta pv set articulo_proveedor_id = ap.id
      from maestros.articulo_proveedor ap
      where pv.articulo_proveedor_id is null and ap.articulo_id = pv.articulo_id and ap.planificar;
    delete from compras.prevision_venta where articulo_proveedor_id is null;
    alter table compras.prevision_venta drop constraint if exists prevision_venta_pkey;
    alter table compras.prevision_venta drop column articulo_id;
    alter table compras.prevision_venta alter column articulo_proveedor_id set not null;
    alter table compras.prevision_venta add primary key (articulo_proveedor_id, semana);
  end if;
end $$;

-- 3. Líneas de pedido por artículo-proveedor (las claves de lineas/precios pasan a ser ids de articulo_proveedor)
create or replace function compras._remap(j jsonb, p_proveedor bigint) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(coalesce((select ap.id::text from maestros.articulo_proveedor ap
                                              where ap.articulo_id = k.key::bigint and ap.proveedor_id = p_proveedor
                                              order by ap.planificar desc, ap.id limit 1), k.key), k.value), '{}'::jsonb)
  from jsonb_each(coalesce(j, '{}'::jsonb)) k;
$$;
do $$ begin
  if not exists (select 1 from core.cargas where tipo = 'migracion_lineas_ap') then
    update compras.pedidos p set
      lineas = compras._remap(lineas, proveedor_id),
      precios = compras._remap(precios, proveedor_id),
      modificacion = case when modificacion is null then null else
        jsonb_set(jsonb_set(modificacion, '{lines}', compras._remap(modificacion->'lines', proveedor_id)), '{prices}', compras._remap(modificacion->'prices', proveedor_id)) end,
      historial = coalesce((select jsonb_agg(jsonb_set(jsonb_set(h, '{lines}', compras._remap(h->'lines', p.proveedor_id)), '{prices}', compras._remap(h->'prices', p.proveedor_id)))
                            from jsonb_array_elements(p.historial) h), '[]'::jsonb);
    insert into core.cargas (tipo, notas) values ('migracion_lineas_ap', 'Líneas de pedido pasadas a ids de articulo_proveedor');
  end if;
end $$;
drop function compras._remap(jsonb, bigint);

drop view if exists compras.v_pedido_lineas;
create view compras.v_pedido_lineas with (security_invoker = true) as
select p.id as pedido_id, p.proveedor_id, p.estado, p.referencia, p.eta, p.etd,
       ap.id as articulo_proveedor_id, ap.articulo_id, a.codigo_ax, ap.clave_stock, a.descripcion,
       (l.value #>> '{}')::numeric as cantidad,
       coalesce((coalesce(p.modificacion->'prices', p.precios) ->> l.key)::numeric, ap.precio) as precio,
       ap.moneda, (p.modificacion is not null) as con_modificacion
from compras.pedidos p
cross join lateral jsonb_each(case when p.modificacion is not null then p.modificacion->'lines' else p.lineas end) l
left join maestros.articulo_proveedor ap on ap.id = (l.key)::bigint
left join maestros.articulos a on a.id = ap.articulo_id;
grant select on compras.v_pedido_lineas to authenticated;

-- 4. Regla de precios: el último precio de factura se aplica a todas las variantes del artículo con ese proveedor
create or replace function maestros.actualizar_desde_facturas(
  out proveedores_nuevos int, out articulos_nuevos int, out precios_actualizados int)
language plpgsql as $$
declare n int;
begin
  insert into maestros.proveedores (codigo_ax, nombre, alias, moneda)
  select distinct on (f.proveedor_cuenta) f.proveedor_cuenta, f.proveedor_nombre, f.proveedor_alias, coalesce(f.moneda,'EUR')
  from ax.facturas_compras_lineas f
  where not exists (select 1 from maestros.proveedores p where p.codigo_ax = f.proveedor_cuenta)
  order by f.proveedor_cuenta, f.factura_fecha desc
  on conflict (codigo_ax) do nothing;
  get diagnostics proveedores_nuevos = row_count;

  insert into maestros.articulos (codigo_ax, descripcion, estado, tipo, familia, subfamilia, grupo_articulo)
  select distinct on (f.articulo_id) f.articulo_id, split_part(f.articulo_descripcion, ' | ', 1), 'activo', f.tipo, f.familia, f.subfamilia,
         (select g.codigo from maestros.grupos_articulo g where g.codigo = f.grupo_articulo)
  from ax.facturas_compras_lineas f
  where f.articulo_id is not null and not exists (select 1 from maestros.articulos a where a.codigo_ax = f.articulo_id)
  order by f.articulo_id, f.factura_fecha desc
  on conflict (codigo_ax) do nothing;
  get diagnostics articulos_nuevos = row_count;

  create temp table _ult on commit drop as
  select distinct on (f.articulo_id, f.proveedor_cuenta)
         a.id as articulo_id, p.id as proveedor_id,
         round(f.precio_compra / nullif(f.unidad_precio, 0), 4) as precio, coalesce(f.moneda,'EUR') as moneda,
         nullif(f.articulo_ref_proveedor,'') as ref, f.factura_fecha
  from ax.facturas_compras_lineas f
  join maestros.articulos a on a.codigo_ax = f.articulo_id
  join maestros.proveedores p on p.codigo_ax = f.proveedor_cuenta
  where f.precio_compra > 0 and f.cantidad > 0
  order by f.articulo_id, f.proveedor_cuenta, f.factura_fecha desc, f.linea desc;

  -- proveedores que facturan por cuenta de una fábrica (p. ej., Cankis): el precio se aplica también a la fábrica
  update maestros.articulo_proveedor ap set precio = u.precio, moneda = u.moneda, precio_fecha = u.factura_fecha, precio_origen = 'factura',
         ref_proveedor = coalesce(u.ref, ap.ref_proveedor)
  from _ult u, maestros.proveedores pr
  where pr.id = ap.proveedor_id and ap.articulo_id = u.articulo_id
    and (ap.proveedor_id = u.proveedor_id or pr.factura_proveedor_id = u.proveedor_id)
    and (ap.precio_fecha is null or u.factura_fecha > ap.precio_fecha
         or (u.factura_fecha = ap.precio_fecha and (u.precio, u.moneda) is distinct from (ap.precio, ap.moneda)));
  get diagnostics precios_actualizados = row_count;

  insert into maestros.articulo_proveedor (articulo_id, proveedor_id, precio, moneda, ref_proveedor, precio_fecha, precio_origen)
  select u.articulo_id, u.proveedor_id, u.precio, u.moneda, u.ref, u.factura_fecha, 'factura' from _ult u
  where not exists (select 1 from maestros.articulo_proveedor ap where ap.articulo_id = u.articulo_id and ap.proveedor_id = u.proveedor_id);
  get diagnostics n = row_count; precios_actualizados := precios_actualizados + n;
end $$;
grant execute on function maestros.actualizar_desde_facturas() to authenticated;

commit;
