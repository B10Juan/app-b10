-- 28 · Próxima revisión de las bajas por IT
-- Fecha de la próxima revisión médica de una ausencia de tipo IT (enfermedad común o accidente de trabajo).
-- Se muestra en la ficha y en la lista de personas del Formulario de introducción de datos.
alter table rrhh.ausencias add column if not exists proxima_revision date;
select count(*) filter (where tipo like 'IT%') as ausencias_it from rrhh.ausencias;
