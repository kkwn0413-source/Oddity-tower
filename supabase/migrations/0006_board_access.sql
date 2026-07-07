-- =============================================================================
-- 0006 — 보드 접근 제한 (인원별 자료 한정, director 관리)
--
--  * boards.access: 'default' = 기존 자동 규칙(배정/공유/공개) 그대로
--                   'restricted' = 지정 인원(board_members)만 열람·편집
--  * director와 개인 보드 소유자는 항상 접근 가능
--  * can_view_board / can_edit_board 재정의 → ref_zones/ref_images/meetings/
--    board_assets/storage 정책이 전부 이 함수를 쓰므로 자동 전파
-- =============================================================================

alter table public.boards
  add column if not exists access text not null default 'default'
    check (access in ('default', 'restricted'));

create table if not exists public.board_members (
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

alter table public.board_members enable row level security;

-- director만 관리, 본인은 자기 멤버십 확인 가능
drop policy if exists board_members_director_all on public.board_members;
create policy board_members_director_all on public.board_members
  for all to authenticated
  using (public.is_director())
  with check (public.is_director());

drop policy if exists board_members_select_own on public.board_members;
create policy board_members_select_own on public.board_members
  for select to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 접근 함수 재정의
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
        or (b.kind = 'personal' and b.owner_id = auth.uid())
        or (
          case when b.access = 'restricted'
            then exists (
              select 1 from public.board_members m
              where m.board_id = b.id and m.user_id = auth.uid()
            )
            else (
              b.kind = 'shared'
              or (b.kind = 'personal' and b.shared)
              or (b.kind = 'project' and public.is_assigned_to_project(b.project_id))
            )
          end
        )
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
        or (b.kind = 'personal' and b.owner_id = auth.uid())
        or (
          case when b.access = 'restricted'
            then exists (
              select 1 from public.board_members m
              where m.board_id = b.id and m.user_id = auth.uid()
            )
            else (
              b.kind = 'shared'
              or (b.kind = 'project' and public.is_assigned_to_project(b.project_id))
            )
          end
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- RPC: 접근 설정 저장 (모드 + 멤버 교체 + 이벤트) — director 전용 단일 경로
-- -----------------------------------------------------------------------------
create or replace function public.set_board_access(
  p_board_id uuid,
  p_access text,
  p_member_ids uuid[]
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_director() then
    raise exception '대표만 접근 설정을 변경할 수 있습니다' using errcode = '42501';
  end if;
  if p_access not in ('default', 'restricted') then
    raise exception '접근 모드는 default 또는 restricted 여야 합니다';
  end if;

  update public.boards set access = p_access where id = p_board_id;
  if not found then
    raise exception '보드를 찾을 수 없습니다';
  end if;

  delete from public.board_members where board_id = p_board_id;
  if p_access = 'restricted' and p_member_ids is not null then
    insert into public.board_members (board_id, user_id, added_by)
    select p_board_id, uid, auth.uid()
    from unnest(p_member_ids) as uid
    on conflict do nothing;
  end if;

  insert into public.events (actor_id, board_id, type, payload)
  values (
    auth.uid(), p_board_id, 'board.access_changed',
    jsonb_build_object(
      'access', p_access,
      'member_count', coalesce(array_length(p_member_ids, 1), 0)
    )
  );
end;
$$;

grant execute on function public.set_board_access(uuid, text, uuid[]) to authenticated;
