-- CodeGuard AI account seed
-- Run this in Supabase SQL Editor after supabase/schema.sql.
--
-- Default accounts:
--   Admin:     admin@sourcecodechecker.edu      / Admin@12345
--   Professor: professor@sourcecodechecker.edu  / Professor@12345
--
-- Change these passwords after first login or replace them before importing.

create extension if not exists "pgcrypto";

create or replace function pg_temp.seed_source_checker_user(
  p_id uuid,
  p_email text,
  p_full_name text,
  p_app_role public.app_role,
  p_password text
)
returns void
language plpgsql
security definer
as $$
declare
  v_identity_has_provider_id boolean;
  v_identity_id_is_uuid boolean;
  v_identity_id_expression text;
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    p_id,
    'authenticated',
    'authenticated',
    lower(p_email),
    crypt(p_password, gen_salt('bf')),
    now(),
    '',
    '',
    '',
    '',
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('full_name', p_full_name),
    now(),
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = coalesce(auth.users.email_confirmed_at, excluded.email_confirmed_at),
      confirmation_token = '',
      recovery_token = '',
      email_change_token_new = '',
      email_change = '',
      raw_app_meta_data = excluded.raw_app_meta_data,
      raw_user_meta_data = excluded.raw_user_meta_data,
      updated_at = now();

  insert into public.users (id, email, full_name, role)
  values (p_id, lower(p_email), p_full_name, p_app_role)
  on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      role = excluded.role,
      updated_at = now();

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'identities'
      and column_name = 'provider_id'
  )
  into v_identity_has_provider_id;

  select coalesce((
    select data_type = 'uuid'
    from information_schema.columns
    where table_schema = 'auth'
      and table_name = 'identities'
      and column_name = 'id'
  ), false)
  into v_identity_id_is_uuid;

  v_identity_id_expression := case
    when v_identity_id_is_uuid then 'gen_random_uuid()'
    else quote_literal(p_id::text)
  end;

  delete from auth.identities
  where user_id = p_id
    and provider = 'email';

  if v_identity_has_provider_id then
    execute format(
      'insert into auth.identities
        (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values
        (%s, %L, %L::uuid, jsonb_build_object(''sub'', %L, ''email'', %L, ''email_verified'', true, ''phone_verified'', false), ''email'', now(), now(), now())',
      v_identity_id_expression,
      p_id::text,
      p_id::text,
      p_id::text,
      lower(p_email)
    );
  else
    execute format(
      'insert into auth.identities
        (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
       values
        (%s, %L::uuid, jsonb_build_object(''sub'', %L, ''email'', %L, ''email_verified'', true, ''phone_verified'', false), ''email'', now(), now(), now())',
      v_identity_id_expression,
      p_id::text,
      p_id::text,
      lower(p_email)
    );
  end if;
end;
$$;

delete from public.users
where id in (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
  )
  or email in (
    'admin@sourcecodechecker.edu',
    'professor@sourcecodechecker.edu'
  );

delete from auth.identities
where user_id in (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
  )
  or provider_id in (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102',
    'admin@sourcecodechecker.edu',
    'professor@sourcecodechecker.edu'
  )
  or lower(identity_data->>'email') in (
    'admin@sourcecodechecker.edu',
    'professor@sourcecodechecker.edu'
  );

delete from auth.users
where id in (
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000102'
  )
  or email in (
    'admin@sourcecodechecker.edu',
    'professor@sourcecodechecker.edu'
  );

select pg_temp.seed_source_checker_user(
  '00000000-0000-0000-0000-000000000101',
  'admin@sourcecodechecker.edu',
  'System Administrator',
  'admin',
  'Admin@12345'
);

select pg_temp.seed_source_checker_user(
  '00000000-0000-0000-0000-000000000102',
  'professor@sourcecodechecker.edu',
  'Prof. James Dela Torre',
  'user',
  'Professor@12345'
);

select email, full_name, role
from public.users
where email in ('admin@sourcecodechecker.edu', 'professor@sourcecodechecker.edu')
order by role, email;
