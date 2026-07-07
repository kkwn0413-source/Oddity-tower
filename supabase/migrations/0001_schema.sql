-- =============================================================================
-- 오디티하우스 컨트롤타워 — 0001 스키마
-- 전체 테이블 + 인덱스 + updated_at 트리거. 재실행 안전(idempotent).
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 사용자 프로필 (auth.users 1:1)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('director', 'freelancer')),
  color text not null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 클라이언트(발주처/협업사)
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  memo text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 프로젝트 — code는 파일 네이밍에 사용 (예: ZONE2)
-- prod_anchor_date: 제작 완료 목표일 (선발주 마지노선 역산 기준)
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null,
  code text not null unique,
  status text not null default 'active' check (status in ('active', 'done', 'hold')),
  prod_anchor_date date,
  created_at timestamptz not null default now()
);

create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  due_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  description text,
  assignee_id uuid references public.profiles(id) on delete set null,
  start_date date not null,
  end_date date not null,
  status text not null default 'wait' check (status in ('wait', 'active', 'done')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 단가/정산 — 반드시 별도 테이블 (대표 전용 RLS, 뷰 가림 금지 원칙)
-- -----------------------------------------------------------------------------
create table if not exists public.task_finance (
  task_id uuid primary key references public.tasks(id) on delete cascade,
  fee int,
  withholding boolean not null default true,
  paid_at date,
  memo text
);

-- -----------------------------------------------------------------------------
-- 태스크 파일 — kind='upload'면 url은 storage path, 링크면 외부 URL
-- -----------------------------------------------------------------------------
create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('upload', 'drive', 'figma')),
  name text not null,
  url text not null,
  version int not null default 1,
  approved boolean not null default false, -- true인 것만 공유 링크 노출
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  internal boolean not null default false, -- true = 내부 전용, 공유 링크 제외
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 이벤트 로그 — 모든 mutation 경로에서 기록 (Phase 2 브리핑 원료)
-- -----------------------------------------------------------------------------
create table if not exists public.events (
  id bigint generated always as identity primary key,
  actor_id uuid,
  project_id uuid,
  task_id uuid,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 공유 링크 — 발주처용 읽기 전용. RLS 우회가 아니라 /api/share/[token]에서
-- service role + 화이트리스트로 처리.
-- show_verdict_badge: 보드 포함 시 좋음/나쁨 배지 노출 여부 (기본 off, 6.2)
-- -----------------------------------------------------------------------------
create table if not exists public.share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz,
  revoked boolean not null default false,
  include_board boolean not null default false,
  show_verdict_badge boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 레퍼런스 보드 — 프로젝트당 1개, 구역(zone) 단위
-- -----------------------------------------------------------------------------
create table if not exists public.ref_zones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ref_images (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references public.ref_zones(id) on delete cascade,
  uploader_id uuid not null references public.profiles(id),
  kind text not null check (kind in ('upload', 'url')),
  url text not null,
  filename text,
  starred boolean not null default false, -- 채택 후보 ★ (누구나)
  hidden boolean not null default false,  -- 보기 모드 제외
  memo text,
  -- 디렉팅 판정 (director 전용, set_verdict RPC 경유만)
  verdict text check (verdict in ('good', 'bad')),
  verdict_memo text, -- 판정 이유 — verdict 설정 시 필수
  verdict_by uuid references public.profiles(id),
  verdict_at timestamptz,
  doc_group text, -- 다페이지 문서 묶음 — 같은 값끼리 가로 스트립
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 방향 로그 — 수정은 UPDATE가 아니라 새 row + supersedes (이력 보존)
-- -----------------------------------------------------------------------------
create table if not exists public.direction_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'superseded')),
  supersedes uuid references public.direction_logs(id),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 선발주 트래커 (대표 전용 — task_finance와 동일 등급)
-- 발주 마지노선 = prod_anchor_date − lead_weeks×7 − buffer_days
-- -----------------------------------------------------------------------------
create table if not exists public.proc_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  name text not null,
  lead_weeks numeric not null,
  buffer_days int not null default 3,
  ordered_at date, -- null = 미발주
  vendor text,
  memo text,
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 개인 메모 — 본인만 (director 포함 타인 접근 불가)
-- -----------------------------------------------------------------------------
create table if not exists public.personal_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete cascade,
  body text not null,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 피드 읽음 커서 — 디렉팅 피드백 안 읽음 배지 계산
-- -----------------------------------------------------------------------------
create table if not exists public.feed_cursors (
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  primary key (user_id, project_id)
);

-- -----------------------------------------------------------------------------
-- 인덱스
-- -----------------------------------------------------------------------------
create index if not exists idx_projects_client on public.projects (client_id);
create index if not exists idx_milestones_project on public.milestones (project_id);
create index if not exists idx_tasks_project on public.tasks (project_id);
create index if not exists idx_tasks_assignee on public.tasks (assignee_id);
create index if not exists idx_task_files_task on public.task_files (task_id);
create index if not exists idx_comments_task on public.comments (task_id);
create index if not exists idx_events_project on public.events (project_id, created_at desc);
create index if not exists idx_events_type on public.events (type, created_at desc);
create index if not exists idx_share_links_project on public.share_links (project_id);
create index if not exists idx_ref_zones_project on public.ref_zones (project_id);
create index if not exists idx_ref_images_zone on public.ref_images (zone_id);
create index if not exists idx_direction_logs_project on public.direction_logs (project_id, created_at desc);
create index if not exists idx_proc_items_project on public.proc_items (project_id);
create index if not exists idx_personal_notes_user on public.personal_notes (user_id);

-- -----------------------------------------------------------------------------
-- updated_at 자동 갱신
-- -----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_tasks on public.tasks;
create trigger trg_touch_tasks
  before update on public.tasks
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_touch_personal_notes on public.personal_notes;
create trigger trg_touch_personal_notes
  before update on public.personal_notes
  for each row execute function public.touch_updated_at();
