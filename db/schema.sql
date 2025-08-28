-- sales-dashboard schema for Supabase
-- Create tables
create table if not exists public.sales_history (
  id uuid primary key default gen_random_uuid(),
  segment text not null check (segment in ('domestic','international')),
  name text not null,
  month text not null,
  sales numeric,
  target numeric,
  bookings integer,
  bookings_target integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(segment, name, month)
);

create table if not exists public.status_overrides (
  id uuid primary key default gen_random_uuid(),
  segment text not null check (segment in ('domestic','international')),
  name text not null,
  month text not null,
  status text not null check (status in ('Safe','Vigilance','PIP','Terminated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(segment, name, month)
);

-- simple updated_at trigger
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists tr_sales_history_updated on public.sales_history;
create trigger tr_sales_history_updated
before update on public.sales_history
for each row execute function public.set_updated_at();

drop trigger if exists tr_status_overrides_updated on public.status_overrides;
create trigger tr_status_overrides_updated
before update on public.status_overrides
for each row execute function public.set_updated_at();

-- AUTH: profiles and admin approval
-- Table of admin emails who can approve users and manage roles
create table if not exists public.admin_emails (
  email text primary key
);

-- Profiles table linked to auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text,
  requested_role text,
  role text not null default 'User', -- 'Admin' | 'Manager' | 'Finance' | 'Cofounder' | 'TL' | 'User'
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh
drop trigger if exists tr_profiles_updated on public.profiles;
create trigger tr_profiles_updated
before update on public.profiles
for each row execute function public.set_updated_at();

-- On new auth user, create a matching profile with approved=false
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, requested_role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    coalesce(new.raw_user_meta_data->>'requested_role', null)
  )
  on conflict (id) do nothing;
  return new;
end; $$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.admin_emails enable row level security;

-- Allow anyone to read admin_emails (for policy checks only); limit writes to admins themselves in SQL console
drop policy if exists "admin_emails_readall" on public.admin_emails;
create policy "admin_emails_readall" on public.admin_emails
  for select using (true);

-- Profiles policies
-- Users can view their own profile
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self" on public.profiles
  for select using (auth.uid() = id);

-- Admins (by email) can view all profiles
drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select using (exists (select 1 from public.admin_emails a where a.email = auth.email()))
  with check (true);

-- Users can update their own full_name only
drop policy if exists "profiles_update_self_name" on public.profiles;
-- Disallow self-updates to avoid privilege escalation; admins can still update via admin policy below
create policy "profiles_update_self_name" on public.profiles
  for update using (false)
  with check (false);

-- Admins can update approved and role for anyone
drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update using (exists (select 1 from public.admin_emails a where a.email = auth.email()))
  with check (exists (select 1 from public.admin_emails a where a.email = auth.email()));

