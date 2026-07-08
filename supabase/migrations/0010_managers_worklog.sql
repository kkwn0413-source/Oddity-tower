-- =============================================================================
-- 0010: 프로젝트 관리자(최대 6명) + 개인 업무일지 (사용자 확장 — 2026-07-08)
--  * project_managers: director가 프로젝트별로 최대 6명 지정(누가 지정했는지 기록).
--    관리자는 담당 프로젝트의 태스크·마일스톤 생성·수정·삭제 가능.
--    단가(task_finance)·선발주(proc_items)·프로젝트 자체 수정은 여전히 대표 전용.
--  * work_logs: 개인별 업무일지 — 본인 전체 CRUD + 대표 열람(SELECT)만.
--    hours(실제 업무시간)가 정산 기준, note는 비고.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- project_managers
-- -----------------------------------------------------------------------------
create table if not exists public.project_managers (
  project_id uuid not null references public.projects(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (project_id, profile_id)
);

create or replace function public.enforce_manager_limit()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from public.project_managers where project_id = new.project_id) >= 6 then
    raise exception '프로젝트 관리자는 최대 6명까지입니다' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_manager_limit on public.project_managers;
create trigger trg_manager_limit
  before insert on public.project_managers
  for each row execute function public.enforce_manager_limit();

create or replace function public.is_project_manager(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.project_managers
    where project_id = p_project_id and profile_id = auth.uid()
  );
$$;

alter table public.project_managers enable row level security;

-- 지정/해제는 director만, 목록은 팀 전원 조회 가능(이름·지정자 표시용 — 민감정보 없음)
drop policy if exists project_managers_select on public.project_managers;
create policy project_managers_select on public.project_managers
  for select to authenticated
  using (true);

drop policy if exists project_managers_director_insert on public.project_managers;
create policy project_managers_director_insert on public.project_managers
  for insert to authenticated
  with check (public.is_director() and assigned_by = auth.uid());

drop policy if exists project_managers_director_delete on public.project_managers;
create policy project_managers_director_delete on public.project_managers
  for delete to authenticated
  using (public.is_director());

-- -----------------------------------------------------------------------------
-- 관리자 권한 확장: 담당 프로젝트의 tasks·milestones 전체 CRUD + 프로젝트/클라이언트 조회
-- -----------------------------------------------------------------------------
drop policy if exists tasks_manager_all on public.tasks;
create policy tasks_manager_all on public.tasks
  for all to authenticated
  using (public.is_project_manager(project_id))
  with check (public.is_project_manager(project_id));

drop policy if exists milestones_manager_all on public.milestones;
create policy milestones_manager_all on public.milestones
  for all to authenticated
  using (public.is_project_manager(project_id))
  with check (public.is_project_manager(project_id));

drop policy if exists projects_manager_select on public.projects;
create policy projects_manager_select on public.projects
  for select to authenticated
  using (public.is_project_manager(id));

create or replace function public.is_manager_of_client(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    join public.project_managers m on m.project_id = p.id
    where p.client_id = p_client_id and m.profile_id = auth.uid()
  );
$$;

drop policy if exists clients_manager_select on public.clients;
create policy clients_manager_select on public.clients
  for select to authenticated
  using (public.is_manager_of_client(id));

-- 관리자는 status 외 컬럼 제한(0002 trigger) 예외 — RLS with check가
-- 이동 대상 프로젝트의 관리자 여부까지 이미 강제한다
create or replace function public.enforce_task_update_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_system_context() or public.is_director()
     or public.is_project_manager(old.project_id) then
    return new;
  end if;
  if (new.project_id, new.name, new.description, new.assignee_id,
      new.start_date, new.end_date, new.sort_order, new.created_at)
     is distinct from
     (old.project_id, old.name, old.description, old.assignee_id,
      old.start_date, old.end_date, old.sort_order, old.created_at)
  then
    raise exception '프리랜서는 태스크 상태만 변경할 수 있습니다'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 관리자는 담당 프로젝트의 파일·코멘트도 접근 (storage 정책까지 자동 전파)
create or replace function public.can_access_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_director() or exists (
    select 1 from public.tasks t
    where t.id = p_task_id
      and (t.assignee_id = auth.uid() or public.is_project_manager(t.project_id))
  );
$$;

-- -----------------------------------------------------------------------------
-- work_logs: 개인 업무일지 — 본인 전체 CRUD, 대표는 열람(SELECT)만
-- -----------------------------------------------------------------------------
create table if not exists public.work_logs (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  project_id uuid references public.projects(id) on delete set null,
  content text not null,
  hours numeric(5,2) check (hours is null or (hours >= 0 and hours <= 24)), -- 실제 업무시간(정산 기준)
  note text, -- 비고
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_logs_author_date on public.work_logs (author_id, work_date desc);

drop trigger if exists trg_touch_work_logs on public.work_logs;
create trigger trg_touch_work_logs
  before update on public.work_logs
  for each row execute function public.touch_updated_at();

alter table public.work_logs enable row level security;

drop policy if exists work_logs_own_all on public.work_logs;
create policy work_logs_own_all on public.work_logs
  for all to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

drop policy if exists work_logs_director_select on public.work_logs;
create policy work_logs_director_select on public.work_logs
  for select to authenticated
  using (public.is_director());
