-- =============================================================================
-- 오디티하우스 컨트롤타워 — 0002 RLS 정책 + 헬퍼 + RPC
--
-- 원칙 (스펙 5장):
--  * task_finance / proc_items: director 전용 — freelancer 정책 자체가 없음
--  * personal_notes: 본인만 — director 포함 타인 정책 없음
--  * ref_images.verdict*: set_verdict RPC 경유만 — 일반 UPDATE는 trigger 차단
--  * direction_logs: UPDATE/DELETE 정책 없음 — 수정은 새 row + supersedes
--  * 공유 링크는 RLS 우회가 아니라 /api/share/[token] service role + 화이트리스트
--
-- 재실행 안전(idempotent): drop policy if exists 후 create.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 헬퍼 함수 (security definer — 정책 내 교차 테이블 조회 시 RLS 재귀 방지)
-- -----------------------------------------------------------------------------

create or replace function public.is_director()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'director'
  );
$$;

-- 해당 프로젝트에 배정된 태스크가 있는가 (freelancer 프로젝트 접근 기준)
create or replace function public.is_assigned_to_project(p_project_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.tasks
    where project_id = p_project_id and assignee_id = auth.uid()
  );
$$;

-- 해당 클라이언트 산하에 배정 프로젝트가 있는가
create or replace function public.is_assigned_to_client(p_client_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.projects p
    join public.tasks t on t.project_id = p.id
    where p.client_id = p_client_id and t.assignee_id = auth.uid()
  );
$$;

-- 태스크 접근 가능 여부 (director 또는 본인 배정)
create or replace function public.can_access_task(p_task_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_director() or exists (
    select 1 from public.tasks
    where id = p_task_id and assignee_id = auth.uid()
  );
$$;

-- zone → 프로젝트 접근 가능 여부
create or replace function public.can_access_zone(p_zone_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.ref_zones z
    where z.id = p_zone_id
      and (public.is_director() or public.is_assigned_to_project(z.project_id))
  );
$$;

-- 시스템 컨텍스트 여부: service role(시드/공유 API) 또는 직접 DB 접속(마이그레이션)
create or replace function public.is_system_context()
returns boolean
language sql stable
as $$
  select coalesce(auth.role(), '') = 'service_role' or auth.uid() is null;
$$;

-- -----------------------------------------------------------------------------
-- RLS 활성화
-- -----------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.projects enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.task_finance enable row level security;
alter table public.task_files enable row level security;
alter table public.comments enable row level security;
alter table public.events enable row level security;
alter table public.share_links enable row level security;
alter table public.ref_zones enable row level security;
alter table public.ref_images enable row level security;
alter table public.direction_logs enable row level security;
alter table public.proc_items enable row level security;
alter table public.personal_notes enable row level security;
alter table public.feed_cursors enable row level security;

-- -----------------------------------------------------------------------------
-- profiles: 본인 R/W, director 전체 R
-- (INSERT는 초대 플로우에서 service role로만 — 정책 없음)
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_director());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from public.profiles p2 where p2.id = auth.uid()));

-- -----------------------------------------------------------------------------
-- clients: director 전체 CRUD, freelancer는 배정 프로젝트의 클라이언트만 SELECT
-- -----------------------------------------------------------------------------
drop policy if exists clients_director_all on public.clients;
create policy clients_director_all on public.clients
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists clients_freelancer_select on public.clients;
create policy clients_freelancer_select on public.clients
  for select to authenticated
  using (public.is_assigned_to_client(id));

-- -----------------------------------------------------------------------------
-- projects
-- -----------------------------------------------------------------------------
drop policy if exists projects_director_all on public.projects;
create policy projects_director_all on public.projects
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists projects_freelancer_select on public.projects;
create policy projects_freelancer_select on public.projects
  for select to authenticated
  using (public.is_assigned_to_project(id));

-- -----------------------------------------------------------------------------
-- milestones
-- -----------------------------------------------------------------------------
drop policy if exists milestones_director_all on public.milestones;
create policy milestones_director_all on public.milestones
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists milestones_freelancer_select on public.milestones;
create policy milestones_freelancer_select on public.milestones
  for select to authenticated
  using (public.is_assigned_to_project(project_id));

-- -----------------------------------------------------------------------------
-- tasks: director 전체. freelancer는 본인 배정 row SELECT + UPDATE
-- (UPDATE 컬럼 제한은 아래 trigger로 강제 — status/updated_at만)
-- -----------------------------------------------------------------------------
drop policy if exists tasks_director_all on public.tasks;
create policy tasks_director_all on public.tasks
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists tasks_freelancer_select on public.tasks;
create policy tasks_freelancer_select on public.tasks
  for select to authenticated
  using (assignee_id = auth.uid());

drop policy if exists tasks_freelancer_update on public.tasks;
create policy tasks_freelancer_update on public.tasks
  for update to authenticated
  using (assignee_id = auth.uid())
  with check (assignee_id = auth.uid());

-- freelancer는 status 외 컬럼 변경 불가 (updated_at은 trigger가 관리)
create or replace function public.enforce_task_update_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if public.is_system_context() or public.is_director() then
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

