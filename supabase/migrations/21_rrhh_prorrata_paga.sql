-- =====================================================================
-- APP B10 · Personas: prorrata mensual de la paga extra de verano
-- La paga de verano se cobra en junio, pero se devenga todo el año. La nómina calcula cada mes su
-- prorrata («PRORRATA PAGAS EXTRAS», la que se suma a la base de cotización). Se guarda para
-- repartir el coste de la paga mes a mes y para calcular el bruto anual de cada persona.
-- =====================================================================
alter table rrhh.nomina_mensual add column if not exists prorrata_extra numeric not null default 0;
