-- =====================================================================
-- APP B10 · Personas: grupo profesional y datos de retribución por persona
-- Se añaden a la nómina mensual la base de cotización, la Seguridad Social del trabajador,
-- el IRPF, otras deducciones (embargos, anticipos…) y el líquido, para calcular en la ficha
-- el coste de empresa, el bruto (base de cotización x 12) y el líquido anual y mensual.
-- =====================================================================
begin;
alter table rrhh.personas add column if not exists grupo_profesional text;

alter table rrhh.nomina_mensual
  add column if not exists base_cc            numeric not null default 0,   -- BASE CONTINGENCIAS COMUNES
  add column if not exists ss_trabajador      numeric not null default 0,   -- cotizaciones a cargo del trabajador
  add column if not exists irpf               numeric not null default 0,   -- Tributación IRPF (incl. indemnización)
  add column if not exists otras_deducciones  numeric not null default 0,   -- embargos, anticipos, descuentos
  add column if not exists liquido            numeric not null default 0,   -- TOTAL LIQUIDO
  add column if not exists paga_extra_irpf    numeric not null default 0,
  add column if not exists paga_extra_liquido numeric not null default 0;
commit;
