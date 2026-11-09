-- =====================================================================
-- APP B10 · Alta de usuarios con contraseña desde la propia app
-- Solo los administradores pueden ejecutar estas funciones.
-- La contraseña se guarda cifrada (bcrypt), nunca en claro.
-- =====================================================================

create or replace function core.crear_usuario(
  p_email     text,
  p_nombre    text,
  p_password  text,
  p_es_admin  boolean default false,
  p_permisos  jsonb   default '{}'::jsonb      -- {"compras":"ver","planificador":"editar",...}
) returns uuid
language plpgsql security definer
set search_path = core, auth, extensions, public
as $$
declare
  v_email text := lower(trim(p_email));
  v_uid   uuid := gen_random_uuid();
  v_mod   text;
  v_niv   text;
begin
  if not core.es_admin() then
    raise exception 'Solo los administradores pueden crear usuarios';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no es válido';
  end if;
  if coalesce(length(p_password), 0) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Ya existe un usuario con ese correo';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    email_change_confirm_status, is_sso_user, is_anonymous)
  values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('nombre', p_nombre, 'email_verified', true, 'debe_cambiar_password', true),
    now(), now(), '', '', '', '', '', '', '', '', 0, false, false);

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_uid::text, v_uid,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  -- El disparador core.alta_usuario ya ha creado la fila en core.usuarios
  update core.usuarios set nombre = coalesce(nullif(trim(p_nombre), ''), nombre), es_admin = coalesce(p_es_admin, false)
  where id = v_uid;

  for v_mod, v_niv in select key, value #>> '{}' from jsonb_each(coalesce(p_permisos, '{}'::jsonb)) loop
    if v_niv in ('ver', 'editar') and exists (select 1 from core.modulos where codigo = v_mod) then
      insert into core.permisos (usuario_id, modulo, nivel) values (v_uid, v_mod, v_niv)
      on conflict (usuario_id, modulo) do update set nivel = excluded.nivel;
    end if;
  end loop;

  return v_uid;
end $$;

-- El administrador asigna una contraseña nueva (el usuario tendrá que cambiarla al entrar)
create or replace function core.cambiar_password_usuario(p_uid uuid, p_password text)
returns void
language plpgsql security definer
set search_path = core, auth, extensions, public
as $$
begin
  if not core.es_admin() then
    raise exception 'Solo los administradores pueden cambiar contraseñas de otros usuarios';
  end if;
  if coalesce(length(p_password), 0) < 8 then
    raise exception 'La contraseña debe tener al menos 8 caracteres';
  end if;
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || '{"debe_cambiar_password": true}'::jsonb,
         updated_at = now()
   where id = p_uid;
  if not found then raise exception 'Usuario no encontrado'; end if;
end $$;

revoke all on function core.crear_usuario(text, text, text, boolean, jsonb) from public, anon;
revoke all on function core.cambiar_password_usuario(uuid, text) from public, anon;
grant execute on function core.crear_usuario(text, text, text, boolean, jsonb) to authenticated;
grant execute on function core.cambiar_password_usuario(uuid, text) to authenticated;
