-- =============================================================================
-- 0011: AI 일정 반영 파이프라인 (사용자 확장 — 2026-07-08)
--  자료 입력 → Claude 해석(변경안) → 당사자 확인(ack) → 대표 최종 컨펌 → 반영.
--  * ai_change_sets: 해석 1회 = 세트 1개. director 전용 생성·반영·취소.
--  * ai_change_items: 변경안 항목. 당사자(assignee_id)는 자기 항목만 조회 +
--    ack 컬럼(ack_status/ack_comment/ack_at)만 수정 가능 — trigger로 강제.
-- =============================================================================

create table if not exists public.ai_change_sets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id),
  source_text text not null,           -- 대표가 붙여넣은 원문 자료
  summary text not null default '',    -- Claude가 만든 전체 요약
  notes text,                          -- 해석이 불확실했던 부분
  status text not null default 'proposed'
    check (status in ('proposed', 'applied', 'cancelled')),
  created_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists public.ai_change_items (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.ai_change_sets(id) on delete cascade,
  seq int not null default 0,
  action text not null check (action in ('create', 'update', 'delete')),
  task_id uuid references public.tasks(id) on delete set null, -- update/delete 대상
  project_id uuid references public.projects(id) on delete set null,
  assignee_id uuid references public.profiles(id),             -- 확인 팝업 대상자
  summary text not null,               -- 사람이 읽는 한 줄 설명 (한국어)
  payload jsonb not null default '{}'::jsonb, -- create/update 필드 값
  before jsonb,                        -- update/delete 시 기존 값 스냅샷
  ack_status text not null default 'pending'
    check (ack_status in ('pending', 'agreed', 'disputed')),
  ack_comment text,
  ack_at timestamptz,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_items_set on public.ai_change_items (set_id, seq);
create index if not exists idx_ai_items_assignee on public.ai_change_items (assignee_id, ack_status);

alter table public.ai_change_sets enable row level security;
alter table public.ai_change_items enable row level security;

-- 세트: director 전체 CRUD. 당사자는 자기 항목이 있는 세트만 조회(요약 표시용).
drop policy if exists ai_sets_director_all on public.ai_change_sets;
create policy ai_sets_director_all on public.ai_change_sets
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists ai_sets_assignee_select on public.ai_change_sets;
create policy ai_sets_assignee_select on public.ai_change_sets
  for select to authenticated
  using (exists (
    select 1 from public.ai_change_items i
    where i.set_id = id and i.assignee_id = auth.uid()
  ));

-- 항목: director 전체. 당사자는 자기 항목 SELECT + UPDATE(ack 컬럼만 — trigger 강제).
drop policy if exists ai_items_director_all on public.ai_change_items;
create policy ai_items_director_all on public.ai_change_items
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists ai_items_assignee_select on public.ai_change_items;
create policy ai_items_assignee_select on public.ai_change_items
  for select to authenticated
  using (assignee_id = auth.uid());

drop policy if exists ai_items_assignee_ack on public.ai_change_items;
create policy ai_items_assignee_ack on public.ai_change_items
  for update to authenticated
  using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

-- 당사자는 ack_status/ack_comment/ack_at 외 컬럼 변경 불가, pending → agreed|disputed만.
create or replace function public.enforce_ack_update_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_director() then
    return new;
  end if;
  if (new.set_id, new.seq, new.action, new.task_id, new.project_id, new.assignee_id,
      new.summary, new.payload, new.before, new.applied, new.created_at)
     is distinct from
     (old.set_id, old.seq, old.action, old.task_id, old.project_id, old.assignee_id,
      old.summary, old.payload, old.before, old.applied, old.created_at)
  then
    raise exception '확인 응답(ack) 외 항목은 수정할 수 없습니다' using errcode = '42501';
  end if;
  if new.ack_status not in ('agreed', 'disputed') then
    raise exception '응답은 확인(agreed) 또는 이견(disputed)만 가능합니다' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_ack_update on public.ai_change_items;
create trigger trg_enforce_ack_update
  before update on public.ai_change_items
  for each row execute function public.enforce_ack_update_columns();

-- 세트 조회용 헬퍼: 정책 서브쿼리가 items RLS에 다시 걸리지 않도록 security definer
create or replace function public.has_ai_items_in_set(p_set_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.ai_change_items
    where set_id = p_set_id and assignee_id = auth.uid()
  );
$$;

drop policy if exists ai_sets_assignee_select on public.ai_change_sets;
create policy ai_sets_assignee_select on public.ai_change_sets
  for select to authenticated
  using (public.has_ai_items_in_set(id));
