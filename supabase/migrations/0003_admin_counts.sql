-- photo2pgn: per-person counts for the HintWise admin list (owner, 13 Nov
-- 2026: add a games count). The platform's credits-grant function calls
-- app_photo2pgn.admin_user_counts() with the service role when an admin
-- lists photo2pgn's people, and shows each count next to the person.
-- Counts only: no game content leaves the schema. Idempotent.

grant usage on schema app_photo2pgn to service_role;

create or replace function app_photo2pgn.admin_user_counts()
returns table (user_id uuid, counts jsonb)
language sql
stable
security definer
set search_path = app_photo2pgn, pg_temp
as $$
  select g.user_id, jsonb_build_object('games', count(*))
    from app_photo2pgn.games g
   group by g.user_id;
$$;
comment on function app_photo2pgn.admin_user_counts() is 'For the HintWise admin list (service role only): saved games per person.';
revoke all on function app_photo2pgn.admin_user_counts() from public;
grant execute on function app_photo2pgn.admin_user_counts() to service_role;
