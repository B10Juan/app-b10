# APP B10 · Gestión

Aplicación web interna de B10. Los datos viven en Supabase (proyecto B10) y el código en este repositorio.

Versión 0.3.0: **Compras** (análisis de facturas), **Planificador de compras** (revisión de artículos, pedidos lanzados con versiones y previsión de pagos de importaciones) y **Gestión de usuarios** con contraseñas.

## Estructura

```
index.html                  Página de la app
css/estilos.css             Estilos (modo claro y oscuro)
js/config.js                Dirección de Supabase y clave pública  <-- revisar al instalar
js/app.js                   Inicio de sesión, permisos y navegación
js/util.js                  Utilidades comunes (formatos, desplegables, Excel)
js/modulos/compras.js       Módulo Compras: análisis por proveedor
js/modulos/planificador.js  Planificador de compras, pedidos lanzados y previsión de pagos
js/modulos/usuarios.js      Gestión de usuarios y permisos (solo administradores)
supabase/migrations/        Scripts SQL de la base de datos, en orden
```

## Base de datos (Supabase)

Los scripts de `supabase/migrations` se ejecutan en orden en Supabase > SQL Editor. Los 01 a 04 ya están aplicados.
Para esta versión hay que ejecutar **05_vistas_compras.sql**.

Esquemas: `core` (usuarios, permisos, cargas, auditoría), `maestros` (proveedores, artículos), `ax` (datos importados de AX),
`compras` (previsión de venta y pedidos de importación). Los cuatro deben estar en Settings > Data API > Exposed schemas (ya configurado).

## Puesta en marcha

1. **Clave pública**: en Supabase > Project Settings > API Keys, copia la clave pública
   (`anon` / `public`, o la *Publishable key*) y pégala en `js/config.js` en `SUPABASE_KEY`.
   Nunca uses la clave `service_role` ni la *Secret key*.
2. **GitHub**: crea un repositorio **privado** llamado `app-b10` y sube todos estos ficheros
   (Add file > Upload files, arrastrando el contenido de la carpeta).
3. **Netlify** (gratuito, permite uso empresarial): Add new site > Import an existing project > GitHub >
   repositorio `app-b10`. Deja vacío el comando de build y pon `/` como directorio de publicación. Deploy.
   En Site configuration > Change site name puedes dejarlo como `b10-app.netlify.app` o similar.
4. **Supabase > Authentication > URL Configuration**: en *Site URL* pon la dirección de Netlify
   (por ejemplo `https://b10-app.netlify.app`) y añádela también en *Redirect URLs*.
5. Entra en la dirección de Netlify con tu correo y contraseña.

Cada cambio que se suba a GitHub se publica solo en Netlify en un minuto.

## Usuarios

- Acceso con correo y contraseña. El registro libre está desactivado: solo entran los usuarios que crea un administrador.
- Alta: en la APP, Gestión de usuarios > Nuevo usuario (nombre, correo, contraseña temporal y permisos por módulo).
  Al entrar por primera vez, el usuario tiene que elegir su propia contraseña.
- Si alguien olvida la contraseña: Gestión de usuarios > Nueva contraseña (se genera una temporal).
- Cada usuario puede cambiar su contraseña desde el botón «Contraseña».
- Permisos por módulo: Sin acceso, Visualización (ver, filtrar y exportar) o Edición. Los aplica la base de datos.
- Scripts relacionados: supabase/migrations/06_usuarios_con_contrasena.sql

## Cargas de facturas

Las facturas se cargan en `ax.facturas_compras_lineas` (de momento desde Excel).
Después de cada carga, ejecutar en el SQL Editor: `select * from maestros.actualizar_desde_facturas();`
para dar de alta proveedores y artículos nuevos y actualizar los precios de compra.
