# APP B10 · Gestión

Aplicación web interna de B10. Los datos viven en Supabase (proyecto B10) y el código en este repositorio.

Versión 0.1.0: módulo **Compras** (análisis de facturas de proveedores) y **Gestión de usuarios**.

## Estructura

```
index.html                  Página de la app
css/estilos.css             Estilos (modo claro y oscuro)
js/config.js                Dirección de Supabase y clave pública  <-- revisar al instalar
js/app.js                   Inicio de sesión, permisos y navegación
js/util.js                  Utilidades comunes (formatos, desplegables, Excel)
js/modulos/compras.js       Módulo Compras: análisis por proveedor
js/modulos/usuarios.js      Gestión de usuarios y permisos (solo administradores)
supabase/migrations/        Scripts SQL de la base de datos, en orden
```

## Base de datos (Supabase)

Los scripts de `supabase/migrations` se ejecutan en orden en Supabase > SQL Editor. Los 01 a 04 ya están aplicados.
Para esta versión hay que ejecutar **05_vistas_compras.sql**.

Esquemas: `core` (usuarios, permisos, cargas, auditoría), `maestros` (proveedores, artículos), `ax` (datos importados de AX).
Los tres deben estar en Settings > Data API > Exposed schemas (ya configurado).

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
5. Entra en la dirección de Netlify, escribe tu correo y abre el enlace que te llega.

Cada cambio que se suba a GitHub se publica solo en Netlify en un minuto.

## Usuarios

- Alta: Supabase > Authentication > Users > Add user > Send invitation, con el correo de empresa.
- Permisos: en la APP, Gestión de usuarios (Consulta o Edición por módulo).
- El servidor de correo incluido en Supabase solo envía a los miembros del equipo del proyecto y con un límite bajo.
  Antes de dar de alta al resto de usuarios hay que configurar un SMTP propio en Authentication > Emails > SMTP Settings
  (por ejemplo, el correo de Microsoft 365 de la empresa o un servicio como Brevo).

## Cargas de facturas

Las facturas se cargan en `ax.facturas_compras_lineas` (de momento desde Excel).
Después de cada carga, ejecutar en el SQL Editor: `select * from maestros.actualizar_desde_facturas();`
para dar de alta proveedores y artículos nuevos y actualizar los precios de compra.
