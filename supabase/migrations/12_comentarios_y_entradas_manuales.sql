-- =====================================================================
-- APP B10 · Comentarios en pedidos y entradas manuales de almacén
-- (devoluciones, compras a proveedores no habituales, ajustes)
-- =====================================================================
begin;
alter table compras.pedidos add column if not exists comentarios text;

create table if not exists compras.entradas_manuales (
  id                     bigint generated always as identity primary key,
  articulo_proveedor_id  bigint not null references maestros.articulo_proveedor(id) on delete cascade,
  semana                 date   not null check (extract(isodow from semana) = 1),   -- lunes de la semana de entrada en almacén
  cantidad               numeric not null check (cantidad <> 0),
  motivo                 text   not null default 'otro' check (motivo in ('devolucion','otro_proveedor','ajuste','otro')),
  comentario             text,
  creado_en              timestamptz not null default now(),
  creado_por             uuid default auth.uid(),
  actualizado_en         timestamptz not null default now(),
  actualizado_por        uuid,
  unique (articulo_proveedor_id, semana)
);
drop trigger if exists t_actualizado on compras.entradas_manuales;
create trigger t_actualizado before update on compras.entradas_manuales for each row execute function core.set_actualizado();
drop trigger if exists t_auditoria on compras.entradas_manuales;
create trigger t_auditoria after insert or update or delete on compras.entradas_manuales for each row execute function core.auditar();

grant select, insert, update, delete on compras.entradas_manuales to authenticated;
grant usage on all sequences in schema compras to authenticated;
alter table compras.entradas_manuales enable row level security;
drop policy if exists entradas_ver on compras.entradas_manuales;
create policy entradas_ver on compras.entradas_manuales for select to authenticated using (core.puede('planificador'));
drop policy if exists entradas_editar on compras.entradas_manuales;
create policy entradas_editar on compras.entradas_manuales for all to authenticated
  using (core.puede('planificador','editar')) with check (core.puede('planificador','editar'));
commit;
