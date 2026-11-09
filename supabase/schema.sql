-- TetriSlop: Supabase table for game logs (run once in the Supabase SQL editor).
-- One row per game; columns = top-level keys of the client payload.
-- If you already created the table, use this as a reference for column names/types.

create table if not exists public.games (
  game_id            uuid primary key,             -- duplicate inserts -> HTTP 409 (client treats as "already saved")
  player_id          uuid        not null,
  timestamp_utc      timestamptz not null,         -- game start (client clock)
  game_version       text        not null,
  input_device       text        not null check (input_device in ('keyboard', 'touch', 'mixed')),
  termination_reason text        not null check (termination_reason in ('top_out', 'manual_restart', 'window_closed')),
  is_afk             boolean     not null default false,
  total_moves        integer     not null check (total_moves >= 3),
  final_score        integer     not null check (final_score >= 0),
  final_lines        integer     not null check (final_lines >= 0),
  moves              jsonb       not null,
  created_at         timestamptz not null default now(),  -- server receive time

  -- cheap sanity checks against garbage / oversized inserts from the public anon key
  constraint moves_is_array    check (jsonb_typeof(moves) = 'array'),
  constraint moves_match_total check (jsonb_array_length(moves) = total_moves),
  constraint moves_size_limit  check (pg_column_size(moves) < 5000000)
);

create index if not exists games_training_idx on public.games (termination_reason, is_afk, timestamp_utc);

-- Row Level Security: anonymous players may only INSERT. No SELECT/UPDATE/DELETE policy
-- exists, so those are denied for anon. The export script uses the service role key,
-- which bypasses RLS.
alter table public.games enable row level security;

drop policy if exists "anon can insert games" on public.games;
create policy "anon can insert games"
  on public.games
  for insert
  to anon
  with check (true);
