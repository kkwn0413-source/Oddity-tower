-- =============================================================================
-- 0003 — 보드 시스템 확장 (v17 레퍼런스보드 흡수)
--
--  * boards: 프로젝트 보드(프로젝트당 1) / 개인 수집 보드(인당 1, 공유 토글) /
--    전체 공유 보드
--  * ref_zones: project_id → board_id 재구조화 + 수령일 배지(batch_label)
--  * meetings: 차수별 회의록 (유지/추가/제거 항목 + 첨삭 코멘트 + 수정 이력)
--  * board_assets: 보드별 파일 링크 (드라이브/피그마)
--  * events: board_id 추가 + 참여자 공유 SELECT (단가·선발주 유형 제외)
--  * storage: ref-images 버킷 정책 (경로 = {board_id}/{file})
-- =============================================================================

-- -----------------------------------------------------------------------------
-- boards
-- -----------------------------------------------------------------------------
create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('project', 'personal', 'shared')),
  project_id uuid references public.projects(id) on delete cascade,
  owner_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  shared boolean not null default false, -- personal 보드의 전체 공개 여부
  created_at timestamptz not null default now(),
  check ((kind = 'project') = (project_id is not null)),
  check ((kind = 'personal') = (owner_id is not null))
);

create unique index if not exists uq_boards_project
  on public.boards (project_id) where kind = 'project';
create unique index if not exists uq_boards_personal
  on public.boards (owner_id) where kind = 'personal';

-- -----------------------------------------------------------------------------
-- ref_zones 재구조화: board_id + batch_label(수령일 칩)
-- -----------------------------------------------------------------------------
alter table public.ref_zones
  add column if not exists board_id uuid references public.boards(id) on delete cascade,
  add column if not exists batch_label text;

-- 기존 프로젝트에 보드 백필
insert into public.boards (kind, project_id, title)
select 'project', p.id, p.name
from public.projects p
where not exists (
  select 1 from public.boards b where b.kind = 'project' and b.project_id = p.id
);

update public.ref_zones z
set board_id = b.id
from public.boards b
where z.board_id is null
  and b.kind = 'project'
  and b.project_id = z.project_id;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ref_zones' and column_name = 'board_id'
      and is_nullable = 'YES'
  ) then
    alter table public.ref_zones alter column board_id set not null;
  end if;
end $$;

-- project_id 의존 구 정책 선제 제거 (0002에서 생성)
drop policy if exists ref_zones_freelancer_select on public.ref_zones;
drop policy if exists ref_zones_freelancer_insert on public.ref_zones;
drop policy if exists ref_zones_freelancer_update on public.ref_zones;

alter table public.ref_zones drop column if exists project_id;

create index if not exists idx_ref_zones_board on public.ref_zones (board_id);

-- -----------------------------------------------------------------------------
-- 차수별 회의록
-- -----------------------------------------------------------------------------
create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  round int not null, -- 차수
  title text,
  met_at date not null,
  body text, -- 자유 본문
  author_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_meetings_board on public.meetings (board_id, round desc);

-- 유지/추가/제거/메모 항목
create table if not exists public.meeting_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  kind text not null check (kind in ('keep', 'add', 'remove', 'note')),
  body text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_items_meeting on public.meeting_items (meeting_id, sort_order);

