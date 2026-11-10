-- =====================================================================
-- APP B10 · Parámetros de planificación por artículo-proveedor
-- (un mismo artículo puede tener venta y stock de seguridad distintos según proveedor o acabado)
-- =====================================================================
begin;
alter table maestros.articulo_proveedor add column if not exists venta_media_semanal numeric;
alter table maestros.articulo_proveedor add column if not exists stock_seguridad numeric;
alter table maestros.articulo_proveedor add column if not exists stock_manual numeric;   -- solo si no hay stock de AX para su clave
alter table maestros.articulo_proveedor add column if not exists descripcion text;      -- descripción propia (p. ej., acabado)
alter table maestros.articulo_proveedor add column if not exists modelo text;
update maestros.articulo_proveedor ap set
  venta_media_semanal = coalesce(ap.venta_media_semanal, a.venta_media_semanal),
  stock_seguridad     = coalesce(ap.stock_seguridad, a.stock_seguridad),
  stock_manual        = coalesce(ap.stock_manual, a.stock_actual),
  modelo              = coalesce(ap.modelo, a.modelo)
from maestros.articulos a where a.id = ap.articulo_id and ap.planificar;
commit;
