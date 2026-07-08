-- =============================================================================
-- 0007 — Realtime 발행 대상 등록 (다중 사용자 보드 동기화, 스펙 6.6)
-- postgres_changes는 RLS를 준수하므로 접근 제한 보드는 이벤트도 필터링된다.
-- =============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'boards', 'ref_zones', 'ref_images', 'board_assets',
    'meetings', 'meeting_items', 'meeting_comments', 'direction_logs'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
