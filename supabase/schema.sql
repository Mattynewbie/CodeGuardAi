create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'user');
  end if;
end $$;

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role public.app_role not null default 'user',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  description text,
  language_summary jsonb not null default '{}'::jsonb,
  status text not null default 'uploaded' check (status in ('uploaded', 'extracting', 'analyzing', 'completed', 'failed')),
  highest_similarity numeric(5,2) not null default 0,
  flagged boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  original_name text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  sha256 text not null,
  archive_type text check (archive_type in ('single', 'zip', 'rar')),
  created_at timestamptz not null default now()
);

create table if not exists public.extracted_code_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  uploaded_file_id uuid references public.uploaded_files(id) on delete set null,
  file_path text not null,
  language text not null default 'unknown',
  size_bytes bigint not null default 0,
  content_sha256 text not null,
  normalized_sha256 text not null,
  normalized_code text,
  fingerprint_hashes jsonb not null default '[]'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.similarity_results (
  id uuid primary key default gen_random_uuid(),
  source_project_id uuid not null references public.projects(id) on delete cascade,
  compared_project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  similarity_score numeric(5,2) not null,
  exact_match_score numeric(5,2) not null default 0,
  token_score numeric(5,2) not null default 0,
  structure_score numeric(5,2) not null default 0,
  fingerprint_score numeric(5,2) not null default 0,
  semantic_score numeric(5,2),
  explanation text,
  status text not null default 'completed' check (status in ('queued', 'running', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.matched_code_sections (
  id uuid primary key default gen_random_uuid(),
  similarity_result_id uuid not null references public.similarity_results(id) on delete cascade,
  source_file_id uuid references public.extracted_code_files(id) on delete set null,
  compared_file_id uuid references public.extracted_code_files(id) on delete set null,
  source_file_path text not null,
  compared_file_path text not null,
  source_start_line integer,
  source_end_line integer,
  compared_start_line integer,
  compared_end_line integer,
  source_snippet text,
  compared_snippet text,
  match_type text not null default 'similar_logic',
  confidence numeric(5,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  summary text not null,
  report_json jsonb not null,
  pdf_storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_projects_owner_id on public.projects(owner_id);
create index if not exists idx_projects_flagged on public.projects(flagged);
create index if not exists idx_uploaded_files_project_id on public.uploaded_files(project_id);
create index if not exists idx_extracted_code_files_project_id on public.extracted_code_files(project_id);
create index if not exists idx_extracted_code_files_hashes on public.extracted_code_files(content_sha256, normalized_sha256);
create index if not exists idx_similarity_results_source_project_id on public.similarity_results(source_project_id);
create index if not exists idx_similarity_results_compared_project_id on public.similarity_results(compared_project_id);
create index if not exists idx_reports_project_id on public.reports(project_id);
create index if not exists idx_activity_logs_actor_id on public.activity_logs(actor_id);
create index if not exists idx_activity_logs_action_created_at on public.activity_logs(action, created_at desc);
create index if not exists idx_activity_logs_access_request_email
on public.activity_logs ((metadata->>'email'))
where action = 'access.requested';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_users_updated_at on public.users;
create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users
    where id = auth.uid()
      and role = 'admin'
  );
$$;

alter table public.users enable row level security;
alter table public.projects enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.extracted_code_files enable row level security;
alter table public.similarity_results enable row level security;
alter table public.matched_code_sections enable row level security;
alter table public.reports enable row level security;
alter table public.activity_logs enable row level security;

create policy "users_select_own_or_admin" on public.users
for select using (id = auth.uid() or public.is_admin());

create policy "users_update_own_profile" on public.users
for update using (id = auth.uid())
with check (
  id = auth.uid()
  and role = (select existing.role from public.users existing where existing.id = auth.uid())
);

create policy "users_update_admin" on public.users
for update using (public.is_admin())
with check (public.is_admin());

create policy "projects_owner_or_admin" on public.projects
for all using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "uploaded_files_owner_or_admin" on public.uploaded_files
for all using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "extracted_code_files_owner_or_admin" on public.extracted_code_files
for all using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "similarity_results_owner_or_admin" on public.similarity_results
for all using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "matched_sections_owner_or_admin" on public.matched_code_sections
for select using (
  public.is_admin()
  or exists (
    select 1
    from public.similarity_results sr
    where sr.id = similarity_result_id
      and sr.owner_id = auth.uid()
  )
);

create policy "reports_owner_or_admin" on public.reports
for all using (owner_id = auth.uid() or public.is_admin())
with check (owner_id = auth.uid() or public.is_admin());

create policy "activity_logs_owner_or_admin" on public.activity_logs
for select using (actor_id = auth.uid() or public.is_admin());

revoke insert, delete on table public.users from anon, authenticated;
revoke update on table public.users from anon, authenticated;
revoke update (id, email, role, created_at, updated_at) on table public.users from anon, authenticated;
grant update (full_name, avatar_url) on table public.users to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-uploads',
  'project-uploads',
  false,
  41943040,
  array[
    'application/zip',
    'application/x-zip-compressed',
    'application/vnd.rar',
    'application/x-rar-compressed',
    'text/plain',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = 41943040;

create policy "storage_upload_own_folder" on storage.objects
for insert with check (
  bucket_id = 'project-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "storage_read_own_folder_or_admin" on storage.objects
for select using (
  bucket_id = 'project-uploads'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);

create policy "storage_delete_own_folder_or_admin" on storage.objects
for delete using (
  bucket_id = 'project-uploads'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
