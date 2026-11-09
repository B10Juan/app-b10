-- APP B10 · Vistas para el módulo Compras
-- Resumen por proveedor (respeta los permisos de cada usuario: security_invoker)
create or replace view ax.v_compras_proveedores
with (security_invoker = true) as
select proveedor_cuenta,
       max(proveedor_nombre)                        as nombre,
       mode() within group (order by moneda)        as moneda,
       round(sum(importe_eur), 2)                   as importe_eur,
       count(*)                                     as lineas,
       array_agg(distinct anio order by anio)       as anios
from ax.facturas_compras_lineas
group by proveedor_cuenta;

grant select on ax.v_compras_proveedores to authenticated;
