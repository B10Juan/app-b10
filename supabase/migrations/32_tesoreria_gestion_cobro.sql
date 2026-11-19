-- =====================================================================
-- APP B10 · Tesorería: gestión del cobro por cliente
-- Historial de acciones de cobro (llamadas, emails, promesas de pago…) con la próxima acción.
-- Va por código de cliente y NO depende de las cargas del Excel: se conserva al actualizar las facturas.
-- Idempotente: se puede ejecutar más de una vez.
-- =====================================================================
begin;
create table if not exists tesoreria.gestion_cobro (
  id               bigint generated always as identity primary key,
  cliente_cod      text not null,       -- ACCOUNTNUM
  cliente          text,                -- nombre en el momento de la acción
  fecha            date not null default current_date,
  tipo             text not null,       -- Llamada, Email, Carta / burofax, Visita, Promesa de pago, Acuerdo de pago, Otro
  nota             text,
  promesa_importe  numeric,             -- lo que el cliente se compromete a pagar
  promesa_fecha    date,                -- cuándo
  proxima_accion   text,                -- qué hay que hacer después
  proxima_fecha    date,                -- cuándo
  hecha            boolean not null default false,  -- la próxima acción ya se ha hecho (se marca al registrar la siguiente)
  usuario          text,                -- nombre de quien la registra
  creado_por       uuid default auth.uid(),
  creado_en        timestamptz not null default now()
);
create index if not exists gc_cliente_idx on tesoreria.gestion_cobro (cliente_cod, fecha desc, id desc);

drop trigger if exists t_auditoria on tesoreria.gestion_cobro;
create trigger t_auditoria after insert or update or delete on tesoreria.gestion_cobro for each row execute function core.auditar();

alter table tesoreria.gestion_cobro enable row level security;
grant select, insert, update, delete on tesoreria.gestion_cobro to authenticated;
grant usage on all sequences in schema tesoreria to authenticated;
drop policy if exists gc_ver on tesoreria.gestion_cobro;
create policy gc_ver on tesoreria.gestion_cobro for select to authenticated using ((select core.puede('tesoreria_cli')));
drop policy if exists gc_editar on tesoreria.gestion_cobro;
create policy gc_editar on tesoreria.gestion_cobro for all to authenticated using ((select core.puede('tesoreria_cli','editar'))) with check ((select core.puede('tesoreria_cli','editar')));
commit;
