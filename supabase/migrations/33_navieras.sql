-- =====================================================================
-- APP B10 · Planificador de compras: tabla de navieras
-- El pedido sigue guardando el nombre de la naviera (compras.pedidos.naviera);
-- esta tabla es la lista para elegir, con datos de contacto opcionales.
-- =====================================================================
begin;
create table if not exists compras.navieras (
  id          bigint generated always as identity primary key,
  nombre      text not null,
  contacto    text,
  telefono    text,
  email       text,
  creado_en   timestamptz not null default now(),
  creado_por  uuid default auth.uid()
);
create unique index if not exists navieras_nombre_uk on compras.navieras (lower(nombre));

-- Las navieras que ya se han usado en pedidos
insert into compras.navieras (nombre)
select distinct trim(naviera) from compras.pedidos
where coalesce(trim(naviera), '') <> ''
on conflict do nothing;

grant select, insert, update, delete on compras.navieras to authenticated;
alter table compras.navieras enable row level security;
drop policy if exists navieras_ver on compras.navieras;
create policy navieras_ver on compras.navieras for select to authenticated
  using ((select core.puede('planificador')) or (select core.puede('pagos')));
drop policy if exists navieras_editar on compras.navieras;
create policy navieras_editar on compras.navieras for all to authenticated
  using ((select core.puede('planificador','editar'))) with check ((select core.puede('planificador','editar')));
drop trigger if exists t_auditoria on compras.navieras;
create trigger t_auditoria after insert or update or delete on compras.navieras for each row execute function core.auditar();
commit;