drop trigger if exists trg_enforce_task_update on public.tasks;
create trigger trg_enforce_task_update
  before update on public.tasks
  for each row execute function public.enforce_task_update_columns();

-- -----------------------------------------------------------------------------
-- task_finance: director만. freelancer 정책 자체 없음.
-- -----------------------------------------------------------------------------
drop policy if exists task_finance_director_all on public.task_finance;
create policy task_finance_director_all on public.task_finance
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

-- -----------------------------------------------------------------------------
-- task_files: director 전체. freelancer는 자기 태스크 범위 SELECT/INSERT.
-- -----------------------------------------------------------------------------
drop policy if exists task_files_director_all on public.task_files;
create policy task_files_director_all on public.task_files
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists task_files_freelancer_select on public.task_files;
create policy task_files_freelancer_select on public.task_files
  for select to authenticated
  using (public.can_access_task(task_id));

drop policy if exists task_files_freelancer_insert on public.task_files;
create policy task_files_freelancer_insert on public.task_files
  for insert to authenticated
  with check (uploader_id = auth.uid() and public.can_access_task(task_id));

-- -----------------------------------------------------------------------------
-- comments: director 전체. freelancer는 자기 태스크 범위 SELECT/INSERT.
-- -----------------------------------------------------------------------------
drop policy if exists comments_director_all on public.comments;
create policy comments_director_all on public.comments
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists comments_freelancer_select on public.comments;
create policy comments_freelancer_select on public.comments
  for select to authenticated
  using (public.can_access_task(task_id));

drop policy if exists comments_freelancer_insert on public.comments;
create policy comments_freelancer_insert on public.comments
  for insert to authenticated
  with check (author_id = auth.uid() and public.can_access_task(task_id));

-- -----------------------------------------------------------------------------
-- events: INSERT 인증 사용자(본인 actor), SELECT director만
-- -----------------------------------------------------------------------------
drop policy if exists events_insert on public.events;
create policy events_insert on public.events
  for insert to authenticated
  with check (actor_id = auth.uid());

drop policy if exists events_select_director on public.events;
create policy events_select_director on public.events
  for select to authenticated
  using (public.is_director());

-- -----------------------------------------------------------------------------
-- share_links: director만
-- -----------------------------------------------------------------------------
drop policy if exists share_links_director_all on public.share_links;
create policy share_links_director_all on public.share_links
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

-- -----------------------------------------------------------------------------
-- ref_zones: director 전체 CRUD. freelancer는 배정 프로젝트 SELECT/INSERT/UPDATE.
-- -----------------------------------------------------------------------------
drop policy if exists ref_zones_director_all on public.ref_zones;
create policy ref_zones_director_all on public.ref_zones
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists ref_zones_freelancer_select on public.ref_zones;
create policy ref_zones_freelancer_select on public.ref_zones
  for select to authenticated
  using (public.is_assigned_to_project(project_id));

drop policy if exists ref_zones_freelancer_insert on public.ref_zones;
create policy ref_zones_freelancer_insert on public.ref_zones
  for insert to authenticated
  with check (public.is_assigned_to_project(project_id));

drop policy if exists ref_zones_freelancer_update on public.ref_zones;
create policy ref_zones_freelancer_update on public.ref_zones
  for update to authenticated
  using (public.is_assigned_to_project(project_id))
  with check (public.is_assigned_to_project(project_id));

-- -----------------------------------------------------------------------------
-- ref_images: director 전체. freelancer는 배정 프로젝트 SELECT/INSERT/UPDATE.
-- verdict* 컬럼은 아래 trigger가 일반 UPDATE/INSERT에서 차단 (RPC 경유만).
-- -----------------------------------------------------------------------------
drop policy if exists ref_images_director_all on public.ref_images;
create policy ref_images_director_all on public.ref_images
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists ref_images_freelancer_select on public.ref_images;
create policy ref_images_freelancer_select on public.ref_images
  for select to authenticated
  using (public.can_access_zone(zone_id));

drop policy if exists ref_images_freelancer_insert on public.ref_images;
create policy ref_images_freelancer_insert on public.ref_images
  for insert to authenticated
  with check (uploader_id = auth.uid() and public.can_access_zone(zone_id));

drop policy if exists ref_images_freelancer_update on public.ref_images;
create policy ref_images_freelancer_update on public.ref_images
  for update to authenticated
  using (public.can_access_zone(zone_id))
  with check (public.can_access_zone(zone_id));

-- verdict 가드: set_verdict RPC(트랜잭션 로컬 플래그) 외에는 director 포함 차단
create or replace function public.guard_ref_image_verdict()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_verdict', true), '') = '1'
     or public.is_system_context()
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.verdict is not null or new.verdict_memo is not null
       or new.verdict_by is not null or new.verdict_at is not null
    then
      raise exception '판정은 set_verdict RPC로만 설정할 수 있습니다'
        using errcode = '42501';
    end if;
  else
    if (new.verdict, new.verdict_memo, new.verdict_by, new.verdict_at)
       is distinct from
       (old.verdict, old.verdict_memo, old.verdict_by, old.verdict_at)
    then
      raise exception '판정은 set_verdict RPC로만 변경할 수 있습니다'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_ref_image_verdict on public.ref_images;
