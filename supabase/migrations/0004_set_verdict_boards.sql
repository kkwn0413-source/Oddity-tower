-- =============================================================================
-- 0004 — set_verdict를 board 구조에 맞게 재정의
-- (0002 버전이 ref_zones.project_id를 참조 — 0003에서 제거됨)
-- 이벤트에 board_id를 함께 기록해 개인/공유 보드 판정도 피드 가능하게.
-- =============================================================================

create or replace function public.set_verdict(
  p_image_id uuid,
  p_verdict text,
  p_memo text default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_board uuid;
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

  select ri.verdict, z.board_id, b.project_id
    into v_old_verdict, v_board, v_project
  from public.ref_images ri
  join public.ref_zones z on z.id = ri.zone_id
  join public.boards b on b.id = z.board_id
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

  insert into public.events (actor_id, project_id, board_id, type, payload)
  values (
    auth.uid(), v_project, v_board, 'ref.verdict',
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
