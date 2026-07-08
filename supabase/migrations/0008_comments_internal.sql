-- =============================================================================
-- 0008 — internal 코멘트 보수 강화 (자율 결정: 대표 전용 우선 원칙)
-- 스펙 6.1 "internal은 director만 표시"를 뷰 레벨이 아니라 RLS로 강제:
-- freelancer는 자기 태스크 코멘트 중 internal = false 만 SELECT.
-- (director는 comments_director_all 정책으로 전체 열람 — 영향 없음)
-- =============================================================================

drop policy if exists comments_freelancer_select on public.comments;
create policy comments_freelancer_select on public.comments
  for select to authenticated
  using (public.can_access_task(task_id) and internal = false);

-- freelancer는 internal 코멘트 작성도 불가 (내부 전용은 대표만)
drop policy if exists comments_freelancer_insert on public.comments;
create policy comments_freelancer_insert on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.can_access_task(task_id)
    and internal = false
  );