-- 수정 이력 — save_meeting RPC가 저장 전 스냅샷 기록
create table if not exists public.meeting_revisions (
  id bigint generated always as identity primary key,
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  snapshot jsonb not null,
  edited_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_revisions_meeting on public.meeting_revisions (meeting_id, created_at desc);

-- 첨삭 코멘트
create table if not exists public.meeting_comments (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_meeting_comments_meeting on public.meeting_comments (meeting_id, created_at);

-- -----------------------------------------------------------------------------
-- 보드 파일 링크 (v17 assets — 드라이브/피그마 등 이름+URL)
-- -----------------------------------------------------------------------------
create table if not exists public.board_assets (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  name text not null,
  url text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_board_assets_board on public.board_assets (board_id, sort_order);

-- -----------------------------------------------------------------------------
-- events: board 컨텍스트
-- -----------------------------------------------------------------------------
alter table public.events add column if not exists board_id uuid;

-- -----------------------------------------------------------------------------
-- 접근 헬퍼 (security definer)
-- -----------------------------------------------------------------------------
create or replace function public.can_view_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and (
        public.is_director()
        or b.kind = 'shared'
        or (b.kind = 'personal' and (b.owner_id = auth.uid() or b.shared))
        or (b.kind = 'project' and public.is_assigned_to_project(b.project_id))
      )
  );
$$;

create or replace function public.can_edit_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and (
        public.is_director()
        or b.kind = 'shared'
        or (b.kind = 'personal' and b.owner_id = auth.uid())
        or (b.kind = 'project' and public.is_assigned_to_project(b.project_id))
      )
  );
$$;

-- 파괴적 작업(존/이미지 삭제): 프로젝트 보드는 director만, 개인/공유는 편집자
create or replace function public.can_delete_on_board(p_board_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.boards b
    where b.id = p_board_id
      and (
        public.is_director()
        or (b.kind = 'personal' and b.owner_id = auth.uid())
        or b.kind = 'shared'
      )
  );
$$;

-- 기존 zone 헬퍼를 board 기반으로 재정의 (0002의 ref_images 정책이 사용)
create or replace function public.can_access_zone(p_zone_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.ref_zones z
    where z.id = p_zone_id and public.can_view_board(z.board_id)
  );
$$;

create or replace function public.can_edit_zone(p_zone_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.ref_zones z
    where z.id = p_zone_id and public.can_edit_board(z.board_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- RLS — 신규 테이블
-- -----------------------------------------------------------------------------
alter table public.boards enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_items enable row level security;
alter table public.meeting_revisions enable row level security;
alter table public.meeting_comments enable row level security;
alter table public.board_assets enable row level security;

-- boards
drop policy if exists boards_select on public.boards;
create policy boards_select on public.boards
  for select to authenticated
  using (can_view_board(id));

drop policy if exists boards_director_all on public.boards;
create policy boards_director_all on public.boards
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists boards_personal_insert on public.boards;
create policy boards_personal_insert on public.boards
  for insert to authenticated
  with check (kind = 'personal' and owner_id = auth.uid());

drop policy if exists boards_personal_update on public.boards;
create policy boards_personal_update on public.boards
  for update to authenticated
  using (kind = 'personal' and owner_id = auth.uid())
  with check (kind = 'personal' and owner_id = auth.uid());

drop policy if exists boards_personal_delete on public.boards;
create policy boards_personal_delete on public.boards
  for delete to authenticated
  using (kind = 'personal' and owner_id = auth.uid());

-- meetings: 열람=보드 열람자, 작성/수정=보드 편집자(수정은 RPC 권장), 삭제=작성자/director
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings
  for select to authenticated using (can_view_board(board_id));

drop policy if exists meetings_insert on public.meetings;
create policy meetings_insert on public.meetings
  for insert to authenticated
  with check (author_id = auth.uid() and can_edit_board(board_id));

drop policy if exists meetings_update on public.meetings;
create policy meetings_update on public.meetings
  for update to authenticated
  using (can_edit_board(board_id))
  with check (can_edit_board(board_id));

drop policy if exists meetings_delete on public.meetings;
create policy meetings_delete on public.meetings
  for delete to authenticated
  using (author_id = auth.uid() or public.is_director());

-- meeting_items: 회의록 편집 권한과 동일
drop policy if exists meeting_items_select on public.meeting_items;
create policy meeting_items_select on public.meeting_items
  for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and can_view_board(m.board_id)));

drop policy if exists meeting_items_write on public.meeting_items;
create policy meeting_items_write on public.meeting_items
  for all to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and can_edit_board(m.board_id)))
  with check (exists (select 1 from public.meetings m where m.id = meeting_id and can_edit_board(m.board_id)));

-- meeting_revisions: 읽기 전용 이력 (쓰기는 RPC 내부에서만)
drop policy if exists meeting_revisions_select on public.meeting_revisions;
create policy meeting_revisions_select on public.meeting_revisions
  for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and can_view_board(m.board_id)));

-- meeting_comments(첨삭): 열람자 누구나 작성, 본인/director만 수정·삭제
drop policy if exists meeting_comments_select on public.meeting_comments;
create policy meeting_comments_select on public.meeting_comments
  for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_id and can_view_board(m.board_id)));

drop policy if exists meeting_comments_insert on public.meeting_comments;
create policy meeting_comments_insert on public.meeting_comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (select 1 from public.meetings m where m.id = meeting_id and can_view_board(m.board_id))
  );

drop policy if exists meeting_comments_update on public.meeting_comments;
create policy meeting_comments_update on public.meeting_comments
  for update to authenticated
  using (author_id = auth.uid() or public.is_director())
  with check (author_id = auth.uid() or public.is_director());

drop policy if exists meeting_comments_delete on public.meeting_comments;
create policy meeting_comments_delete on public.meeting_comments
  for delete to authenticated
  using (author_id = auth.uid() or public.is_director());

-- board_assets
drop policy if exists board_assets_select on public.board_assets;
create policy board_assets_select on public.board_assets
  for select to authenticated using (can_view_board(board_id));

drop policy if exists board_assets_write on public.board_assets;
create policy board_assets_write on public.board_assets
  for all to authenticated
  using (can_edit_board(board_id))
  with check (can_edit_board(board_id));

-- -----------------------------------------------------------------------------
-- ref_zones / ref_images 정책 재작성 (board 기반)
-- -----------------------------------------------------------------------------
drop policy if exists ref_zones_director_all on public.ref_zones;
create policy ref_zones_director_all on public.ref_zones
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists ref_zones_freelancer_select on public.ref_zones;
create policy ref_zones_freelancer_select on public.ref_zones
  for select to authenticated using (can_view_board(board_id));

