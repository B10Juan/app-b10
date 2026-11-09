-- =====================================================================
-- APP B10 · Regla de precios de compra
-- El precio de cada artículo-proveedor es el de su última factura de compra.
-- Si un artículo no tiene facturas, se mantiene el precio que ya tenga.
-- Ejecutar la función después de cada carga de facturas:
--   select * from maestros.actualizar_desde_facturas();
-- =====================================================================

alter table maestros.articulo_proveedor add column if not exists precio_fecha  date;  -- fecha de la factura de la que sale el precio
alter table maestros.articulo_proveedor add column if not exists precio_origen text default 'manual'
  check (precio_origen in ('manual','factura'));

create or replace function maestros.actualizar_desde_facturas(
  out proveedores_nuevos int, out articulos_nuevos int, out precios_actualizados int)
language plpgsql as $$
begin
  -- 1. Proveedores que aparecen en facturas y aún no están en el maestro
  insert into maestros.proveedores (codigo_ax, nombre, alias, moneda)
  select distinct on (f.proveedor_cuenta) f.proveedor_cuenta, f.proveedor_nombre, f.proveedor_alias, coalesce(f.moneda,'EUR')
  from ax.facturas_compras_lineas f
  where not exists (select 1 from maestros.proveedores p where p.codigo_ax = f.proveedor_cuenta)
  order by f.proveedor_cuenta, f.factura_fecha desc
  on conflict (codigo_ax) do nothing;
  get diagnostics proveedores_nuevos = row_count;

  -- 2. Artículos que aparecen en facturas y aún no están en el maestro
  insert into maestros.articulos (codigo_ax, descripcion, estado, tipo, familia, subfamilia, grupo_articulo)
  select distinct on (f.articulo_id) f.articulo_id, split_part(f.articulo_descripcion, ' | ', 1), 'activo',
         f.tipo, f.familia, f.subfamilia,
         (select g.codigo from maestros.grupos_articulo g where g.codigo = f.grupo_articulo)
  from ax.facturas_compras_lineas f
  where f.articulo_id is not null
    and not exists (select 1 from maestros.articulos a where a.codigo_ax = f.articulo_id)
  order by f.articulo_id, f.factura_fecha desc
  on conflict (codigo_ax) do nothing;
  get diagnostics articulos_nuevos = row_count;

  -- 3. Último precio facturado por artículo y proveedor (sin abonos ni líneas a precio cero)
  with ult as (
    select distinct on (f.articulo_id, f.proveedor_cuenta)
           f.articulo_id, f.proveedor_cuenta,
           round(f.precio_compra / nullif(f.unidad_precio, 0), 4) as precio,
           coalesce(f.moneda, 'EUR') as moneda,
           nullif(f.articulo_ref_proveedor, '') as ref,
           f.factura_fecha
    from ax.facturas_compras_lineas f
    where f.articulo_id is not null and f.precio_compra > 0 and f.cantidad > 0
    order by f.articulo_id, f.proveedor_cuenta, f.factura_fecha desc, f.linea desc
  )
  insert into maestros.articulo_proveedor (articulo_id, proveedor_id, precio, moneda, ref_proveedor, precio_fecha, precio_origen)
  select a.id, p.id, u.precio, u.moneda, u.ref, u.factura_fecha, 'factura'
  from ult u
  join maestros.articulos a   on a.codigo_ax = u.articulo_id
  join maestros.proveedores p on p.codigo_ax = u.proveedor_cuenta
  on conflict (articulo_id, proveedor_id) do update
    set precio        = excluded.precio,
        moneda        = excluded.moneda,
        ref_proveedor = coalesce(excluded.ref_proveedor, maestros.articulo_proveedor.ref_proveedor),
        precio_fecha  = excluded.precio_fecha,
        precio_origen = 'factura'
  where maestros.articulo_proveedor.precio_fecha is null
     or excluded.precio_fecha > maestros.articulo_proveedor.precio_fecha
     or (excluded.precio_fecha = maestros.articulo_proveedor.precio_fecha
         and (excluded.precio, excluded.moneda) is distinct from (maestros.articulo_proveedor.precio, maestros.articulo_proveedor.moneda));
  get diagnostics precios_actualizados = row_count;
end $$;

grant execute on function maestros.actualizar_desde_facturas() to authenticated;

-- Aplicar ahora con las facturas ya cargadas
select * from maestros.actualizar_desde_facturas();
