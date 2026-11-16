-- =====================================================================
-- APP B10 · Formas de pago de las importaciones
-- compras.formas_pago ya existía con un modelo simple (% anticipo + días antes de ETA).
-- Se amplía con «tramos» para poder expresar cualquier reparto:
--   «pedido» = fecha de realización del pedido (adelantado)
--   «carga»  = fecha de embarque, ETD (a la carga)
--   «eta»    = llegada a puerto; «dias» negativo = días antes (−15 = 15 días antes de ETA)
-- =====================================================================
begin;
alter table compras.formas_pago add column if not exists tramos jsonb;
alter table compras.formas_pago add column if not exists creado_por uuid default auth.uid();
alter table compras.formas_pago alter column pct_anticipo set default 0;
alter table compras.formas_pago alter column dias_antes_eta set default 15;
-- Tramos de las formas que ya existían
update compras.formas_pago set tramos = case when coalesce(pct_anticipo,0) > 0
    then jsonb_build_array(jsonb_build_object('pct', pct_anticipo, 'ref', 'pedido', 'dias', 0), jsonb_build_object('pct', 100 - pct_anticipo, 'ref', 'eta', 'dias', -coalesce(dias_antes_eta,15)))
    else jsonb_build_array(jsonb_build_object('pct', 100, 'ref', 'eta', 'dias', -coalesce(dias_antes_eta,15))) end
  where tramos is null;
update compras.formas_pago set nombre = replace(nombre, 'adelantado resto', 'adelantado, resto');
insert into compras.formas_pago (nombre, pct_anticipo, dias_antes_eta, orden, tramos) values
  ('Pago 30% adelantado, 20% a la carga, resto 15 días antes de ETA', 30, 15, 4, '[{"pct":30,"ref":"pedido","dias":0},{"pct":20,"ref":"carga","dias":0},{"pct":50,"ref":"eta","dias":-15}]')
on conflict (nombre) do nothing;
alter table compras.formas_pago alter column tramos set not null;

-- Proveedores sin forma de pago: la básica (15 días antes de ETA)
update maestros.proveedores set forma_pago_id = (select id from compras.formas_pago order by orden, id limit 1) where forma_pago_id is null;

-- Pedido: fecha de realización (para los adelantos), forma de pago propia si difiere y fecha de pago de cada tramo
alter table compras.pedidos add column if not exists fecha_pedido date;
alter table compras.pedidos add column if not exists forma_pago_id bigint references compras.formas_pago(id);
alter table compras.pedidos add column if not exists pagos jsonb not null default '{}'::jsonb;   -- {"0":"2026-11-15", ...}
update compras.pedidos set fecha_pedido = creado_en::date where fecha_pedido is null and estado <> 'pendiente';

grant select, insert, update on compras.formas_pago to authenticated;
drop trigger if exists t_auditoria on compras.formas_pago;
create trigger t_auditoria after insert or update or delete on compras.formas_pago for each row execute function core.auditar();
commit;
