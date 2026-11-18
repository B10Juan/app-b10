-- =====================================================================
-- APP B10 · Tesorería: facturas de clientes pendientes de cobro
-- Hoja «CustTransOpen» del Excel de transacciones abiertas de clientes de AX
-- Pendiente de cobro = AMOUNTMST (positivo = a cobrar; negativo = abono o cobro a cuenta)
-- Idempotente: se puede ejecutar más de una vez.
-- =====================================================================
begin;
create schema if not exists tesoreria;
grant usage on schema tesoreria to authenticated;

create table if not exists tesoreria.facturas_clientes (
  id                bigint generated always as identity primary key,
  carga_id          bigint references core.cargas(id) on delete cascade,
  cliente           text,      -- NAME
  cliente_cod       text,      -- ACCOUNTNUM
  asiento           text,      -- VOUCHER
  factura           text,      -- INVOICE
  texto             text,      -- TXT
  fecha_factura     date,      -- TRANSDATE
  vencimiento       date,      -- DUEDATE
  importe           numeric,   -- AMOUNTMST
  modo_pago         text,      -- PAYMMODE
  estado            text,      -- POSTINGPROFILE (General, Remesa, Impago, Cartera, Dotación…)
  estado_efecto     text,      -- Estado (Ninguno, Librado, Renegociado…)
  remesa            text,      -- BILLOFEXCHANGEID
  banco             text,      -- BANCO
  agrupacion        text,      -- Agrupación Sistema cobro
  mercado           text,      -- Extranjeros (Nacional / Extranjero)
  tramo             text       -- Tramo (según el Excel)
);
create index if not exists fc_venc_idx on tesoreria.facturas_clientes (estado, vencimiento);

alter table tesoreria.facturas_clientes enable row level security;
grant select, insert, delete on tesoreria.facturas_clientes to authenticated;
grant usage on all sequences in schema tesoreria to authenticated;
drop policy if exists fc_ver on tesoreria.facturas_clientes;
create policy fc_ver on tesoreria.facturas_clientes for select to authenticated using ((select core.puede('tesoreria_cli')));
drop policy if exists fc_cargar on tesoreria.facturas_clientes;
create policy fc_cargar on tesoreria.facturas_clientes for all to authenticated using ((select core.puede('tesoreria_cli','editar'))) with check ((select core.puede('tesoreria_cli','editar')));

drop policy if exists cargas_tescli_insertar on core.cargas;
create policy cargas_tescli_insertar on core.cargas for insert to authenticated with check (tipo = 'tesoreria_clientes' and core.puede('tesoreria_cli','editar'));
drop policy if exists cargas_tescli_ver on core.cargas;
create policy cargas_tescli_ver on core.cargas for select to authenticated using (tipo = 'tesoreria_clientes' and core.puede('tesoreria_cli'));

insert into core.modulos (codigo, nombre, grupo, orden) values ('tesoreria_cli','Facturas de clientes pendientes de cobro','Tesorería',61)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo;
commit;
