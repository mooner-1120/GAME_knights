-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하세요.

-- 1) 프로필 (로그인한 사람마다 1행, 전적 포함)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  provider text,
  favorite_class text,
  kills int not null default 0,
  deaths int not null default 0,
  wins int not null default 0,
  matches int not null default 0,
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

-- 2) 경기 기록
create table if not exists public.matches (
  id bigint generated always as identity primary key,
  mode text not null,
  winner_team int,
  ended_at timestamptz not null default now()
);
create table if not exists public.match_players (
  id bigint generated always as identity primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  name text,
  class_id text,
  team int,
  kills int not null default 0,
  deaths int not null default 0,
  won boolean not null default false
);
create index if not exists match_players_user_idx on public.match_players(user_id, match_id desc);

-- 3) 소셜 로그인 직후 즉시 프로필 생성 (Google/Discord/GitHub 등 어떤 제공자든 동일)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url, provider)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name',
             new.raw_user_meta_data->>'user_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture'),
    new.raw_app_meta_data->>'provider'
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 다시 로그인할 때마다 마지막 접속 시각 갱신
create or replace function public.handle_user_login() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set last_login_at = now() where id = new.id;
  return new;
end $$;
drop trigger if exists on_auth_user_login on auth.users;
create trigger on_auth_user_login after update of last_sign_in_at on auth.users
  for each row execute function public.handle_user_login();

-- 4) 한 판 결과 저장 (서버가 service_role 로만 호출)
create or replace function public.record_match(payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint; r jsonb;
begin
  insert into matches(mode, winner_team) values (payload->>'mode', nullif(payload->>'winner_team','')::int)
  returning id into mid;
  for r in select * from jsonb_array_elements(payload->'rows') loop
    insert into match_players(match_id, user_id, name, class_id, team, kills, deaths, won)
    values (mid, nullif(r->>'user_id','')::uuid, r->>'name', r->>'class_id',
            nullif(r->>'team','')::int, (r->>'kills')::int, (r->>'deaths')::int, (r->>'won')::boolean);
    if nullif(r->>'user_id','') is not null then
      update profiles set kills = kills + (r->>'kills')::int, deaths = deaths + (r->>'deaths')::int,
             wins = wins + case when (r->>'won')::boolean then 1 else 0 end,
             matches = matches + 1, favorite_class = r->>'class_id'
       where id = (r->>'user_id')::uuid;
    end if;
  end loop;
end $$;
revoke execute on function public.record_match(jsonb) from public, anon, authenticated;
grant execute on function public.record_match(jsonb) to service_role;

-- 5) 보안(RLS): 누구나 순위표는 볼 수 있지만, 전적 수정은 서버만 가능
alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
create policy "profiles readable" on public.profiles for select using (true);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
revoke update on public.profiles from anon, authenticated;
grant update (display_name, favorite_class) on public.profiles to authenticated; -- 킬/승수는 못 고침
create policy "matches readable" on public.matches for select using (true);
create policy "match_players readable" on public.match_players for select using (true);

-- 6) 실시간 순위표 (클라이언트가 profiles 변경을 구독)
alter publication supabase_realtime add table public.profiles;
