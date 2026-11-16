-- APP B10 · Vista de stock: se añade la columna «Disponible» del fichero de AX (stock real para B10).
-- «Disponible real» (físico − reservado − pedidos de venta) sigue siendo el stock disponible que usa el planificador.
create or replace view ax.v_stock_actual as
 WITH ultima AS (
         SELECT cargas.id, COALESCE(cargas.fecha_datos, cargas.cargado_en) AS fecha, cargas.fichero
           FROM core.cargas
          WHERE cargas.tipo = 'stock'::text AND cargas.estado = 'ok'::text
          ORDER BY (COALESCE(cargas.fecha_datos, cargas.cargado_en)) DESC, cargas.id DESC
         LIMIT 1
        )
 SELECT s.clave,
    max(s.articulo_id) AS articulo_id, max(s.config_id) AS config_id, max(s.nombre) AS nombre,
    sum(s.disponible_real) AS disponible_real, sum(s.fisico) AS fisico, sum(s.reservado_fisico) AS reservado_fisico,
    sum(s.pedido_venta) AS pedido_venta, sum(s.pedido_compra) AS pedido_compra, max(s.minimos) AS minimos,
    string_agg(DISTINCT s.almacen, ', '::text) AS almacenes, u.fecha AS fecha_stock, u.fichero, u.id AS carga_id,
    sum(s.disponible) AS disponible
   FROM ax.stock_inventsum s
     JOIN ultima u ON u.id = s.carga_id
  GROUP BY s.clave, u.fecha, u.fichero, u.id;
