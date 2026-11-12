-- =====================================================================
-- APP B10 · Tesorería: facturas de proveedores (hoja «Proveedores» del Excel Tesoreria.xlsx)
-- Pendiente de pago = «Riesgo» del Excel distinto de cero (negativo = a pagar; positivo = abono a favor)
-- =====================================================================
begin;
create schema if not exists tesoreria;
grant usage on schema tesoreria to authenticated;

create table if not exists tesoreria.facturas_proveedores (
  id                 bigint generated always as identity primary key,
  carga_id           bigint references core.cargas(id) on delete cascade,
  proveedor_cod      text,            -- Cod Proveedor
  proveedor          text,            -- Proveedor
  asiento            text,            -- Asiento
  factura            text,            -- Factura
  concepto           text,            -- Concepto
  pagada             boolean not null default false,   -- Pagado = «P»
  fecha_factura      date,            -- Fecha facura
  vencimiento        date,            -- Vto Original
  importe_pendiente  numeric,         -- Riesgo
  importe            numeric,         -- importe
  forma_pago         text,            -- Banco (TRANAC, LCAIXA, GIRSAB...)
  vencimiento_tabla  date,            -- Vto Tabla
  subvencion         numeric,         -- Subvención
  vencida_excel      boolean          -- «Vencida» según el Excel al guardarlo
);
create index if not exists fp_pend_idx on tesoreria.facturas_proveedores (pagada, vencimiento);

-- Nombre legible de cada forma de pago (editable)
create table if not exists tesoreria.formas_pago (
  codigo  text primary key,
  nombre  text not null
);
insert into tesoreria.formas_pago values
  ('TRANAC','Transferencia nacional'), ('TRAIMP','Transferencia importación'),
  ('LCAIXA','Confirming CaixaBank'), ('GIRSAB','Giro Banco Sabadell'), ('GIRBAN','Giro bancario')
on conflict (codigo) do nothing;

alter table tesoreria.facturas_proveedores enable row level security;
alter table tesoreria.formas_pago enable row level security;
grant select, insert, delete on tesoreria.facturas_proveedores to authenticated;
grant select, insert, update, delete on tesoreria.formas_pago to authenticated;
grant usage on all sequences in schema tesoreria to authenticated;
drop policy if exists fp_ver on tesoreria.facturas_proveedores;
create policy fp_ver on tesoreria.facturas_proveedores for select to authenticated using ((select core.puede('tesoreria_prov')));
drop policy if exists fp_cargar on tesoreria.facturas_proveedores;
create policy fp_cargar on tesoreria.facturas_proveedores for all to authenticated using ((select core.puede('tesoreria_prov','editar'))) with check ((select core.puede('tesoreria_prov','editar')));
drop policy if exists formas_ver on tesoreria.formas_pago;
create policy formas_ver on tesoreria.formas_pago for select to authenticated using ((select core.puede('tesoreria_prov')));
drop policy if exists formas_editar on tesoreria.formas_pago;
create policy formas_editar on tesoreria.formas_pago for all to authenticated using ((select core.puede('tesoreria_prov','editar'))) with check ((select core.puede('tesoreria_prov','editar')));
drop policy if exists cargas_tes_insertar on core.cargas;
create policy cargas_tes_insertar on core.cargas for insert to authenticated with check (tipo = 'tesoreria_proveedores' and core.puede('tesoreria_prov','editar'));
drop policy if exists cargas_tes_ver on core.cargas;
create policy cargas_tes_ver on core.cargas for select to authenticated using (tipo = 'tesoreria_proveedores' and core.puede('tesoreria_prov'));

insert into core.modulos (codigo, nombre, grupo, orden) values ('tesoreria_prov','Facturas de proveedores pendientes de pago','Tesorería',60)
on conflict (codigo) do update set nombre = excluded.nombre, grupo = excluded.grupo;
commit;
