-- APP B10 · Resumen de compras por artículo (para el análisis por referencia)
create or replace view ax.v_compras_articulos with (security_invoker = true) as
select articulo_id,
       (array_agg(split_part(articulo_descripcion, ' | ', 1) order by factura_fecha desc))[1] as descripcion,
       count(*) as lineas,
       count(distinct proveedor_cuenta) as proveedores,
       round(sum(importe_eur), 2) as importe_eur,
       max(factura_fecha) as ultima_factura
from ax.facturas_compras_lineas
where articulo_id is not null
group by articulo_id;
grant select on ax.v_compras_articulos to authenticated;
