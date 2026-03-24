create extension if not exists pgcrypto;

create table if not exists public.walk_sessions (
  id uuid primary key default gen_random_uuid(),
  route_name text not null default '',
  route_meta jsonb not null default '{}'::jsonb,
  route_source_label text not null default '',
  started_at timestamptz null,
  ended_at timestamptz null,
  total_distance_meters double precision not null default 0,
  latest_speed_kmh double precision not null default 0,
  field_notes text not null default '',
  path jsonb not null default '[]'::jsonb,
  spot_records jsonb not null default '[]'::jsonb,
  source text not null default 'trailtrip-web',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.walk_sessions enable row level security;

create policy if not exists "anon can upsert walk sessions"
  on public.walk_sessions
  for all
  to anon
  using (true)
  with check (true);
