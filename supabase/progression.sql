-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run 하세요. (schema.sql 을 이미 실행한 뒤, 한 번만)
-- 레벨/경험치/코인/업적/칭호/꾸미기(인벤토리), 직업별 전적을 저장합니다.

-- 1) 진행도 (로그인한 사람마다 1행)
create table if not exists public.player_data (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  xp int not null default 0,
  coins int not null default 0,
  title text,                                  -- 장착한 칭호
  equipped jsonb not null default '{}'::jsonb, -- 장착한 꾸미기 {"cape":"cape_red","hat":"hat_crown"}
  owned jsonb not null default '[]'::jsonb,    -- 가진 꾸미기 id 목록
  counters jsonb not null default '{}'::jsonb, -- 업적 카운터 (처치, 패링 횟수 등)
  ach jsonb not null default '{}'::jsonb,      -- 달성한 업적 {"id": 달성시각}
  updated_at timestamptz not null default now()
);

-- 2) 직업별 전적
create table if not exists public.class_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  class_id text not null,
  kills int not null default 0,
  deaths int not null default 0,
  wins int not null default 0,
  matches int not null default 0,
  primary key (user_id, class_id)
);
create index if not exists class_stats_rank_idx on public.class_stats(class_id, kills desc);

-- 3) 보안(RLS): 누구나 읽을 수 있지만, 쓰기는 서버(service_role)만 가능 → 코인/레벨 조작 불가
alter table public.player_data enable row level security;
alter table public.class_stats enable row level security;
drop policy if exists "player_data readable" on public.player_data;
drop policy if exists "class_stats readable" on public.class_stats;
create policy "player_data readable" on public.player_data for select using (true);
create policy "class_stats readable" on public.class_stats for select using (true);
revoke insert, update, delete on public.player_data from anon, authenticated;
revoke insert, update, delete on public.class_stats from anon, authenticated;