create trigger trg_guard_ref_image_verdict
  before insert or update on public.ref_images
  for each row execute function public.guard_ref_image_verdict();

-- -----------------------------------------------------------------------------
-- RPC: set_verdict — director 전용 디렉팅 판정 (이유 필수) + 이벤트 기록
-- p_verdict null이면 판정 해제.
-- -----------------------------------------------------------------------------
create or replace function public.set_verdict(
  p_image_id uuid,
  p_verdict text,
  p_memo text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_old_verdict text;
begin
  if not public.is_director() then
    raise exception '대표만 판정할 수 있습니다' using errcode = '42501';
  end if;

  if p_verdict is not null then
    if p_verdict not in ('good', 'bad') then
      raise exception '판정 값은 good 또는 bad 여야 합니다';
    end if;
    if p_memo is null or length(btrim(p_memo)) = 0 then
      raise exception '판정 이유는 필수입니다';
    end if;
  end if;

  select ri.verdict, z.project_id
    into v_old_verdict, v_project
  from public.ref_images ri
  join public.ref_zones z on z.id = ri.zone_id
  where ri.id = p_image_id;

  if not found then
    raise exception '이미지를 찾을 수 없습니다';
  end if;

  perform set_config('app.allow_verdict', '1', true);

  if p_verdict is null then
    update public.ref_images
    set verdict = null, verdict_memo = null, verdict_by = null, verdict_at = null
    where id = p_image_id;
  else
    update public.ref_images
    set verdict = p_verdict, verdict_memo = p_memo,
        verdict_by = auth.uid(), verdict_at = now()
    where id = p_image_id;
  end if;

  perform set_config('app.allow_verdict', '', true);

  insert into public.events (actor_id, project_id, type, payload)
  values (
    auth.uid(), v_project, 'ref.verdict',
    jsonb_build_object(
      'image_id', p_image_id,
      'before', v_old_verdict,
      'after', p_verdict,
      'memo', p_memo
    )
  );
end;
$$;

grant execute on function public.set_verdict(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- direction_logs: SELECT/INSERT만 (UPDATE/DELETE 정책 없음 — 이력 보존).
-- supersedes 지정 시 이전 row는 trigger가 superseded 처리.
-- 상태 확정(open→confirmed)은 director 전용 RPC.
-- -----------------------------------------------------------------------------
drop policy if exists direction_logs_select on public.direction_logs;
create policy direction_logs_select on public.direction_logs
  for select to authenticated
  using (public.is_director() or public.is_assigned_to_project(project_id));

drop policy if exists direction_logs_insert on public.direction_logs;
create policy direction_logs_insert on public.direction_logs
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (public.is_director() or public.is_assigned_to_project(project_id))
    and status <> 'superseded' -- superseded는 trigger 결과로만 존재
  );

create or replace function public.handle_direction_supersede()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.supersedes is not null then
    update public.direction_logs
    set status = 'superseded'
    where id = new.supersedes;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_direction_supersede on public.direction_logs;
create trigger trg_direction_supersede
  after insert on public.direction_logs
  for each row execute function public.handle_direction_supersede();

-- RPC: 방향 로그 확정/재오픈 (director 전용) + 이벤트 기록
create or replace function public.set_direction_status(
  p_log_id uuid,
  p_status text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid;
  v_old text;
begin
  if not public.is_director() then
    raise exception '대표만 방향 로그 상태를 변경할 수 있습니다' using errcode = '42501';
  end if;
  if p_status not in ('open', 'confirmed') then
    raise exception '상태는 open 또는 confirmed 여야 합니다';
  end if;

  select project_id, status into v_project, v_old
  from public.direction_logs where id = p_log_id;
  if not found then
    raise exception '방향 로그를 찾을 수 없습니다';
  end if;
  if v_old = 'superseded' then
    raise exception '대체된 로그는 상태를 변경할 수 없습니다';
  end if;

  update public.direction_logs set status = p_status where id = p_log_id;

  insert into public.events (actor_id, project_id, type, payload)
  values (
    auth.uid(), v_project, 'direction.status_changed',
    jsonb_build_object('log_id', p_log_id, 'before', v_old, 'after', p_status)
  );
end;
$$;

grant execute on function public.set_direction_status(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- proc_items: director만. freelancer 정책 자체 없음 (원가 구조 노출 방지).
-- -----------------------------------------------------------------------------
drop policy if exists proc_items_director_all on public.proc_items;
create policy proc_items_director_all on public.proc_items
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

-- -----------------------------------------------------------------------------
-- personal_notes: 본인만 전체 CRUD. director 포함 타인 정책 없음.
-- -----------------------------------------------------------------------------
drop policy if exists personal_notes_own_all on public.personal_notes;
create policy personal_notes_own_all on public.personal_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- feed_cursors: 본인 row만
-- -----------------------------------------------------------------------------
drop policy if exists feed_cursors_own_all on public.feed_cursors;
create policy feed_cursors_own_all on public.feed_cursors
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
