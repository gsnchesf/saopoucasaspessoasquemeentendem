-- ==========================================================
-- Organizador — estrutura do banco no Supabase.
-- Rodar no SQL Editor do projeto. Pode rodar de novo sem perder dados.
--
-- Contas: o login é "usuário + senha". No Supabase cada usuário vira
-- um e-mail interno <usuario>@usuarios.organizador.invalid (nunca recebe e-mail).
-- Ninguém se cadastra sozinho: admins criam as contas pelas funções abaixo.
-- ==========================================================

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

-- ---------- Perfis: nome, usuário e se é admin ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  name text not null check (length(trim(name)) between 1 and 40),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
-- Sem insert/update/delete direto: só pelas funções abaixo.

-- ---------- Dados pessoais: cada registro do app como JSON ----------
-- coll = coleção do app (events, subjects, blocks…, e 'meta' para os ajustes).
-- updated_at em milissegundos (Date.now() do app); deleted marca exclusões para os outros aparelhos.

create table if not exists public.items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  coll text not null,
  id text not null,
  data jsonb,
  updated_at bigint not null,
  deleted boolean not null default false,
  primary key (user_id, coll, id)
);
alter table public.items enable row level security;

drop policy if exists items_own on public.items;
create policy items_own on public.items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Funções internas (não ficam expostas na API) ----------

create or replace function private.user_email(p_username text) returns text
language sql immutable as $$
  select lower(trim(p_username)) || '@usuarios.organizador.invalid';
$$;

create or replace function private.check_password(p_password text) returns void
language plpgsql as $$
begin
  if p_password is null or length(p_password) < 4 then
    raise exception 'A senha precisa ter pelo menos 4 caracteres.' using errcode = '22023';
  end if;
end $$;

create or replace function private.create_user(p_username text, p_name text, p_password text, p_admin boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_user text := lower(trim(p_username));
  v_email text := private.user_email(p_username);
begin
  if v_user !~ '^[a-z0-9._-]{3,30}$' then
    raise exception 'O usuário precisa ter de 3 a 30 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where username = v_user) then
    raise exception 'Esse usuário já existe.' using errcode = '23505';
  end if;
  perform private.check_password(p_password);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_user), now(), now(),
    '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text, 'email',
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), now(), now(), now());

  insert into public.profiles (id, username, name, is_admin) values (v_id, v_user, trim(p_name), p_admin);
  return v_id;
end $$;

-- ---------- Funções chamadas pelo app (RPC) ----------

-- Admin cria um usuário com nome, usuário e senha inicial.
create or replace function public.admin_create_user(p_username text, p_name text, p_password text)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admins podem criar usuários.' using errcode = '42501'; end if;
  return private.create_user(p_username, p_name, p_password, false);
end $$;

-- Troca de senha: a própria (sem confirmação) ou a de qualquer um, se for admin.
create or replace function public.set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Sem permissão para trocar essa senha.' using errcode = '42501';
  end if;
  perform private.check_password(p_password);
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_user;
end $$;

create or replace function public.admin_rename_user(p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admins podem mudar nomes.' using errcode = '42501'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Informe o nome.' using errcode = '22023'; end if;
  update public.profiles set name = trim(p_name) where id = p_user;
end $$;

-- Exclui a conta e todos os dados dela (os itens caem junto, em cascata).
create or replace function public.admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Só admins podem excluir usuários.' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode excluir a própria conta.' using errcode = '42501'; end if;
  delete from auth.users where id = p_user;
end $$;

-- Só usuários logados chamam as funções; as internas ficam fechadas.
revoke all on function public.admin_create_user(text, text, text), public.set_password(uuid, text),
  public.admin_rename_user(uuid, text), public.admin_delete_user(uuid), public.is_admin() from public, anon;
grant execute on function public.admin_create_user(text, text, text), public.set_password(uuid, text),
  public.admin_rename_user(uuid, text), public.admin_delete_user(uuid), public.is_admin() to authenticated;
revoke all on schema private from public, anon, authenticated;
