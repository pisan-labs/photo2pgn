-- photo2pgn: "My games" for signed-in visitors. One row per game: the
-- reading, the person's edits and notes, and the PGN. No photos are stored.
-- Idempotent; once applied this file never changes (add 0003_... instead).

create schema if not exists app_photo2pgn;
comment on schema app_photo2pgn is 'photo2pgn: saved games per user; dropping the schema retires the app.';

create table if not exists app_photo2pgn.games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  game jsonb not null,
  pgn text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table app_photo2pgn.games is 'A saved game: the reading, edits, notes and PGN; owned by user_id.';
create index if not exists games_user_updated_idx on app_photo2pgn.games (user_id, updated_at);

alter table app_photo2pgn.games enable row level security;

drop policy if exists games_select_own on app_photo2pgn.games;
create policy games_select_own on app_photo2pgn.games for select to authenticated using (user_id = auth.uid());
drop policy if exists games_insert_own on app_photo2pgn.games;
create policy games_insert_own on app_photo2pgn.games for insert to authenticated with check (user_id = auth.uid());
drop policy if exists games_update_own on app_photo2pgn.games;
create policy games_update_own on app_photo2pgn.games for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists games_delete_own on app_photo2pgn.games;
create policy games_delete_own on app_photo2pgn.games for delete to authenticated using (user_id = auth.uid());

-- Signed-in users only; anonymous visitors get no grants in app schemas.
grant usage on schema app_photo2pgn to authenticated;
grant all on all tables in schema app_photo2pgn to authenticated;
grant all on all sequences in schema app_photo2pgn to authenticated;
alter default privileges in schema app_photo2pgn grant all on tables to authenticated;
alter default privileges in schema app_photo2pgn grant all on sequences to authenticated;