drop policy if exists ref_zones_freelancer_insert on public.ref_zones;
create policy ref_zones_freelancer_insert on public.ref_zones
  for insert to authenticated with check (can_edit_board(board_id));

drop policy if exists ref_zones_freelancer_update on public.ref_zones;
create policy ref_zones_freelancer_update on public.ref_zones
  for update to authenticated
  using (can_edit_board(board_id))
  with check (can_edit_board(board_id));

drop policy if exists ref_zones_delete on public.ref_zones;
create policy ref_zones_delete on public.ref_zones
  for delete to authenticated using (can_delete_on_board(board_id));

-- ref_images: 0002 정책이 can_access_zone을 쓰므로 select/update는 유지되지만,
-- 편집 판단을 명확히 하기 위해 재정의
drop policy if exists ref_images_freelancer_select on public.ref_images;
create policy ref_images_freelancer_select on public.ref_images
  for select to authenticated using (public.can_access_zone(zone_id));

drop policy if exists ref_images_freelancer_insert on public.ref_images;
create policy ref_images_freelancer_insert on public.ref_images
  for insert to authenticated
  with check (uploader_id = auth.uid() and public.can_edit_zone(zone_id));

drop policy if exists ref_images_freelancer_update on public.ref_images;
create policy ref_images_freelancer_update on public.ref_images
  for update to authenticated
  using (public.can_edit_zone(zone_id))
  with check (public.can_edit_zone(zone_id));

drop policy if exists ref_images_delete on public.ref_images;
create policy ref_images_delete on public.ref_images
  for delete to authenticated
  using (
    uploader_id = auth.uid()
    or exists (select 1 from public.ref_zones z where z.id = zone_id and can_delete_on_board(z.board_id))
  );

-- -----------------------------------------------------------------------------
-- events: 참여자 공유 SELECT — "로그 다 같이 본다".
-- 단가/선발주 유형은 director 외 차단 (원가 노출 방지 원칙 유지)
-- -----------------------------------------------------------------------------
drop policy if exists events_select_director on public.events;
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (
    public.is_director()
    or (
      type not like 'proc.%'
      and type not like 'finance.%'
      and (
        (project_id is not null and public.is_assigned_to_project(project_id))
        or (board_id is not null and can_view_board(board_id))
        or actor_id = auth.uid()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- RPC: 회의록 저장 (스냅샷 이력 + 항목 교체 + 이벤트) — 첨삭·수정의 단일 경로
-- p_items: [{kind, body}] 순서대로
-- -----------------------------------------------------------------------------
create or replace function public.save_meeting(
  p_meeting_id uuid,
  p_title text,
  p_met_at date,
  p_body text,
  p_items jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_board uuid;
  v_round int;
begin
  select board_id, round into v_board, v_round
  from public.meetings where id = p_meeting_id;
  if not found then
    raise exception '회의록을 찾을 수 없습니다';
  end if;
  if not can_edit_board(v_board) then
    raise exception '이 보드의 편집 권한이 없습니다' using errcode = '42501';
  end if;

  -- 수정 전 스냅샷
  insert into public.meeting_revisions (meeting_id, snapshot, edited_by)
  select m.id,
    jsonb_build_object(
      'title', m.title, 'met_at', m.met_at, 'body', m.body, 'round', m.round,
      'items', coalesce(
        (select jsonb_agg(jsonb_build_object('kind', mi.kind, 'body', mi.body) order by mi.sort_order)
         from public.meeting_items mi where mi.meeting_id = m.id),
        '[]'::jsonb
      )
    ),
    auth.uid()
  from public.meetings m where m.id = p_meeting_id;

  update public.meetings
  set title = p_title, met_at = p_met_at, body = p_body, updated_at = now()
  where id = p_meeting_id;

  delete from public.meeting_items where meeting_id = p_meeting_id;
  insert into public.meeting_items (meeting_id, kind, body, sort_order)
  select p_meeting_id, i->>'kind', i->>'body', ord - 1
  from jsonb_array_elements(p_items) with ordinality as t(i, ord)
  where coalesce(i->>'body', '') <> '';

  insert into public.events (actor_id, board_id, type, payload)
  values (auth.uid(), v_board, 'meeting.saved',
    jsonb_build_object('meeting_id', p_meeting_id, 'round', v_round, 'title', p_title));
end;
$$;

grant execute on function public.save_meeting(uuid, text, date, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Storage: ref-images 버킷 정책 (경로 규약: {board_id}/{filename})
-- -----------------------------------------------------------------------------
drop policy if exists "ref_images_read" on storage.objects;
create policy "ref_images_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ref-images'
    and public.can_view_board(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "ref_images_insert" on storage.objects;
create policy "ref_images_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ref-images'
    and public.can_edit_board(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "ref_images_delete" on storage.objects;
create policy "ref_images_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ref-images'
    and (
      owner = auth.uid()
      or public.can_delete_on_board(((storage.foldername(name))[1])::uuid)
    )
  );
