-- APP B10 · Nombre corto de proveedor para las pantallas (el nombre fiscal sigue en «nombre»)
-- Los nombres cortos de cada proveedor se rellenan con un script de datos que no se publica en este repositorio.
alter table maestros.proveedores add column if not exists nombre_corto text;
update maestros.proveedores set nombre_corto = nombre where nombre_corto is null;
