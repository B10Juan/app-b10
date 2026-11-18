-- 29 · Cada departamento pertenece a una clasificación (M.O.E, M.O.I o M.O.D)
-- Estructura: clasificación › departamento › puesto. El puesto toma siempre la clasificación de su departamento.
-- Idempotente: se puede ejecutar más de una vez.
begin;

alter table rrhh.departamentos add column if not exists clasificacion text check (clasificacion in ('M.O.E','M.O.I','M.O.D'));

-- Departamentos existentes: la clasificación más frecuente entre sus puestos y personas
update rrhh.departamentos d set clasificacion = x.clasificacion
from (
  select departamento, clasificacion from (
    select departamento, clasificacion, row_number() over (partition by departamento order by count(*) desc, clasificacion) as rn
    from (select pu.departamento, pu.clasificacion from rrhh.puestos pu
          union all
          select p.departamento, p.clasificacion from rrhh.personas p where p.departamento is not null and p.clasificacion is not null) t
    group by departamento, clasificacion) y where rn = 1
) x
where d.nombre = x.departamento and d.clasificacion is null;

-- El puesto toma la clasificación de su departamento (al crearlo o al moverlo de departamento)
create or replace function rrhh.puesto_clasif_departamento() returns trigger language plpgsql as $$
declare c text;
begin
  select clasificacion into c from rrhh.departamentos where nombre = new.departamento;
  if c is not null then new.clasificacion := c; end if;
  return new;
end $$;
drop trigger if exists t_puesto_clasif on rrhh.puestos;
create trigger t_puesto_clasif before insert or update of departamento, clasificacion on rrhh.puestos for each row execute function rrhh.puesto_clasif_departamento();

-- Al cambiar la clasificación de un departamento, sus puestos (y por su trigger, sus personas) la siguen
create or replace function rrhh.departamento_clasif_puestos() returns trigger language plpgsql as $$
begin
  if new.clasificacion is not null and new.clasificacion is distinct from old.clasificacion then
    update rrhh.puestos set clasificacion = new.clasificacion where departamento = new.nombre and clasificacion is distinct from new.clasificacion;
  end if;
  return new;
end $$;
drop trigger if exists t_departamento_clasif on rrhh.departamentos;
create trigger t_departamento_clasif after update of clasificacion on rrhh.departamentos for each row execute function rrhh.departamento_clasif_puestos();

commit;

-- Departamentos y puestos cuya clasificación no coincide (revisar en la app: Estructura de departamentos)
select d.nombre as departamento, d.clasificacion as clasif_departamento, pu.nombre as puesto, pu.clasificacion as clasif_puesto
from rrhh.departamentos d join rrhh.puestos pu on pu.departamento = d.nombre
where pu.clasificacion is distinct from d.clasificacion
union all
select d.nombre, null, '(departamento sin clasificación)', null from rrhh.departamentos d where d.clasificacion is null
order by 1, 3;
